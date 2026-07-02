import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "./supabase";

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
  return {
    valor, qtd, pct, cota, totalEstimado, com, custos, finalEstimado, list,
    pagas, restantes, jaPago, emAberto, devidas, ultimoVenc, proxima: prox ? prox.venc : "", vencidas,
    total: cota + custos, pago: jaPago, aberto: emAberto, patrimonio: totalEstimado,
  };
}
function cronograma(a) {
  a = a || {};
  return finance(a).list.map((p) => ({ ativoId: a.id, tipo: a.tipo, ativoNome: a.nome, ...p, status: parcStatus(p) }));
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
const STATUS_PRENHEZ = ["Confirmada", "Aguardando diagnóstico", "Perdida", "Parida", "Vendida"];
const STATUS_ASP = ["Realizada", "Em laboratório", "Embriões produzidos", "Transferida", "Finalizada", "Cancelada"];

/* --------------------------- esquemas de ficha ------------------------- */
/* tipos: text|number|date|money|pct|select|textarea|link|leilao|local|vendedor|simnao */
const COMPRA = [
  ["leilao", "Nome do leilão", "leilao"], ["dataCompra", "Data da compra", "date"],
  ["vendedor", "Vendedor", "vendedor"], ["obsCompra", "Observações da compra", "textarea"],
];
const PAGAMENTO = [
  ["porcentagemComprada", "Porcentagem comprada (%)", "pct"],
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
      ["nascimento", "Data de nascimento", "date"], ["status", "Status", "select", STATUS_ANIMAL],
      ["ondeEsta", "Onde está", "local"],
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
      ["nome", "Identificação da prenhez", "text"],
      ["doadora", "Doadora (mãe genética)", "link"], ["receptora", "Receptora", "link"],
      ["touro", "Touro / pai", "link"], ["dataInsem", "Data insem./TE", "date"],
      ["dataParto", "Data prevista de parto", "date"], ["sexoPrev", "Sexo previsto", "select", ["Indefinido", "Fêmea", "Macho"]],
      ["status", "Status", "select", STATUS_PRENHEZ], ["raca", "Raça", "select", RACAS],
      ["ondeEsta", "Onde está (receptora)", "local"],
      ["veterinario", "Veterinário", "text"], ["laboratorio", "Laboratório", "text"],
    ]},
    { g: "Genealogia esperada", gen: true, f: [
      ["avoPaterno", "Avô paterno", "link"], ["avoPaterna", "Avó paterna", "link"],
      ["avoMaterno", "Avô materno", "link"], ["avoMaterna", "Avó materna", "link"],
      ["obsGen", "Observações sobre a genética", "textarea"],
    ]},
    { g: "Compra", f: COMPRA },
    { g: "Pagamento", pay: true, f: PAGAMENTO },
    { g: "Observações", f: [["obs", "Observações", "textarea"]] },
  ],
  aspiracao: [
    { g: "Identificação", f: [
      ["nome", "Identificação da aspiração", "text"], ["doadora", "Doadora aspirada", "link"],
      ["dataAsp", "Data da aspiração", "date"], ["touro", "Touro / sêmen", "link"],
      ["laboratorio", "Laboratório", "text"], ["veterinario", "Veterinário", "text"],
      ["status", "Status", "select", STATUS_ASP], ["ondeEsta", "Onde está", "local"],
    ]},
    { g: "Produção de embriões", f: [
      ["oocitos", "Oócitos coletados", "number"], ["embrioes", "Embriões produzidos", "number"],
      ["viaveis", "Embriões viáveis", "number"], ["congelados", "Embriões congelados", "number"],
      ["transferidos", "Embriões transferidos", "number"], ["prenhezes", "Prenhezes confirmadas", "number"],
    ]},
    { g: "Genealogia da combinação", gen: true, f: [
      ["paiDoadora", "Pai da doadora", "link"], ["maeDoadora", "Mãe da doadora", "link"],
      ["paiTouro", "Pai do touro", "link"], ["maeTouro", "Mãe do touro", "link"],
      ["obsGen", "Observações sobre a genética", "textarea"],
    ]},
    { g: "Compra", f: COMPRA },
    { g: "Pagamento", pay: true, f: PAGAMENTO },
    { g: "Observações", f: [["obs", "Observações", "textarea"]] },
  ],
};
const linkKeysOf = (tipo) => (SCHEMAS[tipo] || []).flatMap((s) => s.f).filter(([, , t]) => t === "link").map(([k]) => k);

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
const KPI = ({ label, value, sub, tone }) => (
  <div className="kpi"><div className="kpi-label">{label}</div>
    <div className={`kpi-value ${tone || ""}`}>{value}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>
);

/* autocomplete genérico */
function AutoField({ value, onChange, suggestions, onCreate, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || "");
  useEffect(() => setQ(value || ""), [value]);
  const ql = lc(q);
  const sugs = (suggestions || []).filter((s) => typeof s === "string" && s);
  const matches = sugs.filter((s) => lc(s).includes(ql)).slice(0, 6);
  const exact = sugs.some((s) => lc(s) === ql);
  return (
    <div className="auto">
      <input value={q} placeholder={placeholder || "digite para buscar…"}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)} />
      {open && (matches.length > 0 || (q && !exact)) && (
        <div className="auto-menu">
          {matches.map((m) => <button type="button" key={m} className="auto-item" onMouseDown={() => { setQ(m); onChange(m); setOpen(false); }}>{m}</button>)}
          {q && !exact && onCreate && (
            <button type="button" className="auto-item create" onMouseDown={() => { onCreate(q); setQ(q); onChange(q); setOpen(false); }}>＋ Cadastrar “{q}”</button>
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
  if (a.tipo === "aspiracao") {
    center = { label: "Combinação", name: a.nome, sex: "N" };
    leftGens = [[{ label: "Touro", name: a.touro, sex: "M" }], [{ label: "Pai", name: a.paiTouro, sex: "M" }, { label: "Mãe", name: a.maeTouro, sex: "F" }]];
    rightGens = [[{ label: "Doadora", name: a.doadora, sex: "F" }], [{ label: "Pai", name: a.paiDoadora, sex: "M" }, { label: "Mãe", name: a.maeDoadora, sex: "F" }]];
  } else {
    const isPren = a.tipo === "prenhez";
    center = { label: isPren ? "Cria" : "Animal", name: a.nome, sex: isPren ? sexNorm(a.sexoPrev) : sexNorm(a.sexo) };
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
  return (
    <div className="video"><div className="video-h"><Badge tone="gold">{v.tipo || "Vídeo"}</Badge>{v.obs && <span className="video-obs">{v.obs}</span>}</div>
      {emb ? <div className="video-frame"><iframe src={emb} title={v.tipo} frameBorder="0" allowFullScreen /></div>
        : <a className="btn btn-ghost" href={v.url} target="_blank" rel="noreferrer">▶ Abrir vídeo</a>}</div>
  );
}

/* --------------------------- formulário de ficha ----------------------- */
function FichaForm({ tipo, initial, animalNames, leilaoNames, localNames, vendedorNames, socioNames,
  onQuickAnimal, onQuickLeilao, onQuickLocal, onQuickVendedor, onQuickSocio, onSave, onClose }) {
  const [d, setD] = useState(() => initial || { id: uid(), tipo, socios: [], videos: [], historico: [], comissaoPct: 8 });
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
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
    if (type === "simnao") return (
      <label className="field wide" key={k}><span>{label}</span>
        <div className="segmented"><button type="button" className={`seg ${d[k] ? "on" : ""}`} onClick={() => set(k, true)}>Sim</button>
          <button type="button" className={`seg ${!d[k] ? "on" : ""}`} onClick={() => set(k, false)}>Não</button></div></label>
    );
    const isAuto = autoSrc[type];
    const isNewAnimal = type === "link" && d[k] && !(animalNames || []).some((n) => lc(n) === lc(d[k]));
    return (
      <label className={`field ${type === "textarea" ? "wide" : ""}`} key={k}>
        <span>{label}{isNewAnimal && <em className="new-hint"> · novo, será salvo</em>}</span>
        {type === "textarea" ? <textarea value={d[k] || ""} onChange={(e) => set(k, e.target.value)} rows={2} />
          : type === "select" ? <select value={d[k] || ""} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{opt.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : isAuto ? <AutoField value={d[k] || ""} onChange={(v) => set(k, v)} suggestions={isAuto[0]} onCreate={isAuto[1]} placeholder={isAuto[2]} />
          : <input type={type === "money" || type === "number" ? "number" : type === "date" ? "date" : "text"} step="any"
              value={d[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={type === "money" ? "R$ 0" : type === "pct" ? "ex.: 33,33" : ""} />}
      </label>
    );
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{initial ? "Editar" : "Novo cadastro"} — <span className="serif">{titulo}</span></h2><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-body">
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
                <input type="number" step="any" placeholder="%" value={s.pct} onChange={(e) => setSocio(s.id, "pct", e.target.value)} style={{ maxWidth: 90 }} />
                <button className="btn btn-mini" onClick={() => delSocio(s.id)}>remover</button>
              </div>
            ))}
            <button className="btn btn-ghost" onClick={addSocio}>+ Adicionar sócio</button>
          </div>

          {/* mídia */}
          <div className="fsec">
            <div className="fsec-h">Fotos e vídeos</div>
            <label className="field wide"><span>Foto principal (URL)</span>
              <input value={d.fotoPrincipal || ""} onChange={(e) => set("fotoPrincipal", e.target.value)} placeholder="https://..." /></label>
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
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-gold" onClick={() => onSave(d)}>Salvar ficha</button></div>
      </div>
    </div>
  );
}

/* ------------------------------ ficha detalhe -------------------------- */
function Detalhe({ a, onEdit, onClose, onDelete, onUpdate, ativos, canDelete }) {
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

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal ficha" onClick={(e) => e.stopPropagation()}>
        <div className="ficha-hero">
          <div className="ficha-hero-media">
            {a.fotoPrincipal ? <img src={a.fotoPrincipal} alt={a.nome} onError={(e) => (e.target.style.display = "none")} /> : <div className="media-ph"><span>{titulo}</span></div>}
          </div>
          <div className="ficha-hero-info">
            <div className="eyebrow">{titulo}{a.raca ? ` · ${a.raca}` : ""}{a.origem === "genealogia" ? " · ancestral" : ""}</div>
            <h2 className="serif">{a.nome}</h2>
            <div className="chips">
              {fase && <Badge tone="fase">{fase}</Badge>}
              {a.status && <Badge tone={statusTone(a.status)}>{a.status}</Badge>}
              {a.registro && <Badge tone="gold">Reg. {a.registro}</Badge>}
              {a.tipo === "animal" && a.nascimento && <Badge tone="gold">{idade(a.nascimento)}</Badge>}
              {a.ondeEsta && <Badge tone="gold">📍 {a.ondeEsta}</Badge>}
            </div>
            <div className="ficha-actions"><button className="btn btn-gold" onClick={onEdit}>Editar</button>
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
              {a.tipo === "animal" && <><Info l="Onde está" v={a.ondeEsta} /><Info l="Sexo" v={a.sexo} /><Info l="Nascimento" v={dataBR(a.nascimento)} /></>}
              {a.tipo === "prenhez" && <><Info l="Doadora" v={a.doadora} /><Info l="Receptora" v={a.receptora} /><Info l="Touro" v={a.touro} />
                <Info l="Insem./TE" v={dataBR(a.dataInsem)} /><Info l="Parto previsto" v={dataBR(a.dataParto)} /><Info l="Sexo previsto" v={a.sexoPrev} />
                <Info l="Veterinário" v={a.veterinario} /><Info l="Laboratório" v={a.laboratorio} /></>}
              {a.tipo === "aspiracao" && <><Info l="Doadora" v={a.doadora} /><Info l="Touro/sêmen" v={a.touro} /><Info l="Data" v={dataBR(a.dataAsp)} />
                <Info l="Oócitos" v={a.oocitos} /><Info l="Embriões" v={a.embrioes} /><Info l="Viáveis" v={a.viaveis} />
                <Info l="Congelados" v={a.congelados} /><Info l="Transferidos" v={a.transferidos} /><Info l="Prenhezes" v={a.prenhezes} /></>}
              <Info l="Leilão / origem" v={a.leilao} /><Info l="Vendedor" v={a.vendedor} /><Info l="Data da compra" v={dataBR(a.dataCompra)} />
            </div>
            {a.obs && <p className="obs">{a.obs}</p>}
          </div>

          {f.qtd > 0 && (
            <div className="fsec"><div className="fsec-h">Parcelas <span className="muted small">— clique no status para pagar/estornar; use “valor pago” para pagamento parcial</span></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Valor pago</th><th>Pago em</th><th>Observações</th></tr></thead>
                <tbody>
                  {f.list.map((p, i) => {
                    const st = parcStatus(p);
                    return (
                      <tr key={i} className={st === "vencido" ? "row-late" : ""}>
                        <td>{p.numero}</td><td>{dataBR(p.venc)}</td><td>{fmt(p.valor)}</td>
                        <td><button className={`pstatus ${st}`} onClick={() => setPago(i, num(p.valorPago) >= p.valor ? 0 : p.valor)}>{st}</button></td>
                        <td><input className="mini-inp pay-inp" type="number" step="any" value={p.valorPago || ""} onChange={(e) => setPago(i, num(e.target.value))} /></td>
                        <td>{num(p.valorPago) > 0 ? dataBR(p.dataPagamento) : "—"}{p.auto ? " (auto)" : ""}</td>
                        <td><input className="mini-inp obs-inp" placeholder="observações" value={p.obs || ""} onChange={(e) => setParcela(i, "obs", e.target.value)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div></div>
          )}

          {(a.socios || []).length > 0 && (
            <div className="fsec"><div className="fsec-h">Sociedade <span className="muted small hint">— apenas informativo</span>{pctSocios !== 100 && <span className="warn">⚠ soma {pctSocios}%</span>}</div>
              <table className="tbl">
                <thead><tr><th>Sócio</th><th>Porcentagem</th></tr></thead>
                <tbody>{a.socios.map((s) => (
                  <tr key={s.id}><td>{s.nome}</td><td>{s.pct}%</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {(a.videos || []).length > 0 && (
            <div className="fsec"><div className="fsec-h">Vídeos</div><div className="videos-grid">{a.videos.map((v) => <VideoBlock key={v.id} v={v} />)}</div></div>
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

  const mudar = async (id, campos) => {
    try { await supabase.from("profiles").update(campos).eq("id", id); } catch (e) {}
    load();
  };
  const pendentes = list.filter((u) => u && u.aprovado === false).length;

  return (
    <section className="wrap">
      {pendentes > 0 && <div className="aviso">{pendentes} cadastro(s) aguardando aprovação.</div>}
      <div className="card">
        <div className="card-h">Usuários ({list.length})</div>
        <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>
          Novos usuários criam a própria conta na tela de login ("Novo usuário / Criar conta") e aparecem aqui para você aprovar.
        </p>
        {erro && <div className="auth-erro">{erro}</div>}
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Permissão</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody>{list.filter(Boolean).map((u) => (
              <tr key={u.id}>
                <td>{u.nome || "—"}{u.id === meId && <span className="muted small"> (você)</span>}</td>
                <td>{u.email || "—"}</td>
                <td>
                  {u.id === meId ? (u.role || "—") : (
                    <select className="mini-sel" value={u.role || "Usuário"} onChange={(e) => mudar(u.id, { role: e.target.value })}>
                      <option>Usuário</option><option>Administrador</option>
                    </select>
                  )}
                </td>
                <td>{u.aprovado === false ? <Badge tone="amber">pendente</Badge> : <Badge tone="green">aprovado</Badge>}</td>
                <td>
                  <span className="row-inline-mini">
                    {u.aprovado === false && <button className="btn btn-mini aprovar" onClick={() => mudar(u.id, { aprovado: true })}>aprovar</button>}
                    {u.aprovado !== false && u.id !== meId && <button className="btn btn-mini" onClick={() => mudar(u.id, { aprovado: false })}>revogar acesso</button>}
                  </span>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Senha esquecida? Por enquanto, oriente a pessoa a criar uma nova conta com outro e-mail e aprove-a; depois revogue a antiga.
        </p>
      </div>
    </section>
  );
}

/* ================================= APP ================================= */
export default function App() {
  const [db, setDb] = useState(SEED);
  const [view, setView] = useState("dashboard");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(null);
  const [form, setForm] = useState(null);
  const [novo, setNovo] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showAncestrais, setShowAncestrais] = useState(false);
  const [session, setSession] = useState(null);       // sessão do Supabase
  const [profile, setProfile] = useState(null);       // perfil (nome, permissão, aprovação)
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [recovering, setRecovering] = useState(false); // veio pelo link de redefinição de senha

  const dbRef = useRef(null);
  const lastWrite = useRef(0);
  const firstSave = useRef(true);

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

  /* ---- carregar o banco compartilhado (nuvem) ---- */
  useEffect(() => {
    if (!session || !aprovado) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("app_data").select("value").eq("key", "db").maybeSingle();
        if (!alive) return;
        const base = normalizeDb(data && data.value ? JSON.parse(data.value) : SEED);
        setDb(base); dbRef.current = JSON.stringify(base);
      } catch (e) {
        const base = normalizeDb(SEED); setDb(base); dbRef.current = JSON.stringify(base);
      }
      if (alive) setDataReady(true);
    })();
    return () => { alive = false; };
  }, [session, aprovado]);

  /* ---- salvar na nuvem a cada mudança ---- */
  useEffect(() => {
    if (!dataReady) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const json = JSON.stringify(db);
    dbRef.current = json; lastWrite.current = Date.now();
    (async () => {
      try { await supabase.from("app_data").upsert({ key: "db", value: json, updated_at: new Date().toISOString() }); } catch (e) {}
    })();
  }, [db, dataReady]);

  /* ---- sincronização: puxa mudanças de outros usuários a cada 5s ---- */
  useEffect(() => {
    if (!dataReady) return;
    const t = setInterval(async () => {
      if (form || aberto || novo) return;                    // não interromper edições
      if (Date.now() - lastWrite.current < 3000) return;      // evita eco da própria gravação
      try {
        const { data } = await supabase.from("app_data").select("value").eq("key", "db").maybeSingle();
        if (data && data.value && data.value !== dbRef.current) {
          dbRef.current = data.value;
          setDb(normalizeDb(JSON.parse(data.value)));
        }
      } catch (e) {}
    }, 5000);
    return () => clearInterval(t);
  }, [dataReady, form, aberto, novo]);

  const logout = async () => { try { await supabase.auth.signOut(); } catch (e) {} };

  const soSocio = false;
  const ativos = db.ativos;
  const animalNames = useMemo(() => (ativos || []).filter((a) => a && a.tipo === "animal" && typeof a.nome === "string" && a.nome).map((a) => a.nome), [ativos]);
  const leilaoNames = useMemo(() => { const s = new Set((db.leiloes || []).map((l) => l && l.nome).filter(Boolean)); (ativos || []).forEach((a) => a && a.leilao && s.add(a.leilao)); return [...s]; }, [db.leiloes, ativos]);
  const localNames = useMemo(() => { const s = new Set((db.locais || []).filter(Boolean)); (ativos || []).forEach((a) => a && a.ondeEsta && s.add(a.ondeEsta)); return [...s]; }, [db.locais, ativos]);
  const vendedorNames = useMemo(() => { const s = new Set((db.vendedores || []).map((v) => v && v.nome).filter(Boolean)); (ativos || []).forEach((a) => a && a.vendedor && s.add(a.vendedor)); return [...s]; }, [db.vendedores, ativos]);
  const socioNames = useMemo(() => (db.socios || []).map((s) => s && s.nome).filter(Boolean), [db.socios]);

  const visiveis = useMemo(() => {
    let list = (ativos || []).filter(Boolean);
    if (lc(busca).trim()) { const q = lc(busca); list = list.filter((a) => { try { return lc(JSON.stringify(a)).includes(q); } catch (e) { return false; } }); }
    return list;
  }, [ativos, busca]);

  const parcelas = useMemo(() => (ativos || []).filter(Boolean).flatMap((a) => { try { return cronograma(a); } catch (e) { return []; } }), [ativos]);
  const reais = (ativos || []).filter((a) => a && a.origem !== "genealogia");
  const kpis = useMemo(() => { const acc = { total: 0, pago: 0, aberto: 0, patrimonio: 0 }; reais.forEach((a) => { const f = finance(a); acc.total += f.total; acc.pago += f.pago; acc.aberto += f.aberto; acc.patrimonio += f.totalEstimado; }); return acc; }, [ativos]);
  const vencidas = parcelas.filter((p) => p.status === "vencido");
  const proximas = parcelas.filter((p) => p.status === "aberto" || p.status === "parcial").sort((a, b) => (a.venc || "").localeCompare(b.venc || "")).slice(0, 6);
  const count = (t) => (ativos || []).filter((a) => a && a.tipo === t && a.origem !== "genealogia").length;

  const salvar = (d) => {
    d = { ...d, parcelasList: ensureParcelas(d) };
    setDb((p) => {
      let list = [...p.ativos];
      const nameSet = new Set(list.filter((a) => a && a.tipo === "animal" && a.nome).map((a) => lc(a.nome)));
      linkKeysOf(d.tipo).forEach((k) => { const nm = (d[k] ?? "").toString().trim(); if (nm && !nameSet.has(lc(nm)) && lc(nm) !== lc(d.nome)) { list.push(stubAnimal(nm, profile && profile.nome)); nameSet.add(lc(nm)); } });
      const exists = list.some((a) => a.id === d.id);
      if (exists) list = list.map((a) => (a.id === d.id ? d : a));
      else list = [{ ...d, historico: [{ id: uid(), data: today(), tipo: "Cadastro criado", desc: "Ficha criada", responsavel: profile && profile.nome }, ...(d.historico || [])] }, ...list];
      let leiloes = [...(p.leiloes || [])]; if (d.leilao && !leiloes.some((l) => l && lc(l.nome) === lc(d.leilao))) leiloes = [...leiloes, { id: uid(), nome: d.leilao }];
      let locais = [...(p.locais || [])]; if (d.ondeEsta && !locais.some((l) => lc(l) === lc(d.ondeEsta))) locais = [...locais, d.ondeEsta];
      let vendedores = [...(p.vendedores || [])]; if (d.vendedor && !vendedores.some((v) => v && lc(v.nome) === lc(d.vendedor))) vendedores = [...vendedores, { id: uid(), nome: d.vendedor, tipo: "Outro", doc: "", tel: "", email: "", obs: "" }];
      let socios = [...(p.socios || [])]; (d.socios || []).forEach((s) => { if (s && s.nome && !socios.some((x) => x && lc(x.nome) === lc(s.nome))) socios = [...socios, { id: uid(), nome: s.nome, doc: "", tel: "", email: "", endereco: "", obs: "" }]; });
      return { ...p, ativos: list, leiloes, locais, vendedores, socios };
    });
    setForm(null); setAberto(d);
  };
  const updateAtivo = (d) => { setDb((p) => ({ ...p, ativos: p.ativos.map((a) => (a.id === d.id ? d : a)) })); setAberto(d); };
  const excluir = (id) => { setDb((p) => ({ ...p, ativos: p.ativos.filter((a) => a.id !== id) })); setAberto(null); };
  const quickAnimal = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => (p.ativos.some((a) => a && a.tipo === "animal" && lc(a.nome) === lc(nm)) ? p : { ...p, ativos: [...p.ativos, stubAnimal(nm, profile && profile.nome)] })); };
  const quickLeilao = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.leiloes || []).some((l) => l && lc(l.nome) === lc(nm)) ? p : { ...p, leiloes: [...(p.leiloes || []), { id: uid(), nome: nm }] })); };
  const quickLocal = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.locais || []).some((l) => lc(l) === lc(nm)) ? p : { ...p, locais: [...(p.locais || []), nm] })); };
  const quickVendedor = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.vendedores || []).some((v) => v && lc(v.nome) === lc(nm)) ? p : { ...p, vendedores: [...(p.vendedores || []), { id: uid(), nome: nm, tipo: "Outro", doc: "", tel: "", email: "", obs: "" }] })); };
  const quickSocio = (nm) => { nm = (nm ?? "").toString().trim(); if (!nm) return; setDb((p) => ((p.socios || []).some((s) => s && lc(s.nome) === lc(nm)) ? p : { ...p, socios: [...(p.socios || []), { id: uid(), nome: nm, doc: "", tel: "", email: "", endereco: "", obs: "" }] })); };

  const porStatus = useMemo(() => { const m = {}; reais.filter((a) => a.tipo === "animal").forEach((a) => { const k = a.status || "Sem status"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([name, value]) => ({ name, value })); }, [ativos]);
  const invTipo = useMemo(() => { const m = {}; reais.forEach((a) => { m[a.tipo] = (m[a.tipo] || 0) + finance(a).cota; }); return Object.entries(m).map(([name, value]) => ({ name, value })); }, [ativos]);
  const PIE = ["#C6A15B", "#2F5D45", "#7A5230", "#9BB39F", "#E0C079", "#4A4A4A"];

  const exportCSV = () => {
    const rows = [["Tipo", "Nome", "Status", "Cota (R$)", "Total estimado", "Pago", "Em aberto"]];
    visiveis.forEach((a) => { const f = finance(a); rows.push([a.tipo, a.nome, a.status || "", f.cota, f.totalEstimado, f.pago, f.aberto]); });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = "relatorio-gado-elite.csv"; el.click(); URL.revokeObjectURL(url);
  };

  const nav = [["dashboard", "◆", "Painel"], ["animal", "❖", "Animais"], ["prenhez", "◗", "Prenhezes"], ["aspiracao", "✧", "Aspirações"],
    ["socios", "◎", "Sócios"], ["parcelas", "▤", "Parcelas"], ["leiloes", "⚑", "Leilões"], ["relatorios", "▦", "Relatórios"],
    ...(isAdmin ? [["usuarios", "◐", "Usuários"]] : [])];

  if (!authReady) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando…</div></div></div>;
  if (recovering && session) return <NovaSenha onDone={() => setRecovering(false)} />;
  if (!session) return <Auth />;
  if (!profileLoaded) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando seu perfil…</div></div></div>;
  if (!profile) return <Pendente bloqueado nome="" onLogout={logout} />;
  if (!profile.aprovado) return <Pendente nome={profile.nome} onLogout={logout} />;
  if (!dataReady) return <div className="auth-bg"><style>{CSS}</style><div className="auth-card"><div className="auth-brand"><div className="brand-mark">SM</div><div><div className="serif auth-title">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div><div className="auth-note">Carregando dados…</div></div></div>;

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar"><button className="burger" onClick={() => setNavOpen((v) => !v)}>☰</button><div className="brand-mini serif">SM sistema</div></div>

      <aside className={`side ${navOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">SM</div><div><div className="serif brand-name">SM sistema</div><div className="brand-sub">Gado de Elite</div></div></div>
        <nav>{nav.map(([k, ic, l]) => (
          <button key={k} className={`nav-item ${view === k ? "on" : ""}`} onClick={() => { setView(k); setNavOpen(false); }}>
            <span className="nav-ic">{ic}</span>{l}{["animal", "prenhez", "aspiracao"].includes(k) && <span className="nav-count">{count(k)}</span>}</button>
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
            <input className="search" placeholder="Buscar animal, prenhez, sócio, leilão…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {!soSocio && <button className="btn btn-gold" onClick={() => setNovo(true)}>+ Novo cadastro</button>}
          </div>
        </header>

        {view === "dashboard" && (
          <section className="wrap">
            <div className="kpi-row"><KPI label="Animais" value={count("animal")} /><KPI label="Prenhezes" value={count("prenhez")} /><KPI label="Aspirações" value={count("aspiracao")} /><KPI label="Patrimônio estimado" value={fmt(kpis.patrimonio)} tone="gold" /></div>
            <div className="kpi-row"><KPI label="Total investido" value={fmt(kpis.total)} /><KPI label="Já pago" value={fmt(kpis.pago)} tone="pos" /><KPI label="Em aberto" value={fmt(kpis.aberto)} tone="neg" /><KPI label="Parcelas vencidas" value={vencidas.length} tone={vencidas.length ? "neg" : ""} /></div>
            <div className="cols-2">
              <div className="card"><div className="card-h">Investimento por tipo de ativo</div>
                <ResponsiveContainer width="100%" height={230}><BarChart data={invTipo} margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6ddc8" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5a5346" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#5a5346" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="value" fill="#C6A15B" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <div className="card"><div className="card-h">Animais por status</div>
                <ResponsiveContainer width="100%" height={230}><PieChart><Pie data={porStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {porStatus.map((e, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>
            </div>
            <div className="cols-2">
              <div className="card"><div className="card-h">Próximas parcelas</div>
                <table className="tbl"><thead><tr><th>Ativo</th><th>Nº</th><th>Venc.</th><th>Valor</th></tr></thead>
                  <tbody>{proximas.map((p, i) => <tr key={i}><td>{p.ativoNome}</td><td>{p.numero}</td><td>{dataBR(p.venc)}</td><td>{fmt(p.valor)}</td></tr>)}
                    {proximas.length === 0 && <tr><td colSpan={4} className="muted">Nenhuma parcela em aberto.</td></tr>}</tbody></table></div>
              <div className="card"><div className="card-h">Maiores ativos</div>
                <table className="tbl"><thead><tr><th>Ativo</th><th>Tipo</th><th>Total estimado</th></tr></thead>
                  <tbody>{reais.slice().sort((a, b) => finance(b).totalEstimado - finance(a).totalEstimado).slice(0, 6).map((a) => (
                    <tr key={a.id} className="clk" onClick={() => setAberto(a)}><td>{a.nome}</td><td><Badge tone="gold">{a.tipo}</Badge></td><td>{fmt(finance(a).totalEstimado)}</td></tr>))}</tbody></table></div>
            </div>
          </section>
        )}

        {["animal", "prenhez", "aspiracao"].includes(view) && (
          <section className="wrap">
            {view === "animal" && <label className="toggle"><input type="checkbox" checked={showAncestrais} onChange={(e) => setShowAncestrais(e.target.checked)} /> Mostrar ancestrais cadastrados via genealogia</label>}
            <div className="cards-grid">
              {visiveis.filter((a) => a.tipo === view && (view !== "animal" || showAncestrais || a.origem !== "genealogia")).map((a) => {
                const f = finance(a);
                return (
                  <div className="asset-card" key={a.id} onClick={() => setAberto(a)}>
                    <div className="asset-media">
                      {a.fotoPrincipal ? <img src={a.fotoPrincipal} alt="" onError={(e) => (e.target.style.opacity = 0)} /> : <div className="media-ph small"><span>{view}</span></div>}
                      {a.origem === "genealogia" ? <div className="asset-status"><Badge tone="gold">ancestral</Badge></div> : a.status && <div className="asset-status"><Badge tone={statusTone(a.status)}>{a.status}</Badge></div>}
                    </div>
                    <div className="asset-body"><div className="asset-name serif">{a.nome}</div>
                      <div className="asset-meta">{a.raca || a.doadora || "—"}{a.registro ? ` · ${a.registro}` : ""}</div>
                      <div className="asset-fin"><span>{fmt(f.totalEstimado || f.cota)}</span>{f.aberto > 0 ? <em className="neg">{fmt(f.aberto)} em aberto</em> : <em className="pos">quitado</em>}</div></div>
                  </div>
                );
              })}
              {visiveis.filter((a) => a.tipo === view && (view !== "animal" || showAncestrais || a.origem !== "genealogia")).length === 0 && (
                <div className="empty">Nenhum registro. {soSocio ? "Você não participa de ativos deste tipo." : "Use “+ Novo cadastro”."}</div>
              )}
            </div>
          </section>
        )}

        {view === "socios" && (
          <section className="wrap"><div className="cards-grid wide">
            {db.socios.map((s) => {
              const parts = reais.filter((a) => (a.socios || []).some((x) => x.nome === s.nome));
              return (
                <div className="card socio-card" key={s.id}>
                  <div className="socio-top"><div className="avatar">{s.nome.slice(0, 1)}</div><div><div className="serif socio-name">{s.nome}</div><div className="muted small">{s.doc || "—"}</div></div></div>
                  <div className="socio-lines">
                    <div><span>Telefone</span><b>{s.tel || "—"}</b></div>
                    <div><span>E-mail</span><b>{s.email || "—"}</b></div>
                    <div><span>Ativos em que participa</span><b>{parts.length}</b></div>
                  </div>
                  <div className="socio-parts">{parts.map((a) => { const sc = a.socios.find((x) => x.nome === s.nome); return <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome} · {sc.pct}%</span>; })}</div>
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
                <tbody>{parcelas.slice().sort((a, b) => (a.venc || "").localeCompare(b.venc || "")).map((p, i) => (
                  <tr key={i} className={`clk ${p.status === "vencido" ? "row-late" : ""}`} onClick={() => setAberto(ativos.find((a) => a.id === p.ativoId))}>
                    <td>{p.ativoNome}</td><td>{p.tipo}</td><td>{p.numero}</td><td>{dataBR(p.venc)}</td><td>{fmt(p.valor)}</td><td><Badge tone={statusTone(p.status)}>{p.status}</Badge></td></tr>
                ))}</tbody></table></div></div>
          </section>
        )}

        {view === "leiloes" && (
          <section className="wrap"><div className="cards-grid wide">
            {db.leiloes.map((l) => {
              const comp = reais.filter((a) => (a.leilao || "") === l.nome);
              const tot = comp.reduce((s, a) => s + finance(a).total, 0), pago = comp.reduce((s, a) => s + finance(a).pago, 0);
              return (
                <div className="card" key={l.id}><div className="card-h">{l.nome}</div>
                  <div className="socio-lines"><div><span>Ativos comprados</span><b>{comp.length}</b></div>
                    <div><span>Total comprado</span><b className="gold">{fmt(tot)}</b></div><div><span>Pago</span><b className="pos">{fmt(pago)}</b></div>
                    <div><span>Em aberto</span><b className="neg">{fmt(tot - pago)}</b></div></div>
                  <div className="socio-parts">{comp.map((a) => <span className="tag" key={a.id} onClick={() => setAberto(a)}>{a.nome}</span>)}
                    {comp.length === 0 && <span className="muted small">Sem ativos vinculados ainda.</span>}</div>
                </div>
              );
            })}
          </div></section>
        )}

        {view === "relatorios" && (
          <section className="wrap"><div className="card">
            <div className="card-h">Relatório consolidado <span className="muted">({visiveis.length} registros)</span></div>
            <div className="rep-tools"><button className="btn btn-gold" onClick={exportCSV}>⤓ Exportar Excel/CSV</button><button className="btn btn-ghost" onClick={() => window.print()}>🖨 Imprimir / PDF</button></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Tipo</th><th>Nome</th><th>Status</th><th>Cota</th><th>Total estimado</th><th>Pago</th><th>Em aberto</th></tr></thead>
              <tbody>{visiveis.map((a) => { const f = finance(a); return (
                <tr key={a.id} className="clk" onClick={() => setAberto(a)}><td><Badge tone="gold">{a.tipo}</Badge></td><td>{a.nome}</td><td>{a.status || "—"}</td>
                  <td>{fmt(f.cota)}</td><td>{fmt(f.totalEstimado)}</td><td className="pos">{fmt(f.pago)}</td><td className="neg">{fmt(f.aberto)}</td></tr>); })}</tbody>
              <tfoot><tr><td colSpan={3}><b>Totais</b></td><td><b>{fmt(visiveis.reduce((s, a) => s + finance(a).cota, 0))}</b></td>
                <td><b>{fmt(visiveis.reduce((s, a) => s + finance(a).totalEstimado, 0))}</b></td>
                <td className="pos"><b>{fmt(visiveis.reduce((s, a) => s + finance(a).pago, 0))}</b></td>
                <td className="neg"><b>{fmt(visiveis.reduce((s, a) => s + finance(a).aberto, 0))}</b></td></tr></tfoot>
            </table></div>
          </div></section>
        )}

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
        animalNames={animalNames} leilaoNames={leilaoNames} localNames={localNames} vendedorNames={vendedorNames} socioNames={socioNames}
        onQuickAnimal={quickAnimal} onQuickLeilao={quickLeilao} onQuickLocal={quickLocal} onQuickVendedor={quickVendedor} onQuickSocio={quickSocio}
        onSave={salvar} onClose={() => setForm(null)} />}
      {aberto && <Detalhe a={aberto} ativos={ativos} canDelete={isAdmin} onClose={() => setAberto(null)} onUpdate={updateAtivo}
        onEdit={() => { setForm({ tipo: aberto.tipo, initial: aberto }); setAberto(null); }} onDelete={() => excluir(aberto.id)} />}
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
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

.side{width:250px;min-height:100vh;background:linear-gradient(180deg,var(--forest),var(--forest2));color:#e9e5d6;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
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

.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
.card-h{font-family:Fraunces,serif;font-size:18px;font-weight:600;margin-bottom:14px;color:var(--ink)}
.cols-2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
.cards-grid.wide{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}

.asset-card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;cursor:pointer;transition:.18s}
.asset-card:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(29,58,43,.13);border-color:var(--gold)}
.asset-media{position:relative;aspect-ratio:16/10;background:var(--bege)}.asset-media img{width:100%;height:100%;object-fit:cover}.asset-status{position:absolute;top:10px;left:10px}
.media-ph{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,rgba(198,161,91,.18),transparent 60%),linear-gradient(135deg,#eee6d4,#e3d8bf)}
.media-ph span{font-family:Fraunces,serif;font-size:15px;text-transform:capitalize;color:#9c8a5f;letter-spacing:.1em}.media-ph.small span{font-size:13px}
.asset-body{padding:14px 16px 16px}.asset-name{font-size:16.5px;line-height:1.2;color:var(--ink)}
.asset-meta{font-size:12.5px;color:var(--muted);margin:4px 0 10px}
.asset-fin{display:flex;justify-content:space-between;align-items:baseline;font-family:Fraunces,serif;font-size:16px}.asset-fin em{font-family:Inter;font-size:12px;font-style:normal}
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

.modal-bg{position:fixed;inset:0;background:rgba(20,18,12,.55);backdrop-filter:blur(3px);display:grid;place-items:start center;padding:30px 16px;overflow:auto;z-index:50}
.modal{background:var(--paper);border-radius:20px;width:min(940px,100%);box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--line);background:#fff}
.modal-head h2{margin:0;font-size:20px;font-weight:600}
.x{border:0;background:#f0ead9;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:15px;color:var(--txt)}.x.abs{position:absolute;top:0;right:0}
.modal-body{padding:22px 24px;max-height:calc(100vh - 200px);overflow:auto}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--line);background:#fff}

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
.ficha-hero-media{width:300px;min-height:220px;background:var(--bege);flex-shrink:0}.ficha-hero-media img{width:100%;height:100%;object-fit:cover}
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

.videos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.video{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}
.video-h{display:flex;gap:10px;align-items:center;margin-bottom:8px}.video-obs{font-size:12px;color:var(--muted)}
.video-frame{aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#000}.video-frame iframe{width:100%;height:100%;border:0}

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
.rep-tools{display:flex;gap:10px;margin-bottom:14px}

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

.topbar{display:none;position:sticky;top:0;z-index:40;background:var(--forest);color:#fff;padding:12px 16px;align-items:center;gap:14px}
.burger{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer}.brand-mini{font-size:20px}.scrim{display:none}

/* ===================== Responsivo ===================== */
@media(min-width:1500px){.main{padding:30px 48px 72px;margin:0 auto;max-width:1580px}}
@media(max-width:1200px){.main{padding:24px 24px 60px}}
@media(max-width:1024px){
  .kpi-row,.fin-cards{grid-template-columns:repeat(2,1fr)}
  .cols-2{grid-template-columns:1fr}
  .grid,.info-grid{grid-template-columns:repeat(2,1fr)}
  .head h1{font-size:30px}
}
@media(max-width:860px){
  .topbar{display:flex}
  .side{position:fixed;left:0;top:0;z-index:60;transform:translateX(-100%);transition:.25s;box-shadow:0 0 60px rgba(0,0,0,.4)}
  .side.open{transform:translateX(0)}
  .scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:55}
  .main{padding:16px 16px 56px}.head h1{font-size:27px}
  .ficha .ficha-hero{flex-direction:column}.ficha-hero-media{width:100%;min-height:180px}
  /* toque confortável e sem zoom automático no iOS (fontes >=16px) */
  .field input,.field select,.field textarea,.socio-row input,.socio-row select,.search,.auto input,.mini-inp,.mini-sel{font-size:16px}
  .btn{padding:12px 18px}.btn-mini{padding:9px 12px}
  .nav-item{padding:13px 14px;font-size:15.5px}
  .pstatus{padding:6px 14px;font-size:12.5px}.seg{padding:11px 18px}
}
@media(max-width:560px){
  .main{padding:14px 12px 52px}
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
  .videos-grid{grid-template-columns:1fr}
  .tbl{font-size:13px}.tbl th,.tbl td{padding:8px}
}
@media print{.side,.topbar,.head-tools,.rep-tools,.btn{display:none!important}.main{padding:0}}
`;
