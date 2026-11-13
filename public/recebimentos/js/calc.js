// Motor financeiro único. Todos os valores em CENTAVOS (inteiros) para evitar erros de ponto flutuante.
// Datas sempre como string ISO 'YYYY-MM-DD' (sem fuso), "hoje" calculado no fuso America/Sao_Paulo.

export const TZ = 'America/Sao_Paulo';
export function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const cents = (v) => Math.round(Number(v || 0) * 100);
export const toReais = (c) => Math.round(c) / 100;
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (c) => BRL.format((c || 0) / 100);
export const brlCompact = (reais) => {
  const a = Math.abs(reais);
  if (a >= 1e6) return 'R$ ' + (reais / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (a >= 1e3) return 'R$ ' + (reais / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return 'R$ ' + reais.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
export const pct = (x) => (x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
export const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 86400000);

export function fmtDoc(d) {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d || '—';
}

export const STATUS_LABEL = {
  paga: 'Paga', parcial: 'Parcial', parcial_atrasada: 'Parcial em atraso', atrasada: 'Atrasada', a_vencer: 'A vencer',
  liquidada_externa: 'Liquidada fora (sem valor)', sem_valor: 'Sem valor', cancelada: 'Cancelada',
};
export const SITUACAO_LABEL = { atraso: 'Em atraso', em_dia: 'Em dia', quitado: 'Quitado', arquivado: 'Arquivado' };
export const TIPO_LABEL = { animal: 'Animal', prenhez: 'Prenhez', aspiracao: 'Aspiração', embriao: 'Embrião', participacao: 'Participação', outro: 'Outro', nao_identificado: 'Não identificado' };

// ---------------------------------------------------------------------------
// Buckets (mês / trimestre / ano)
// ---------------------------------------------------------------------------
export function bucketKey(iso, gran) {
  const y = iso.slice(0, 4), m = +iso.slice(5, 7);
  if (gran === 'ano') return y;
  if (gran === 'trimestre') return `${y}-T${Math.ceil(m / 3)}`;
  return iso.slice(0, 7);
}
export function bucketLabel(k) {
  if (/^\d{4}$/.test(k)) return k;
  if (k.includes('-T')) { const [y, t] = k.split('-T'); return `${t}º tri/${y.slice(2)}`; }
  const [y, m] = k.split('-'); return `${MESES[+m - 1]}/${y.slice(2)}`;
}
export function bucketLongLabel(k) {
  if (/^\d{4}$/.test(k)) return `Ano de ${k}`;
  if (k.includes('-T')) { const [y, t] = k.split('-T'); return `${t}º trimestre de ${y}`; }
  const [y, m] = k.split('-'); return `${MESES_LONGOS[+m - 1]} de ${y}`;
}
function nextKey(k, gran) {
  if (gran === 'ano') return String(+k + 1);
  if (gran === 'trimestre') { let [y, t] = k.split('-T').map(Number); t++; if (t > 4) { t = 1; y++; } return `${y}-T${t}`; }
  let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`;
}
function bucketStart(k) {
  if (/^\d{4}$/.test(k)) return `${k}-01-01`;
  if (k.includes('-T')) { const [y, t] = k.split('-T'); return `${y}-${String((+t - 1) * 3 + 1).padStart(2, '0')}-01`; }
  return `${k}-01`;
}

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------
export function build(raw, hoje = hojeISO()) {
  const leiloes = new Map(raw.leiloes.map((l) => [l.id, l]));
  const compradores = new Map(raw.compradores.map((c) => [c.id, c]));
  const revByC = new Map();
  for (const r of raw.revisao || []) { if (!revByC.has(r.contrato_id)) revByC.set(r.contrato_id, []); revByC.get(r.contrato_id).push(r); }

  const contratos = raw.contratos.map((c) => ({
    ...c, leilao: leiloes.get(c.leilao_id) || { nome: '?' }, comprador: compradores.get(c.comprador_id) || { nome: '?' },
    valorC: cents(c.valor_total), parcelas: [], revisao: revByC.get(c.id) || [],
  }));
  const cmap = new Map(contratos.map((c) => [c.id, c]));

  const pagsByParc = new Map();
  for (const g of raw.pagamentos) {
    if (!pagsByParc.has(g.parcela_id)) pagsByParc.set(g.parcela_id, []);
    pagsByParc.get(g.parcela_id).push({ ...g, valorC: cents(g.valor) });
  }

  const parcelas = [];
  for (const p0 of raw.parcelas) {
    const c = cmap.get(p0.contrato_id);
    if (!c) continue;
    const p = { ...p0, tipo: tipoParcela(p0) };
    const pags = (pagsByParc.get(p.id) || []).sort((a, b) => (a.data_pagamento < b.data_pagamento ? -1 : 1));
    const ativos = pags.filter((g) => !g.estornado);
    const prev = p.cancelada ? 0 : cents(p.valor_previsto);
    const rec = ativos.reduce((s, g) => s + g.valorC, 0);
    const saldo = p.cancelada ? 0 : Math.max(prev - rec, 0);
    let status;
    if (p.cancelada) status = 'cancelada';
    else if (prev === 0 && p.liquidacao_externa) status = 'liquidada_externa';
    else if (prev === 0) status = 'sem_valor';
    else if (rec >= prev) status = 'paga';
    else if (p.vencimento < hoje) status = rec > 0 ? 'parcial_atrasada' : 'atrasada';
    else status = rec > 0 ? 'parcial' : 'a_vencer';
    const vencida = saldo > 0 && p.vencimento < hoje;
    const elegivel = p.tipo === 'mecob';
    const vencidaR = vencida && elegivel;
    const obj = { ...p, elegivel, contrato: c, prev, rec, saldo, status, vencida: vencidaR, dias: vencidaR ? diffDays(hoje, p.vencimento) : 0, pags, ativos };
    c.parcelas.push(obj); parcelas.push(obj);
  }

  for (const c of contratos) {
    c.parcelas.sort((a, b) => a.numero - b.numero);
    const ps = c.parcelas.filter((p) => !p.cancelada && p.elegivel);
    // valor padrão da parcela (base do honorário cobrado sobre pagamentos diretos ao vendedor)
    const freq = new Map(); for (const p of ps) if (p.prev > 0) freq.set(p.prev, (freq.get(p.prev) || 0) + 1);
    c.valorPadrao = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
    c.nParc = c.parcelas.filter((p) => !p.cancelada).length;
    c.prevC = ps.reduce((s, p) => s + p.prev, 0);
    c.recC = ps.reduce((s, p) => s + p.rec, 0);
    c.saldoVencido = ps.reduce((s, p) => s + (p.vencida ? p.saldo : 0), 0);
    c.saldoFuturo = ps.reduce((s, p) => s + (!p.vencida ? p.saldo : 0), 0);
    c.foraC = c.valorC - c.prevC;
    c.qAtr = ps.filter((p) => p.vencida).length;
    c.maxDias = ps.reduce((m, p) => Math.max(m, p.dias), 0);
    c.qPagas = ps.filter((p) => p.status === 'paga').length;
    c.nElegiveis = ps.length;
    c.situacao = c.arquivado ? 'arquivado' : c.saldoVencido > 0 ? 'atraso' : c.saldoVencido + c.saldoFuturo === 0 ? 'quitado' : 'em_dia';
    c.pendRev = c.revisao.filter((r) => !r.resolvido);
    c.ano = (c.data_contrato || c.leilao?.data || '').slice(0, 4);
  }

  const pagamentos = [];
  for (const p of parcelas) for (const g of p.pags) pagamentos.push({ ...g, parcela: p, contrato: p.contrato });
  pagamentos.sort((a, b) => (a.data_pagamento < b.data_pagamento ? -1 : 1));

  // relatórios de repasse da contabilidade
  const linhasPorRep = new Map();
  for (const l of raw.repasse_linhas || []) { if (!linhasPorRep.has(l.repasse_id)) linhasPorRep.set(l.repasse_id, []); linhasPorRep.get(l.repasse_id).push(l); }
  // relatórios removidos (ex.: para reimportar) saem de todos os cálculos; ficam só no histórico
  const repassesRemovidos = (raw.repasses || []).filter((r) => r.removido);
  const repasses = (raw.repasses || []).filter((r) => !r.removido).map((r) => ({ ...r, linhas: (linhasPorRep.get(r.id) || []).sort((a, b) => a.id - b.id) }))
    .sort((a, b) => (a.periodo_inicio || '').localeCompare(b.periodo_inicio || '') || a.id - b.id);
  const cfg = Object.fromEntries((raw.config || []).map((x) => [x.chave, x.valor]));
  const contabilidades = (raw.contabilidades || []).slice().sort((a, b) => a.id - b.id);
  const contabAtual = contabilidades.find((x) => String(x.id) === String(cfg.contabilidade_atual)) || contabilidades[0] || null;
  for (const r of repasses) r.contabilidade = contabilidades.find((x) => x.id === r.contabilidade_id) || null;

  return { hoje, contratos, cmap, parcelas, pagamentos, repasses, repassesRemovidos, contabilidades, contabAtual, fechamentos: new Map((raw.fechamentos || []).map((f) => [f.mes, f])), leiloes: [...leiloes.values()], compradores: [...compradores.values()] };
}

// entrada (parcela 1) | cadastro ("Liquidada no cadastro") | direto (pago ao vendedor) | mecob (repassado pela MECOB)
export const TIPO_PARCELA_LABEL = { entrada: 'Entrada (direto à SM)', cadastro: 'Liquidada no cadastro', direto: 'Paga direto ao vendedor', mecob: 'Repasse pela contabilidade' };
export function tipoParcela(p) {
  if (['entrada', 'direto', 'cadastro'].includes(p.tipo)) return p.tipo; // definido no banco
  if (p.numero === 1) return 'entrada';
  if (/^Liquidada no cadastro/i.test(p.status_origem || '')) return 'cadastro';
  if (p.liquidacao_externa) return 'direto';
  return 'mecob';
}

// Filtro de contratos (base do dashboard, relatórios etc.)
export function filtrarContratos(model, f = {}) {
  return model.contratos.filter((c) => {
    if (c.arquivado && !f.incluirArquivados) return false;
    if (f.base === 'aprovados' && c.revisao_status !== 'aprovado') return false;
    if (f.leilao && String(c.leilao_id) !== String(f.leilao)) return false;
    if (f.comprador && String(c.comprador_id) !== String(f.comprador)) return false;
    if (f.contrato && String(c.id) !== String(f.contrato)) return false;
    return true;
  });
}

const inPeriodo = (iso, f) => (!f.de || iso >= f.de + '-01') && (!f.ate || iso <= f.ate + '-31');

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
export function kpis(model, contratos) {
  const h = model.hoje;
  const k = { vendido: 0, prevAteHoje: 0, recebido: 0, vencido: 0, futuro: 0, prevVencido: 0, recVencido: 0, ativos: 0, fora: 0, inad: 0, contratos: contratos.length, parcelasExternas: 0 };
  const inad = new Set();
  for (const c of contratos) {
    k.vendido += c.valorC; k.fora += c.foraC;
    for (const p of c.parcelas) {
      if (!p.cancelada && !p.elegivel && p.prev === 0) k.parcelasExternas++;
      if (p.cancelada || !p.elegivel) continue;
      if (p.vencimento <= h) k.prevAteHoje += p.prev;
      k.recebido += p.rec;
      if (p.vencimento < h) { k.prevVencido += p.prev; k.recVencido += Math.min(p.rec, p.prev); k.vencido += p.saldo; }
      else k.futuro += p.saldo;
    }
    if (c.saldoVencido + c.saldoFuturo > 0) k.ativos++;
    if (c.saldoVencido > 0) inad.add(c.comprador?.documento || 'id' + c.comprador_id);
  }
  k.inad = inad.size;
  k.taxa = k.prevVencido > 0 ? k.recVencido / k.prevVencido : null;
  return k;
}

// ---------------------------------------------------------------------------
// Séries do gráfico
//  modo 'contratual': agrupa pelo VENCIMENTO; recebido = quanto já foi pago das parcelas daquele período (em qualquer data).
//  modo 'caixa'     : previsto pelo vencimento; recebido pela DATA REAL do pagamento.
// ---------------------------------------------------------------------------
export function serie(model, contratos, modo, gran, f = {}) {
  const B = new Map();
  const get = (k) => { if (!B.has(k)) B.set(k, { key: k, previsto: 0, recebido: 0, qPrev: 0 }); return B.get(k); };
  for (const c of contratos) for (const p of c.parcelas) {
    if (p.cancelada || !p.elegivel) continue;
    if (inPeriodo(p.vencimento, f)) {
      const b = get(bucketKey(p.vencimento, gran)); b.previsto += p.prev; b.qPrev++;
      if (modo === 'contratual') b.recebido += p.rec;
    }
    if (modo === 'caixa') for (const g of p.ativos) if (inPeriodo(g.data_pagamento, f)) get(bucketKey(g.data_pagamento, gran)).recebido += g.valorC;
  }
  if (!B.size) return [];
  const keys = [...B.keys()].sort();
  const out = []; const hojeK = bucketKey(model.hoje, gran);
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = nextKey(k, gran)) {
    const b = B.get(k) || { key: k, previsto: 0, recebido: 0, qPrev: 0 };
    out.push({ ...b, label: bucketLabel(k), diferenca: b.previsto - b.recebido, futuro: k > hojeK, atual: k === hojeK, inicio: bucketStart(k) });
    if (out.length > 600) break;
  }
  return out;
}

export function detalheBucket(model, contratos, modo, gran, key) {
  const h = model.hoje;
  const rows = []; const pagRows = [];
  for (const c of contratos) for (const p of c.parcelas) {
    if (p.cancelada || !p.elegivel) continue;
    if (bucketKey(p.vencimento, gran) === key) rows.push(p);
    for (const g of p.ativos) if (bucketKey(g.data_pagamento, gran) === key) pagRows.push({ ...g, parcela: p, contrato: c });
  }
  rows.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.contrato.comprador.nome.localeCompare(b.contrato.comprador.nome)));
  pagRows.sort((a, b) => (a.data_pagamento < b.data_pagamento ? -1 : 1));
  const s = { previsto: 0, recebidoDasParcelas: 0, pendente: 0, vencidoNaoPago: 0, qPrev: 0, qPagas: 0, caixa: 0, qExternas: 0 };
  for (const p of rows) {
    s.previsto += p.prev; s.recebidoDasParcelas += p.rec; s.pendente += p.saldo; if (p.vencimento < h) s.vencidoNaoPago += p.saldo;
    s.qPrev++; if (p.status === 'paga') s.qPagas++; if (p.status === 'liquidada_externa') s.qExternas++;
  }
  for (const g of pagRows) s.caixa += g.valorC;
  s.recebido = modo === 'caixa' ? s.caixa : s.recebidoDasParcelas;
  s.taxa = s.previsto > 0 ? s.recebido / s.previsto : null;
  return { rows, pagRows, s };
}

// ---------------------------------------------------------------------------
// Inadimplência
// ---------------------------------------------------------------------------
export const FAIXAS = [
  { id: '1-30', de: 1, ate: 30 }, { id: '31-60', de: 31, ate: 60 }, { id: '61-90', de: 61, ate: 90 }, { id: '90+', de: 91, ate: Infinity },
];
export function inadimplencia(model, contratos) {
  const faixas = Object.fromEntries(FAIXAS.map((f) => [f.id, { valor: 0, qtd: 0 }]));
  const porComprador = new Map();
  for (const c of contratos) for (const p of c.parcelas) {
    if (!p.vencida) continue;
    const fx = FAIXAS.find((f) => p.dias >= f.de && p.dias <= f.ate) || FAIXAS[0];
    faixas[fx.id].valor += p.saldo; faixas[fx.id].qtd++;
    const key = c.comprador_id;
    if (!porComprador.has(key)) porComprador.set(key, { comprador: c.comprador, valor: 0, qtd: 0, maxDias: 0, contratos: new Set(), parcelas: [], faixas: {} });
    const r = porComprador.get(key);
    r.valor += p.saldo; r.qtd++; r.maxDias = Math.max(r.maxDias, p.dias); r.contratos.add(c.id); r.parcelas.push(p);
    r.faixas[fx.id] = (r.faixas[fx.id] || 0) + p.saldo;
  }
  const ranking = [...porComprador.values()].sort((a, b) => b.valor - a.valor);
  return { faixas, ranking, total: ranking.reduce((s, r) => s + r.valor, 0) };
}

// ===========================================================================
// CONFERÊNCIA DO REPASSE DA CONTABILIDADE (por mês)
//  - Mês esperado = mês em que o comprador pagou (pagamento registrado no contrato).
//    Linha de relatório sem pagamento registrado: usa o mês do relatório.
//  - Sem taxa fixa: a taxa de cada linha é a que a contabilidade cobrou (base bruta = taxa + transferido).
//  - Esperado líquido = valor pago pelo comprador − taxa cobrada sobre essa parcela.
//    Pagamento sem linha no relatório: esperado estimado pela taxa média do mês.
//  - Outros descontos (taxas avulsas, débitos) aparecem separados e formam a diferença.
//  - Entrada, "Liquidada no cadastro" e pagas direto ao vendedor ficam fora.
//  - Linha repetida em outro relatório é contada uma vez só.
// ===========================================================================
export const CONF_CATS = [
  { id: 'outros_descontos', t: 'Ajustes informados pela contabilidade', d: 'Descontos discriminados no relatório (negativação, honorários, tarifas). Aceite ou conteste.', sev: 'gold', ajuste: true },
  { id: 'faltou', t: 'Pago pelo comprador, sem repasse', d: 'Pagamento do mês que não aparece em nenhum relatório', sev: 'bad' },
  { id: 'base_divergente', t: 'Base diferente do valor pago', d: 'O valor bruto do relatório difere do que o comprador pagou', sev: 'bad' },
  { id: 'debito', t: 'Débito informado pela contabilidade', d: 'Valor debitado no relatório. Aceite ou conteste.', sev: 'gold', ajuste: true },
  { id: 'sem_parcela', t: 'Linha sem parcela no cadastro', d: 'Contrato ou parcela do relatório não encontrado no cadastro', sev: 'bad' },
  { id: 'sem_pagamento', t: 'Pagamento não registrado no contrato', d: 'A contabilidade informou o pagamento, mas ele não consta no contrato', sev: 'warn' },
  { id: 'fora_regra', t: 'Parcela que deveria ficar fora', d: 'Entrada, liquidada no cadastro ou paga direto que apareceu como crédito', sev: 'warn' },
  { id: 'recebido_outro', t: 'Pago neste mês, repassado em relatório de outro mês', d: 'Vinculado a este mês pelo pagamento do comprador', sev: 'gold', neutro: true },
  { id: 'encargo', t: 'Juros e multa repassados', d: 'Comprador pagou com atraso; encargo veio no repasse', sev: 'info', neutro: true },
  { id: 'agrupada', t: 'Mais de uma parcela na mesma linha', d: 'Valores conferem', sev: 'ok', neutro: true },
  { id: 'ok', t: 'Conferidas sem divergência', d: 'Valor pago − taxa cobrada = valor transferido', sev: 'ok', neutro: true },
  { id: 'outro_mes', t: 'Neste relatório, mas pago em outro mês', d: 'Conta na conferência do mês em que o comprador pagou', sev: 'gray', neutro: true, fora: true },
  { id: 'duplicada', t: 'Linha repetida em outro relatório', d: 'Já contada em outro envio; ignorada nos totais', sev: 'warn', neutro: true, fora: true },
  { id: 'aguardando', t: 'Aguardando relatório', d: 'Pagamentos do mês ainda sem relatório da contabilidade', sev: 'gray', neutro: true, fora: true },
];
const CATMAP = Object.fromEntries(CONF_CATS.map((c) => [c.id, c]));
const ultimoDia = (mes) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const nomeMesCurto = (mes) => `${MESES[+mes.slice(5) - 1]}/${mes.slice(0, 4)}`;
const pctTxt = (x) => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

// linhas de todos os relatórios ativos, com a duplicidade marcada e o mês esperado
function linhasRelatorios(model) {
  const vistas = new Map(); const out = [];
  for (const r of model.repasses.filter((x) => !x.substituido).sort((a, b) => a.id - b.id)) {
    for (const l of r.linhas) {
      const chave = [l.tipo, l.contrato_id, (l.parcelas || []).join('+'), l.data_credito || '', cents(l.valor), cents(l.honorario), l.referencia || ''].join('|');
      const dup = vistas.get(chave);
      if (!dup) vistas.set(chave, { l, r });
      const c = model.cmap.get(Number(l.contrato_id));
      const ps = l.tipo === 'credito' ? (l.parcelas || []).map((n) => c?.parcelas.find((p) => p.numero === n)) : [];
      const pagoEm = ps.every(Boolean) ? ps.flatMap((p) => p.ativos.map((g) => g.data_pagamento)).sort()[0] || '' : '';
      out.push({ l, r, c, ps, pagoEm, mesEsperado: (pagoEm || r.mes + '-01').slice(0, 7), duplicadaDe: dup ? dup.r : null });
    }
  }
  return out;
}

export function mesesConferencia(model) {
  const s = new Set(model.repasses.filter((r) => !r.substituido).map((r) => r.mes));
  for (const p of model.parcelas) if (p.elegivel) for (const g of p.ativos) s.add(g.data_pagamento.slice(0, 7));
  s.add(model.hoje.slice(0, 7));
  return [...s].sort().reverse();
}

// taxa média = soma das taxas / soma das bases (cada parcela pesa pelo seu valor)
function taxaMedia(linhas) {
  const ok = linhas.filter((x) => x.base > 0 && x.taxa >= 0);
  const base = ok.reduce((s, x) => s + x.base, 0), taxa = ok.reduce((s, x) => s + x.taxa, 0);
  return { media: base ? taxa / base : null, base, taxa, n: ok.length };
}

export function conferencia(model, mes) {
  const todas = linhasRelatorios(model);
  const repsMes = model.repasses.filter((r) => !r.substituido && r.mes === mes);
  const temRelatorioProprio = repsMes.length > 0;
  const coberta = new Set();
  for (const x of todas) if (x.l.tipo === 'credito' && !x.duplicadaDe) for (const n of x.l.parcelas || []) coberta.add(`${x.l.contrato_id}-${n}`);
  const itens = [];
  const base0 = (x) => ({ id: 'L' + x.l.id, linha: x.l, repasse: x.r, contrato: x.c, ctr: String(x.l.contrato_id || '—'), lote: x.c?.lote || '—', comprador: x.c?.comprador?.nome || x.l.comprador || '—',
    parcelasTxt: (x.l.parcelas || []).join(' e '), data_credito: x.l.data_credito, vencimento: x.l.vencimento, resolvido: x.l.resolvido, resolucao: x.l.resolucao, pagoEm: x.pagoEm });

  // 1) créditos esperados neste mês (pelo pagamento) — em qualquer relatório
  for (const x of todas.filter((x) => x.l.tipo === 'credito')) {
    const inf = cents(x.l.valor), taxa = cents(x.l.honorario), baseRel = inf + taxa, b = base0(x);
    const doMes = x.mesEsperado === mes, relDoMes = x.r.mes === mes;
    if (!doMes && !relDoMes) continue;
    if (x.duplicadaDe) { if (relDoMes) itens.push({ ...b, cat: 'duplicada', esp: 0, inf: 0, dif: 0, base: baseRel, taxa, why: `Esta linha (contrato ${b.ctr}, parcela ${b.parcelasTxt}, ${brl(inf)}) já aparece no relatório "${x.duplicadaDe.titulo || x.duplicadaDe.arquivo_nome}". Foi contada uma vez só.` }); continue; }
    if (!doMes) { itens.push({ ...b, cat: 'outro_mes', esp: 0, inf: 0, dif: 0, base: baseRel, taxa, mesOutro: x.mesEsperado, why: `O comprador pagou em ${fmtD(x.pagoEm)}. Esta linha conta na conferência de ${nomeMesCurto(x.mesEsperado)}, mês do pagamento.` }); continue; }
    if (!x.c || x.ps.some((p) => !p)) {
      itens.push({ ...b, cat: 'sem_parcela', esp: 0, inf, dif: inf, base: baseRel, taxa, why: `O relatório traz o contrato ${b.ctr}, parcela ${b.parcelasTxt}, mas ${x.c ? 'essa parcela não existe' : 'o contrato não está cadastrado'}. Importe ou atualize o contrato.` });
      continue;
    }
    const pago = x.ps.reduce((s, p) => s + p.rec, 0), semPag = pago === 0;
    const bruto = semPag ? baseRel : pago;
    const esp = bruto - taxa, dif = inf - esp;
    const padrao = x.c.valorPadrao * x.ps.length, encargo = !semPag && padrao > 0 ? bruto - padrao : 0;
    const rel = x.r.mes !== mes ? ` Veio no relatório de ${nomeMesCurto(x.r.mes)}.` : '';
    let cat, why;
    if (x.ps.some((p) => !p.elegivel)) { cat = 'fora_regra'; why = `A parcela ${b.parcelasTxt} está marcada como "${x.ps.map((p) => TIPO_PARCELA_LABEL[p.tipo]).join(', ')}", mas a contabilidade a repassou. Conferir o tipo da parcela.`; }
    else if (semPag) { cat = 'sem_pagamento'; why = `A contabilidade informou ${brl(baseRel)} pagos nesta parcela, mas o pagamento não consta no contrato. Reimporte o contrato ${b.ctr}.`; }
    else if (Math.abs(baseRel - pago) > 1) { cat = 'base_divergente'; why = `O comprador pagou ${brl(pago)}, mas o relatório usa ${brl(baseRel)} como base (taxa ${brl(taxa)} + transferido ${brl(inf)}). Diferença de ${brl(baseRel - pago)}.${rel}`; }
    else if (x.r.mes !== mes) { cat = 'recebido_outro'; why = `O comprador pagou em ${fmtD(x.pagoEm)}, e a contabilidade repassou no relatório de ${nomeMesCurto(x.r.mes)}. Vinculado a este mês.`; }
    else if (encargo > 1) { cat = 'encargo'; why = `O comprador pagou ${brl(encargo)} de juros/multa além da parcela (${brl(padrao)}). O encargo veio no repasse.`; }
    else if (x.ps.length > 1) { cat = 'agrupada'; why = `A contabilidade juntou ${x.ps.length} parcelas numa linha (${b.parcelasTxt}). Valores conferem.`; }
    else { cat = 'ok'; why = `Pago ${brl(bruto)} − taxa ${brl(taxa)} (${bruto ? pctTxt(taxa / bruto) : '—'}) = ${brl(esp)}, igual ao transferido.`; }
    itens.push({ ...b, cat, esp, inf, dif, bruto, base: baseRel, taxa, taxaPct: baseRel ? taxa / baseRel : null, encargo: Math.max(0, encargo), parcelas: x.ps, why });
  }
  // 2) outros descontos e débitos dos relatórios deste mês
  for (const x of todas.filter((x) => x.l.tipo !== 'credito' && x.r.mes === mes)) {
    const v = cents(x.l.valor), b = base0(x);
    if (x.duplicadaDe) { itens.push({ ...b, cat: 'duplicada', esp: 0, inf: 0, dif: 0, ref: x.l.referencia, why: `Desconto já lançado no relatório "${x.duplicadaDe.titulo || x.duplicadaDe.arquivo_nome}". Contado uma vez só.` }); continue; }
    const p = x.c?.parcelas.find((y) => y.numero === (x.l.parcelas || [])[0]);
    let why;
    if (x.l.tipo === 'debito') why = `Débito de ${brl(v)} lançado pela contabilidade no contrato ${b.ctr}, parcela ${b.parcelasTxt}. Conferir o motivo.`;
    else if (/diret/i.test(x.l.descricao || '') && p && p.tipo === 'direto') why = `${x.l.descricao} (${x.l.referencia}): ${brl(v)} sobre a parcela ${b.parcelasTxt}, paga direto ao vendedor${p.data_liquidacao_externa ? ' em ' + fmtD(p.data_liquidacao_externa) : ''}. O relatório não informa a base; pelo cadastro a parcela vale ${brl(x.c.valorPadrao)} (${x.c.valorPadrao ? pctTxt(v / x.c.valorPadrao) : '—'}). Desconto discriminado, fora da taxa média.`;
    else why = `${x.l.descricao || x.l.referencia} (${x.l.referencia}): ${brl(v)} no contrato ${b.ctr}, parcela ${b.parcelasTxt}. O relatório não informa a base de cálculo; desconto separado da taxa sobre as parcelas.`;
    itens.push({ ...b, cat: x.l.tipo === 'debito' ? 'debito' : 'outros_descontos', esp: 0, inf: -v, dif: 0, ajuste: v, desconto: v, decisao: x.l.decisao || null, decisaoNota: x.l.decisao_nota || null, ref: x.l.referencia, desc: x.l.descricao, parcelas: p ? [p] : [], why });
  }
  // 3) taxa média: do mês (créditos vinculados) e de cada relatório
  const creditosMes = itens.filter((i) => i.linha?.tipo === 'credito' && !CATMAP[i.cat].fora && i.base);
  const tm = taxaMedia(creditosMes);
  const nCreditosMes = itens.filter((i) => i.linha?.tipo === 'credito' && !CATMAP[i.cat].fora).length;
  const porRelatorio = repsMes.map((r) => { const ls = r.linhas.filter((l) => l.tipo === 'credito'); const t = taxaMedia(ls.map((l) => ({ base: cents(l.valor) + cents(l.honorario), taxa: cents(l.honorario) })));
    return { r, ...t, nLinhas: ls.length, semBase: r.linhas.filter((l) => l.tipo !== 'credito').length }; });
  // taxa predominante (mais frequente) para apontar parcelas fora do padrão
  const freq = new Map(); for (const i of creditosMes) { const k = Math.round(i.taxaPct * 10000) / 100; freq.set(k, (freq.get(k) || 0) + 1); }
  const predominante = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const foraPadrao = predominante == null ? [] : creditosMes.filter((i) => Math.abs(i.taxaPct * 100 - predominante) > 0.05);
  // 4) pagamentos do mês sem linha em nenhum relatório
  const mediaEstimativa = tm.media ?? (() => { const all = taxaMedia(todas.filter((x) => x.l.tipo === 'credito' && !x.duplicadaDe).map((x) => ({ base: cents(x.l.valor) + cents(x.l.honorario), taxa: cents(x.l.honorario) }))); return all.media; })();
  const temRelatorioPosterior = model.repasses.some((r) => !r.substituido && r.mes > mes);
  // períodos de crédito cobertos pelos relatórios ativos do mês (pagamentos que aparecem em algum relatório já foram tratados acima)
  // O crédito na contabilidade sai até 3 dias depois do pagamento: um pagamento só "deveria" estar num relatório
  // se foi feito entre o início do período e 3 dias antes do fim. Períodos encostados (quinzenas) são unidos.
  const diasAntes = (iso, n) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const periodos = repsMes.filter((r) => r.periodo_inicio && r.periodo_fim).map((r) => [r.periodo_inicio, r.periodo_fim]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .reduce((acc, p) => { const u = acc[acc.length - 1]; if (u && p[0] <= diasAntes(u[1], -4)) { if (p[1] > u[1]) u[1] = p[1]; } else acc.push([...p]); return acc; }, [])
    .map(([a, b]) => [a, diasAntes(b, 3)]);
  const maxFim = periodos.reduce((s, p) => (p[1] > s ? p[1] : s), '');
  const coberto = (d) => !periodos.length || periodos.some(([a, b]) => d >= a && d <= b);
  for (const p of model.parcelas) {
    if (!p.elegivel || p.contrato.arquivado || coberta.has(`${p.contrato_id}-${p.numero}`)) continue;
    for (const g of p.ativos) {
      if (g.data_pagamento.slice(0, 7) !== mes) continue;
      const bruto = g.valorC, taxaEst = mediaEstimativa != null ? Math.round(bruto * mediaEstimativa) : 0, esp = bruto - taxaEst;
      const fimDoMes = +g.data_pagamento.slice(8, 10) >= ultimoDia(mes) - 1;
      const d = g.data_pagamento;
      const lacuna = temRelatorioProprio && !coberto(d) && d < maxFim; // entre/antes dos períodos enviados: falta um relatório do mês
      const depois = temRelatorioProprio && !coberto(d) && d > maxFim && !temRelatorioPosterior; // fim do período: pode vir no próximo relatório
      const aguardando = !temRelatorioProprio || lacuna || depois || (fimDoMes && !temRelatorioPosterior);
      itens.push({ id: 'P' + g.id, contrato: p.contrato, ctr: String(p.contrato_id), lote: p.contrato.lote || '—', comprador: p.contrato.comprador.nome, parcelasTxt: String(p.numero),
        vencimento: p.vencimento, pagoEm: g.data_pagamento, data_credito: null, parcelas: [p], bruto, taxa: taxaEst, estimado: true, lacuna, cat: aguardando ? 'aguardando' : 'faltou',
        esp: aguardando ? 0 : esp, inf: 0, dif: aguardando ? 0 : -esp, espPrevisto: esp,
        why: aguardando
          ? (!temRelatorioProprio ? `Pago em ${fmtD(g.data_pagamento)}. Ainda não há relatório da contabilidade para ${nomeMesCurto(mes)}.` : lacuna || depois ? `Pago em ${fmtD(d)}, fora do período dos relatórios enviados (${repsMes.map((r) => fmtD(r.periodo_inicio) + ' a ' + fmtD(r.periodo_fim)).join('; ')}). Aguarda o relatório que cobre essa data.` : `Pago em ${fmtD(g.data_pagamento)}, no fim do mês: pode vir no próximo relatório.`)
          : `O comprador pagou ${brl(bruto)} em ${fmtD(g.data_pagamento)}, mas a parcela não aparece em nenhum relatório. Esperado: ${brl(esp)}${mediaEstimativa != null ? ` (estimado com a taxa média de ${pctTxt(mediaEstimativa)})` : ''}.` });
    }
  }
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const conta = itens.filter((i) => !CATMAP[i.cat].fora);
  const cats = CONF_CATS.map((c) => { const ls = itens.filter((i) => i.cat === c.id); return { ...c, itens: ls, qtd: ls.length, dif: sum(ls, (i) => i.dif) }; }).filter((c) => c.qtd);
  const res = {
    mes, reps: repsMes, itens, cats,
    esperado: sum(conta, (i) => i.esp), informado: sum(conta, (i) => i.inf),
    bruto: sum(conta.filter((i) => i.bruto && i.cat !== 'sem_parcela'), (i) => i.bruto),
    taxas: sum(conta.filter((i) => i.linha?.tipo === 'credito'), (i) => i.taxa), taxasEstimadas: sum(conta.filter((i) => i.cat === 'faltou'), (i) => i.taxa),
    outrosDescontos: sum(conta.filter((i) => i.cat === 'outros_descontos' || i.cat === 'debito'), (i) => i.desconto || -i.inf),
    totalRelatoriosMes: sum(todas.filter((x) => x.r.mes === mes && !x.duplicadaDe), (x) => (x.l.tipo === 'credito' ? 1 : -1) * cents(x.l.valor)),
    linhasRepetidas: todas.filter((x) => x.r.mes === mes && x.duplicadaDe).length,
    deOutrosRelatorios: sum(conta.filter((i) => i.repasse && i.repasse.mes !== mes), (i) => i.inf),
    paraOutrosMeses: sum(itens.filter((i) => i.cat === 'outro_mes'), (i) => cents(i.linha.valor)),
    aguardando: sum(itens.filter((i) => i.cat === 'aguardando'), (i) => i.espPrevisto),
    encargos: sum(itens, (i) => i.encargo || 0),
    confirmadoConta: sum(repsMes.filter((r) => r.extrato_status === 'confirmado'), (r) => cents(r.extrato_valor)),
    taxaMedia: tm.media, taxaCobertura: { n: tm.n, total: nCreditosMes, semBase: itens.filter((i) => i.cat === 'outros_descontos').length },
    porRelatorio, predominante, foraPadrao,
  };
  // ajustes que a própria contabilidade discrimina no relatório (SPC, honorários, tarifas, débitos):
  // aparecem à parte e não contam como diferença; você aceita ou contesta cada um no fechamento.
  res.ajustes = res.outrosDescontos;
  res.ajustesItens = itens.filter((i) => CATMAP[i.cat].ajuste);
  res.ajustesPendentes = res.ajustesItens.filter((i) => !i.decisao).length;
  res.ajustesContestados = res.ajustesItens.filter((i) => i.decisao === 'contestado');
  res.esperadoAposAjustes = res.esperado - res.ajustes;
  res.difBruta = res.informado - res.esperado; // diferença antes de separar os ajustes
  res.dif = res.informado - res.esperadoAposAjustes; // diferença real, sem explicação no relatório
  res.pendencias = itens.filter((i) => !CATMAP[i.cat].neutro && !CATMAP[i.cat].ajuste && !i.resolvido).length;
  res.problemas = cats.filter((c) => !c.neutro && !c.ajuste);
  // o Painel ("Pago pelos compradores") soma o valor bruto de todos os pagamentos elegíveis do mês
  res.painelMes = sum(model.parcelas.filter((p) => p.elegivel && !p.contrato.arquivado).flatMap((p) => p.ativos.filter((g) => g.data_pagamento.slice(0, 7) === mes)), (g) => g.valorC);
  // períodos de crédito do mês sem relatório (ex.: falta a 2ª quinzena)
  const ult = ultimoDia(mes), iso = (d) => `${mes}-${String(d).padStart(2, '0')}`;
  const dia = (s) => (s.slice(0, 7) < mes ? 0 : s.slice(0, 7) > mes ? ult + 1 : +s.slice(8, 10));
  const faixas = repsMes.filter((r) => r.periodo_inicio && r.periodo_fim).map((r) => [dia(r.periodo_inicio), dia(r.periodo_fim)]).sort((a, b) => a[0] - b[0]);
  const fimMesPassou = model.hoje > iso(ult);
  res.periodosFaltando = [];
  if (faixas.length) {
    let cur = 1;
    for (const [a, b] of faixas) { if (a - cur > 3) res.periodosFaltando.push({ de: iso(cur), ate: iso(Math.min(a - 1, ult)) }); cur = Math.max(cur, b + 1); }
    if (ult - cur >= 3 && fimMesPassou) res.periodosFaltando.push({ de: iso(Math.min(cur, ult)), ate: iso(ult) });
  }
  res.extrato = !repsMes.length ? 'sem_relatorio' : repsMes.every((r) => r.extrato_status === 'confirmado') ? 'confirmado' : repsMes.some((r) => r.extrato_status === 'divergente') ? 'divergente' : 'pendente';
  // recebimento do arquivo x resultado da conferência
  const faltamDados = itens.some((i) => ['sem_parcela', 'sem_pagamento'].includes(i.cat) && !i.resolvido) || res.taxaCobertura.n < res.taxaCobertura.total || itens.some((i) => i.lacuna) || res.periodosFaltando.length > 0;
  res.lacunas = itens.filter((i) => i.lacuna).length;
  res.taxaEstimativa = mediaEstimativa;
  res.conciliacao = !repsMes.length ? 'aguardando' : faltamDados ? 'faltam_dados' : res.dif === 0 && !res.pendencias ? 'bateu' : 'divergencia';
  res.status = repsMes.length ? 'enviado' : 'aguardando';
  res.linhasDeOutros = conta.some((i) => i.linha) && !repsMes.length;
  res.mudancaRegra = regraAnterior(model, mes, res);
  return res;
}
export { pctTxt };
// ---------------------------------------------------------------------------
// Comparação com o cálculo anterior (taxa fixa de 4% e mês pela data de crédito)
// Mostra quais parcelas, datas ou taxas mudaram o resultado.
// ---------------------------------------------------------------------------
function regraAnterior(model, mes, conf) {
  if (!conf.reps.length) return null;
  const PCT = 0.04, h = (c) => Math.round(c * PCT);
  let esp = 0, inf = 0;
  // cada linha conta uma vez, mesmo que o arquivo tenha sido enviado de novo
  const vistas = new Set();
  for (const r of conf.reps.slice().sort((a, b) => a.id - b.id)) {
    for (const l of r.linhas) {
      const chave = [l.tipo, l.contrato_id, (l.parcelas || []).join('+'), l.data_credito || '', cents(l.valor), cents(l.honorario), l.referencia || ''].join('|');
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      inf += (l.tipo === 'credito' ? 1 : -1) * cents(l.valor);
      const c = model.cmap.get(Number(l.contrato_id));
      if (l.tipo === 'credito') {
        const ps = (l.parcelas || []).map((n) => c?.parcelas.find((p) => p.numero === n));
        const base = cents(l.valor) + cents(l.honorario);
        const bruto = c && ps.every(Boolean) && ps.reduce((s, p) => s + p.rec, 0) > 0 ? ps.reduce((s, p) => s + p.rec, 0) : (c && ps.every(Boolean) ? base : 0);
        esp += bruto ? bruto - h(bruto) : 0;
      } else if (l.tipo === 'taxa' && /diret/i.test(l.descricao || '')) {
        const p = c?.parcelas.find((y) => y.numero === (l.parcelas || [])[0]);
        if (p && p.tipo === 'direto') esp -= h(c.valorPadrao);
      }
    }
  }
  const antigo = { esperado: esp, informado: inf, dif: inf - esp };
  const grupos = [];
  const movidas = conf.itens.filter((i) => i.cat === 'outro_mes');
  if (movidas.length) {
    const efeito = movidas.reduce((s, i) => { const b = i.base; return s - (cents(i.linha.valor) - (b - h(b))); }, 0);
    grupos.push({ t: 'Parcelas pagas em outro mês', d: 'Antes contavam no mês do crédito na contabilidade; agora contam no mês em que o comprador pagou.', efeito,
      itens: movidas.map((i) => `Contrato ${i.ctr}, parcela ${i.parcelasTxt}: paga em ${fmtD(i.pagoEm)}, creditada em ${fmtD(i.data_credito)} → vai para ${nomeMesCurto(i.mesOutro)} (${brl(cents(i.linha.valor))} transferidos)`) });
  }
  const taxas = conf.itens.filter((i) => i.linha?.tipo === 'credito' && !CATMAP[i.cat].fora && i.base && i.taxa !== h(i.base));
  if (taxas.length) {
    const efeito = taxas.reduce((s, i) => s + (i.taxa - h(i.base)), 0);
    grupos.push({ t: 'Taxa cobrada diferente de 4%', d: 'Antes a diferença para 4% contava como valor faltando; agora a taxa do relatório é usada e entra na taxa média.', efeito,
      itens: taxas.map((i) => `Contrato ${i.ctr}, parcela ${i.parcelasTxt}: taxa ${brl(i.taxa)} (${pctTxt(i.taxaPct)}) sobre ${brl(i.base)}; 4% seriam ${brl(h(i.base))}`) });
  }
  const diretos = conf.itens.filter((i) => i.cat === 'outros_descontos' && /diret/i.test(i.desc || '') && i.parcelas?.[0]?.tipo === 'direto');
  if (diretos.length) {
    const efeito = -diretos.reduce((s, i) => s + h(i.contrato.valorPadrao), 0);
    grupos.push({ t: 'Honorário sobre pagamento direto', d: 'Antes era descontado do valor esperado como previsto; agora aparece como outro desconto da contabilidade, sem base no relatório.', efeito,
      itens: diretos.map((i) => `Contrato ${i.ctr}, parcela ${i.parcelasTxt}: ${brl(i.desconto)} (${i.desc})`) });
  }
  if (conf.ajustes) grupos.push({ t: 'Ajustes informados pela contabilidade separados da diferença', d: 'Descontos que o próprio relatório discrimina saem da diferença e ficam para você aceitar ou contestar.', efeito: conf.ajustes,
    itens: conf.ajustesItens.map((i) => `Contrato ${i.ctr}, parcela ${i.parcelasTxt}: ${brl(i.ajuste)} (${i.ref}${i.desc ? ' · ' + i.desc : ''})`) });
  const explicado = grupos.reduce((s, g) => s + g.efeito, 0);
  return { antigo, grupos, explicado, resto: conf.dif - antigo.dif - explicado };
}