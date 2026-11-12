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

  // relatórios de repasse da MECOB
  const linhasPorRep = new Map();
  for (const l of raw.repasse_linhas || []) { if (!linhasPorRep.has(l.repasse_id)) linhasPorRep.set(l.repasse_id, []); linhasPorRep.get(l.repasse_id).push(l); }
  const repasses = (raw.repasses || []).map((r) => ({ ...r, linhas: (linhasPorRep.get(r.id) || []).sort((a, b) => a.id - b.id) }))
    .sort((a, b) => (a.periodo_inicio || '').localeCompare(b.periodo_inicio || '') || a.id - b.id);
  const cfg = Object.fromEntries((raw.config || []).map((x) => [x.chave, x.valor]));
  const honorarioPct = Number(String(cfg.honorario_pct ?? '4').replace(',', '.')) || 4;

  return { hoje, contratos, cmap, parcelas, pagamentos, repasses, honorarioPct, leiloes: [...leiloes.values()], compradores: [...compradores.values()] };
}

// entrada (parcela 1) | cadastro ("Liquidada no cadastro") | direto (pago ao vendedor) | mecob (repassado pela MECOB)
export const TIPO_PARCELA_LABEL = { entrada: 'Entrada (direto à SM)', cadastro: 'Liquidada no cadastro', direto: 'Paga direto ao vendedor', mecob: 'Cobrança MECOB' };
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
// CONFERÊNCIA DO REPASSE MECOB (por mês)
//  - Mês do repasse = mês em que o dinheiro caiu na MECOB (coluna "Crédito" do relatório).
//    Pagamento sem linha no relatório: usa a data de pagamento registrada.
//  - Esperado por parcela = valor pago pelo comprador − honorário (padrão 4%).
//  - Entrada, "Liquidada no cadastro" e pagas direto ao vendedor ficam fora; sobre as pagas
//    direto, a MECOB cobra honorário (desconto esperado = % sobre o valor padrão da parcela).
// ===========================================================================
export const CONF_CATS = [
  { id: 'taxa_maior', t: 'Honorário acima do percentual', d: 'A MECOB descontou mais que o honorário combinado', sev: 'bad' },
  { id: 'taxa_menor', t: 'Honorário abaixo do percentual', d: 'A MECOB descontou menos que o honorário combinado', sev: 'warn' },
  { id: 'faltou', t: 'Pago pelo comprador, fora do relatório', d: 'Pagamento registrado no mês que não aparece em nenhum relatório', sev: 'bad' },
  { id: 'sem_regra', t: 'Taxa sem regra documentada', d: 'Desconto avulso fora do honorário', sev: 'bad' },
  { id: 'debito', t: 'Débito no relatório', d: 'Valor debitado pela MECOB', sev: 'bad' },
  { id: 'taxa_direto_dif', t: 'Honorário de pagamento direto diferente', d: 'Honorário sobre pagamento direto fora do percentual', sev: 'warn' },
  { id: 'sem_parcela', t: 'Linha sem parcela no cadastro', d: 'Contrato ou parcela do relatório não encontrado: cadastre ou reimporte o contrato', sev: 'bad' },
  { id: 'sem_pagamento', t: 'Pagamento não registrado no contrato', d: 'A MECOB informou o pagamento, mas ele não consta no extrato de contratos importado', sev: 'warn' },
  { id: 'fora_regra', t: 'Parcela que deveria ficar fora', d: 'Entrada, liquidada no cadastro ou paga direto que apareceu como crédito', sev: 'warn' },
  { id: 'arred', t: 'Arredondamento', d: 'Diferença de centavos no cálculo do honorário', sev: 'warn' },
  { id: 'direto', t: 'Honorário de pagamento direto (previsto)', d: 'Desconto esperado sobre parcela paga direto ao vendedor', sev: 'info', neutro: true },
  { id: 'mes_anterior', t: 'Pago no mês anterior, creditado neste', d: 'Entrou neste mês pela data de crédito na MECOB', sev: 'gold', neutro: true },
  { id: 'encargo', t: 'Juros e multa repassados', d: 'Comprador pagou com atraso; encargo repassado com o mesmo desconto', sev: 'info', neutro: true },
  { id: 'agrupada', t: 'Mais de uma parcela na mesma linha', d: 'Valores conferem', sev: 'ok', neutro: true },
  { id: 'ok', t: 'Conferidas sem divergência', d: 'Valor pago − honorário = valor informado', sev: 'ok', neutro: true },
  { id: 'aguardando', t: 'Aguardando relatório', d: 'Pagamentos do fim do mês ou de mês ainda sem relatório: não entram no esperado', sev: 'gray', neutro: true, fora: true },
];
const CATMAP = Object.fromEntries(CONF_CATS.map((c) => [c.id, c]));
const ultimoDia = (mes) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const proxMes = (mes) => { let [y, m] = mes.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };

export function mesesConferencia(model) {
  const s = new Set(model.repasses.filter((r) => !r.substituido).map((r) => r.mes));
  for (const p of model.parcelas) if (p.elegivel) for (const g of p.ativos) s.add(g.data_pagamento.slice(0, 7));
  s.add(model.hoje.slice(0, 7));
  return [...s].sort().reverse();
}

export function conferencia(model, mes) {
  const pct = model.honorarioPct / 100;
  const hon = (c) => Math.round(c * pct);
  const ativos = model.repasses.filter((r) => !r.substituido);
  const reps = ativos.filter((r) => r.mes === mes);
  const temProx = ativos.some((r) => r.mes === proxMes(mes));
  // parcelas já cobertas por qualquer relatório (qualquer mês)
  const coberta = new Map();
  for (const r of ativos) for (const l of r.linhas) if (l.tipo === 'credito') for (const n of l.parcelas || []) coberta.set(`${l.contrato_id}-${n}`, r.mes);
  const itens = [];
  for (const r of reps) for (const l of r.linhas) {
    const c = model.cmap.get(Number(l.contrato_id));
    const base = { id: 'L' + l.id, linha: l, repasse: r, contrato: c, ctr: String(l.contrato_id || '—'), lote: c?.lote || '—', comprador: c?.comprador?.nome || l.comprador || '—',
      parcelasTxt: (l.parcelas || []).join(' e '), data_credito: l.data_credito, vencimento: l.vencimento, resolvido: l.resolvido, resolucao: l.resolucao };
    const vInf = cents(l.valor), hInf = cents(l.honorario);
    if (l.tipo === 'credito') {
      const ps = (l.parcelas || []).map((n) => c?.parcelas.find((p) => p.numero === n));
      if (!c || ps.some((p) => !p)) {
        itens.push({ ...base, cat: 'sem_parcela', esp: 0, inf: vInf, dif: vInf, bruto: vInf + hInf, honInf: hInf, honEsp: 0,
          why: `O relatório traz o contrato ${l.contrato_id}, parcela ${base.parcelasTxt}, mas ${c ? 'essa parcela não existe' : 'o contrato não está cadastrado'} no Recebimentos. Importe ou atualize o contrato.` });
        continue;
      }
      const pags = ps.flatMap((p) => p.ativos);
      let bruto = ps.reduce((s, p) => s + p.rec, 0); const semPag = bruto === 0;
      if (semPag) bruto = vInf + hInf;
      const honEsp = hon(bruto), esp = bruto - honEsp, dif = vInf - esp;
      const padrao = c.valorPadrao * ps.length, encargo = !semPag && padrao > 0 ? bruto - padrao : 0;
      const pagoEm = pags.map((g) => g.data_pagamento).sort()[0] || '';
      const pctInf = bruto ? (hInf / bruto * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—';
      let cat, why;
      if (ps.some((p) => !p.elegivel)) { cat = 'fora_regra'; why = `A parcela ${base.parcelasTxt} está marcada como "${ps.map((p) => TIPO_PARCELA_LABEL[p.tipo]).join(', ')}", mas a MECOB a repassou. Conferir o tipo da parcela.`; }
      else if (hInf - honEsp > 1) { cat = 'taxa_maior'; why = `A MECOB descontou ${brl(hInf)} de honorário (${pctInf}%). Com ${model.honorarioPct}%, seriam ${brl(honEsp)}. Faltaram ${brl(-dif)} no repasse.`; }
      else if (honEsp - hInf > 1) { cat = 'taxa_menor'; why = `A MECOB descontou ${brl(hInf)} de honorário (${pctInf}%), menos que os ${model.honorarioPct}% (${brl(honEsp)}).`; }
      else if (dif !== 0) { cat = 'arred'; why = `Honorário de ${brl(hInf)}; ${model.honorarioPct}% exatos dariam ${brl(honEsp)}. Diferença de ${brl(Math.abs(dif))} por arredondamento.`; }
      else if (semPag) { cat = 'sem_pagamento'; why = `A MECOB informou o pagamento desta parcela, mas ele ainda não consta no extrato de contratos importado. Reimporte o extrato do contrato ${l.contrato_id}.`; }
      else if (pagoEm && pagoEm < mes + '-01') { cat = 'mes_anterior'; why = `O comprador pagou em ${fmtD(pagoEm)}, mas o dinheiro só caiu na MECOB em ${fmtD(l.data_credito)}. Por isso entrou no repasse de ${MESES[+mes.slice(5) - 1]}/${mes.slice(0, 4)}.`; }
      else if (encargo > 1) { cat = 'encargo'; why = `O comprador pagou ${brl(encargo)} de juros/multa além do valor da parcela (${brl(padrao)}). A MECOB repassou o encargo com o mesmo desconto.`; }
      else if (ps.length > 1) { cat = 'agrupada'; why = `A MECOB juntou ${ps.length} parcelas numa linha (${base.parcelasTxt}). Valores conferem.`; }
      else { cat = 'ok'; why = `Pago ${brl(bruto)} − ${model.honorarioPct}% (${brl(honEsp)}) = ${brl(esp)}, igual ao informado.`; }
      itens.push({ ...base, cat, esp, inf: vInf, dif, bruto, honInf: hInf, honEsp, encargo: Math.max(0, encargo), pagoEm, parcelas: ps, why });
    } else if (l.tipo === 'taxa') {
      const p = c?.parcelas.find((x) => x.numero === (l.parcelas || [])[0]);
      const ehDireto = /hon/i.test(l.referencia || '') && /diret/i.test(l.descricao || '') && p && p.tipo === 'direto';
      if (ehDireto) {
        const esp = -hon(c.valorPadrao), dif = -vInf - esp;
        itens.push({ ...base, cat: Math.abs(dif) <= 1 ? 'direto' : 'taxa_direto_dif', esp, inf: -vInf, dif, taxa: vInf, ref: l.referencia, desc: l.descricao, parcelas: [p],
          why: `A parcela ${base.parcelasTxt} (${brl(c.valorPadrao)}) foi paga direto ao vendedor${p.data_liquidacao_externa ? ' em ' + fmtD(p.data_liquidacao_externa) : ''}. Não entra no repasse, mas a MECOB cobra ${model.honorarioPct}% sobre ela: ${brl(-esp)} esperado, ${brl(vInf)} cobrado.` });
      } else {
        itens.push({ ...base, cat: 'sem_regra', esp: 0, inf: -vInf, dif: -vInf, taxa: vInf, ref: l.referencia, desc: l.descricao, parcelas: p ? [p] : [],
          why: `${l.descricao || l.referencia} (${l.referencia}) de ${brl(vInf)} no contrato ${l.contrato_id}, parcela ${base.parcelasTxt}. Não faz parte do honorário e não há regra documentada. Conferir com a MECOB.` });
      }
    } else {
      itens.push({ ...base, cat: 'debito', esp: 0, inf: -vInf, dif: -vInf, why: `Débito de ${brl(vInf)} lançado pela MECOB no contrato ${l.contrato_id}, parcela ${base.parcelasTxt}. Conferir o motivo.` });
    }
  }
  // pagamentos do mês que não apareceram em nenhum relatório
  for (const p of model.parcelas) {
    if (!p.elegivel || p.contrato.arquivado || coberta.has(`${p.contrato_id}-${p.numero}`)) continue;
    for (const g of p.ativos) {
      if (g.data_pagamento.slice(0, 7) !== mes) continue;
      const bruto = g.valorC, esp = bruto - hon(bruto);
      const fimDoMes = +g.data_pagamento.slice(8, 10) >= ultimoDia(mes) - 1;
      const aguardando = !reps.length || (fimDoMes && !temProx);
      itens.push({ id: 'P' + g.id, contrato: p.contrato, ctr: String(p.contrato_id), lote: p.contrato.lote || '—', comprador: p.contrato.comprador.nome, parcelasTxt: String(p.numero),
        vencimento: p.vencimento, pagoEm: g.data_pagamento, data_credito: null, parcelas: [p], bruto, honEsp: hon(bruto), cat: aguardando ? 'aguardando' : 'faltou',
        esp: aguardando ? 0 : esp, inf: 0, dif: aguardando ? 0 : -esp, espPrevisto: esp,
        why: aguardando
          ? (!reps.length ? `Pago em ${fmtD(g.data_pagamento)}. Ainda não há relatório da MECOB para este mês.` : `Pago em ${fmtD(g.data_pagamento)}, no fim do mês: o crédito pode cair na MECOB no mês seguinte e vir no próximo relatório.`)
          : `O comprador pagou ${brl(bruto)} em ${fmtD(g.data_pagamento)}, mas a parcela não aparece em nenhum relatório da MECOB. Esperado: ${brl(esp)}.` });
    }
  }
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const conta = itens.filter((i) => !CATMAP[i.cat].fora);
  const cats = CONF_CATS.map((c) => { const ls = itens.filter((i) => i.cat === c.id); return { ...c, itens: ls, qtd: ls.length, dif: sum(ls, (i) => i.dif) }; }).filter((c) => c.qtd);
  const creditos = itens.filter((i) => i.linha?.tipo === 'credito');
  const res = {
    mes, reps, itens, cats,
    esperado: sum(conta, (i) => i.esp), informado: sum(reps, (r) => cents(r.valor_final)),
    bruto: sum(creditos, (i) => i.bruto) + sum(itens.filter((i) => i.cat === 'faltou'), (i) => i.bruto),
    honEsp: sum(creditos, (i) => i.honEsp) + sum(itens.filter((i) => i.cat === 'faltou'), (i) => i.honEsp),
    honInf: sum(creditos, (i) => i.honInf), taxasInf: sum(reps, (r) => cents(r.taxas)), debitosInf: sum(reps, (r) => cents(r.debitos)),
    diretoEsp: -sum(itens.filter((i) => i.cat === 'direto' || i.cat === 'taxa_direto_dif'), (i) => i.esp),
    aguardando: sum(itens.filter((i) => i.cat === 'aguardando'), (i) => i.espPrevisto),
    encargos: sum(itens, (i) => i.encargo || 0),
  };
  res.dif = res.informado - res.esperado;
  res.somaLinhas = sum(conta, (i) => i.inf);
  res.pendencias = itens.filter((i) => !CATMAP[i.cat].neutro && !i.resolvido).length;
  res.problemas = cats.filter((c) => !c.neutro);
  res.extrato = !reps.length ? 'sem_relatorio' : reps.every((r) => r.extrato_status === 'confirmado') ? 'confirmado' : reps.some((r) => r.extrato_status === 'divergente') ? 'divergente' : 'pendente';
  res.status = !reps.length ? 'sem_relatorio' : res.pendencias ? 'pendencias' : 'fechado';
  return res;
}