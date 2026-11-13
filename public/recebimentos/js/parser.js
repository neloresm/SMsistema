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


// ---------------------------------------------------------------------------
// Outros formatos de contrato (PDF da leiloeira)
//  - "Nota de Leilão e Contrato de Compra e Venda" (vendedor, comprador, lote, forma de pagamento)
//  - "Mapa de Compra" (sempre é compra)
// A SM só recebe pelos contratos em que ela é a VENDEDORA. Quando a SM aparece como compradora,
// o registro volta marcado como `compra` para a tela explicar que ele não entra nos recebimentos.
// ---------------------------------------------------------------------------
export const SM_NOMES = /fabio ferreira dias marcondes|sm agropecu|agro\s*sm\b/i;
const colunas = (l) => String(l || '').trim().split(/\s{2,}|\t/).map((x) => x.trim()).filter(Boolean);
const somaMeses = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
};
const linhaApos = (ls, re, pular = 0) => { const i = ls.findIndex((l) => re.test(l)); return i >= 0 ? ls[i + 1 + pular] || '' : ''; };

export function parseNotaLeilao(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
  const out = []; const vistos = new Set();
  const partes = t.split(/Nota de Leilão e Contrato de Compra e Venda[^\n]*/i).slice(1);
  for (const p of partes) {
    if (!/DADOS DO VENDEDOR/i.test(p)) continue;
    const ls = p.split('\n');
    const avisos = [];
    const cab = colunas(linhaApos(ls, /Leilão\s+Número\s+(?:da\s+)?Nota/i));
    const lm = (cab[0] || '').match(/^(.*?)\s*-\s*(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*(.+))?$/);
    const leilao = lm ? { nome: lm[1].trim(), data: dmy(lm[2]), local: (lm[3] || '').trim() } : { nome: cab[0] || '', data: '', local: '' };
    const nota = cab[1] || ''; let lote = cab[2] || '';
    if (!lote) lote = colunas(linhaApos(ls, /Leiloeiro\(s\)\s+Lote/i))[1] || '';
    const chave = `${leilao.nome}|${nota}|${lote}`;
    if (vistos.has(chave)) continue; vistos.add(chave);
    const vend = colunas(linhaApos(ls, /DADOS DO VENDEDOR/i, 1));
    const comp = colunas(linhaApos(ls, /DADOS DO COMPRADOR/i, 1));
    const obj = linhaApos(ls, /OBJETO DO CONTRATO/i).trim();
    const pct = obj.match(/^([\d.,]+)\s*%/);
    const desc = obj.replace(/^([\d.,]+)\s*%\s*(da\(o\))?\s*/i, '').replace(/\s{2,}/g, ' ').trim();
    const venda = colunas(linhaApos(ls, /Valor do Lance.*Total Líquido/i));
    const valores = venda.filter((x) => /^R\$/.test(x)).map((x) => brNum(x.replace(/R\$\s*/, '')));
    const valorTotal = valores.length ? valores[valores.length - 1] : 0;
    const fi = ls.findIndex((l) => /FORMA DE PAGAMENTO/i.test(l)); const ff = ls.findIndex((l, i) => i > fi && /^\s*OBS\.?:/i.test(l));
    const area = fi >= 0 ? ls.slice(fi + 1, ff > fi ? ff : fi + 20).join(' ') : '';
    const parcelas = []; let m; const re = /(\d{1,3})º\s*-\s*R\$\s*([\d.]+,\d{2})\s*(?:-\s*(\d{2}\/\d{2}\/\d{4}))?/g;
    while ((m = re.exec(area))) parcelas.push({ numero: +m[1], valor_previsto: brNum(m[2]).toFixed(2), vencimento: m[3] ? dmy(m[3]) : '' });
    const base = parcelas.find((x) => x.vencimento);
    let estimadas = 0;
    for (const q of parcelas) if (!q.vencimento && base) { q.vencimento = somaMeses(base.vencimento, q.numero - base.numero); q.vencEstimado = true; estimadas++; }
    if (estimadas) avisos.push(`${estimadas} vencimento(s) não aparecem no PDF; foram estimados mês a mês a partir de ${base.vencimento.split('-').reverse().join('/')} e não são comparados.`);
    if (!parcelas.length) avisos.push('Forma de pagamento não encontrada.');
    const r = {
      id: null, fonte: 'nota_leilao', tipo_doc: 'Nota de Leilão', numero_nota: nota, leilao,
      vendedor: vend[0] || '', comprador: { nome: comp[0] || '', documento: (comp[1] || '').replace(/\D/g, ''), email: '', telefone: comp.slice(2).join(' / ') },
      descricao: desc, ...extrairAnimal(desc), tipo_venda: inferirTipo(desc), percentual: pct ? Number(pct[1].replace(',', '.')).toFixed(4) : '',
      lote, data_contrato: leilao.data, valor_total: valorTotal.toFixed(2), qtd_parcelas: parcelas.length, parcelas, avisos,
    };
    if (SM_NOMES.test(r.comprador.nome) && !SM_NOMES.test(r.vendedor)) r.compra = `Contrato de compra: a SM (${r.comprador.nome}) é a compradora e o vendedor é ${r.vendedor || 'outro'}.`;
    else if (!SM_NOMES.test(r.vendedor)) r.compra = `A SM não aparece como vendedora neste contrato (vendedor: ${r.vendedor || 'não identificado'}; comprador: ${r.comprador.nome || 'não identificado'}).`;
    out.push(r);
  }
  return out;
}

export function parseMapaCompra(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (!/MAPA DE COMPRA/i.test(t)) return [];
  const ls = t.split('\n');
  const ev = (linhaApos(ls, /MAPA DE COMPRA/i) || '').trim();
  const em = ev.match(/^(.*?)\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  const comprador = (t.match(/Comprador\s*:\s*(.+)/) || [])[1]?.trim() || '';
  const total = (t.match(/=\s*R\$\s*([\d.]+,\d{2})/) || [])[1];
  return [{ id: null, fonte: 'mapa_compra', tipo_doc: 'Mapa de Compra', leilao: { nome: em ? em[1].trim() : ev, data: em ? dmy(em[2]) : '' }, comprador: { nome: comprador },
    valor_total: total ? brNum(total).toFixed(2) : '', parcelas: [], avisos: [],
    compra: `Mapa de compra: a SM${comprador ? ` (${comprador})` : ''} é a compradora neste leilão.` }];
}

// Lê qualquer formato de contrato conhecido. Devolve [] se nenhum for reconhecido.
export function lerContratos(text) {
  const a = parseCobranca(text);
  if (a.length) return a;
  const b = parseNotaLeilao(text);
  if (b.length) return b;
  return parseMapaCompra(text);
}
