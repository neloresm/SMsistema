// Leitor do texto exportado/copiado do sistema de cobrança (formato "Evento: ... Contrato N - ... Parcela Valor Vencimento Pagamento").
// Nunca inventa dados: o que não for encontrado fica vazio e é sinalizado em `avisos`.

const brNum = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const anyNum = (s) => (/^\d+\.\d{1,2}$/.test(s) ? Number(s) : brNum(s));
const dmy = (s) => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };

export function inferirTipo(desc) {
  const d = desc.toUpperCase();
  if (/PRENHEZ/.test(d)) return 'prenhez';
  if (/ASPIRA/.test(d)) return 'aspiracao';
  if (/EMBRI/.test(d)) return 'embriao';
  if (/NOVILHA|BEZERR|VACA|TOURO|MACHO|REPRODUTOR|MATRIZ/.test(d)) return 'animal';
  return 'nao_identificado';
}
export function extrairAnimal(desc) {
  let s = desc.replace(/^\s*[\d.,]+\s*%\s*/, '').replace(/^PO\s*-\s*/i, '');
  const cruz = s.match(/\s[xX]\s(.+?)(?:\s*\(|\s+-\s+LOTE|\s+LOTE|$)/);
  const animal = s.split(/\s[xX]\s|\s*\(|\s+-\s+LOTE|\s+LOTE/i)[0].trim();
  return { animal, acasalamento: cruz ? cruz[1].trim() : '' };
}

export function parseCobranca(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
  const blocos = t.split(/(?:^|\n)[ \t]*Evento:[ \t]*/).slice(1);
  const out = [];
  for (const bloco of blocos) {
    const avisos = [];
    const lines = bloco.split('\n').map((l) => l.trim());
    const evLine = lines[0];
    const evM = evLine.match(/^(.*?)[\s-]*(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*(.+))?\s*$/);
    const leilao = evM ? { nome: evM[1].trim().replace(/\s*-\s*$/, ''), data: dmy(evM[2]), local: (evM[3] || '').trim() } : { nome: evLine, data: '', local: '' };
    if (!evM) avisos.push('Data do leilão não encontrada.');

    const h = bloco.match(/Contrato\s+(?:(\d+)\s+)?-\s+(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s+-\s+Valor:\s*R\$\s*([\d.,]+)\s*\(Status:\s*([^\s-]+)\s*-\s*Pagto:\s*(\d+)\s*\/\s*(\d+)/);
    if (!h) { out.push({ erro: 'Cabeçalho do contrato não reconhecido', trecho: bloco.slice(0, 300) }); continue; }
    let desc = h[2].trim(); let vendedor = '';
    const vm = desc.match(/\s*\(Vendedor:\s*([^)]+)\)/i);
    if (vm) { vendedor = vm[1].trim(); desc = desc.replace(vm[0], '').trim(); }

    const pick = (re) => { const m = bloco.match(re); return m ? m[1].trim() : ''; };
    const nome = pick(/Nome:\s*(.+)/);
    const email = pick(/E-mail:\s*(.*)/);
    const documento = pick(/Documento:\s*(\S+)/).replace(/\D/g, '');
    const telRaw = pick(/Telefone:\s*(.*)/);
    const tels = [...new Set(telRaw.split('/').map((x) => x.trim()).filter(Boolean))];
    if (!documento) avisos.push('CPF/CNPJ não encontrado.');
    if (!email) avisos.push('E-mail não encontrado.');

    // última ocorrência
    let ocorrencia = null;
    const oi = lines.findIndex((l) => /^Última Ocorrência/i.test(l));
    if (oi >= 0) {
      const fim = lines.findIndex((l, i) => i > oi && /^Insira sua mensagem/i.test(l));
      const seg = lines.slice(oi + 1, fim > 0 ? fim : oi + 12).filter(Boolean);
      const cab = (seg[0] || '').match(/^(.+?)\s+-\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})$/);
      const corpo = cab ? seg.slice(1) : seg;
      const titulo = corpo[0] && corpo[0] === corpo[0].toUpperCase() && /[A-ZÀ-Ú]{4}/.test(corpo[0]) ? corpo[0] : '';
      ocorrencia = { categoria: cab ? cab[1] : '', data_hora: cab ? cab[2] : '', titulo, texto: (titulo ? corpo.slice(1) : corpo).join(' ') };
    }

    // documentos listados
    const di = lines.findIndex((l) => /^Documento\s+Ação/i.test(l));
    const pi = lines.findIndex((l) => /^Parcela\s+Valor\s+Vencimento/i.test(l));
    const documentos = di >= 0 && pi > di ? lines.slice(di + 1, pi).filter(Boolean) : [];
    const docsTxt = documentos.join(' ').toUpperCase();
    const assinatura = /C?P?ONTRATO ASSINADO/.test(docsTxt) ? 'assinado' : /SEM ASSINATURA/.test(docsTxt) ? 'sem_assinatura' : 'nao_informado';

    // parcelas
    const parcelas = [];
    const re = /^\s*(\d+)\s+R\$\s*([\d.]+,\d{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s*$/gm;
    let m;
    const area = pi >= 0 ? lines.slice(pi + 1).join('\n') : bloco;
    while ((m = re.exec(area))) {
      const valor = brNum(m[2]); const st = m[4];
      const p = { numero: +m[1], vencimento: dmy(m[3]), valor_previsto: valor.toFixed(2), status_origem: st };
      const mc = st.match(/Liquidada no cadastro em (\d{2}\/\d{2}\/\d{4})/i);
      const ml = st.match(/Liquidada em (\d{2}\/\d{2}\/\d{4})/i);
      const dt = mc ? dmy(mc[1]) : ml ? dmy(ml[1]) : null;
      if (dt && valor === 0) { p.liquidacao_externa = true; p.data_liquidacao_externa = dt; }
      if (dt && valor > 0) p.pagamento = { data: dt, valor: valor.toFixed(2), obs: 'Baixa importada do sistema de cobrança: ' + st };
      if (!dt && !/Atrasada|A vencer/i.test(st)) avisos.push(`Parcela ${m[1]}: situação "${st}" não reconhecida (mantida sem pagamento).`);
      parcelas.push(p);
    }
    const den = +h[7];
    if (parcelas.length !== den) avisos.push(`Foram lidas ${parcelas.length} parcelas, mas o cabeçalho indica ${den}.`);

    const pctM = desc.match(/^\s*([\d.,]+)\s*%/);
    const loteM = desc.match(/LOTE\s+([\w-]+)/i);
    const { animal, acasalamento } = extrairAnimal(desc);
    const valorTotal = anyNum(h[4]);
    const soma = parcelas.reduce((s, p) => s + Math.round(+p.valor_previsto * 100), 0) / 100;
    const dif = Math.round((valorTotal - soma) * 100) / 100;
    if (Math.abs(dif) >= 0.05) avisos.push(`Soma das parcelas (R$ ${soma.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) difere do valor do contrato em R$ ${dif.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);

    out.push({
      id: h[1] ? +h[1] : null, fonte: 'importacao_texto', leilao,
      comprador: { nome, documento, email, telefone: tels.join(' / ') },
      descricao: desc, animal, acasalamento, tipo_venda: inferirTipo(desc),
      percentual: pctM ? anyNum(pctM[1].replace(/,(\d+)$/, '.$1')).toFixed(4) : '', lote: loteM ? loteM[1] : '',
      data_contrato: h[3], valor_total: valorTotal.toFixed(2), qtd_parcelas: den, pagto_origem: `${h[6]}/${h[7]}`,
      status_origem_contrato: h[5], vendedor, assinatura, documentos_origem: documentos, ultima_ocorrencia: ocorrencia,
      parcelas, avisos,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relatório de repasse da MECOB ("Prestação de Contas" / "Relatório de movimentações")
// Cada linha de CRÉDITO:  ID … parcela(s) (pagas/total) vencimento crédito R$ honorário R$ repasse
// Cada linha de TAXA:     referência [descrição] parcela ID comprador R$ valor
// ---------------------------------------------------------------------------
const TAXA_DESC = { 'SPC': 'Negativação', 'Hon. Rec.': 'Honorários de recebimento direto', 'TBB': 'Taxa de baixa de boleto' };
const money = (s) => (s && s.trim() !== '-' ? brNum(s) : 0);

export function parseRelatorioMecob(texto) {
  const lines = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' '));
  const all = lines.join('\n');
  const avisos = [];
  const tit = all.match(/Repasse\s+(\d{2}\/\d{2}\/\d{4})\s*-\s*([^\n]+)/);
  const resumo = (rot) => { const m = all.match(new RegExp(rot + ':\\s+R\\$\\s+([\\d.,]+|-)')); return m ? money(m[1]) : null; };
  const out = {
    titulo: tit ? `Repasse ${tit[1]} - ${tit[2].trim()}` : '', data_repasse: tit ? dmy(tit[1]) : '',
    creditos: resumo('Créditos'), debitos: resumo('Débitos'), taxas: resumo('Taxas'), valor_final: resumo('Valor final'),
    linhas: [], avisos,
  };
  if (out.valor_final == null) { avisos.push('Não encontrei o "Resumo do repasse" (Créditos / Taxas / Valor final). O arquivo é um relatório de repasse da contabilidade?'); return out; }

  // seções
  let sec = '';
  // procura a "cauda" da linha (parcela(s) … repasse) a partir da esquerda, para pegar "11 e 12" inteiro
  const reCauda = /(?<![\w])(\d+(?:\s+e\s+\d+)*)\s+\((\d+)\/(\d+)\)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+R\$\s+([\d.,]+)\s+R\$\s+([\d.,]+)\s*$/;
  const reTaxa = /^\s*(.+?)\s{3,}(?:(.+?)\s{3,})?\(?(\d+)(?:\/\d+)?\)?\s{3,}(\d{4,7})\s{3,}(.+?)\s{3,}R\$\s+([\d.,]+)\s*$/;
  const sobra = { CRÉDITOS: 0, DÉBITOS: 0, TAXAS: 0 };
  lines.forEach((l, idx) => {
    const s = l.trim();
    if (/^CRÉDITOS$/.test(s)) { sec = 'CRÉDITOS'; return; }
    if (/^DÉBITOS$/.test(s)) { sec = 'DÉBITOS'; return; }
    if (/^TAXAS$/.test(s)) { sec = 'TAXAS'; return; }
    if (!sec || !s || /^Total:/.test(s)) return;
    if (sec === 'CRÉDITOS' || sec === 'DÉBITOS') {
      const id = l.match(/^\s*(\d{4,7})\s/);
      const m = id && l.match(reCauda);
      if (m) {
        const meio = l.slice(id[0].length, m.index).trim();
        const nome = (meio.split(/\s{5,}/)[0] || '').trim();
        out.linhas.push({ tipo: sec === 'CRÉDITOS' ? 'credito' : 'debito', contrato_id: +id[1], parcelas: m[1].split(/\s+e\s+/).map(Number),
          pagas_total: `${m[2]}/${m[3]}`, comprador: /\d|%|LOTE| X /.test(nome) || nome === nome.toUpperCase() && / /.test(nome) && nome.length > 14 && !/LTDA|S\/A/.test(nome) ? '' : nome,
          vencimento: dmy(m[4]), data_credito: dmy(m[5]), honorario: brNum(m[6]).toFixed(2), valor: brNum(m[7]).toFixed(2) });
      } else if (/R\$\s+[\d.,]+\s*$/.test(s)) sobra[sec]++;
    } else if (sec === 'TAXAS') {
      if (/^Referência/.test(s)) return;
      const m = l.match(reTaxa);
      if (m) {
        const ref = m[1].trim();
        let desc = (m[2] || '').trim();
        if (!desc) desc = [lines[idx - 1], lines[idx + 1]].filter((x) => x && !/R\$/.test(x) && !/^\s*(Referência|Total|TAXAS)/.test(x)).map((x) => x.trim()).join(' ') || TAXA_DESC[ref] || '';
        out.linhas.push({ tipo: 'taxa', referencia: ref, descricao: desc, parcelas: [+m[3]], contrato_id: +m[4], comprador: m[5].trim(), valor: brNum(m[6]).toFixed(2) });
      } else if (/R\$\s+[\d.,]+\s*$/.test(s)) sobra.TAXAS++;
    }
  });
  for (const k in sobra) if (sobra[k]) avisos.push(`${sobra[k]} linha(s) com valor na seção ${k} não foram reconhecidas. Confira o arquivo antes de salvar.`);

  const soma = (tipo) => Math.round(out.linhas.filter((l) => l.tipo === tipo).reduce((s, l) => s + Math.round(+l.valor * 100), 0)) / 100;
  const chk = [['credito', 'creditos', 'créditos'], ['taxa', 'taxas', 'taxas'], ['debito', 'debitos', 'débitos']];
  for (const [t, k, nome] of chk) if (Math.abs(soma(t) - (out[k] || 0)) > 0.009) avisos.push(`Soma das linhas de ${nome} (${soma(t).toFixed(2)}) difere do resumo do relatório (${(out[k] || 0).toFixed(2)}).`);
  const calc = Math.round(((out.creditos || 0) - (out.debitos || 0) - (out.taxas || 0)) * 100) / 100;
  if (Math.abs(calc - out.valor_final) > 0.009) avisos.push(`Créditos − débitos − taxas (${calc.toFixed(2)}) difere do valor final informado (${out.valor_final.toFixed(2)}).`);
  const datas = out.linhas.map((l) => l.data_credito).filter(Boolean).sort();
  out.periodo_inicio = datas[0] || ''; out.periodo_fim = datas[datas.length - 1] || '';
  out.mes_sugerido = (out.periodo_fim || out.data_repasse || '').slice(0, 7);
  return out;
}

// Extrai texto de um PDF (pdf.js global) preservando quebras de linha aproximadas.
export async function pdfParaTexto(file) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('Leitor de PDF não carregou.');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    pages.push(ys.map((y) => rows.get(y).sort((a, b) => a.x - b.x).map((r) => r.s).join('    ')).join('\n'));
  }
  return pages.join('\n');
}

