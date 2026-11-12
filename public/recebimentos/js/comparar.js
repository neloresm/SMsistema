// Comparação em lote: contratos dos arquivos enviados x contratos cadastrados.
// Referência principal: número do contrato. Sem número: comprador + leilão + lote + data.
import * as C from './calc.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cv = (v) => Math.round(Number(v || 0) * 100);
const assinatura = (d) => JSON.stringify([d.valor_total, d.lote, d.comprador?.documento, (d.parcelas || []).map((p) => [p.numero, p.vencimento, p.valor_previsto])]);

function pontuacao(d, c) {
  const comp = (d.comprador?.documento && d.comprador.documento === c.comprador.documento) || (norm(d.comprador?.nome) && norm(d.comprador.nome) === norm(c.comprador.nome));
  const leilao = norm(d.leilao?.nome) === norm(c.leilao.nome) && (!d.leilao?.data || !c.leilao.data || d.leilao.data === c.leilao.data);
  const lote = norm(d.lote) && norm(d.lote) === norm(c.lote);
  const data = d.data_contrato && d.data_contrato === c.data_contrato;
  return { total: [comp, leilao, lote, data].filter(Boolean).length, comp, leilao, lote, data };
}

// campos conferidos, lado a lado
export function diferencas(d, c) {
  const campos = [];
  const add = (id, label, arq, cad, igual, fmt = (x) => x || '—') => { if (!igual) campos.push({ id, label, arquivo: fmt(arq), cadastro: fmt(cad), arqRaw: arq }); };
  add('comprador', 'Comprador', d.comprador?.nome, c.comprador.nome, norm(d.comprador?.nome) === norm(c.comprador.nome));
  if (d.comprador?.documento) add('documento', 'CPF/CNPJ', d.comprador.documento, c.comprador.documento, d.comprador.documento === (c.comprador.documento || ''), C.fmtDoc);
  add('leilao', 'Leilão', `${d.leilao?.nome || ''}${d.leilao?.data ? ' · ' + C.fmtD(d.leilao.data) : ''}`, `${c.leilao.nome}${c.leilao.data ? ' · ' + C.fmtD(c.leilao.data) : ''}`,
    norm(d.leilao?.nome) === norm(c.leilao.nome) && (!d.leilao?.data || d.leilao.data === c.leilao.data));
  add('lote', 'Lote', d.lote, c.lote, norm(d.lote) === norm(c.lote));
  if (d.animal) add('animal', 'Animal / genética', d.animal, c.animal, norm(d.animal) === norm(c.animal));
  if (d.percentual !== '' && d.percentual != null) add('percentual', '% vendido', d.percentual, c.percentual, Math.abs(Number(d.percentual) - Number(c.percentual || 0)) < 0.01, (x) => (x === '' || x == null ? '—' : Number(x).toLocaleString('pt-BR') + '%'));
  add('valor_total', 'Valor contratado', d.valor_total, c.valor_total, cv(d.valor_total) === cv(c.valor_total), (x) => C.brl(cv(x)));
  if (d.data_contrato) add('data_contrato', 'Data do contrato', d.data_contrato, c.data_contrato, d.data_contrato === c.data_contrato, C.fmtD);
  const e1 = (d.parcelas || []).find((p) => p.numero === 1), c1 = c.parcelas.find((p) => p.numero === 1);
  if (e1) add('entrada', 'Entrada (parcela 1)', `${C.brl(cv(e1.valor_previsto))} · ${C.fmtD(e1.vencimento)}`, c1 ? `${C.brl(c1.prev)} · ${C.fmtD(c1.vencimento)}` : '—', c1 && cv(e1.valor_previsto) === c1.prev && e1.vencimento === c1.vencimento);
  const nArq = (d.parcelas || []).length, nCad = c.parcelas.filter((p) => !p.cancelada).length;
  if (nArq) add('qtd_parcelas', 'Quantidade de parcelas', nArq, nCad, nArq === nCad, String);
  // parcelas (2 em diante; a entrada já está acima)
  const parcelas = [];
  for (const p of (d.parcelas || []).filter((x) => x.numero > 1)) {
    const q = c.parcelas.find((x) => x.numero === p.numero);
    const valorOk = q && cv(p.valor_previsto) === cv(q.valor_previsto), vencOk = q && p.vencimento === q.vencimento;
    if (!q || !valorOk || !vencOk) parcelas.push({ numero: p.numero, arquivo: { valor: cv(p.valor_previsto), venc: p.vencimento }, cadastro: q ? { valor: cv(q.valor_previsto), venc: q.vencimento } : null, nova: !q, valorOk, vencOk });
  }
  // pagamentos que estão no arquivo e ainda não foram registrados (não é divergência)
  const pagamentosNovos = (d.parcelas || []).filter((p) => p.pagamento && cv(p.pagamento.valor) > 0).filter((p) => { const q = c.parcelas.find((x) => x.numero === p.numero); return q && !q.ativos.length; })
    .map((p) => ({ numero: p.numero, data: p.pagamento.data, valor: cv(p.pagamento.valor) }));
  return { campos, parcelas, pagamentosNovos };
}

/**
 * registros: [{ chave, arquivo, dados } | { chave, arquivo, erro }]
 * escolhas: { [chave]: 'novo' | <id do contrato cadastrado> }  (decisões tomadas na tela)
 */
export function compararLote(model, registros, escolhas = {}) {
  const res = { batendo: [], faltando: [], semArquivo: [], divergencia: [], revisao: [] };
  const usados = new Set();
  // repetidos no próprio envio
  const porId = new Map();
  for (const r of registros) if (!r.erro && r.dados.id) { if (!porId.has(r.dados.id)) porId.set(r.dados.id, []); porId.get(r.dados.id).push(r); }
  const ignorar = new Set();
  for (const [id, rs] of porId) {
    if (rs.length < 2) continue;
    const iguais = new Set(rs.map((r) => assinatura(r.dados))).size === 1;
    if (iguais) { rs.slice(1).forEach((r) => ignorar.add(r.chave)); rs[0].repetidoEm = rs.slice(1).map((r) => r.arquivo); }
    else if (!escolhas['dup:' + id]) { rs.forEach((r) => ignorar.add(r.chave)); res.revisao.push({ tipo: 'duplicidade', id, registros: rs, msg: `O contrato ${id} aparece em ${rs.length} arquivos com dados diferentes. Escolha qual versão usar.` }); }
    else rs.filter((r) => r.chave !== escolhas['dup:' + id]).forEach((r) => ignorar.add(r.chave));
  }
  for (const r of registros) {
    if (r.erro) { res.revisao.push({ tipo: 'ilegivel', arquivo: r.arquivo, msg: r.erro }); continue; }
    if (ignorar.has(r.chave)) continue;
    const d = r.dados;
    let cad = null;
    const escolha = escolhas[r.chave];
    if (escolha === 'novo') cad = null;
    else if (escolha) cad = model.cmap.get(Number(escolha)) || null;
    else if (d.id && model.cmap.has(d.id)) cad = model.cmap.get(d.id);
    else {
      // sem número (ou número não encontrado): procura por comprador + leilão + lote + data
      const cands = model.contratos.filter((c) => !usados.has(c.id)).map((c) => ({ c, s: pontuacao(d, c) })).filter((x) => x.s.total >= 3).sort((a, b) => b.s.total - a.s.total);
      const exatos = cands.filter((x) => x.s.total === 4);
      if (!d.id && exatos.length === 1) cad = exatos[0].c;
      else if (cands.length) {
        res.revisao.push({ tipo: 'incerta', chave: r.chave, arquivo: r.arquivo, dados: d, opcoes: cands.slice(0, 5),
          msg: d.id ? `O contrato ${d.id} não está cadastrado, mas há contrato(s) parecido(s) (mesmo comprador, leilão e lote). Pode ser duplicidade ou número diferente.` : `O arquivo não traz o número do contrato. Há ${cands.length} contrato(s) parecido(s) no cadastro.` });
        continue;
      }
    }
    if (!cad) { res.faltando.push({ chave: r.chave, arquivo: r.arquivo, dados: d, repetidoEm: r.repetidoEm }); continue; }
    if (usados.has(cad.id)) { res.revisao.push({ tipo: 'duplicidade', arquivo: r.arquivo, chave: r.chave, msg: `Mais de um registro do envio corresponde ao contrato ${cad.id}. Confira os arquivos.` }); continue; }
    usados.add(cad.id);
    const dif = diferencas(d, cad);
    const item = { chave: r.chave, arquivo: r.arquivo, dados: d, cad, ...dif, repetidoEm: r.repetidoEm, porEscolha: !!escolha };
    (dif.campos.length || dif.parcelas.length ? res.divergencia : res.batendo).push(item);
  }
  res.semArquivo = model.contratos.filter((c) => !c.arquivado && !usados.has(c.id));
  return res;
}

// monta a correção a partir dos campos marcados (valores do arquivo vão para o cadastro)
export function montarCorrecao(item, campos, corrigirParcelas) {
  const d = item.dados, p = {};
  const ct = {};
  if (campos.includes('lote')) ct.lote = d.lote;
  if (campos.includes('animal')) ct.animal = d.animal;
  if (campos.includes('percentual')) ct.percentual = String(d.percentual);
  if (campos.includes('valor_total')) ct.valor_total = String(d.valor_total);
  if (campos.includes('data_contrato')) ct.data_contrato = d.data_contrato;
  if (campos.includes('qtd_parcelas')) ct.qtd_parcelas = String((d.parcelas || []).length);
  if (Object.keys(ct).length) p.contrato = ct;
  const cp = {};
  if (campos.includes('comprador')) cp.nome = d.comprador.nome;
  if (campos.includes('documento')) cp.documento = d.comprador.documento;
  if (Object.keys(cp).length) p.comprador = cp;
  if (campos.includes('leilao')) p.leilao = { nome: d.leilao.nome, data: d.leilao.data || '' };
  const parcelas = [];
  if (campos.includes('entrada')) { const e = (d.parcelas || []).find((x) => x.numero === 1); if (e) parcelas.push({ numero: 1, valor_previsto: e.valor_previsto, vencimento: e.vencimento }); }
  if (corrigirParcelas) for (const x of item.parcelas) { const q = d.parcelas.find((y) => y.numero === x.numero); parcelas.push({ numero: q.numero, valor_previsto: q.valor_previsto, vencimento: q.vencimento }); }
  if (parcelas.length) p.parcelas = parcelas;
  return p;
}
