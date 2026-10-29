/* SM-BUILD: genealogia-v8-2026-10-29 */
import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, LineChart, Line,
} from "recharts";
import { supabase } from "./supabase";
import * as XLSX from "xlsx-js-style";

/* =========================================================================
   SM SISTEMA — Gestão de Gado de Elite  (compra por cotas)
   ========================================================================= */

/* ------------------------------ utilidades ----------------------------- */
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (n) => BRL.format(Number(n || 0));
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
function num(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "string") v = v.replace(/\s/g, "").replace(/%/g, "").replace(",", ".");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
const lc = (v) => (v ?? "").toString().toLowerCase();
const norm = (v) => (v ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const dataBR = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("pt-BR") : "—");

/* Tradução de erros comuns do Supabase Auth */
function traduzErro(msg) {
  const m = lc(msg);
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Este e-mail já possui cadastro. Use 'Entrar'.";
  if (m.includes("password should be at least")) return "A senha deve ter ao menos 6 caracteres.";
  if (m.includes("invalid email") || m.includes("validate email")) return "Informe um e-mail válido.";
  if (m.includes("email not confirmed")) return "E-mail ainda não confirmado. Confira sua caixa de entrada (ou peça ao administrador para desativar a confirmação de e-mail no Supabase).";
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
  if (m.includes("network") || m.includes("fetch")) return "Falha de conexão. Verifique sua internet.";
  return msg || "Erro inesperado. Tente novamente.";
}
function addMonths(s, n) {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function idade(nasc) {
  if (!nasc) return "—";
  const d = new Date(nasc), h = new Date();
  let a = h.getFullYear() - d.getFullYear(), m = h.getMonth() - d.getMonth();
  if (h.getDate() < d.getDate()) m--;
  if (m < 0) { a--; m += 12; }
  if (a < 0) return "—";
  return a > 0 ? `${a}a ${m}m` : `${m} meses`;
}
function mesesDe(nasc) {
  if (!nasc) return null;
  const d = new Date(nasc), h = new Date();
  let m = (h.getFullYear() - d.getFullYear()) * 12 + (h.getMonth() - d.getMonth());
  if (h.getDate() < d.getDate()) m--;
  return m < 0 ? null : m;
}
// idade em anos e meses completos, calculada na data de geração (sem arredondar).
// Lê a data por partes (aaaa-mm-dd) para não sofrer com fuso horário.
function idadeTexto(nasc) {
  if (!nasc) return "";
  const p = String(nasc).slice(0, 10).split("-").map(Number);
  const [y, mo, da] = p;
  if (!y || !mo || !da) return "";
  const h = new Date();
  let m = (h.getFullYear() - y) * 12 + (h.getMonth() + 1 - mo);
  if (h.getDate() < da) m--;
  if (m < 0) return "";
  const anos = Math.floor(m / 12), meses = m % 12;
  const ya = anos === 1 ? "1 ano" : `${anos} anos`;
  const ma = meses === 1 ? "1 mês" : `${meses} meses`;
  if (anos > 0 && meses > 0) return `${ya} e ${ma}`;
  if (anos > 0) return ya;        // anos exatos → só anos
  return ma;                      // menos de 1 ano → só meses
}
// dias entre duas datas ISO (aaaa-mm-dd)
function diasEntre(a, b) {
  if (!a || !b) return null;
  const d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}
// pesagens ordenadas por data, com GMD (kg/dia) entre pesagens consecutivas
function pesagensCalc(a) {
  const lista = (a && a.pesagens || []).filter((p) => p && p.data && num(p.peso) > 0)
    .slice().sort((x, y) => (x.data || "").localeCompare(y.data || ""));
  return lista.map((p, i) => {
    let gmd = null, dias = null;
    if (i > 0) {
      const ant = lista[i - 1];
      dias = diasEntre(ant.data, p.data);
      if (dias && dias > 0) gmd = Math.round(((num(p.peso) - num(ant.peso)) / dias) * 1000) / 1000;
    }
    return { ...p, peso: num(p.peso), gmd, dias, ordem: i + 1 };
  });
}
/* Fase automática da fêmea: Bezerra (0–12m), Novilha (13–35m), Matriz (36m+ ou após 1º parto registrado) */
function faseAnimal(a, ativos) {
  if (!a || a.tipo !== "animal") return null;
  if ((a.sexo || "").toLowerCase() !== "fêmea") return null;
  const parida = (ativos || []).some((x) => x && x.tipo === "prenhez" && lc(x.status) === "parida" && x.doadora && a.nome && lc(x.doadora) === lc(a.nome));
  if (parida) return "Matriz";
  const m = mesesDe(a.nascimento);
  if (m == null) return null;
  if (m <= 12) return "Bezerra";
  if (m <= 35) return "Novilha";
  return "Matriz";
}

/* ------------------------ motor financeiro (cotas) --------------------- */
function comissaoCalc(a) {
  a = a || {};
  const valor = num(a.valorParcela);
  const qtd = Math.max(0, Math.round(num(a.parcelas)));
  const pct = a.comissaoPct === "" || a.comissaoPct == null ? 8 : num(a.comissaoPct);
  const cota = valor * qtd;                       // valor total da minha compra = parcela × quantidade
  // A comissão incide SEMPRE sobre o valor total da minha compra, nunca sobre o valor total estimado do animal.
  return { pct, base: "Valor total da minha compra", total: cota * pct / 100 };
}
/* gera/atualiza parcelas preservando pagamentos; auto-paga vencidas se marcado */
function ensureParcelas(a) {
  a = a || {};
  const qtd = Math.max(0, Math.round(num(a.parcelas)));
  const valor = num(a.valorParcela);
  const prev = a.parcelasList || [];
  const hoje = today();
  const list = [];
  for (let i = 0; i < qtd; i++) {
    const p = prev[i] || {};
    const venc = addMonths(a.primeiroVenc, i);
    let valorPago = p.valorPago != null ? num(p.valorPago) : (p.pago ? valor : 0);
    let isAuto = false;
    let dataPagamento = p.dataPagamento || "";
    // toda parcela com vencimento já ocorrido (ou hoje) é considerada paga automaticamente pela data atual
    if (venc && venc <= hoje) { valorPago = valor; isAuto = true; dataPagamento = venc; }
    if (valorPago === 0) dataPagamento = "";
    list.push({ numero: i + 1, venc, valor, valorPago, auto: isAuto, dataPagamento, socio: p.socio || "", comprovante: p.comprovante || "", obs: p.obs || "" });
  }
  return list;
}
const parcStatus = (p) => (num(p.valorPago) >= p.valor && p.valor > 0 ? "pago" : num(p.valorPago) > 0 ? "parcial" : p.venc && p.venc < today() ? "vencido" : "aberto");
/* parcelas de uma compra de participação adicional (não mexe nas parcelas originais) */
function parcelasCompraAdic(c) {
  c = c || {};
  const qtd = Math.max(0, Math.round(num(c.parcelas)));
  const valor = num(c.valorParcela);
  const prev = c.parcelasList || [];
  const hoje = today();
  const list = [];
  for (let i = 0; i < qtd; i++) {
    const p = prev[i] || {};
    const venc = addMonths(c.dataInicial, i);
    let valorPago = p.valorPago != null ? num(p.valorPago) : 0;
    let isAuto = false; let dataPagamento = p.dataPagamento || "";
    if (venc && venc <= hoje) { valorPago = valor; isAuto = true; dataPagamento = venc; }
    if (valorPago === 0) dataPagamento = "";
    list.push({ numero: i + 1, venc, valor, valorPago, auto: isAuto, dataPagamento, obs: p.obs || "", origem: "adicional" });
  }
  return list;
}
function finance(a) {
  a = a || {};
  const valor = num(a.valorParcela);
  const qtd = Math.max(0, Math.round(num(a.parcelas)));
  const pct = num(a.porcentagemComprada);
  const cota = valor * qtd;                                     // valor pago pela cota
  const totalEstimado = pct > 0 ? (cota / pct) * 100 : 0;       // valor total estimado do ativo
  const com = comissaoCalc(a);
  const custos = com.total + num(a.frete) + num(a.outros);
  const finalEstimado = totalEstimado + custos;                // total estimado + comissão + frete + outros
  const list = ensureParcelas(a);
  const hoje = today();
  const pagas = list.filter((p) => num(p.valorPago) >= p.valor && p.valor > 0).length;
  const jaPago = list.reduce((s, p) => s + Math.min(num(p.valorPago), p.valor), 0);
  const emAberto = cota - jaPago;
  const restantes = qtd - pagas;
  const devidas = list.filter((p) => p.venc && p.venc <= hoje).length;                 // parcelas que já deveriam ter sido pagas
  const ultimoVenc = qtd > 0 ? addMonths(a.primeiroVenc, qtd - 1) : "";
  const prox = list.find((p) => num(p.valorPago) < p.valor);
  const vencidas = list.filter((p) => num(p.valorPago) < p.valor && p.venc && p.venc < hoje);
  // compras de participação adicional: geram novas parcelas e somam ao investido, sem tocar nas parcelas originais
  const adic = (a.comprasAdic || []).filter(Boolean);
  let adicList = []; let adicTotal = 0; let adicPago = 0;
  adic.forEach((c) => {
    const l = parcelasCompraAdic(c);
    const cQtd = Math.max(0, Math.round(num(c.parcelas)));
    const cVal = (num(c.valorParcela) * cQtd) || num(c.valor);
    adicTotal += cVal;
    adicPago += l.reduce((s, p) => s + Math.min(num(p.valorPago), p.valor), 0);
    adicList = adicList.concat(l.map((p) => ({ ...p, compraId: c.id, compraData: c.data, origem: "adicional", origemLabel: "Compra adicional" + (c.data ? ` (${dataBR(c.data)})` : "") })));
  });
  return {
    valor, qtd, pct, cota, totalEstimado, com, custos, finalEstimado, list, adicList,
    pagas, restantes, jaPago, emAberto, devidas, ultimoVenc, proxima: prox ? prox.venc : "", vencidas,
    total: cota + custos + adicTotal, pago: jaPago + adicPago, aberto: emAberto + (adicTotal - adicPago), patrimonio: totalEstimado,
  };
}
function cronograma(a) {
  a = a || {};
  const f = finance(a);
  const base = f.list.map((p) => ({ ativoId: a.id, tipo: a.tipo, ativoNome: a.nome, origem: "original", origemLabel: "Compra original", ...p, status: parcStatus(p) }));
  const adic = (f.adicList || []).map((p) => ({ ativoId: a.id, tipo: a.tipo, ativoNome: a.nome, ...p, status: parcStatus(p) }));
  return base.concat(adic);
}
/* agrupa todas as parcelas do animal (original + adicionais) por mês de vencimento */
function parcelasPorMes(a) {
  const byMonth = {};
  cronograma(a).forEach((p) => {
    const ym = (p.venc || "").slice(0, 7);
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = { ym, total: 0, pago: 0, fontes: {} };
    const v = num(p.valor);
    byMonth[ym].total += v;
    byMonth[ym].pago += Math.min(num(p.valorPago), v);
    const key = p.origemLabel || (p.origem === "adicional" ? "Compra adicional" : "Compra original");
    byMonth[ym].fontes[key] = (byMonth[ym].fontes[key] || 0) + v;
  });
  return Object.values(byMonth).sort((x, y) => x.ym.localeCompare(y.ym));
}
const mesLabel = (ym) => { const [y, m] = (ym || "").split("-"); return m ? `${m}/${y}` : ym; };
/* unifica parcelas da compra original + adicionais em UMA lista, somando por mês */
function parcelasUnificadas(a) {
  a = a || {};
  const meses = {};
  const garante = (ym) => (meses[ym] = meses[ym] || { ym, venc: "", baseIdx: -1, valorBase: 0, valorPagoBase: 0, autoBase: false, valorAdic: 0, valorPagoAdic: 0, autoAdic: false, obs: "" });
  // base (compra original) — mantém índice para permitir pagar/estornar manualmente
  ensureParcelas(a).forEach((p, idx) => {
    const ym = (p.venc || "").slice(0, 7); if (!ym) return;
    const m = garante(ym); m.baseIdx = idx; m.venc = p.venc;
    m.valorBase += num(p.valor); m.valorPagoBase += num(p.valorPago);
    m.autoBase = p.auto; if (p.obs) m.obs = p.obs;
  });
  // compras adicionais — pagas automaticamente pela data
  (a.comprasAdic || []).filter(Boolean).forEach((c) => {
    parcelasCompraAdic(c).forEach((p) => {
      const ym = (p.venc || "").slice(0, 7); if (!ym) return;
      const m = garante(ym); if (!m.venc || p.venc < m.venc) m.venc = m.venc || p.venc;
      if (!m.venc) m.venc = p.venc;
      m.valorAdic += num(p.valor); m.valorPagoAdic += num(p.valorPago);
      if (p.auto) m.autoAdic = true;
    });
  });
  const rows = Object.values(meses).sort((x, y) => (x.venc || "").localeCompare(y.venc || ""));
  rows.forEach((r, i) => { r.numero = i + 1; r.valor = r.valorBase + r.valorAdic; r.valorPago = r.valorPagoBase + r.valorPagoAdic; });
  return rows;
}

/* ----------------------------- motor de vendas ------------------------- */
const TIPOS_VENDA = ["Venda de participação", "Venda de aspiração", "Venda de prenhez", "Outro"];
/* cronograma previsto das parcelas de uma venda (apenas registro, sem baixa) */
function parcelasVenda(v) {
  v = v || {};
  const n = Math.max(0, Math.round(num(v.parcelas)));
  const valor = num(v.valorParcela);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ numero: i + 1, venc: addMonths(v.dataInicial, i), valor });
  return out;
}
/* participação atual = porcentagem comprada − soma das participações vendidas */
function vendasDo(a) { return ((a && a.vendas) || []).filter(Boolean); }
function pctVendida(a) {
  return vendasDo(a).filter((v) => v.tipo === "Venda de participação").reduce((s, v) => {
    // soma das linhas onde EU (dono) sou o vendedor; retrocompat: venda antiga usa v.pctVendida
    if (Array.isArray(v.linhas) && v.linhas.length) {
      return s + v.linhas.filter((l) => lc(l.vendedor) === "eu" || lc(l.vendedor) === "eu (dono)").reduce((x, l) => x + num(l.pct), 0);
    }
    return s + num(v.pctVendida);
  }, 0);
}
function participacaoAtual(a) {
  const base = num(a && a.porcentagemComprada);
  const adic = ((a && a.comprasAdic) || []).reduce((s, c) => s + num(c && c.pctAdicional), 0);
  return Math.max(0, Math.round((base + adic - pctVendida(a)) * 100) / 100);
}
/* ATIVO/INATIVO — regra: participação 0% => sempre inativo; senão respeita o status manual.
   situacao: "Ativo" | "Inativo" (inativadoMotivo, inativadoEm opcionais). */
function ehAtivo(a) {
  if (!a || a.tipo !== "animal" || a.origem === "genealogia" || a.arquivada) return false;
  if (participacaoAtual(a) <= 0) return false;         // 0% => inativo automático (regra obrigatória)
  if (a.situacao === "Inativo") return false;          // inativado manualmente
  return true;
}
// motivo "efetivo" da inatividade, para exibição
function motivoInativo(a) {
  if (participacaoAtual(a) <= 0) return a.inativadoMotivo || "Venda total da participação";
  if (a.situacao === "Inativo") return a.inativadoMotivo || "Inativado manualmente";
  return "";
}
/* normaliza uma lista de sócios em mapa {nomeLower: {nome, pct}} preservando nome original */
function socMap(lista) {
  const m = {};
  (lista || []).filter(Boolean).forEach((s) => {
    const k = lc(s.nome); if (!k) return;
    if (!m[k]) m[k] = { nome: s.nome, pct: 0, obs: s.obs || "" };
    m[k].pct += num(s.pct);
  });
  return m;
}
/* aplica as linhas de venda (vendedor→comprador) sobre a sociedade atual e devolve a nova */
function aplicarVendaSociedade(socAtual, linhas) {
  const m = socMap(socAtual);
  (linhas || []).forEach((l) => {
    const kv = lc(l.vendedor), kc = lc(l.comprador), p = num(l.pct);
    if (!kv || !kc || p <= 0) return;
    if (m[kv]) m[kv].pct = Math.round((m[kv].pct - p) * 100) / 100;
    if (!m[kc]) m[kc] = { nome: (l.comprador || "").trim(), pct: 0, obs: "" };
    m[kc].pct = Math.round((m[kc].pct + p) * 100) / 100;
  });
  return Object.values(m).filter((s) => num(s.pct) > 0.0001).map((s) => ({ id: uid(), nome: s.nome, pct: s.pct, obs: s.obs || "" }));
}
/* valida linhas contra a sociedade atual; retorna string de erro ou "" */
function validarVendaLinhas(socAtual, linhas) {
  const m = socMap(socAtual);
  const vendidoPor = {};
  for (const l of linhas || []) {
    const kv = lc(l.vendedor), p = num(l.pct);
    if (!kv && !p && !l.comprador) continue;               // linha vazia, ignora
    if (!kv) return "Selecione o sócio vendedor em todas as linhas.";
    if (!l.comprador || !l.comprador.trim()) return "Informe o comprador em todas as linhas.";
    if (p <= 0) return "A porcentagem vendida deve ser maior que zero.";
    vendidoPor[kv] = (vendidoPor[kv] || 0) + p;
  }
  for (const kv in vendidoPor) {
    const tem = m[kv] ? m[kv].pct : 0;
    if (vendidoPor[kv] > tem + 0.0001) {
      const nome = m[kv] ? m[kv].nome : kv;
      return `${nome} está vendendo ${vendidoPor[kv]}%, mas possui apenas ${tem}%.`;
    }
  }
  return "";
}
/* sociedade usada na venda: inclui a SM AGROPECUÁRIA (dono) como participante,
   com a participação atual dela, se ainda não estiver listada por nome */
const EH_SM = (nome) => { const n = lc(nome); return n === "eu" || n === "eu (dono)" || n === "sm" || n === "sm agropecuária" || n === "sm agropecuaria"; };
function sociedadeComDono(a) {
  const soc = ((a && (a.sociedadeAtual || a.socios)) || []).filter(Boolean).map((s) => ({ ...s }));
  const temSM = soc.some((s) => EH_SM(s.nome));
  if (temSM) return soc;
  return [{ id: "sm", nome: "SM Agropecuária", pct: participacaoAtual(a), obs: "" }, ...soc];
}
/* resumo financeiro do animal (investido x vendido) */
function resumoAnimal(a) {
  const f = finance(a);
  const vendas = vendasDo(a);
  const totalVendido = vendas.reduce((s, v) => s + num(v.valor), 0);
  return {
    participacao: participacaoAtual(a),
    investido: f.total,
    vendido: totalVendido,
    qtdVendas: vendas.length,
    zerado: num(a && a.porcentagemComprada) > 0 && participacaoAtual(a) <= 0,
  };
}

/* --------------------------------- vídeo ------------------------------- */
function toEmbed(url) {
  if (!url) return null;
  try {
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  } catch (e) {}
  return null;
}

/* ------------------------------- opções -------------------------------- */
const RACAS = ["Nelore", "Brahman", "Gir", "Guzerá", "Angus", "Senepol", "Tabapuã", "Girolando"];
const STATUS_ANIMAL = ["Pista", "Doadora", "Aposentada"];
const STATUS_PRENHEZ = ["Aguardando confirmação", "Confirmada", "Gestação em andamento", "Próxima do parto", "Parto previsto ultrapassado", "Nascimento informado", "Perda gestacional", "Parida", "Concluída", "Vendida"];
const STATUS_ASP = ["Realizada", "Em laboratório", "Embriões produzidos", "Transferida", "Finalizada", "Cancelada"];

/* --------------------------- esquemas de ficha ------------------------- */
/* tipos: text|number|date|money|pct|select|textarea|link|leilao|local|vendedor|simnao */
const COMPRA = [
  ["leilao", "Nome do leilão", "leilao"], ["dataCompra", "Data da compra", "date"],
  ["vendedor", "Vendedor", "vendedor"], ["obsCompra", "Observações da compra", "textarea"],
];
const PAGAMENTO = [
  ["porcentagemComprada", "Participação da SM (%)", "pct"],
  ["valorParcela", "Valor da parcela", "money"],
  ["parcelas", "Quantidade de parcelas", "number"],
  ["primeiroVenc", "Primeiro vencimento", "date"],
  ["comissaoPct", "Percentual da comissão (%)", "pct"],
  ["frete", "Frete", "money"], ["outros", "Outros custos", "money"],
];

const SCHEMAS = {
  animal: [
    { g: "Identificação", f: [
      ["nome", "Nome do animal", "text"], ["registro", "Número de registro", "text"],
      ["raca", "Raça", "select", RACAS], ["sexo", "Sexo", "select", ["Fêmea", "Macho"]],
      ["nascimento", "Data de nascimento", "date"],
      ["categoria", "Categoria", "select", ["", "Pista", "Doadora", "Reprodutor", "Matriz", "Aposentada"]],
      ["origemAnimal", "Origem do animal", "select", ["", "Compra direta", "Nascimento de aspiração", "Nascimento de prenhez", "Outra origem"]],
      ["ondeEsta", "Criatório responsável", "local"],
    ]},
    { g: "Genealogia", gen: true, f: [
      ["pai", "Pai", "link"], ["mae", "Mãe", "link"],
      ["avoPaterno", "Avô paterno", "link"], ["avoPaterna", "Avó paterna", "link"],
      ["avoMaterno", "Avô materno", "link"], ["avoMaterna", "Avó materna", "link"],
      ["obsGen", "Observações sobre a genética", "textarea"],
    ]},
    { g: "Bisavós (opcional)", f: [
      ["bis_pp_p", "Pai do avô paterno", "link"], ["bis_pp_m", "Mãe do avô paterno", "link"],
      ["bis_pm_p", "Pai da avó paterna", "link"], ["bis_pm_m", "Mãe da avó paterna", "link"],
      ["bis_mp_p", "Pai do avô materno", "link"], ["bis_mp_m", "Mãe do avô materno", "link"],
      ["bis_mm_p", "Pai da avó materna", "link"], ["bis_mm_m", "Mãe da avó materna", "link"],
    ]},
    { g: "Compra", f: COMPRA },
    { g: "Pagamento", pay: true, f: PAGAMENTO },
    { g: "Observações", f: [["obs", "Observações gerais", "textarea"]] },
  ],
  prenhez: [
    { g: "Identificação", f: [
      ["doadora", "Mãe doadora", "link"], ["regDoadora", "Registro da mãe doadora", "text"],
      ["pai", "Pai", "link"],
      ["qtd", "Quantidade de prenhezes", "number"],
      ["status", "Status", "select", STATUS_PRENHEZ], ["ondeEsta", "Criatório responsável", "local"],
    ]},
    { g: "Acompanhamento reprodutivo", f: [
      ["responsavel", "Responsável pelo acompanhamento", "text"],
      ["receptora", "Receptora (identificação)", "text"],
      ["dataTE", "Data da transferência do embrião", "date"], ["dataConfirmacao", "Data de confirmação", "date"],
      ["previsaoParto", "Previsão de parto", "date"], ["dataParto", "Data real do parto", "date"],
    ]},
    { g: "Genealogia", gen: true, f: [
      ["avoMaterno", "Avô materno", "link"], ["avoMaterna", "Avó materna", "link"],
      ["avoPaterno", "Avô paterno", "link"], ["avoPaterna", "Avó paterna", "link"],
      ["obsGen", "Observações genealógicas", "textarea"],
    ]},
    { g: "Compra", f: COMPRA },
    { g: "Pagamento", pay: true, f: PAGAMENTO },
    { g: "Observações", f: [["obs", "Observações", "textarea"]] },
  ],
  aspiracao: [
    { g: "Identificação", f: [
      ["doadora", "Mãe doadora", "link"], ["regDoadora", "Registro da mãe doadora", "text"],
      ["pai", "Pai (se houver)", "link"],
      ["qtd", "Quantidade", "number"],
      ["status", "Status", "select", STATUS_ASP], ["ondeEsta", "Criatório responsável", "local"],
    ]},
    { g: "Acompanhamento reprodutivo", f: [
      ["responsavel", "Responsável pelo acompanhamento", "text"],
      ["dataAspiracao", "Data realizada da aspiração", "date"],
      ["oocitos", "Oócitos coletados", "number"], ["embrioes", "Embriões produzidos", "number"],
      ["embrioesTransf", "Embriões transferidos", "number"], ["embrioesArmaz", "Embriões armazenados", "number"],
      ["prenhezesConf", "Prenhezes confirmadas", "number"],
    ]},
    { g: "Genealogia", gen: true, f: [
      ["avoMaterno", "Avô materno", "link"], ["avoMaterna", "Avó materna", "link"],
      ["avoPaterno", "Avô paterno", "link"], ["avoPaterna", "Avó paterna", "link"],
      ["obsGen", "Observações genealógicas", "textarea"],
    ]},
    { g: "Compra", f: COMPRA },
    { g: "Pagamento", pay: true, f: PAGAMENTO },
    { g: "Observações", f: [["obs", "Observações", "textarea"]] },
  ],
};
const linkKeysOf = (tipo) => (SCHEMAS[tipo] || []).flatMap((s) => s.f).filter(([, , t]) => t === "link").map(([k]) => k);
/* identificação automática de prenhez/aspiração: "Tipo: Doadora x Pai" */
function rotuloReprod(a) {
  a = a || {};
  const pre = a.tipo === "prenhez" ? "Prenhez" : a.tipo === "aspiracao" ? "Aspiração" : "";
  const d = (a.doadora || "").trim();
  const p = (a.pai || a.touro || "").trim();
  if (!pre) return a.nome || "";
  if (!d && !p) return a.nome || pre;
  return `${pre}: ${d}${p ? ` x ${p}` : ""}`;
}
const qtdTotal = (a) => Math.max(1, Math.round(num(a && a.qtd) || 1));
const qtdConvertidos = (a) => Math.max(0, Math.round(num(a && a.convertidos) || 0));
const qtdRest = (a) => Math.max(0, qtdTotal(a) - qtdConvertidos(a));
function qtdRestante(a) {
  const t = qtdTotal(a), c = qtdConvertidos(a), r = qtdRest(a);
  return `${r} de ${t}${c ? ` (${c} nascida${c > 1 ? "s" : ""})` : ""}`;
}

/* ---- Acompanhamento reprodutivo: alertas de parto e pendências (só dados reais) ---- */
// dias até a previsão de parto (negativo = já passou). null se sem data.
function diasAteParto(a) {
  if (!a || !a.previsaoParto || a.dataParto) return null;   // sem previsão, ou já pariu
  const hoje = new Date(today() + "T00:00:00");
  const prev = new Date(a.previsaoParto + "T00:00:00");
  return Math.round((prev - hoje) / 86400000);
}
// a prenhez ainda está "em andamento" (não pariu, não perdeu, não concluiu/vendeu)?
function prenhezAtiva(a) {
  if (!a || a.tipo !== "prenhez" || a.arquivada) return false;
  const s = lc(a.status);
  if (s.includes("perda") || s.includes("perdida") || s.includes("vendida") || s.includes("concluída") || s.includes("concluida") || s.includes("parida")) return false;
  return true;
}
// nível de alerta de parto: 'atrasado' | 'hoje' | '7' | '15' | '30' | null
function alertaParto(a) {
  if (!prenhezAtiva(a)) return null;
  const d = diasAteParto(a);
  if (d == null) return null;
  if (d < 0) return "atrasado";
  if (d === 0) return "hoje";
  if (d <= 7) return "7";
  if (d <= 15) return "15";
  if (d <= 30) return "30";
  return null;
}
// aspiração em andamento (não finalizada/cancelada)
function aspAtiva(a) {
  if (!a || a.tipo !== "aspiracao" || a.arquivada) return false;
  const s = lc(a.status);
  return !(s.includes("finalizada") || s.includes("cancelada") || s.includes("concluída") || s.includes("concluida"));
}

/* -------------------------------- seed --------------------------------- */
function markPaid(list, n) { return list.map((p, i) => (i < n ? { ...p, valorPago: p.valor, dataPagamento: p.venc } : p)); }
function build(a, pagas) {
  const w = { comissaoTipo: "Sobre o valor da parcela", comissaoPct: 8, considerarVencidasPagas: false, ...a, socios: a.socios || [], videos: a.videos || [], historico: a.historico || [] };
  w.parcelasList = markPaid(ensureParcelas(w), pagas || 0);
  return w;
}
const SEED = {
  ativos: [
    build({
      id: "a1", tipo: "animal", nome: "Imperatriz FIV da Serra", registro: "NEL-884213",
      raca: "Nelore", sexo: "Fêmea", nascimento: "2021-03-12", status: "Doadora",
      ondeEsta: "Central Alta Genetics",
      pai: "Rei do Vale FIV", mae: "Duquesa TE da Serra",
      avoPaterno: "Sultão FIV", avoPaterna: "Estrela do Vale", avoMaterno: "Barão TE", avoMaterna: "Princesa da Serra",
      obsGen: "Doadora de altíssima demanda genética.",
      leilao: "Elite Genética 2024", dataCompra: "2024-06-15", vendedor: "Cabanha Vale Verde", obsCompra: "Arrematada por cota.",
      porcentagemComprada: 100, valorParcela: 35000, parcelas: 12, primeiroVenc: "2024-07-15",
      comissaoTipo: "Sobre o valor da parcela", comissaoPct: 8, frete: 3500, outros: 1200, considerarVencidasPagas: true,
      videos: [{ id: uid(), tipo: "Pista/Leilão", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", obs: "Apresentação no leilão" }],
      socios: [{ id: uid(), nome: "Serra Dourada Agro", pct: 60 }, { id: uid(), nome: "Haras Boa Vista", pct: 40 }],
      historico: [{ id: uid(), data: "2024-06-15", tipo: "Compra", desc: "Arrematada no leilão Elite Genética", responsavel: "Diretoria" }],
    }, 0),
    build({
      id: "a2", tipo: "animal", nome: "Titã FIV do Horizonte", registro: "NEL-773540",
      raca: "Nelore", sexo: "Macho", nascimento: "2020-08-01", status: "Pista",
      ondeEsta: "Fazenda Santa Maria", pai: "Colosso FIV", mae: "Joia do Horizonte", obsGen: "Touro central do programa.",
      leilao: "Compra particular", dataCompra: "2023-11-02", vendedor: "Fazenda Horizonte",
      porcentagemComprada: 100, valorParcela: 68000, parcelas: 10, primeiroVenc: "2023-12-02",
      comissaoTipo: "Sobre o valor total estimado", comissaoPct: 8, frete: 5000, outros: 0, considerarVencidasPagas: true,
      socios: [{ id: uid(), nome: "Serra Dourada Agro", pct: 100 }],
      historico: [{ id: uid(), data: "2023-11-02", tipo: "Compra", desc: "Compra direta finalizada", responsavel: "Diretoria" }],
    }, 0),
    build({
      id: "p1", tipo: "prenhez", nome: "Prenhez Imperatriz × Titã #01",
      doadora: "Imperatriz FIV da Serra", receptora: "Receptora RC-220", touro: "Titã FIV do Horizonte",
      dataInsem: "2025-02-10", dataParto: "2025-11-17", sexoPrev: "Fêmea", status: "Confirmada",
      raca: "Nelore", ondeEsta: "Fazenda São João", veterinario: "Dr. Almeida", laboratorio: "In Vitro Brasil",
      avoPaterno: "Colosso FIV", avoPaterna: "Joia do Horizonte", avoMaterno: "Rei do Vale FIV", avoMaterna: "Duquesa TE da Serra",
      leilao: "Venda particular", dataCompra: "2025-02-12", vendedor: "Serra Dourada Agro",
      porcentagemComprada: 100, valorParcela: 15833.33, parcelas: 6, primeiroVenc: "2025-03-01",
      comissaoTipo: "Sobre o valor da parcela", comissaoPct: 8, frete: 0, outros: 18500, considerarVencidasPagas: true,
      socios: [{ id: uid(), nome: "Grupo Investidores", pct: 50 }, { id: uid(), nome: "Serra Dourada Agro", pct: 50 }],
      historico: [{ id: uid(), data: "2025-02-10", tipo: "Transferência de embrião", desc: "TE na receptora RC-220", responsavel: "Dr. Almeida" }],
    }, 0),
    build({
      id: "s1", tipo: "aspiracao", nome: "Aspiração Imperatriz — Fev/2025", doadora: "Imperatriz FIV da Serra",
      dataAsp: "2025-02-01", touro: "Titã FIV do Horizonte", laboratorio: "In Vitro Brasil", veterinario: "Dra. Souza",
      status: "Embriões produzidos", ondeEsta: "In Vitro Brasil",
      oocitos: 28, embrioes: 14, viaveis: 11, congelados: 6, transferidos: 5, prenhezes: 3,
      paiDoadora: "Rei do Vale FIV", maeDoadora: "Duquesa TE da Serra", paiTouro: "Colosso FIV", maeTouro: "Joia do Horizonte",
      leilao: "Programa próprio", dataCompra: "2025-02-01", vendedor: "Serra Dourada Agro",
      porcentagemComprada: 100, valorParcela: 38000, parcelas: 1, primeiroVenc: "2025-02-05",
      comissaoTipo: "Sobre o valor da parcela", comissaoPct: 8, frete: 0, outros: 0, considerarVencidasPagas: true,
      socios: [{ id: uid(), nome: "Serra Dourada Agro", pct: 70 }, { id: uid(), nome: "Haras Boa Vista", pct: 30 }],
      historico: [{ id: uid(), data: "2025-02-01", tipo: "Aspiração realizada", desc: "28 oócitos coletados", responsavel: "Dra. Souza" }],
    }, 0),
  ],
  socios: [
    { id: "sc1", nome: "Serra Dourada Agro", doc: "12.345.678/0001-90", tel: "(17) 99000-0000", email: "contato@serradourada.com", endereco: "Rod. BR-153, km 42", obs: "Sócio majoritário." },
    { id: "sc2", nome: "Haras Boa Vista", doc: "98.765.432/0001-10", tel: "(11) 98888-1111", email: "financeiro@boavista.com", endereco: "São Paulo, SP", obs: "" },
    { id: "sc3", nome: "Grupo Investidores", doc: "45.111.222/0001-33", tel: "(62) 97777-2222", email: "grupo@invest.com", endereco: "Goiânia, GO", obs: "" },
  ],
  leiloes: [{ id: "l1", nome: "Elite Genética 2024" }, { id: "l2", nome: "Expozebu Elite" }, { id: "l3", nome: "Venda particular" }, { id: "l4", nome: "Compra particular" }],
  locais: ["Fazenda Santa Maria", "Fazenda São João", "Central Alta Genetics", "In Vitro Brasil", "Fazenda Serra Dourada"],
  vendedores: [
    { id: "v1", nome: "Cabanha Vale Verde", tipo: "Criatório", doc: "", tel: "", email: "", obs: "" },
    { id: "v2", nome: "Fazenda Horizonte", tipo: "Fazenda", doc: "", tel: "", email: "", obs: "" },
    { id: "v3", nome: "Serra Dourada Agro", tipo: "Empresa", doc: "12.345.678/0001-90", tel: "", email: "", obs: "" },
  ],
  users: [],
};
const stubAnimal = (nm, role) => build({
  id: uid(), tipo: "animal", nome: nm, origem: "genealogia", status: "",
  historico: [{ id: uid(), data: today(), tipo: "Cadastro criado", desc: "Cadastrado via genealogia", responsavel: role || "Sistema" }],
}, 0);

/* ------------------------------ componentes ---------------------------- */
function Badge({ children, tone = "gold" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
function statusTone(s) {
  const v = (s || "").toLowerCase();
  if (["pago", "confirmada", "ativo", "matriz", "reprodutor", "finalizada", "doadora"].some((x) => v.includes(x))) return "green";
  if (["vencido", "perdida", "cancelada", "descartado", "falecido"].some((x) => v.includes(x))) return "red";
  if (["parcial", "aberto", "aguardando", "avaliação", "aposentada"].some((x) => v.includes(x))) return "amber";
  return "gold";
}
const KPI = ({ label, value, sub, tone, icon, onClick }) => (
  <div className={`kpi ${onClick ? "clk" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}>
    <div className="kpi-top">{icon && <span className="kpi-ic">{icon}</span>}<div className="kpi-label">{label}</div></div>
    <div className={`kpi-value ${tone || ""}`}>{value}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>
);

/* autocomplete genérico */
function AutoField({ value, onChange, suggestions, onCreate, placeholder, regMap }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || "");
  const [hi, setHi] = useState(-1);
  useEffect(() => setQ(value || ""), [value]);
  const nrm = (s) => lc(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ql = nrm(q);
  const sugs = (suggestions || []).filter((s) => typeof s === "string" && s);
  const matches = sugs.filter((s) => nrm(s).includes(ql)).slice(0, 6);
  const rgDe = (m) => (regMap && regMap[lc(m)]) || "";
  const exact = sugs.some((s) => nrm(s) === ql);
  const podeCriar = q && !exact && onCreate;
  const opts = [...matches, ...(podeCriar ? ["__create__"] : [])];
  const escolher = (m) => { if (m === "__create__") { onCreate(q); setQ(q); onChange(q); } else { setQ(m); onChange(m); } setOpen(false); setHi(-1); };
  const onKey = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { if (open && hi >= 0 && opts[hi]) { e.preventDefault(); escolher(opts[hi]); } }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); setOpen(false); setHi(-1); } }
  };
  return (
    <div className="auto">
      <input value={q} placeholder={placeholder || "digite para buscar…"}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); setHi(-1); }}
        onKeyDown={onKey}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)} />
      {open && opts.length > 0 && (
        <div className="auto-menu">
          {matches.map((m, i) => <button type="button" key={m} className={`auto-item ${hi === i ? "hi" : ""}`} onMouseDown={() => escolher(m)} onMouseEnter={() => setHi(i)}>{m}{rgDe(m) && <span className="auto-rg">RG {rgDe(m)}</span>}</button>)}
          {podeCriar && (
            <button type="button" className={`auto-item create ${hi === matches.length ? "hi" : ""}`} onMouseDown={() => escolher("__create__")} onMouseEnter={() => setHi(matches.length)}>＋ Cadastrar “{q}”</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------ árvore genealógica (pedigree horizontal) ----------- */
const NW = 150, NH = 46, COL = 178, ROW = 64;
const sexNorm = (s) => { const v = (s || "").toLowerCase(); if (v.startsWith("m")) return "M"; if (v.startsWith("f")) return "F"; return "N"; };
const sexFill = (x) => (x === "M" ? "#e8f0fb" : x === "F" ? "#fbe9f1" : "#f4efe4");
const sexStroke = (x) => (x === "M" ? "#5b86cf" : x === "F" ? "#cf7aa3" : "#d0c4a4");
const sexText = (x) => (x === "M" ? "#274a86" : x === "F" ? "#8a3a66" : "#5a5346");
const truncNome = (s, n = 18) => (!s ? "—" : s.length > n ? s.slice(0, n - 1) + "…" : s);
function ladoLayout(gens, sign) {
  const d = gens.length, leaves = gens[d - 1].length;
  const ys = gens.map((g) => g.map(() => 0));
  gens[d - 1].forEach((_, i) => { ys[d - 1][i] = (i - (leaves - 1) / 2) * ROW; });
  for (let g = d - 2; g >= 0; g--) gens[g].forEach((_, j) => { ys[g][j] = (ys[g + 1][2 * j] + ys[g + 1][2 * j + 1]) / 2; });
  const nodes = [], links = [];
  gens.forEach((arr, g) => arr.forEach((n, j) => {
    const x = sign * (g + 1) * COL, y = ys[g][j];
    nodes.push({ ...n, x, y });
    if (g < d - 1) [2 * j, 2 * j + 1].forEach((cj) => links.push({ x1: x, y1: y, x2: sign * (g + 2) * COL, y2: ys[g + 1][cj], sign }));
  }));
  return { nodes, links, d, leaves };
}
const linkD = (l) => { const pe = l.x1 + l.sign * NW / 2, ce = l.x2 - l.sign * NW / 2, mid = (pe + ce) / 2; return `M ${pe} ${l.y1} H ${mid} V ${l.y2} H ${ce}`; };

function Genealogia({ a }) {
  let center, leftGens, rightGens;
  if (a.tipo === "aspiracao" || a.tipo === "prenhez") {
    const isPren = a.tipo === "prenhez";
    center = { label: isPren ? "Prenhez" : "Aspiração", name: a.nome, sex: isPren ? "F" : "N" };
    leftGens = [[{ label: "Pai", name: a.pai || a.touro, sex: "M" }],
      [{ label: "Avô paterno", name: a.avoPaterno, sex: "M" }, { label: "Avó paterna", name: a.avoPaterna, sex: "F" }]];
    rightGens = [[{ label: "Mãe doadora", name: a.doadora, sex: "F" }],
      [{ label: "Avô materno", name: a.avoMaterno, sex: "M" }, { label: "Avó materna", name: a.avoMaterna, sex: "F" }]];
  } else {
    const isPren = false;
    center = { label: "Animal", name: a.nome, sex: sexNorm(a.sexo) };
    leftGens = [[{ label: isPren ? "Pai (touro)" : "Pai", name: isPren ? a.touro : a.pai, sex: "M" }],
      [{ label: "Avô paterno", name: a.avoPaterno, sex: "M" }, { label: "Avó paterna", name: a.avoPaterna, sex: "F" }]];
    rightGens = [[{ label: isPren ? "Mãe (doadora)" : "Mãe", name: isPren ? a.doadora : a.mae, sex: "F" }],
      [{ label: "Avô materno", name: a.avoMaterno, sex: "M" }, { label: "Avó materna", name: a.avoMaterna, sex: "F" }]];
    const bis = ["bis_pp_p", "bis_pp_m", "bis_pm_p", "bis_pm_m", "bis_mp_p", "bis_mp_m", "bis_mm_p", "bis_mm_m"];
    if (!isPren && bis.some((k) => a[k])) {
      leftGens.push([{ label: "Bisavô", name: a.bis_pp_p, sex: "M" }, { label: "Bisavó", name: a.bis_pp_m, sex: "F" },
        { label: "Bisavô", name: a.bis_pm_p, sex: "M" }, { label: "Bisavó", name: a.bis_pm_m, sex: "F" }]);
      rightGens.push([{ label: "Bisavô", name: a.bis_mp_p, sex: "M" }, { label: "Bisavó", name: a.bis_mp_m, sex: "F" },
        { label: "Bisavô", name: a.bis_mm_p, sex: "M" }, { label: "Bisavó", name: a.bis_mm_m, sex: "F" }]);
    }
  }
  const L = ladoLayout(leftGens, -1), R = ladoLayout(rightGens, 1);
  const d = Math.max(L.d, R.d);
  const nodes = [{ ...center, x: 0, y: 0 }, ...L.nodes, ...R.nodes];
  const links = [...L.links, ...R.links, { x1: 0, y1: 0, x2: -COL, y2: 0, sign: -1 }, { x1: 0, y1: 0, x2: COL, y2: 0, sign: 1 }];
  const maxX = d * COL + NW / 2 + 18;
  const maxY = (Math.max(L.leaves, R.leaves) / 2) * ROW + NH / 2 + 18;
  const vb = `${-maxX} ${-maxY} ${2 * maxX} ${2 * maxY}`;
  return (
    <div className="geneal ped">
      <svg viewBox={vb} style={{ width: "100%", height: "auto", maxWidth: 2 * maxX }} preserveAspectRatio="xMidYMid meet">
        {links.map((l, i) => <path key={i} d={linkD(l)} fill="none" stroke="#d8cfba" strokeWidth="1.6" />)}
        {nodes.map((n, i) => {
          const main = n.x === 0 && n.y === 0;
          return (
            <g key={i}>
              <rect x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} rx="9"
                fill={sexFill(n.sex)} stroke={sexStroke(n.sex)} strokeWidth={main ? 2.6 : 1.4} />
              <text x={n.x} y={n.y - NH / 2 + 15} textAnchor="middle" fontSize="9" fontWeight="700" fill={sexStroke(n.sex)}>{(n.label || "").toUpperCase()}</text>
              <text x={n.x} y={n.y + 9} textAnchor="middle" fontSize="13" fontFamily="Fraunces,Georgia,serif" fill={sexText(n.sex)}>{truncNome(n.name)}</text>
              <title>{n.name || "—"}</title>
            </g>
          );
        })}
      </svg>
      <div className="ped-legend">
        <span><i className="sw sw-m" /> Macho</span>
        <span><i className="sw sw-f" /> Fêmea</span>
        <span className="ped-side">◀ Paterno</span>
        <span className="ped-side">Materno ▶</span>
      </div>
    </div>
  );
}

function VideoBlock({ v }) {
  const emb = toEmbed(v.url);
  if (!v.url) return null;
  return (
    <div className="video-item">
      {emb ? (
        <div className="video-frame"><iframe src={emb} title={v.tipo || "vídeo"} frameBorder="0" allowFullScreen loading="lazy" /></div>
      ) : (
        <a className="btn btn-ghost btn-video" href={v.url} target="_blank" rel="noreferrer">▶ Abrir vídeo{v.tipo ? ` — ${v.tipo}` : ""}</a>
      )}
      {v.obs && <span className="video-obs">{v.obs}</span>}
    </div>
  );
}

/* --------------------------- formulário de ficha ----------------------- */
function FichaForm({ tipo, initial, animalNames, animalReg, genIndex, leilaoNames, localNames, vendedorNames, socioNames,
  onQuickAnimal, onQuickLeilao, onQuickLocal, onQuickVendedor, onQuickSocio, onSave, onApprove, onClose }) {
  const ehPref = !!(initial && initial.__pref);
  const [d, setD] = useState(() => initial || { id: uid(), tipo, socios: [], videos: [], historico: [], comissaoPct: 8 });
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  // editar um campo tira a marca de "sugerido" dele
  const set = (k, v) => setD((p) => { const np = { ...p, [k]: v }; if (np.__genSug && np.__genSug.includes(k)) np.__genSug = np.__genSug.filter((x) => x !== k); return np; });
  // qual campo é a "mãe" neste tipo (animal: mae; prenhez/aspiração: doadora)
  const maeKey = tipo === "animal" ? "mae" : "doadora";
  const sugerido = (k) => (d.__genSug || []).includes(k);
  /* ao informar pai/mãe conhecidos, sugere avós E bisavós (só campos vazios, marca como sugestão) */
  const setComGen = (campo, valor) => setD((p) => {
    let np = { ...p, [campo]: valor };
    if (np.__genSug) np.__genSug = np.__genSug.filter((x) => x !== campo);
    if (campo === "doadora") { const reg = (animalReg || {})[lc(valor)]; if (reg && (!p.regDoadora || p.__regAuto)) { np.regDoadora = reg; np.__regAuto = true; } }
    const lado = campo === "pai" ? "pat" : (campo === maeKey ? "mat" : null);
    if (lado && valor && valor.trim()) {
      const rg = campo === "doadora" ? (np.regDoadora || (animalReg || {})[lc(valor)]) : "";
      const sug = new Set(np.__genSug || []);
      fillArvore(np, lado, valor, rg, genIndex, sug, tipo === "animal");
      np.__genSug = [...sug];
    }
    return np;
  });
  /* ao ABRIR a ficha: se pai/mãe já estão preenchidos e a árvore vazia,
     sugere avós E bisavós a partir da base genealógica (uma vez). */
  const genInit = useRef(false);
  useEffect(() => {
    if (genInit.current || !genIndex) return;
    genInit.current = true;
    setD((p) => {
      let np = { ...p }; const sug = new Set(np.__genSug || []);
      fillArvore(np, "pat", np.pai, "", genIndex, sug, tipo === "animal");
      fillArvore(np, "mat", np[maeKey], np.regDoadora, genIndex, sug, tipo === "animal");
      if (sug.size) np.__genSug = [...sug];
      return np;
    });
  }, [genIndex]);
  const f = finance(d);
  const pctSocios = (d.socios || []).filter(Boolean).reduce((s, x) => s + num(x.pct), 0);

  const addSocio = () => setD((p) => ({ ...p, socios: [...(p.socios || []), { id: uid(), nome: "", pct: 0 }] }));
  const setSocio = (id, k, v) => setD((p) => ({ ...p, socios: p.socios.map((s) => (s.id === id ? { ...s, [k]: v } : s)) }));
  const delSocio = (id) => setD((p) => ({ ...p, socios: p.socios.filter((s) => s.id !== id) }));
  const addVideo = () => setD((p) => ({ ...p, videos: [...(p.videos || []), { id: uid(), tipo: "Apresentação", url: "", obs: "" }] }));
  const setVideo = (id, k, v) => setD((p) => ({ ...p, videos: p.videos.map((s) => (s.id === id ? { ...s, [k]: v } : s)) }));
  const delVideo = (id) => setD((p) => ({ ...p, videos: p.videos.filter((s) => s.id !== id) }));

  const titulo = { animal: "Animal", prenhez: "Prenhez", aspiracao: "Aspiração" }[tipo];
  const autoSrc = { link: [animalNames, onQuickAnimal, "buscar ou cadastrar animal"], leilao: [leilaoNames, onQuickLeilao, "buscar ou cadastrar leilão"],
    local: [localNames, onQuickLocal, "buscar ou cadastrar local"], vendedor: [vendedorNames, onQuickVendedor, "buscar ou cadastrar vendedor"] };

  const renderField = ([k, label, type, opt]) => {
    if (k === "doadora") {
      return (
        <label className="field" key={k}><span>{label}<em className="new-hint"> · busca em todo o sistema</em></span>
          <AutoField value={d.doadora || ""} suggestions={animalNames} regMap={animalReg} onCreate={onQuickAnimal}
            onChange={(v) => setComGen("doadora", v)}
            placeholder="mãe doadora (busca em Animais, Prenhez, Aspiração, Genealogia)" /></label>
      );
    }
    if (k === "pai" || (k === "mae" && tipo === "animal")) {
      return (
        <label className="field" key={k}><span>{label}<em className="new-hint"> · puxa avós já cadastrados</em></span>
          <AutoField value={d[k] || ""} suggestions={animalNames} regMap={animalReg} onCreate={onQuickAnimal}
            onChange={(v) => setComGen(k, v)} placeholder="buscar ou cadastrar animal" /></label>
      );
    }
    if (k === "regDoadora") {
      const auto = d.__regAuto && d.regDoadora;
      return (
        <label className="field" key={k}><span>{label}{auto ? <em className="new-hint"> · preenchido automaticamente</em> : ""}</span>
          <input value={d.regDoadora || ""} onChange={(e) => setD((p) => ({ ...p, regDoadora: e.target.value, __regAuto: false }))} placeholder="registro da mãe (auto se já cadastrada)" /></label>
      );
    }
    if (type === "simnao") return (
      <label className="field wide" key={k}><span>{label}</span>
        <div className="segmented"><button type="button" className={`seg ${d[k] ? "on" : ""}`} onClick={() => set(k, true)}>Sim</button>
          <button type="button" className={`seg ${!d[k] ? "on" : ""}`} onClick={() => set(k, false)}>Não</button></div></label>
    );
    const isAuto = autoSrc[type];
    const isNewAnimal = type === "link" && d[k] && !(animalNames || []).some((n) => lc(n) === lc(d[k]));
    return (
      <label className={`field ${type === "textarea" ? "wide" : ""}`} key={k}>
        <span>{label}{isNewAnimal && <em className="new-hint"> · novo, será salvo</em>}{sugerido(k) && <em className="new-hint gen-sug"> · sugerido pela genealogia</em>}</span>
        {type === "textarea" ? <textarea value={d[k] || ""} onChange={(e) => set(k, e.target.value)} rows={2} />
          : type === "select" ? <select value={d[k] || ""} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{opt.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : isAuto ? <AutoField value={d[k] || ""} onChange={(v) => set(k, v)} suggestions={isAuto[0]} regMap={type === "link" ? animalReg : undefined} onCreate={isAuto[1]} placeholder={isAuto[2]} />
          : <input type={type === "money" || type === "number" ? "number" : type === "date" ? "date" : "text"} step="any"
              value={d[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={type === "money" ? "R$ 0" : type === "pct" ? "ex.: 33,33" : ""} />}
      </label>
    );
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{ehPref ? "Conferir pré-cadastro" : initial && !initial.__fromOrigem ? "Editar" : "Novo cadastro"} — <span className="serif">{titulo}</span></h2><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {initial && initial.__fromOrigem && <div className="aviso" style={{ margin: "0 0 14px" }}>Nascimento de <b>{initial.origemLabel}</b> — genealogia e sociedade já preenchidas. Complete os dados do animal{initial.origemTipo === "prenhez" ? " (sexo já definido como Fêmea)" : " e escolha o sexo"}.</div>}
          {SCHEMAS[tipo].map((sec) => (
            <div className="fsec" key={sec.g}>
              <div className="fsec-h">{sec.g}{sec.gen && <span className="muted small hint">— digite para buscar animais já cadastrados</span>}</div>
              <div className="grid">{sec.f.map(renderField)}</div>
              {sec.pay && (
                <div className="fin-live">
                  <span>Valor pago pela cota <b>{fmt(f.cota)}</b></span>
                  <span>Valor total estimado <b>{fmt(f.totalEstimado)}</b></span>
                  <span>Comissão ({f.com.pct}% · {f.com.base}) <b>{fmt(f.com.total)}</b></span>
                  <span>Valor final c/ custos <b>{fmt(f.finalEstimado)}</b></span>
                  <span>Último vencimento <b>{dataBR(f.ultimoVenc)}</b></span>
                  <span>Parcelas pagas <b>{f.pagas}/{f.qtd}</b></span>
                  <span>Já venceram <b>{f.devidas}</b></span>
                  <span>Já pago <b className="pos">{fmt(f.jaPago)}</b></span>
                  <span>Em aberto <b className="neg">{fmt(f.emAberto)}</b></span>
                  <span>Próxima <b>{dataBR(f.proxima)}</b></span>
                </div>
              )}
            </div>
          ))}

          {/* sociedade simplificada */}
          <div className="fsec">
            <div className="fsec-h">Sociedade <span className="muted small hint">— apenas informativo (não afeta seus valores)</span>{(d.socios || []).length > 0 && pctSocios !== 100 && <span className="warn">⚠ soma {pctSocios}% (deve fechar 100%)</span>}</div>
            {(d.socios || []).map((s) => (
              <div className="socio-row" key={s.id}>
                <div className="socio-auto"><AutoField value={s.nome} onChange={(v) => setSocio(s.id, "nome", v)} suggestions={socioNames} onCreate={onQuickSocio} placeholder="buscar ou cadastrar sócio" /></div>
                <input type="number" step="any" placeholder="%" value={s.pct} onChange={(e) => setSocio(s.id, "pct", e.target.value)} style={{ maxWidth: 80 }} />
                <input placeholder="observações (opcional)" value={s.obs || ""} onChange={(e) => setSocio(s.id, "obs", e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                <button className="btn btn-mini" onClick={() => delSocio(s.id)}>remover</button>
              </div>
            ))}
            <button className="btn btn-ghost" onClick={addSocio}>+ Adicionar sócio</button>
          </div>

          {/* vídeos */}
          <div className="fsec">
            <div className="fsec-h">Vídeos</div>
            {(d.videos || []).map((v) => (
              <div className="socio-row" key={v.id}>
                <input placeholder="Tipo (pista, apresentação, avaliação…)" value={v.tipo} onChange={(e) => setVideo(v.id, "tipo", e.target.value)} />
                <input placeholder="Link YouTube/Vimeo/Drive" value={v.url} onChange={(e) => setVideo(v.id, "url", e.target.value)} />
                <button className="btn btn-mini" onClick={() => delVideo(v.id)}>remover</button>
              </div>
            ))}
            <button className="btn btn-ghost" onClick={addVideo}>+ Adicionar vídeo</button>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          {ehPref ? (<>
            <button className="btn btn-ghost" onClick={() => onSave(d)}>Salvar rascunho</button>
            <button className="btn btn-gold" onClick={() => onApprove(d)}>✓ Aprovar e cadastrar</button>
          </>) : (
            <button className="btn btn-gold" onClick={() => onSave(d)}>Salvar ficha</button>
          )}</div>
      </div>
    </div>
  );
}

/* --------- editor reutilizável de linhas de sócios (nome/%/obs) -------- */
function LinhasSocios({ linhas, setLinhas, socioNames, onQuickSocio }) {
  const set = (id, k, v) => setLinhas(linhas.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  const add = () => setLinhas([...linhas, { id: uid(), nome: "", pct: "", obs: "" }]);
  const del = (id) => setLinhas(linhas.filter((l) => l.id !== id));
  const soma = linhas.reduce((s, l) => s + num(l.pct), 0);
  return (
    <div>
      {linhas.map((l) => (
        <div className="socio-row" key={l.id}>
          <div className="socio-auto"><AutoField value={l.nome} onChange={(v) => set(l.id, "nome", v)} suggestions={socioNames} onCreate={onQuickSocio} placeholder="nome do sócio" /></div>
          <input type="number" step="any" placeholder="%" value={l.pct} onChange={(e) => set(l.id, "pct", e.target.value)} style={{ maxWidth: 90 }} />
          <input placeholder="observações (opcional)" value={l.obs || ""} onChange={(e) => set(l.id, "obs", e.target.value)} style={{ flex: 1, minWidth: 120 }} />
          <button className="btn btn-mini" onClick={() => del(l.id)}>remover</button>
        </div>
      ))}
      <div className="rep-tools" style={{ marginBottom: 4 }}>
        <button className="btn btn-ghost" onClick={add}>+ Adicionar sócio</button>
        {linhas.length > 0 && <span className="muted small" style={{ alignSelf: "center" }}>soma: <b style={{ color: soma === 100 ? "var(--pos)" : "var(--muted)" }}>{soma}%</b></span>}
      </div>
    </div>
  );
}

/* ---------------- área "Sociedade atual" (editável) + histórico -------- */
function SociedadeAtual({ socios, hist, socioNames, onQuickSocio, onSave, canDelete }) {
  const [editando, setEditando] = useState(false);
  const [linhas, setLinhas] = useState([]);
  const [verHist, setVerHist] = useState(false);
  const abrir = () => { setLinhas((socios || []).map((s) => ({ id: s.id || uid(), nome: s.nome || "", pct: s.pct ?? "", obs: s.obs || "" }))); setEditando(true); };
  const salvar = () => { onSave(linhas); setEditando(false); };

  return (
    <div className="fsec">
      <div className="fsec-h">Sociedade atual <span className="muted small hint">— informativo (composição societária do animal)</span></div>

      {!editando ? (
        <>
          {(socios || []).length > 0 ? (
            <table className="tbl">
              <thead><tr><th>Sócio</th><th>Porcentagem</th><th>Observações</th></tr></thead>
              <tbody>{socios.map((s, i) => (<tr key={s.id || i}><td>{s.nome}</td><td>{num(s.pct)}%</td><td className="muted">{s.obs || "—"}</td></tr>))}</tbody>
              <tfoot><tr><td><b>Total</b></td><td colSpan={2}><b>{socios.reduce((x, s) => x + num(s.pct), 0)}%</b></td></tr></tfoot>
            </table>
          ) : <p className="muted small">Nenhuma sociedade registrada ainda.</p>}
          <div className="rep-tools" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={abrir}>{(socios || []).length ? "Editar sociedade atual" : "Registrar sociedade atual"}</button>
            {(hist || []).length > 0 && <button className="btn btn-ghost" onClick={() => setVerHist((v) => !v)}>{verHist ? "Ocultar histórico" : `Histórico de sociedade (${hist.length})`}</button>}
          </div>
        </>
      ) : (
        <div className="venda-form">
          <LinhasSocios linhas={linhas} setLinhas={setLinhas} socioNames={socioNames} onQuickSocio={onQuickSocio} />
          <div className="rep-tools">
            <button className="btn btn-gold" onClick={salvar}>Salvar sociedade</button>
            <button className="btn btn-ghost" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
          <p className="muted small">Edição informativa: não gera boletos nem cobranças. A composição anterior permanece no histórico.</p>
        </div>
      )}

      {verHist && (hist || []).length > 0 && (
        <div className="timeline" style={{ marginTop: 14 }}>
          {hist.slice().reverse().map((h) => (
            <div className="tl-item" key={h.id}><div className="tl-dot" /><div className="tl-body">
              <div className="tl-top"><Badge tone="gold">Alteração de sociedade</Badge><span className="tl-date">{dataBR(h.data)}</span></div>
              {h.vendaDesc && <div className="small">Venda: {h.vendaDesc}</div>}
              <div className="soc-hist">
                <div><div className="muted small">Antes</div>{(h.antes || []).length ? (h.antes || []).map((s, i) => <div key={i} className="small">{s.nome} — {num(s.pct)}%</div>) : <div className="small muted">—</div>}</div>
                <div><div className="muted small">Depois</div>{(h.depois || []).length ? (h.depois || []).map((s, i) => <div key={i} className="small">{s.nome} — {num(s.pct)}%</div>) : <div className="small muted">—</div>}</div>
              </div>
              {h.obs && <div className="muted small">Obs.: {h.obs}</div>}
            </div></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ seção Vendas --------------------------- */
function VendasSecao({ a, vendas, partAtual, socAtual, socioNames, onQuickSocio, onAdd, onDel, canDelete }) {
  const vazio = { tipo: TIPOS_VENDA[0], comprador: "", data: today(), valor: "", valorParcela: "", parcelas: "", dataInicial: today(), obs: "" };
  const [f, setF] = useState(vazio);
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState([]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const ehPart = f.tipo === "Venda de participação";

  // nomes para autocomplete: vendedores = sócios da sociedade atual + banco global; compradores = banco global
  const nomesSociedade = (socAtual || []).map((s) => s.nome).filter(Boolean);
  const nomesVendedor = [...new Set([...nomesSociedade, ...(socioNames || [])])];
  const nomesComprador = [...new Set(socioNames || [])];

  const setLinha = (id, k, v) => setLinhas(linhas.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  const addLinha = () => setLinhas([...linhas, { id: uid(), vendedor: "", pct: "", comprador: "" }]);
  const delLinha = (id) => setLinhas(linhas.filter((l) => l.id !== id));

  const previa = ehPart ? aplicarVendaSociedade(socAtual, linhas) : [];
  const erroLinhas = ehPart ? validarVendaLinhas(socAtual, linhas) : "";
  const somaPrevia = previa.reduce((s, x) => s + num(x.pct), 0);

  const abrirForm = () => {
    setF(vazio);
    setLinhas([{ id: uid(), vendedor: nomesSociedade[0] || "", pct: "", comprador: "" }]);
    setAberto(true);
  };
  const salvar = () => {
    if (!num(f.valor) && !num(f.valorParcela)) return;
    if (ehPart && erroLinhas) return;
    const linhasLimpa = ehPart ? linhas.filter((l) => l.vendedor && l.comprador && num(l.pct) > 0)
      .map((l) => ({ vendedor: l.vendedor.trim(), pct: num(l.pct), comprador: l.comprador.trim() })) : [];
    const totalPct = linhasLimpa.reduce((s, l) => s + l.pct, 0);
    const v = {
      id: uid(), tipo: f.tipo, data: f.data,
      comprador: ehPart ? [...new Set(linhasLimpa.map((l) => l.comprador))].join(", ") : (f.comprador || "").trim(),
      valor: num(f.valor) || num(f.valorParcela) * num(f.parcelas),
      pctVendida: ehPart ? totalPct : 0,
      linhas: linhasLimpa,
      valorParcela: num(f.valorParcela), parcelas: Math.max(0, Math.round(num(f.parcelas))),
      dataInicial: f.dataInicial, obs: (f.obs || "").trim(),
    };
    onAdd(v);
    setF(vazio); setLinhas([]); setAberto(false);
  };

  return (
    <div className="fsec">
      <div className="fsec-h">Vendas
        <span className="muted small hint">— participação atual: <b style={{ color: partAtual <= 0 ? "var(--neg)" : "var(--ink)" }}>{partAtual}%</b>{partAtual <= 0 && num(a.porcentagemComprada) > 0 ? " (100% vendido)" : ""}</span>
      </div>

      {vendas.length > 0 && (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Data</th><th>Tipo</th><th>Comprador</th><th>%</th><th>Valor</th><th>Parcelas</th><th></th></tr></thead>
          <tbody>{vendas.slice().sort((x, y) => (y.data || "").localeCompare(x.data || "")).map((v) => {
            const pv = parcelasVenda(v);
            return (
              <tr key={v.id}>
                <td>{dataBR(v.data)}</td><td>{v.tipo}</td><td>{v.comprador || "—"}</td>
                <td>{v.pctVendida ? v.pctVendida + "%" : "—"}</td>
                <td className="pos">{fmt(v.valor)}</td>
                <td>{pv.length ? `${pv.length}× ${fmt(v.valorParcela)}` : "à vista"}{pv.length ? ` (1º ${dataBR(v.dataInicial)})` : ""}</td>
                <td>{canDelete && <button className="btn btn-mini" onClick={() => onDel(v.id)}>excluir</button>}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={4}><b>Total vendido</b></td><td className="pos"><b>{fmt(vendas.reduce((s, v) => s + num(v.valor), 0))}</b></td><td colSpan={2}></td></tr></tfoot>
        </table></div>
      )}
      {vendas.length === 0 && <p className="muted small">Nenhuma venda registrada.</p>}

      {!aberto ? (
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={abrirForm}>+ Registrar venda</button>
      ) : (
        <div className="venda-form">
          <div className="grid">
            <label className="field"><span>Tipo de venda</span>
              <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>{TIPOS_VENDA.map((t) => <option key={t}>{t}</option>)}</select></label>
            {!ehPart && <label className="field"><span>Comprador</span><input value={f.comprador} onChange={(e) => set("comprador", e.target.value)} /></label>}
            <label className="field"><span>Data da venda</span><input type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></label>
            <label className="field"><span>Valor total da venda</span><input type="number" step="any" placeholder="R$ 0" value={f.valor} onChange={(e) => set("valor", e.target.value)} /></label>
            <label className="field"><span>Valor da parcela (se parcelado)</span><input type="number" step="any" placeholder="R$ 0" value={f.valorParcela} onChange={(e) => set("valorParcela", e.target.value)} /></label>
            <label className="field"><span>Qtd. de parcelas</span><input type="number" step="any" placeholder="0" value={f.parcelas} onChange={(e) => set("parcelas", e.target.value)} /></label>
            <label className="field"><span>1º vencimento</span><input type="date" value={f.dataInicial} onChange={(e) => set("dataInicial", e.target.value)} /></label>
            <label className="field wide"><span>Observações</span><textarea rows={2} value={f.obs} onChange={(e) => set("obs", e.target.value)} /></label>
          </div>

          {ehPart && (
            <div style={{ marginTop: 8 }}>
              <div className="fsec-h" style={{ fontSize: 14 }}>Participação vendida por sócio <span className="muted small hint">— quem vende, quanto, e para quem</span></div>
              {linhas.map((l) => (
                <div className="socio-row venda-linha" key={l.id}>
                  <div className="socio-auto"><AutoField value={l.vendedor} onChange={(v) => setLinha(l.id, "vendedor", v)} suggestions={nomesVendedor} onCreate={onQuickSocio} placeholder="sócio vendedor" /></div>
                  <input type="number" step="any" placeholder="%" value={l.pct} onChange={(e) => setLinha(l.id, "pct", e.target.value)} style={{ maxWidth: 80 }} />
                  <div className="socio-auto"><AutoField value={l.comprador} onChange={(v) => setLinha(l.id, "comprador", v)} suggestions={nomesComprador} onCreate={onQuickSocio} placeholder="comprador" /></div>
                  <button className="btn btn-mini" onClick={() => delLinha(l.id)}>remover</button>
                </div>
              ))}
              <div className="rep-tools" style={{ marginBottom: 4 }}>
                <button className="btn btn-ghost" onClick={addLinha}>+ Adicionar linha</button>
              </div>

              {erroLinhas && <div className="auth-erro">{erroLinhas}</div>}

              <div className="previa-soc">
                <div className="muted small" style={{ marginBottom: 4 }}>Sociedade após a venda (calculada automaticamente):</div>
                {previa.length ? previa.map((s, i) => (
                  <div key={i} className="small">• {s.nome} — <b>{num(s.pct)}%</b></div>
                )) : <div className="small muted">— preencha as linhas acima —</div>}
                {previa.length > 0 && <div className="small" style={{ marginTop: 4 }}>Total: <b style={{ color: somaPrevia === 100 ? "var(--pos)" : "var(--muted)" }}>{somaPrevia}%</b></div>}
              </div>
            </div>
          )}

          <div className="rep-tools">
            <button className="btn btn-gold" onClick={salvar} disabled={ehPart && !!erroLinhas}>Salvar venda</button>
            <button className="btn btn-ghost" onClick={() => { setF(vazio); setLinhas([]); setAberto(false); }}>Cancelar</button>
          </div>
          <p className="muted small">Dica: preencha "valor total" para venda à vista, ou "valor da parcela" + "qtd" para parcelado. A sociedade é recalculada sozinha a partir das linhas.</p>
        </div>
      )}
    </div>
  );
}

/* -------------------- seção Compra de participação adicional ----------- */
function ComprasAdicSecao({ a, compras, partAtual, socAtual, socioNames, onQuickSocio, onAdd, onDel, canDelete }) {
  const vazio = { data: today(), partFinal: "", valor: "", valorParcela: "", parcelas: "", dataInicial: today(), obs: "" };
  const [f, setF] = useState(vazio);
  const [aberto, setAberto] = useState(false);
  const [socLinhas, setSocLinhas] = useState([]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // participação adquirida = participação final informada − participação atual
  const adquirida = Math.round((num(f.partFinal) - partAtual) * 100) / 100;
  const partInvalida = f.partFinal !== "" && adquirida <= 0;

  const abrirForm = () => {
    setF(vazio);
    setSocLinhas((socAtual || []).map((s) => ({ id: uid(), nome: s.nome || "", pct: s.pct ?? "", obs: s.obs || "" })));
    setAberto(true);
  };
  const salvar = () => {
    if (adquirida <= 0) return;
    const c = {
      id: uid(), data: f.data, pctAdicional: adquirida, partFinal: num(f.partFinal),
      valor: num(f.valor) || num(f.valorParcela) * Math.max(0, Math.round(num(f.parcelas))),
      valorParcela: num(f.valorParcela), parcelas: Math.max(0, Math.round(num(f.parcelas))),
      dataInicial: f.dataInicial, obs: (f.obs || "").trim(),
    };
    onAdd(c, socLinhas);
    setF(vazio); setSocLinhas([]); setAberto(false);
  };

  return (
    <div className="fsec">
      <div className="fsec-h">Compras de participação adicional <span className="muted small hint">— quando você adquire mais uma parte do animal</span></div>

      {compras.length > 0 && (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Data</th><th>% adquirida</th><th>Valor</th><th>Parcelas</th><th></th></tr></thead>
          <tbody>{compras.slice().sort((x, y) => (y.data || "").localeCompare(x.data || "")).map((c) => {
            const pv = parcelasCompraAdic(c);
            return (
              <tr key={c.id}>
                <td>{dataBR(c.data)}</td><td>+{num(c.pctAdicional)}%{c.partFinal ? ` → ${num(c.partFinal)}%` : ""}</td>
                <td className="neg">{fmt(num(c.valor) || num(c.valorParcela) * num(c.parcelas))}</td>
                <td>{pv.length ? `${pv.length}× ${fmt(c.valorParcela)}` : "à vista"}{pv.length ? ` (1º ${dataBR(c.dataInicial)})` : ""}</td>
                <td>{canDelete && <button className="btn btn-mini" onClick={() => onDel(c.id)}>excluir</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {compras.length === 0 && <p className="muted small">Nenhuma compra adicional registrada.</p>}

      {!aberto ? (
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={abrirForm}>+ Registrar compra adicional</button>
      ) : (
        <div className="venda-form">
          <div className="grid">
            <label className="field"><span>Data da compra</span><input type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></label>
            <label className="field"><span>Participação atual após a compra (%)</span><input type="number" step="any" placeholder="ex.: 33,33" value={f.partFinal} onChange={(e) => set("partFinal", e.target.value)} /></label>
            <label className="field"><span>Valor negociado</span><input type="number" step="any" placeholder="R$ 0" value={f.valor} onChange={(e) => set("valor", e.target.value)} /></label>
            <label className="field"><span>Valor da parcela</span><input type="number" step="any" placeholder="R$ 0" value={f.valorParcela} onChange={(e) => set("valorParcela", e.target.value)} /></label>
            <label className="field"><span>Qtd. de parcelas</span><input type="number" step="any" placeholder="0" value={f.parcelas} onChange={(e) => set("parcelas", e.target.value)} /></label>
            <label className="field"><span>1º vencimento</span><input type="date" value={f.dataInicial} onChange={(e) => set("dataInicial", e.target.value)} /></label>
            <label className="field wide"><span>Observações</span><textarea rows={2} value={f.obs} onChange={(e) => set("obs", e.target.value)} /></label>
          </div>

          <div className="previa-soc" style={{ marginBottom: 10 }}>
            Participação anterior: <b>{partAtual}%</b>
            {f.partFinal !== "" && !partInvalida && <> · adquirida nesta compra: <b className="pos">{adquirida}%</b> · final: <b>{num(f.partFinal)}%</b></>}
          </div>
          {partInvalida && <div className="auth-erro">A participação final ({num(f.partFinal)}%) deve ser maior que a atual ({partAtual}%).</div>}

          <div style={{ marginTop: 4 }}>
            <div className="fsec-h" style={{ fontSize: 14 }}>Sociedade atual após a compra <span className="muted small hint">— preencha como ficou (informativo)</span></div>
            <LinhasSocios linhas={socLinhas} setLinhas={setSocLinhas} socioNames={socioNames} onQuickSocio={onQuickSocio} />
          </div>

          <div className="rep-tools">
            <button className="btn btn-gold" onClick={salvar} disabled={partInvalida || adquirida <= 0}>Salvar compra</button>
            <button className="btn btn-ghost" onClick={() => { setF(vazio); setSocLinhas([]); setAberto(false); }}>Cancelar</button>
          </div>
          <p className="muted small">Você informa só a participação final; o sistema calcula quanto foi adquirido. As parcelas antigas não mudam — esta compra gera apenas novas parcelas, e o total investido, as parcelas do mês e o resumo são atualizados automaticamente.</p>
        </div>
      )}
    </div>
  );
}

/* -------------------------- seção Pesagens / GMD ----------------------- */
function PesagensSecao({ a, onAdd, onDel, canDelete }) {
  const vazio = { data: today(), peso: "", marco: "", obs: "" };
  const [f, setF] = useState(vazio);
  const [aberto, setAberto] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const lista = pesagensCalc(a);
  const ultima = lista[lista.length - 1] || null;
  const primeira = lista[0] || null;
  // GMD geral (da 1ª à última pesagem)
  let gmdGeral = null;
  if (primeira && ultima && ultima !== primeira) {
    const d = diasEntre(primeira.data, ultima.data);
    if (d > 0) gmdGeral = Math.round(((ultima.peso - primeira.peso) / d) * 1000) / 1000;
  }
  // marcos: peso ao nascer e à desmama
  const nascer = lista.find((p) => p.marco === "nascer") || null;
  const desmama = lista.find((p) => p.marco === "desmama") || null;
  let gmdPreDesmama = null;
  if (nascer && desmama) {
    const d = diasEntre(nascer.data, desmama.data);
    if (d > 0) gmdPreDesmama = Math.round(((desmama.peso - nascer.peso) / d) * 1000) / 1000;
  }
  const chart = lista.map((p) => ({ data: dataBR(p.data).slice(0, 5), peso: p.peso }));

  const salvar = () => {
    if (!(num(f.peso) > 0) || !f.data) return;
    onAdd({ id: uid(), data: f.data, peso: num(f.peso), marco: f.marco || "", obs: (f.obs || "").trim() });
    setF(vazio); setAberto(false);
  };

  return (
    <div className="fsec">
      <div className="fsec-h">Pesagens & desempenho <span className="muted small hint">— peso em kg, marcos (nascer/desmama) e GMD</span></div>

      {(nascer || desmama) && (
        <div className="pes-marcos">
          {nascer && <span className="marco-tag nasc">🐣 Ao nascer: <b>{nascer.peso} kg</b> ({dataBR(nascer.data)})</span>}
          {desmama && <span className="marco-tag desm">🌾 À desmama: <b>{desmama.peso} kg</b> ({dataBR(desmama.data)})</span>}
          {gmdPreDesmama != null && <span className="marco-tag gmd">GMD nascer→desmama: <b>{gmdPreDesmama} kg/dia</b></span>}
        </div>
      )}

      {lista.length > 0 && (
        <div className="pes-kpis">
          <div><span>Peso atual</span><b>{ultima.peso} kg</b></div>
          {ultima.gmd != null && <div><span>Último GMD</span><b className={ultima.gmd >= 0 ? "pos" : "neg"}>{ultima.gmd} kg/dia</b></div>}
          {gmdGeral != null && <div><span>GMD geral</span><b>{gmdGeral} kg/dia</b></div>}
          <div><span>Pesagens</span><b>{lista.length}</b></div>
        </div>
      )}

      {lista.length >= 2 && (
        <div style={{ marginTop: 10 }}>
          <ResponsiveContainer width="100%" height={190}><LineChart data={chart} margin={{ left: 4, right: 12, top: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" /><XAxis dataKey="data" tick={{ fontSize: 11, fill: "#5a5346" }} /><YAxis tick={{ fontSize: 11, fill: "#5a5346" }} width={40} />
            <Tooltip formatter={(v) => [`${v} kg`, "Peso"]} /><Line type="monotone" dataKey="peso" stroke="#1d3a2b" strokeWidth={2.4} dot={{ r: 3, fill: "#C6A15B" }} /></LineChart></ResponsiveContainer>
        </div>
      )}

      {lista.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl">
          <thead><tr><th>Data</th><th>Peso (kg)</th><th>Marco</th><th>GMD (kg/dia)</th><th>Intervalo</th><th>Obs.</th><th></th></tr></thead>
          <tbody>{lista.slice().reverse().map((p) => (
            <tr key={p.id}>
              <td>{dataBR(p.data)}</td><td><b>{p.peso}</b></td>
              <td>{p.marco === "nascer" ? <span className="tag tag-video">🐣 nascer</span> : p.marco === "desmama" ? <span className="tag tag-video">🌾 desmama</span> : "—"}</td>
              <td>{p.gmd != null ? <span className={p.gmd >= 0 ? "pos" : "neg"}>{p.gmd}</span> : "—"}</td>
              <td>{p.dias != null ? `${p.dias} dias` : "1ª pesagem"}</td>
              <td className="muted small">{p.obs || "—"}</td>
              <td>{canDelete && <button className="btn btn-mini" onClick={() => onDel(p.id)}>excluir</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {lista.length === 0 && <p className="muted small">Nenhuma pesagem registrada.</p>}

      {!aberto ? (
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setF(vazio); setAberto(true); }}>+ Registrar pesagem</button>
      ) : (
        <div className="venda-form">
          <div className="grid">
            <label className="field"><span>Data da pesagem</span><input type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></label>
            <label className="field"><span>Peso (kg)</span><input type="number" step="any" placeholder="ex.: 480" value={f.peso} onChange={(e) => set("peso", e.target.value)} /></label>
            <label className="field"><span>Marco</span>
              <select value={f.marco} onChange={(e) => set("marco", e.target.value)}>
                <option value="">Pesagem comum</option>
                <option value="nascer">Peso ao nascer</option>
                <option value="desmama">Peso à desmama</option>
              </select></label>
            <label className="field wide"><span>Observações</span><input value={f.obs} onChange={(e) => set("obs", e.target.value)} placeholder="opcional" /></label>
          </div>
          <div className="rep-tools">
            <button className="btn btn-gold" onClick={salvar} disabled={!(num(f.peso) > 0)}>Salvar pesagem</button>
            <button className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
          <p className="muted small">O GMD é calculado automaticamente entre pesagens. Marque "ao nascer" e "à desmama" para ver o ganho pré-desmama.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------- seção Descendência ------------------------- */
function DescendenciaSecao({ a, ativos, onAbrir }) {
  const nome = norm(a.nome);
  if (!nome) return null;
  // crias: registros onde este animal é mãe/doadora ou pai
  const comoMae = (ativos || []).filter((x) => x && x.id !== a.id && (norm(x.mae) === nome || norm(x.doadora) === nome));
  const comoPai = (ativos || []).filter((x) => x && x.id !== a.id && (norm(x.pai) === nome || norm(x.touro) === nome));
  const total = comoMae.length + comoPai.length;
  if (total === 0) return null;

  const linha = (x) => (
    <div className="desc-item" key={x.id} onClick={() => onAbrir(x)}>
      <div><b>{x.nome}</b> <span className="tag">{x.tipo}</span>{x.origem === "genealogia" && <span className="tag">ancestral</span>}</div>
      <div className="muted small">{x.registro ? `Reg. ${x.registro} · ` : ""}{x.sexo || ""}{x.nascimento ? ` · ${dataBR(x.nascimento)}` : ""}</div>
    </div>
  );

  return (
    <div className="fsec">
      <div className="fsec-h">Descendência <span className="muted small hint">— crias vinculadas a este animal ({total})</span></div>
      {comoMae.length > 0 && <>
        <div className="desc-sub">Como mãe / doadora ({comoMae.length})</div>
        <div className="desc-lista">{comoMae.map(linha)}</div>
      </>}
      {comoPai.length > 0 && <>
        <div className="desc-sub" style={{ marginTop: 10 }}>Como pai ({comoPai.length})</div>
        <div className="desc-lista">{comoPai.map(linha)}</div>
      </>}
    </div>
  );
}

/* -------------------------- seção Situação (Ativo/Inativo) ------------- */
const MOTIVOS_INATIVO = ["Venda total da participação", "Falecimento", "Aposentadoria / fora de uso", "Outro motivo"];
function SituacaoSecao({ a, onInativar, onReativar }) {
  const [form, setForm] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVOS_INATIVO[0]);
  const part = participacaoAtual(a);
  const ativo = ehAtivo(a);
  const part0 = part <= 0;
  const faleceu = lc(a.inativadoMotivo || "").includes("falecimento");

  return (
    <div className="fsec">
      <div className="fsec-h">Situação do animal</div>
      <div className="sit-atual">
        <span>Situação atual:</span> {ativo ? <Badge tone="pos">ATIVO</Badge> : <Badge tone="neg">INATIVO</Badge>}
        {!ativo && <span className="muted small"> · {motivoInativo(a)}{a.inativadoEm ? ` (${dataBR(a.inativadoEm)})` : ""}</span>}
        <span className="muted small"> · Participação da SM: <b className={part0 ? "neg" : "pos"}>{part}%</b></span>
      </div>

      {part0 && (
        <p className="muted small" style={{ marginTop: 6 }}>Participação em 0% → o animal fica <b>inativo automaticamente</b>. Para reativar, registre uma participação maior que 0% (compra/recompra).</p>
      )}

      <div className="rep-tools" style={{ marginTop: 10 }}>
        {ativo && !form && <button className="btn btn-ghost" onClick={() => { setForm(true); setMotivo(MOTIVOS_INATIVO[0]); }}>Inativar animal</button>}
        {!ativo && !part0 && !faleceu && <button className="btn btn-gold" onClick={onReativar}>Reativar animal</button>}
        {!ativo && faleceu && <span className="muted small">Inativado por falecimento — reativação exige correção administrativa (reative mudando o motivo no histórico, se foi engano).</span>}
      </div>

      {form && (
        <div className="venda-form" style={{ marginTop: 8 }}>
          <div className="grid">
            <label className="field"><span>Motivo da inativação</span>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS_INATIVO.map((m) => <option key={m}>{m}</option>)}</select></label>
          </div>
          <p className="muted small">Inativar <b>não</b> zera a participação nem apaga o histórico financeiro. O animal sai da contagem de ativos, mas continua consultável em "Inativos / Todos".</p>
          <div className="rep-tools">
            <button className="btn btn-gold" onClick={() => { onInativar(motivo); setForm(false); }}>Confirmar inativação</button>
            <button className="btn btn-ghost" onClick={() => setForm(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ficha detalhe -------------------------- */
function Detalhe({ a, onEdit, onClose, onDelete, onUpdate, onAbrir, ativos, canDelete, socioNamesGlobais, onQuickSocio, onNascer, onGerarPrenhez, onConfirm }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!a) return null;
  const f = finance(a);
  const fase = faseAnimal(a, ativos);
  const com = f.com;
  const pctSocios = (a.socios || []).filter(Boolean).reduce((s, x) => s + num(x.pct), 0);
  const titulo = { animal: "Animal", prenhez: "Prenhez", aspiracao: "Aspiração" }[a.tipo];
  const Info = ({ l, v }) => (v || v === 0 ? <div className="info"><span>{l}</span><b>{v}</b></div> : null);
  const socioNames = (a.socios || []).filter(Boolean).map((s) => s.nome).filter(Boolean);

  const setPago = (i, vp) => onUpdate({ ...a, parcelasList: f.list.map((p, idx) => idx === i ? { ...p, valorPago: vp, auto: false, dataPagamento: vp > 0 ? today() : "" } : p) });
  const setParcela = (i, k, v) => onUpdate({ ...a, parcelasList: f.list.map((p, idx) => idx === i ? { ...p, [k]: v } : p) });

  const vendas = vendasDo(a);
  const partAtual = participacaoAtual(a);
  const socAtual = (a.sociedadeAtual || a.socios || []).filter(Boolean);
  const socVenda = sociedadeComDono(a);
  const socBase = (a.sociedadeBase && a.sociedadeBase.length) ? a.sociedadeBase : socVenda;

  const recomputeSoc = (base, lista) => {
    const parts = (lista || []).filter((v) => v.tipo === "Venda de participação" && Array.isArray(v.linhas))
      .slice().sort((x, y) => (x.data || "").localeCompare(y.data || ""));
    let cur = (base || []).map((s) => ({ ...s }));
    parts.forEach((v) => { cur = aplicarVendaSociedade(cur, v.linhas); });
    return cur;
  };

  const addVenda = (v) => {
    const hist = { id: uid(), data: today(), tipo: "Venda registrada", desc: `${v.tipo}${v.pctVendida ? " — " + v.pctVendida + "%" : ""} por ${fmt(v.valor)}`, responsavel: "" };
    const patch = { ...a, vendas: [...vendas, v], historico: [...(a.historico || []), hist] };
    if (v.tipo === "Venda de participação") {
      const antes = socVenda;
      if (!(a.sociedadeBase && a.sociedadeBase.length)) {
        patch.sociedadeBase = antes.map((s) => ({ id: uid(), nome: s.nome, pct: num(s.pct), obs: s.obs || "" }));
      }
      const depois = aplicarVendaSociedade(antes, v.linhas);
      patch.sociedadeAtual = depois;
      const compradores = [...new Set((v.linhas || []).map((l) => (l.comprador || "").trim()).filter(Boolean))];
      patch.sociedadeHist = [...(a.sociedadeHist || []), {
        id: uid(), data: v.data || today(), vendaId: v.id,
        vendaDesc: `Venda de participação · ${fmt(v.valor)}`,
        antes, depois, linhas: v.linhas || [], comprador: compradores.join(", "), obs: v.obs || "",
      }];
      // cria compradores novos no banco global de sócios
      (v.linhas || []).forEach((l) => { if (l.comprador && onQuickSocio) onQuickSocio(l.comprador.trim()); });
    }
    onUpdate(patch);
  };

  const delVendaExec = (id) => {
    const restantes = vendas.filter((v) => v.id !== id);
    const patch = { ...a, vendas: restantes };
    const base = (a.sociedadeBase && a.sociedadeBase.length) ? a.sociedadeBase : socAtual;
    patch.sociedadeAtual = recomputeSoc(base, restantes);
    patch.sociedadeHist = (a.sociedadeHist || []).filter((h) => h.vendaId !== id);
    onUpdate(patch);
  };
  const delVenda = (id) => {
    if (!onConfirm) return delVendaExec(id);
    onConfirm({ titulo: "Excluir esta venda?", mensagem: "A venda será removida e a sociedade será recalculada. Esta ação não pode ser desfeita.", usos: [], botoes: [{ label: "Excluir", tone: "danger", onClick: () => { delVendaExec(id); onConfirm(null); } }] });
  };
  const setSociedadeAtual = (linhas) => onUpdate({ ...a, sociedadeAtual: (linhas || []).filter((s) => s && (s.nome || s.pct)) });
  const inativar = (motivo) => onUpdate({ ...a, situacao: "Inativo", inativadoMotivo: motivo, inativadoEm: today(),
    historico: [...(a.historico || []), { id: uid(), data: today(), tipo: "Inativação", desc: `Inativado: ${motivo}`, responsavel: "" }] });
  const reativar = () => onUpdate({ ...a, situacao: "Ativo", inativadoMotivo: "", inativadoEm: "",
    historico: [...(a.historico || []), { id: uid(), data: today(), tipo: "Reativação", desc: "Reativado", responsavel: "" }] });
  const addPesagem = (p) => onUpdate({ ...a, pesagens: [...(a.pesagens || []), p] });
  const delPesagem = (id) => onUpdate({ ...a, pesagens: (a.pesagens || []).filter((p) => p.id !== id) });

  const addCompraAdic = (c, socLinhas) => {
    const antes = partAtual;
    const depois = Math.round((antes + num(c.pctAdicional)) * 100) / 100;
    const valorTotal = num(c.valor) || num(c.valorParcela) * Math.max(0, Math.round(num(c.parcelas)));
    const hist = { id: uid(), data: c.data || today(), tipo: "Compra adicional", desc: `+${num(c.pctAdicional)}% por ${fmt(valorTotal)}`, responsavel: "" };
    const antesSoc = socAtual;
    const depoisSoc = (socLinhas || []).filter((s) => s && (s.nome || s.pct)).map((s) => ({ id: uid(), nome: (s.nome || "").trim(), pct: num(s.pct), obs: s.obs || "" }));
    const patch = { ...a, comprasAdic: [...(a.comprasAdic || []), c], historico: [...(a.historico || []), hist] };
    if (depoisSoc.length) patch.sociedadeAtual = depoisSoc;
    patch.sociedadeHist = [...(a.sociedadeHist || []), {
      id: uid(), data: c.data || today(), compraId: c.id, tipoMov: "compra",
      vendaDesc: `Compra adicional +${num(c.pctAdicional)}% · ${fmt(valorTotal)}`,
      participacaoAntes: antes, participacaoDepois: depois, pctAdicional: num(c.pctAdicional),
      antes: antesSoc, depois: depoisSoc.length ? depoisSoc : antesSoc, obs: c.obs || "",
    }];
    (socLinhas || []).forEach((s) => { if (s.nome && onQuickSocio) onQuickSocio(s.nome.trim()); });
    onUpdate(patch);
  };
  const delCompraAdicExec = (id) => {
    const patch = { ...a, comprasAdic: (a.comprasAdic || []).filter((c) => c.id !== id) };
    patch.sociedadeHist = (a.sociedadeHist || []).filter((h) => h.compraId !== id);
    onUpdate(patch);
  };
  const delCompraAdic = (id) => {
    if (!onConfirm) return delCompraAdicExec(id);
    onConfirm({ titulo: "Excluir esta compra adicional?", mensagem: "A compra e suas parcelas serão removidas do cálculo. As parcelas originais não são afetadas. Esta ação não pode ser desfeita.", usos: [], botoes: [{ label: "Excluir", tone: "danger", onClick: () => { delCompraAdicExec(id); onConfirm(null); } }] });
  };
  const comprasAdic = (a.comprasAdic || []).filter(Boolean);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal ficha" onClick={(e) => e.stopPropagation()}>
        <div className="ficha-hero no-media">
          <div className="ficha-hero-info">
            <div className="eyebrow">{titulo}{a.raca ? ` · ${a.raca}` : ""}{a.origem === "genealogia" ? " · ancestral" : ""}</div>
            <h2 className="serif">{a.nome}</h2>
            <div className="chips">
              {fase && <Badge tone="fase">{fase}</Badge>}
              {a.status && a.tipo !== "animal" && <Badge tone={statusTone(a.status)}>{a.status}</Badge>}
              {a.registro && <Badge tone="gold">Reg. {a.registro}</Badge>}
              {a.tipo === "animal" && a.nascimento && <Badge tone="gold">{idade(a.nascimento)}</Badge>}
              {a.ondeEsta && <Badge tone="gold">📍 {a.ondeEsta}</Badge>}
              {(a.tipo === "prenhez" || a.tipo === "aspiracao") && <Badge tone="gold">Restam {qtdRest(a)} de {qtdTotal(a)}</Badge>}
              {alertaParto(a) === "atrasado" && <Badge tone="neg">Parto atrasado</Badge>}
              {["hoje", "7", "15", "30"].includes(alertaParto(a)) && <Badge tone="gold">Parto em {diasAteParto(a)} dia(s)</Badge>}
              {a.origemLabel && (() => { const org = a.origemId && (ativos || []).find((x) => x.id === a.origemId); return <span onClick={() => org && onAbrir && onAbrir(org)} style={{ cursor: org ? "pointer" : "default" }}><Badge tone="gold">Origem: {a.origemLabel}{org ? " ↗" : ""}</Badge></span>; })()}
            </div>
            <div className="ficha-actions"><button className="btn btn-gold" onClick={onEdit}>Editar</button>
              {a.tipo === "aspiracao" && a.origem !== "genealogia" && onGerarPrenhez && <button className="btn btn-ghost" onClick={() => onGerarPrenhez(a)}>+ Gerar prenhez</button>}
              {(a.tipo === "prenhez" || a.tipo === "aspiracao") && a.origem !== "genealogia" && qtdRest(a) > 0 && onNascer && <button className="btn btn-gold" onClick={() => onNascer(a)}>🐣 Nasceu</button>}
              {canDelete && <button className="btn btn-ghost" onClick={onDelete}>Excluir</button>}<button className="x abs" onClick={onClose}>✕</button></div>
          </div>
        </div>

        <div className="modal-body">
          <div className="fin-cards">
            <KPI label="Valor pago pela cota" value={fmt(f.cota)} sub={`${f.pct || 0}% comprado`} />
            <KPI label="Valor total estimado" value={fmt(f.totalEstimado)} tone="gold" />
            <KPI label="Valor final c/ custos" value={fmt(f.finalEstimado)} sub={`custos ${fmt(f.custos)}`} />
            <KPI label="Parcelas" value={`${f.pagas}/${f.qtd || "—"}`} sub={f.ultimoVenc ? `até ${dataBR(f.ultimoVenc)}` : ""} />
          </div>
          <div className="fin-cards">
            <KPI label="Já pago" value={fmt(f.jaPago)} tone="pos" />
            <KPI label="Em aberto" value={fmt(f.emAberto)} tone="neg" />
            <KPI label="Próxima parcela" value={dataBR(f.proxima)} sub={`${f.devidas} já venceram`} />
            <KPI label="Vencidas em aberto" value={f.vencidas.length} tone={f.vencidas.length ? "neg" : ""} />
          </div>
          <div className="fin-cards">
            <KPI label="Comissão" value={fmt(com.total)} sub={`${com.pct}%`} />
            <KPI label="Base da comissão" value={com.base} />
            <KPI label="Frete" value={fmt(num(a.frete))} />
            <KPI label="Outros custos" value={fmt(num(a.outros))} />
          </div>

          {a.tipo === "aspiracao" && (
            <div className="fin-cards">
              <KPI label="Custo/embrião produzido" value={fmt(num(a.embrioes) ? f.finalEstimado / num(a.embrioes) : 0)} />
              <KPI label="Custo/embrião viável" value={fmt(num(a.viaveis) ? f.finalEstimado / num(a.viaveis) : 0)} />
              <KPI label="Custo/prenhez confirm." value={fmt(num(a.prenhezes) ? f.finalEstimado / num(a.prenhezes) : 0)} />
              <KPI label="Aproveitamento" value={`${num(a.embrioes) && num(a.oocitos) ? Math.round((num(a.embrioes) / num(a.oocitos)) * 100) : 0}%`} sub="embriões/oócitos" />
            </div>
          )}

          <div className="fsec"><div className="fsec-h">Genealogia</div><Genealogia a={a} />{a.obsGen && <p className="obs">{a.obsGen}</p>}</div>

          <div className="fsec"><div className="fsec-h">Dados</div>
            <div className="info-grid">
              {a.tipo === "animal" && <><Info l="Criatório responsável" v={a.ondeEsta} /><Info l="Sexo" v={a.sexo} /><Info l="Nascimento" v={dataBR(a.nascimento)} />{a.maeRegistro && <Info l="Registro da mãe" v={a.maeRegistro} />}</>}
              {a.tipo === "prenhez" && <><Info l="Mãe doadora" v={a.doadora} /><Info l="Registro da mãe" v={a.regDoadora} /><Info l="Pai" v={a.pai} />
                <Info l="Quantidade" v={qtdRestante(a)} /><Info l="Criatório responsável" v={a.ondeEsta} /></>}
              {a.tipo === "aspiracao" && <><Info l="Mãe doadora" v={a.doadora} /><Info l="Registro da mãe" v={a.regDoadora} /><Info l="Pai" v={a.pai} />
                <Info l="Quantidade" v={qtdRestante(a)} /><Info l="Criatório responsável" v={a.ondeEsta} /></>}
              <Info l="Leilão / origem" v={a.leilao} /><Info l="Vendedor" v={a.vendedor} /><Info l="Data da compra" v={dataBR(a.dataCompra)} />
            </div>
            {a.obs && <p className="obs">{a.obs}</p>}
          </div>

          {(f.qtd > 0 || comprasAdic.length > 0) && (() => {
            const linhas = parcelasUnificadas(a);
            const temAdic = comprasAdic.length > 0;
            return (
            <div className="fsec"><div className="fsec-h">Parcelas <span className="muted small">— clique no status para pagar/estornar{temAdic ? "; meses com compra adicional aparecem somados" : ""}</span></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Valor pago</th><th>Pago em</th><th>Observações</th></tr></thead>
                <tbody>
                  {linhas.map((r) => {
                    const st = parcStatus({ valorPago: r.valorPago, valor: r.valor, venc: r.venc });
                    const temBase = r.baseIdx >= 0;
                    const baseQuitada = r.valorPagoBase >= r.valorBase && r.valorBase > 0;
                    return (
                      <tr key={r.ym} className={st === "vencido" ? "row-late" : ""}>
                        <td>{r.numero}</td><td>{dataBR(r.venc)}</td>
                        <td>{fmt(r.valor)}{r.valorAdic > 0 && r.valorBase > 0 ? <div className="muted small">orig {fmt(r.valorBase)} + adic {fmt(r.valorAdic)}</div> : r.valorAdic > 0 ? <div className="muted small">compra adicional</div> : null}</td>
                        <td><button className={`pstatus ${st}`} disabled={!temBase} title={temBase ? "" : "parcela de compra adicional — paga automaticamente pela data"} onClick={() => temBase && setPago(r.baseIdx, baseQuitada ? 0 : r.valorBase)}>{st}</button></td>
                        <td>{temBase
                          ? <input className="mini-inp pay-inp" type="number" step="any" value={r.valorPagoBase || ""} onChange={(e) => setPago(r.baseIdx, num(e.target.value))} title="valor pago da compra original (a adicional é automática)" />
                          : <span className="muted">{fmt(r.valorPago)}</span>}</td>
                        <td>{r.valorPago > 0 ? "pago" : "—"}{(r.autoBase || r.autoAdic) ? " (auto)" : ""}</td>
                        <td>{temBase
                          ? <input className="mini-inp obs-inp" placeholder="observações" value={r.obs || ""} onChange={(e) => setParcela(r.baseIdx, "obs", e.target.value)} />
                          : <span className="muted small">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {linhas.length > 0 && <tfoot><tr><td colSpan={2}><b>Total</b></td><td colSpan={5}><b>{fmt(linhas.reduce((s, r) => s + r.valor, 0))}</b> em {linhas.length} parcela(s){temAdic ? " (compra original + adicionais)" : ""}</td></tr></tfoot>}
              </table></div></div>
            );
          })()}

          {a.tipo === "animal" && a.origem !== "genealogia" && (
            <SociedadeAtual socios={socAtual} hist={a.sociedadeHist || []} socioNames={socioNamesGlobais || []} onQuickSocio={onQuickSocio} onSave={setSociedadeAtual} canDelete={canDelete} />
          )}
          {a.tipo !== "animal" && (a.socios || []).length > 0 && (
            <div className="fsec"><div className="fsec-h">Sociedade <span className="muted small hint">— apenas informativo</span></div>
              <table className="tbl">
                <thead><tr><th>Sócio</th><th>Porcentagem</th></tr></thead>
                <tbody>{a.socios.map((s) => (
                  <tr key={s.id}><td>{s.nome}</td><td>{s.pct}%</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {(a.videos || []).some((v) => v && v.url) && (
            <div className="fsec"><div className="fsec-h">Vídeos</div><div className="videos-list">{a.videos.filter((v) => v && v.url).map((v) => <VideoBlock key={v.id} v={v} />)}</div></div>
          )}

          {a.tipo === "animal" && a.origem !== "genealogia" && (
            <SituacaoSecao a={a} onInativar={inativar} onReativar={reativar} />
          )}

          {a.tipo === "animal" && a.origem !== "genealogia" && (
            <PesagensSecao a={a} onAdd={addPesagem} onDel={delPesagem} canDelete={canDelete} />
          )}

          <DescendenciaSecao a={a} ativos={ativos} onAbrir={(x) => onAbrir && onAbrir(x)} />

          {a.tipo === "animal" && a.origem !== "genealogia" && (
            <VendasSecao a={a} vendas={vendas} partAtual={partAtual} socAtual={socVenda} socioNames={socioNamesGlobais || []} onQuickSocio={onQuickSocio} onAdd={addVenda} onDel={delVenda} canDelete={canDelete} />
          )}

          {a.tipo === "animal" && a.origem !== "genealogia" && (
            <ComprasAdicSecao a={a} compras={comprasAdic} partAtual={partAtual} socAtual={socAtual} socioNames={socioNamesGlobais || []} onQuickSocio={onQuickSocio} onAdd={addCompraAdic} onDel={delCompraAdic} canDelete={canDelete} />
          )}

          <div className="fsec"><div className="fsec-h">Histórico</div>
            <div className="timeline">
              {(a.historico || []).length === 0 && <p className="muted">Sem eventos.</p>}
              {(a.historico || []).slice().reverse().map((h) => (
                <div className="tl-item" key={h.id}><div className="tl-dot" /><div className="tl-body">
                  <div className="tl-top"><Badge tone="gold">{h.tipo}</Badge><span className="tl-date">{dataBR(h.data)}</span></div>
                  <div>{h.desc}</div>{h.responsavel && <div className="muted small">Responsável: {h.responsavel}</div>}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ autenticação --------------------------- */
function Auth() {
  const [modo, setModo] = useState("login");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [reg, setReg] = useState({ nome: "", email: "", senha: "", confirmar: "" });
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const entrar = async () => {
    if (!email || !senha) { setErro("Informe e-mail e senha."); return; }
    setBusy(true); setErro(""); setOk("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) { setErro(traduzErro(error.message)); setBusy(false); }
      // se der certo, o App detecta a sessão e troca de tela sozinho
    } catch (e) { setErro("Falha de conexão. Verifique sua internet."); setBusy(false); }
  };
  const criar = async () => {
    if (!reg.nome || !reg.email || !reg.senha) { setErro("Preencha nome, e-mail e senha."); return; }
    if (!reg.email.includes("@")) { setErro("Informe um e-mail válido."); return; }
    if (reg.senha.length < 6) { setErro("A senha deve ter ao menos 6 caracteres."); return; }
    if (reg.senha !== reg.confirmar) { setErro("As senhas não coincidem."); return; }
    setBusy(true); setErro(""); setOk("");
    try {
      const { error } = await supabase.auth.signUp({
        email: reg.email.trim(), password: reg.senha,
        options: { data: { nome: reg.nome.trim() } },
      });
      setBusy(false);
      if (error) { setErro(traduzErro(error.message)); return; }
      setOk("Conta criada! Se você for o primeiro usuário do sistema, já entrou como administrador. Caso contrário, aguarde a aprovação do administrador.");
      setModo("login"); setEmail(reg.email); setReg({ nome: "", email: "", senha: "", confirmar: "" });
    } catch (e) { setErro("Falha de conexão. Verifique sua internet."); setBusy(false); }
  };
  const recuperar = async () => {
    if (!email || !email.includes("@")) { setErro("Informe o e-mail da sua conta."); return; }
    setBusy(true); setErro(""); setOk("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      setBusy(false);
      if (error) { setErro(traduzErro(error.message)); return; }
      setOk("Enviamos um link de redefinição para o seu e-mail. Abra-o neste aparelho e defina a nova senha.");
      setModo("login");
    } catch (e) { setErro("Falha de conexão. Verifique sua internet."); setBusy(false); }
  };
  const onKey = (fn) => (ev) => { if (ev.key === "Enter") fn(); };

  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-brand"><div className="brand-mark">SM</div>
          <div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div>

        {modo === "login" ? (
          <>
            <div className="auth-h">Entrar</div>
            <label className="auth-field"><span>E-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" onKeyDown={onKey(entrar)} /></label>
            <label className="auth-field"><span>Senha</span><input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={onKey(entrar)} /></label>
            {erro && <div className="auth-erro">{erro}</div>}
            {ok && <div className="auth-ok">{ok}</div>}
            <button className="btn btn-gold auth-btn" disabled={busy} onClick={entrar}>{busy ? "Entrando…" : "Entrar"}</button>
            <button className="auth-link" onClick={() => { setModo("cadastro"); setErro(""); setOk(""); }}>Novo usuário / Criar conta</button>
            <button className="auth-link" style={{ marginTop: 4, fontWeight: 400 }} onClick={() => { setModo("recuperar"); setErro(""); setOk(""); }}>Esqueci minha senha</button>
          </>
        ) : modo === "recuperar" ? (
          <>
            <div className="auth-h">Recuperar senha</div>
            <label className="auth-field"><span>E-mail da sua conta</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" onKeyDown={onKey(recuperar)} /></label>
            {erro && <div className="auth-erro">{erro}</div>}
            {ok && <div className="auth-ok">{ok}</div>}
            <button className="btn btn-gold auth-btn" disabled={busy} onClick={recuperar}>{busy ? "Enviando…" : "Enviar link de redefinição"}</button>
            <button className="auth-link" onClick={() => { setModo("login"); setErro(""); setOk(""); }}>Voltar para Entrar</button>
          </>
        ) : (
          <>
            <div className="auth-h">Criar conta</div>
            <label className="auth-field"><span>Nome</span><input value={reg.nome} onChange={(e) => setReg({ ...reg, nome: e.target.value })} /></label>
            <label className="auth-field"><span>E-mail</span><input type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} autoCapitalize="none" /></label>
            <label className="auth-field"><span>Senha (mín. 6 caracteres)</span><input type="password" value={reg.senha} onChange={(e) => setReg({ ...reg, senha: e.target.value })} /></label>
            <label className="auth-field"><span>Confirmar senha</span><input type="password" value={reg.confirmar} onChange={(e) => setReg({ ...reg, confirmar: e.target.value })} onKeyDown={onKey(criar)} /></label>
            {erro && <div className="auth-erro">{erro}</div>}
            <button className="btn btn-gold auth-btn" disabled={busy} onClick={criar}>{busy ? "Criando…" : "Criar conta"}</button>
            <button className="auth-link" onClick={() => { setModo("login"); setErro(""); setOk(""); }}>Já tenho conta — Entrar</button>
            <div className="auth-note">O primeiro cadastro do sistema vira administrador. Os demais precisam de aprovação.</div>
          </>
        )}
      </div>
    </div>
  );
}

/* Tela para definir nova senha (aberta pelo link do e-mail de recuperação) */
function NovaSenha({ onDone }) {
  const [s1, setS1] = useState(""); const [s2, setS2] = useState("");
  const [erro, setErro] = useState(""); const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (s1.length < 6) { setErro("A senha deve ter ao menos 6 caracteres."); return; }
    if (s1 !== s2) { setErro("As senhas não coincidem."); return; }
    setBusy(true); setErro("");
    try {
      const { error } = await supabase.auth.updateUser({ password: s1 });
      setBusy(false);
      if (error) { setErro(traduzErro(error.message)); return; }
      onDone();
    } catch (e) { setErro("Falha de conexão."); setBusy(false); }
  };
  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-brand"><div className="brand-mark">SM</div>
          <div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div>
        <div className="auth-h">Defina sua nova senha</div>
        <label className="auth-field"><span>Nova senha (mín. 6 caracteres)</span><input type="password" value={s1} onChange={(e) => setS1(e.target.value)} /></label>
        <label className="auth-field"><span>Confirmar nova senha</span><input type="password" value={s2} onChange={(e) => setS2(e.target.value)} /></label>
        {erro && <div className="auth-erro">{erro}</div>}
        <button className="btn btn-gold auth-btn" disabled={busy} onClick={salvar}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
      </div>
    </div>
  );
}

/* Tela para conta pendente/bloqueada */
function Pendente({ nome, onLogout, bloqueado }) {
  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-brand"><div className="brand-mark">SM</div>
          <div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div>
        <div className="auth-h">{bloqueado ? "Acesso revogado" : "Aguardando aprovação"}</div>
        <div className="auth-note" style={{ textAlign: "left", fontSize: 14 }}>
          {bloqueado
            ? "Seu acesso foi revogado pelo administrador — ou o banco ainda não foi configurado (script SQL). Se você é o administrador, rode o script no Supabase e entre novamente."
            : `Olá${nome ? ", " + nome : ""}! Sua conta foi criada e está aguardando a aprovação do administrador. Assim que ele aprovar, é só entrar novamente.`}
        </div>
        <button className="btn btn-gold auth-btn" onClick={onLogout} style={{ marginTop: 16 }}>Sair</button>
      </div>
    </div>
  );
}

/* ------------------------- gestão de usuários -------------------------- */
function UsersView({ meId }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [excluir, setExcluir] = useState(null);   // usuário selecionado para exclusão
  const [senha, setSenha] = useState("");
  const [proc, setProc] = useState(false);
  const [msgExcl, setMsgExcl] = useState("");

  const load = async () => {
    setErro("");
    try {
      const { data, error } = await supabase.from("profiles").select("*").order("criado_em", { ascending: true });
      if (error) { setErro(traduzErro(error.message)); }
      setList(data || []);
    } catch (e) { setErro("Falha de conexão."); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // registra ação no log (best-effort) e aplica a mudança no perfil
  const logAcao = async (acao, alvo, detalhe) => {
    try {
      const { data: me } = await supabase.auth.getUser();
      await supabase.from("admin_log").insert({ acao, alvo_id: alvo.id, alvo_email: alvo.email, alvo_nome: alvo.nome,
        feito_por: me?.user?.id, feito_por_email: me?.user?.email, detalhe: detalhe || "" });
    } catch (e) {}
  };
  const mudar = async (u, campos, acao) => {
    try {
      const { error } = await supabase.from("profiles").update(campos).eq("id", u.id);
      if (error) { setErro(traduzErro(error.message)); return; }
      if (acao) logAcao(acao, u, JSON.stringify(campos));
    } catch (e) {}
    load();
  };

  const confirmarExclusao = async () => {
    if (!excluir || !senha) return;
    setProc(true); setMsgExcl("");
    try {
      // 1) reautentica a SUA senha aqui (usa a sessão atual; se a senha errar, o Supabase recusa)
      const { data: meNow } = await supabase.auth.getUser();
      const meuEmail = meNow?.user?.email;
      if (!meuEmail) { setMsgExcl("Sessão expirada. Saia e entre novamente."); setProc(false); return; }
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: meuEmail, password: senha });
      if (reauthErr) { setMsgExcl("Senha incorreta. Exclusão cancelada."); setProc(false); return; }
      // 2) chama a função de exclusão (ela revalida que você é admin e protege a conta principal)
      const { data, error } = await supabase.functions.invoke("excluir-usuario", { body: { alvoId: excluir.id, senhaConfirmada: true } });
      if (error || (data && data.error)) {
        setMsgExcl((data && data.error) || "Não foi possível excluir. Verifique se a função 'excluir-usuario' está publicada.");
        setProc(false); return;
      }
      setExcluir(null); setSenha(""); setProc(false); load();
    } catch (e) { setMsgExcl("Falha ao chamar a função de exclusão."); setProc(false); }
  };

  const pendentes = list.filter((u) => u && u.aprovado === false).length;
  const dataBRc = (v) => { try { return v ? new Date(v).toLocaleDateString("pt-BR") : "—"; } catch { return "—"; } };

  return (
    <section className="wrap">
      {pendentes > 0 && <div className="aviso">{pendentes} cadastro(s) aguardando aprovação.</div>}
      <div className="card">
        <div className="card-h">Usuários ({list.length})</div>
        <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>
          Novos usuários criam a própria conta na tela de login e aparecem aqui para você aprovar ou recusar.
        </p>
        {erro && <div className="auth-erro">{erro}</div>}
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Cadastro</th><th>Permissão</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody>{list.filter(Boolean).map((u) => {
              const ehPrincipal = u.principal === true;
              const souEu = u.id === meId;
              return (
              <tr key={u.id}>
                <td>{u.nome || "—"}{souEu && <span className="muted small"> (você)</span>}{ehPrincipal && <Badge tone="gold">principal</Badge>}</td>
                <td>{u.email || "—"}</td>
                <td>{dataBRc(u.criado_em)}</td>
                <td>
                  {(souEu || ehPrincipal) ? (u.role || "—") : (
                    <select className="mini-sel" value={u.role || "Usuário"} onChange={(e) => mudar(u, { role: e.target.value }, "mudar_papel")}>
                      <option>Usuário</option><option>Administrador</option>
                    </select>
                  )}
                </td>
                <td>{u.aprovado === false ? <Badge tone="amber">pendente</Badge> : <Badge tone="green">aprovado</Badge>}</td>
                <td>
                  <span className="row-inline-mini">
                    {u.aprovado === false && <button className="btn btn-mini aprovar" onClick={() => mudar(u, { aprovado: true }, "aprovar")}>aprovar</button>}
                    {u.aprovado === false && <button className="btn btn-mini" onClick={() => setExcluir(u)}>recusar</button>}
                    {u.aprovado !== false && !souEu && !ehPrincipal && <button className="btn btn-mini" onClick={() => mudar(u, { aprovado: false }, "revogar")}>revogar</button>}
                    {!souEu && !ehPrincipal && <button className="btn-del" onClick={() => setExcluir(u)}>🗑 Excluir</button>}
                  </span>
                </td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>A conta <b>principal</b> não pode ser rebaixada nem excluída — proteção garantida também no banco de dados.</p>
      </div>

      {excluir && (
        <div className="modal-bg" onClick={() => !proc && (setExcluir(null), setSenha(""), setMsgExcl(""))}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">Excluir esta conta?</div>
            <p className="confirm-msg">Você vai excluir <b>{excluir.nome || "(sem nome)"}</b> — <b>{excluir.email}</b>. Esta ação remove a conta e <b>todos os dados criados por ela</b>, e não pode ser desfeita. Seus dados e os de outros usuários não são afetados.</p>
            <label className="field" style={{ marginBottom: 8 }}><span>Confirme com a SUA senha de administrador</span>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="sua senha atual" autoFocus /></label>
            {msgExcl && <div className="auth-erro" style={{ marginBottom: 8 }}>{msgExcl}</div>}
            <div className="confirm-acts">
              <button className="btn btn-ghost" disabled={proc} onClick={() => { setExcluir(null); setSenha(""); setMsgExcl(""); }}>Cancelar</button>
              <button className="btn btn-danger" disabled={proc || !senha} onClick={confirmarExclusao}>{proc ? "Excluindo…" : "Excluir definitivamente"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================ RELATÓRIOS =============================== */
const INFO_OPTS = [
  ["basico", "Dados básicos do animal"], ["idade", "Idade (anos e meses)"], ["genealogia", "Genealogia"], ["sociedade", "Sociedade / cotas"],
  ["participacao", "Participação atual"], ["estimado", "Valor estimado"], ["investido", "Valor total investido"],
  ["pago", "Valor pago"], ["aberto", "Valor em aberto"], ["parcelas", "Parcelas"], ["comissao", "Comissão"],
  ["compras", "Compras"], ["vendas", "Vendas"], ["prenhezVinc", "Prenhezes vinculadas"],
  ["aspiracaoVinc", "Aspirações vinculadas"], ["historico", "Histórico financeiro"], ["reprodutivo", "Acompanhamento reprodutivo"], ["videos", "Vídeos (links)"], ["obs", "Observações"],
];
// lista de vídeos com URL (para relatório)
const videosLista = (a) => ((a && a.videos) || []).filter((v) => v && v.url);
const videosTexto = (a) => videosLista(a).map((v) => `${v.tipo ? v.tipo + ": " : ""}${v.url}`).join("  |  ");
const socioStr = (a) => ((a.sociedadeAtual || a.socios || []).filter(Boolean)).map((s) => `${s.nome} ${num(s.pct)}%`).join("; ");
const prenhezVinculadas = (a, ativos) => (ativos || []).filter((x) => x && x.tipo === "prenhez" && lc(x.doadora) === lc(a.nome));
const aspVinculadas = (a, ativos) => (ativos || []).filter((x) => x && x.tipo === "aspiracao" && lc(x.doadora) === lc(a.nome));

/* gera o MESMO pedigree da ficha (SVG, 3 gerações + bisavós) como string, para o PDF */
function svgGenealogiaStr(a) {
  let center, leftGens, rightGens;
  if (a.tipo === "aspiracao" || a.tipo === "prenhez") {
    const isPren = a.tipo === "prenhez";
    center = { label: isPren ? "Prenhez" : "Aspiração", name: a.nome, sex: isPren ? "F" : "N" };
    leftGens = [[{ label: "Pai", name: a.pai || a.touro, sex: "M" }],
      [{ label: "Avô paterno", name: a.avoPaterno, sex: "M" }, { label: "Avó paterna", name: a.avoPaterna, sex: "F" }]];
    rightGens = [[{ label: "Mãe doadora", name: a.doadora, sex: "F" }],
      [{ label: "Avô materno", name: a.avoMaterno, sex: "M" }, { label: "Avó materna", name: a.avoMaterna, sex: "F" }]];
  } else {
    center = { label: "Animal", name: a.nome, sex: sexNorm(a.sexo) };
    leftGens = [[{ label: "Pai", name: a.pai, sex: "M" }],
      [{ label: "Avô paterno", name: a.avoPaterno, sex: "M" }, { label: "Avó paterna", name: a.avoPaterna, sex: "F" }]];
    rightGens = [[{ label: "Mãe", name: a.mae, sex: "F" }],
      [{ label: "Avô materno", name: a.avoMaterno, sex: "M" }, { label: "Avó materna", name: a.avoMaterna, sex: "F" }]];
    const bis = ["bis_pp_p", "bis_pp_m", "bis_pm_p", "bis_pm_m", "bis_mp_p", "bis_mp_m", "bis_mm_p", "bis_mm_m"];
    if (bis.some((k) => a[k])) {
      leftGens.push([{ label: "Bisavô", name: a.bis_pp_p, sex: "M" }, { label: "Bisavó", name: a.bis_pp_m, sex: "F" },
        { label: "Bisavô", name: a.bis_pm_p, sex: "M" }, { label: "Bisavó", name: a.bis_pm_m, sex: "F" }]);
      rightGens.push([{ label: "Bisavô", name: a.bis_mp_p, sex: "M" }, { label: "Bisavó", name: a.bis_mp_m, sex: "F" },
        { label: "Bisavô", name: a.bis_mm_p, sex: "M" }, { label: "Bisavó", name: a.bis_mm_m, sex: "F" }]);
    }
  }
  const temAlgo = [...leftGens.flat(), ...rightGens.flat()].some((n) => n.name);
  if (!temAlgo) return "";
  const L = ladoLayout(leftGens, -1), R = ladoLayout(rightGens, 1);
  const d = Math.max(L.d, R.d);
  const nodes = [{ ...center, x: 0, y: 0 }, ...L.nodes, ...R.nodes];
  const links = [...L.links, ...R.links, { x1: 0, y1: 0, x2: -COL, y2: 0, sign: -1 }, { x1: 0, y1: 0, x2: COL, y2: 0, sign: 1 }];
  const maxX = d * COL + NW / 2 + 18;
  const maxY = (Math.max(L.leaves, R.leaves) / 2) * ROW + NH / 2 + 18;
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const paths = links.map((l) => `<path d="${linkD(l)}" fill="none" stroke="#d8cfba" stroke-width="1.6"/>`).join("");
  const gs = nodes.map((n) => {
    const main = n.x === 0 && n.y === 0;
    return `<g><rect x="${n.x - NW / 2}" y="${n.y - NH / 2}" width="${NW}" height="${NH}" rx="9" fill="${sexFill(n.sex)}" stroke="${sexStroke(n.sex)}" stroke-width="${main ? 2.6 : 1.4}"/>`
      + `<text x="${n.x}" y="${n.y - NH / 2 + 15}" text-anchor="middle" font-size="9" font-weight="700" fill="${sexStroke(n.sex)}">${esc((n.label || "").toUpperCase())}</text>`
      + `<text x="${n.x}" y="${n.y + 9}" text-anchor="middle" font-size="13" font-family="Georgia,serif" fill="${sexText(n.sex)}">${esc(truncNome(n.name))}</text></g>`;
  }).join("");
  return `<svg viewBox="${-maxX} ${-maxY} ${2 * maxX} ${2 * maxY}" style="width:100%;height:auto;max-width:${2 * maxX}px" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${paths}${gs}</svg>`;
}

const BUSCA_TIPOS = [["geral", "Geral"], ["animal", "Animal"], ["socio", "Sócio"], ["ondeEsta", "Onde Está"], ["leilao", "Leilão"], ["vendedor", "Vendedor"], ["comprador", "Comprador"], ["registro", "Registro"]];
const EYE_ON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
const EYE_OFF = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;

function RelatoriosView({ lista, ativos, db, onRestaurar, isAdmin, usuario }) {
  const [q, setQ] = useState("");
  const [campos, setCampos] = useState({ basico: true, idade: true, genealogia: false, sociedade: true, participacao: true, estimado: true, investido: true, pago: true, aberto: true, parcelas: false, comissao: false, compras: false, vendas: false, prenhezVinc: false, aspiracaoVinc: false, historico: false, reprodutivo: false, videos: false, obs: false });
  const ADV_VAZIO = { tipoReg: "animal", situacao: "ativos", sexo: [], faixas: [], nascDe: "", nascAte: "", socios: [], partMin: "", partMax: "", comSociedade: false, part100: false, leiloes: [], vendedor: "", comprador: "", compraDe: "", compraAte: "", aquisicao: [], ondeEsta: "", estMin: "", estMax: "", pagoMin: "", pagoMax: "", abertoMin: "", abertoMax: "" };
  const [adv, setAdv] = useState(ADV_VAZIO);
  const [painelAberto, setPainelAberto] = useState(false);

  // listas auxiliares para os filtros
  const sociosOpc = useMemo(() => { const s = new Set(); (ativos || []).forEach((a) => (a && (a.sociedadeAtual || a.socios) || []).forEach((x) => x && x.nome && s.add(x.nome))); return [...s].sort(); }, [ativos]);
  const leiloesOpc = useMemo(() => { const s = new Set(); (ativos || []).forEach((a) => a && a.leilao && s.add(a.leilao)); return [...s].sort(); }, [ativos]);
  const FAIXAS_IDADE = [["<1", "< 1 ano", 0, 12], ["1-2", "1 a 2 anos", 12, 24], ["2-4", "2 a 4 anos", 24, 48], ["4-6", "4 a 6 anos", 48, 72], ["6-8", "6 a 8 anos", 72, 96], ["8+", "+ 8 anos", 96, Infinity]];
  const AQUISICOES = ["Compra direta", "Nascimento de aspiração", "Nascimento de prenhez", "Outra origem"];

  // base: apenas registros com cadastro próprio (exclui ancestrais só-genealogia e arquivados)
  const base = (lista || []).filter((a) => a && a.origem !== "genealogia" && !a.arquivada);
  const nq = norm(q).trim();
  // pesquisa principal: por Nome OU Registro (RG) — campo vazio não restringe
  const matchTipo = (a) => {
    if (!nq) return true;
    return norm(a.nome).includes(nq) || norm(a.registro).includes(nq);
  };

  // situação conforme o tipo de registro (usa os estados já existentes de cada módulo)
  const estaAtivo = (a) => {
    if (a.tipo === "prenhez") return prenhezAtiva(a);
    if (a.tipo === "aspiracao") return aspAtiva(a);
    return ehAtivo(a); // animal (e genealogia/arquivada já excluídos da base)
  };

  // filtros: dentro do mesmo campo = OU; entre campos = E. Filtro vazio não restringe.
  const matchAvancado = (a) => {
    // tipo de registro (principal) — não mistura os tipos
    if (adv.tipoReg !== "todos" && a.tipo !== adv.tipoReg) return false;
    // situação (principal) — vale para qualquer tipo, usando os estados de cada módulo
    if (adv.situacao === "ativos" && !estaAtivo(a)) return false;
    if (adv.situacao === "inativos" && estaAtivo(a)) return false;

    // filtros avançados — específicos de animais; só restringem registros de animais
    // (quando filtrando prenhezes/aspirações, não bloqueiam esses registros)
    if (a.tipo === "animal") {
      if (adv.sexo.length && !adv.sexo.some((x) => lc(a.sexo).startsWith(lc(x).charAt(0)))) return false;
      if (adv.faixas.length) { const m = mesesDe(a.nascimento); const ok = m != null && adv.faixas.some((fk) => { const f = FAIXAS_IDADE.find((z) => z[0] === fk); return f && m >= f[2] && m < f[3]; }); if (!ok) return false; }
      if (adv.nascDe && (!a.nascimento || a.nascimento < adv.nascDe)) return false;
      if (adv.nascAte && (!a.nascimento || a.nascimento > adv.nascAte)) return false;
      if (adv.socios.length) { const soc = (a.sociedadeAtual || a.socios || []); if (!adv.socios.some((n) => soc.some((s) => lc(s.nome) === lc(n)))) return false; }
      const part = participacaoAtual(a);
      if (adv.partMin !== "" && part < num(adv.partMin)) return false;
      if (adv.partMax !== "" && part > num(adv.partMax)) return false;
      if (adv.comSociedade && !((a.sociedadeAtual || a.socios || []).filter(Boolean).length > 0)) return false;
      if (adv.part100 && part !== 100) return false;
      if (adv.leiloes.length && !adv.leiloes.some((l) => lc(a.leilao) === lc(l))) return false;
      if (adv.vendedor && !norm(a.vendedor).includes(norm(adv.vendedor))) return false;
      if (adv.comprador && !vendasDo(a).some((v) => norm(v.comprador).includes(norm(adv.comprador)))) return false;
      if (adv.compraDe && (!a.dataCompra || a.dataCompra < adv.compraDe)) return false;
      if (adv.compraAte && (!a.dataCompra || a.dataCompra > adv.compraAte)) return false;
      if (adv.aquisicao.length && !adv.aquisicao.some((t) => lc(a.origemAnimal) === lc(t))) return false;
      if (adv.ondeEsta && !norm(a.ondeEsta).includes(norm(adv.ondeEsta))) return false;
      const f = finance(a);
      if (adv.estMin !== "" && f.totalEstimado < num(adv.estMin)) return false;
      if (adv.estMax !== "" && f.totalEstimado > num(adv.estMax)) return false;
      if (adv.pagoMin !== "" && f.pago < num(adv.pagoMin)) return false;
      if (adv.pagoMax !== "" && f.pago > num(adv.pagoMax)) return false;
      if (adv.abertoMin !== "" && f.aberto < num(adv.abertoMin)) return false;
      if (adv.abertoMax !== "" && f.aberto > num(adv.abertoMax)) return false;
    }
    return true;
  };

  // conta filtros ativos (para o resumo e as etiquetas)
  const chipsAtivos = [];
  const TIPOREG_LBL = { animal: "Animais", prenhez: "Prenhezes", aspiracao: "Aspirações", todos: "Todos os tipos" };
  const SIT_LBL = { ativos: "Ativos", inativos: "Inativos", todos: "Todos" };
  if (adv.tipoReg !== "todos") chipsAtivos.push({ k: "tipoReg", label: TIPOREG_LBL[adv.tipoReg], clear: () => setAdv((p) => ({ ...p, tipoReg: "todos" })) });
  if (adv.situacao !== "todos") chipsAtivos.push({ k: "situacao", label: SIT_LBL[adv.situacao], clear: () => setAdv((p) => ({ ...p, situacao: "todos" })) });
  adv.sexo.forEach((x) => chipsAtivos.push({ k: "sexo" + x, label: `Sexo: ${x}`, clear: () => setAdv((p) => ({ ...p, sexo: p.sexo.filter((z) => z !== x) })) }));
  adv.faixas.forEach((x) => { const f = FAIXAS_IDADE.find((z) => z[0] === x); chipsAtivos.push({ k: "faixa" + x, label: `Idade: ${f ? f[1] : x}`, clear: () => setAdv((p) => ({ ...p, faixas: p.faixas.filter((z) => z !== x) })) }); });
  if (adv.nascDe || adv.nascAte) chipsAtivos.push({ k: "nasc", label: `Nasc.: ${adv.nascDe ? dataBR(adv.nascDe) : "…"}–${adv.nascAte ? dataBR(adv.nascAte) : "…"}`, clear: () => setAdv((p) => ({ ...p, nascDe: "", nascAte: "" })) });
  adv.socios.forEach((x) => chipsAtivos.push({ k: "soc" + x, label: `Sócio: ${x}`, clear: () => setAdv((p) => ({ ...p, socios: p.socios.filter((z) => z !== x) })) }));
  if (adv.partMin !== "" || adv.partMax !== "") chipsAtivos.push({ k: "part", label: `Participação: ${adv.partMin || 0}%–${adv.partMax || 100}%`, clear: () => setAdv((p) => ({ ...p, partMin: "", partMax: "" })) });
  if (adv.comSociedade) chipsAtivos.push({ k: "comsoc", label: "Com sociedade", clear: () => setAdv((p) => ({ ...p, comSociedade: false })) });
  if (adv.part100) chipsAtivos.push({ k: "p100", label: "Participação 100%", clear: () => setAdv((p) => ({ ...p, part100: false })) });
  adv.leiloes.forEach((x) => chipsAtivos.push({ k: "lei" + x, label: `Leilão: ${x}`, clear: () => setAdv((p) => ({ ...p, leiloes: p.leiloes.filter((z) => z !== x) })) }));
  if (adv.vendedor) chipsAtivos.push({ k: "vend", label: `Vendedor: ${adv.vendedor}`, clear: () => setAdv((p) => ({ ...p, vendedor: "" })) });
  if (adv.comprador) chipsAtivos.push({ k: "comp", label: `Comprador: ${adv.comprador}`, clear: () => setAdv((p) => ({ ...p, comprador: "" })) });
  if (adv.compraDe || adv.compraAte) chipsAtivos.push({ k: "compra", label: `Compra: ${adv.compraDe ? dataBR(adv.compraDe) : "…"}–${adv.compraAte ? dataBR(adv.compraAte) : "…"}`, clear: () => setAdv((p) => ({ ...p, compraDe: "", compraAte: "" })) });
  adv.aquisicao.forEach((x) => chipsAtivos.push({ k: "aq" + x, label: `Origem: ${x}`, clear: () => setAdv((p) => ({ ...p, aquisicao: p.aquisicao.filter((z) => z !== x) })) }));
  if (adv.ondeEsta) chipsAtivos.push({ k: "onde", label: `Criatório: ${adv.ondeEsta}`, clear: () => setAdv((p) => ({ ...p, ondeEsta: adv.ondeEsta ? "" : "" })) });
  if (adv.estMin !== "" || adv.estMax !== "") chipsAtivos.push({ k: "est", label: `Valor est.: ${fmt(num(adv.estMin))}–${adv.estMax ? fmt(num(adv.estMax)) : "…"}`, clear: () => setAdv((p) => ({ ...p, estMin: "", estMax: "" })) });
  if (adv.pagoMin !== "" || adv.pagoMax !== "") chipsAtivos.push({ k: "pg", label: `Pago: ${fmt(num(adv.pagoMin))}–${adv.pagoMax ? fmt(num(adv.pagoMax)) : "…"}`, clear: () => setAdv((p) => ({ ...p, pagoMin: "", pagoMax: "" })) });
  if (adv.abertoMin !== "" || adv.abertoMax !== "") chipsAtivos.push({ k: "ab", label: `Em aberto: ${fmt(num(adv.abertoMin))}–${adv.abertoMax ? fmt(num(adv.abertoMax)) : "…"}`, clear: () => setAdv((p) => ({ ...p, abertoMin: "", abertoMax: "" })) });

  const listaF = base.filter((a) => matchTipo(a) && matchAvancado(a));
  const limparFiltros = () => { setAdv(ADV_VAZIO); setQ(""); };
  const toggleArr = (campo, valor) => setAdv((p) => ({ ...p, [campo]: p[campo].includes(valor) ? p[campo].filter((z) => z !== valor) : [...p[campo], valor] }));

  const [sel, setSel] = useState(() => new Set(base.map((a) => a.id)));
  const selecionados = listaF.filter((a) => sel.has(a.id));
  const toggleAnimal = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => { const n = new Set(s); listaF.forEach((a) => n.add(a.id)); return n; });
  const nenhum = () => setSel((s) => { const n = new Set(s); listaF.forEach((a) => n.delete(a.id)); return n; });
  const toggleCampo = (k) => setCampos((c) => ({ ...c, [k]: !c[k] }));
  const nCampos = Object.values(campos).filter(Boolean).length;

  // monta uma linha (objeto) para o animal conforme campos marcados
  const linhaDe = (a) => {
    const f = finance(a); const row = {};
    if (campos.basico) { row["Tipo"] = a.tipo; row["Nome"] = a.nome; row["Registro"] = a.registro || ""; row["Sexo"] = a.sexo || ""; row["Categoria"] = a.categoria || a.raca || ""; if (a.tipo === "animal") row["Situação"] = ehAtivo(a) ? "Ativo" : "Inativo"; row["Criatório responsável"] = a.ondeEsta || ""; row["Nascimento"] = a.nascimento ? dataBR(a.nascimento) : ""; }
    else { row["Nome"] = a.nome; }
    if (campos.idade) row["Idade"] = idadeTexto(a.nascimento); // sempre logo após o Nascimento (ou após o Nome, se Básicos estiver off)
    if (campos.genealogia) { row["Pai"] = a.pai || a.touro || ""; row["Mãe"] = a.mae || a.doadora || ""; row["Registro da mãe"] = a.maeRegistro || a.regDoadora || ""; row["Avô paterno"] = a.avoPaterno || ""; row["Avó paterna"] = a.avoPaterna || ""; row["Avô materno"] = a.avoMaterno || ""; row["Avó materna"] = a.avoMaterna || ""; row["Obs. genealógicas"] = a.obsGen || ""; }
    if (campos.sociedade) row["Sociedade"] = socioStr(a);
    if (campos.participacao) row["Participação atual (%)"] = participacaoAtual(a);
    if (campos.estimado) row["Valor estimado"] = f.totalEstimado;
    if (campos.investido) row["Total investido"] = f.total;
    if (campos.pago) row["Valor pago"] = f.pago;
    if (campos.aberto) row["Valor em aberto"] = f.aberto;
    if (campos.parcelas) { const uni = parcelasUnificadas(a); row["Parcelas (qtd)"] = uni.length; row["Valor parcela"] = f.valor; row["Parcelas (total)"] = uni.reduce((s, p) => s + num(p.valor), 0); }
    if (campos.comissao) { row["Comissão (%)"] = f.com.pct; row["Comissão (R$)"] = f.com.total; }
    if (campos.compras) row["Compras adicionais"] = (a.comprasAdic || []).map((c) => `+${num(c.pctAdicional)}% ${fmt(num(c.valor) || num(c.valorParcela) * num(c.parcelas))}`).join("; ");
    if (campos.vendas) row["Vendas"] = vendasDo(a).map((v) => `${v.tipo}${v.pctVendida ? " " + v.pctVendida + "%" : ""} ${fmt(v.valor)}`).join("; ");
    if (campos.prenhezVinc) row["Prenhezes vinculadas"] = prenhezVinculadas(a, ativos).map((x) => x.nome).join("; ");
    if (campos.aspiracaoVinc) row["Aspirações vinculadas"] = aspVinculadas(a, ativos).map((x) => x.nome).join("; ");
    if (campos.historico) row["Histórico financeiro"] = (a.historico || []).map((h) => `${dataBR(h.data)}: ${h.desc || h.tipo}`).join(" | ");
    if (campos.reprodutivo) {
      row["Criatório"] = a.ondeEsta || a.criatorio || "";
      if (a.tipo === "prenhez") { row["Previsão parto"] = a.previsaoParto ? dataBR(a.previsaoParto) : ""; row["Data parto"] = a.dataParto ? dataBR(a.dataParto) : ""; row["Receptora"] = a.receptora || ""; row["Responsável"] = a.responsavel || ""; }
      if (a.tipo === "aspiracao") { row["Oócitos"] = a.oocitos || ""; row["Embriões"] = a.embrioes || ""; row["Embriões transf."] = a.embrioesTransf || ""; row["Prenhezes conf."] = a.prenhezesConf || ""; }
    }
    if (campos.videos) row["Vídeos (links)"] = videosTexto(a);
    if (campos.obs) row["Observações"] = a.obs || "";
    return row;
  };

  /* ---- opções de exportação (janela única): agrupamento + ordenação ---- */
  const [showExport, setShowExport] = useState(false);
  const EXP_PADRAO = { formato: "pdf", agrupar: "socio", ordenar: "nomeAZ", titulos: true };
  const [exp, setExp] = useState(EXP_PADRAO);

  const AGRUPAR_OPC = [["nenhum", "Sem agrupamento"], ["socio", "Sócio"], ["idade", "Faixa de idade"], ["leilao", "Leilão"], ["situacao", "Situação (Ativo/Inativo)"], ["ondeEsta", "Criatório"], ["participacao", "Participação da SM"]];
  const ORDENAR_OPC = [["nomeAZ", "Nome (A–Z)"], ["nomeZA", "Nome (Z–A)"], ["idadeAsc", "Idade crescente"], ["idadeDesc", "Idade decrescente"], ["compraRecente", "Data de compra (mais recente)"], ["compraAntiga", "Data de compra (mais antiga)"], ["partDesc", "Participação da SM (maior → menor)"], ["valorDesc", "Valor (maior → menor)"]];
  const PREFIXO_GRUPO = { socio: "SÓCIO", idade: "FAIXA DE IDADE", leilao: "LEILÃO", situacao: "SITUAÇÃO", ondeEsta: "CRIATÓRIO", participacao: "PARTICIPAÇÃO DA SM" };
  const ORDEM_IDADE = ["Até 12 meses", "13 a 24 meses", "25 a 36 meses", "37 a 48 meses", "49 a 60 meses", "Acima de 60 meses", "Idade não informada"];
  const FAIXAS_PART = [["100%", (p) => p >= 100], ["75% a 99%", (p) => p >= 75 && p < 100], ["50% a 74%", (p) => p >= 50 && p < 75], ["25% a 49%", (p) => p >= 25 && p < 50], ["1% a 24%", (p) => p >= 1 && p < 25], ["0% (sem participação)", (p) => p < 1]];

  // chaves de grupo de um registro (sócio pode gerar várias — aparece em mais de um grupo, sem duplicar no total)
  const grupoKeysDe = (a, modo) => {
    switch (modo) {
      case "socio": { const s = (a.sociedadeAtual || a.socios || []).filter(Boolean).map((x) => x.nome).filter(Boolean); return s.length ? s : ["Sem sócio informado"]; }
      case "idade": { const m = mesesDe(a.nascimento); if (m == null) return ["Idade não informada"]; if (m <= 12) return ["Até 12 meses"]; if (m <= 24) return ["13 a 24 meses"]; if (m <= 36) return ["25 a 36 meses"]; if (m <= 48) return ["37 a 48 meses"]; if (m <= 60) return ["49 a 60 meses"]; return ["Acima de 60 meses"]; }
      case "leilao": return [a.leilao ? a.leilao : "Sem leilão informado"];
      case "situacao": return [estaAtivo(a) ? "Ativos" : "Inativos"];
      case "ondeEsta": return [a.ondeEsta ? a.ondeEsta : "Sem criatório informado"];
      case "participacao": { const p = participacaoAtual(a); const f = FAIXAS_PART.find((z) => z[1](p)); return [f ? f[0] : "0% (sem participação)"]; }
      default: return ["Todos os registros"];
    }
  };

  const ordenarLista = (arr, modo) => {
    const c = [...arr];
    const mes = (a) => { const m = mesesDe(a.nascimento); return m == null ? null : m; };
    const est = (a) => finance(a).totalEstimado;
    const cmpNome = (a, b) => lc(a.nome).localeCompare(lc(b.nome), "pt-BR");
    switch (modo) {
      case "nomeZA": c.sort((a, b) => cmpNome(b, a)); break;
      case "idadeAsc": c.sort((a, b) => { const x = mes(a), y = mes(b); if (x == null && y == null) return cmpNome(a, b); if (x == null) return 1; if (y == null) return -1; return x - y || cmpNome(a, b); }); break;
      case "idadeDesc": c.sort((a, b) => { const x = mes(a), y = mes(b); if (x == null && y == null) return cmpNome(a, b); if (x == null) return 1; if (y == null) return -1; return y - x || cmpNome(a, b); }); break;
      case "compraRecente": c.sort((a, b) => String(b.dataCompra || "").localeCompare(String(a.dataCompra || "")) || cmpNome(a, b)); break;
      case "compraAntiga": c.sort((a, b) => { const av = a.dataCompra || "", bv = b.dataCompra || ""; if (!av && !bv) return cmpNome(a, b); if (!av) return 1; if (!bv) return -1; return av.localeCompare(bv) || cmpNome(a, b); }); break;
      case "partDesc": c.sort((a, b) => participacaoAtual(b) - participacaoAtual(a) || cmpNome(a, b)); break;
      case "valorDesc": c.sort((a, b) => est(b) - est(a) || cmpNome(a, b)); break;
      default: c.sort(cmpNome); // nomeAZ
    }
    return c;
  };

  // monta os grupos ordenados (chaves em ordem lógica) já com os itens ordenados
  const montarGrupos = (listaSel, modo, ordenar) => {
    if (modo === "nenhum") return [{ titulo: "Todos os registros", itens: ordenarLista(listaSel, ordenar) }];
    const map = new Map();
    listaSel.forEach((a) => grupoKeysDe(a, modo).forEach((k) => { if (!map.has(k)) map.set(k, []); map.get(k).push(a); }));
    let chaves = [...map.keys()];
    if (modo === "idade") chaves = ORDEM_IDADE.filter((k) => map.has(k));
    else if (modo === "situacao") chaves = ["Ativos", "Inativos"].filter((k) => map.has(k));
    else if (modo === "participacao") chaves = FAIXAS_PART.map((f) => f[0]).filter((k) => map.has(k));
    else { const sem = chaves.filter((k) => /^Sem /.test(k)); const outros = chaves.filter((k) => !/^Sem /.test(k)).sort((a, b) => lc(a).localeCompare(lc(b), "pt-BR")); chaves = [...outros, ...sem]; }
    return chaves.map((k) => ({ titulo: (PREFIXO_GRUPO[modo] ? PREFIXO_GRUPO[modo] + ": " : "") + k, itens: ordenarLista(map.get(k), ordenar) }));
  };

  // totais gerais SEM duplicidade (sempre sobre os selecionados únicos)
  const totaisGerais = () => {
    const temFin = campos.estimado || campos.investido || campos.pago || campos.aberto;
    let est = 0, inv = 0, pago = 0, aberto = 0;
    selecionados.forEach((a) => { const f = finance(a); est += f.totalEstimado; inv += f.total; pago += f.pago; aberto += f.aberto; });
    return { unicos: selecionados.length, temFin, est, inv, pago, aberto };
  };

  // cor pastel por categoria de campo (cabeçalhos/rótulos) — células de dados ficam brancas
  const corCampoHex = (k) => {
    if (/^(tipo|nome|registro|sexo|categoria|nascimento|idade|situação|raça)/i.test(k)) return "E6F0E9"; // verde pastel — identificação
    if (/sócio|sociedade|participa/i.test(k)) return "EFE8F5"; // lilás — sociedade
    if (/valor|investido|estimado|pago|aberto|parcela|comiss/i.test(k)) return "E8F0FB"; // azul — financeiro
    if (/leilão|vendedor|comprador|compra|aquisi|pai|mãe|avô|avó|genealóg|criatório|receptora|responsável|oócitos|embri|prenhez|previsão parto|data parto/i.test(k)) return "F3ECD9"; // bege — leilão/aquisição/reprodutivo
    if (/onde|histór|obs|víde/i.test(k)) return "EFEFEF"; // cinza — complementar
    return "F5F2EA";
  };

  const exportarExcel = (opts) => {
    if (!selecionados.length) return;
    const o = opts || exp;
    const grupos = montarGrupos(selecionados, o.agrupar, o.ordenar);

    // colunas: união dos campos (mesma lógica de linhaDe) preservando a ordem
    const linhasPorId = new Map();
    const colset = [];
    selecionados.forEach((a) => { const r = linhaDe(a); linhasPorId.set(a.id, r); Object.keys(r).forEach((k) => { if (!colset.includes(k)) colset.push(k); }); });
    const C = colset.length || 1;

    const aoa = []; const estilos = [];
    const addRow = (arr, st) => { aoa.push(arr); estilos.push(st || {}); };
    const verde = "1A4A2D", ouro = "C6A15B";

    // título principal + meta
    addRow(["RELATÓRIO SM AGROPECUÁRIA"], { 0: { font: { bold: true, sz: 14, color: { rgb: verde } } } });
    const metaAgr = (AGRUPAR_OPC.find(([k]) => k === o.agrupar) || [])[1] || "";
    const metaOrd = (ORDENAR_OPC.find(([k]) => k === o.ordenar) || [])[1] || "";
    addRow([`Gerado em ${new Date().toLocaleDateString("pt-BR")} · ${selecionados.length} registro(s) único(s) · Agrupado por: ${metaAgr} · Ordenado por: ${metaOrd}`], { 0: { font: { italic: true, sz: 9, color: { rgb: "777777" } } } });
    addRow([]);

    grupos.forEach((g) => {
      if (o.agrupar !== "nenhum") {
        const barra = {}; for (let i = 0; i < C; i++) barra[i] = { fill: { fgColor: { rgb: o.titulos ? verde : "FFFFFF" } }, font: { bold: true, sz: 12, color: { rgb: o.titulos ? "FFFFFF" : verde } } };
        addRow(colset.map((_, i) => (i === 0 ? `${g.titulo}  (${g.itens.length} registro(s))` : "")), barra);
      }
      // cabeçalho (cores pastéis por categoria)
      const hst = {}; colset.forEach((k, i) => { hst[i] = { fill: { fgColor: { rgb: corCampoHex(k) } }, font: { bold: true, sz: 10, color: { rgb: "333333" } }, alignment: { wrapText: true, vertical: "center" } }; });
      addRow(colset.slice(), hst);
      // dados (células brancas, valores inalterados)
      g.itens.forEach((a) => { const r = linhasPorId.get(a.id); addRow(colset.map((k) => (r[k] == null ? "" : r[k]))); });
      addRow([]);
    });

    // total geral sem duplicidade
    const T = totaisGerais();
    addRow([`Total geral: ${T.unicos} registro(s) único(s)`], { 0: { font: { bold: true, sz: 11, color: { rgb: verde } } } });
    if (T.temFin) addRow([`Estimado: ${fmt(T.est)}  ·  Investido: ${fmt(T.inv)}  ·  Pago: ${fmt(T.pago)}  ·  Em aberto: ${fmt(T.aberto)}`], { 0: { font: { sz: 10, color: { rgb: "555555" } } } });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    estilos.forEach((st, r) => Object.entries(st).forEach(([c, s]) => { const addr = XLSX.utils.encode_cell({ r, c: +c }); if (ws[addr]) ws[addr].s = s; }));
    // AutoFit: largura de cada coluna pelo conteúdo real (cabeçalho + todas as células).
    // A coluna A também precisa caber as barras de título de grupo (ex.: "SÓCIO: NELORE LUCENTE (12)"),
    // que ficam exatamente nessa coluna — por isso antes apareciam cortadas.
    const tituloGrupoMax = (o.agrupar !== "nenhum")
      ? grupos.reduce((mx, g) => Math.max(mx, `${g.titulo}  (${g.itens.length} registro(s))`.length), 0)
      : 0;
    ws["!cols"] = colset.map((k, idx) => {
      let max = String(k).length;
      selecionados.forEach((a) => { const r = linhasPorId.get(a.id); const v = r[k]; if (v != null && v !== "") { const len = String(v).length; if (len > max) max = len; } });
      if (idx === 0 && tituloGrupoMax > max) max = tituloGrupoMax; // inclui o texto do título de grupo na coluna A
      return { wch: Math.min(Math.max(max + 2, 10), 80) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");

    // abas detalhadas (preservadas como já existiam)
    if (campos.parcelas) {
      const rows = [];
      selecionados.forEach((a) => parcelasUnificadas(a).forEach((p) => rows.push({ Animal: a.nome, "Nº": p.numero, Vencimento: dataBR(p.venc), Valor: p.valor, Origem: p.valorAdic > 0 && p.valorBase > 0 ? "original+adicional" : p.valorAdic > 0 ? "adicional" : "original" })));
      if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Parcelas");
    }
    if (campos.sociedade) {
      const rows = [];
      selecionados.forEach((a) => ((a.sociedadeAtual || a.socios || []).filter(Boolean)).forEach((s) => rows.push({ Animal: a.nome, Sócio: s.nome, "Porcentagem (%)": num(s.pct), Observações: s.obs || "" })));
      if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sociedade");
    }
    if (campos.vendas) {
      const rows = [];
      selecionados.forEach((a) => vendasDo(a).forEach((v) => rows.push({ Animal: a.nome, Tipo: v.tipo, Data: dataBR(v.data), "% vendida": v.pctVendida || "", Comprador: v.comprador || "", Valor: v.valor })));
      if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Vendas");
    }
    if (campos.compras) {
      const rows = [];
      selecionados.forEach((a) => (a.comprasAdic || []).forEach((c) => rows.push({ Animal: a.nome, Data: dataBR(c.data), "% adquirida": num(c.pctAdicional), Valor: num(c.valor) || num(c.valorParcela) * num(c.parcelas), Parcelas: c.parcelas || "" })));
      if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Compras");
    }
    XLSX.writeFile(wb, "relatorio-sm-agropecuaria.xlsx");
  };

  const exportarPDF = (opts) => {
    if (!selecionados.length) return;
    const o = opts || exp;
    const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    // cartão de um registro — MESMO modelo atual, incluindo a genealogia (SVG)
    const cardDe = (a) => {
      const row = linhaDe(a);
      const genKeys = ["Pai", "Mãe", "Registro da mãe", "Avô paterno", "Avó paterna", "Avô materno", "Avó materna", "Obs. genealógicas"];
      const linhas = Object.entries(row).filter(([k]) => k !== "Nome" && k !== "Vídeos (links)" && !(campos.genealogia && genKeys.includes(k))).map(([k, v]) => `<tr><td class="k" style="background:#${corCampoHex(k)}">${esc(k)}</td><td>${esc(typeof v === "number" && /valor|investido|estimado|comiss|pago|aberto|parcela/i.test(k) ? fmt(v) : v)}</td></tr>`).join("");
      let linhaVideos = "";
      if (campos.videos) {
        const vids = videosLista(a);
        if (vids.length) {
          const itens = vids.map((v) => `<a href="${esc(v.url)}" style="color:#1d3a2b">${esc(v.tipo || "Vídeo")}: ${esc(v.url)}</a>`).join("<br>");
          linhaVideos = `<tr><td class="k" style="background:#EFEFEF">Vídeos</td><td>${itens}</td></tr>`;
        }
      }
      let genBloco = "";
      if (campos.genealogia) {
        const svg = svgGenealogiaStr(a);
        if (svg) genBloco = `<div class="gtit">Genealogia</div><div class="ped">${svg}<div class="ped-legend"><span><i class="sw m"></i> Macho</span><span><i class="sw f"></i> Fêmea</span><span class="side">◀ Paterno</span><span class="side">Materno ▶</span></div>${a.obsGen ? `<div class="gobs">Obs. genealógicas: ${esc(a.obsGen)}</div>` : ""}</div>`;
      }
      return `<div class="animal"><h2>${esc(a.nome)} <small>${esc(a.tipo)}</small></h2>${(linhas || linhaVideos) ? `<table>${linhas}${linhaVideos}</table>` : ""}${genBloco}</div>`;
    };

    const grupos = montarGrupos(selecionados, o.agrupar, o.ordenar);
    const corpo = grupos.map((g) => {
      const cards = g.itens.map(cardDe).join("");
      if (o.agrupar === "nenhum") return `<section class="grupo">${cards}</section>`;
      const tituloHtml = `<div class="grupo-tit${o.titulos ? "" : " plano"}">${esc(g.titulo)} <span>(${g.itens.length} registro(s))</span></div>`;
      return `<section class="grupo">${tituloHtml}${cards}</section>`;
    }).join("");

    const T = totaisGerais();
    const totalHtml = `<div class="totais"><b>Total geral:</b> ${T.unicos} registro(s) único(s)${T.temFin ? ` &nbsp;·&nbsp; Estimado ${esc(fmt(T.est))} &nbsp;·&nbsp; Pago ${esc(fmt(T.pago))} &nbsp;·&nbsp; Em aberto ${esc(fmt(T.aberto))}` : ""}</div>`;
    const metaAgr = (AGRUPAR_OPC.find(([k]) => k === o.agrupar) || [])[1] || "";
    const metaOrd = (ORDENAR_OPC.find(([k]) => k === o.ordenar) || [])[1] || "";

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório SM Agropecuária</title>
      <style>
        *{box-sizing:border-box} body{font-family:Georgia,serif;color:#22201a;margin:32px;max-width:900px}
        h1{font-size:22px;border-bottom:2px solid #c6a15b;padding-bottom:8px;color:#1a4a2d}
        .meta{color:#666;font-size:12px;margin-bottom:18px}
        .grupo{margin-bottom:6px}
        .grupo-tit{break-after:avoid;break-inside:avoid;page-break-after:avoid;background:#1a4a2d;color:#fff;border-left:5px solid #c6a15b;padding:9px 14px;border-radius:8px;margin:20px 0 12px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em}
        .grupo-tit span{color:#d9c38a;font-weight:600;font-size:12px}
        .grupo-tit.plano{background:#fff;color:#1a4a2d;border:1px solid #e5ddc9;border-left:5px solid #c6a15b}
        .grupo-tit.plano span{color:#9a7b3a}
        .animal{break-inside:avoid;margin:0 0 14px;border:1px solid #e5ddc9;border-radius:10px;padding:14px 16px}
        .animal h2{font-size:16px;margin:0 0 10px;color:#1d3a2b} .animal h2 small{color:#9a7b3a;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
        table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12.5px}
        td{padding:5px 8px;border-bottom:1px solid #f0ead9;vertical-align:top} td.k{color:#555;width:38%;font-weight:600}
        .gtit{font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:#9a7b3a;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 8px}
        .ped{break-inside:avoid;border:1px solid #ece3cf;border-radius:10px;padding:12px;background:#fffdf8}
        .ped svg{display:block;margin:0 auto}
        .ped-legend{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font-family:Arial,sans-serif;font-size:11px;color:#666;margin-top:10px}
        .ped-legend .sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:4px;border:1px solid #ccc}
        .ped-legend .sw.m{background:#e8f0fb;border-color:#5b86cf} .ped-legend .sw.f{background:#fbe9f1;border-color:#cf7aa3}
        .ped-legend .side{color:#9a7b3a;font-weight:600}
        .gobs{font-size:11px;color:#555;background:#faf7f0;border:1px solid #ece3cf;border-radius:6px;padding:6px 8px;margin-top:10px}
        .totais{margin-top:18px;border-top:2px solid #c6a15b;padding-top:10px;font-family:Arial,sans-serif;font-size:12.5px;color:#333}
        @media print{body{margin:12mm} .animal{page-break-inside:avoid} .ped{page-break-inside:avoid} .grupo-tit{page-break-after:avoid}}
      </style></head><body>
      <h1>Relatório — SM Agropecuária · Gado de Elite</h1>
      <div class="meta">Gerado em ${new Date().toLocaleDateString("pt-BR")} · ${selecionados.length} registro(s) único(s) · Agrupado por: ${esc(metaAgr)} · Ordenado por: ${esc(metaOrd)}</div>
      ${corpo}
      ${totalHtml}
      <script>window.onload=function(){window.print()}</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <section className="wrap">
      <div className="card">
        <div className="card-h">Filtros principais</div>
        <div className="rep-princ">
          <div className="rep-campo"><label>Tipo de registro</label>
            <select className="rep-sel" value={adv.tipoReg} onChange={(e) => setAdv((p) => ({ ...p, tipoReg: e.target.value }))}>
              <option value="animal">Animais</option>
              <option value="prenhez">Prenhezes</option>
              <option value="aspiracao">Aspirações</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <div className="rep-campo"><label>Situação</label>
            <select className="rep-sel" value={adv.situacao} onChange={(e) => setAdv((p) => ({ ...p, situacao: e.target.value }))}>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <div className="rep-campo rep-campo-busca"><label>Pesquisar</label>
            <div className="rep-busca-in">
              <input className="rep-inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou RG…" />
              {q && <button className="btn btn-ghost" onClick={() => setQ("")}>limpar</button>}
            </div>
          </div>
        </div>

        <div className="rep-resumo">
          <b>{listaF.length}</b> registro(s) encontrado(s)
          {(chipsAtivos.length || q) ? <button className="btn btn-mini" style={{ marginLeft: 10 }} onClick={limparFiltros}>Limpar filtros</button> : null}
        </div>

        {chipsAtivos.length > 0 && (
          <div className="filtro-chips">
            {chipsAtivos.map((c) => <span className="fchip" key={c.k}>{c.label}<button onClick={c.clear}>✕</button></span>)}
          </div>
        )}

        <button className={`btn adv-toggle ${painelAberto ? "btn-gold" : "btn-ghost"}`} onClick={() => setPainelAberto((v) => !v)}>
          {painelAberto ? "▲ Ocultar filtros avançados" : "▼ Filtros avançados"}{chipsAtivos.length > 2 ? ` (${chipsAtivos.length - 2} extra)` : ""}
        </button>

        {painelAberto && (adv.tipoReg === "animal" || adv.tipoReg === "todos") && (
          <div className="adv-panel">
            {adv.tipoReg === "todos" && <p className="muted small" style={{ margin: "0 0 4px" }}>Os filtros avançados abaixo se aplicam apenas aos animais; prenhezes e aspirações seguem apenas o tipo e a situação.</p>}

            {/* Sociedade */}
            <div className="adv-grupo"><div className="adv-tit">Sociedade</div>
              {sociosOpc.length > 0 && <div className="adv-campo"><label>Sócios (qualquer um)</label>
                <div className="chip-opts">{sociosOpc.map((x) => <button key={x} className={`chip-opt ${adv.socios.includes(x) ? "on" : ""}`} onClick={() => toggleArr("socios", x)}>{x}</button>)}</div></div>}
              <div className="adv-row">
                <div className="adv-campo"><label>Participação da SM mín. (%)</label><input type="number" step="any" value={adv.partMin} onChange={(e) => setAdv((p) => ({ ...p, partMin: e.target.value }))} /></div>
                <div className="adv-campo"><label>máx. (%)</label><input type="number" step="any" value={adv.partMax} onChange={(e) => setAdv((p) => ({ ...p, partMax: e.target.value }))} /></div>
              </div>
              <div className="chip-opts">
                <button className={`chip-opt ${adv.comSociedade ? "on" : ""}`} onClick={() => setAdv((p) => ({ ...p, comSociedade: !p.comSociedade }))}>Com sociedade</button>
                <button className={`chip-opt ${adv.part100 ? "on" : ""}`} onClick={() => setAdv((p) => ({ ...p, part100: !p.part100 }))}>Participação 100%</button>
              </div>
            </div>

            {/* Aquisição */}
            <div className="adv-grupo"><div className="adv-tit">Aquisição</div>
              {leiloesOpc.length > 0 && <div className="adv-campo"><label>Leilões (qualquer um)</label>
                <div className="chip-opts">{leiloesOpc.map((x) => <button key={x} className={`chip-opt ${adv.leiloes.includes(x) ? "on" : ""}`} onClick={() => toggleArr("leiloes", x)}>{x}</button>)}</div></div>}
              <div className="adv-row">
                <div className="adv-campo"><label>Vendedor</label><input value={adv.vendedor} onChange={(e) => setAdv((p) => ({ ...p, vendedor: e.target.value }))} /></div>
                <div className="adv-campo"><label>Comprador</label><input value={adv.comprador} onChange={(e) => setAdv((p) => ({ ...p, comprador: e.target.value }))} /></div>
              </div>
              <div className="adv-row">
                <div className="adv-campo"><label>Compra de</label><input type="date" value={adv.compraDe} onChange={(e) => setAdv((p) => ({ ...p, compraDe: e.target.value }))} /></div>
                <div className="adv-campo"><label>até</label><input type="date" value={adv.compraAte} onChange={(e) => setAdv((p) => ({ ...p, compraAte: e.target.value }))} /></div>
              </div>
              <div className="adv-campo"><label>Tipo de aquisição</label>
                <div className="chip-opts">{AQUISICOES.map((x) => <button key={x} className={`chip-opt ${adv.aquisicao.includes(x) ? "on" : ""}`} onClick={() => toggleArr("aquisicao", x)}>{x}</button>)}</div></div>
            </div>

            {/* Localização */}
            <div className="adv-grupo"><div className="adv-tit">Criatório</div>
              <div className="adv-campo"><label>Criatório</label><input value={adv.ondeEsta} onChange={(e) => setAdv((p) => ({ ...p, ondeEsta: e.target.value }))} /></div>
            </div>

            {/* Financeiro */}
            <div className="adv-grupo"><div className="adv-tit">Financeiro</div>
              <div className="adv-row">
                <div className="adv-campo"><label>Valor estimado mín.</label><input type="number" step="any" value={adv.estMin} onChange={(e) => setAdv((p) => ({ ...p, estMin: e.target.value }))} /></div>
                <div className="adv-campo"><label>máx.</label><input type="number" step="any" value={adv.estMax} onChange={(e) => setAdv((p) => ({ ...p, estMax: e.target.value }))} /></div>
              </div>
              <div className="adv-row">
                <div className="adv-campo"><label>Valor pago mín.</label><input type="number" step="any" value={adv.pagoMin} onChange={(e) => setAdv((p) => ({ ...p, pagoMin: e.target.value }))} /></div>
                <div className="adv-campo"><label>Em aberto mín.</label><input type="number" step="any" value={adv.abertoMin} onChange={(e) => setAdv((p) => ({ ...p, abertoMin: e.target.value }))} /></div>
              </div>
            </div>

            {/* Identificação */}
            <div className="adv-grupo"><div className="adv-tit">Identificação</div>
              <div className="adv-campo"><label>Sexo</label>
                <div className="chip-opts">{["Fêmea", "Macho"].map((x) => <button key={x} className={`chip-opt ${adv.sexo.includes(x) ? "on" : ""}`} onClick={() => toggleArr("sexo", x)}>{x}</button>)}</div>
              </div>
              <div className="adv-campo"><label>Faixa de idade</label>
                <div className="chip-opts">{FAIXAS_IDADE.map(([k, l]) => <button key={k} className={`chip-opt ${adv.faixas.includes(k) ? "on" : ""}`} onClick={() => toggleArr("faixas", k)}>{l}</button>)}</div>
              </div>
              <div className="adv-row">
                <div className="adv-campo"><label>Nascimento de</label><input type="date" value={adv.nascDe} onChange={(e) => setAdv((p) => ({ ...p, nascDe: e.target.value }))} /></div>
                <div className="adv-campo"><label>até</label><input type="date" value={adv.nascAte} onChange={(e) => setAdv((p) => ({ ...p, nascAte: e.target.value }))} /></div>
              </div>
            </div>

            <div className="rep-tools">
              <button className="btn btn-gold" onClick={() => setPainelAberto(false)}>Aplicar filtros</button>
              <button className="btn btn-ghost" onClick={limparFiltros}>Limpar filtros</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-h">Registros a exportar <span className="muted">({selecionados.length} de {listaF.length})</span></div>
        <div className="rep-tools"><button className="btn btn-ghost" onClick={todos}>Selecionar todos</button><button className="btn btn-ghost" onClick={nenhum}>Nenhum</button></div>
        <div className="sel-grid">
          {listaF.map((a) => (
            <label className="sel-item" key={a.id}><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggleAnimal(a.id)} /> <span>{a.nome} <em className="muted">· {a.tipo}</em></span></label>
          ))}
          {listaF.length === 0 && <p className="muted small">Nenhum registro encontrado{nq ? " para esta busca." : "."}</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-h">Informações para exportar <span className="muted">({nCampos} marcada(s))</span></div>
        <div className="sel-grid">
          {INFO_OPTS.map(([k, label]) => (
            <label className="sel-item" key={k}><input type="checkbox" checked={!!campos[k]} onChange={() => toggleCampo(k)} /> <span>{label}</span></label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-h">Resumo</div>
        <p className="muted" style={{ marginTop: -4 }}>
          Serão exportados <b>{selecionados.length} animal(is)</b> com <b>{nCampos} grupo(s) de informação</b>
          {": "}{INFO_OPTS.filter(([k]) => campos[k]).map(([, l]) => l).join(", ") || "nenhum campo marcado"}.
        </p>
        <div className="rep-tools">
          <button className="btn btn-gold" onClick={() => { setExp(EXP_PADRAO); setShowExport(true); }} disabled={!selecionados.length || !nCampos}>⤓ Exportar Relatório</button>
        </div>
        {(!selecionados.length || !nCampos) && <p className="muted small">Selecione ao menos um registro e uma informação para exportar.</p>}
      </div>

      {showExport && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setShowExport(false); }}>
          <div className="modal" style={{ width: "min(560px,100%)" }}>
            <div className="modal-head"><h2>Exportar relatório</h2><button className="btn btn-mini" onClick={() => setShowExport(false)}>✕</button></div>
            <div className="modal-body">
              <p className="muted small" style={{ marginTop: 0 }}><b>{selecionados.length}</b> registro(s) selecionado(s) · <b>{nCampos}</b> grupo(s) de informação. Os filtros definem <b>quais</b> entram; as opções abaixo definem <b>como</b> aparecem.</p>

              <div className="exp-campo"><label>Formato</label>
                <div className="seg-group">{[["pdf", "PDF"], ["excel", "Excel"]].map(([k, l]) => <button key={k} className={`seg ${exp.formato === k ? "on" : ""}`} onClick={() => setExp((p) => ({ ...p, formato: k }))}>{l}</button>)}</div>
              </div>

              <div className="exp-campo"><label>Agrupar por</label>
                <select className="rep-sel" value={exp.agrupar} onChange={(e) => setExp((p) => ({ ...p, agrupar: e.target.value }))}>
                  {AGRUPAR_OPC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>

              <div className="exp-campo"><label>Ordenar por</label>
                <select className="rep-sel" value={exp.ordenar} onChange={(e) => setExp((p) => ({ ...p, ordenar: e.target.value }))}>
                  {ORDENAR_OPC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>

              <div className="exp-campo"><label>Separar grupos com títulos coloridos</label>
                <div className="seg-group">{[["sim", true], ["não", false]].map(([l, v]) => <button key={l} className={`seg ${exp.titulos === v ? "on" : ""}`} onClick={() => setExp((p) => ({ ...p, titulos: v }))}>{l === "sim" ? "Sim" : "Não"}</button>)}</div>
                {exp.agrupar === "nenhum" && <p className="muted small" style={{ margin: "6px 0 0" }}>Sem agrupamento selecionado — os títulos coloridos não se aplicam.</p>}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowExport(false)}>Cancelar</button>
              <button className="btn btn-gold" onClick={() => { const o = exp; setShowExport(false); if (o.formato === "excel") exportarExcel(o); else exportarPDF(o); }}>Gerar relatório</button>
            </div>
          </div>
        </div>
      )}

      <BackupSecao db={db} onRestaurar={onRestaurar} isAdmin={isAdmin} usuario={usuario} ativos={ativos} />
    </section>
  );
}

/* --------------------------- Backup / Restauração ---------------------- */
function BackupSecao({ db, onRestaurar, isAdmin, usuario, ativos }) {
  const [msg, setMsg] = useState("");
  const [pendente, setPendente] = useState(null);   // conteúdo aguardando confirmação de restauro
  const inputRef = useRef(null);
  // --- backups automáticos na nuvem (tabela app_backups, criada pelo script do Supabase) ---
  const [autoList, setAutoList] = useState(null);    // null = carregando; [] = sem cópias
  const [autoErro, setAutoErro] = useState(false);   // true = tabela ainda não existe (script não rodado)
  const carregarAuto = async () => {
    try {
      const { data, error } = await supabase.from("app_backups").select("id, origem, criado_em").order("criado_em", { ascending: false }).limit(30);
      if (error) { setAutoErro(true); setAutoList([]); return; }
      setAutoErro(false); setAutoList(data || []);
    } catch (e) { setAutoErro(true); setAutoList([]); }
  };
  useEffect(() => { carregarAuto(); }, []);
  const restaurarNuvem = async (id) => {
    setMsg("");
    try {
      const { data, error } = await supabase.from("app_backups").select("value, criado_em").eq("id", id).maybeSingle();
      if (error || !data || !data.value) { setMsg("Não consegui carregar essa cópia."); return; }
      setPendente({ dados: JSON.parse(data.value), nome: "Backup automático da nuvem", quando: data.criado_em });
    } catch (e) { setMsg("Não consegui carregar essa cópia."); }
  };

  const contar = (b) => ({
    animais: (b.ativos || []).filter((a) => a && a.tipo === "animal").length,
    prenhezes: (b.ativos || []).filter((a) => a && a.tipo === "prenhez").length,
    aspiracoes: (b.ativos || []).filter((a) => a && a.tipo === "aspiracao").length,
    socios: (b.socios || []).length, leiloes: (b.leiloes || []).length,
  });

  const baixar = () => {
    const backup = { _tipo: "sm-sistema-backup", _versao: 1, _data: new Date().toISOString(), _por: usuario || "", dados: db };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const hoje = new Date().toISOString().slice(0, 10);
    link.href = url; link.download = `backup-sm-sistema-${hoje}.json`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMsg("Backup baixado. Guarde esse arquivo em local seguro (nuvem, e-mail, pen drive).");
  };

  const escolherArquivo = async (file) => {
    setMsg("");
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      const dados = obj && obj._tipo === "sm-sistema-backup" ? obj.dados : obj;
      if (!dados || (!Array.isArray(dados.ativos) && !Array.isArray(dados.socios))) {
        setMsg("Esse arquivo não parece um backup válido do SM sistema."); return;
      }
      setPendente({ dados, nome: file.name, quando: obj._data });
    } catch (e) { setMsg("Não consegui ler o arquivo. Envie um backup .json gerado pelo próprio sistema."); }
    if (inputRef.current) inputRef.current.value = "";
  };

  const confirmarRestauro = () => {
    onRestaurar(pendente.dados);
    setPendente(null);
    setMsg("Backup restaurado. Os dados anteriores foram substituídos pelos do arquivo.");
  };

  const atual = contar(db);

  return (
    <div className="card">
      <div className="card-h">💾 Backup / Cópia de segurança</div>
      <p className="muted small" style={{ marginTop: -4 }}>
        Baixe uma cópia completa da sua base ({atual.animais} animais, {atual.prenhezes} prenhezes, {atual.aspiracoes} aspirações, {atual.socios} sócios, {atual.leiloes} leilões). O arquivo contém <b>tudo</b> da sua conta e serve para guardar em segurança ou restaurar depois.
      </p>
      <div className="rep-tools">
        <button className="btn btn-gold" onClick={baixar}>⤓ Baixar backup completo</button>
        {isAdmin && (
          <>
            <button className="btn btn-ghost" onClick={() => inputRef.current && inputRef.current.click()}>⤒ Restaurar de um backup</button>
            <input ref={inputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && escolherArquivo(e.target.files[0])} />
          </>
        )}
      </div>
      {msg && <p className="muted small" style={{ marginTop: 10 }}>{msg}</p>}
      <p className="muted small" style={{ marginTop: 8 }}>Dica: baixe um backup de tempos em tempos (ex.: uma vez por mês). O arquivo é só seu e não é enviado a lugar nenhum.</p>

      {pendente && (
        <div className="modal-bg" onClick={() => setPendente(null)}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">Restaurar este backup?</div>
            <p className="confirm-msg">
              Arquivo: <b>{pendente.nome}</b>{pendente.quando ? ` (de ${new Date(pendente.quando).toLocaleDateString("pt-BR")})` : ""}.<br />
              Ele contém {contar(pendente.dados).animais} animais, {contar(pendente.dados).socios} sócios, {contar(pendente.dados).leiloes} leilões.<br /><br />
              <b>Atenção:</b> restaurar vai <b>substituir</b> os dados atuais da sua conta pelos do arquivo. Faça um backup do estado atual antes, se tiver dúvida.
            </p>
            <div className="confirm-acts">
              <button className="btn btn-ghost" onClick={() => setPendente(null)}>Cancelar</button>
              <button className="btn btn-gold" onClick={baixar}>Baixar backup atual antes</button>
              <button className="btn btn-danger" onClick={confirmarRestauro}>Restaurar mesmo assim</button>
            </div>
          </div>
        </div>
      )}

      <div className="card-h" style={{ marginTop: 20 }}>☁️ Backups automáticos (nuvem)</div>
      {autoList === null ? (
        <p className="muted small" style={{ marginTop: -4 }}>Carregando…</p>
      ) : autoErro ? (
        <p className="muted small" style={{ marginTop: -4 }}>Os backups automáticos ainda não foram ativados no servidor. Depois de rodar o script no Supabase, as cópias diárias aparecem aqui sozinhas.</p>
      ) : autoList.length === 0 ? (
        <p className="muted small" style={{ marginTop: -4 }}>Nenhuma cópia automática ainda. A primeira aparece na próxima execução diária (ou assim que o script for rodado).</p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: -4 }}>Último backup automático: <b>{new Date(autoList[0].criado_em).toLocaleString("pt-BR")}</b>. São guardadas as últimas {autoList.length} cópias (uma por dia).</p>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Data e hora</th><th>Origem</th><th></th></tr></thead>
            <tbody>{autoList.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.criado_em).toLocaleString("pt-BR")}</td>
                <td>{b.origem === "manual" ? "Manual" : "Automático"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{isAdmin && <button className="btn btn-mini" onClick={() => restaurarNuvem(b.id)}>Restaurar esta cópia</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted small" style={{ marginTop: 8 }}>Restaurar substitui os dados atuais da sua conta pelos da cópia escolhida — o sistema pede confirmação antes.</p>
        </>
      )}
    </div>
  );
}



/* ====================== CRIATÓRIOS PARCEIROS ========================== */
function CriatoriosView({ criatorios, ativos, socioNames, onSalvar, onExcluir, onRegistrarContato, onAbrir }) {
  const [form, setForm] = useState(null);     // criatório em edição/criação
  const [contato, setContato] = useState(null); // criatório recebendo contato
  const [cForm, setCForm] = useState({ data: today(), responsavel: "", meio: "WhatsApp", assunto: "", recebido: "", proximo: "" });

  const reais = (ativos || []).filter((a) => a && a.origem !== "genealogia" && !a.arquivada);
  // registros vinculados a um criatório (por campo criatorio OU onde está)
  const doCriatorio = (nome) => reais.filter((a) => lc(a.criatorio) === lc(nome) || lc(a.ondeEsta) === lc(nome));

  const salvarCont = () => {
    if (!cForm.assunto && !cForm.recebido) { setContato(null); return; }
    onRegistrarContato(contato.id, { id: uid(), ...cForm });
    setContato(null); setCForm({ data: today(), responsavel: "", meio: "WhatsApp", assunto: "", recebido: "", proximo: "" });
  };

  return (
    <section className="wrap">
      <div className="card">
        <div className="card-h">Criatórios Parceiros <span className="muted">({(criatorios || []).length})</span></div>
        <p className="muted small" style={{ marginTop: -4 }}>Onde seus animais, prenhezes e aspirações estão sob responsabilidade de parceiros. Vincule preenchendo o <b>Criatório responsável</b> nas fichas.</p>
        <button className="btn btn-gold" style={{ marginTop: 8 }} onClick={() => setForm({ id: uid(), nome: "", contato: "", tel: "", obs: "", contatos: [] })}>+ Novo criatório</button>
      </div>

      <div className="cards-grid wide">
        {(criatorios || []).map((c) => {
          const regs = doCriatorio(c.nome);
          const animais = regs.filter((a) => a.tipo === "animal");
          const prenh = regs.filter((a) => a.tipo === "prenhez");
          const asp = regs.filter((a) => a.tipo === "aspiracao");
          const partosProx = prenh.filter((a) => { const n = alertaParto(a); return n && n !== null; });
          const ultimo = (c.contatos || []).slice().sort((x, y) => (y.data || "").localeCompare(x.data || ""))[0];
          return (
            <div className="card" key={c.id}>
              <div className="card-h">{c.nome}</div>
              <div className="socio-lines">
                <div><span>Contato</span><b>{c.contato || "—"}</b></div>
                <div><span>Telefone/WhatsApp</span><b>{c.tel || "—"}</b></div>
                <div><span>Animais</span><b>{animais.length}</b></div>
                <div><span>Prenhezes</span><b>{prenh.length}</b></div>
                <div><span>Aspirações</span><b>{asp.length}</b></div>
                <div><span>Partos próximos/atrasados</span><b className={partosProx.length ? "neg" : ""}>{partosProx.length}</b></div>
                <div><span>Último contato</span><b>{ultimo ? dataBR(ultimo.data) : "—"}</b></div>
              </div>
              <div className="socio-parts">{regs.slice(0, 12).map((a) => <span className="tag" key={a.id} onClick={() => onAbrir(a)}>{a.nome}</span>)}
                {regs.length === 0 && <span className="muted small">Nenhum registro vinculado ainda.</span>}</div>
              {(c.contatos || []).length > 0 && (
                <div className="muted small" style={{ marginTop: 8 }}>{c.contatos.length} contato(s) registrado(s). Último: {ultimo.assunto || ultimo.recebido || "—"}</div>
              )}
              <div className="card-acts">
                <button className="btn btn-mini gold" onClick={() => setContato(c)}>Registrar contato</button>
                <button className="btn btn-mini" onClick={() => setForm(c)}>Editar</button>
                <button className="btn-del" onClick={() => onExcluir(c)}>🗑 Excluir</button>
              </div>
            </div>
          );
        })}
        {(criatorios || []).length === 0 && <div className="empty">Nenhum criatório cadastrado. Clique em "+ Novo criatório".</div>}
      </div>

      {form && (
        <div className="modal-bg" onClick={() => setForm(null)}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">{form.nome ? "Editar criatório" : "Novo criatório"}</div>
            <label className="field"><span>Nome do criatório</span><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex.: Nelore Lince" autoFocus /></label>
            <label className="field"><span>Pessoa de contato</span><input value={form.contato} onChange={(e) => setForm({ ...form, contato: e.target.value })} /></label>
            <label className="field"><span>Telefone / WhatsApp</span><input value={form.tel} onChange={(e) => setForm({ ...form, tel: e.target.value })} /></label>
            <label className="field"><span>Observações</span><textarea rows={2} value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></label>
            <div className="confirm-acts">
              <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-gold" disabled={!form.nome.trim()} onClick={() => { onSalvar(form); setForm(null); }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {contato && (
        <div className="modal-bg" onClick={() => setContato(null)}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">Registrar contato — {contato.nome}</div>
            <div className="grid">
              <label className="field"><span>Data</span><input type="date" value={cForm.data} onChange={(e) => setCForm({ ...cForm, data: e.target.value })} /></label>
              <label className="field"><span>Responsável</span><input value={cForm.responsavel} onChange={(e) => setCForm({ ...cForm, responsavel: e.target.value })} /></label>
              <label className="field"><span>Meio</span>
                <select value={cForm.meio} onChange={(e) => setCForm({ ...cForm, meio: e.target.value })}><option>WhatsApp</option><option>Telefone</option><option>E-mail</option><option>Presencial</option><option>Outro</option></select></label>
              <label className="field"><span>Próximo acompanhamento</span><input type="date" value={cForm.proximo} onChange={(e) => setCForm({ ...cForm, proximo: e.target.value })} /></label>
              <label className="field wide"><span>Assunto</span><input value={cForm.assunto} onChange={(e) => setCForm({ ...cForm, assunto: e.target.value })} /></label>
              <label className="field wide"><span>Informações recebidas</span><textarea rows={2} value={cForm.recebido} onChange={(e) => setCForm({ ...cForm, recebido: e.target.value })} /></label>
            </div>
            {(contato.contatos || []).length > 0 && (
              <div className="tbl-wrap" style={{ marginTop: 6, maxHeight: 160, overflow: "auto" }}><table className="tbl">
                <thead><tr><th>Data</th><th>Meio</th><th>Assunto</th></tr></thead>
                <tbody>{contato.contatos.slice().sort((x, y) => (y.data || "").localeCompare(x.data || "")).map((h) => (
                  <tr key={h.id}><td>{dataBR(h.data)}</td><td>{h.meio}</td><td className="small">{h.assunto || h.recebido || "—"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="confirm-acts">
              <button className="btn btn-ghost" onClick={() => setContato(null)}>Fechar</button>
              <button className="btn btn-gold" onClick={salvarCont}>Salvar contato</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================================= APP ================================= */
/* --------------------------- Lixeira de animais ------------------------ */
function LixeiraView({ lixeira, onRestaurar, onExcluirDefinitivo }) {
  const RETENCAO = 30; // dias de referência para recuperação
  const diasRestantes = (iso) => {
    if (!iso) return null;
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return Math.max(0, RETENCAO - dias);
  };
  const itens = (lixeira || []).slice().sort((a, b) => String(b.__deletedAt || "").localeCompare(String(a.__deletedAt || "")));
  return (
    <section className="wrap">
      <div className="card">
        <div className="card-h">Lixeira de animais <span className="muted">({itens.length})</span></div>
        <p className="muted small" style={{ marginTop: -4 }}>
          Animais excluídos ficam aqui e podem ser restaurados com todas as informações (genealogia, sociedade, participação, compras, vendas, parcelas e históricos). A exclusão permanente é feita só manualmente, por você. Nada é apagado automaticamente.
        </p>
        {itens.length === 0 ? (
          <p className="muted small">A lixeira está vazia.</p>
        ) : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Nome</th><th>RG</th><th>Excluído em</th><th>Por</th><th>Prazo p/ recuperar</th><th></th></tr></thead>
            <tbody>{itens.map((a) => {
              const dr = diasRestantes(a.__deletedAt);
              return (
                <tr key={a.id}>
                  <td>{a.nome || "(sem nome)"}</td>
                  <td>{a.registro || "—"}</td>
                  <td>{a.__deletedAt ? dataBR(String(a.__deletedAt).slice(0, 10)) : "—"}</td>
                  <td>{a.__deletedBy || "—"}</td>
                  <td>{dr == null ? "—" : `${dr} dia(s)`}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-gold btn-mini" onClick={() => onRestaurar(a.id)}>Restaurar</button>{" "}
                    <button className="btn-del" onClick={() => onExcluirDefinitivo(a.id)}>Excluir definitivamente</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

/* ===================== IMPORTAÇÃO POR EXCEL ===================== *
 * Aditivo e isolado: lê a planilha e monta PRÉ-CADASTROS no formato do
 * sistema. Nada entra em "ativos" sem aprovação individual.
 * Regras de sociedade combinadas: sem % => divide igual (SM no rateio);
 * SM não citada ou % parcial => fica "a conferir" (vermelho).            */
const impNorm = (s) => (s == null ? "" : s.toString().trim());
const impLow = (s) => impNorm(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const impNum = (v) => { if (v == null || v === "") return 0; if (typeof v === "number") return v; const n = parseFloat(v.toString().replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
function impData(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  const s = v.toString().trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (!isNaN(n) && n > 20000 && n < 80000) { const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return dt.toISOString().slice(0, 10); }
  return "";
}
const IMP_SM = ["agro sm nelore", "agro sm", "sm agropecuaria", "sm"];
const impIsSM = (nome) => { const n = impLow(nome); return n === "sm" || n.startsWith("agro sm") || IMP_SM.includes(n) || IMP_SM.map((x) => x.replace(/\s/g, "")).includes(n.replace(/\s/g, "")); };
function impParsePct(tok) {
  tok = impNorm(tok); if (!tok) return null;
  let m = tok.match(/\(([\d.,]+)\s*%?\)/);
  if (m) return { nome: tok.slice(0, m.index).replace(/[-/\s]+$/, "").trim(), pct: parseFloat(m[1].replace(",", ".")) };
  m = tok.match(/^([\d.,]+)\s*%\s*(.+)$/);
  if (m) return { nome: m[2].replace(/^[-/\s]+/, "").trim(), pct: parseFloat(m[1].replace(",", ".")) };
  m = tok.match(/(.+?)\s+([\d.,]+)\s*%$/);
  if (m) return { nome: m[1].replace(/[-/\s]+$/, "").trim(), pct: parseFloat(m[2].replace(",", ".")) };
  return { nome: tok.replace(/^[-/\s]+|[-/\s]+$/g, "").trim(), pct: null };
}
function impParseSoc(texto) {
  const raw = impNorm(texto);
  if (!raw) return { sm: null, outros: [], status: "conferir", motivo: "sociedade vazia" };
  const parsed = raw.split(/\s*\/\s*|\s+-\s+/).filter((x) => x.trim()).map(impParsePct).filter((p) => p && p.nome);
  if (!parsed.length) return { sm: null, outros: [], status: "conferir", motivo: "sociedade não reconhecida" };
  const smi = parsed.findIndex((p) => impIsSM(p.nome));
  const allG = parsed.every((p) => p.pct != null);
  const allN = parsed.every((p) => p.pct == null);
  const outros = (idx) => parsed.filter((_, i) => i !== idx).map((p) => ({ nome: p.nome, pct: p.pct }));
  if (smi < 0) return { sm: null, outros: parsed.map((p) => ({ nome: p.nome, pct: p.pct })), status: "conferir", motivo: "SM não citada — preencher % da SM" };
  if (allG) { const tot = parsed.reduce((s, p) => s + p.pct, 0); const ok = Math.abs(tot - 100) <= 0.5; return { sm: Math.round(parsed[smi].pct * 100) / 100, outros: outros(smi), status: ok ? "ok" : "conferir", motivo: ok ? "" : `soma ${tot}%` }; }
  if (allN) { const eq = Math.round((100 / parsed.length) * 100) / 100; return { sm: eq, outros: parsed.filter((_, i) => i !== smi).map((p) => ({ nome: p.nome, pct: eq })), status: "ok", motivo: "divisão igual" }; }
  if (parsed[smi].pct != null) { const given = parsed.reduce((s, p) => s + (p.pct || 0), 0); const nun = parsed.filter((p) => p.pct == null).length; const rem = nun ? Math.round(((100 - given) / nun) * 100) / 100 : 0; return { sm: Math.round(parsed[smi].pct * 100) / 100, outros: parsed.filter((_, i) => i !== smi).map((p) => ({ nome: p.nome, pct: p.pct == null ? rem : p.pct })), status: "conferir", motivo: "% parcial — confira a divisão" }; }
  return { sm: null, outros: outros(smi), status: "conferir", motivo: "% da SM não informado" };
}
const IMP_TIPOS = { aspiracao: "aspiracao", prenhez: "prenhez", prenhezes: "prenhez" };
function impField(h) {
  h = impLow(h); if (!h) return null;
  if (h === "data") return "dataCompra";
  if (h.includes("socied")) return "__soc";
  if (h.includes("leil")) return "leilao";
  if (h === "lote") return "__lote";
  if (h.includes("r$") && h.includes("parc")) return "__rparc";
  if (h === "parc" || h === "parc." || (h.startsWith("parc") && !h.includes("parto"))) return "parcelas";
  if (h.includes("valor total")) return "__vtotal";
  if (h.includes("inicio")) return "primeiroVenc";
  if (h === "tipo") return "__tipo";
  if (h.includes("quant")) return "qtd";
  if (h === "rg" || h === "registro" || h.includes("registro da") || (h.includes("registro") && h.includes("doadora"))) return "regDoadora";
  if (h.includes("doadora")) return "doadora";
  if (h.includes("touro")) return "pai";
  if (h.startsWith("obs")) return "obs";
  return null;
}
/* separa RG + nome quando vêm juntos na mesma célula.
 * "FGN 417 - RUSSIA FIV DA GUANABARA" ou "CABN 9513 DELUXE FIV CBA"
 *   -> rg "CABN 9513", nome "DELUXE FIV CBA". Só separa quando confiável;
 *   senão devolve o texto inteiro como nome (não inventa RG). */
function impSepararRG(texto) {
  const orig = impNorm(texto).replace(/\s+/g, " ").trim();
  if (!orig) return { rg: "", nome: "", orig: "" };
  let m = orig.match(/^([A-Za-zÀ-ÿ]{2,6}\s+[A-Za-z]?\d{1,6}[A-Za-z]?)\s*[-–—]\s*(.+)$/);
  if (m) return { rg: m[1].toUpperCase().replace(/\s+/g, " ").trim(), nome: m[2].replace(/\s+/g, " ").trim(), orig };
  m = orig.match(/^([A-Za-zÀ-ÿ]{2,6}\s+[A-Za-z]?\d{3,6}[A-Za-z]?)\s+([A-Za-zÀ-ÿ].*)$/);
  if (m) return { rg: m[1].toUpperCase().replace(/\s+/g, " ").trim(), nome: m[2].replace(/\s+/g, " ").trim(), orig };
  return { rg: "", nome: orig, orig };
}
/* nomes de animais/genealogia sempre em MAIÚSCULAS na importação
 * (preserva acentos; só espaços duplicados são removidos). */
const impUpper = (s) => impNorm(s).replace(/\s+/g, " ").trim().toUpperCase();

/* ===== BASE GENEALÓGICA (reutiliza os "ativos"; sem tabela nova) ===== */
const gnorm = (s) => (s == null ? "" : s.toString()).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const GEN_CAMPOS = ["pai", "mae", "avoPaterno", "avoPaterna", "avoMaterno", "avoMaterna"];
const genScore = (a) => GEN_CAMPOS.reduce((n, k) => n + (a && a[k] && a[k].toString().trim() ? 1 : 0), 0);
function buildGenIndex(ativos) {
  const byName = {}, byRg = {}, cnt = {}, parents = {};
  // registra um candidato de pai/mãe para um nome (soma evidências)
  const add = (nameRaw, side, valRaw) => {
    const n = gnorm(nameRaw); const v = (valRaw == null ? "" : valRaw.toString()).trim();
    if (!n || !v) return;
    if (!parents[n]) parents[n] = { pai: {}, mae: {} };
    const b = parents[n][side]; const k = gnorm(v);
    if (!b[k]) b[k] = { val: v, c: 0 };
    b[k].c++;
  };
  (ativos || []).forEach((a) => {
    if (!a) return;
    if (a.tipo === "animal") {
      const nm = gnorm(a.nome);
      if (nm) { cnt[nm] = (cnt[nm] || 0) + 1; if (!byName[nm] || genScore(a) > genScore(byName[nm])) byName[nm] = a; }
      const rg = gnorm(a.registro); if (rg && !byRg[rg]) byRg[rg] = a;
      // pais próprios do animal (fonte direta)
      add(a.nome, "pai", a.pai); add(a.nome, "mae", a.mae);
    }
    // APRENDIZADO: os avós informados em qualquer cadastro revelam quem são
    // os pais do reprodutor (pai/doadora) usado ali.
    const maeNome = a.tipo === "animal" ? a.mae : a.doadora;
    if (a.pai) { add(a.pai, "pai", a.avoPaterno); add(a.pai, "mae", a.avoPaterna); }
    if (maeNome) { add(maeNome, "pai", a.avoMaterno); add(maeNome, "mae", a.avoMaterna); }
  });
  return { byName, byRg, cnt, parents };
}
/* resolve os pais de um nome juntando o direto + o aprendido.
 * um único valor => usa; valores divergentes => não sugere aquele lado (evita erro). */
function resolveParents(nome, index) {
  const p = index && index.parents && index.parents[gnorm(nome)];
  if (!p) return { pai: "", mae: "" };
  const pick = (b) => { const vs = Object.values(b || {}); return vs.length === 1 ? vs[0].val : ""; };
  return { pai: pick(p.pai), mae: pick(p.mae) };
}
/* devolve pai/mae do reprodutor identificado (RG tem prioridade; nome exato como apoio;
 * nome ambíguo sem RG => não sugere). Nunca junta por nome só parecido. */
function genealogiaDe(nome, rg, index) {
  if (!index) return null;
  let canon = nome, temRg = false;
  const r = gnorm(rg);
  if (r && index.byRg[r]) { canon = index.byRg[r].nome; temRg = true; }
  const n = gnorm(canon);
  if (!n) return null;
  const pr = resolveParents(canon, index);
  const rec = index.byName[n];
  return { pai: pr.pai, mae: pr.mae, nome: rec ? rec.nome : canon, registro: rec ? rec.registro : "" };
}
/* preenche a ÁRVORE de um lado (avós + bisavós) a partir de um reprodutor conhecido.
 * np = cópia do registro; sug = Set de campos marcados como sugestão.
 * Só preenche campos VAZIOS; pula ambíguo/conflito; não cria laço (não repete o próprio nome). */
function fillArvore(np, side, repNome, repRg, index, sug, comBisavos) {
  if (!repNome || !repNome.toString().trim() || !index) return;
  const g = genealogiaDe(repNome, repRg, index);
  if (!g || g.ambiguo) return;
  const K = side === "pat"
    ? { avo: "avoPaterno", ava: "avoPaterna", bAvoP: "bis_pp_p", bAvoM: "bis_pp_m", bAvaP: "bis_pm_p", bAvaM: "bis_pm_m" }
    : { avo: "avoMaterno", ava: "avoMaterna", bAvoP: "bis_mp_p", bAvoM: "bis_mp_m", bAvaP: "bis_mm_p", bAvaM: "bis_mm_m" };
  const put = (k, v, ref) => { const val = (v || "").toString().trim(); if (val && gnorm(val) !== gnorm(ref) && gnorm(val) !== gnorm(np.nome) && !(np[k] && np[k].toString().trim())) { np[k] = val; sug.add(k); } };
  put(K.avo, g.pai, repNome);
  put(K.ava, g.mae, repNome);
  if (comBisavos) {
    if (g.pai) { const gg = genealogiaDe(g.pai, "", index); if (gg && !gg.ambiguo) { put(K.bAvoP, gg.pai, g.pai); put(K.bAvoM, gg.mae, g.pai); } }
    if (g.mae) { const gg = genealogiaDe(g.mae, "", index); if (gg && !gg.ambiguo) { put(K.bAvaP, gg.pai, g.mae); put(K.bAvaM, gg.mae, g.mae); } }
  }
}

function impMontaPreficha(vals) {
  const tipoRaw = impLow(vals.__tipo);
  if (tipoRaw === "combo") return { skip: "COMBO", nome: impNorm(vals.doadora) };
  const tipo = IMP_TIPOS[tipoRaw];
  if (!tipo) return { skip: tipoRaw || "tipo em branco", nome: impNorm(vals.doadora) };
  const soc = impParseSoc(vals.__soc);
  const rparc = impNum(vals.__rparc);
  const parcelas = Math.round(impNum(vals.parcelas));
  const smPct = soc.sm;
  const lote = impNorm(vals.__lote);
  // RG + nome da doadora (coluna própria tem prioridade; senão tenta separar do nome)
  const rgCol = impNorm(vals.regDoadora);
  const sep = impSepararRG(vals.doadora);
  const doadoraNome = impUpper(sep.nome || impNorm(vals.doadora));
  const rgDoadora = rgCol ? impUpper(rgCol) : sep.rg;
  const rgConferir = !!(rgCol && sep.rg && impLow(rgCol) !== impLow(sep.rg));
  const d = {
    id: uid(), tipo,
    doadora: doadoraNome, pai: impUpper(vals.pai),
    regDoadora: rgDoadora,
    qtd: impNum(vals.qtd) || 1,
    status: tipo === "prenhez" ? "Aguardando confirmação" : "Realizada",
    leilao: impNorm(vals.leilao),
    dataCompra: impData(vals.dataCompra),
    primeiroVenc: impData(vals.primeiroVenc) || impData(vals.dataCompra),
    porcentagemComprada: smPct != null ? smPct : "",
    // IMPORTANTE: o valor do Excel JÁ É a parte da SM — não multiplicar pela % de novo.
    valorParcela: rparc || "",
    parcelas: parcelas || "",
    comissaoPct: 8, comissaoTipo: "Sobre o valor da parcela", considerarVencidasPagas: true,
    socios: (soc.outros || []).filter((s) => s.nome).map((s) => ({ id: uid(), nome: s.nome, pct: s.pct == null ? "" : s.pct, obs: "" })),
    videos: [], historico: [],
  };
  if (rgDoadora) d.__regAuto = false;
  const notas = [];
  if (lote) notas.push("Lote: " + lote);
  if (impNorm(vals.__soc)) notas.push('Sociedade (planilha): "' + impNorm(vals.__soc) + '"');
  if (smPct == null) notas.push("⚠ Defina a participação da SM (%). O valor da parcela já é a parte da SM.");
  d.obsCompra = notas.join(" · ");
  d.nome = rotuloReprod(d);
  const status = (soc.status === "conferir" || rgConferir) ? "conferir" : "ok";
  const motivo = rgConferir ? ((soc.motivo ? soc.motivo + "; " : "") + "RG da coluna difere do RG no nome") : soc.motivo;
  return { d, status, motivo, societRaw: impNorm(vals.__soc), lote, rgInfo: { orig: sep.orig, rg: rgDoadora, nome: doadoraNome } };
}
function impLerArquivo(arrayBuffer) {
  const out = { registros: [], pulados: [], erro: "" };
  let wb; try { wb = XLSX.read(arrayBuffer, { type: "array" }); } catch (e) { out.erro = "Não consegui abrir o arquivo. Envie um .xlsx válido."; return out; }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) { out.erro = "A planilha está vazia."; return out; }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let hi = -1;
  for (let i = 0; i < aoa.length; i++) {
    const cells = (aoa[i] || []).map(impLow);
    if (cells.includes("data") && cells.some((c) => c.includes("socied"))) { hi = i; break; }
  }
  if (hi < 0) { out.erro = "Não encontrei o cabeçalho (uma linha com DATA e SOCIED.). Confira a planilha."; return out; }
  const col = {};
  (aoa[hi] || []).forEach((h, idx) => { const f = impField(h); if (f && col[f] == null) col[f] = idx; });
  for (let i = hi + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (!row.some((c) => c != null && c !== "")) continue;
    const vals = {}; Object.keys(col).forEach((f) => { vals[f] = row[col[f]]; });
    if (impLow(vals.__tipo) === "total" || impLow(vals.doadora) === "total" || impLow(vals.leilao) === "total") continue;
    if (!impNorm(vals.doadora) && !impNorm(vals.__tipo) && !impNorm(vals.leilao)) continue;
    const r = impMontaPreficha(vals);
    if (r.skip) { out.pulados.push(r.skip + (r.nome ? ": " + r.nome : "")); continue; }
    out.registros.push({ id: uid(), origem: "excel", criadoEm: today(), estado: r.status === "conferir" ? "pendente" : "novo", status: r.status, motivo: r.motivo, societRaw: r.societRaw, lote: r.lote, rgInfo: r.rgInfo, dados: r.d });
  }
  const seen = {};
  out.registros.forEach((x) => { const k = impLow(x.dados.doadora) + "|" + impLow(x.dados.leilao) + "|" + impLow(x.lote); x.dup = !!seen[k]; seen[k] = true; });
  return out;
}
/* commit compartilhado: aplica um novo registro sobre o estado do banco
 * (stubs de doadora/touro, listas-mestre, histórico). Usado pelo cadastro
 * manual (salvar) e pela aprovação de pré-cadastro — comportamento idêntico. */
function aplicarNovoRegistro(p, d, profileNome, veioDeOrigem, origemId) {
  let list = [...p.ativos];
  const nameSet = new Set(list.filter((a) => a && a.tipo === "animal" && a.nome).map((a) => lc(a.nome)));
  linkKeysOf(d.tipo).forEach((k) => { const nm = (d[k] ?? "").toString().trim(); if (nm && !nameSet.has(lc(nm)) && lc(nm) !== lc(d.nome)) { list.push(stubAnimal(nm, profileNome)); nameSet.add(lc(nm)); } });
  const regPairs = { prenhez: [["doadora", "regDoadora"]], aspiracao: [["doadora", "regDoadora"]], animal: [["mae", "maeRegistro"]] };
  (regPairs[d.tipo] || []).forEach(([nk, rk]) => {
    const nm = (d[nk] || "").toString().trim(); const rg = (d[rk] || "").toString().trim();
    if (nm && rg) list = list.map((a) => (a && a.tipo === "animal" && lc(a.nome) === lc(nm) && !a.registro ? { ...a, registro: rg } : a));
  });
  const exists = list.some((a) => a.id === d.id);
  if (exists) list = list.map((a) => (a.id === d.id ? d : a));
  else {
    const histIni = [{ id: uid(), data: today(), tipo: "Cadastro criado", desc: "Ficha criada", responsavel: profileNome }];
    if (veioDeOrigem && d.origemLabel) histIni.unshift({ id: uid(), data: today(), tipo: "Origem", desc: `Nascido de ${d.origemLabel}`, responsavel: profileNome });
    list = [{ ...d, historico: [...histIni, ...(d.historico || [])] }, ...list];
  }
  if (veioDeOrigem && origemId) {
    list = list.map((a) => {
      if (a.id !== origemId) return a;
      const conv = qtdConvertidos(a) + 1;
      const arquivada = conv >= qtdTotal(a);
      const h = { id: uid(), data: today(), tipo: "Nascimento", desc: `Nasceu 1 (${d.nome || "animal"}). Restam ${Math.max(0, qtdTotal(a) - conv)} de ${qtdTotal(a)}.`, responsavel: profileNome };
      return { ...a, convertidos: conv, arquivada, historico: [...(a.historico || []), h] };
    });
  }
  let leiloes = [...(p.leiloes || [])]; if (d.leilao && !leiloes.some((l) => l && lc(l.nome) === lc(d.leilao))) leiloes = [...leiloes, { id: uid(), nome: d.leilao }];
  let locais = [...(p.locais || [])]; if (d.ondeEsta && !locais.some((l) => lc(l) === lc(d.ondeEsta))) locais = [...locais, d.ondeEsta];
  let vendedores = [...(p.vendedores || [])]; if (d.vendedor && !vendedores.some((v) => v && lc(v.nome) === lc(d.vendedor))) vendedores = [...vendedores, { id: uid(), nome: d.vendedor, tipo: "Outro", doc: "", tel: "", email: "", obs: "" }];
  let socios = [...(p.socios || [])]; (d.socios || []).forEach((s) => { if (s && s.nome && !socios.some((x) => x && lc(x.nome) === lc(s.nome))) socios = [...socios, { id: uid(), nome: s.nome, doc: "", tel: "", email: "", endereco: "", obs: "" }]; });
  return { ...p, ativos: list, leiloes, locais, vendedores, socios };
}

export default function App() {
  const [db, setDb] = useState(SEED);
  const [view, setView] = useState("dashboard");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(null);
  const [form, setForm] = useState(null);
  const [novo, setNovo] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showAncestrais, setShowAncestrais] = useState(false);
  const [filtroSit, setFiltroSit] = useState("ativos");   // ativos | inativos | todos
  // filtros do Painel (afetam inteligência financeira e composição do plantel)
  const [dfSituacao, setDfSituacao] = useState("ativos");
  const [dfSocio, setDfSocio] = useState("");
  const [dfCriatorio, setDfCriatorio] = useState("");
  const [dfPeriodo, setDfPeriodo] = useState("12m");
  // sempre que ENTRAR no Painel, o filtro de situação volta a ATIVOS (padrão), sem guardar a última escolha
  useEffect(() => { if (view === "dashboard") setDfSituacao("ativos"); }, [view]);
  // celular: quando o menu-gaveta está aberto, trava a rolagem do fundo (não trava no desktop)
  useEffect(() => {
    if (navOpen) {
      const antes = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = antes; };
    }
  }, [navOpen]);
  const [privado, setPrivado] = useState(() => { try { return localStorage.getItem("sm_privado") === "1"; } catch (e) { return false; } });
  useEffect(() => { try { localStorage.setItem("sm_privado", privado ? "1" : "0"); } catch (e) {} }, [privado]);
  const money = (v) => (privado ? "R$ ••••••" : fmt(v));
  const [session, setSession] = useState(null);       // sessão do Supabase
  const [profile, setProfile] = useState(null);       // perfil (nome, permissão, aprovação)
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [recovering, setRecovering] = useState(false); // veio pelo link de redefinição de senha

  const dbRef = useRef(null);
  const lastWrite = useRef(0);
  const firstSave = useRef(true);
  // --- estado de salvamento na nuvem (indicador) ---
  const [saveStatus, setSaveStatus] = useState("idle"); // idle|pending|saving|saved|error|offline
  const saveTimer = useRef(null);
  const saveSeq = useRef(0);        // sequência monotônica: impede gravação antiga sobrescrever recente
  const latestJson = useRef("");    // último db serializado (pendente de gravação)
  const flushNext = useRef(false);  // próxima gravação é imediata (ações críticas)
  const revRef = useRef(null);      // versão da linha na nuvem que carreguei (null = ainda não existe)
  const [conflito, setConflito] = useState(false); // outro aparelho gravou enquanto eu editava

  /* carregar banco (compartilhado → antigo pessoal → seed) e sessão salva */
  /* garante que o banco tenha todas as coleções, mesmo vindo de versões antigas */
  const normalizeDb = (b) => {
    const base = b && typeof b === "object" ? b : {};
    return {
      ...base,
      ativos: Array.isArray(base.ativos) ? base.ativos.filter(Boolean) : [],
      socios: Array.isArray(base.socios) ? base.socios.filter(Boolean) : [],
      leiloes: Array.isArray(base.leiloes) ? base.leiloes.filter(Boolean) : [],
      locais: Array.isArray(base.locais) ? base.locais.filter(Boolean) : [],
      vendedores: Array.isArray(base.vendedores) ? base.vendedores.filter(Boolean) : [],
      users: Array.isArray(base.users) ? base.users.filter(Boolean) : [],
      prefichas: Array.isArray(base.prefichas) ? base.prefichas.filter(Boolean) : [],
      migracoes: Array.isArray(base.migracoes) ? base.migracoes.filter(Boolean) : [],
      criatorios: Array.isArray(base.criatorios) ? base.criatorios.filter(Boolean) : [],
      lixeira: Array.isArray(base.lixeira) ? base.lixeira.filter(Boolean) : [],
    };
  };

  /* ---- sessão (Supabase Auth) ---- */
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => { setSession(data && data.session ? data.session : null); setAuthReady(true); })
      .catch(() => setAuthReady(true));
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => { setSession(s); if (ev === "PASSWORD_RECOVERY") setRecovering(true); });
    return () => { try { sub.subscription.unsubscribe(); } catch (e) {} };
  }, []);

  /* ---- perfil do usuário logado (nome, permissão, aprovação) ---- */
  useEffect(() => {
    if (!session) { setProfile(null); setProfileLoaded(false); setDataReady(false); firstSave.current = true; return; }
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        if (alive) { setProfile(data || null); setProfileLoaded(true); }
      } catch (e) { if (alive) { setProfile(null); setProfileLoaded(true); } }
    })();
    return () => { alive = false; };
  }, [session]);

  const aprovado = !!(profile && profile.aprovado);
  const isAdmin = !!(profile && profile.role === "Administrador" && profile.aprovado);

  /* ---- carregar o banco DO USUÁRIO logado (isolado por user_id) ---- */
  useEffect(() => {
    if (!session || !aprovado) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("app_data").select("value, rev").eq("user_id", session.user.id).maybeSingle();
        if (!alive) return;
        // usuário novo (sem linha própria) começa ZERADO — nunca vê dados de outro usuário
        const base = normalizeDb(data && data.value ? JSON.parse(data.value) : {});
        setDb(base); dbRef.current = JSON.stringify(base);
        revRef.current = data ? (typeof data.rev === "number" ? data.rev : 0) : null; // null = ainda não há linha
      } catch (e) {
        const base = normalizeDb({}); setDb(base); dbRef.current = JSON.stringify(base); revRef.current = null;
      }
      if (alive) setDataReady(true);
    })();
    return () => { alive = false; };
  }, [session, aprovado]);

  /* ---- gravação real na nuvem, com confirmação do Supabase ---- */
  const temPendencia = () => !!latestJson.current && latestJson.current !== dbRef.current;
  const doSave = async () => {
    if (!session) return;
    const json = latestJson.current;
    if (!json) return;
    if (json === dbRef.current) { setSaveStatus(temPendencia() ? "pending" : "saved"); return; } // nada novo para gravar
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setSaveStatus("offline"); return; }
    const seq = ++saveSeq.current;
    const uid = session.user.id;
    setSaveStatus("saving");
    try {
      if (revRef.current == null) {
        // ainda não existe linha para este usuário → cria
        const { data, error } = await supabase.from("app_data").insert({ user_id: uid, value: json, rev: 0, updated_at: new Date().toISOString() }).select("rev");
        if (error) {
          if (error.code === "23505") {
            // a linha já existe (p.ex. outra aba MINHA criou) → adoto a versão atual e regravo, sem alarmar
            const { data: at } = await supabase.from("app_data").select("rev").eq("user_id", uid).maybeSingle();
            revRef.current = at && typeof at.rev === "number" ? at.rev : 0;
            if (seq === saveSeq.current) doSave();
            return;
          }
          if (seq === saveSeq.current) setSaveStatus("error");
          return;
        }
        revRef.current = (data && data[0] && typeof data[0].rev === "number") ? data[0].rev : 0;
        dbRef.current = json; lastWrite.current = Date.now();
      } else {
        const alvo = revRef.current;
        const { data, error } = await supabase.from("app_data")
          .update({ value: json, rev: alvo + 1, updated_at: new Date().toISOString() })
          .eq("user_id", uid).eq("rev", alvo).select("rev");
        if (error) { if (seq === saveSeq.current) setSaveStatus("error"); return; }
        if (!data || data.length === 0) {
          // a versão na nuvem não é a que eu tinha. ANTES de alarmar, confiro se foi a MINHA
          // própria gravação (ex.: salvamentos em sequência) e não outro aparelho de verdade.
          const { data: at } = await supabase.from("app_data").select("value, rev").eq("user_id", uid).maybeSingle();
          if (at && typeof at.rev === "number") revRef.current = at.rev;
          const meuProprio = at && (at.value === dbRef.current || at.value === json);
          if (meuProprio) {
            if (at.value === json) { dbRef.current = json; lastWrite.current = Date.now(); }
            else { if (seq === saveSeq.current) doSave(); return; } // ainda tenho diferença minha → regravo sobre a versão atual
          } else {
            // conteúdo realmente diferente do que eu conheço → conflito REAL de outro aparelho
            if (seq === saveSeq.current) { setConflito(true); setSaveStatus("error"); }
            return;
          }
        } else {
          revRef.current = data[0].rev; dbRef.current = json; lastWrite.current = Date.now();
        }
      }
      if (seq === saveSeq.current) setSaveStatus(temPendencia() ? "pending" : "saved");
    } catch (e) {
      if (seq === saveSeq.current) setSaveStatus("error");
    }
  };

  // baixa a versão mais recente da nuvem (descartando as minhas alterações não gravadas)
  const atualizarDaNuvem = async () => {
    if (!session) return;
    try {
      const { data } = await supabase.from("app_data").select("value, rev").eq("user_id", session.user.id).maybeSingle();
      if (data && data.value) {
        dbRef.current = data.value; latestJson.current = data.value;
        revRef.current = typeof data.rev === "number" ? data.rev : 0;
        setDb(normalizeDb(JSON.parse(data.value)));
      }
      setConflito(false); setSaveStatus("saved");
    } catch (e) { setSaveStatus("error"); }
  };

  // mantém as minhas e grava por cima (opção consciente do usuário no aviso de conflito)
  const sobrescreverComMinhas = async () => {
    if (!session) return;
    setConflito(false); setSaveStatus("saving");
    try {
      const { data: atual } = await supabase.from("app_data").select("rev").eq("user_id", session.user.id).maybeSingle();
      const base = atual && typeof atual.rev === "number" ? atual.rev : (revRef.current || 0);
      const json = latestJson.current;
      const { data, error } = await supabase.from("app_data")
        .update({ value: json, rev: base + 1, updated_at: new Date().toISOString() })
        .eq("user_id", session.user.id).select("rev");
      if (error || !data || data.length === 0) { setSaveStatus("error"); return; }
      revRef.current = data[0].rev; dbRef.current = json; lastWrite.current = Date.now();
      setSaveStatus("saved");
    } catch (e) { setSaveStatus("error"); }
  };

  // baixa um arquivo com o estado atual (minhas alterações), para não perder nada antes de decidir
  const baixarLocalBackup = () => {
    try {
      const backup = { _tipo: "sm-sistema-backup", _versao: 1, _data: new Date().toISOString(), _por: (profile && profile.nome) || "", dados: db };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `minhas-alteracoes-sm-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {}
  };

  /* ---- salvar na nuvem com pequeno atraso (debounce ~1s); ações críticas salvam na hora ---- */
  useEffect(() => {
    if (!dataReady || !session) return;
    const json = JSON.stringify(db);
    if (firstSave.current) { firstSave.current = false; latestJson.current = json; dbRef.current = json; return; }
    latestJson.current = json;
    setSaveStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const imediato = flushNext.current; flushNext.current = false;
    saveTimer.current = setTimeout(() => { doSave(); }, imediato ? 0 : 1000);
    return () => {};
  }, [db, dataReady, session]);

  // "Salvo" volta a sumir depois de alguns segundos (sem alarmes repetitivos)
  useEffect(() => {
    if (saveStatus !== "saved") return;
    const t = setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // reage a conexão: ao voltar a internet, tenta gravar o que ficou pendente
  useEffect(() => {
    const onOnline = () => { if (temPendencia()) doSave(); };
    const onOffline = () => { if (temPendencia()) setSaveStatus("offline"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [session]);

  // evita perda silenciosa ao fechar/trocar de aba com alterações pendentes
  useEffect(() => {
    const flush = () => { if (temPendencia()) { if (saveTimer.current) clearTimeout(saveTimer.current); doSave(); } };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    const onBefore = (e) => { if (temPendencia()) { flush(); e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBefore);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", onBefore); };
  }, [session]);

  const tentarSalvarAgora = () => { if (saveTimer.current) clearTimeout(saveTimer.current); doSave(); };

  /* ---- sincronização: puxa mudanças do MESMO usuário (outros aparelhos) a cada 5s ---- */
  useEffect(() => {
    if (!dataReady || !session) return;
    const t = setInterval(async () => {
      if (form || aberto || novo || conflito) return;
      if (Date.now() - lastWrite.current < 3000) return;
      if (temPendencia() || saveStatus === "saving" || saveStatus === "error" || saveStatus === "offline") return; // nunca descarta alteração local não gravada
      try {
        const { data } = await supabase.from("app_data").select("value, rev").eq("user_id", session.user.id).maybeSingle();
        if (data && data.value && data.value !== dbRef.current) {
          dbRef.current = data.value; latestJson.current = data.value;
          revRef.current = typeof data.rev === "number" ? data.rev : revRef.current;
          setDb(normalizeDb(JSON.parse(data.value)));
        } else if (data && typeof data.rev === "number") {
          revRef.current = data.rev; // mantém a versão em dia mesmo sem mudança de conteúdo
        }
      } catch (e) {}
    }, 5000);
    return () => clearInterval(t);
  }, [dataReady, form, aberto, novo, session, saveStatus, conflito]);

  const logout = async () => { try { await supabase.auth.signOut(); } catch (e) {} };

  const soSocio = false;
  const ativos = db.ativos;
  const GEN_KEYS = ["doadora", "pai", "mae", "touro", "avoPaterno", "avoPaterna", "avoMaterno", "avoMaterna"];
  const animalNames = useMemo(() => {
    const set = new Set();
    (ativos || []).forEach((a) => {
      if (!a) return;
      if (a.tipo === "animal" && typeof a.nome === "string" && a.nome) set.add(a.nome);
      GEN_KEYS.forEach((k) => { if (typeof a[k] === "string" && a[k].trim()) set.add(a[k].trim()); });
    });
    return [...set];
  }, [ativos]);
  // mapa nome(min.) -> registro, para preencher automaticamente o registro da mãe doadora
  const animalReg = useMemo(() => {
    const m = {};
    (ativos || []).forEach((a) => {
      if (!a) return;
      if (a.tipo === "animal" && a.nome && a.registro && !m[lc(a.nome)]) m[lc(a.nome)] = a.registro;
      if (a.doadora && a.regDoadora && !m[lc(a.doadora)]) m[lc(a.doadora)] = a.regDoadora;
      if (a.mae && a.maeRegistro && !m[lc(a.mae)]) m[lc(a.mae)] = a.maeRegistro;
    });
    return m;
  }, [ativos]);
  // base genealógica centralizada (derivada dos próprios animais; sem tabela nova)
  const genIndex = useMemo(() => buildGenIndex(ativos), [ativos]);
  const leilaoNames = useMemo(() => { const s = new Set((db.leiloes || []).filter((l) => l && !l.arquivado).map((l) => l.nome).filter(Boolean)); (ativos || []).forEach((a) => a && a.leilao && s.add(a.leilao)); return [...s]; }, [db.leiloes, ativos]);
  const localNames = useMemo(() => { const s = new Set((db.locais || []).filter(Boolean)); (ativos || []).forEach((a) => { if (a && a.ondeEsta) s.add(a.ondeEsta); if (a && a.criatorio) s.add(a.criatorio); }); (db.criatorios || []).forEach((c) => c && c.nome && s.add(c.nome)); return [...s]; }, [db.locais, db.criatorios, ativos]);
  const vendedorNames = useMemo(() => { const s = new Set((db.vendedores || []).map((v) => v && v.nome).filter(Boolean)); (ativos || []).forEach((a) => a && a.vendedor && s.add(a.vendedor)); return [...s]; }, [db.vendedores, ativos]);
  const socioNames = useMemo(() => (db.socios || []).filter((s) => s && !s.arquivado).map((s) => s.nome).filter(Boolean), [db.socios]);

  const visiveis = useMemo(() => {
    let list = (ativos || []).filter(Boolean);
    if (norm(busca).trim()) { const q = norm(busca); list = list.filter((a) => { try { return norm(JSON.stringify(a)).includes(q); } catch (e) { return false; } }); }
    return list;
  }, [ativos, busca]);

  const parcelas = useMemo(() => (ativos || []).filter(Boolean).flatMap((a) => { try { return cronograma(a); } catch (e) { return []; } }), [ativos]);
  const reais = (ativos || []).filter((a) => a && a.origem !== "genealogia");
  const kpis = useMemo(() => { const acc = { total: 0, pago: 0, aberto: 0, patrimonio: 0 }; reais.forEach((a) => { const f = finance(a); acc.total += f.total; acc.pago += f.pago; acc.aberto += f.aberto; acc.patrimonio += f.totalEstimado; }); return acc; }, [ativos]);
  const vencidas = parcelas.filter((p) => p.status === "vencido");
  const parcelasMes = useMemo(() => {
    const now = new Date(); const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const doMes = parcelas.filter((p) => (p.venc || "").slice(0, 7) === ym);
    return { qtd: doMes.length, total: doMes.reduce((s, p) => s + num(p.valor), 0), pagas: doMes.filter((p) => p.status === "pago").length };
  }, [parcelas]);
  const proximas = parcelas.filter((p) => p.status === "aberto" || p.status === "parcial").sort((a, b) => (a.venc || "").localeCompare(b.venc || "")).slice(0, 6);
  const count = (t) => (ativos || []).filter((a) => a && a.tipo === t && a.origem !== "genealogia" && !a.arquivada && (t !== "animal" || ehAtivo(a))).length;

  const salvar = (d) => {
    flushNext.current = true; // concluir cadastro = gravação imediata
    // edição de pré-ficha: só atualiza a pré-ficha (não cria nada no banco principal)
    if (d.__pref) {
      const prefId = d.__pref; const dados = { ...d }; delete dados.__pref; delete dados.__fromOrigem; delete dados.origemLabel;
      setDb((p) => ({ ...p, prefichas: (p.prefichas || []).map((x) => (x.id === prefId ? { ...x, dados } : x)) }));
      setForm(null); return;
    }
    if (d.tipo === "prenhez" || d.tipo === "aspiracao") d = { ...d, nome: rotuloReprod(d) };
    const origemId = d.origemId; const veioDeOrigem = d.__fromOrigem;
    d = { ...d }; delete d.__fromOrigem; delete d.__genSug;
    d = { ...d, parcelasList: ensureParcelas(d) };
    setDb((p) => aplicarNovoRegistro(p, d, profile && profile.nome, veioDeOrigem, origemId));
    setForm(null); setAberto(d);
  };

  /* ---- Importação por Excel: cria pré-cadastros (nada entra sem aprovação) ---- */
  const [impMsg, setImpMsg] = useState("");
  const [impResumo, setImpResumo] = useState(null);
  const [impFiltro, setImpFiltro] = useState("todos");
  const importarExcel = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setImpResumo({ erro: "Não consegui ler o arquivo." });
    reader.onload = (ev) => {
      const res = impLerArquivo(new Uint8Array(ev.target.result));
      if (res.erro) { setImpResumo({ erro: res.erro }); setImpMsg(""); return; }
      setDb((p) => {
        const chave = (nm, lei) => lc(nm || "") + "|" + lc(lei || "");
        const setExist = new Set((p.ativos || []).filter(Boolean).map((a) => chave(a.doadora || a.nome, a.leilao)));
        const idx = buildGenIndex(p.ativos);
        const novos = res.registros.map((r) => {
          const d = r.dados; const sug = new Set();
          fillArvore(d, "pat", d.pai, "", idx, sug, d.tipo === "animal");
          fillArvore(d, "mat", d.doadora, d.regDoadora, idx, sug, d.tipo === "animal");
          if (sug.size) d.__genSug = [...sug];
          return { ...r, genSug: sug.size, dupSistema: setExist.has(chave(d.doadora, d.leilao)) };
        });
        return { ...p, prefichas: [...novos, ...(p.prefichas || [])] };
      });
      setImpResumo({ novos: res.registros.length, pulados: res.pulados, erro: "" });
      setImpMsg(`${res.registros.length} pré-cadastro(s) criado(s)` + (res.pulados.length ? ` · ${res.pulados.length} linha(s) pulada(s)` : "") + ".");
    };
    reader.readAsArrayBuffer(file);
  };
  const abrirPreficha = (pref) => setForm({ tipo: pref.dados.tipo, initial: { ...pref.dados, __pref: pref.id } });
  const setEstadoPreficha = (id, estado) => { flushNext.current = true; setDb((p) => ({ ...p, prefichas: (p.prefichas || []).map((x) => (x.id === id ? { ...x, estado } : x)) })); };
  const removerPreficha = (id) => { flushNext.current = true; setDb((p) => ({ ...p, prefichas: (p.prefichas || []).filter((x) => x.id !== id) })); };
  const limparImportados = () => { flushNext.current = true; setDb((p) => ({ ...p, prefichas: (p.prefichas || []).filter((x) => x.origem !== "excel" || (x.estado !== "aprovado" && x.estado !== "rejeitado")) })); };
  /* aprova (cadastra de verdade) a ficha — usa a MESMA lógica do cadastro manual */
  const aprovarFicha = (dd) => {
    const prefId = dd.__pref;
    flushNext.current = true;
    let r = { ...dd }; delete r.__pref; delete r.__fromOrigem; delete r.__regAuto; delete r.__genSug;
    if (r.tipo === "prenhez" || r.tipo === "aspiracao") r = { ...r, nome: rotuloReprod(r) };
    r = { ...r, id: uid(), parcelasList: ensureParcelas(r) };
    setDb((p) => {
      const np = aplicarNovoRegistro(p, r, profile && profile.nome, false, null);
      return { ...np, prefichas: (np.prefichas || []).filter((x) => x.id !== prefId) };
    });
    setForm(null); setImpMsg(`Cadastrado: ${r.nome}`);
  };

  const updateAtivo = (d) => { flushNext.current = true; if (d.tipo === "prenhez" || d.tipo === "aspiracao") d = { ...d, nome: rotuloReprod(d) }; setDb((p) => ({ ...p, ativos: p.ativos.map((a) => (a.id === d.id ? d : a)) })); setAberto(d); };

  /* botão "Nasceu": monta um novo animal já preenchido com genealogia + sociedade + origem */
  const nascer = (src) => {
    const ehPren = src.tipo === "prenhez";
    const novo = {
      id: uid(), tipo: "animal", origem: "nascimento",
      origemTipo: src.tipo, origemId: src.id, origemLabel: rotuloReprod(src),
      __fromOrigem: true,
      nome: "", registro: "", raca: src.raca || "Nelore",
      sexo: ehPren ? "Fêmea" : "",                 // prenhez sempre fêmea; aspiração o usuário escolhe
      nascimento: "", status: "", ondeEsta: src.ondeEsta || "", criatorio: src.criatorio || "",
      origemAnimal: src.tipo === "aspiracao" ? "Nascimento de aspiração" : "Nascimento de prenhez",
      // genealogia herdada
      pai: src.pai || src.touro || "", mae: src.doadora || "",
      maeRegistro: src.regDoadora || "",
      avoPaterno: src.avoPaterno || "", avoPaterna: src.avoPaterna || "",
      avoMaterno: src.avoMaterno || "", avoMaterna: src.avoMaterna || "",
      obsGen: src.obsGen || "",
      // sociedade transferida (informativa) — revisável antes de salvar
      socios: (src.socios || []).filter(Boolean).map((s) => ({ id: uid(), nome: s.nome, pct: s.pct, obs: s.obs || "" })),
      // sem financeiro duplicado: a compra continua na origem
      videos: [], historico: [], comissaoPct: 8, obs: src.obs || "",
    };
    setAberto(null);
    setForm({ tipo: "animal", initial: novo });
  };

  /* aspiração → gera uma PRENHEZ vinculada (a aspiração continua existindo) */
  const gerarPrenhez = (asp) => {
    const nova = {
      id: uid(), tipo: "prenhez", origem: "aspiracao",
      aspiracaoOrigemId: asp.id, origemLabel: rotuloReprod(asp), __fromOrigem: true, origemTipo: "aspiracao",
      doadora: asp.doadora || "", regDoadora: asp.regDoadora || "", pai: asp.pai || asp.touro || "",
      qtd: 1, status: "Aguardando confirmação", ondeEsta: asp.ondeEsta || "", criatorio: asp.criatorio || "",
      avoPaterno: asp.avoPaterno || "", avoPaterna: asp.avoPaterna || "", avoMaterno: asp.avoMaterno || "", avoMaterna: asp.avoMaterna || "",
      obsGen: asp.obsGen || "",
      socios: (asp.socios || []).filter(Boolean).map((s) => ({ id: uid(), nome: s.nome, pct: s.pct, obs: s.obs || "" })),
      videos: [], historico: [], comissaoPct: 8, obs: "",
    };
    setAberto(null);
    setForm({ tipo: "prenhez", initial: nova });
  };
  // excluir = mover para a LIXEIRA (exclusão lógica). O animal sai das listagens,
  // mas é guardado inteiro (genealogia, sociedade, participação, compras, vendas,
  // parcelas, históricos) para poder ser restaurado. Não apaga nada de outros animais.
  const excluir = (id) => {
    flushNext.current = true;
    setDb((p) => {
      const alvo = (p.ativos || []).find((a) => a && a.id === id);
      if (!alvo) return p;
      const reg = { ...alvo, __deletedAt: new Date().toISOString(), __deletedBy: (profile && profile.nome) || "" };
      return { ...p, ativos: p.ativos.filter((a) => a.id !== id), lixeira: [...(p.lixeira || []), reg] };
    });
    setAberto(null);
  };
  // restaurar da lixeira: volta ao sistema com as informações preservadas
  const restaurarAnimal = (id) => {
    flushNext.current = true;
    setDb((p) => {
      const reg = (p.lixeira || []).find((a) => a && a.id === id);
      if (!reg) return p;
      const limpo = { ...reg }; delete limpo.__deletedAt; delete limpo.__deletedBy;
      return { ...p, lixeira: (p.lixeira || []).filter((a) => a.id !== id), ativos: [...(p.ativos || []), limpo] };
    });
  };
  // exclusão permanente: só manual, com confirmação específica (nunca automática)
  const excluirDefinitivo = (id) => setConfirmar({
    titulo: "Excluir definitivamente?",
    mensagem: "Este animal será removido em definitivo da lixeira e NÃO poderá mais ser recuperado pelo sistema. Esta ação não pode ser desfeita.",
    usos: [],
    botoes: [{ label: "Excluir para sempre", tone: "danger", onClick: () => { flushNext.current = true; setDb((p) => ({ ...p, lixeira: (p.lixeira || []).filter((a) => a.id !== id) })); setConfirmar(null); } }],
  });


  const [confirmar, setConfirmar] = useState(null);
  const [verArquivados, setVerArquivados] = useState(false);
  // onde um sócio é usado (por nome, para não quebrar histórico)
  const usosSocio = (s) => {
    const nome = s.nome; const set = new Map();
    reais.forEach((a) => {
      const naSoc = (a.socios || []).some((x) => x && lc(x.nome) === lc(nome)) || (a.sociedadeAtual || []).some((x) => x && lc(x.nome) === lc(nome));
      const naVenda = vendasDo(a).some((v) => lc(v.comprador) === lc(nome) || (v.linhas || []).some((l) => lc(l.vendedor) === lc(nome) || lc(l.comprador) === lc(nome)));
      if (naSoc || naVenda) set.set(a.id, a.nome);
    });
    return [...set.values()];
  };
  const usosLeilao = (l) => reais.filter((a) => lc(a.leilao || "") === lc(l.nome)).map((a) => a.nome);

  const excluirSocio = (s) => {
    const usos = usosSocio(s); const botoes = [];
    if (usos.length) {
      botoes.push({ label: "Arquivar", tone: "gold", onClick: () => { setDb((p) => ({ ...p, socios: (p.socios || []).map((x) => (x.id === s.id ? { ...x, arquivado: true } : x)) })); setConfirmar(null); } });
      botoes.push({ label: "Excluir mesmo assim", tone: "danger", onClick: () => { setDb((p) => ({ ...p, socios: (p.socios || []).filter((x) => x.id !== s.id) })); setConfirmar(null); } });
    } else {
      botoes.push({ label: "Excluir", tone: "danger", onClick: () => { setDb((p) => ({ ...p, socios: (p.socios || []).filter((x) => x.id !== s.id) })); setConfirmar(null); } });
    }
    setConfirmar({ titulo: `Excluir o sócio ${s.nome}?`, mensagem: usos.length ? `Este sócio está vinculado a ${usos.length} registro(s). Para preservar o histórico, recomendamos arquivar em vez de excluir (ele some das listas e do autocomplete, mas continua nos históricos).` : `Tem certeza de que deseja excluir o sócio ${s.nome}? Esta ação não pode ser desfeita.`, usos, botoes });
  };
  const excluirLeilao = (l) => {
    const usos = usosLeilao(l); const botoes = [];
    if (usos.length) {
      botoes.push({ label: "Arquivar", tone: "gold", onClick: () => { setDb((p) => ({ ...p, leiloes: (p.leiloes || []).map((x) => (x.id === l.id ? { ...x, arquivado: true } : x)) })); setConfirmar(null); } });
      botoes.push({ label: "Excluir mesmo assim", tone: "danger", onClick: () => { setDb((p) => ({ ...p, leiloes: (p.leiloes || []).filter((x) => x.id !== l.id) })); setConfirmar(null); } });
    } else {
      botoes.push({ label: "Excluir", tone: "danger", onClick: () => { setDb((p) => ({ ...p, leiloes: (p.leiloes || []).filter((x) => x.id !== l.id) })); setConfirmar(null); } });
    }
    setConfirmar({ titulo: `Excluir o leilão ${l.nome}?`, mensagem: usos.length ? `Este leilão está vinculado a ${usos.length} animal(is). Para preservar o histórico, recomendamos arquivar em vez de excluir.` : `Tem certeza de que deseja excluir o leilão ${l.nome}? Esta ação não pode ser desfeita.`, usos, botoes });
  };
  const restaurarSocio = (s) => setDb((p) => ({ ...p, socios: (p.socios || []).map((x) => (x.id === s.id ? { ...x, arquivado: false } : x)) }));
  const restaurarLeilao = (l) => setDb((p) => ({ ...p, leiloes: (p.leiloes || []).map((x) => (x.id === l.id ? { ...x, arquivado: false } : x)) }));
  const pedirExcluirAtivo = (a) => setConfirmar({
    titulo: `Excluir ${a.nome || "este registro"}?`,
    mensagem: "Tem certeza de que deseja excluir este registro? Esta ação não pode ser desfeita.",
    usos: [],
    botoes: [{ label: "Excluir", tone: "danger", onClick: () => { excluir(a.id); setConfirmar(null); } }],
  });
  const quickAnimal = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => (p.ativos.some((a) => a && a.tipo === "animal" && lc(a.nome) === lc(nm)) ? p : { ...p, ativos: [...p.ativos, stubAnimal(nm, profile && profile.nome)] })); };
  const quickLeilao = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.leiloes || []).some((l) => l && lc(l.nome) === lc(nm)) ? p : { ...p, leiloes: [...(p.leiloes || []), { id: uid(), nome: nm }] })); };
  const quickLocal = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.locais || []).some((l) => lc(l) === lc(nm)) ? p : { ...p, locais: [...(p.locais || []), nm] })); };
  const quickVendedor = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.vendedores || []).some((v) => v && lc(v.nome) === lc(nm)) ? p : { ...p, vendedores: [...(p.vendedores || []), { id: uid(), nome: nm, tipo: "Outro", doc: "", tel: "", email: "", obs: "" }] })); };
  const quickSocio = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.socios || []).some((s) => s && lc(s.nome) === lc(nm)) ? p : { ...p, socios: [...(p.socios || []), { id: uid(), nome: nm, doc: "", tel: "", email: "", endereco: "", obs: "" }] })); };

  // Criatórios parceiros
  const salvarCriatorio = (c) => setDb((p) => {
    const existe = (p.criatorios || []).some((x) => x.id === c.id);
    return { ...p, criatorios: existe ? (p.criatorios || []).map((x) => (x.id === c.id ? c : x)) : [...(p.criatorios || []), c] };
  });
  const excluirCriatorio = (c) => setConfirmar({ titulo: `Excluir o criatório ${c.nome}?`, mensagem: "O criatório sai da lista. Os animais/prenhezes vinculados a ele não são afetados (o vínculo é pelo nome nas fichas).", usos: [], botoes: [{ label: "Excluir", tone: "danger", onClick: () => { setDb((p) => ({ ...p, criatorios: (p.criatorios || []).filter((x) => x.id !== c.id) })); setConfirmar(null); } }] });
  const registrarContato = (criatorioId, contato) => setDb((p) => ({ ...p, criatorios: (p.criatorios || []).map((x) => (x.id === criatorioId ? { ...x, contatos: [...(x.contatos || []), contato] } : x)) }));

  const invTipo = useMemo(() => { const m = {}; reais.forEach((a) => { m[a.tipo] = (m[a.tipo] || 0) + finance(a).cota; }); return Object.entries(m).map(([name, value]) => ({ name, value })); }, [ativos]);

  // Acompanhamento reprodutivo: indicadores e pendências com dados reais
  const reprod = useMemo(() => {
    const todos = (ativos || []).filter((a) => a && a.origem !== "genealogia");
    const aspAndamento = todos.filter(aspAtiva);
    const prenhez = todos.filter(prenhezAtiva);
    const confirmadas = prenhez.filter((a) => { const s = lc(a.status); return s.includes("confirm") || s.includes("gesta") || s.includes("próxima") || s.includes("proxima"); });
    const proximas = prenhez.filter((a) => { const n = alertaParto(a); return n === "30" || n === "15" || n === "7" || n === "hoje"; });
    const atrasadas = prenhez.filter((a) => alertaParto(a) === "atrasado");
    // nascimentos aguardando cadastro: status "Nascimento informado" ou fila explícita
    const aguardando = todos.filter((a) => a.tipo === "prenhez" && !a.arquivada && lc(a.status).includes("nascimento informado"));
    // pendências: parto atrasado > próximo > aspiração sem data realizada
    const pend = [];
    atrasadas.forEach((a) => pend.push({ id: "pa-" + a.id, prio: 1, tipo: "Parto atrasado", ref: a, data: a.previsaoParto, criatorio: a.criatorio || a.ondeEsta || "—", acao: "Confirmar parto ou atualizar previsão" }));
    proximas.forEach((a) => pend.push({ id: "pp-" + a.id, prio: 2, tipo: "Parto próximo", ref: a, data: a.previsaoParto, criatorio: a.criatorio || a.ondeEsta || "—", acao: "Acompanhar com o criatório" }));
    aguardando.forEach((a) => pend.push({ id: "ag-" + a.id, prio: 2, tipo: "Nascimento aguardando cadastro", ref: a, data: a.dataParto || "", criatorio: a.criatorio || a.ondeEsta || "—", acao: "Cadastrar o animal (botão Nasceu)" }));
    aspAndamento.filter((a) => !a.dataAspiracao).forEach((a) => pend.push({ id: "as-" + a.id, prio: 3, tipo: "Aspiração sem atualização", ref: a, data: "", criatorio: a.criatorio || a.ondeEsta || "—", acao: "Cobrar resultado do criatório" }));
    pend.sort((x, y) => x.prio - y.prio);
    return { aspAndamento, prenhez, confirmadas, proximas, atrasadas, aguardando, pendencias: pend };
  }, [ativos]);
  // Idade do plantel: só animais com cadastro próprio, ativos (participação > 0), com nascimento válido
  const plantel = useMemo(() => {
    const animais = reais.filter((a) => a && a.tipo === "animal" && !a.arquivada && participacaoAtual(a) > 0);
    const comIdade = animais.map((a) => ({ a, meses: mesesDe(a.nascimento) })).filter((x) => x.meses != null && x.meses >= 0);
    const semData = animais.length - comIdade.length;
    const faixasDef = [["< 1 ano", 0, 12], ["1 a 2 anos", 12, 24], ["2 a 4 anos", 24, 48], ["4 a 6 anos", 48, 72], ["6 a 8 anos", 72, 96], ["+ 8 anos", 96, Infinity]];
    const faixas = faixasDef.map(([name, lo, hi]) => ({ name, value: comIdade.filter((x) => x.meses >= lo && x.meses < hi).length }));
    let mediaTxt = "—", media = null, novo = null, velho = null;
    if (comIdade.length) {
      media = comIdade.reduce((s, x) => s + x.meses, 0) / comIdade.length;
      const anos = Math.floor(media / 12), mes = Math.round(media - anos * 12);
      mediaTxt = anos > 0 ? `${anos} ${anos === 1 ? "ano" : "anos"}${mes ? ` e ${mes} ${mes === 1 ? "mês" : "meses"}` : ""}` : `${mes} ${mes === 1 ? "mês" : "meses"}`;
      const ord = comIdade.slice().sort((x, y) => x.meses - y.meses);
      novo = ord[0]; velho = ord[ord.length - 1];
    }
    return { total: comIdade.length, semData, faixas, mediaTxt, novo, velho };
  }, [ativos]);
  const PIE = ["#C6A15B", "#2F5D45", "#7A5230", "#9BB39F", "#E0C079", "#4A4A4A"];

  /* ===================== PAINEL — filtros e agregações ===================== */
  const dfMatch = (a) => {
    if (dfSocio && !((a.sociedadeAtual || a.socios || []).some((s) => s && lc(s.nome) === lc(dfSocio)))) return false;
    if (dfCriatorio && lc((a.ondeEsta || a.criatorio || "")) !== lc(dfCriatorio)) return false;
    if (dfSituacao !== "todos" && a.tipo === "animal") { const at = ehAtivo(a); if (dfSituacao === "ativos" && !at) return false; if (dfSituacao === "inativos" && at) return false; }
    return true;
  };
  const dfAtivo = dfSituacao !== "todos" || !!dfSocio || !!dfCriatorio;
  const fReais = useMemo(() => reais.filter(dfMatch), [ativos, dfSituacao, dfSocio, dfCriatorio]);
  const fAnimais = useMemo(() => fReais.filter((a) => a.tipo === "animal"), [fReais]);

  // listas para os seletores de filtro
  const sociosDash = useMemo(() => { const s = new Set(); reais.forEach((a) => (a.sociedadeAtual || a.socios || []).forEach((x) => x && x.nome && s.add(x.nome))); return [...s].sort((x, y) => lc(x).localeCompare(lc(y))); }, [ativos]);
  const criatoriosDash = useMemo(() => { const s = new Set(); reais.forEach((a) => { const c = (a.ondeEsta || a.criatorio || "").trim(); if (c) s.add(c); }); return [...s].sort((x, y) => lc(x).localeCompare(lc(y))); }, [ativos]);

  // KPIs financeiros (respeitam os filtros do painel)
  const fKpis = useMemo(() => { const acc = { total: 0, pago: 0, aberto: 0, patrimonio: 0 }; fReais.forEach((a) => { const f = finance(a); acc.total += f.total; acc.pago += f.pago; acc.aberto += f.aberto; acc.patrimonio += f.totalEstimado; }); return acc; }, [fReais]);

  // contagens do rebanho (sempre o total real, não dependem dos filtros)
  const nAtivos = useMemo(() => (ativos || []).filter((a) => a && a.tipo === "animal" && a.origem !== "genealogia" && !a.arquivada && ehAtivo(a)).length, [ativos]);
  const nInativos = useMemo(() => (ativos || []).filter((a) => a && a.tipo === "animal" && a.origem !== "genealogia" && !a.arquivada && !ehAtivo(a)).length, [ativos]);

  // investimentos da SM ASSOCIADOS a cada sócio (um animal com vários sócios aparece em cada — a soma entre sócios NÃO é o total)
  const porSocio = useMemo(() => {
    const m = new Map();
    fAnimais.forEach((a) => { const inv = finance(a).total; (a.sociedadeAtual || a.socios || []).filter(Boolean).forEach((s) => { if (!s.nome) return; if (!m.has(s.nome)) m.set(s.nome, { nome: s.nome, qtd: 0, invest: 0 }); const o = m.get(s.nome); o.qtd += 1; o.invest += inv; }); });
    return [...m.values()].sort((x, y) => y.invest - x.invest);
  }, [fAnimais]);

  // investimentos por criatório (campo único "Criatório responsável" = ondeEsta) — cada animal em um grupo só
  const porCriatorio = useMemo(() => {
    const m = new Map();
    fAnimais.forEach((a) => { const c = (a.ondeEsta || a.criatorio || "").trim() || "Sem criatório informado"; if (!m.has(c)) m.set(c, { nome: c, qtd: 0, invest: 0 }); const o = m.get(c); o.qtd += 1; o.invest += finance(a).total; });
    return [...m.values()].sort((x, y) => y.invest - x.invest);
  }, [fAnimais]);

  // distribuição por participação da SM (só animais ativos no conjunto filtrado)
  const porParticipacao = useMemo(() => {
    const faixas = [["100%", (p) => p >= 100], ["75–99%", (p) => p >= 75 && p < 100], ["50–74%", (p) => p >= 50 && p < 75], ["25–49%", (p) => p >= 25 && p < 50], ["1–24%", (p) => p >= 1 && p < 25]];
    const base = fAnimais.filter((a) => ehAtivo(a));
    return faixas.map(([name, fn]) => ({ name, value: base.filter((a) => fn(participacaoAtual(a))).length })).filter((x) => x.value > 0);
  }, [fAnimais]);

  // idade do plantel no conjunto filtrado
  const plantelF = useMemo(() => {
    const comIdade = fAnimais.filter((a) => participacaoAtual(a) > 0).map((a) => mesesDe(a.nascimento)).filter((m) => m != null && m >= 0);
    const faixasDef = [["< 1 ano", 0, 12], ["1 a 2", 12, 24], ["2 a 4", 24, 48], ["4 a 6", 48, 72], ["6 a 8", 72, 96], ["+ 8", 96, Infinity]];
    return faixasDef.map(([name, lo, hi]) => ({ name, value: comIdade.filter((m) => m >= lo && m < hi).length })).filter((x) => x.value > 0);
  }, [fAnimais]);

  // evolução financeira (previsto x realizado) por mês, respeitando filtros e período
  const evolucao = useMemo(() => {
    const by = {};
    fReais.forEach((a) => { parcelasPorMes(a).forEach((mo) => { if (!mo.ym) return; if (!by[mo.ym]) by[mo.ym] = { ym: mo.ym, previsto: 0, pago: 0 }; by[mo.ym].previsto += num(mo.total); by[mo.ym].pago += num(mo.pago); }); });
    let arr = Object.values(by).sort((x, y) => x.ym.localeCompare(y.ym));
    const now = new Date();
    const ymNow = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    if (dfPeriodo === "6m" || dfPeriodo === "12m") {
      const n = dfPeriodo === "6m" ? 6 : 12;
      const lim = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
      const ymLim = lim.getFullYear() + "-" + String(lim.getMonth() + 1).padStart(2, "0");
      arr = arr.filter((x) => x.ym >= ymLim && x.ym <= ymNow);
    } else if (dfPeriodo === "ano") {
      arr = arr.filter((x) => x.ym.startsWith(String(now.getFullYear())));
    }
    return arr.map((x) => ({ ...x, mes: mesLabel(x.ym) }));
  }, [fReais, dfPeriodo]);

  const limparFiltrosDash = () => { setDfSituacao("ativos"); setDfSocio(""); setDfCriatorio(""); setDfPeriodo("12m"); };

  const exportCSV = () => {
    const rows = [["Tipo", "Nome", "Status", "Cota (R$)", "Total estimado", "Pago", "Em aberto"]];
    visiveis.forEach((a) => { const f = finance(a); rows.push([a.tipo, a.nome, a.status || "", f.cota, f.totalEstimado, f.pago, f.aberto]); });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = "relatorio-gado-elite.csv"; el.click(); URL.revokeObjectURL(url);
  };

  const qBusca = norm(busca).trim();
  const buscaGlobal = useMemo(() => {
    if (!qBusca) return null;
    const m = (a) => { try { return norm(JSON.stringify(a)).includes(qBusca); } catch (e) { return false; } };
    return {
      animal: (ativos || []).filter((a) => a && a.tipo === "animal" && !a.arquivada && a.origem !== "genealogia" && m(a)),
      prenhez: (ativos || []).filter((a) => a && a.tipo === "prenhez" && !a.arquivada && m(a)),
      aspiracao: (ativos || []).filter((a) => a && a.tipo === "aspiracao" && !a.arquivada && m(a)),
      socios: (db.socios || []).filter((s) => s && !s.arquivado && norm([s.nome, s.obs, s.doc, s.tel, s.email].join(" ")).includes(qBusca)),
      leiloes: (db.leiloes || []).filter((l) => l && !l.arquivado && norm(l.nome).includes(qBusca)),
    };
  }, [qBusca, ativos, db.socios, db.leiloes]);

  const nav = [["dashboard", "◆", "Painel"], ["animal", "❖", "Animais"], ["prenhez", "◗", "Prenhezes"], ["aspiracao", "✧", "Aspirações"],
    ["importar", "⇪", "Importar"],
    ["pendencias", "⬣", "Pendências"], ["criatorios", "⌂", "Criatórios"], ["socios", "◎", "Sócios"], ["parcelas", "▤", "Parcelas"], ["leiloes", "⚑", "Leilões"], ["relatorios", "▦", "Relatórios"], ["lixeira", "🗑", "Lixeira"],
    ...(isAdmin ? [["usuarios", "◐", "Usuários"]] : [])];
  const nLixeira = (db.lixeira || []).length;
  const nImport = (db.prefichas || []).filter((x) => x && x.estado !== "aprovado" && x.estado !== "rejeitado").length;

  if (!authReady) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando…</div></div></div>;
  if (recovering && session) return <NovaSenha onDone={() => setRecovering(false)} />;
  if (!session) return <Auth />;
  if (!profileLoaded) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando seu perfil…</div></div></div>;
  if (!profile) return <Pendente bloqueado nome="" onLogout={logout} />;
  if (!profile.aprovado) return <Pendente nome={profile.nome} onLogout={logout} />;
  if (!dataReady) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando dados…</div></div></div>;

  const SAVE_INFO = {
    pending: { cls: "pend", txt: "Alterações pendentes", ic: "●" },
    saving: { cls: "saving", txt: "Salvando…", ic: "⟳" },
    saved: { cls: "ok", txt: "Salvo", ic: "✓" },
    error: { cls: "err", txt: "Erro ao salvar", ic: "⚠" },
    offline: { cls: "off", txt: "Sem conexão", ic: "⚠" },
  };
  const saveChip = (() => {
    const info = SAVE_INFO[saveStatus];
    if (!info) return null;
    const podeTentar = saveStatus === "error" || saveStatus === "offline";
    return (
      <span className={`save-chip ${info.cls}`} title={saveStatus === "error" ? "Se o erro continuar, saia e faça login novamente." : ""}>
        <span className="save-ic">{info.ic}</span>{info.txt}
        {podeTentar && <button className="save-retry" onClick={tentarSalvarAgora}>Tentar de novo</button>}
      </span>
    );
  })();

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar"><button className="burger" onClick={() => setNavOpen((v) => !v)}>☰</button><div className="brand-mini serif">SM sistema</div>{saveChip}</div>

      <aside className={`side ${navOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">SM</div><div><div className="serif brand-name">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div>
        <nav>{nav.map(([k, ic, l]) => (
          <button key={k} className={`nav-item ${view === k ? "on" : ""}`} onClick={() => { setView(k); setNavOpen(false); }}>
            <span className="nav-ic">{ic}</span>{l}{["animal", "prenhez", "aspiracao"].includes(k) && <span className="nav-count">{count(k)}</span>}{k === "lixeira" && nLixeira > 0 && <span className="nav-count">{nLixeira}</span>}{k === "importar" && nImport > 0 && <span className="nav-count">{nImport}</span>}</button>
        ))}</nav>
        <div className="side-foot">
          <div className="user-box"><div className="user-name">{profile.nome || profile.email}</div><div className="user-role">{profile.role}</div></div>
          <button className="btn btn-ghost" onClick={logout}>Sair</button>
        </div>
      </aside>

      <main className="main">
        <header className="head">
          <div><div className="eyebrow">Plataforma de gestão</div><h1 className="serif">{nav.find((n) => n[0] === view)?.[2]}</h1></div>
          <div className="head-tools">
            <span className="save-chip-desk">{saveChip}</span>
            <input className="search" placeholder="Buscar animal, prenhez, sócio, leilão…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {!soSocio && <button className="btn btn-gold" onClick={() => setNovo(true)}>+ Novo cadastro</button>}
          </div>
        </header>

        {view === "dashboard" && qBusca && buscaGlobal && (() => {
          const total = buscaGlobal.animal.length + buscaGlobal.prenhez.length + buscaGlobal.aspiracao.length + buscaGlobal.socios.length + buscaGlobal.leiloes.length;
          const grupo = (titulo, itens, render) => itens.length > 0 && (
            <div className="busca-grupo"><div className="busca-cat">{titulo} ({itens.length})</div><div className="socio-parts">{itens.map(render)}</div></div>
          );
          return (
            <section className="wrap">
              <div className="card">
                <div className="card-h">Resultados para “{busca}” — {total} encontrado(s)</div>
                {total === 0 && <p className="muted small">Nada encontrado. Tente outro termo.</p>}
                {grupo("Animais", buscaGlobal.animal, (a) => <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome}</span>)}
                {grupo("Prenhezes", buscaGlobal.prenhez, (a) => <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome}</span>)}
                {grupo("Aspirações", buscaGlobal.aspiracao, (a) => <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome}</span>)}
                {grupo("Sócios", buscaGlobal.socios, (s) => <span className="tag" key={s.id} onClick={() => setView("socios")}>{s.nome}</span>)}
                {grupo("Leilões", buscaGlobal.leiloes, (l) => <span className="tag" key={l.id} onClick={() => setView("leiloes")}>{l.nome}</span>)}
              </div>
            </section>
          );
        })()}

        {view === "dashboard" && !qBusca && (
          <section className="wrap dash">
            <div className="dash-head" style={{ justifyContent: "flex-end" }}>
              <button className="eye-btn" onClick={() => setPrivado((p) => !p)} title={privado ? "Mostrar valores" : "Ocultar valores"} aria-label={privado ? "Mostrar valores" : "Ocultar valores"}>
                {privado ? EYE_OFF : EYE_ON}<span>{privado ? "Mostrar valores" : "Ocultar valores"}</span>
              </button>
            </div>

            {/* ÁREA 1 — VISÃO GERAL */}
            <div className="kpi-row">
              <KPI label="Patrimônio estimado" value={money(fKpis.patrimonio)} tone="gold" icon="◆" />
              <KPI label="Total investido" value={money(fKpis.total)} icon="▣" />
              <KPI label="Já pago" value={money(fKpis.pago)} tone="pos" icon="✓" />
              <KPI label="Em aberto" value={money(fKpis.aberto)} tone="neg" icon="◷" sub={`Parcelas do mês: ${money(parcelasMes.total)} · ${parcelasMes.pagas}/${parcelasMes.qtd} pagas`} />
            </div>
            <div className="kpi-row">
              <KPI label="Animais ativos" value={nAtivos} icon="❖" onClick={() => { setFiltroSit("ativos"); setView("animal"); }} />
              <KPI label="Animais inativos" value={nInativos} icon="❖" onClick={() => { setFiltroSit("inativos"); setView("animal"); }} />
              <KPI label="Prenhezes" value={count("prenhez")} icon="◗" onClick={() => setView("prenhez")} />
              <KPI label="Aspirações" value={count("aspiracao")} icon="✧" onClick={() => setView("aspiracao")} />
            </div>

            {/* FILTROS */}
            <div className="dash-filtros">
              <span className="df-tit">Filtros</span>
              <div className="seg-group sm">{[["todos", "Todos"], ["ativos", "Ativos"], ["inativos", "Inativos"]].map(([k, l]) => <button key={k} className={`seg ${dfSituacao === k ? "on" : ""}`} onClick={() => setDfSituacao(k)}>{l}</button>)}</div>
              <select className="df-sel" value={dfSocio} onChange={(e) => setDfSocio(e.target.value)}><option value="">Todos os sócios</option>{sociosDash.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              <select className="df-sel" value={dfCriatorio} onChange={(e) => setDfCriatorio(e.target.value)}><option value="">Todos os criatórios</option>{criatoriosDash.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              {dfAtivo && <button className="btn btn-mini" onClick={limparFiltrosDash}>Limpar filtros</button>}
              <span className="df-hint">afetam as seções Inteligência financeira e Composição do plantel</span>
            </div>

            {/* ÁREA 2 — INTELIGÊNCIA FINANCEIRA */}
            <div className="dash-sec-tit">Inteligência financeira</div>
            <div className="card">
              <div className="card-h card-h-flex"><span>Evolução financeira</span>
                <span className="seg-group sm">{[["6m", "6 meses"], ["12m", "12 meses"], ["ano", "Ano atual"], ["tudo", "Tudo"]].map(([k, l]) => <button key={k} className={`seg ${dfPeriodo === k ? "on" : ""}`} onClick={() => setDfPeriodo(k)}>{l}</button>)}</span>
              </div>
              {evolucao.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}><BarChart data={evolucao} margin={{ left: 6, right: 10, top: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" /><XAxis dataKey="mes" tick={{ fontSize: 10.5, fill: "#5a5346" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#5a5346" }} tickFormatter={(v) => (privado ? "•••" : `${(v / 1000).toFixed(0)}k`)} />
                  <Tooltip formatter={(v, n) => [money(v), n === "previsto" ? "Previsto" : "Realizado"]} /><Legend formatter={(v) => (v === "previsto" ? "Previsto" : "Realizado")} />
                  <Bar dataKey="previsto" name="previsto" fill="#5AA07B" radius={[5, 5, 0, 0]} /><Bar dataKey="pago" name="pago" fill="#103D30" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
              ) : <p className="muted small">Nenhuma parcela no período selecionado.</p>}
              <p className="muted small" style={{ marginTop: 6 }}>Previsto = parcelas com vencimento no mês. Realizado = parcelas registradas como pagas.</p>
            </div>

            <div className="cols-2">
              <div className="card"><div className="card-h">Investimentos por sociedade</div>
                {porSocio.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(150, Math.min(porSocio.length, 8) * 40)}><BarChart data={porSocio.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" horizontal={false} /><XAxis type="number" tick={{ fontSize: 10.5, fill: "#5a5346" }} tickFormatter={(v) => (privado ? "•••" : `${(v / 1000).toFixed(0)}k`)} />
                    <YAxis type="category" dataKey="nome" width={100} tick={{ fontSize: 10.5, fill: "#5a5346" }} /><Tooltip formatter={(v, n, p) => [money(v), `${p && p.payload ? p.payload.qtd : 0} animal(is)`]} />
                    <Bar dataKey="invest" fill="#17634A" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => d && d.nome && (setBusca(d.nome), setView("animal"))} /></BarChart></ResponsiveContainer>
                ) : <p className="muted small">Nenhum sócio no conjunto filtrado.</p>}
                <p className="muted small" style={{ marginTop: 6 }}>Investimentos da SM <b>associados</b> a cada sócio. Um animal com vários sócios aparece em mais de um — a soma entre sócios não é o patrimônio total. Clique para ver os animais.</p>
              </div>
              <div className="card"><div className="card-h">Investimentos por criatório</div>
                {porCriatorio.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(150, Math.min(porCriatorio.length, 8) * 40)}><BarChart data={porCriatorio.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" horizontal={false} /><XAxis type="number" tick={{ fontSize: 10.5, fill: "#5a5346" }} tickFormatter={(v) => (privado ? "•••" : `${(v / 1000).toFixed(0)}k`)} />
                    <YAxis type="category" dataKey="nome" width={100} tick={{ fontSize: 10.5, fill: "#5a5346" }} /><Tooltip formatter={(v, n, p) => [money(v), `${p && p.payload ? p.payload.qtd : 0} animal(is)`]} />
                    <Bar dataKey="invest" fill="#2E8560" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => d && d.nome && d.nome !== "Sem criatório informado" && (setBusca(d.nome), setView("animal"))} /></BarChart></ResponsiveContainer>
                ) : <p className="muted small">Nenhum criatório no conjunto filtrado.</p>}
                <p className="muted small" style={{ marginTop: 6 }}>Cada animal entra em um criatório só (sem dupla contagem).</p>
              </div>
            </div>

            {/* ÁREA 3 — COMPOSIÇÃO DO PLANTEL */}
            <div className="dash-sec-tit">Composição do plantel</div>
            <div className="cols-2">
              <div className="card"><div className="card-h">Por faixa de idade</div>
                <div className="plantel-media">Idade média: <b>{plantel.mediaTxt}</b></div>
                {plantelF.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}><BarChart data={plantelF} margin={{ left: 6, right: 10, top: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" /><XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#5a5346" }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5a5346" }} />
                    <Tooltip formatter={(v) => [`${v} animal(is)`, "Quantidade"]} /><Bar dataKey="value" fill="#103D30" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
                ) : <p className="muted small">Nenhum animal com data de nascimento válida.</p>}
              </div>
              <div className="card"><div className="card-h">Por participação da SM</div>
                {porParticipacao.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}><BarChart data={porParticipacao} margin={{ left: 6, right: 10, top: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" /><XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#5a5346" }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5a5346" }} />
                    <Tooltip formatter={(v) => [`${v} animal(is)`, "Quantidade"]} /><Bar dataKey="value" fill="#6E9C84" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
                ) : <p className="muted small">Nenhum animal ativo no conjunto filtrado.</p>}
              </div>
            </div>

            {/* ÁREA 4 — PENDÊNCIAS E ATENÇÃO */}
            <div className="dash-sec-tit">Pendências e atenção</div>
            <div className="cols-2">
              <div className="card"><div className="card-h">Próximas parcelas</div>
                <table className="tbl"><thead><tr><th>Ativo</th><th>Nº</th><th>Venc.</th><th>Valor</th></tr></thead>
                  <tbody>{proximas.map((p, i) => <tr key={i}><td>{p.ativoNome}</td><td>{p.numero}</td><td>{dataBR(p.venc)}</td><td>{money(p.valor)}</td></tr>)}
                    {proximas.length === 0 && <tr><td colSpan={4} className="muted">Nenhuma parcela em aberto.</td></tr>}</tbody></table></div>
              <div className="card"><div className="card-h">Acompanhamento reprodutivo</div>
                <div className="repro-kpis">
                  <button className="repro-kpi" onClick={() => setView("aspiracao")}><span>Aspirações em andamento</span><b>{reprod.aspAndamento.length}</b></button>
                  <button className="repro-kpi" onClick={() => setView("prenhez")}><span>Prenhezes confirmadas</span><b>{reprod.confirmadas.length}</b></button>
                  <button className="repro-kpi" onClick={() => setView("pendencias")}><span>Partos próximos</span><b className={reprod.proximas.length ? "gold" : ""}>{reprod.proximas.length}</b></button>
                  <button className="repro-kpi" onClick={() => setView("pendencias")}><span>Partos atrasados</span><b className={reprod.atrasadas.length ? "neg" : ""}>{reprod.atrasadas.length}</b></button>
                  <button className="repro-kpi" onClick={() => setView("prenhez")}><span>Nascimentos aguardando</span><b className={reprod.aguardando.length ? "gold" : ""}>{reprod.aguardando.length}</b></button>
                  <button className="repro-kpi" onClick={() => setView("pendencias")}><span>Pendências totais</span><b className={reprod.pendencias.length ? "gold" : ""}>{reprod.pendencias.length}</b></button>
                </div>
              </div>
            </div>

            {/* ÁREA 5 — ACESSOS RÁPIDOS */}
            <div className="dash-sec-tit">Acessos rápidos</div>
            <div className="dash-atalhos">
              {[["animal", "❖", "Animais"], ["prenhez", "◗", "Prenhezes"], ["aspiracao", "✧", "Aspirações"], ["relatorios", "▦", "Relatórios"], ["criatorios", "⌂", "Criatórios"], ["lixeira", "🗑", "Lixeira"]].map(([k, ic, l]) => (
                <button key={k} className="dash-atalho" onClick={() => setView(k)}><span className="da-ic">{ic}</span>{l}</button>
              ))}
            </div>
          </section>
        )}

        {["animal", "prenhez", "aspiracao"].includes(view) && (() => {
          // conta ativos/inativos (só animais com cadastro próprio)
          const baseAnim = view === "animal" ? visiveis.filter((a) => a.tipo === "animal" && !a.arquivada && (showAncestrais || a.origem !== "genealogia")) : [];
          const nAtivos = baseAnim.filter(ehAtivo).length;
          const nInativos = baseAnim.filter((a) => a.origem !== "genealogia" && !ehAtivo(a)).length;
          const passaSit = (a) => view !== "animal" || filtroSit === "todos" || (filtroSit === "ativos" ? ehAtivo(a) : (a.origem !== "genealogia" && !ehAtivo(a)));
          return (
          <section className="wrap">
            {view === "animal" && (
              <div className="sit-bar">
                <div className="seg-group">
                  <button className={`seg ${filtroSit === "ativos" ? "on" : ""}`} onClick={() => setFiltroSit("ativos")}>Ativos ({nAtivos})</button>
                  <button className={`seg ${filtroSit === "inativos" ? "on" : ""}`} onClick={() => setFiltroSit("inativos")}>Inativos ({nInativos})</button>
                  <button className={`seg ${filtroSit === "todos" ? "on" : ""}`} onClick={() => setFiltroSit("todos")}>Todos ({nAtivos + nInativos})</button>
                </div>
                <label className="toggle"><input type="checkbox" checked={showAncestrais} onChange={(e) => setShowAncestrais(e.target.checked)} /> Mostrar ancestrais (genealogia)</label>
              </div>
            )}
            <div className="cards-grid">
              {visiveis.filter((a) => a.tipo === view && !a.arquivada && (view !== "animal" || showAncestrais || a.origem !== "genealogia") && passaSit(a)).map((a) => {
                const f = finance(a);
                const ehAnimal = a.tipo === "animal";
                const part = ehAnimal ? participacaoAtual(a) : null;
                const sexoLbl = a.sexo ? (lc(a.sexo).startsWith("f") ? "Fêmea" : lc(a.sexo).startsWith("m") ? "Macho" : a.sexo) : "";
                const temVideo = (a.videos || []).some((v) => v && v.url);
                return (
                  <div className="asset-card" key={a.id} onClick={() => setAberto(a)} onKeyDown={(e) => { if (e.key === "Enter") setAberto(a); }} tabIndex={0} role="button" aria-label={`Abrir ${a.nome}`}>
                    <div className="asset-head">
                      <div className="asset-name serif">{a.nome || "—"}</div>
                      {a.origem === "genealogia" ? <Badge tone="gold">ancestral</Badge> : (ehAnimal && !ehAtivo(a)) ? <Badge tone="neg">inativo</Badge> : (a.status && a.tipo !== "animal") ? <Badge tone={statusTone(a.status)}>{a.status}</Badge> : null}
                    </div>
                    <div className="asset-tags">
                      {a.registro && <span className="tag">Reg. {a.registro}</span>}
                      {sexoLbl && <span className={`tag ${lc(a.sexo).startsWith("f") ? "tag-f" : "tag-m"}`}>{sexoLbl}</span>}
                      {(a.raca || a.categoria) && <span className="tag">{a.categoria || a.raca}</span>}
                      {(a.tipo === "prenhez" || a.tipo === "aspiracao") && <span className="tag">qtd: {qtdRest(a)} de {qtdTotal(a)}</span>}
                      {alertaParto(a) === "atrasado" && <span className="tag tag-alerta">parto atrasado</span>}
                      {["hoje", "7", "15", "30"].includes(alertaParto(a)) && <span className="tag tag-proximo">parto em {diasAteParto(a)}d</span>}
                      {a.origemLabel && <span className="tag tag-video">origem</span>}
                      {temVideo && <span className="tag tag-video">▶ vídeo</span>}
                    </div>
                    {ehAnimal && a.origem !== "genealogia" && (
                      <div className="asset-part">Sua participação: <b className={part <= 0 ? "neg" : "pos"}>{part}%</b></div>
                    )}
                    <div className="asset-fin"><span>{fmt(f.totalEstimado || f.cota)}</span>{f.aberto > 0 ? <em className="neg">{fmt(f.aberto)} em aberto</em> : <em className="pos">quitado</em>}</div>
                  </div>
                );
              })}
              {visiveis.filter((a) => a.tipo === view && !a.arquivada && (view !== "animal" || showAncestrais || a.origem !== "genealogia") && passaSit(a)).length === 0 && (
                <div className="empty">Nenhum registro {view === "animal" && filtroSit !== "todos" ? `(${filtroSit})` : ""}. {soSocio ? "Você não participa de ativos deste tipo." : "Use “+ Novo cadastro”."}</div>
              )}
            </div>
          </section>
          );
        })()}

        {view === "socios" && (
          <section className="wrap">
            {(db.socios || []).some((s) => s && s.arquivado) && (
              <label className="toggle"><input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} /> Mostrar arquivados</label>
            )}
            <div className="cards-grid wide">
            {db.socios.filter((s) => verArquivados ? true : !s.arquivado).filter((s) => {
              if (!qBusca) return true;
              const parts = reais.filter((a) => (a.socios || []).some((x) => x.nome === s.nome));
              return norm([s.nome, s.obs, s.doc, s.tel, s.email, ...parts.map((a) => a.nome)].join(" ")).includes(qBusca);
            }).map((s) => {
              const parts = reais.filter((a) => (a.socios || []).some((x) => x.nome === s.nome));
              return (
                <div className={`card socio-card ${s.arquivado ? "arquivado" : ""}`} key={s.id}>
                  <div className="socio-top"><div className="avatar">{s.nome.slice(0, 1)}</div><div><div className="serif socio-name">{s.nome}{s.arquivado ? " · arquivado" : ""}</div><div className="muted small">{s.doc || "—"}</div></div></div>
                  <div className="socio-lines">
                    <div><span>Telefone</span><b>{s.tel || "—"}</b></div>
                    <div><span>E-mail</span><b>{s.email || "—"}</b></div>
                    <div><span>Ativos em que participa</span><b>{parts.length}</b></div>
                  </div>
                  <div className="socio-parts">{parts.map((a) => { const sc = a.socios.find((x) => x.nome === s.nome); return <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome} · {sc.pct}%</span>; })}</div>
                  {isAdmin && <div className="card-acts">{s.arquivado ? <button className="btn btn-mini" onClick={() => restaurarSocio(s)}>Restaurar</button> : <button className="btn-del" onClick={() => excluirSocio(s)} title="Excluir sócio">🗑 Excluir</button>}</div>}
                </div>
              );
            })}
          </div></section>
        )}

        {view === "parcelas" && (
          <section className="wrap">
            <div className="kpi-row">
              <KPI label="Vencidas" value={vencidas.length} tone="neg" sub={fmt(vencidas.reduce((s, p) => s + p.valor, 0))} />
              <KPI label="Em aberto" value={parcelas.filter((p) => p.status === "aberto").length} tone="amber" />
              <KPI label="Pagas" value={parcelas.filter((p) => p.status === "pago").length} tone="pos" />
              <KPI label="Total de parcelas" value={parcelas.length} />
            </div>
            <div className="card"><div className="card-h">Todas as parcelas</div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Ativo</th><th>Tipo</th><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>{parcelas.slice().sort((a, b) => (a.venc || "").localeCompare(b.venc || "")).filter((p) => {
                  if (!qBusca) return true;
                  const a = ativos.find((x) => x.id === p.ativoId) || {};
                  return norm([p.ativoNome, p.tipo, a.leilao, a.vendedor, a.obs, p.venc, dataBR(p.venc), mesLabel((p.venc || "").slice(0, 7)), p.valor, p.origemLabel, p.obs].join(" ")).includes(qBusca);
                }).map((p, i) => (
                  <tr key={i} className={`clk ${p.status === "vencido" ? "row-late" : ""}`} onClick={() => setAberto(ativos.find((a) => a.id === p.ativoId))}>
                    <td>{p.ativoNome}</td><td>{p.tipo}</td><td>{p.numero}</td><td>{dataBR(p.venc)}</td><td>{fmt(p.valor)}</td><td><Badge tone={statusTone(p.status)}>{p.status}</Badge></td></tr>
                ))}</tbody></table></div></div>
          </section>
        )}

        {view === "leiloes" && (
          <section className="wrap">
            {(db.leiloes || []).some((l) => l && l.arquivado) && (
              <label className="toggle"><input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} /> Mostrar arquivados</label>
            )}
            <div className="cards-grid wide">
            {db.leiloes.filter((l) => verArquivados ? true : !l.arquivado).filter((l) => {
              if (!qBusca) return true;
              const comp = reais.filter((a) => (a.leilao || "") === l.nome);
              return norm([l.nome, ...comp.flatMap((a) => [a.nome, a.vendedor, a.obs])].join(" ")).includes(qBusca);
            }).map((l) => {
              const comp = reais.filter((a) => (a.leilao || "") === l.nome);
              const tot = comp.reduce((s, a) => s + finance(a).total, 0), pago = comp.reduce((s, a) => s + finance(a).pago, 0);
              return (
                <div className={`card ${l.arquivado ? "arquivado" : ""}`} key={l.id}><div className="card-h">{l.nome}{l.arquivado ? " · arquivado" : ""}</div>
                  <div className="socio-lines"><div><span>Ativos comprados</span><b>{comp.length}</b></div>
                    <div><span>Total comprado</span><b className="gold">{fmt(tot)}</b></div><div><span>Pago</span><b className="pos">{fmt(pago)}</b></div>
                    <div><span>Em aberto</span><b className="neg">{fmt(tot - pago)}</b></div></div>
                  <div className="socio-parts">{comp.map((a) => <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome}</span>)}
                    {comp.length === 0 && <span className="muted small">Sem ativos vinculados ainda.</span>}</div>
                  {isAdmin && <div className="card-acts">{l.arquivado ? <button className="btn btn-mini" onClick={() => restaurarLeilao(l)}>Restaurar</button> : <button className="btn-del" onClick={() => excluirLeilao(l)} title="Excluir leilão">🗑 Excluir</button>}</div>}
                </div>
              );
            })}
          </div></section>
        )}

        {view === "pendencias" && (
          <section className="wrap">
            <div className="card">
              <div className="card-h">Pendências da SM <span className="muted">({reprod.pendencias.length})</span></div>
              <p className="muted small" style={{ marginTop: -4 }}>Organizadas por prioridade. Calculadas pela previsão de parto e pelo status das prenhezes/aspirações. Clique para abrir o registro.</p>
              {reprod.pendencias.length === 0 ? (
                <p className="muted" style={{ marginTop: 10 }}>Nenhuma pendência no momento. 👍 Preencha a <b>previsão de parto</b> nas prenhezes para o acompanhamento funcionar.</p>
              ) : (
                <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl">
                  <thead><tr><th>Prioridade</th><th>Tipo</th><th>Registro</th><th>Criatório</th><th>Data ref.</th><th>Próxima ação</th></tr></thead>
                  <tbody>{reprod.pendencias.map((p) => (
                    <tr key={p.id} className="clk" onClick={() => setAberto(p.ref)}>
                      <td>{p.prio === 1 ? <Badge tone="neg">alta</Badge> : p.prio === 2 ? <Badge tone="gold">média</Badge> : <Badge tone="gold">baixa</Badge>}</td>
                      <td>{p.tipo}</td>
                      <td><b>{p.ref.nome || rotuloReprod(p.ref)}</b></td>
                      <td>{p.criatorio}</td>
                      <td>{p.data ? dataBR(p.data) : "—"}</td>
                      <td className="muted small">{p.acao}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          </section>
        )}

        {view === "criatorios" && (
          <CriatoriosView criatorios={db.criatorios || []} ativos={ativos} socioNames={socioNames}
            onSalvar={salvarCriatorio} onExcluir={excluirCriatorio} onRegistrarContato={registrarContato} onAbrir={setAberto} />
        )}

        {view === "relatorios" && (
          <RelatoriosView lista={ativos} ativos={ativos} db={db} onRestaurar={(novo) => { setDb(normalizeDb(novo)); }} isAdmin={isAdmin} usuario={profile && profile.nome} />
        )}

        {view === "lixeira" && (
          <LixeiraView lixeira={db.lixeira || []} onRestaurar={restaurarAnimal} onExcluirDefinitivo={excluirDefinitivo} />
        )}

        {view === "importar" && (() => {
          const prefs = (db.prefichas || []).filter(Boolean);
          const pend = (x) => x.estado !== "aprovado" && x.estado !== "rejeitado";
          const vis = prefs.filter((x) => {
            if (impFiltro === "conferir") return x.status === "conferir" && pend(x);
            if (impFiltro === "pronto") return x.status === "ok" && pend(x);
            if (impFiltro === "rejeitado") return x.estado === "rejeitado";
            return true;
          });
          const nConf = prefs.filter((x) => x.status === "conferir" && pend(x)).length;
          const nRej = prefs.filter((x) => x.estado === "rejeitado").length;
          const FILT = [["todos", "Todos"], ["conferir", "A conferir"], ["pronto", "Prontos"], ["rejeitado", "Rejeitados"]];
          return (
            <section className="wrap">
              <header className="head"><div><div className="eyebrow">Importação por Excel</div><h1 className="serif">Pré-cadastros</h1></div></header>
              <div className="card imp-upload">
                <div className="imp-up-ico">⇪</div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="imp-up-tit serif">Enviar planilha (.xlsx)</div>
                  <div className="muted small">O sistema lê compras e aspirações da planilha e cria pré-cadastros para você conferir e aprovar um a um. Nada é salvo no sistema sem a sua aprovação.</div>
                </div>
                <label className="btn btn-gold" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>Escolher arquivo
                  <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; importarExcel(f); e.target.value = ""; }} />
                </label>
              </div>
              {impResumo && impResumo.erro && <div className="aviso" style={{ marginBottom: 14 }}>{impResumo.erro}</div>}
              {impMsg && <div className="auth-ok" style={{ marginBottom: 14 }}>{impMsg}</div>}
              {impResumo && impResumo.pulados && impResumo.pulados.length > 0 && (
                <div className="aviso" style={{ marginBottom: 14 }}>Não importadas (cadastre manualmente se quiser): {impResumo.pulados.join(" · ")}</div>
              )}
              {prefs.length === 0 ? (
                <div className="empty">Nenhum pré-cadastro ainda. Envie uma planilha para começar.</div>
              ) : (<>
                <div className="kpi-row" style={{ marginBottom: 14 }}>
                  <div className="kpi"><div className="kpi-label">Pré-cadastros</div><div className="kpi-value">{prefs.length}</div></div>
                  <div className="kpi"><div className="kpi-label">A conferir</div><div className="kpi-value">{nConf}</div></div>
                  <div className="kpi"><div className="kpi-label">Rejeitados</div><div className="kpi-value">{nRej}</div></div>
                </div>
                <div className="imp-filtros">
                  {FILT.map(([k, l]) => <button key={k} className={`chip-opt ${impFiltro === k ? "on" : ""}`} onClick={() => setImpFiltro(k)}>{l}</button>)}
                  {nRej > 0 && <button className="btn btn-ghost btn-mini" style={{ marginLeft: "auto" }} onClick={limparImportados}>Limpar rejeitados</button>}
                </div>
                {vis.length === 0 ? <div className="empty">Nada neste filtro.</div> : vis.map((pref) => {
                  const d = pref.dados; const conf = pref.status === "conferir"; const rej = pref.estado === "rejeitado";
                  return (
                    <div className={`card imp-card ${conf ? "imp-red" : ""} ${rej ? "imp-rej" : ""}`} key={pref.id}>
                      <div className="imp-top">
                        <div>
                          <span className={`imp-badge ${d.tipo}`}>{d.tipo === "prenhez" ? "Prenhez" : "Aspiração"}</span>
                          <div className="serif imp-nome">{d.doadora || "(sem doadora)"}</div>
                          {d.regDoadora && <div className="muted small">RG: <b>{d.regDoadora}</b></div>}
                          {pref.rgInfo && pref.rgInfo.orig && impLow(pref.rgInfo.orig) !== impLow(d.doadora) && <div className="muted small" style={{ opacity: 0.75 }}>Texto original: {pref.rgInfo.orig}</div>}
                          {d.pai && <div className="muted small">Touro: {d.pai}</div>}
                        </div>
                        {rej && <span className="imp-state">rejeitado</span>}
                      </div>
                      <div className="imp-meta">
                        <span>Leilão: <b>{d.leilao || "—"}</b></span>
                        <span>Lote: <b>{pref.lote || "—"}</b></span>
                        <span>Data: <b>{dataBR(d.dataCompra)}</b></span>
                        <span>SM: <b>{d.porcentagemComprada !== "" && d.porcentagemComprada != null ? d.porcentagemComprada + "%" : "—"}</b></span>
                        <span>Parcela SM: <b>{d.valorParcela !== "" && d.valorParcela != null ? fmt(num(d.valorParcela)) : "—"}</b> × {d.parcelas || "—"}</span>
                      </div>
                      {pref.dupSistema && <div className="imp-flag dup">⚑ Já existe algo parecido no sistema (mesma doadora/leilão). Confira antes de aprovar.</div>}
                      {pref.dup && !pref.dupSistema && <div className="imp-flag dup">⚑ Aparece repetido na própria planilha.</div>}
                      {conf ? <div className="imp-flag conf">⚠ Confira a participação da SM — {pref.motivo}. Abra e ajuste antes de aprovar.</div>
                            : <div className="imp-flag ok">✓ Sociedade reconhecida. Pronto para conferir e cadastrar.</div>}
                      {pref.genSug > 0 && <div className="imp-flag gen">🧬 {pref.genSug} avô(s)/avó(s) sugerido(s) pela genealogia — confira ao abrir.</div>}
                      <div className="imp-acts">
                        <button className="btn btn-ghost" onClick={() => abrirPreficha(pref)}>Abrir / conferir</button>
                        {!rej && <button className="btn btn-gold" onClick={() => aprovarFicha({ ...d, __pref: pref.id })} disabled={conf} title={conf ? "Abra e ajuste o % da SM antes de aprovar" : ""}>✓ Aprovar e cadastrar</button>}
                        {!rej
                          ? <button className="btn btn-ghost" onClick={() => setEstadoPreficha(pref.id, "rejeitado")}>Rejeitar</button>
                          : <button className="btn btn-ghost" onClick={() => setEstadoPreficha(pref.id, "pendente")}>Restaurar</button>}
                        <button className="btn btn-ghost btn-mini" onClick={() => removerPreficha(pref.id)}>Excluir</button>
                      </div>
                    </div>
                  );
                })}
              </>)}
            </section>
          );
        })()}

        {view === "usuarios" && isAdmin && (
          <UsersView meId={session.user.id} />
        )}
      </main>

      {novo && (
        <div className="modal-bg" onClick={() => setNovo(false)}>
          <div className="modal chooser" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2 className="serif">O que deseja cadastrar?</h2><button className="x" onClick={() => setNovo(false)}>✕</button></div>
            <div className="chooser-grid">
              {[["animal", "❖", "Animal", "Ficha, genealogia inteligente, compra por cota e vídeos"],
                ["prenhez", "◗", "Prenhez", "Doadora, receptora, touro e pagamento por cota"],
                ["aspiracao", "✧", "Aspiração", "Oócitos, embriões e custo por resultado"]].map(([t, ic, tit, dsc]) => (
                <button className="choose" key={t} onClick={() => { setNovo(false); setForm({ tipo: t }); }}>
                  <span className="choose-ic">{ic}</span><span className="serif choose-t">{tit}</span><span className="choose-d">{dsc}</span></button>
              ))}
            </div>
          </div>
        </div>
      )}

      {form && <FichaForm tipo={form.tipo} initial={form.initial}
        animalNames={animalNames} animalReg={animalReg} genIndex={genIndex} leilaoNames={leilaoNames} localNames={localNames} vendedorNames={vendedorNames} socioNames={socioNames}
        onQuickAnimal={quickAnimal} onQuickLeilao={quickLeilao} onQuickLocal={quickLocal} onQuickVendedor={quickVendedor} onQuickSocio={quickSocio}
        onSave={salvar} onApprove={aprovarFicha} onClose={() => setForm(null)} />}
      {aberto && <Detalhe a={aberto} ativos={ativos} canDelete={isAdmin} socioNamesGlobais={socioNames} onQuickSocio={quickSocio} onNascer={nascer} onGerarPrenhez={gerarPrenhez} onConfirm={setConfirmar} onAbrir={setAberto} onClose={() => setAberto(null)} onUpdate={updateAtivo}
        onEdit={() => { setForm({ tipo: aberto.tipo, initial: aberto }); setAberto(null); }} onDelete={() => pedirExcluirAtivo(aberto)} />}
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      {confirmar && (
        <div className="modal-bg" onClick={() => setConfirmar(null)}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">{confirmar.titulo}</div>
            <p className="confirm-msg">{confirmar.mensagem}</p>
            {confirmar.usos && confirmar.usos.length > 0 && (
              <div className="confirm-usos"><div className="muted small" style={{ marginBottom: 6 }}>Utilizado em:</div>
                <div className="socio-parts">{confirmar.usos.slice(0, 20).map((n, i) => <span className="tag" key={i}>{n}</span>)}{confirmar.usos.length > 20 && <span className="muted small">+{confirmar.usos.length - 20}</span>}</div></div>
            )}
            <div className="confirm-acts">
              <button className="btn btn-ghost" onClick={() => setConfirmar(null)}>Cancelar</button>
              {confirmar.botoes.map((b, i) => <button key={i} className={`btn ${b.tone === "danger" ? "btn-danger" : b.tone === "gold" ? "btn-gold" : "btn-ghost"}`} onClick={b.onClick}>{b.label}</button>)}
            </div>
          </div>
        </div>
      )}

      {conflito && (
        <div className="modal-bg">
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-h">Alterações em outro aparelho</div>
            <p className="confirm-msg">
              Enquanto você editava, este cadastro foi salvo em <b>outro aparelho</b> (ou outro navegador). Para <b>não apagar</b> o trabalho do outro, escolha o que fazer:
              <br /><br />
              • <b>Baixar as minhas</b> guarda um arquivo com o que você alterou, para não perder nada.<br />
              • <b>Usar a versão mais recente</b> traz o que está na nuvem (descarta suas alterações ainda não gravadas).<br />
              • <b>Manter as minhas</b> grava as suas por cima da versão do outro aparelho.
            </p>
            <div className="confirm-acts">
              <button className="btn btn-ghost" onClick={baixarLocalBackup}>Baixar as minhas (backup)</button>
              <button className="btn btn-gold" onClick={atualizarDaNuvem}>Usar a versão mais recente</button>
              <button className="btn btn-danger" onClick={sobrescreverComMinhas}>Manter as minhas (sobrescrever)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================= CSS ================================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
:root{--ink:#161511;--forest:#1d3a2b;--forest2:#12281d;--gold:#c6a15b;--gold2:#e0c079;--paper:#faf7f0;--card:#fff;--bege:#efe8d7;--line:#e7dfce;--txt:#2c2a24;--muted:#8a8471;--pos:#2f7d54;--neg:#b04a3a}
.app{--ink:#161511;--forest:#1d3a2b;--forest2:#12281d;--gold:#c6a15b;--gold2:#e0c079;--paper:#faf7f0;--card:#fff;--bege:#efe8d7;--line:#e7dfce;--txt:#2c2a24;--muted:#8a8471;--pos:#2f7d54;--neg:#b04a3a;
  font-family:Inter,system-ui,sans-serif;color:var(--txt);background:var(--paper);min-height:100vh;display:flex}
.serif{font-family:Fraunces,Georgia,serif}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:600}
.muted{color:var(--muted)}.small{font-size:12px}.pos{color:var(--pos)}.neg{color:var(--neg)}.gold{color:#a9843f}
.warn{color:var(--neg);font-size:12px;font-weight:600;margin-left:8px}
.hint{font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px}
.new-hint{color:var(--gold);font-style:normal;font-size:11px}

.side{width:250px;min-height:100vh;background:linear-gradient(180deg,var(--forest),var(--forest2));color:#e9e5d6;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:flex;gap:12px;align-items:center;padding:22px 20px;border-bottom:1px solid rgba(255,255,255,.08)}
.brand-mark{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#20180a;display:grid;place-items:center;font-family:Fraunces,serif;font-weight:600;font-size:22px}
.brand-name{font-size:22px;color:#fff;line-height:1}.brand-sub{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold2)}
nav{padding:14px 12px;display:flex;flex-direction:column;gap:3px;flex:1}
.nav-item{display:flex;align-items:center;gap:12px;padding:11px 14px;border:0;background:transparent;color:#d7d2c2;border-radius:10px;cursor:pointer;font-size:14.5px;text-align:left;width:100%;transition:.15s;font-family:inherit}
.nav-item:hover{background:rgba(255,255,255,.06);color:#fff}.nav-item.on{background:rgba(198,161,91,.16);color:#fff}
.nav-item.on .nav-ic{color:var(--gold2)}.nav-ic{width:18px;color:var(--gold);font-size:14px}
.nav-count{margin-left:auto;background:rgba(255,255,255,.1);padding:1px 8px;border-radius:20px;font-size:12px}
.side-foot{padding:14px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:10px}
.side-role{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold2);display:flex;flex-direction:column;gap:5px}
.side-role select{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px;font-size:13px;text-transform:none;letter-spacing:0}

.main{flex:1;min-width:0;padding:26px 30px 60px}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.head h1{font-size:34px;margin:4px 0 0;font-weight:600;color:var(--ink)}
.head-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search{width:min(340px,60vw);padding:11px 15px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:14px}
.search:focus{outline:2px solid var(--gold)}
.wrap{display:flex;flex-direction:column;gap:20px}
.toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer}

.btn{border:0;border-radius:10px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;transition:.15s;font-family:inherit}
.btn-gold{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#241a08}.btn-gold:hover{filter:brightness(1.06)}
.btn-ghost{background:#fff;border:1px solid var(--line);color:var(--txt)}.btn-ghost:hover{border-color:var(--gold)}
.btn-mini{background:transparent;border:1px solid var(--line);color:var(--muted);padding:8px 10px;font-size:12px}
.btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px}

.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.kpi-label{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.kpi-value{font-family:Fraunces,serif;font-size:26px;font-weight:600;margin-top:6px;color:var(--ink)}
.kpi-value.gold{color:#a9843f}.kpi-value.pos{color:var(--pos)}.kpi-value.neg{color:var(--neg)}
.kpi-sub{font-size:12px;color:var(--muted);margin-top:3px}
.kpi-top{display:flex;align-items:center;gap:7px}
.kpi-ic{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:var(--paper);border:1px solid var(--line);color:#9a7b3a;font-size:12px}
.kpi.clk{cursor:pointer}.kpi.clk:hover{box-shadow:var(--shadow-md,0 6px 18px rgba(0,0,0,.08));transform:translateY(-1px);border-color:var(--gold)}

/* painel — seções, filtros, atalhos */
.dash-sec-tit{font-family:Fraunces,serif;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9a7b3a;margin:26px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.dash-filtros{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-top:4px}
.dash-filtros .df-tit{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.df-sel{padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;font-size:13px;max-width:200px}
.df-hint{font-size:11.5px;color:var(--muted);font-style:italic;margin-left:auto}
.card-h-flex{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dash-atalhos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.dash-atalho{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;font-family:inherit;transition:.15s}
.dash-atalho:hover{border-color:var(--gold);box-shadow:var(--shadow-sm);transform:translateY(-1px)}
.dash-atalho .da-ic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:var(--paper);color:#9a7b3a;font-size:15px}

.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
.card-h{font-family:Fraunces,serif;font-size:18px;font-weight:600;margin-bottom:14px;color:var(--ink)}
.cols-2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
.cards-grid.wide{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}

.asset-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;cursor:pointer;transition:.18s;display:flex;flex-direction:column;gap:10px}
.asset-card:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(29,58,43,.13);border-color:var(--gold)}
.asset-card:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.asset-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.asset-name{font-size:17px;line-height:1.2;color:var(--ink)}
.asset-tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--paper);border:1px solid var(--line);color:var(--muted)}
.tag-m{background:#e8f0fb;border-color:#bcd3f0;color:#274a86}
.tag-f{background:#fbe9f1;border-color:#f0c2d8;color:#8a3a66}
.tag-video{background:#f3ecdd;border-color:var(--gold);color:#8a6a2c}
.tag-alerta{background:#fbecea;border-color:#e3b7ae;color:#8a3a2c}
.tag-proximo{background:#f6efdd;border-color:#e6d3a2;color:#8a6a2c}
.asset-part{font-size:13px;color:var(--muted)}.asset-part b{font-size:14px}
.asset-fin{display:flex;justify-content:space-between;align-items:baseline;font-family:Fraunces,serif;font-size:16px;border-top:1px solid var(--line);padding-top:10px;margin-top:auto}.asset-fin em{font-family:Inter;font-size:12px;font-style:normal}
.empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:50px;border:1px dashed var(--line);border-radius:16px}

.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600}
.badge-gold{background:rgba(198,161,91,.16);color:#8a6a2c}.badge-green{background:rgba(47,125,84,.14);color:#256b45}
.badge-red{background:rgba(176,74,58,.14);color:#a03e30}.badge-amber{background:rgba(200,140,40,.16);color:#9a6a1c}
.badge-fase{background:var(--forest);color:#fff}

.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.tbl th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:9px 10px;border-bottom:1px solid #f0ead9}
.tbl tfoot td{border-top:2px solid var(--line);border-bottom:0}
.tbl tr.clk{cursor:pointer}.tbl tr.clk:hover{background:#faf5e8}.row-late{background:rgba(176,74,58,.05)}
.pstatus{border:0;border-radius:20px;padding:3px 12px;font-size:11.5px;font-weight:600;cursor:pointer;text-transform:capitalize}
.pstatus.pago{background:rgba(47,125,84,.16);color:#256b45}.pstatus.aberto{background:rgba(198,161,91,.18);color:#8a6a2c}
.pstatus.vencido{background:rgba(176,74,58,.16);color:#a03e30}.pstatus.parcial{background:rgba(120,90,180,.16);color:#6b4f9e}
.mini-sel,.mini-inp{border:1px solid var(--line);border-radius:7px;padding:5px 7px;font-size:12.5px;background:#fff;font-family:inherit;max-width:140px}
.pay-inp{width:104px}

.modal-bg{position:fixed;inset:0;background:rgba(20,18,12,.55);backdrop-filter:blur(3px);display:grid;place-items:start center;padding:30px 16px;overflow:auto;z-index:100}
.modal{background:var(--paper);border-radius:20px;width:min(940px,100%);box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--line);background:#fff}
.modal-head h2{margin:0;font-size:20px;font-weight:600}
.x{border:0;background:#f0ead9;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:15px;color:var(--txt)}.x.abs{position:absolute;top:0;right:0}
.modal-body{padding:22px 24px;max-height:calc(100vh - 200px);overflow:auto}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--line);background:#fff}
.exp-campo{margin-bottom:16px}.exp-campo>label{display:block;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:7px}
.exp-campo .rep-sel{width:100%}.exp-campo .seg-group{width:100%}.exp-campo .seg-group .seg{flex:1}

.fsec{margin-bottom:22px}
.fsec-h{font-family:Fraunces,serif;font-size:15px;font-weight:600;color:var(--ink);padding-bottom:8px;margin-bottom:14px;border-bottom:1px solid var(--line);display:flex;align-items:center;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 14px}
.field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)}.field.wide{grid-column:1/-1}.field span{font-weight:500}
.field input,.field select,.field textarea,.socio-row input,.socio-row select{border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:14px;background:#fff;color:var(--txt);font-family:inherit;width:100%}
.field input:focus,.field select:focus,.field textarea:focus,.socio-row input:focus{outline:2px solid var(--gold)}
.fin-live{display:flex;flex-wrap:wrap;gap:8px 20px;background:rgba(198,161,91,.1);border:1px solid rgba(198,161,91,.3);border-radius:10px;padding:12px 16px;margin-top:14px;font-size:12px;color:var(--muted)}
.fin-live b{display:block;font-size:14px;color:var(--ink);font-family:Fraunces,serif}
.segmented{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;width:fit-content}
.seg{border:0;background:#fff;padding:9px 20px;font-size:14px;cursor:pointer;font-family:inherit;color:var(--muted)}
.seg.on{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#241a08;font-weight:600}
.socio-row{display:flex;gap:10px;margin-bottom:10px;align-items:center;flex-wrap:wrap}
.socio-row>input{flex:1;min-width:120px}
.socio-auto{flex:1;min-width:170px}.socio-calc{font-size:12px;color:var(--muted);white-space:nowrap}

.auto{position:relative;width:100%}
.auto-menu{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.14);z-index:20;overflow:hidden}
.auto-item{display:block;width:100%;text-align:left;border:0;background:#fff;padding:9px 12px;font-size:13.5px;cursor:pointer;font-family:inherit;color:var(--txt)}
.auto-item:hover{background:#faf5e8}.auto-item.create{color:#8a6a2c;font-weight:600;border-top:1px solid var(--line)}

.ficha .ficha-hero{display:flex;background:#fff;border-bottom:1px solid var(--line)}
.ficha .ficha-hero.no-media .ficha-hero-info{width:100%}
.ficha-hero-info{padding:26px 28px;position:relative;flex:1}
.ficha-hero-info h2{margin:6px 0 12px;font-size:30px;font-weight:600;color:var(--ink);line-height:1.05}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.ficha-actions{display:flex;gap:10px}
.fin-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.info{display:flex;flex-direction:column;gap:2px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 13px}
.info span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.info b{font-size:14px;font-weight:600;color:var(--ink)}
.obs{margin-top:14px;background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:10px;padding:12px 15px;font-size:14px;color:#4a463c}

.geneal{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 16px;overflow-x:auto}
.geneal.ped{display:flex;flex-direction:column;align-items:center;gap:14px}
.geneal.ped svg{display:block;margin:0 auto}
.ped-legend{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}
.ped-legend span{display:inline-flex;align-items:center;gap:6px}
.ped-legend .sw{width:13px;height:13px;border-radius:4px;display:inline-block;border:1px solid}
.ped-legend .sw-m{background:#e8f0fb;border-color:#5b86cf}
.ped-legend .sw-f{background:#fbe9f1;border-color:#cf7aa3}
.ped-legend .ped-side{color:var(--gold);font-weight:600}
.geneal.tree{display:flex;flex-direction:column;gap:24px}
.tree-row{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}.tree-row.bisrow{gap:8px;flex-wrap:nowrap;min-width:min-content}
.gnode{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:9px 14px;min-width:130px;text-align:center}.gnode-sm{min-width:96px;padding:6px 9px}
.gnode-t{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--gold);font-weight:600}
.gnode-n{display:block;font-family:Fraunces,serif;font-size:14px;color:var(--ink);margin-top:2px}.gnode-sm .gnode-n{font-size:12px}
.gnode-main{background:linear-gradient(135deg,var(--forest),var(--forest2));border-color:var(--forest)}.gnode-main .gnode-n{color:#fff}.gnode-main .gnode-t{color:var(--gold2)}
.geneal.asp{display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap}
.asp-col{display:flex;flex-direction:column;gap:12px;align-items:center}.asp-head{font-family:Fraunces,serif;font-weight:600;color:var(--ink)}.asp-pair{display:flex;gap:12px}
.asp-x{font-family:Fraunces,serif;font-size:30px;color:var(--gold)}

.videos-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.btn-video{align-self:flex-start}
.video-item{display:flex;flex-direction:column;gap:6px}
.video-obs{font-size:12px;color:var(--muted)}
.video-frame{aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#000;width:100%}.video-frame iframe{width:100%;height:100%;border:0}
.auto-item.hi{background:var(--paper)}
.row-now{background:rgba(198,161,91,.10)}
.busca-grupo{margin-top:12px}
.busca-cat{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.sel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 16px;margin-top:6px}
.sel-item{display:flex;align-items:center;gap:8px;font-size:14px;padding:4px 0;cursor:pointer}
.sel-item input{width:17px;height:17px;flex-shrink:0}
.sel-item em{font-style:normal;font-size:12px}
.rep-busca{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rep-sel{padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;font-size:14px;min-width:150px;width:100%}
.rep-inp{flex:1;min-width:140px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;font-size:14px}
.rep-princ{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end}
.rep-campo label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px}
.rep-campo-busca{grid-column:1/-1}
.rep-busca-in{display:flex;gap:8px;align-items:center}
.adv-toggle{margin-top:12px}
.rep-resumo{margin-top:10px;font-size:14px;color:var(--ink)}.rep-resumo b{font-size:16px;color:var(--forest)}
.filtro-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.fchip{display:inline-flex;align-items:center;gap:6px;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 11px;font-size:12.5px;color:var(--ink)}
.fchip button{border:0;background:#e6ddc9;color:#6a5;border-radius:50%;width:17px;height:17px;cursor:pointer;font-size:10px;line-height:1;color:#7a6a3a}
.fchip button:hover{background:var(--neg);color:#fff}
.adv-panel{margin-top:14px;border-top:1px solid var(--line);padding-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.adv-grupo{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.adv-tit{font-size:12px;font-weight:700;color:#9a7b3a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.adv-row{display:flex;gap:10px;flex-wrap:wrap}.adv-row .adv-campo{flex:1;min-width:110px}
.adv-campo{margin-bottom:10px}.adv-campo label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.adv-campo input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}
.chip-opts{display:flex;flex-wrap:wrap;gap:6px}
.chip-opt{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;color:var(--muted);transition:.12s}
.chip-opt:hover{border-color:var(--gold)}.chip-opt.on{background:var(--forest);border-color:var(--forest);color:#fff}
.seg-group.sm .seg{padding:7px 13px;font-size:13px}
.aud-resumo{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:4px}
.aud-resumo>div{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.pes-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
.pes-kpis>div{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:8px 14px;display:flex;flex-direction:column;gap:1px;min-width:110px}
.pes-kpis span{font-size:11px;color:var(--muted)}.pes-kpis b{font-size:17px;font-family:Fraunces,serif}
.pes-marcos{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}
.marco-tag{font-size:12.5px;padding:6px 12px;border-radius:999px;background:var(--paper);border:1px solid var(--line)}
.marco-tag.nasc{background:#eef6ef;border-color:#bcd9c2}.marco-tag.desm{background:#f6efdd;border-color:#e6d3a2}.marco-tag.gmd{background:#e8f0fb;border-color:#bcd3f0}
.desc-sub{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.desc-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.desc-item{border:1px solid var(--line);border-radius:9px;padding:9px 12px;cursor:pointer;transition:.15s;background:#fff}
.desc-item:hover{border-color:var(--gold);box-shadow:var(--shadow-sm)}
.aud-resumo span{font-size:11.5px;color:var(--muted)}.aud-resumo b{font-size:20px;font-family:Fraunces,serif}
.aud-filtros{display:flex;flex-wrap:wrap;gap:6px;border:1px solid var(--line);border-radius:12px;overflow:hidden;padding:4px;margin-bottom:14px}
.aud-filtros .seg{border-radius:8px}.aud-filtros .seg.on{background:var(--forest);color:#fff}
.aud-lista{display:flex;flex-direction:column;gap:10px}
.aud-item{border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:#fff}
.aud-item-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:15px}
.aud-item-b{margin-top:5px;line-height:1.5}
.aud-acts{margin-top:9px;display:flex;gap:8px}
.btn-mini.gold{border-color:var(--gold);color:#8a6a2c}
.aud-item.preficha{border-left:3px solid var(--gold)}
.ia-status{display:flex;align-items:center;gap:10px;font-size:14px;padding:12px 14px;border-radius:10px;background:var(--paper);border:1px solid var(--line)}
.ia-status.erro{background:#fbecea;border-color:#e3b7ae;color:#8a3a2c}
.ia-status.ok{background:#eaf3ec;border-color:#b7d3bf;color:#2c6a3f}
.ia-spin{width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--gold);border-radius:50%;animation:iaSpin .8s linear infinite;flex-shrink:0}
@keyframes iaSpin{to{transform:rotate(360deg)}}
.ia-previa{margin-top:14px;max-width:280px;max-height:280px;border-radius:10px;border:1px solid var(--line)}
.ia-corpo{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}
.ia-thumb{width:90px;height:90px;object-fit:cover;border-radius:9px;border:1px solid var(--line);cursor:pointer;flex-shrink:0}
.ia-dados{flex:1;min-width:200px}
.ia-campos{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:13px}
.ia-campo{color:var(--muted)}.ia-campo b{color:var(--ink)}
.ia-faltando{margin-top:6px;font-size:12px;color:#8a6a2c;background:#f6efdd;border:1px solid #e6d3a2;border-radius:7px;padding:5px 9px}
.ia-baixa{margin-top:6px;font-size:12px;color:#8a3a2c;background:#fbecea;border:1px solid #e3b7ae;border-radius:7px;padding:5px 9px}
.ia-dup{margin-bottom:6px;font-size:12.5px;color:#8a3a2c;background:#fbecea;border:1px solid #e3b7ae;border-radius:7px;padding:6px 10px}
.dash-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.dash-title{font-size:24px;margin:0;color:var(--ink)}
.plantel-media{font-size:15px;color:var(--ink);margin:-4px 0 12px}.plantel-media b{font-family:Fraunces,serif;color:var(--forest)}
.plantel-info{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px;font-size:12.5px;color:var(--muted)}.plantel-info b{color:var(--ink)}
.repro-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-top:4px}
.repro-kpi{display:flex;flex-direction:column;gap:3px;align-items:flex-start;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;transition:.15s;font-family:inherit;text-align:left}
.repro-kpi:hover{border-color:var(--gold);box-shadow:var(--shadow-sm);transform:translateY(-2px)}
.repro-kpi span{font-size:12px;color:var(--muted)}
.repro-kpi b{font-size:24px;font-family:Fraunces,serif;color:var(--ink)}
.repro-kpi b.gold{color:#8a6a2c}.repro-kpi b.neg{color:var(--neg)}
.sit-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.seg-group{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
.seg-group .seg{border:0;border-right:1px solid var(--line)}.seg-group .seg:last-child{border-right:0}.seg-group .seg.on{background:var(--forest);color:#fff}
.sit-atual{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}
.card-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.btn-del{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--line);color:var(--muted);padding:7px 12px;border-radius:9px;font-size:12.5px;cursor:pointer;font-family:inherit;transition:.15s}
.btn-del:hover{border-color:var(--neg);color:var(--neg);background:rgba(176,74,58,.05)}
.btn-danger{background:var(--neg);color:#fff;border:1px solid var(--neg)}.btn-danger:hover{filter:brightness(1.06)}
.card.arquivado{opacity:.62}
.confirm{max-width:460px;padding:24px}
.confirm-h{font-family:Fraunces,serif;font-size:19px;font-weight:600;color:var(--ink);margin-bottom:10px}
.confirm-msg{font-size:14px;color:var(--txt);line-height:1.5;margin:0 0 14px}
.confirm-usos{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:16px;max-height:160px;overflow:auto}
.confirm-acts{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.eye-btn{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);font-size:13px;cursor:pointer;transition:.15s}
.eye-btn:hover{border-color:var(--gold);color:var(--ink)}
.eye-btn svg{display:block}
@media(max-width:560px){.eye-btn span{display:none}.eye-btn{padding:9px}}

.timeline{display:flex;flex-direction:column;padding-left:8px}
.tl-item{display:flex;gap:14px;padding:12px 0;border-left:2px solid var(--line);margin-left:6px;padding-left:18px;position:relative}
.tl-dot{position:absolute;left:-7px;top:16px;width:12px;height:12px;border-radius:50%;background:var(--gold);border:2px solid #fff}
.tl-top{display:flex;gap:10px;align-items:center;margin-bottom:3px}.tl-date{font-size:12px;color:var(--muted)}

.socio-card{display:flex;flex-direction:column;gap:14px}
.socio-top{display:flex;gap:12px;align-items:center}
.avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--forest),var(--forest2));color:var(--gold2);display:grid;place-items:center;font-family:Fraunces,serif;font-size:20px}
.socio-name{font-size:17px;color:var(--ink)}
.socio-lines{display:flex;flex-direction:column;gap:8px}
.socio-lines>div{display:flex;justify-content:space-between;font-size:13.5px;border-bottom:1px dashed #eee3cf;padding-bottom:6px}
.socio-lines span{color:var(--muted)}.socio-lines b{color:var(--ink)}
.socio-parts{display:flex;flex-wrap:wrap;gap:7px}
.tag{background:rgba(198,161,91,.14);color:#8a6a2c;padding:4px 10px;border-radius:20px;font-size:12px;cursor:pointer}.tag:hover{background:rgba(198,161,91,.28)}

.chooser{width:min(760px,100%)}
.chooser-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
.choose{display:flex;flex-direction:column;gap:8px;align-items:flex-start;text-align:left;background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;cursor:pointer;transition:.16s}
.choose:hover{border-color:var(--gold);transform:translateY(-3px);box-shadow:0 12px 26px rgba(29,58,43,.12)}
.choose-ic{font-size:26px;color:var(--gold)}.choose-t{font-size:19px;color:var(--ink)}.choose-d{font-size:12.5px;color:var(--muted)}
.rep-tools{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.venda-form{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}
.soc-hist{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0}
.soc-hist>div{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.venda-linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.venda-linha .socio-auto{flex:1;min-width:140px}
.previa-soc{margin-top:10px;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 12px}

/* usuário logado / login */
.user-box{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px}
.user-name{color:#fff;font-weight:600;font-size:14px}
.user-role{color:var(--gold2);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.row-inline-mini{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.auth-bg{min-height:100vh;display:grid;place-items:center;padding:20px;background:linear-gradient(160deg,var(--forest),var(--forest2));font-family:Inter,system-ui,sans-serif}
.auth-card{width:100%;max-width:400px;background:var(--paper);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.4);padding:26px 24px}
.auth-brand{display:flex;gap:12px;align-items:center;margin-bottom:18px}
.auth-brand .brand-mark{width:44px;height:44px;border-radius:11px;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#20180a;display:grid;place-items:center;font-family:Fraunces,serif;font-weight:600;font-size:20px}
.auth-brand .brand-sub{color:#a9843f;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.auth-title{font-size:24px;color:var(--ink);line-height:1}
.auth-h{font-family:Fraunces,serif;font-size:19px;font-weight:600;color:var(--ink);margin:6px 0 16px}
.auth-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted);margin-bottom:12px}
.auth-field span{font-weight:500}
.auth-field input{border:1px solid var(--line);border-radius:9px;padding:11px 12px;font-size:16px;background:#fff;color:var(--txt);font-family:inherit}
.auth-field input:focus{outline:2px solid var(--gold)}
.auth-btn{width:100%;margin-top:4px}
.auth-erro{background:rgba(176,74,58,.12);color:#a03e30;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:12px}
.auth-note{font-size:12px;color:var(--muted);margin-top:14px;text-align:center}
.auth-link{display:block;width:100%;margin-top:14px;background:transparent;border:0;color:#8a6a2c;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;text-align:center}
.auth-link:hover{text-decoration:underline}
.auth-ok{background:rgba(47,125,84,.12);color:#256b45;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:12px}
.aviso{background:rgba(200,140,40,.14);color:#9a6a1c;border:1px solid rgba(200,140,40,.3);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600}
.btn-mini.aprovar{border-color:#2f7d54;color:#256b45}
.obs-inp{max-width:220px;width:200px}

.topbar{display:none;position:fixed;top:0;left:0;right:0;width:100%;z-index:70;background:linear-gradient(180deg,var(--forest),var(--forest2));color:#fff;padding:10px 14px;align-items:center;gap:14px;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.burger{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:11px;color:#fff;font-size:20px;line-height:1;cursor:pointer;transition:transform .12s ease,background .15s ease;flex-shrink:0}
.burger:hover{background:rgba(255,255,255,.18)}.burger:active{transform:scale(.93)}
.brand-mini{font-size:19px;font-weight:600;letter-spacing:.01em}.scrim{display:none}
/* indicador de salvamento */
.save-chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:#fff;white-space:nowrap}
.save-chip .save-ic{font-size:12px;line-height:1}
.save-chip.pend{color:#8a6a2c;border-color:#e4d4a8;background:#fbf6e9}
.save-chip.saving{color:#5a5346;border-color:var(--line);background:#f6f3ec}
.save-chip.ok{color:#256b45;border-color:#bfe0cc;background:#eef7f1}
.save-chip.err,.save-chip.off{color:#9a2b2b;border-color:#e6b9b9;background:#fbeeee}
.save-retry{margin-left:4px;border:0;background:#9a2b2b;color:#fff;border-radius:999px;padding:3px 9px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit}
.save-retry:hover{background:#7f2020}
.topbar .save-chip{margin-left:auto;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.22);color:#fff}
.topbar .save-chip.ok{color:#d6f3e1}.topbar .save-chip.pend{color:#f3e3b8}.topbar .save-chip.err,.topbar .save-chip.off{color:#ffd9d9}
.save-chip-desk{display:inline-flex}

/* ===================== Responsivo ===================== */
/* ===================== refinamento visual (estético) ================== */
.app{--shadow-sm:0 1px 2px rgba(20,18,12,.05);--shadow:0 4px 18px rgba(29,58,43,.08);--shadow-lg:0 20px 52px rgba(29,58,43,.18)}
*{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.card{box-shadow:var(--shadow)}
.kpi{box-shadow:var(--shadow-sm);position:relative;overflow:hidden;transition:box-shadow .18s,transform .18s}
.kpi:hover{box-shadow:var(--shadow);transform:translateY(-2px)}
.kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(var(--gold2),var(--gold));opacity:0;transition:opacity .2s}
.kpi:hover::before{opacity:1}
.btn{border-radius:11px;font-weight:600;letter-spacing:.01em;transition:transform .12s ease,filter .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease}
.btn:active{transform:translateY(1px)}
.btn-gold{box-shadow:0 4px 14px rgba(198,161,91,.32)}.btn-gold:hover{box-shadow:0 6px 18px rgba(198,161,91,.4)}
.btn-ghost:hover{border-color:var(--gold);box-shadow:var(--shadow-sm)}
.field input,.field select,.field textarea,.auto input{border-radius:10px;transition:border-color .15s,box-shadow .15s}
.field input:focus,.field select:focus,.field textarea:focus,.auto input:focus,.search:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(198,161,91,.18)}
.tbl-wrap{border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)}
.tbl th{background:var(--paper);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.tbl tbody tr{transition:background .12s}
.tbl tbody tr:nth-child(even){background:rgba(250,247,240,.55)}
.tbl tbody tr:hover{background:rgba(198,161,91,.08)}
.tbl tbody tr.row-now{background:rgba(198,161,91,.15)}
.tbl tbody tr.row-late{background:rgba(176,74,58,.08)}
.nav-item{transition:background .15s,color .15s}
.nav-item.on{position:relative}
.nav-item.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--gold2)}
.modal{box-shadow:var(--shadow-lg);animation:modalIn .22s cubic-bezier(.4,0,.2,1)}
@keyframes modalIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.asset-card{box-shadow:var(--shadow-sm)}
.badge{letter-spacing:.02em}
.head{margin-bottom:24px}
.brand{padding:24px 20px}
@media(min-width:1500px){.main{padding:30px 48px 72px;margin:0 auto;max-width:1580px}}
@media(min-width:1700px){.main{max-width:1720px}.cards-grid{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}}
@media(max-width:1200px){.main{padding:24px 24px 60px}}
@media(max-width:1024px){
  .kpi-row,.fin-cards{grid-template-columns:repeat(2,1fr)}
  .cols-2{grid-template-columns:1fr}
  .grid,.info-grid{grid-template-columns:repeat(2,1fr)}
  .head h1{font-size:30px}
}
@media(max-width:860px){
  .topbar{display:flex}
  /* iPhone: a barra verde vai até o topo da tela, mas o ☰ e o nome descem
     abaixo do relógio/status (área segura). Zero no Android/sem notch. */
  .topbar{padding-top:calc(10px + env(safe-area-inset-top,0px));padding-left:calc(14px + env(safe-area-inset-left,0px));padding-right:calc(14px + env(safe-area-inset-right,0px))}
  .save-chip-desk{display:none}
  .side{position:fixed;left:0;top:0;bottom:0;z-index:80;transform:translateX(-100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:0 0 60px rgba(0,0,0,.45);width:min(280px,84vw);padding-top:env(safe-area-inset-top,0px)}
  .side.open{transform:translateX(0)}
  .scrim{display:block;position:fixed;inset:0;background:rgba(10,12,10,.46);z-index:75;animation:scrimIn .2s ease}
  @keyframes scrimIn{from{opacity:0}to{opacity:1}}
  .main{padding:78px 16px 56px;padding-top:calc(78px + env(safe-area-inset-top,0px))}.head h1{font-size:27px}
  .ficha .ficha-hero{flex-direction:column}
  /* toque confortável e sem zoom automático no iOS (fontes >=16px) */
  .field input,.field select,.field textarea,.socio-row input,.socio-row select,.search,.auto input,.mini-inp,.mini-sel{font-size:16px}
  .btn{padding:12px 18px}.btn-mini{padding:9px 12px}
  .nav-item{padding:13px 14px;font-size:15.5px}
  .pstatus{padding:6px 14px;font-size:12.5px}.seg{padding:11px 18px}
}
@media(max-width:560px){
  /* reserva a altura do cabeçalho fixo + área segura do iPhone, senão o
     título e a barra de busca ficam escondidos atrás da barra verde */
  .main{padding:14px 12px 52px;padding-top:calc(76px + env(safe-area-inset-top,0px))}
  .head{flex-direction:column;align-items:stretch;gap:12px}
  .head-tools{width:100%}.search{flex:1}.head-tools .btn{width:100%}
  .head h1{font-size:24px}
  .grid,.info-grid,.chooser-grid{grid-template-columns:1fr}
  .kpi-row,.fin-cards{grid-template-columns:1fr 1fr;gap:12px}
  .cards-grid,.cards-grid.wide{grid-template-columns:1fr}
  .kpi{padding:14px 16px}.kpi-value{font-size:22px}.card{padding:16px}
  .modal-bg{padding:0}.modal{border-radius:0;width:100%;min-height:100vh}.modal-body{max-height:none}
  .ficha-hero-info{padding:20px}
  .fin-live{gap:8px 14px}
  .socio-row{gap:8px}.socio-row input{min-width:0}
  .previa-soc,.venda-linha{width:100%}
  .tbl{font-size:13px}.tbl th,.tbl td{padding:8px}
}
@media print{.side,.topbar,.head-tools,.rep-tools,.btn{display:none!important}.main{padding:0}}

/* ===== DESIGN PREMIUM "LUXURY TECH" — mármore verde + dourado + marfim =====
   Só estética (cores, degradês, profundidade). Nenhuma mudança de layout,
   posição, tipografia, ícone, dado ou funcionalidade. */
:root,.app{
  --g-black:#05160F; --g-forest:#0C3826; --g-emerald:#135A40; --g-mid:#2E8560;
  --g-sage:#4E8C68; --g-pastel:#C3D7BC; --g-gold:#C09A49; --g-champ:#E6CB8A;
  --marfim:#ECE7D8; --g-ivory:#F7F3E9;
}

/* dígitos alinhados (ar de instrumento financeiro) em todo o sistema */
.kpi-value,.tbl,.repro-kpi b,.rep-resumo b,.plantel-media b,.hbar-val{font-variant-numeric:tabular-nums}

/* FUNDO — marfim encorpado com mármore claro discreto */
.app{
  background:
    linear-gradient(107deg, transparent 49.5%, rgba(78,140,104,.06) 50%, transparent 50.6%),
    radial-gradient(58% 44% at 0% 0%, rgba(19,90,64,.11), transparent 60%),
    radial-gradient(50% 40% at 100% 100%, rgba(192,154,73,.11), transparent 60%),
    var(--marfim);
  background-attachment:fixed;
}

/* MENU LATERAL — mármore verde profundo com veios dourados finos */
.side{
  background:
    linear-gradient(103deg, transparent 37.5%, rgba(192,154,73,.12) 38.6%, transparent 39.4%),
    linear-gradient(123deg, transparent 60%, rgba(230,203,138,.08) 61%, transparent 61.8%),
    linear-gradient(97deg, transparent 72%, rgba(192,154,73,.06) 72.7%, transparent 73.3%),
    radial-gradient(135% 85% at 12% 0%, rgba(22,106,76,.55), transparent 58%),
    radial-gradient(95% 70% at 98% 100%, rgba(192,154,73,.10), transparent 55%),
    linear-gradient(165deg, #0a2a20 0%, #0C3826 42%, #05160F 100%);
  box-shadow:inset -1px 0 0 rgba(255,255,255,.06), 2px 0 30px rgba(0,0,0,.24);
}
.nav-item{transition:background .18s,color .18s,box-shadow .18s}
.nav-item.on{background:linear-gradient(90deg, rgba(192,154,73,.28), rgba(22,106,76,.34));box-shadow:inset 3px 0 0 var(--g-gold)}
.nav-item.on .nav-ic{color:var(--g-champ)}
.brand-mark{box-shadow:0 4px 16px rgba(192,154,73,.36)}

/* BARRA SUPERIOR (celular) */
.topbar{
  background:
    linear-gradient(103deg, transparent 54%, rgba(230,203,138,.09) 55%, transparent 55.8%),
    radial-gradient(120% 130% at 8% 0%, rgba(22,106,76,.62), transparent 60%),
    linear-gradient(120deg, #0C3826, #05160F);
}

/* CARDS — superfície clara com profundidade, encosto verde sutil e fio dourado no topo */
.card{
  position:relative;border-color:var(--line);
  background:linear-gradient(180deg, rgba(19,90,64,.055), transparent 78px), linear-gradient(180deg, #ffffff 0%, var(--g-ivory) 100%);
  box-shadow:0 14px 34px rgba(12,48,32,.11), inset 0 1px 0 rgba(255,255,255,.7);
}
.card::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;pointer-events:none;background:linear-gradient(90deg, transparent, rgba(192,154,73,.5), transparent)}
/* marcador verde antes dos títulos de card do painel (exceto o cabeçalho com seletor) */
.dash .card-h:not(.card-h-flex){display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.dash .card-h:not(.card-h-flex)::before{content:"";width:4px;height:15px;border-radius:2px;background:linear-gradient(var(--g-mid),var(--g-emerald));flex:none}
.kpi{background:linear-gradient(180deg, #ffffff 0%, var(--g-ivory) 100%)}

/* FAIXA PATRIMONIAL — a 1ª linha de KPIs vira UMA faixa escura unida */
.dash .dash-head + .kpi-row{
  gap:0;border-radius:16px;overflow:hidden;position:relative;
  border:1px solid rgba(192,154,73,.34);
  box-shadow:0 26px 60px rgba(5,22,15,.40);
  background:
    radial-gradient(120% 140% at 6% 0%, rgba(22,106,76,.78), transparent 62%),
    linear-gradient(135deg, #05160F 0%, #0C3826 50%, #14583F 128%);
}
.dash .dash-head + .kpi-row::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;pointer-events:none;background:linear-gradient(90deg, transparent, rgba(192,154,73,.6), transparent)}
.dash .dash-head + .kpi-row .kpi{background:transparent;border:0;border-radius:0;box-shadow:none}
.dash .dash-head + .kpi-row .kpi:hover{transform:none;box-shadow:none}
.dash .dash-head + .kpi-row .kpi + .kpi{box-shadow:inset 1px 0 0 rgba(192,154,73,.22)}
.dash .dash-head + .kpi-row .kpi:nth-child(4){background:linear-gradient(155deg,#F0E6C7 0%,#E2C786 100%)}
/* texto claro nos três primeiros instrumentos */
.dash .dash-head + .kpi-row .kpi:nth-child(-n+3) .kpi-label{color:rgba(255,255,255,.74)}
.dash .dash-head + .kpi-row .kpi:nth-child(-n+3) .kpi-value{color:#fff}
.dash .dash-head + .kpi-row .kpi:nth-child(1) .kpi-value{color:var(--g-champ)}
.dash .dash-head + .kpi-row .kpi:nth-child(-n+3) .kpi-sub{color:rgba(255,255,255,.60)}
.dash .dash-head + .kpi-row .kpi:nth-child(-n+3) .kpi-ic{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.22);color:var(--g-champ)}
.dash .dash-head + .kpi-row .kpi:nth-child(-n+3)::before{background:linear-gradient(var(--g-champ),var(--g-gold))}
/* 4º instrumento (champagne): tons quentes escuros para contraste */
.dash .dash-head + .kpi-row .kpi:nth-child(4) .kpi-label{color:#6a521f}
.dash .dash-head + .kpi-row .kpi:nth-child(4) .kpi-value{color:#7a4a28}
.dash .dash-head + .kpi-row .kpi:nth-child(4) .kpi-sub{color:#7d6a3c}
.dash .dash-head + .kpi-row .kpi:nth-child(4) .kpi-ic{background:rgba(150,110,30,.16);border-color:rgba(150,110,30,.42);color:#7a5c1e}

/* 2ª linha (contagens) — tiles com traço verde→dourado no topo */
.dash .kpi-row + .kpi-row .kpi{position:relative}
.dash .kpi-row + .kpi-row .kpi::after{content:"";position:absolute;left:16px;right:16px;top:0;height:2px;border-radius:2px;pointer-events:none;background:linear-gradient(90deg,var(--g-emerald),var(--g-gold));opacity:.55}

/* detalhe dourado nos títulos de seção */
.dash-sec-tit{position:relative;border-bottom-color:var(--line)}
.dash-sec-tit::after{content:"";position:absolute;left:0;bottom:-1px;width:46px;height:2px;border-radius:2px;background:linear-gradient(90deg, var(--g-gold), var(--g-champ))}

/* filtros do painel — vidro fosco */
.dash-filtros{background:linear-gradient(180deg, rgba(255,255,255,.74), rgba(247,243,233,.62));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}

/* atalhos e detalhes */
.dash-atalho{background:linear-gradient(180deg, #ffffff 0%, var(--g-ivory) 100%)}
.dash-atalho:hover{border-color:var(--g-gold)}
.side-foot{box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.tbl-wrap{box-shadow:inset 0 1px 0 rgba(255,255,255,.65), var(--shadow-sm)}

/* seleções/estados ativos em verde (segmentos, chips) */
.seg-group .seg.on{background:linear-gradient(135deg, var(--g-emerald), var(--g-mid));color:#fff}
.chip-opt.on{background:linear-gradient(135deg, var(--g-emerald), var(--g-mid));border-color:var(--g-emerald)}

/* ===== PAINEL NO CELULAR — organização da faixa patrimonial =====
   Só vale em tela estreita (≤560px). O desktop fica 100% intacto.
   Patrimônio (1º) e Em aberto (4º) ocupam a largura toda; Investido e
   Pago ficam lado a lado no meio. Divisores redesenhados pra leitura. */
@media(max-width:560px){
  .dash .dash-head + .kpi-row{grid-template-columns:1fr 1fr}
  .dash .dash-head + .kpi-row .kpi:nth-child(1),
  .dash .dash-head + .kpi-row .kpi:nth-child(4){grid-column:1 / -1}
  .dash .dash-head + .kpi-row .kpi{padding:15px 16px}
  .dash .dash-head + .kpi-row .kpi + .kpi{box-shadow:none}
  .dash .dash-head + .kpi-row .kpi:nth-child(2){box-shadow:inset 0 1px 0 rgba(192,154,73,.22)}
  .dash .dash-head + .kpi-row .kpi:nth-child(3){box-shadow:inset 0 1px 0 rgba(192,154,73,.22), inset 1px 0 0 rgba(192,154,73,.22)}
  .dash .dash-head + .kpi-row .kpi:nth-child(4){box-shadow:inset 0 1px 0 rgba(120,90,30,.20)}
}
/* ===== IMPORTAÇÃO POR EXCEL ===== */
.imp-upload{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.imp-up-ico{width:48px;height:48px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:24px;background:linear-gradient(135deg,var(--g-emerald),var(--g-mid));color:var(--g-champ);flex:none}
.imp-up-tit{font-size:16px;font-weight:600;color:#1d2a22}
.imp-filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.imp-card{margin-bottom:12px}
.imp-card.imp-red{border-color:#e3b7af}
.imp-card.imp-rej{opacity:.52}
.imp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}
.imp-badge{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 9px;border-radius:999px}
.imp-badge.prenhez{background:#e7f0ea;color:#1c6344}
.imp-badge.aspiracao{background:#efe8d4;color:#8a6a1c}
.imp-nome{font-size:16px;font-weight:600;color:#1d2a22;margin-top:3px}
.imp-state{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border-radius:999px;background:#f3d9d4;color:#9a2b2b;white-space:nowrap}
.imp-meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:#55503f;margin:6px 0}
.imp-meta b{color:#2b2820}
.imp-flag{font-size:12.5px;border-radius:9px;padding:8px 11px;margin:8px 0 0;font-weight:500}
.imp-flag.ok{background:#eef7f1;border:1px solid #bfe0cc;color:#256b45}
.imp-flag.conf{background:#fbeeec;border:1px solid #e3b7af;color:#b0463a}
.imp-flag.dup{background:#fff5e6;border:1px solid #e9d4a8;color:#8a6a1c}
.imp-flag.gen{background:#eef4f0;border:1px solid #cfe3d6;color:#2b6a4a}
.imp-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
.gen-sug{color:#2b6a4a}
.auto-item{display:flex;justify-content:space-between;align-items:center;gap:10px}
.auto-rg{font-size:11px;color:#8a6a1c;background:#efe8d4;border-radius:5px;padding:1px 6px;flex:none;font-weight:600}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

