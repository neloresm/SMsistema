import { html, render, useState, useEffect, useMemo, useRef, useCallback } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import * as C from './calc.js';
import { parseCobranca, lerContratos, pdfParaTexto, arquivoParaTexto, ehPlanilha, parseRelatorioMecob, inferirTipo, extrairAnimal } from './parser.js';
import { RELATORIOS, gerarRelatorio, exportarExcel, exportarPDF } from './relatorios.js';
import { baixarPDF, conferenciaExcel, conferenciaPDF, baixarContestacao } from './exportar-repasse.js';
import { compararLote, montarCorrecao } from './comparar.js';

// Modo de teste local: só em localhost e com ?mock na URL (o arquivo de teste não é publicado).
const MOCK = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('mock');
const configured = MOCK || (!SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('COLE_AQUI'));
const sb = MOCK ? await (await import('/dev/mock.js')).createMock()
  : configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const chk = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const parseMoney = (s) => { s = String(s ?? '').trim().replace(/^R\$\s*/, ''); if (!s) return NaN; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return Number(s); };
const moneyInput = (c) => (c / 100).toFixed(2).replace('.', ',');
const Badge = (cls, txt) => html`<span class=${'badge b-' + cls}>${txt}</span>`;
const stBadge = (s) => Badge(s, C.STATUS_LABEL[s] || s);
// ícones iguais aos do SM sistema
const ICONS = { dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', recebimentos: 'M12 3v18M16.5 7.2c-.6-1.4-2.3-2.2-4.5-2.2-2.6 0-4.5 1.3-4.5 3.1 0 4.1 9 2.3 9 6.4 0 1.8-1.9 3.1-4.5 3.1-2.3 0-4.1-.9-4.6-2.4', parcelas: 'M5 2.5v19l2.3-1.5 2.3 1.5 2.4-1.5 2.4 1.5 2.3-1.5 2.3 1.5v-19l-2.3 1.5-2.3-1.5-2.4 1.5-2.4-1.5-2.3 1.5zM9 9h6M9 13h6', pendencias: 'M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01', relatorios: 'M3.5 3.5v17h17M7.5 15.5l4-4.5 3 3 5-6', importar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', usuarios: 'M12 3.5 4.5 6.5v5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5v-5zM9 12l2 2 4-4', menu: 'M4 7h16M4 12h16M4 17h16', voltar: 'M15 18l-6-6 6-6' };
function Ico({ n, size = 18 }) { const d = ICONS[n]; return d ? html`<svg class="ico" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} /></svg>` : null; }
const go = (p) => { location.hash = p; };
const sevLabel = { critico: 'Crítico', atencao: 'Atenção', info: 'Informativo' };
const formas = ['PIX', 'TED', 'Boleto', 'Depósito', 'Dinheiro', 'Encontro de contas', 'Pagamento direto ao vendedor', 'Outro'];
const safeName = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

function useStored(key, init) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem('smr:' + key); return s ? { ...init, ...JSON.parse(s) } : init; } catch { return init; } });
  const set = (nv) => setV((old) => { const val = typeof nv === 'function' ? nv(old) : nv; try { localStorage.setItem('smr:' + key, JSON.stringify(val)); } catch {} return val; });
  return [v, set];
}
function useRoute() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => { const f = () => setH(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#/, '').split('?')[0].split('/').filter(Boolean);
}

async function fetchAll(table, ordem = 'id') {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const data = chk(await sb.from(table).select('*').order(ordem, { ascending: true }).range(from, from + size - 1));
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
async function loadRaw() {
  const t = ['leiloes', 'compradores', 'contratos', 'parcelas', 'pagamentos', 'revisao_itens', 'repasses', 'repasse_linhas', 'config', 'contabilidades', 'fechamentos', 'despesas_leilao'].map((x) => 'rcb_' + x);
  const [leiloes, compradores, contratos, parcelas, pagamentos, revisao, repasses, repasse_linhas, config, contabilidades, fechamentos, despesas_leilao] = await Promise.all(t.map((x) => fetchAll(x, x === 'rcb_config' ? 'chave' : x === 'rcb_fechamentos' ? 'mes' : 'id')));
  return { leiloes, compradores, contratos, parcelas, pagamentos, revisao, repasses, repasse_linhas, config, contabilidades, fechamentos, despesas_leilao };
}
async function uploadAnexo(file, { contrato_id, parcela_id = null, pagamento_id = null, descricao = '' }) {
  const path = `contratos/${contrato_id}/${Date.now()}_${safeName(file.name)}`;
  chk(await sb.storage.from('recebimentos').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }));
  chk(await sb.from('rcb_anexos').insert({ contrato_id, parcela_id, pagamento_id, nome: file.name, storage_path: path, mime: file.type, tamanho: file.size, descricao }));
}
async function abrirAnexo(path) {
  const d = chk(await sb.storage.from('recebimentos').createSignedUrl(path, 300));
  window.open(d.signedUrl, '_blank', 'noopener');
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(false);
  const route = useRoute();

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  // perfil do SM sistema: role 'Administrador' | 'Usuário' + aprovado
  useEffect(() => {
    if (!session) { setProfile(null); setRaw(null); return; }
    sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) setErr(error.message); else setProfile(data || { aprovado: false, email: session.user.email });
    });
  }, [session?.user?.id]);
  const reload = useCallback(async () => { try { setRaw(await loadRaw()); setErr(null); } catch (e) { setErr(e.message); } }, []);
  useEffect(() => { if (profile?.aprovado) reload(); }, [profile?.aprovado]);
  useEffect(() => { setMenu(false); }, [route.join('/')]);

  const model = useMemo(() => (raw ? C.build(raw) : null), [raw]);
  const notify = (msg, type = 'ok') => { setToast({ msg, type, t: Date.now() }); setTimeout(() => setToast((x) => (x && Date.now() - x.t >= 3900 ? null : x)), 4000); };
  const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) notify(okMsg); await reload(); return r ?? true; } catch (e) { notify(e.message || String(e), 'err'); return false; } };

  if (!configured) return html`<${Aviso} titulo="Configuração pendente" texto="O arquivo config.js da área Recebimentos ainda não tem o endereço do banco do SM sistema." />`;
  if (session === undefined) return html`<div class="boot">Carregando…</div>`;
  if (!session) return html`<${Aviso} titulo="Entre pelo SM sistema" texto="A área Recebimentos usa o mesmo login do SM sistema. Entre no sistema e abra Recebimentos pelo menu." botao />`;
  if (!profile) return html`<div class="boot">Carregando perfil…</div>`;
  if (!profile.aprovado) return html`<${Aviso} titulo="Acesso aguardando liberação" texto=${`Sua conta (${profile.email}) ainda não foi aprovada no SM sistema.`} botao />`;

  const isAdmin = profile.role === 'Administrador' && profile.aprovado;
  const ctx = { model, raw, isAdmin, profile, reload, act, notify, session };
  const pend = model ? model.contratos.filter((c) => !c.arquivado && c.revisao_status !== 'aprovado').length : 0;
  const pendRep = model ? C.conferencia(model, C.mesesConferencia(model)[0]).pendencias : 0;
  // mesmo formato do menu do SM sistema: grupos + ícones desenhados
  const navGrupos = [
    ['', [['', 'dashboard', 'Painel']]],
    ['Vendas', [['repasses', 'recebimentos', 'Repasses da Contabilidade', pendRep], ['contratos', 'parcelas', 'Contratos de venda'], ['inadimplencia', 'pendencias', 'Inadimplência']]],
    ['Operação', [['revisao', 'usuarios', 'Central de revisão', pend], ...(isAdmin ? [['atualizar', 'importar', 'Atualizar contratos']] : []), ['relatorios', 'relatorios', 'Exportações']]],
  ];
  const r0 = route[0] || '';
  let page;
  if (!model) page = err ? html`<div class="banner err">Erro ao carregar dados: ${err}</div>` : html`<div class="empty">Carregando dados…</div>`;
  else if (r0 === 'repasses') page = html`<${RepassesPage} ctx=${ctx} mes=${route[1]} />`;
  else if (r0 === 'contrato') page = html`<${ContratoPage} ctx=${ctx} id=${route[1]} />`;
  else if (r0 === 'contratos') page = html`<${ContratosPage} ctx=${ctx} />`;
  else if (r0 === 'inadimplencia') page = html`<${InadPage} ctx=${ctx} />`;
  else if (r0 === 'revisao') page = html`<${RevisaoPage} ctx=${ctx} />`;
  else if (r0 === 'importar' && isAdmin) page = html`<${ImportarPage} ctx=${ctx} />`;
  else if ((r0 === 'comparar' || r0 === 'atualizar') && isAdmin) page = html`<${CompararPage} ctx=${ctx} />`;
  else if (r0 === 'relatorios') page = html`<${RelatoriosPage} ctx=${ctx} />`;
  else page = html`<${Dashboard} ctx=${ctx} />`;

  return html`
    <div class="topbar"><button class="burger" onClick=${() => setMenu(!menu)} aria-label="Abrir menu"><${Ico} n="menu" size=${20} /></button><img class="topbar-logo" src="/brand/sm-logo-260.png" alt="" /><div class="brand-mini">Recebimentos</div></div>
    <div class="shell">
      <aside class=${'side' + (menu ? ' open' : '')}>
        <div class="brand"><img class="side-logo" src="/brand/sm-logo-260.png" alt="SM Agropecuária" /><div class="brand-name">SM Agropecuária</div><div class="brand-sub">Recebimentos</div></div>
        <nav class="nav">
          ${navGrupos.map(([g, itens]) => html`<div class="nav-grp">${g ? html`<div class="nav-grp-t">${g}</div>` : ''}
            ${itens.map(([k, ic, t, b]) => html`<a href=${'#/' + k} class=${'nav-item' + (r0 === k || (k === 'contratos' && r0 === 'contrato') || (k === 'atualizar' && (r0 === 'importar' || r0 === 'comparar')) ? ' on' : '')}><span class="nav-ic"><${Ico} n=${ic} /></span>${t}${b ? html`<span class="nav-count">${b}</span>` : ''}</a>`)}</div>`)}
          <div class="nav-grp"><div class="nav-grp-t">SM sistema</div><a class="nav-item" href="/"><span class="nav-ic"><${Ico} n="voltar" /></span>Voltar ao sistema</a></div>
        </nav>
        <div class="side-foot">
          <div class="user-box"><div class="user-av">${((profile.nome || profile.email || '?').trim()[0] || '?').toUpperCase()}</div><div><div class="user-name">${profile.nome || profile.email}</div><div class="user-role">${profile.role || (isAdmin ? 'Administrador' : 'Usuário')}</div></div></div>
        </div>
      </aside>
      <main class="main">${err && model ? html`<div class="banner err">${err}</div>` : ''}${page}</main>
    </div>
    ${toast ? html`<div class=${'toast ' + (toast.type === 'err' ? 'err' : '')}>${toast.msg}</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Avisos de acesso (o login é o do SM sistema)
// ---------------------------------------------------------------------------
function Brand() { return html`<div class="brand"><div class="brand-mark">SM</div><div class="brand-txt"><b>SM sistema</b><span>Recebimentos</span></div></div>`; }
function Aviso({ titulo, texto, botao }) {
  return html`<div class="login"><div class="box"><${Brand} /><h2>${titulo}</h2><p>${texto}</p>
    ${botao ? html`<a class="btn btn-primary" href="/">Ir para o SM sistema</a>` : ''}</div></div>`;
}
// ---------------------------------------------------------------------------
// Componentes de UI
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return html`<div class="overlay center" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-label=${title}><h2>${title}</h2>${children}</div></div>`;
}
function Kpi({ lbl, val, sub, cls = '' }) { return html`<div class=${'kpi ' + cls}><div class="lbl">${lbl}</div><div class="val num">${val}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>`; }
function Progress({ v }) { return html`<div class="progress" title=${C.pct(v)}><i style=${`width:${Math.min(100, Math.max(0, (v || 0) * 100))}%`}></i></div>`; }
function Seg({ value, onChange, opts }) { return html`<div class="seg">${opts.map(([k, t]) => html`<button class=${value === k ? 'on' : ''} onClick=${() => onChange(k)}>${t}</button>`)}</div>`; }

function BarChart({ series, onPick }) {
  const ref = useRef(); const ch = useRef();
  useEffect(() => {
    if (!window.Chart) return;
    ch.current?.destroy();
    const fut = (a, b) => series.map((s) => (s.futuro ? b : a));
    ch.current = new window.Chart(ref.current, {
      data: {
        labels: series.map((s) => s.label),
        datasets: [
          { type: 'bar', label: 'Bruto previsto', data: series.map((s) => C.toReais(s.previsto)), backgroundColor: fut('#176B46', 'rgba(23,107,70,.28)'), borderRadius: 3, order: 2 },
          { type: 'bar', label: 'Real recebido', data: series.map((s) => C.toReais(s.recebido)), backgroundColor: '#B89A5E', borderRadius: 3, order: 3 },
          { type: 'line', label: 'Diferença (previsto − recebido)', data: series.map((s) => C.toReais(s.diferenca)), borderColor: '#C2412D', backgroundColor: '#C2412D', pointRadius: 2.5, borderWidth: 2, tension: 0.25, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onClick: (e) => { const els = ch.current.getElementsAtEventForMode(e, 'index', { intersect: false }, true); if (els.length) onPick(series[els[0].index].key); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => C.brlCompact(v) }, grid: { color: 'rgba(28,40,33,.08)' } } },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${C.brl(Math.round(c.raw * 100))}`, footer: () => 'Clique para detalhar' } },
        },
      },
    });
    return () => ch.current?.destroy();
  }, [series]);
  return html`<div class="chart-box"><canvas ref=${ref}></canvas></div>`;
}

function FiltroBase({ model, f, setF, campos = ['leilao', 'comprador', 'contrato', 'periodo', 'base'] }) {
  const leiloes = [...model.leiloes].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const compradores = [...model.compradores].sort((a, b) => a.nome.localeCompare(b.nome));
  const contratos = model.contratos.filter((c) => (!f.leilao || String(c.leilao_id) === String(f.leilao)) && (!f.comprador || String(c.comprador_id) === String(f.comprador)));
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  return html`<div class="filters">
    ${campos.includes('leilao') && html`<label class="f">Leilão<select value=${f.leilao} onChange=${s('leilao')}><option value="">Todos</option>${leiloes.map((l) => html`<option value=${l.id}>${l.nome} · ${C.fmtD(l.data)}</option>`)}</select></label>`}
    ${campos.includes('comprador') && html`<label class="f">Comprador<select value=${f.comprador} onChange=${s('comprador')}><option value="">Todos</option>${compradores.map((c) => html`<option value=${c.id}>${c.nome}</option>`)}</select></label>`}
    ${campos.includes('contrato') && html`<label class="f">Contrato<select value=${f.contrato} onChange=${s('contrato')}><option value="">Todos</option>${contratos.map((c) => html`<option value=${c.id}>${c.id} · ${c.comprador.nome.slice(0, 28)}</option>`)}</select></label>`}
    ${campos.includes('periodo') && html`<label class="f" style="max-width:150px">De (mês)<input type="month" value=${f.de} onInput=${s('de')} /></label>
      <label class="f" style="max-width:150px">Até (mês)<input type="month" value=${f.ate} onInput=${s('ate')} /></label>`}
    ${campos.includes('base') && html`<label class="f" style="max-width:200px">Base<select value=${f.base} onChange=${s('base')}><option value="todos">Todos os contratos ativos</option><option value="aprovados">Somente revisados/aprovados</option></select></label>`}
    <button class="btn-ghost btn-sm" onClick=${() => setF((o) => ({ ...o, leilao: '', comprador: '', contrato: '', de: '', ate: '' }))}>Limpar</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ ctx }) {
  const { model } = ctx;
  const [f, setF] = useStored('dash', { modo: 'contratual', gran: 'mes', leilao: '', comprador: '', contrato: '', de: '', ate: '', base: 'todos' });
  const [pick, setPick] = useState(null);
  const contratos = useMemo(() => C.filtrarContratos(model, f), [model, f.base, f.leilao, f.comprador, f.contrato]);
  const k = useMemo(() => C.kpis(model, contratos), [model, contratos]);
  const ser = useMemo(() => C.serie(model, contratos, f.modo, f.gran, f), [model, contratos, f.modo, f.gran, f.de, f.ate]);
  const pend = contratos.filter((c) => c.revisao_status !== 'aprovado').length;
  const tot = ser.reduce((a, s) => ({ p: a.p + s.previsto, r: a.r + s.recebido }), { p: 0, r: 0 });

  return html`
    <div class="page-head"><div><h1>Painel financeiro</h1><p>Posição em ${C.fmtD(model.hoje)} · ${contratos.length} contratos na base selecionada</p></div>
      <div class="stack"><${Seg} value=${f.modo} onChange=${(v) => setF((o) => ({ ...o, modo: v }))} opts=${[['contratual', 'Por vencimento'], ['caixa', 'Pago pelos compradores']]} />
      <${Seg} value=${f.gran} onChange=${(v) => setF((o) => ({ ...o, gran: v }))} opts=${[['mes', 'Mensal'], ['trimestre', 'Trimestral'], ['ano', 'Anual']]} /></div></div>
    ${pend > 0 && f.base === 'todos' ? html`<div class="banner warn"><span><b>${pend} contrato(s)</b> com pendências na central de revisão estão incluídos nestes números. <a href="#/revisao">Revisar</a> ou altere a base para “Somente revisados”.</span></div>` : ''}
    <${CardRepasse} ctx=${ctx} />
    <div class="card" style="margin-bottom:16px"><${FiltroBase} model=${model} f=${f} setF=${setF} /></div>
    <div class="grid kpis">
      <${Kpi} cls="accent" lbl="Total vendido" val=${C.brl(k.vendido)} sub=${`${k.contratos} contratos`} />
      <${Kpi} cls="accent" lbl="Previsto até hoje" val=${C.brl(k.prevAteHoje)} sub="Parcelas com vencimento até hoje" />
      <${Kpi} cls="gold" lbl="Efetivamente recebido" val=${C.brl(k.recebido)} sub="Pagamentos registrados" />
      <${Kpi} cls="red" lbl="Saldo vencido" val=${C.brl(k.vencido)} sub="Vencido e não recebido" />
      <${Kpi} cls="gray" lbl="Saldo futuro" val=${C.brl(k.futuro)} sub="A vencer (inclui hoje)" />
      <${Kpi} cls="gold" lbl="Taxa de recebimento" val=${C.pct(k.taxa)} sub="Recebido ÷ previsto já vencido" />
      <${Kpi} cls="accent" lbl="Contratos ativos" val=${k.ativos} sub="Com saldo a receber" />
      <${Kpi} cls="red" lbl="Compradores inadimplentes" val=${k.inad} sub=${html`<a href="#/inadimplencia">ver detalhes</a>`} />
    </div>
    ${k.fora !== 0 ? html`<div class="banner info" style="margin-top:14px"><span><b>${C.brl(k.fora)}</b> do valor contratado não está no cronograma de parcelas: são entradas/parcelas que o sistema de cobrança mostra como “liquidadas no cadastro” ou pagas direto ao vendedor, <b>sem valor e data registrados</b> (${k.parcelasExternas} parcelas). Esses valores não entram como recebidos até serem comprovados.</span></div>` : ''}
    <div class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>${f.modo === 'contratual' ? 'Previsto × recebido por vencimento' : 'Previsto × pago pelos compradores'}</h2>
        <div class="small muted">${f.modo === 'contratual' ? 'Cada parcela fica no período do seu vencimento; “recebido” é quanto já foi pago dessas parcelas, mesmo que depois.' : '“Recebido” é o que os compradores pagaram no período, pela data do pagamento. O que caiu na conta da SM está em Repasses da Contabilidade.'}</div></div>
        <div class="small muted">Barras claras = períodos futuros</div></div>
      ${ser.length ? html`<${BarChart} series=${ser} onPick=${setPick} />` : html`<div class="empty">Sem dados para o filtro.</div>`}
    </div>
    <div class="card"><div class="card-head"><h2>Resumo por período</h2><span class="small muted">Clique em uma linha para detalhar</span></div>
      <div class="tbl-wrap" style="max-height:420px"><table>
        <thead><tr><th>Período</th><th class="num">Bruto previsto</th><th class="num">Real recebido</th><th class="num">Diferença</th><th class="num">% recebido</th></tr></thead>
        <tbody>${ser.map((s) => html`<tr class="click" onClick=${() => setPick(s.key)}><td>${C.bucketLongLabel(s.key)}${s.atual ? html` ${Badge('info', 'atual')}` : ''}</td>
          <td class="num">${C.brl(s.previsto)}</td><td class="num">${C.brl(s.recebido)}</td><td class="num" style=${s.diferenca > 0 && !s.futuro ? 'color:var(--red)' : ''}>${C.brl(s.diferenca)}</td><td class="num">${s.previsto ? C.pct(s.recebido / s.previsto) : '—'}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${C.brl(tot.p)}</td><td class="num">${C.brl(tot.r)}</td><td class="num">${C.brl(tot.p - tot.r)}</td><td class="num">${tot.p ? C.pct(tot.r / tot.p) : '—'}</td></tr></tfoot>
      </table></div></div>
    ${pick ? html`<${PeriodoDetalhe} ctx=${ctx} contratos=${contratos} modo=${f.modo} gran=${f.gran} k=${pick} onClose=${() => setPick(null)} />` : ''}`;
}

function PeriodoDetalhe({ ctx, contratos, modo, gran, k, onClose }) {
  const { rows, pagRows, s } = useMemo(() => C.detalheBucket(ctx.model, contratos, modo, gran, k), [ctx.model, contratos, modo, gran, k]);
  const [aba, setAba] = useState(modo === 'caixa' ? 'caixa' : 'parcelas');
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}><div class="drawer">
    <div class="page-head"><div><h1>${C.bucketLongLabel(k)}</h1><p>${modo === 'contratual' ? 'Regime contratual (por vencimento)' : 'Fluxo de caixa (por data de pagamento)'}</p></div><button onClick=${onClose}>Fechar</button></div>
    <div class="grid kpis">
      <${Kpi} cls="accent" lbl="Bruto previsto" val=${C.brl(s.previsto)} sub=${`${s.qPrev} parcelas com vencimento no período`} />
      <${Kpi} cls="gold" lbl=${modo === 'caixa' ? 'Entrou no caixa' : 'Recebido destas parcelas'} val=${C.brl(s.recebido)} sub=${modo === 'caixa' ? `${pagRows.length} pagamentos no período` : `${s.qPagas} parcelas pagas`} />
      <${Kpi} cls="gray" lbl="Total pendente" val=${C.brl(s.pendente)} sub="Saldo das parcelas do período" />
      <${Kpi} cls="red" lbl="Vencido e não pago" val=${C.brl(s.vencidoNaoPago)} />
      <${Kpi} lbl="Parcelas previstas" val=${s.qPrev} sub=${s.qExternas ? `${s.qExternas} liquidadas fora (sem valor)` : ''} />
      <${Kpi} lbl="Parcelas pagas" val=${s.qPagas} />
      <${Kpi} cls="gold" lbl="% de recebimento" val=${C.pct(s.taxa)} />
      ${modo === 'contratual' ? html`<${Kpi} lbl="Entrou no caixa no período" val=${C.brl(s.caixa)} sub="Por data real de pagamento" />` : html`<${Kpi} lbl="Recebido das parcelas do período" val=${C.brl(s.recebidoDasParcelas)} />`}
    </div>
    <div class="pill-tabs" style="margin-top:16px"><button class=${aba === 'parcelas' ? 'on' : ''} onClick=${() => setAba('parcelas')}>Parcelas com vencimento no período (${rows.length})</button>
      <button class=${aba === 'caixa' ? 'on' : ''} onClick=${() => setAba('caixa')}>Pagamentos recebidos no período (${pagRows.length})</button></div>
    ${aba === 'parcelas' ? html`<div class="tbl-wrap"><table><thead><tr><th>Comprador</th><th>Leilão</th><th>Lote</th><th>Parcela</th><th>Vencimento</th><th class="num">Previsto</th><th class="num">Recebido</th><th>Status</th></tr></thead>
      <tbody>${rows.map((p) => html`<tr class="click" onClick=${() => { onClose(); go('#/contrato/' + p.contrato_id); }}>
        <td>${p.contrato.comprador.nome}<div class="small muted">Contrato ${p.contrato_id}</div></td><td class="small">${p.contrato.leilao.nome}</td><td>${p.contrato.lote || '—'}</td>
        <td class="num">${p.numero}/${p.contrato.nParc}</td><td class="num">${C.fmtD(p.vencimento)}</td><td class="num">${C.brl(p.prev)}</td><td class="num">${C.brl(p.rec)}</td><td>${stBadge(p.status)}${p.dias ? html`<div class="small muted">${p.dias} dias</div>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<div class="tbl-wrap"><table><thead><tr><th>Data pgto.</th><th>Comprador</th><th>Leilão</th><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Forma</th></tr></thead>
      <tbody>${pagRows.length ? pagRows.map((g) => html`<tr class="click" onClick=${() => { onClose(); go('#/contrato/' + g.contrato.id); }}>
        <td class="num">${C.fmtD(g.data_pagamento)}</td><td>${g.contrato.comprador.nome}<div class="small muted">Contrato ${g.contrato.id}</div></td><td class="small">${g.contrato.leilao.nome}</td>
        <td class="num">${g.parcela.numero}/${g.contrato.nParc}</td><td class="num">${C.fmtD(g.parcela.vencimento)}</td><td class="num">${C.brl(g.valorC)}</td><td class="small">${g.forma || (g.origem === 'importacao' ? 'Importado' : '—')}</td></tr>`) : html`<tr><td colspan="7" class="empty">Nenhum pagamento registrado no período.</td></tr>`}</tbody></table></div>`}
  </div></div>`;
}

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
function ContratosPage({ ctx }) {
  const { model } = ctx;
  const [f, setF] = useStored('ctr', { q: '', leilao: '', ano: '', animal: '', situacao: '', revisao: '' });
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const anos = [...new Set(model.contratos.map((c) => c.ano).filter(Boolean))].sort().reverse();
  const animais = [...new Set(model.contratos.map((c) => c.animal).filter(Boolean))].sort();
  const lista = model.contratos.filter((c) => {
    const q = f.q.trim().toLowerCase();
    if (q && !(`${c.id} ${c.comprador.nome} ${c.comprador.documento || ''} ${c.descricao}`.toLowerCase().includes(q))) return false;
    if (f.leilao && String(c.leilao_id) !== f.leilao) return false;
    if (f.ano && c.ano !== f.ano) return false;
    if (f.animal && c.animal !== f.animal) return false;
    if (f.situacao ? c.situacao !== f.situacao : c.arquivado) return false;
    if (f.revisao && c.revisao_status !== f.revisao) return false;
    return true;
  }).sort((a, b) => b.id - a.id);
  const tot = lista.reduce((a, c) => ({ v: a.v + c.valorC, r: a.r + c.recC, ve: a.ve + c.saldoVencido, fu: a.fu + c.saldoFuturo }), { v: 0, r: 0, ve: 0, fu: 0 });
  return html`
    <div class="page-head"><div><h1>Contratos</h1><p>${lista.length} contrato(s) no filtro</p></div>${ctx.isAdmin ? html`<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#/comparar">Comparar contratos</a><a class="btn btn-primary" href="#/importar">Importar novos contratos</a></div>` : ''}</div>
    <div class="card" style="margin-bottom:16px"><div class="filters">
      <label class="f">Busca (comprador, CPF/CNPJ, nº, descrição)<input value=${f.q} onInput=${s('q')} placeholder="Digite para filtrar" /></label>
      <label class="f">Leilão<select value=${f.leilao} onChange=${s('leilao')}><option value="">Todos</option>${[...model.leiloes].sort((a, b) => (b.data || '').localeCompare(a.data || '')).map((l) => html`<option value=${l.id}>${l.nome} · ${C.fmtD(l.data)}</option>`)}</select></label>
      <label class="f" style="max-width:110px">Ano<select value=${f.ano} onChange=${s('ano')}><option value="">Todos</option>${anos.map((a) => html`<option>${a}</option>`)}</select></label>
      <label class="f">Animal / genética<select value=${f.animal} onChange=${s('animal')}><option value="">Todos</option>${animais.map((a) => html`<option>${a}</option>`)}</select></label>
      <label class="f" style="max-width:170px">Situação financeira<select value=${f.situacao} onChange=${s('situacao')}><option value="">Ativos (todos)</option><option value="em_dia">Em dia</option><option value="atraso">Com atraso</option><option value="quitado">Quitados</option><option value="arquivado">Arquivados</option></select></label>
      <label class="f" style="max-width:150px">Revisão<select value=${f.revisao} onChange=${s('revisao')}><option value="">Todas</option><option value="pendente">Pendente</option><option value="aprovado">Aprovado</option></select></label>
    </div></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Contrato</th><th>Comprador</th><th>Leilão</th><th>Lote</th><th>Animal / objeto</th><th class="num">Valor</th><th class="num">Recebido</th><th class="num">Vencido</th><th class="num">A vencer</th><th>Pagas</th><th>Situação</th><th>Revisão</th></tr></thead>
      <tbody>${lista.map((c) => html`<tr class="click" onClick=${() => go('#/contrato/' + c.id)}>
        <td class="num"><b>${c.id}</b><div class="small muted">${C.fmtD(c.data_contrato)}</div></td>
        <td>${c.comprador.nome}<div class="small muted">${C.fmtDoc(c.comprador.documento)}</div></td>
        <td class="small">${c.leilao.nome}<div class="muted">${C.fmtD(c.leilao.data)}</div></td><td>${c.lote || '—'}</td>
        <td class="small">${c.animal || c.descricao}<div class="muted">${C.TIPO_LABEL[c.tipo_venda]}${c.percentual ? ` · ${Number(c.percentual).toLocaleString('pt-BR')}%` : ''}</div></td>
        <td class="num">${C.brl(c.valorC)}</td><td class="num">${C.brl(c.recC)}</td><td class="num" style=${c.saldoVencido ? 'color:var(--red);font-weight:600' : ''}>${C.brl(c.saldoVencido)}</td><td class="num">${C.brl(c.saldoFuturo)}</td>
        <td><span class="small num">${c.qPagas}/${c.nParc}</span><${Progress} v=${c.nParc ? c.qPagas / c.nParc : 0} /></td>
        <td>${Badge(c.situacao, C.SITUACAO_LABEL[c.situacao])}</td><td>${Badge(c.revisao_status, c.revisao_status === 'aprovado' ? 'Aprovado' : 'Pendente')}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total</td><td class="num">${C.brl(tot.v)}</td><td class="num">${C.brl(tot.r)}</td><td class="num">${C.brl(tot.ve)}</td><td class="num">${C.brl(tot.fu)}</td><td colspan="3"></td></tr></tfoot>
    </table></div>`;
}

function ContratoPage({ ctx, id }) {
  const { model, isAdmin, act } = ctx;
  const c = model.cmap.get(Number(id));
  const [modal, setModal] = useState(null);
  const [anexos, setAnexos] = useState([]);
  const [hist, setHist] = useState(null);
  const [aberta, setAberta] = useState(null);
  const loadExtras = useCallback(async () => {
    if (!c) return;
    setAnexos(chk(await sb.from('rcb_anexos').select('*').eq('contrato_id', c.id).order('created_at', { ascending: false })));
  }, [c?.id]);
  useEffect(() => { loadExtras(); setHist(null); }, [c?.id, model]);
  if (!c) return html`<div class="empty">Contrato ${id} não encontrado. <a href="#/contratos">Voltar</a></div>`;

  const carregarHist = async () => {
    const pids = c.parcelas.map((p) => p.id); const gids = c.parcelas.flatMap((p) => p.pags.map((g) => g.id));
    const parts = [`and(tabela.eq.contratos,registro_id.eq.${c.id})`];
    if (pids.length) parts.push(`and(tabela.eq.parcelas,registro_id.in.(${pids.join(',')}))`);
    if (gids.length) parts.push(`and(tabela.eq.pagamentos,registro_id.in.(${gids.join(',')}))`);
    setHist(chk(await sb.from('rcb_audit_log').select('*').or(parts.join(',')).order('em', { ascending: false }).limit(300)));
  };
  const oc = c.ultima_ocorrencia;
  const close = () => setModal(null);
  const taxa = c.prevC ? c.recC / c.prevC : 0;
  const pagos = c.parcelas.flatMap((p) => p.pags.map((g) => ({ ...g, parcela: p }))).sort((a, b) => (a.data_pagamento < b.data_pagamento ? -1 : 1));

  return html`
    <div class="page-head"><div><a href="#/contratos" class="small">← Contratos</a><h1>Contrato ${c.id} · ${c.comprador.nome}</h1>
      <p>${c.descricao}</p><div class="stack" style="margin-top:6px">${Badge(c.situacao, C.SITUACAO_LABEL[c.situacao])} ${Badge(c.revisao_status, c.revisao_status === 'aprovado' ? 'Revisão aprovada' : 'Revisão pendente')} ${c.arquivado ? Badge('arquivado', 'Arquivado: ' + (c.arquivado_motivo || '')) : ''}</div></div>
      ${isAdmin ? html`<div class="stack no-print"><button onClick=${() => setModal({ t: 'editar' })}>Editar dados</button><button onClick=${() => setModal({ t: 'parcelas' })}>Editar parcelas</button>
        <button onClick=${() => act(() => sb.rpc('rcb_conferir_contrato', { p_id: c.id }).then(chk), 'Conferência refeita')}>Reconferir</button>
        ${c.arquivado ? html`<button onClick=${() => confirm('Reativar este contrato nos indicadores?') && act(() => sb.from('rcb_contratos').update({ arquivado: false, arquivado_motivo: null }).eq('id', c.id).then(chk), 'Contrato reativado')}>Reativar</button>` : html`<button class="btn-danger" onClick=${() => setModal({ t: 'arquivar' })}>Arquivar</button>`}</div>` : ''}
    </div>
    <div class="grid kpis">
      <${Kpi} cls="accent" lbl="Valor contratado" val=${C.brl(c.valorC)} sub=${c.participacao_sm_pct ? `Parte SM (${Number(c.participacao_sm_pct).toLocaleString('pt-BR')}%): ${C.brl(Math.round(c.valorC * c.participacao_sm_pct / 100))}` : 'Participação SM: não informada'} />
      <${Kpi} cls="accent" lbl="Soma das parcelas" val=${C.brl(c.prevC)} sub=${c.foraC ? `${C.brl(c.foraC)} fora do cronograma (sem valor registrado)` : 'Confere com o contrato'} />
      <${Kpi} cls="gold" lbl="Recebido" val=${C.brl(c.recC)} sub=${`${C.pct(taxa)} das parcelas · ${c.qPagas}/${c.nParc} quitadas`} />
      <${Kpi} cls=${c.saldoVencido ? 'red' : 'gray'} lbl="Saldo vencido / a vencer" val=${C.brl(c.saldoVencido)} sub=${`A vencer: ${C.brl(c.saldoFuturo)}${c.maxDias ? ` · maior atraso ${c.maxDias} dias` : ''}`} />
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h2 style="margin-bottom:10px">Negociação</h2><dl class="dl">
        <dt>Leilão</dt><dd>${c.leilao.nome} · ${C.fmtD(c.leilao.data)}${c.leilao.local ? ' · ' + c.leilao.local : ''}</dd>
        <dt>Data do contrato</dt><dd>${C.fmtD(c.data_contrato)}</dd><dt>Lote</dt><dd>${c.lote || '—'}</dd>
        <dt>Animal / genética</dt><dd>${c.animal || '—'}${c.acasalamento ? ` × ${c.acasalamento}` : ''}</dd>
        <dt>Tipo de venda</dt><dd>${C.TIPO_LABEL[c.tipo_venda]}</dd><dt>% comercializado</dt><dd>${c.percentual ? Number(c.percentual).toLocaleString('pt-BR') + '%' : '—'}</dd>
        <dt>Parcelamento</dt><dd>${c.nParc} parcelas · 1º venc. ${C.fmtD(c.parcelas[0]?.vencimento)} · último ${C.fmtD(c.parcelas.reduce((m, p) => (p.vencimento > m ? p.vencimento : m), ''))}</dd>
        <dt>Vendedor</dt><dd>${c.vendedor || '—'}</dd><dt>Assinatura</dt><dd>${{ assinado: 'Contrato assinado', sem_assinatura: 'Sem assinatura', nao_informado: 'Não informado' }[c.assinatura]}</dd>
        <dt>Condições</dt><dd>${c.condicoes || '—'}</dd><dt>Observações</dt><dd>${c.obs || '—'}</dd>
        <dt>Origem</dt><dd class="small">${c.fonte}${c.pagto_origem ? ` · pagto. na origem ${c.pagto_origem}` : ''}</dd>
      </dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Comprador</h2><dl class="dl">
        <dt>Nome</dt><dd>${c.comprador.nome}</dd><dt>CPF/CNPJ</dt><dd>${C.fmtDoc(c.comprador.documento)}</dd>
        <dt>E-mail</dt><dd>${c.comprador.email || '—'}</dd><dt>Telefone</dt><dd>${c.comprador.telefone || '—'}</dd>
        <dt>Outros contratos</dt><dd>${model.contratos.filter((x) => x.comprador_id === c.comprador_id && x.id !== c.id).map((x) => html`<a href=${'#/contrato/' + x.id}>${x.id}</a> `) || '—'}</dd>
      </dl>
      ${oc ? html`<div class="sep"></div><h3>Última ocorrência na cobrança</h3><p class="small" style="margin:6px 0 0"><b>${oc.titulo || oc.categoria}</b> · ${oc.data_hora}<br />${oc.texto}</p>` : ''}
      ${c.documentos_origem?.length ? html`<div class="sep"></div><h3>Documentos no sistema de origem</h3><p class="small muted">${c.documentos_origem.join(' · ')}</p>` : ''}</div>
    </div>
    ${c.revisao.length ? html`<div class="card"><div class="card-head"><h2>Revisão</h2><a href="#/revisao">Central de revisão</a></div>
      <${ItensRevisao} ctx=${ctx} c=${c} /></div>` : ''}
    ${(() => { const ds = (model.despesasLeilao || []).filter((d) => d.leilao_id === c.leilao_id); return ds.length ? html`<div class="card"><div class="card-head"><h2>Despesas do leilão</h2><span class="small muted">${c.leilao.nome} · fora do repasse da contabilidade</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Despesa</th><th>Lote</th><th>Contrato</th><th class="num">Valor</th><th>Origem</th></tr></thead><tbody>
        ${ds.map((d) => html`<tr class=${d.contrato_id === c.id ? 'hl' : ''}><td>${d.descricao}${d.percentual ? ` (${Number(d.percentual).toLocaleString('pt-BR')}%)` : ''}</td><td>${d.lote || 'geral'}</td><td>${d.contrato_id ? (d.contrato_id === c.id ? html`<b>este</b>` : html`<a href=${'#/contrato/' + d.contrato_id}>${d.contrato_id}</a>`) : '—'}</td><td class="num">${C.brl(C.cents(d.valor))}</td><td class="small muted">${d.arquivo_nome || '—'}</td></tr>`)}
        <tr><td colspan="3"><b>Total do leilão</b></td><td class="num"><b>${C.brl(ds.reduce((s, d) => s + C.cents(d.valor), 0))}</b></td><td></td></tr></tbody></table></div></div>` : ''; })()}
    <div class="card"><div class="card-head"><h2>Linha do tempo das parcelas</h2><div class="legend-note">
      <span><i class="dot" style="background:var(--em-600)"></i>Paga</span><span><i class="dot" style="background:var(--gold)"></i>Liquidada fora (sem valor)</span><span><i class="dot" style="background:var(--amber)"></i>Parcial</span><span><i class="dot" style="background:var(--red)"></i>Atrasada</span><span><i class="dot" style="background:#cfd8d4"></i>A vencer</span></div></div>
      <div class="timeline">${[...c.parcelas].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1)).map((p) => html`<div class=${'tl ' + p.status} title=${`${p.numero}ª · venc. ${C.fmtD(p.vencimento)} · ${C.brl(p.prev)} · ${C.STATUS_LABEL[p.status]}`}></div>`)}</div>
      <div class="small muted">Ordenado por vencimento. ${pagos.filter((g) => !g.estornado).length} pagamento(s) registrado(s); último em ${C.fmtD(pagos.filter((g) => !g.estornado).slice(-1)[0]?.data_pagamento)}.</div></div>
    <div class="card"><div class="card-head"><h2>Parcelas</h2><span class="small muted">Clique em uma parcela para ver os lançamentos</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Previsto</th><th class="num">Recebido</th><th class="num">Saldo</th><th>Data pgto.</th><th>Status</th><th class="no-print"></th></tr></thead>
      <tbody>${c.parcelas.map((p) => html`
        <tr class="click" onClick=${() => setAberta(aberta === p.id ? null : p.id)}>
          <td class="num">${p.numero}/${c.nParc}</td><td class="num">${C.fmtD(p.vencimento)}</td><td class="num">${C.brl(p.prev)}</td><td class="num">${C.brl(p.rec)}</td><td class="num">${C.brl(p.saldo)}</td>
          <td class="num small">${p.ativos.map((g) => C.fmtD(g.data_pagamento)).join(', ') || (p.data_liquidacao_externa ? C.fmtD(p.data_liquidacao_externa) + ' (origem)' : '—')}</td>
          <td>${p.elegivel ? stBadge(p.status) : Badge('cancelada', C.TIPO_PARCELA_LABEL[p.tipo])}${p.dias ? html` <span class="small muted">${p.dias}d</span>` : ''}</td>
          <td class="no-print right">${isAdmin && !p.cancelada ? html`<button class="btn-sm btn-primary" onClick=${(e) => { e.stopPropagation(); setModal({ t: 'pagar', p }); }}>Registrar pagamento</button>` : ''}</td></tr>
        ${aberta === p.id ? html`<tr><td colspan="8" style="background:#fafbfa">
          <div class="small"><b>Situação na origem:</b> ${p.status_origem || '—'}${p.obs ? html` · <b>Obs.:</b> ${p.obs}` : ''}${p.cancelada ? html` · <b>Cancelada:</b> ${p.cancelada_motivo}` : ''}</div>
          ${p.pags.length ? html`<table style="margin-top:8px"><thead><tr><th>#</th><th>Data</th><th class="num">Valor</th><th>Forma</th><th>Origem</th><th>Obs.</th><th>Situação</th><th></th></tr></thead><tbody>
            ${p.pags.map((g) => html`<tr><td>${g.id}</td><td class="num">${C.fmtD(g.data_pagamento)}</td><td class="num">${C.brl(g.valorC)}</td><td>${g.forma || '—'}</td><td>${g.origem === 'importacao' ? 'Importado' : 'Manual'}</td><td class="small">${g.obs || ''}</td>
              <td>${g.estornado ? Badge('cancelada', 'Estornado') : Badge('ok', 'Válido')}${g.estornado ? html`<div class="small muted">${g.estorno_motivo}</div>` : ''}</td>
              <td class="right">${isAdmin && !g.estornado ? html`<button class="btn-sm" onClick=${() => setModal({ t: 'corrigir', g, p })}>Corrigir</button> <button class="btn-sm btn-danger" onClick=${() => setModal({ t: 'estornar', g })}>Estornar</button>` : ''}</td></tr>`)}
          </tbody></table>` : html`<div class="small muted" style="margin-top:6px">Nenhum lançamento.</div>`}</td></tr>` : ''}`)}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${C.brl(c.prevC)}</td><td class="num">${C.brl(c.recC)}</td><td class="num">${C.brl(c.saldoVencido + c.saldoFuturo)}</td><td colspan="3"></td></tr></tfoot></table></div></div>
    <div class="card"><div class="card-head"><h2>Documentos e comprovantes</h2>${isAdmin ? html`<label class="btn btn-sm">Anexar arquivo<input type="file" hidden onChange=${async (e) => { const f = e.target.files[0]; if (!f) return; await act(() => uploadAnexo(f, { contrato_id: c.id }), 'Arquivo anexado'); loadExtras(); }} /></label>` : ''}</div>
      ${anexos.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Arquivo</th><th>Vínculo</th><th>Enviado em</th><th></th></tr></thead><tbody>${anexos.map((a) => html`<tr><td>${a.nome}<div class="small muted">${a.descricao || ''}</div></td>
        <td class="small">${a.pagamento_id ? 'Pagamento #' + a.pagamento_id : a.parcela_id ? 'Parcela' : 'Contrato'}</td><td class="small">${new Date(a.created_at).toLocaleString('pt-BR', { timeZone: C.TZ })}</td>
        <td class="right"><button class="btn-sm" onClick=${() => abrirAnexo(a.storage_path).catch((e) => ctx.notify(e.message, 'err'))}>Abrir</button></td></tr>`)}</tbody></table></div>` : html`<div class="small muted">Nenhum documento anexado nesta plataforma.</div>`}</div>
    <div class="card"><div class="card-head"><h2>Histórico de alterações</h2>${hist ? '' : html`<button class="btn-sm" onClick=${() => carregarHist().catch((e) => ctx.notify(e.message, 'err'))}>Carregar histórico</button>`}</div>
      ${hist ? html`<${Historico} rows=${hist} />` : html`<div class="small muted">Todas as alterações de contrato, parcelas e pagamentos ficam registradas com usuário e horário.</div>`}</div>
    ${modal?.t === 'pagar' ? html`<${PagamentoModal} ctx=${ctx} c=${c} p=${modal.p} onClose=${close} />` : ''}
    ${modal?.t === 'estornar' ? html`<${EstornoModal} ctx=${ctx} g=${modal.g} onClose=${close} />` : ''}
    ${modal?.t === 'corrigir' ? html`<${CorrigirModal} ctx=${ctx} g=${modal.g} onClose=${close} />` : ''}
    ${modal?.t === 'editar' ? html`<${EditarContratoModal} ctx=${ctx} c=${c} onClose=${close} />` : ''}
    ${modal?.t === 'parcelas' ? html`<${EditarParcelasModal} ctx=${ctx} c=${c} onClose=${close} />` : ''}
    ${modal?.t === 'arquivar' ? html`<${ArquivarModal} ctx=${ctx} c=${c} onClose=${close} />` : ''}`;
}

function Historico({ rows }) {
  if (!rows.length) return html`<div class="small muted">Sem registros.</div>`;
  const ign = new Set(['updated_at', 'created_at']);
  const resumo = (r) => {
    if (r.acao === 'INSERT') return 'Criado';
    if (r.acao === 'DELETE') return 'Excluído';
    const a = r.antes || {}, d = r.depois || {};
    return Object.keys(d).filter((k) => !ign.has(k) && JSON.stringify(a[k]) !== JSON.stringify(d[k])).map((k) => `${k}: ${JSON.stringify(a[k]) ?? '—'} → ${JSON.stringify(d[k])}`).join('; ') || 'Sem mudança relevante';
  };
  return html`<div class="tbl-wrap" style="max-height:360px"><table><thead><tr><th>Quando</th><th>Quem</th><th>Registro</th><th>Alteração</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td class="small num">${new Date(r.em).toLocaleString('pt-BR', { timeZone: C.TZ })}</td><td class="small">${r.usuario_email || 'Sistema / importação'}</td><td class="small">${r.tabela} #${r.registro_id}</td><td class="small" style="max-width:520px;overflow-wrap:anywhere">${resumo(r)}</td></tr>`)}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Modais de pagamento e edição
// ---------------------------------------------------------------------------
function PagamentoModal({ ctx, c, p, onClose }) {
  const [f, setF] = useState({ data: ctx.model.hoje, valor: moneyInput(p.saldo || p.prev), forma: 'PIX', obs: '' });
  const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const salvar = async () => {
    const v = parseMoney(f.valor);
    if (!(v > 0)) return setMsg('Informe um valor maior que zero.');
    if (!f.data) return setMsg('Informe a data real do pagamento.');
    if (f.data > ctx.model.hoje) return setMsg('A data do pagamento não pode ser futura.');
    const vc = Math.round(v * 100);
    if (vc > p.saldo && !confirm(`O valor (${C.brl(vc)}) é maior que o saldo da parcela (${C.brl(p.saldo)}). Confirmar mesmo assim (ex.: juros/multa)?`)) return;
    setBusy(true);
    const ok = await ctx.act(async () => {
      const g = chk(await sb.from('rcb_pagamentos').insert({ parcela_id: p.id, data_pagamento: f.data, valor: v.toFixed(2), forma: f.forma, obs: f.obs || null, origem: 'manual' }).select().single());
      if (file) await uploadAnexo(file, { contrato_id: c.id, parcela_id: p.id, pagamento_id: g.id, descricao: `Comprovante parcela ${p.numero}` });
    }, 'Pagamento registrado');
    setBusy(false); if (ok) onClose();
  };
  return html`<${Modal} title=${`Registrar pagamento · parcela ${p.numero}/${c.nParc}`} onClose=${onClose}>
    <p class="small muted">Contrato ${c.id} · ${c.comprador.nome} · vencimento ${C.fmtD(p.vencimento)} · previsto ${C.brl(p.prev)} · já recebido ${C.brl(p.rec)} · saldo ${C.brl(p.saldo)}</p>
    <div class="form-grid">
      <label class="f">Data real do pagamento<input type="date" value=${f.data} max=${ctx.model.hoje} onInput=${s('data')} /></label>
      <label class="f">Valor recebido (R$)<input inputmode="decimal" value=${f.valor} onInput=${s('valor')} /></label>
      <label class="f">Forma<select value=${f.forma} onChange=${s('forma')}>${formas.map((x) => html`<option>${x}</option>`)}</select></label>
      <label class="f span3">Observação<input value=${f.obs} onInput=${s('obs')} placeholder="Ex.: pagamento parcial, comprovante enviado por WhatsApp…" /></label>
      <label class="f span3">Comprovante (opcional)<input type="file" onChange=${(e) => setFile(e.target.files[0])} /></label>
    </div>
    <p class="small muted">Para pagamento parcial, informe apenas o valor recebido: o saldo continua em aberto. É possível lançar vários pagamentos na mesma parcela.</p>
    ${msg ? html`<div class="banner err">${msg}</div>` : ''}
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" disabled=${busy} onClick=${salvar}>${busy ? 'Salvando…' : 'Confirmar pagamento'}</button></div><//>`;
}
function EstornoModal({ ctx, g, onClose }) {
  const [m, setM] = useState('');
  return html`<${Modal} title=${`Estornar lançamento #${g.id}`} onClose=${onClose}>
    <p>Lançamento de <b>${C.brl(g.valorC)}</b> em ${C.fmtD(g.data_pagamento)}. O registro não é apagado: fica marcado como estornado no histórico e deixa de contar nos indicadores.</p>
    <label class="f">Motivo do estorno (obrigatório)<input value=${m} onInput=${(e) => setM(e.target.value)} /></label>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-danger" disabled=${m.trim().length < 3}
      onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_estornar_pagamento', { p_id: g.id, p_motivo: m.trim() }).then(chk), 'Lançamento estornado')) onClose(); }}>Confirmar estorno</button></div><//>`;
}
function CorrigirModal({ ctx, g, onClose }) {
  const [f, setF] = useState({ data: g.data_pagamento, valor: moneyInput(g.valorC), forma: g.forma || 'PIX', motivo: '' });
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const salvar = async () => {
    const v = parseMoney(f.valor);
    if (!(v > 0) || !f.data || f.motivo.trim().length < 3) return ctx.notify('Preencha data, valor e motivo.', 'err');
    if (await ctx.act(() => sb.rpc('rcb_corrigir_pagamento', { p_id: g.id, p_data: f.data, p_valor: v.toFixed(2), p_forma: f.forma, p_motivo: f.motivo.trim() }).then(chk), 'Lançamento corrigido')) onClose();
  };
  return html`<${Modal} title=${`Corrigir lançamento #${g.id}`} onClose=${onClose}>
    <p class="small muted">A correção estorna o lançamento original e cria um novo, preservando o histórico.</p>
    <div class="form-grid"><label class="f">Data<input type="date" value=${f.data} max=${ctx.model.hoje} onInput=${s('data')} /></label>
      <label class="f">Valor (R$)<input inputmode="decimal" value=${f.valor} onInput=${s('valor')} /></label>
      <label class="f">Forma<select value=${f.forma} onChange=${s('forma')}>${formas.map((x) => html`<option>${x}</option>`)}</select></label>
      <label class="f span3">Motivo (obrigatório)<input value=${f.motivo} onInput=${s('motivo')} /></label></div>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${salvar}>Salvar correção</button></div><//>`;
}
function EditarContratoModal({ ctx, c, onClose }) {
  const init = {
    descricao: c.descricao || '', animal: c.animal || '', acasalamento: c.acasalamento || '', tipo_venda: c.tipo_venda, percentual: c.percentual ?? '', lote: c.lote || '',
    data_contrato: c.data_contrato || '', valor_total: moneyInput(c.valorC), participacao_sm_pct: c.participacao_sm_pct ?? '', vendedor: c.vendedor || '', condicoes: c.condicoes || '', obs: c.obs || '',
    assinatura: c.assinatura, cnome: c.comprador.nome, cdoc: c.comprador.documento || '', cemail: c.comprador.email || '', ctel: c.comprador.telefone || '',
  };
  const [f, setF] = useState(init);
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const salvar = async () => {
    const mud = Object.keys(f).filter((k) => String(f[k]) !== String(init[k]));
    if (!mud.length) return onClose();
    const v = parseMoney(f.valor_total);
    if (!(v >= 0)) return ctx.notify('Valor total inválido.', 'err');
    if (!confirm(`Confirmar alteração de: ${mud.join(', ')}?\nA mudança fica registrada no histórico e a conferência será refeita.`)) return;
    const ok = await ctx.act(async () => {
      chk(await sb.from('rcb_contratos').update({
        descricao: f.descricao, animal: f.animal || null, acasalamento: f.acasalamento || null, tipo_venda: f.tipo_venda, percentual: f.percentual === '' ? null : Number(String(f.percentual).replace(',', '.')),
        lote: f.lote || null, data_contrato: f.data_contrato || null, valor_total: v.toFixed(2), participacao_sm_pct: f.participacao_sm_pct === '' ? null : Number(String(f.participacao_sm_pct).replace(',', '.')),
        vendedor: f.vendedor || null, condicoes: f.condicoes || null, obs: f.obs || null, assinatura: f.assinatura,
      }).eq('id', c.id));
      if (['cnome', 'cdoc', 'cemail', 'ctel'].some((k) => mud.includes(k)))
        chk(await sb.from('rcb_compradores').update({ nome: f.cnome, documento: f.cdoc.replace(/\D/g, '') || null, email: f.cemail || null, telefone: f.ctel || null }).eq('id', c.comprador_id));
      chk(await sb.rpc('rcb_conferir_contrato', { p_id: c.id }));
    }, 'Contrato atualizado');
    if (ok) onClose();
  };
  return html`<${Modal} wide title=${`Editar contrato ${c.id}`} onClose=${onClose}><div class="form-grid">
    <label class="f span3">Descrição<input value=${f.descricao} onInput=${s('descricao')} /></label>
    <label class="f">Animal / genética<input value=${f.animal} onInput=${s('animal')} /></label><label class="f">Acasalamento<input value=${f.acasalamento} onInput=${s('acasalamento')} /></label>
    <label class="f">Tipo de venda<select value=${f.tipo_venda} onChange=${s('tipo_venda')}>${Object.entries(C.TIPO_LABEL).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></label>
    <label class="f">% comercializado<input value=${f.percentual} onInput=${s('percentual')} /></label><label class="f">Lote<input value=${f.lote} onInput=${s('lote')} /></label>
    <label class="f">Data do contrato<input type="date" value=${f.data_contrato} onInput=${s('data_contrato')} /></label>
    <label class="f">Valor total (R$)<input inputmode="decimal" value=${f.valor_total} onInput=${s('valor_total')} /></label>
    <label class="f">Participação da SM (%)<input value=${f.participacao_sm_pct} onInput=${s('participacao_sm_pct')} placeholder="não informada" /></label>
    <label class="f">Assinatura<select value=${f.assinatura} onChange=${s('assinatura')}><option value="assinado">Assinado</option><option value="sem_assinatura">Sem assinatura</option><option value="nao_informado">Não informado</option></select></label>
    <label class="f">Vendedor<input value=${f.vendedor} onInput=${s('vendedor')} /></label>
    <label class="f span2">Condições (entrada, comissão, taxas, descontos)<input value=${f.condicoes} onInput=${s('condicoes')} /></label>
    <label class="f span3">Observações<input value=${f.obs} onInput=${s('obs')} /></label>
    <div class="span3 sep"></div>
    <label class="f">Comprador<input value=${f.cnome} onInput=${s('cnome')} /></label><label class="f">CPF/CNPJ<input value=${f.cdoc} onInput=${s('cdoc')} /></label>
    <label class="f">E-mail<input value=${f.cemail} onInput=${s('cemail')} /></label><label class="f">Telefone<input value=${f.ctel} onInput=${s('ctel')} /></label>
  </div><p class="small muted">Os dados do comprador valem para todos os contratos dele.</p>
  <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${salvar}>Salvar</button></div><//>`;
}
function EditarParcelasModal({ ctx, c, onClose }) {
  const [rows, setRows] = useState(() => c.parcelas.map((p) => ({ id: p.id, numero: p.numero, vencimento: p.vencimento, valor: moneyInput(p.prev || C.cents(p.valor_previsto)), liquidacao_externa: p.liquidacao_externa, cancelada: p.cancelada, cancelada_motivo: p.cancelada_motivo || '', obs: p.obs || '', _o: p })));
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((rs) => [...rs, { id: null, numero: Math.max(0, ...rs.map((r) => r.numero)) + 1, vencimento: '', valor: '0,00', liquidacao_externa: false, cancelada: false, cancelada_motivo: '', obs: '' }]);
  const soma = rows.filter((r) => !r.cancelada).reduce((s, r) => s + Math.round((parseMoney(r.valor) || 0) * 100), 0);
  const salvar = async () => {
    for (const r of rows) {
      if (!r.vencimento || !(parseMoney(r.valor) >= 0)) return ctx.notify(`Parcela ${r.numero}: vencimento/valor inválido.`, 'err');
      if (r.cancelada && !r.cancelada_motivo.trim()) return ctx.notify(`Parcela ${r.numero}: informe o motivo do cancelamento.`, 'err');
    }
    const muds = rows.filter((r) => !r.id || r.vencimento !== r._o.vencimento || Math.round(parseMoney(r.valor) * 100) !== C.cents(r._o.valor_previsto) || r.liquidacao_externa !== r._o.liquidacao_externa || r.cancelada !== r._o.cancelada || r.obs !== (r._o.obs || '') || r.cancelada_motivo !== (r._o.cancelada_motivo || ''));
    if (!muds.length) return onClose();
    if (!confirm(`Salvar alterações em ${muds.length} parcela(s)? Soma resultante: ${C.brl(soma)} (contrato: ${C.brl(c.valorC)}).`)) return;
    const ok = await ctx.act(async () => {
      for (const r of muds) {
        const row = { numero: r.numero, vencimento: r.vencimento, valor_previsto: parseMoney(r.valor).toFixed(2), liquidacao_externa: r.liquidacao_externa, cancelada: r.cancelada, cancelada_motivo: r.cancelada ? r.cancelada_motivo : null, obs: r.obs || null };
        if (r.id) chk(await sb.from('rcb_parcelas').update(row).eq('id', r.id));
        else chk(await sb.from('rcb_parcelas').insert({ ...row, contrato_id: c.id, status_origem: 'Incluída manualmente' }));
      }
      chk(await sb.rpc('rcb_conferir_contrato', { p_id: c.id }));
    }, 'Parcelas atualizadas');
    if (ok) onClose();
  };
  return html`<${Modal} wide title=${`Parcelas do contrato ${c.id}`} onClose=${onClose}>
    <p class="small muted">Parcelas não podem ser excluídas — marque “cancelada” com o motivo. Pagamentos são lançados na tela do contrato. “Liquidada fora” = consta como quitada no sistema de origem sem valor registrado.</p>
    <div class="tbl-wrap" style="max-height:55vh"><table><thead><tr><th>Nº</th><th>Vencimento</th><th>Valor previsto</th><th>Liquidada fora</th><th>Cancelada</th><th>Motivo / obs.</th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr><td><input style="width:60px" type="number" value=${r.numero} onInput=${(e) => set(i, 'numero', +e.target.value)} /></td>
        <td><input type="date" value=${r.vencimento} onInput=${(e) => set(i, 'vencimento', e.target.value)} /></td>
        <td><input style="width:110px" inputmode="decimal" value=${r.valor} onInput=${(e) => set(i, 'valor', e.target.value)} /></td>
        <td class="center"><input type="checkbox" checked=${r.liquidacao_externa} onChange=${(e) => set(i, 'liquidacao_externa', e.target.checked)} /></td>
        <td class="center"><input type="checkbox" checked=${r.cancelada} onChange=${(e) => set(i, 'cancelada', e.target.checked)} /></td>
        <td><input value=${r.cancelada ? r.cancelada_motivo : r.obs} placeholder=${r.cancelada ? 'motivo do cancelamento' : 'observação'} onInput=${(e) => set(i, r.cancelada ? 'cancelada_motivo' : 'obs', e.target.value)} /></td></tr>`)}
    </tbody></table></div>
    <div class="stack" style="margin-top:10px"><button class="btn-sm" onClick=${add}>+ Adicionar parcela</button>
      <span class="small">Soma: <b>${C.brl(soma)}</b> · Contrato: <b>${C.brl(c.valorC)}</b> · Diferença: <b style=${soma !== c.valorC ? 'color:var(--red)' : ''}>${C.brl(c.valorC - soma)}</b></span></div>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${salvar}>Salvar parcelas</button></div><//>`;
}
function ArquivarModal({ ctx, c, onClose }) {
  const [m, setM] = useState('');
  return html`<${Modal} title=${`Arquivar contrato ${c.id}`} onClose=${onClose}>
    <p>O contrato sai dos indicadores (ex.: duplicado, cancelado ou substituído por renegociação), mas continua consultável e com histórico. Nada é apagado.</p>
    <label class="f">Motivo (obrigatório)<input value=${m} onInput=${(e) => setM(e.target.value)} placeholder="Ex.: substituído pelo contrato 71382 (renegociação)" /></label>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-danger" disabled=${m.trim().length < 3}
      onClick=${async () => { if (await ctx.act(async () => { chk(await sb.from('rcb_contratos').update({ arquivado: true, arquivado_motivo: m.trim() }).eq('id', c.id)); chk(await sb.rpc('rcb_conferir_todos')); }, 'Contrato arquivado')) onClose(); }}>Arquivar</button></div><//>`;
}

// ---------------------------------------------------------------------------
// Repasses da Contabilidade — conferência mensal
// ---------------------------------------------------------------------------
const CATM = Object.fromEntries(C.CONF_CATS.map((c) => [c.id, c]));
const SEV = { bad: 'critico', warn: 'atencao', info: 'info', gold: 'pendente', ok: 'ok', gray: 'cancelada' };
const nomeMes = (m) => `${C.MESES_LONGOS[+m.slice(5) - 1]}/${m.slice(0, 4)}`;
const EXTRATO = { sem_relatorio: ['cancelada', 'Sem relatório'], pendente: ['cancelada', 'Transferência informada pela contabilidade'], confirmado: ['ok', 'Confirmado no extrato'], divergente: ['critico', 'Divergente no extrato'] };
const CONCILIACAO = { bateu: ['ok', 'Conciliado'], divergencia: ['critico', 'Com diferença'], faltam_dados: ['atencao', 'Faltam dados'], aguardando: ['cancelada', 'Aguardando relatório'] };
const chipStatus = (c) => (c.status === 'enviado' ? html`${Badge('ok', 'Relatório enviado')} ${Badge(CONCILIACAO[c.conciliacao][0], CONCILIACAO[c.conciliacao][1])}` : Badge('cancelada', 'Aguardando relatório'));
const pct = (x) => (x == null ? '—' : C.pctTxt(x));

// menu suspenso simples (fecha ao clicar fora ou numa opção)
function Menu({ label, title, children, alinhar = 'right' }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return; const f = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  return html`<div class="menu" ref=${ref}><button class="menu-btn" title=${title || ''} aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)}>${label}</button>
    ${open ? html`<div class=${'menu-list ' + alinhar} role="menu" onClick=${() => setOpen(false)}>${children}</div>` : ''}</div>`;
}

const periodoTxt = (p) => p.txt || `${C.fmtD(p.de)} a ${C.fmtD(p.ate)}`;
const DECISAO = { aceito: ['ok', 'Aceito'], contestado: ['critico', 'Contestado'] };

function RepassesPage({ ctx, mes }) {
  const { model, isAdmin } = ctx;
  const meses = C.mesesConferencia(model);
  const comRel = meses.filter((x) => model.repasses.some((r) => r.mes === x && !r.substituido));
  const m = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : (comRel[0] || meses[0]);
  const conf = useMemo(() => C.conferencia(model, m), [model, m]);
  const [abertos, setAbertos] = useState(null);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => { setAbertos(null); setSel(null); }, [m]);
  const fech = model.fechamentos?.get(m); const fechado = fech?.status === 'fechado';
  const idx = meses.indexOf(m); const anterior = meses[idx + 1], proximo = meses[idx - 1];
  const exportar = (tipo) => { try { tipo === 'pdf' ? baixarPDF(conf, model) : conferenciaExcel(conf, model); } catch (e) { ctx.notify('Não foi possível gerar o arquivo: ' + e.message, 'err'); } };
  const cob = conf.taxaCobertura;
  const precisaEnviar = isAdmin && !fechado && (!conf.reps.length || conf.periodosFaltando.length);
  const decidir = (i, decisao, nota = '') => ctx.act(() => sb.rpc('rcb_decidir_ajuste', { p_id: i.linha.id, p_decisao: decisao, p_nota: nota }).then(chk), decisao === 'aceito' ? 'Ajuste aceito' : decisao === 'contestado' ? 'Ajuste contestado' : 'Decisão desfeita');

  // grupos que explicam o mês: diferença real, ajustes da contabilidade, conferidos e fora da conta
  const grupos = [
    ...conf.problemas.map((c) => ({ ...c, tipo: 'dif', valor: c.dif })),
    ...conf.cats.filter((c) => c.ajuste).map((c) => ({ ...c, tipo: 'ajuste', valor: -c.itens.reduce((s, i) => s + i.ajuste, 0) })),
    ...conf.cats.filter((c) => c.neutro && !c.fora).map((c) => ({ ...c, tipo: 'ok', valor: c.id === 'encargo' ? conf.encargos : null })),
    ...conf.cats.filter((c) => c.fora).map((c) => ({ ...c, tipo: 'fora', valor: c.id === 'aguardando' ? conf.aguardando : null })),
  ];
  const abertosEf = abertos ?? new Set(grupos.filter((g) => g.tipo === 'dif' || (g.tipo === 'ajuste' && conf.ajustesPendentes)).map((g) => g.id));
  const alternar = (id) => setAbertos(() => { const n = new Set(abertosEf); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // fechamento
  const passos = [
    { ok: conf.reps.length > 0 && !conf.periodosFaltando.length, t: 'Relatórios do mês completos', d: !conf.reps.length ? 'Nenhum relatório enviado' : conf.periodosFaltando.length ? `Falta: ${conf.periodosFaltando.map(periodoTxt).join('; ')}` : conf.porQuinzena.map((q) => `${q.q}ª quinzena: ${q.reps.map((r) => r.arquivo_nome || r.titulo).join(', ')}`).join(' · ') },
    { ok: conf.reps.length > 0 && cob.n === cob.total, t: 'Taxa identificada em todas as parcelas', d: cob.total ? `${cob.n} de ${cob.total} parcelas · taxa média ${pct(conf.taxaMedia)}` : '—' },
    { ok: conf.reps.length > 0 && conf.dif === 0 && !conf.pendencias, t: 'Sem diferença real', d: conf.dif || conf.pendencias ? `${C.brl(conf.dif)}${conf.pendencias ? ` · ${conf.pendencias} item(ns) para conferir` : ''}` : 'Transferido = esperado após ajustes' },
    { ok: !conf.ajustesPendentes, t: 'Ajustes aceitos ou contestados', d: conf.ajustesItens.length ? `${conf.ajustesItens.length - conf.ajustesPendentes} de ${conf.ajustesItens.length} decididos${conf.ajustesContestados.length ? ` · ${conf.ajustesContestados.length} contestado(s)` : ''}` : 'Nenhum ajuste no mês' },
    { ok: conf.extrato === 'confirmado', t: 'Valor conferido no extrato bancário', d: conf.extrato === 'confirmado' ? `Confirmado: ${C.brl(conf.confirmadoConta)}` : conf.extrato === 'divergente' ? 'Divergente no extrato' : 'Ainda não conferido', acao: conf.reps.find((r) => r.extrato_status !== 'confirmado') },
  ];
  const podeFechar = isAdmin && !fechado && passos.every((p) => p.ok);

  // frase com a resposta
  const verd = !conf.reps.length
    ? ['warn', html`<b>Aguardando relatório da contabilidade de ${nomeMes(m)}.</b> ${conf.painelMes ? html`Os compradores pagaram ${C.brl(conf.painelMes)} no mês (valor bruto, antes das taxas).` : ''}`]
    : conf.periodosFaltando.length
      ? ['warn', html`<b>Falta o ${conf.periodosFaltando.map(periodoTxt).join(' e o ')}.</b> A conta abaixo usa só ${conf.reps.length === 1 ? 'o arquivo enviado' : 'os arquivos enviados'}; os pagamentos desse período (${C.brl(conf.aguardando)}) aguardam o relatório.`]
      : conf.dif === 0 && !conf.pendencias
        ? ['ok', html`<b>O repasse bateu.</b> A contabilidade transferiu ${C.brl(conf.informado)}${conf.ajustes ? html`, já descontados ${C.brl(conf.ajustes)} de ajustes que ela informou no relatório${conf.ajustesPendentes ? ' (aceite ou conteste abaixo)' : ''}` : ''}.`]
        : conf.dif < 0
          ? ['err', html`<b>Faltaram ${C.brl(-conf.dif)} no repasse.</b> Veja abaixo as parcelas que explicam a diferença.`]
          : conf.dif > 0 ? ['warn', html`<b>A contabilidade transferiu ${C.brl(conf.dif)} a mais que o esperado.</b> Veja abaixo as parcelas.`]
            : ['warn', html`<b>${conf.pendencias} item(ns) para conferir</b> antes de fechar o mês.`];

  const linhaItem = (i, g) => html`<tr class="click" onClick=${() => setSel(i)}>
    <td><b>${i.ctr}</b> · ${i.lote}${i.ref ? html`<div class="small muted">${i.ref}</div>` : ''}</td><td>${i.parcelasTxt}</td>
    <td class="num small">${C.fmtD(i.pagoEm || i.data_credito)}</td>
    ${g.tipo === 'ajuste'
      ? html`<td class="num neg">−${C.brl(i.ajuste)}</td><td class="small" style="max-width:420px">${i.desc || i.why}</td>
        <td onClick=${(e) => e.stopPropagation()} style="white-space:nowrap">${i.decisao ? html`${Badge(DECISAO[i.decisao][0], DECISAO[i.decisao][1])}${isAdmin && !fechado ? html` <button class="btn-sm btn-ghost" onClick=${() => decidir(i, null)}>desfazer</button>` : ''}`
          : isAdmin && !fechado ? html`<button class="btn-sm" onClick=${() => decidir(i, 'aceito')}>Aceitar</button> <button class="btn-sm" onClick=${() => setModal({ t: 'contestar', i })}>Contestar</button>` : Badge('cancelada', 'Sem decisão')}</td>`
      : html`<td class="num small">${i.bruto ? C.brl(i.bruto) : i.espPrevisto ? C.brl(i.espPrevisto) : '—'}</td>
        <td class="num small">${i.taxaPct != null ? `${C.brl(i.taxa)} (${pct(i.taxaPct)})` : i.estimado && i.taxa ? '~' + C.brl(i.taxa) : '—'}</td>
        <td class="num">${i.linha ? C.brl(i.inf) : '—'}</td>
        <td class="num" style=${i.dif < 0 ? 'color:var(--red);font-weight:600' : ''}>${i.dif ? (i.dif > 0 ? '+' : '') + C.brl(i.dif) : '—'}</td>
        <td class="small" style="max-width:380px">${i.resolvido ? html`${Badge('ok', 'Resolvido')} ` : ''}${i.why}</td>`}</tr>`;

  return html`
    <div class="page-head"><div><h1>Repasses da Contabilidade</h1><p>Confira se a contabilidade transferiu tudo o que deveria em cada mês</p></div>
      <div class="stack no-print">
        ${precisaEnviar ? html`<button class="btn-primary" onClick=${() => setModal({ t: 'enviar' })}>Enviar relatório de ${nomeMes(m)}</button>` : ''}
        <${Menu} label="Exportar ▾"><button disabled=${!conf.itens.length} onClick=${() => exportar('pdf')}>PDF da conferência</button><button disabled=${!conf.itens.length} onClick=${() => exportar('xlsx')}>Planilha Excel</button>
          ${conf.ajustesContestados.length ? html`<button onClick=${() => { try { baixarContestacao(conf, model); } catch (e) { ctx.notify(e.message, 'err'); } }}>Contestação (PDF)</button>` : ''}<//>
        ${isAdmin ? html`<${Menu} label="⋯" title="Mais ações">
          ${!precisaEnviar ? html`<button disabled=${fechado} onClick=${() => setModal({ t: 'enviar' })}>Enviar outro relatório</button>` : ''}
          <button onClick=${() => setModal({ t: 'contab' })}>Empresa de contabilidade (${model.contabAtual?.nome || '—'})</button><//>` : ''}
      </div></div>

    <div class="mes-bar">
      <button class="btn-sm" disabled=${!anterior} onClick=${() => go('#/repasses/' + anterior)} aria-label="Mês anterior">‹</button>
      <select class="mes-sel" value=${m} onChange=${(e) => go('#/repasses/' + e.target.value)} aria-label="Mês">
        ${meses.map((x) => html`<option value=${x}>${nomeMes(x)}${model.repasses.some((r) => r.mes === x && !r.substituido) ? ' · relatório enviado' : ''}</option>`)}</select>
      <button class="btn-sm" disabled=${!proximo} onClick=${() => go('#/repasses/' + proximo)} aria-label="Próximo mês">›</button>
      <span class="stack" style="gap:6px">${conf.status === 'enviado' ? Badge('ok', `Relatório enviado · ${conf.reps.length} arquivo(s)`) : Badge('cancelada', 'Aguardando relatório')}
        ${conf.status === 'enviado' ? Badge(CONCILIACAO[conf.conciliacao][0], CONCILIACAO[conf.conciliacao][1]) : ''}
        ${fechado ? Badge('info', 'Mês fechado') : ''}</span>
    </div>

    <div class=${'banner ' + verd[0]} style="margin-top:12px"><span>${verd[1]}</span></div>
    ${fechado ? html`<div class="banner info"><span>Mês fechado em ${C.fmtD(fech.fechado_em?.slice(0, 10))}${fech.fechado_por_email ? ' por ' + fech.fechado_por_email : ''}${fech.nota ? ` · ${fech.nota}` : ''}. Para enviar, trocar ou excluir relatórios, reabra o mês.</span></div>` : ''}

    <div class="mes-grid">
      <div class="col-main">
        <div class="card conta">
          <div class="conta-row">
            <div class="conta-box"><div class="lbl">Repasse líquido esperado</div><div class="val num">${C.brl(conf.esperado)}</div>
              <div class="sub">pago ${C.brl(conf.bruto)} − taxas ${C.brl(conf.taxas + conf.taxasEstimadas)}${conf.taxaMedia != null ? ` (${pct(conf.taxaMedia)})` : ''}</div></div>
            <div class="conta-op">−</div>
            <div class="conta-box"><div class="lbl">Ajustes informados</div><div class="val num">${C.brl(conf.ajustes)}</div><div class="sub">${conf.ajustesItens.length ? `${conf.ajustesItens.length} lançamento(s) no relatório` : 'nenhum'}</div></div>
            <div class="conta-op">vs</div>
            <div class="conta-box"><div class="lbl">Transferido pela contabilidade</div><div class="val num">${C.brl(conf.informado)}</div><div class="sub">${Badge(EXTRATO[conf.extrato][0], EXTRATO[conf.extrato][1])}</div></div>
            <div class="conta-op">=</div>
            <div class=${'conta-box ' + (conf.dif ? 'neg' : conf.reps.length ? 'zero' : '')}><div class="lbl">Diferença</div><div class="val num">${C.brl(conf.dif)}</div>
              <div class="sub">${!conf.reps.length ? 'sem relatório' : conf.dif === 0 ? 'nada sem explicação' : conf.dif < 0 ? 'a SM recebeu menos' : 'transferido a mais'}</div></div>
          </div>
        </div>

        ${conf.reps.length ? html`<div class="card"><div class="card-head"><h2>Quinzenas de ${nomeMes(m)}</h2><span class="small muted">pela competência escolhida na importação</span></div>
          <div class="tbl-wrap"><table><thead><tr><th>Quinzena</th><th class="num">Parcelas</th><th class="num">Pago</th><th class="num">Taxas</th><th class="num">Esperado</th><th class="num">Ajustes</th><th class="num">Transferido</th><th class="num">Diferença</th></tr></thead><tbody>
            ${conf.porQuinzena.map((q) => html`<tr><td><b>${q.q}ª quinzena</b><div class="small muted">${q.reps.length ? q.reps.map((r) => r.arquivo_nome || r.titulo).join(', ') : 'sem relatório'}</div></td>
              <td class="num">${q.parcelas}</td><td class="num">${C.brl(q.bruto)}</td><td class="num">${C.brl(q.taxas)}${q.taxaMedia != null ? html`<div class="small muted">${pct(q.taxaMedia)}</div>` : ''}</td><td class="num">${C.brl(q.esperado)}</td>
              <td class="num">${q.ajustes ? '−' + C.brl(q.ajustes) : '—'}</td><td class="num"><b>${C.brl(q.informado)}</b></td><td class="num" style=${q.dif ? 'color:var(--red);font-weight:600' : ''}>${q.reps.length ? C.brl(q.dif) : '—'}</td></tr>`)}
            <tr><td><b>Total do mês</b></td><td class="num">${conf.porQuinzena.reduce((s, q) => s + q.parcelas, 0)}</td><td class="num">${C.brl(conf.bruto)}</td><td class="num">${C.brl(conf.taxas)}<div class="small muted">${pct(conf.taxaMedia)}</div></td><td class="num">${C.brl(conf.esperado)}</td>
              <td class="num">${conf.ajustes ? '−' + C.brl(conf.ajustes) : '—'}</td><td class="num"><b>${C.brl(conf.informado)}</b></td><td class="num" style=${conf.dif ? 'color:var(--red);font-weight:600' : ''}><b>${C.brl(conf.dif)}</b></td></tr></tbody></table></div></div>` : ''}
        ${grupos.length ? html`<div class="card"><div class="card-head"><h2>O que explica ${nomeMes(m)}</h2>
            <span class="small muted">clique num grupo para ver contratos, lotes e parcelas</span></div>
          <div class="grupos">${grupos.map((g) => { const aberto = abertosEf.has(g.id); return html`<div class=${'grupo ' + g.tipo + (aberto ? ' aberto' : '')}>
            <button class="grupo-head" aria-expanded=${aberto} onClick=${() => alternar(g.id)}>
              <span class="seta">${aberto ? '▾' : '▸'}</span>
              <span class="grupo-t"><b>${g.t}</b> · ${g.qtd} ${g.qtd === 1 ? 'item' : 'itens'}<span class="small muted"> — ${g.d}</span></span>
              <span class="num grupo-v">${g.tipo === 'dif' ? C.brl(g.valor) : g.tipo === 'ajuste' ? '−' + C.brl(-g.valor) : g.valor != null ? (g.id === 'encargo' ? '+' : '') + C.brl(g.valor) : g.tipo === 'fora' ? 'fora da conta' : 'OK'}</span>
            </button>
            ${aberto ? html`<div class="tbl-wrap"><table><thead><tr><th>Contrato · lote</th><th>Parcela</th><th class="num">Pago em</th>
                ${g.tipo === 'ajuste' ? html`<th class="num">Ajuste</th><th>Descrição</th><th>Decisão</th>` : html`<th class="num">Pago</th><th class="num">Taxa</th><th class="num">Transferido</th><th class="num">Diferença</th><th>Por quê</th>`}</tr></thead>
              <tbody>${g.itens.map((i) => linhaItem(i, g))}</tbody></table></div>` : ''}
          </div>`; })}</div>
          ${conf.reps.length ? html`<p class="small muted" style="margin:10px 0 0">Esperado ${C.brl(conf.esperado)} − ajustes ${C.brl(conf.ajustes)} = ${C.brl(conf.esperadoAposAjustes)}; transferido ${C.brl(conf.informado)}; diferença ${C.brl(conf.dif)}.${conf.linhasRepetidas ? ` ${conf.linhasRepetidas} linha(s) repetidas entre arquivos foram contadas uma vez só.` : ''}</p>` : ''}
        </div>` : ''}
      </div>

      <div class="col-side">
        <div class="card fechamento"><h2 style="margin-bottom:8px">Fechamento de ${nomeMes(m)}</h2>
          ${passos.map((p) => html`<div class="passo"><span class=${'marca ' + (p.ok ? 'ok' : 'falta')}>${p.ok ? '✓' : '!'}</span><div><b>${p.t}</b> ${p.ok ? Badge('ok', 'feito') : Badge('atencao', 'falta')}<div class="small muted">${p.d}</div>
            ${!p.ok && p.acao && isAdmin && !fechado ? html`<button class="btn-sm" style="margin-top:4px" onClick=${() => setModal({ t: 'extrato', r: p.acao })}>Conferir no extrato</button>` : ''}</div></div>`)}
          ${fechado ? html`<div class="sep"></div><p class="small">Fechado em <b>${C.fmtD(fech.fechado_em?.slice(0, 10))}</b>${fech.fechado_por_email ? ' por ' + fech.fechado_por_email : ''}.</p>${isAdmin ? html`<button onClick=${() => setModal({ t: 'reabrir' })}>Reabrir mês</button>` : ''}`
            : html`<button class="btn-primary" style="margin-top:12px;width:100%" disabled=${!podeFechar} onClick=${() => setModal({ t: 'fechar' })}>Fechar o mês</button>
              ${!podeFechar && isAdmin ? html`<p class="small muted" style="margin:6px 0 0">Libera quando todos os passos estiverem feitos.</p>` : ''}`}
          ${fech?.status === 'aberto' && fech.reaberto_motivo ? html`<p class="small muted" style="margin-top:8px">Reaberto: ${fech.reaberto_motivo}</p>` : ''}
        </div>
      </div>
    </div>

    ${conf.reps.length ? html`<div class="card"><div class="card-head"><h2>Relatórios enviados para ${nomeMes(m)}</h2><span class="small muted">a competência foi escolhida na importação</span></div>
      <div class="tbl-wrap"><table><thead><tr><th style="min-width:260px">Arquivo</th><th>Competência</th><th>Data do relatório</th><th>Créditos de</th><th class="num">Taxa média</th><th class="num">Créditos</th><th class="num">Descontos</th><th class="num">Valor final</th><th>Conta da SM</th><th></th></tr></thead><tbody>
      ${conf.reps.slice().sort((a, b) => a.quinzena - b.quinzena || a.id - b.id).map((r) => { const t = conf.porRelatorio.find((x) => x.r.id === r.id); return html`<tr><td><b>${r.arquivo_nome || r.titulo || '—'}</b><div class="small muted">${r.contabilidade?.nome || '—'} · ${r.linhas.length} linhas</div></td>
        <td style="white-space:nowrap"><b>${r.quinzena}ª quinzena</b></td>
        <td class="small" style="white-space:nowrap">${r.data_relatorio ? C.fmtD(r.data_relatorio) : '—'}</td>
        <td class="small" style="white-space:nowrap">${C.fmtD(r.periodo_inicio)}<br />a ${C.fmtD(r.periodo_fim)}</td>
        <td class="num">${pct(t?.media)}</td><td class="num">${C.brl(C.cents(r.creditos))}</td><td class="num">${C.brl(C.cents(r.taxas) + C.cents(r.debitos))}</td><td class="num"><b>${C.brl(C.cents(r.valor_final))}</b></td>
        <td>${Badge(EXTRATO[r.extrato_status][0], EXTRATO[r.extrato_status][1])}${r.extrato_data ? html`<div class="small muted">${C.fmtD(r.extrato_data)} · ${C.brl(C.cents(r.extrato_valor))}</div>` : ''}</td>
        <td class="right"><${Menu} label="⋯" title="Ações do relatório">
          ${r.storage_path && r.storage_path !== 'teste' ? html`<button onClick=${() => abrirAnexo(r.storage_path).catch((e) => ctx.notify(e.message, 'err'))}>Abrir PDF</button>` : ''}
          ${isAdmin ? html`<button onClick=${() => setModal({ t: 'extrato', r })}>Conferir no extrato</button>
            <button disabled=${fechado} onClick=${() => setModal({ t: 'competencia', r })}>Alterar competência</button>
            <button disabled=${fechado} onClick=${() => setModal({ t: 'enviar', substitui: r })}>Substituir arquivo</button>
            <button class="danger" disabled=${fechado} onClick=${() => setModal({ t: 'remover', r })}>Excluir relatório</button>` : ''}<//></td></tr>`; })}
      </tbody></table></div></div>` : ''}

    <details class="card dobra"><summary><b>De onde sai cada número</b> <span class="small muted">· ponte do arquivo até a diferença e comparação com o Painel</span></summary>
      <dl class="bridge" style="margin-top:12px">
        <dt>Pago pelos compradores nas parcelas dos relatórios desta competência (2ª parcela em diante)</dt><dd>${C.brl(conf.bruto)}</dd>
        <dt>− taxas cobradas sobre essas parcelas${conf.taxasEstimadas ? ` (inclui ${C.brl(conf.taxasEstimadas)} estimados)` : ''}</dt><dd class="neg">−${C.brl(conf.taxas + conf.taxasEstimadas)}</dd>
        <dt class="tot">= Repasse líquido esperado</dt><dd class="tot">${C.brl(conf.esperado)}</dd>
        <dt>− ajustes informados pela contabilidade no relatório</dt><dd class="neg">−${C.brl(conf.ajustes)}</dd>
        <dt class="tot">= Esperado após ajustes</dt><dd class="tot">${C.brl(conf.esperadoAposAjustes)}</dd>
        <dt>Valor final dos arquivos de ${nomeMes(m)}${conf.linhasRepetidas ? ' (linhas repetidas contadas uma vez)' : ''}</dt><dd>${C.brl(conf.totalRelatoriosMes)}</dd>
        ${conf.paraOutrosMeses ? html`<dt>− linhas desses arquivos pagas em outros meses</dt><dd class="neg">−${C.brl(conf.paraOutrosMeses)}</dd>` : ''}
        ${conf.deOutrosRelatorios ? html`<dt>+ parcelas pagas neste mês que vieram em arquivos de outros meses</dt><dd>${C.brl(conf.deOutrosRelatorios)}</dd>` : ''}
        <dt class="tot">= Transferido referente a ${nomeMes(m)}</dt><dd class="tot">${C.brl(conf.informado)}</dd>
        <dt class="tot">Diferença</dt><dd class=${'tot' + (conf.dif ? ' neg' : '')}>${C.brl(conf.dif)}</dd></dl>
      <div class="sep"></div>
      <p class="small"><b>Painel × conferência.</b> O Painel ("Pago pelos compradores") soma pela <b>data do pagamento</b>; a conferência soma pela <b>competência do relatório</b> escolhida na importação.</p>
      <dl class="bridge"><dt>Painel: pago pelos compradores em ${nomeMes(m)} (valor bruto, antes das taxas)</dt><dd>${C.brl(conf.painelMes)}</dd>
        ${conf.brutoPagoOutro ? html`<dt>+ parcelas pagas em outros meses que vieram nos relatórios desta competência</dt><dd>${C.brl(conf.brutoPagoOutro)}</dd>` : ''}
        ${conf.brutoRepassadoOutro ? html`<dt>− pagas neste mês, repassadas em relatório de outra competência</dt><dd class="neg">−${C.brl(conf.brutoRepassadoOutro)}</dd>` : ''}
        ${conf.brutoSemRelatorio ? html`<dt>− pagas neste mês e ainda sem relatório</dt><dd class="neg">−${C.brl(conf.brutoSemRelatorio)}</dd>` : ''}
        <dt class="tot">= Pago nas parcelas da conferência</dt><dd class="tot">${C.brl(conf.bruto)}</dd></dl>
      <p class="small muted">Entrada, pagamentos diretos ao vendedor e baixas "Liquidada no cadastro" ficam fora dos dois.</p>
    </details>

    ${conf.reps.length ? html`<details class="card dobra"><summary><b>Taxa média da contabilidade: ${pct(conf.taxaMedia)}</b> <span class="small muted">· soma das taxas ÷ soma das bases das parcelas</span></summary>
      <p class="small" style="margin-top:10px">Taxas ${C.brl(conf.taxas)} ÷ bases ${C.brl(conf.itens.filter((i) => i.linha?.tipo === 'credito' && !CATM[i.cat].fora && i.base).reduce((s, i) => s + i.base, 0))}. ${cob.n === cob.total ? `Cobre todas as ${cob.total} parcelas.` : `Cobre ${cob.n} de ${cob.total} parcelas.`}
        ${conf.predominante != null ? html` Taxa mais frequente: <b>${conf.predominante.toLocaleString('pt-BR')}%</b>${conf.foraPadrao.length ? html`; com taxa diferente: ${conf.foraPadrao.map((i) => `${i.ctr}/${i.parcelasTxt} (${pct(i.taxaPct)})`).join(', ')}` : ''}.` : ''}</p>
      <table><thead><tr><th>Arquivo</th><th class="num">Parcelas</th><th class="num">Taxa média</th></tr></thead><tbody>
        ${conf.porRelatorio.map((x) => html`<tr><td class="small">${x.r.arquivo_nome || x.r.titulo}<div class="muted">${C.fmtD(x.r.periodo_inicio)} a ${C.fmtD(x.r.periodo_fim)}</div></td><td class="num">${x.n}/${x.nLinhas}</td><td class="num"><b>${pct(x.media)}</b></td></tr>`)}
        <tr><td><b>Mês</b> <span class="small muted">(pelo mês do pagamento, sem repetições)</span></td><td class="num">${cob.n}</td><td class="num"><b>${pct(conf.taxaMedia)}</b></td></tr></tbody></table>
    </details>` : ''}

    ${conf.mudancaRegra && conf.mudancaRegra.grupos.length ? html`<details class="card dobra"><summary><b>Histórico: comparação com o cálculo anterior</b> <span class="small muted">· antes ${C.brl(conf.mudancaRegra.antigo.dif)}, agora ${C.brl(conf.dif)}</span></summary>
      <p class="small muted" style="margin:10px 0">O cálculo anterior usava taxa fixa de 4%, o mês da data de crédito e contava os ajustes do relatório como diferença.</p>
      <dl class="bridge"><dt>Diferença pelo cálculo anterior</dt><dd>${C.brl(conf.mudancaRegra.antigo.dif)}</dd>
        ${conf.mudancaRegra.grupos.map((g) => html`<dt><b>${g.t}</b><div class="small muted">${g.d}</div><ul class="items small" style="margin-top:4px">${g.itens.map((x) => html`<li>${x}</li>`)}</ul></dt><dd class=${g.efeito < 0 ? 'neg' : ''}>${g.efeito > 0 ? '+' : ''}${C.brl(g.efeito)}</dd>`)}
        ${conf.mudancaRegra.resto ? html`<dt>Outras diferenças entre os cálculos</dt><dd>${C.brl(conf.mudancaRegra.resto)}</dd>` : ''}
        <dt class="tot">= Diferença atual</dt><dd class=${'tot' + (conf.dif ? ' neg' : '')}>${C.brl(conf.dif)}</dd></dl>
    </details>` : ''}

    ${sel ? html`<${ItemRepasse} ctx=${ctx} i=${sel} mes=${m} onClose=${() => setSel(null)} />` : ''}
    ${modal?.t === 'enviar' ? html`<${EnviarRelatorio} ctx=${ctx} mesAtual=${m} substitui=${modal.substitui} faltando=${conf.periodosFaltando} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'extrato' ? html`<${ExtratoModal} ctx=${ctx} r=${modal.r} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'contab' ? html`<${ContabilidadeModal} ctx=${ctx} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'remover' ? html`<${RemoverRelatorio} ctx=${ctx} r=${modal.r} mes=${m} outros=${conf.reps.filter((x) => x.id !== modal.r.id)} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'contestar' ? html`<${ContestarModal} ctx=${ctx} i=${modal.i} onClose=${() => setModal(null)} onOk=${(nota) => decidir(modal.i, 'contestado', nota)} />` : ''}
    ${modal?.t === 'fechar' ? html`<${FecharMesModal} ctx=${ctx} conf=${conf} mes=${m} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'reabrir' ? html`<${ReabrirMesModal} ctx=${ctx} mes=${m} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'competencia' ? html`<${CompetenciaModal} ctx=${ctx} r=${modal.r} onClose=${() => setModal(null)} />` : ''}`;
}

function ContestarModal({ i, onClose, onOk }) {
  const [nota, setNota] = useState('');
  return html`<${Modal} title="Contestar ajuste" onClose=${onClose}>
    <table class="kv"><tbody><tr><th>Lançamento</th><td><b>${i.ref}</b>${i.desc ? ' · ' + i.desc : ''}</td></tr><tr><th>Contrato</th><td>${i.ctr} · lote ${i.lote} · parcela ${i.parcelasTxt}</td></tr><tr><th>Valor</th><td><b>${C.brl(i.ajuste)}</b></td></tr></tbody></table>
    <label class="f">Motivo da contestação<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder="Ex.: parcela paga direto ao vendedor; honorário não previsto em contrato" /></label>
    <p class="small muted">O item entra no PDF de contestação (Exportar ▾ › Contestação) para enviar à contabilidade.</p>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" disabled=${nota.trim().length < 3} onClick=${async () => { if (await onOk(nota.trim())) onClose(); }}>Contestar</button></div><//>`;
}

function FecharMesModal({ ctx, conf, mes, onClose }) {
  const [nota, setNota] = useState('');
  const resumo = { esperado: conf.esperado, ajustes: conf.ajustes, transferido: conf.informado, diferenca: conf.dif, taxa_media: conf.taxaMedia, relatorios: conf.reps.map((r) => r.id), contestados: conf.ajustesContestados.length };
  return html`<${Modal} title=${'Fechar ' + nomeMes(mes)} onClose=${onClose}>
    <table class="kv"><tbody><tr><th>Esperado</th><td>${C.brl(conf.esperado)}</td></tr><tr><th>Ajustes</th><td>${C.brl(conf.ajustes)}${conf.ajustesContestados.length ? ` (${conf.ajustesContestados.length} contestado(s))` : ''}</td></tr>
      <tr><th>Transferido</th><td>${C.brl(conf.informado)}</td></tr><tr><th>Diferença</th><td><b>${C.brl(conf.dif)}</b></td></tr></tbody></table>
    <p class="small muted">Com o mês fechado, os relatórios dele não podem ser enviados, trocados ou excluídos, e as decisões não mudam. Dá para reabrir informando o motivo.</p>
    <label class="f">Observação (opcional)<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder="Ex.: conferido com o extrato do Sicredi" /></label>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_fechar_mes', { p_mes: mes, p_nota: nota.trim(), p_resumo: resumo }).then(chk), `${nomeMes(mes)} fechado`)) onClose(); }}>Fechar o mês</button></div><//>`;
}

function ReabrirMesModal({ ctx, mes, onClose }) {
  const [motivo, setMotivo] = useState('');
  return html`<${Modal} title=${'Reabrir ' + nomeMes(mes)} onClose=${onClose}>
    <label class="f">Motivo (obrigatório)<input value=${motivo} onInput=${(e) => setMotivo(e.target.value)} placeholder="Ex.: contabilidade enviou relatório corrigido" /></label>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-danger" disabled=${motivo.trim().length < 3} onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_reabrir_mes', { p_mes: mes, p_motivo: motivo.trim() }).then(chk), `${nomeMes(mes)} reaberto`)) onClose(); }}>Reabrir</button></div><//>`;
}

function RemoverRelatorio({ ctx, r, mes, outros = [], onClose }) {
  const [motivo, setMotivo] = useState('');
  const ultimo = !outros.length;
  return html`<${Modal} title="Excluir relatório" onClose=${onClose}>
    <table class="kv"><tbody>
      <tr><th>Arquivo</th><td><b>${r.arquivo_nome || r.titulo || '—'}</b></td></tr>
      <tr><th>Mês afetado</th><td><b>${nomeMes(mes)}</b></td></tr>
      <tr><th>Créditos de</th><td>${C.fmtD(r.periodo_inicio)} a ${C.fmtD(r.periodo_fim)} <span class="small muted">· ${r.titulo || ''}</span></td></tr>
      <tr><th>Valor final</th><td>${C.brl(C.cents(r.valor_final))} <span class="small muted">(${r.linhas.length} linhas)</span></td></tr></tbody></table>
    <div class=${'banner ' + (ultimo ? 'warn' : 'info')} style="margin:0 0 12px"><span>${ultimo
      ? html`É o <b>único relatório</b> de ${nomeMes(mes)}. O mês volta para <b>“Aguardando relatório”</b> e o botão para enviar outro arquivo fica disponível.`
      : html`${nomeMes(mes)} será recalculado com ${outros.length === 1 ? 'o relatório que continua ativo' : `os ${outros.length} relatórios que continuam ativos`}: ${outros.map((x) => x.arquivo_nome || x.titulo).join(', ')}.`}</span></div>
    <p class="small muted">Os valores lidos deste arquivo saem da conferência. Contratos, parcelas, pagamentos e os outros meses não são alterados. A exclusão fica registrada no histórico e o mesmo arquivo pode ser enviado de novo.</p>
    <label class="f">Motivo (opcional)<input value=${motivo} onInput=${(e) => setMotivo(e.target.value)} placeholder="Ex.: enviar o arquivo corrigido" /></label>
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-danger"
      onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_remover_repasse', { p_id: r.id, p_motivo: motivo.trim().length >= 3 ? motivo.trim() : 'Excluído pelo usuário' }).then(chk), ultimo ? `Relatório excluído. ${nomeMes(mes)} aguarda um novo envio.` : `Relatório excluído. ${nomeMes(mes)} foi recalculado.`)) onClose(); }}>Excluir relatório</button></div><//>`;
}

function ContabilidadeModal({ ctx, onClose }) {
  const { model } = ctx;
  const [nome, setNome] = useState(''); const [sel, setSel] = useState(String(model.contabAtual?.id || ''));
  const salvar = async () => {
    if (await ctx.act(async () => {
      let id = sel;
      if (nome.trim()) { const r = chk(await sb.from('rcb_contabilidades').insert({ nome: nome.trim() }).select().single()); id = String(r.id); }
      if (!id) throw new Error('Escolha ou cadastre uma contabilidade.');
      const existe = (ctx.raw.config || []).some((c) => c.chave === 'contabilidade_atual');
      chk(existe ? await sb.from('rcb_config').update({ valor: id }).eq('chave', 'contabilidade_atual') : await sb.from('rcb_config').insert({ chave: 'contabilidade_atual', valor: id }));
    }, 'Contabilidade atualizada. Os relatórios antigos continuam com a empresa que os emitiu.')) onClose();
  };
  return html`<${Modal} title="Contabilidade" onClose=${onClose}>
    <p class="small muted">A contabilidade atual é usada nos próximos relatórios enviados. Os relatórios já enviados continuam vinculados à empresa que os emitiu.</p>
    <label class="f">Contabilidade atual<select value=${sel} onChange=${(e) => setSel(e.target.value)}>${model.contabilidades.map((c) => html`<option value=${c.id}>${c.nome}</option>`)}</select></label>
    <label class="f" style="margin-top:10px">Ou cadastrar nova empresa (passa a ser a atual)<input value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Nome da contabilidade" /></label>
    ${model.contabilidades.length ? html`<div class="sep"></div><table><thead><tr><th>Empresa</th><th class="num">Relatórios</th></tr></thead><tbody>${model.contabilidades.map((c) => html`<tr><td>${c.nome}${c.id === model.contabAtual?.id ? html` ${Badge('ok', 'atual')}` : ''}</td><td class="num">${model.repasses.filter((r) => r.contabilidade_id === c.id && !r.substituido).length}</td></tr>`)}</tbody></table>` : ''}
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${salvar}>Salvar</button></div><//>`;
}

function ItemRepasse({ ctx, i, mes, onClose }) {
  const [nota, setNota] = useState('');
  const c = CATM[i.cat] || { t: 'Taxa diferente da mais frequente', sev: 'warn' };
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  const credito = i.linha?.tipo === 'credito';
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}><div class="drawer">
    <div class="page-head"><div><p class="small">${credito ? 'Parcela' : i.linha ? (i.ref || 'Lançamento') : 'Pagamento'} · repasse de ${nomeMes(mes)}</p>
      <h1>${i.ctr} · lote ${i.lote} · ${i.ref ? i.ref + ' · ' : ''}parcela ${i.parcelasTxt}</h1><p>${i.comprador}</p></div><button onClick=${onClose}>Fechar</button></div>
    <div class=${'banner ' + (i.dif < 0 ? 'err' : c.neutro ? 'info' : 'warn')}><span><b>Por quê:</b> ${i.why}</span></div>
    <div class="grid cols-2">
      <div class="card"><h2 style="margin-bottom:10px">Valores</h2><dl class="dl">
        ${i.vencimento ? html`<dt>Vencimento</dt><dd>${C.fmtD(i.vencimento)}</dd>` : ''}
        ${i.pagoEm ? html`<dt>Comprador pagou</dt><dd>${C.fmtD(i.pagoEm)} <span class="small muted">(define o mês do repasse)</span></dd>` : ''}
        ${i.data_credito ? html`<dt>Crédito na contabilidade</dt><dd>${C.fmtD(i.data_credito)}</dd>` : ''}
        ${i.bruto ? html`<dt>Valor pago pelo comprador</dt><dd class="num">${C.brl(i.bruto)}${i.encargo ? ` (inclui ${C.brl(i.encargo)} de juros/multa)` : ''}</dd>` : ''}
        ${credito ? html`<dt>Base bruta no relatório</dt><dd class="num">${C.brl(i.base)}</dd><dt>Taxa cobrada</dt><dd class="num">${C.brl(i.taxa)} (${pct(i.taxaPct)})</dd>` : ''}
        ${i.estimado && i.taxa ? html`<dt>Taxa estimada</dt><dd class="num">${C.brl(i.taxa)} (taxa média)</dd>` : ''}
        ${i.desconto ? html`<dt>Desconto</dt><dd class="num">${C.brl(i.desconto)} · ${i.desc || ''}</dd>` : ''}
        <dt>Esperado</dt><dd class="num">${C.brl(i.esp)}</dd><dt>Transferido pela contabilidade</dt><dd class="num">${i.linha ? C.brl(i.inf) : '— (fora dos relatórios)'}</dd>
        <dt>Diferença</dt><dd class="num" style=${i.dif < 0 ? 'color:var(--red);font-weight:600' : ''}>${i.dif ? C.brl(i.dif) : '—'}</dd>
        ${i.repasse ? html`<dt>Relatório</dt><dd>${i.repasse.titulo} (${C.fmtD(i.repasse.periodo_inicio)} a ${C.fmtD(i.repasse.periodo_fim)})${i.repasse.contabilidade ? ' · ' + i.repasse.contabilidade.nome : ''}</dd>` : ''}
      </dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Situação</h2>
        <p>${Badge(SEV[c.sev] || 'atencao', c.t)} ${i.resolvido ? Badge('ok', 'Resolvido') : ''}</p>
        ${i.resolvido ? html`<p class="small"><b>Resolução:</b> ${i.resolucao}</p>` : ''}
        ${!i.resolvido && i.linha && ctx.isAdmin && !c.neutro ? html`<div class="sep"></div><label class="f">Explicação / resposta da contabilidade<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder="Ex.: contabilidade confirmou a taxa de negativação" /></label>
          <div class="modal-actions" style="justify-content:flex-start"><button class="btn-primary" disabled=${nota.trim().length < 3} onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_resolver_linha', { p_id: i.linha.id, p_nota: nota.trim() }).then(chk), 'Item marcado como resolvido')) onClose(); }}>Marcar como resolvido</button></div>
          <p class="small muted">O valor continua na diferença do mês; o item só sai da lista de pendências.</p>` : ''}
        ${!i.linha && !c.neutro ? html`<p class="small muted">Este pagamento não está em nenhum relatório. Quando a contabilidade repassar, a linha é vinculada a este mês automaticamente, pelo mês do pagamento.</p>` : ''}
        ${i.contrato ? html`<div class="sep"></div><a class="btn" href=${'#/contrato/' + i.contrato.id} onClick=${onClose}>Abrir contrato ${i.contrato.id}</a>` : ''}
      </div></div>
  </div></div>`;
}

function EnviarRelatorio({ ctx, mesAtual, substitui, faltando = [], onClose }) {
  const { model } = ctx;
  const [file, setFile] = useState(null); const [lido, setLido] = useState(null); const [erro, setErro] = useState(null);
  const [busy, setBusy] = useState(false); const [mes, setMes] = useState(substitui?.mes || mesAtual); const [quinzena, setQuinzena] = useState(substitui?.quinzena || 0); const [forcar, setForcar] = useState(false);
  const [contab, setContab] = useState(String(substitui?.contabilidade_id || model.contabAtual?.id || ''));
  const ler = async (f) => {
    setFile(f); setErro(null); setLido(null); setBusy(true);
    try {
      const txt = await arquivoParaTexto(f); const r = parseRelatorioMecob(txt);
      if (!r.linhas.length) setErro(ehPlanilha(f) ? 'A planilha foi aberta, mas não encontrei nela as seções do relatório de repasse (CRÉDITOS e TAXAS, com contrato, parcela, vencimento, crédito, honorário e repasse) nem o resumo (Créditos, Taxas, Valor final). Me envie esta planilha para eu ajustar o leitor a este modelo.' : 'Não encontrei linhas de repasse neste arquivo. Ele é o relatório de repasse ("Prestação de Contas / Relatório de movimentações") da contabilidade?');
      setLido(r);
      // competência sugerida pelo período de crédito (o usuário confirma ou troca; a data impressa não define o mês)
      if (!substitui && r.periodo_inicio) { const mid = new Date((Date.parse(r.periodo_inicio + 'T12:00:00Z') + Date.parse((r.periodo_fim || r.periodo_inicio) + 'T12:00:00Z')) / 2); setMes(mid.toISOString().slice(0, 7)); setQuinzena(mid.getUTCDate() <= 15 ? 1 : 2); }
    } catch (e) { setErro('Não foi possível ler o PDF: ' + e.message); }
    setBusy(false);
  };
  const ativos = model.repasses.filter((r) => !r.substituido && r.id !== substitui?.id);
  const chave = (l) => [l.tipo, l.contrato_id, (l.parcelas || []).join('+'), l.data_credito || '', C.cents(l.valor), C.cents(l.honorario || 0), l.referencia || ''].join('|');
  const existentes = new Set(ativos.flatMap((r) => r.linhas.map(chave)));
  const repetidas = lido ? lido.linhas.filter((l) => existentes.has(chave(l))).length : 0;
  const mesmoArquivo = lido && ativos.find((r) => r.titulo === lido.titulo && C.cents(r.valor_final) === C.cents(lido.valor_final) && r.periodo_inicio === lido.periodo_inicio && r.periodo_fim === lido.periodo_fim);
  const semCadastro = lido ? [...new Set(lido.linhas.filter((l) => !model.cmap.has(l.contrato_id)).map((l) => l.contrato_id))] : [];
  const sobrepoe = lido && !mesmoArquivo && quinzena ? ativos.find((r) => r.mes === mes && r.quinzena === quinzena) : null;
  const tm = lido ? (() => { const ls = lido.linhas.filter((l) => l.tipo === 'credito'); const b = ls.reduce((s, l) => s + C.cents(l.valor) + C.cents(l.honorario), 0), t = ls.reduce((s, l) => s + C.cents(l.honorario), 0); return b ? t / b : null; })() : null;
  const salvar = async () => {
    setBusy(true);
    const ok = await ctx.act(async () => {
      const path = `repasses/${mes}/${Date.now()}_${safeName(file.name)}`;
      chk(await sb.storage.from('recebimentos').upload(path, file, { contentType: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream'), upsert: false }));
      chk(await sb.rpc('rcb_salvar_repasse', { p: { mes, titulo: lido.titulo, periodo_inicio: lido.periodo_inicio, periodo_fim: lido.periodo_fim, creditos: lido.creditos, debitos: lido.debitos || 0,
        taxas: lido.taxas || 0, valor_final: lido.valor_final, arquivo_nome: file.name, storage_path: path, linhas: lido.linhas, quinzena, data_relatorio: lido.data_repasse || null, forcar, substitui: substitui?.id || null, contabilidade_id: contab || null } }));
    }, 'Relatório salvo. Conferência atualizada.');
    setBusy(false);
    if (ok) { onClose(); go('#/repasses/' + mes); }
  };
  return html`<${Modal} wide title=${substitui ? 'Substituir relatório da contabilidade' : 'Enviar relatório da contabilidade'} onClose=${onClose}>
    <p class="small muted">Envie o relatório de repasse que a contabilidade manda, em PDF ou Excel (pode ser um por quinzena). O sistema lê a base bruta, a taxa e o valor transferido de cada parcela, além dos outros descontos.</p>
    ${faltando.length && !substitui ? html`<div class="banner warn">Falta para ${nomeMes(mesAtual)}: <b>${faltando.map(periodoTxt).join(' e ')}</b>.</div>` : ''}
    <input type="file" accept=".pdf,.xlsx,.xls,.xlsm,.csv,application/pdf" onChange=${(e) => e.target.files[0] && ler(e.target.files[0])} />
    ${busy && !lido ? html`<p>Lendo o PDF…</p>` : ''}
    ${erro ? html`<div class="banner err" style="margin-top:12px">${erro}</div>` : ''}
    ${lido && lido.linhas.length ? html`<div class="card" style="margin-top:12px"><dl class="dl">
        <dt>Título</dt><dd>${lido.titulo || '—'}</dd><dt>Créditos de</dt><dd>${C.fmtD(lido.periodo_inicio)} a ${C.fmtD(lido.periodo_fim)}</dd>
        <dt>Linhas lidas</dt><dd>${lido.linhas.filter((l) => l.tipo === 'credito').length} parcelas · ${lido.linhas.filter((l) => l.tipo === 'taxa').length} outros descontos · ${lido.linhas.filter((l) => l.tipo === 'debito').length} débitos</dd>
        <dt>Transferido / descontos</dt><dd class="num">${C.brl(C.cents(lido.creditos))} / ${C.brl(C.cents(lido.taxas))}</dd><dt>Valor final</dt><dd class="num"><b>${C.brl(C.cents(lido.valor_final))}</b></dd>
        <dt>Taxa média deste relatório</dt><dd class="num"><b>${pct(tm)}</b> <span class="small muted">soma das taxas ÷ soma das bases das parcelas</span></dd>
        <dt>Contabilidade</dt><dd><select value=${contab} onChange=${(e) => setContab(e.target.value)}>${model.contabilidades.map((c) => html`<option value=${c.id}>${c.nome}</option>`)}</select></dd>
        <dt>Competência</dt><dd><div class="stack" style="gap:8px;align-items:center"><input type="month" value=${mes} onInput=${(e) => setMes(e.target.value)} aria-label="Mês da competência" />
          <select value=${String(quinzena)} onChange=${(e) => setQuinzena(+e.target.value)} aria-label="Quinzena"><option value="0">escolha a quinzena…</option><option value="1">1ª quinzena</option><option value="2">2ª quinzena</option></select>
          ${quinzena ? html`<b>${C.competenciaTxt(mes, quinzena)}</b>` : ''}</div>
          <div class="small muted" style="margin-top:4px">Todos os lançamentos deste arquivo entram na conferência desta competência. As datas de pagamento e de crédito continuam no detalhe.</div></dd>
        <dt>Data impressa no relatório</dt><dd>${lido.data_repasse ? C.fmtD(lido.data_repasse) : '—'} <span class="small muted">guardada só para consulta; não define a competência</span></dd></dl>
      ${lido.avisos.length ? html`<div class="banner warn" style="margin-top:10px"><div>${lido.avisos.map((a) => html`<div>${a}</div>`)}<label style="display:flex;gap:6px;margin-top:6px"><input type="checkbox" checked=${forcar} onChange=${(e) => setForcar(e.target.checked)} /> Conferi o arquivo e quero salvar mesmo assim</label></div></div>` : html`<div class="banner info" style="margin-top:10px">As linhas lidas fecham com o resumo do relatório.</div>`}
      ${semCadastro.length ? html`<div class="banner warn">Contrato(s) do relatório que não estão cadastrados: <b>${semCadastro.join(', ')}</b>. As linhas ficam como pendência até o contrato ser importado.</div>` : ''}
      ${mesmoArquivo ? html`<div class="banner err">Este relatório já foi enviado (mesmo título, período e valor). Para trocar o arquivo, use "Substituir" na lista de relatórios.</div>`
        : sobrepoe ? html`<div class="banner warn">Já existe um relatório para ${C.competenciaTxt(mes, quinzena)}: ${sobrepoe.arquivo_nome} (créditos de ${C.fmtD(sobrepoe.periodo_inicio)} a ${C.fmtD(sobrepoe.periodo_fim)}). Se for complementar, pode salvar; linhas iguais contam uma vez só. Se este arquivo é uma versão corrigida, use <b>Substituir arquivo</b> no menu ⋯ do relatório.${repetidas ? ` ${repetidas} linha(s) repetidas seriam contadas uma vez só.` : ''}</div>`
        : repetidas ? html`<div class="banner warn">${repetidas} de ${lido.linhas.length} linha(s) já constam em outro relatório enviado. Elas serão contadas uma vez só.</div>` : ''}
    </div>` : ''}
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button>
      <button class="btn-primary" disabled=${busy || !lido || !lido.linhas.length || !!mesmoArquivo || !quinzena || !/^\d{4}-\d{2}$/.test(mes) || (lido.avisos.length && !forcar)} onClick=${salvar}>${busy && lido ? 'Salvando…' : 'Salvar e conferir'}</button></div><//>`;
}

function ExtratoModal({ ctx, r, onClose }) {
  const [f, setF] = useState({ status: 'confirmado', data: r.extrato_data || ctx.model.hoje, valor: moneyInput(C.cents(r.extrato_valor ?? r.valor_final)), obs: r.extrato_obs || '' });
  const [file, setFile] = useState(null);
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const v = Math.round((parseMoney(f.valor) || 0) * 100), esperado = C.cents(r.valor_final);
  const salvar = async () => {
    if (f.status === 'confirmado' && v !== esperado && !confirm(`O valor do extrato (${C.brl(v)}) é diferente do valor final do relatório (${C.brl(esperado)}). Marcar como confirmado mesmo assim?`)) return;
    if (await ctx.act(async () => {
      if (file) {
        const path = `repasses/${r.mes}/extrato_${Date.now()}_${safeName(file.name)}`;
        chk(await sb.storage.from('recebimentos').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }));
        chk(await sb.from('rcb_anexos').insert({ nome: file.name, storage_path: path, mime: file.type, tamanho: file.size, descricao: `Extrato do repasse #${r.id} (${r.titulo || ''})` }));
      }
      chk(await sb.rpc('rcb_confirmar_extrato', { p_id: r.id, p_status: f.status, p_data: f.data, p_valor: (v / 100).toFixed(2), p_obs: f.obs || null }));
    }, 'Conferência do extrato registrada')) onClose();
  };
  return html`<${Modal} title="Conferir no extrato bancário" onClose=${onClose}>
    <p class="small muted">${r.titulo} · valor final informado pela contabilidade: <b>${C.brl(esperado)}</b>. Registre o crédito que apareceu no extrato da SM.</p>
    <div class="form-grid"><label class="f">Resultado<select value=${f.status} onChange=${s('status')}><option value="confirmado">Caiu na conta (confirmado)</option><option value="divergente">Valor diferente ou não caiu</option><option value="pendente">Ainda não conferido</option></select></label>
      <label class="f">Data do crédito<input type="date" value=${f.data} onInput=${s('data')} /></label><label class="f">Valor no extrato (R$)<input inputmode="decimal" value=${f.valor} onInput=${s('valor')} /></label>
      <label class="f span3">Observação<input value=${f.obs} onInput=${s('obs')} /></label><label class="f span3">Extrato (opcional)<input type="file" onChange=${(e) => setFile(e.target.files[0])} /></label></div>
    ${v !== esperado ? html`<div class="banner warn" style="margin-top:10px">Diferença entre extrato e relatório: ${C.brl(v - esperado)}</div>` : ''}
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" onClick=${salvar}>Salvar</button></div><//>`;
}

// ---------------------------------------------------------------------------
// Comparar contratos (arquivos enviados x cadastro)
// ---------------------------------------------------------------------------
const GRUPOS_CMP = [['batendo', 'Batendo', 'ok'], ['faltando', 'Faltando no sistema', 'info'], ['semArquivo', 'Sem arquivo correspondente', 'cancelada'], ['divergencia', 'Com divergência', 'atencao'], ['revisao', 'Precisa de revisão', 'critico']];
function CompararPage({ ctx }) {
  const { model } = ctx;
  const [registros, setRegistros] = useState(null); const [lendo, setLendo] = useState(''); const [texto, setTexto] = useState('');
  const [escolhas, setEscolhas] = useState({}); const [aba, setAba] = useState('divergencia');
  const [selImp, setSelImp] = useState({}); const [selCor, setSelCor] = useState({}); const [selPag, setSelPag] = useState({});
  const [confirmar, setConfirmar] = useState(false); const [log, setLog] = useState([]); const [busy, setBusy] = useState(false);
  const [busca, setBusca] = useState(''); const q = busca.trim().toLowerCase();
  const fl = (arr, f) => (q ? arr.filter((x) => f(x).filter(Boolean).join(' ').toLowerCase().includes(q)) : arr);
  const tc = (c) => [c.id, c.comprador?.nome, c.leilao?.nome, c.lote, c.animal];
  const res = useMemo(() => (registros ? compararLote(model, registros, escolhas) : null), [model, registros, escolhas]);
  useEffect(() => {
    if (!res) return;
    setSelImp((o) => { const n = { ...o }; res.faltando.forEach((x) => { if (n[x.chave] === undefined) n[x.chave] = true; }); return n; });
    setSelCor((o) => { const n = { ...o }; res.divergencia.forEach((x) => { if (!n[x.chave]) n[x.chave] = { campos: x.campos.map((c) => c.id), parcelas: x.parcelas.length > 0, ativo: false }; }); return n; });
    setSelPag((o) => { const n = { ...o }; [...res.batendo, ...res.divergencia].forEach((x) => { if (x.pagamentosNovos.length && n[x.chave] === undefined) n[x.chave] = true; }); return n; });
  }, [res]);
  const lerArquivos = async (files) => {
    const out = []; let k = 0;
    for (const f of files) {
      setLendo(`Lendo ${f.name}…`);
      try {
        const t = await arquivoParaTexto(f);
        const regs = lerContratos(t);
        if (!regs.length) out.push({ chave: `${f.name}#0`, arquivo: f.name, erro: /Resumo do repasse|Prestação de Contas|Valor final:/i.test(t) ? 'Este arquivo é um relatório de repasse da contabilidade, não um contrato. Envie-o em Repasses da Contabilidade.' : !t.trim() ? 'O PDF não tem texto (parece imagem escaneada). Envie o PDF gerado pelo sistema de cobrança.' : 'Formato não reconhecido. Aceitos: extrato de contratos da cobrança (texto ou PDF) e Nota de Leilão.' });
        regs.forEach((d, i) => out.push(d.erro ? { chave: `${f.name}#${i}`, arquivo: f.name, erro: d.trecho ? `${d.erro}. Trecho: ${d.trecho.slice(0, 120)}…` : d.erro } : { chave: `${f.name}#${i}#${k++}`, arquivo: f.name, dados: d }));
      } catch (e) { out.push({ chave: `${f.name}#err`, arquivo: f.name, erro: 'Não foi possível ler o arquivo: ' + e.message }); }
    }
    setLendo(''); setEscolhas({}); setSelImp({}); setSelCor({}); setSelPag({}); setLog([]); setRegistros(out);
  };
  const lerTexto = () => lerArquivos([new File([texto], 'texto colado.txt', { type: 'text/plain' })]);
  // despesas do leilão lidas nos Mapas de Venda (comissão de venda, taxa de catálogo…): registro à parte, fora do repasse
  const despesasArq = useMemo(() => {
    if (!registros || !res) return [];
    const cadDe = new Map([...res.batendo, ...res.divergencia].map((x) => [x.chave, x.cad.id]));
    const porArq = new Map();
    for (const r of registros) {
      if (r.erro || r.dados.fonte !== 'mapa_venda' || r.dados.compra) continue;
      const g = porArq.get(r.arquivo) || { arquivo: r.arquivo, leilao: r.dados.leilao, itens: [] };
      for (const d of r.dados.despesas || []) g.itens.push({ ...d, _chave: r.chave, contrato_id: cadDe.get(r.chave) || null, comprador: r.dados.comprador.nome });
      for (const d of r.dados.despesasArquivo || []) g.itens.push({ ...d });
      porArq.set(r.arquivo, g);
    }
    return [...porArq.values()].filter((g) => g.itens.length);
  }, [registros, res]);
  const [selDesp, setSelDesp] = useState(true);
  const acoes = res ? [
    ...res.faltando.filter((x) => selImp[x.chave]).map((x) => ({ tipo: 'importar', x, txt: `Importar contrato ${x.dados.id || '(sem número)'} · ${x.dados.comprador?.nome} · lote ${x.dados.lote || '—'} · ${C.brl(C.cents(x.dados.valor_total))}` })),
    ...res.divergencia.filter((x) => selCor[x.chave]?.ativo && (selCor[x.chave].campos.length || selCor[x.chave].parcelas)).map((x) => ({ tipo: 'corrigir', x, txt: `Corrigir contrato ${x.cad.id}: ${[...selCor[x.chave].campos.map((id) => x.campos.find((c) => c.id === id)?.label), selCor[x.chave].parcelas ? `${x.parcelas.length} parcela(s)` : null].filter(Boolean).join(', ')}` })),
    ...(selDesp ? despesasArq.map((g) => ({ tipo: 'despesas', g, txt: `Registrar ${g.itens.length} despesa(s) do leilão ${g.leilao.nome} (${C.brl(g.itens.reduce((s, d) => s + C.cents(d.valor), 0))}): comissão de venda e taxas, fora do repasse` })) : []),
    ...[...res.batendo, ...res.divergencia].filter((x) => x.pagamentosNovos.length && selPag[x.chave]).map((x) => ({ tipo: 'pagamentos', x, txt: `Registrar ${x.pagamentosNovos.length} pagamento(s) novo(s) no contrato ${x.cad.id} (${C.brl(x.pagamentosNovos.reduce((s, p) => s + p.valor, 0))})` })),
  ] : [];
  const gravar = async () => {
    setBusy(true); const out = [];
    const novos = {};
    for (const a of acoes) {
      if (a.tipo === 'despesas') {
        const itensD = a.g.itens.map(({ _chave, comprador, ...d }) => ({ ...d, contrato_id: d.contrato_id || novos[_chave] || null }));
        const lc = leilaoCanon(ctx.model, a.g.leilao); const rd = await sb.rpc('rcb_registrar_despesas', { p: { leilao: lc, leilao_id: lc.leilao_id || null, arquivo: a.g.arquivo, itens: itensD } });
        out.push({ ok: !rd.error, txt: a.txt, msg: rd.error ? rd.error.message : `${rd.data} nova(s); as já registradas não se repetem` });
        continue;
      }
      const { _sel, _dup, _edit, avisos, status_origem_contrato, ...payload } = a.x.dados;
      let r;
      if (a.tipo === 'importar') r = await sb.rpc('rcb_importar_contrato', { p: { ...payload, leilao: leilaoCanon(model, payload.leilao), revisao: (avisos || []).map((m) => ({ severidade: 'atencao', mensagem: 'Importação: ' + m })), revisao_status_se_ok: 'pendente' } });
      else if (a.tipo === 'corrigir') r = await sb.rpc('rcb_corrigir_contrato', { p_id: a.x.cad.id, p: montarCorrecao(a.x, selCor[a.x.chave].campos, selCor[a.x.chave].parcelas) });
      else r = await sb.rpc('rcb_atualizar_contrato', { p: { ...payload, id: a.x.cad.id } });
      if (a.tipo === 'importar' && !r.error) novos[a.x.chave] = r.data;
      out.push({ ok: !r.error, txt: a.txt, msg: r.error ? r.error.message : 'feito' });
    }
    setLog(out); setBusy(false); setConfirmar(false); await ctx.reload();
    ctx.notify(`${out.filter((x) => x.ok).length} de ${out.length} alteração(ões) gravada(s).`, out.every((x) => x.ok) ? 'ok' : 'err');
  };
  const n = res ? Object.fromEntries(GRUPOS_CMP.map(([k]) => [k, res[k].length])) : {};
  const marcar = (setFn, chave, v) => setFn((o) => ({ ...o, [chave]: v }));
  return html`
    <${AbasAtualizar} atual="comparar" />
    <div class="page-head"><div><h1>Comparar contratos</h1><p>Envie todos os arquivos de uma vez e compare com os contratos cadastrados. Nada é gravado sem a sua confirmação.</p></div>
      </div>
    <div class="card"><div class="filters" style="align-items:center">
      <label class="btn btn-primary">Selecionar arquivos<input type="file" multiple accept=".pdf,.txt,.xlsx,.xls,.xlsm,.csv,application/pdf,text/plain" hidden onChange=${(e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) lerArquivos(fs); }} /></label>
      <span class="small muted">Extrato de contratos da cobrança, Nota de Leilão ou Mapa de Venda, em PDF ou Excel. Pode misturar modelos e selecionar todos juntos (Ctrl+A na janela de arquivos).</span>${lendo ? html`<b>${lendo}</b>` : ''}</div>
      <details style="margin-top:10px"><summary class="small">Ou colar o texto dos contratos</summary><textarea value=${texto} onInput=${(e) => setTexto(e.target.value)}></textarea><button class="btn-sm" disabled=${!texto.trim()} onClick=${lerTexto}>Comparar texto colado</button></details></div>
    ${res ? html`
      <div class="grid kpis" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-top:16px">${GRUPOS_CMP.map(([k, t, cls]) => html`<button class=${'kpi kpi-click' + (aba === k ? ' accent' : '')} onClick=${() => setAba(k)}><div class="lbl">${t}</div><div class="val num">${n[k]}</div><div class="sub">${Badge(cls, 'ver lista')}</div></button>`)}</div>
      <div class="filters" style="margin:12px 0 0"><input type="search" placeholder="Filtrar por contrato, comprador, leilão, lote ou arquivo" value=${busca} onInput=${(e) => setBusca(e.target.value)} style="min-width:320px" />${q ? html`<button class="btn-sm" onClick=${() => setBusca("")}>Limpar filtro</button>` : ""}</div>
      <p class="small muted">${registros.length} registro(s) lidos de ${new Set(registros.map((r) => r.arquivo)).size} arquivo(s). Referência: número do contrato; sem número, comprador + leilão + lote + data.</p>
      ${despesasArq.length ? html`<div class="card"><div class="card-head"><h2>Despesas do leilão nos Mapas de Venda</h2>
          <label class="small" style="display:flex;gap:6px"><input type="checkbox" checked=${selDesp} onChange=${(e) => setSelDesp(e.target.checked)} />Registrar como despesas do leilão</label></div>
        <p class="small muted" style="margin:0 0 8px">Comissão de venda e taxas da leiloeira ficam registradas por leilão, separadas da taxa de repasse da contabilidade (que vem dos relatórios de repasse). Reenviar o mesmo arquivo não duplica.</p>
        <div class="tbl-wrap"><table><thead><tr><th>Leilão</th><th>Despesa</th><th>Lote · comprador</th><th class="num">Valor</th></tr></thead><tbody>
          ${despesasArq.flatMap((g) => g.itens.map((d) => html`<tr><td class="small">${g.leilao.nome} · ${C.fmtD(g.leilao.data)}<div class="muted">${g.arquivo}</div></td><td>${d.descricao}${d.percentual ? ` (${d.percentual}%)` : ''}</td>
            <td class="small">${d.lote ? `lote ${d.lote}${d.comprador ? ' · ' + d.comprador : ''}${d.contrato_id ? ' · contrato ' + d.contrato_id : ''}` : 'leilão (geral)'}</td><td class="num">${C.brl(C.cents(d.valor))}</td></tr>`))}</tbody></table></div></div>` : ''}
      <div class="card">
        ${aba === 'batendo' ? html`<h2>Batendo (${n.batendo})</h2><p class="small muted">Contrato encontrado e dados conferem.</p>
          <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Comprador</th><th>Leilão · lote</th><th>Arquivo</th><th>Pagamentos novos</th></tr></thead><tbody>
          ${fl(res.batendo, (x) => [...tc(x.cad), x.arquivo]).map((x) => html`<tr><td><a href=${'#/contrato/' + x.cad.id}>${x.cad.id}</a></td><td>${x.cad.comprador.nome}</td><td class="small">${x.cad.leilao.nome} · ${x.cad.lote || '—'}</td><td class="small">${x.arquivo}${x.repetidoEm ? html`<div class="muted">também em ${x.repetidoEm.join(', ')}</div>` : ''}</td>
            <td>${x.pagamentosNovos.length ? html`<label class="small" style="display:flex;gap:6px"><input type="checkbox" checked=${!!selPag[x.chave]} onChange=${(e) => marcar(setSelPag, x.chave, e.target.checked)} />Registrar ${x.pagamentosNovos.length} (${C.brl(x.pagamentosNovos.reduce((s, p) => s + p.valor, 0))})</label>` : html`<span class="small muted">—</span>`}</td></tr>`)}</tbody></table></div>` : ''}
        ${aba === 'faltando' ? html`<h2>Faltando no sistema (${n.faltando})</h2><p class="small muted">Marque os contratos que deseja importar. Entram como "pendente de revisão".</p>
          <div class="tbl-wrap"><table><thead><tr><th></th><th>Contrato</th><th>Comprador</th><th>Leilão · lote</th><th>Animal</th><th class="num">Valor</th><th>Entrada</th><th class="num">Parcelas</th><th>Arquivo</th></tr></thead><tbody>
          ${fl(res.faltando, (x) => [...tc(x.dados), x.arquivo]).map((x) => { const d = x.dados, e1 = d.parcelas.find((p) => p.numero === 1); return html`<tr><td><input type="checkbox" checked=${!!selImp[x.chave]} onChange=${(e) => marcar(setSelImp, x.chave, e.target.checked)} /></td>
            <td>${d.id || html`<i>sem número</i>`}</td><td>${d.comprador?.nome || '—'}</td><td class="small">${d.leilao?.nome} · ${d.lote || '—'}</td><td class="small">${d.animal || '—'}</td><td class="num">${C.brl(C.cents(d.valor_total))}</td>
            <td class="small">${e1 ? `${C.brl(C.cents(e1.valor_previsto))} · ${C.fmtD(e1.vencimento)}` : '—'}</td><td class="num"><details><summary>${d.parcelas.length}</summary><div class="small" style="text-align:left;white-space:nowrap">${d.parcelas.map((p) => html`<div>${p.numero}: ${C.brl(C.cents(p.valor_previsto))} · ${C.fmtD(p.vencimento)}${p.pagamento ? " · pago " + C.fmtD(p.pagamento.data) : ""}</div>`)}</div></details></td><td class="small">${x.arquivo}</td></tr>`; })}</tbody></table></div>` : ''}
        ${aba === 'semArquivo' ? html`<h2>Sem arquivo correspondente (${n.semArquivo})</h2><p class="small muted">Contratos cadastrados que ficaram fora deste envio. Nada é alterado neles.</p>
          <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Comprador</th><th>Leilão · lote</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
          ${fl(res.semArquivo, tc).map((c) => html`<tr><td><a href=${'#/contrato/' + c.id}>${c.id}</a></td><td>${c.comprador.nome}</td><td class="small">${c.leilao.nome} · ${c.lote || '—'}</td><td class="num">${C.brl(c.valorC)}</td><td>${Badge(c.situacao, C.SITUACAO_LABEL[c.situacao])}</td></tr>`)}</tbody></table></div>` : ''}
        ${aba === 'divergencia' ? html`<h2>Com divergência (${n.divergencia})</h2><p class="small muted">Arquivo e cadastro lado a lado. Marque "Corrigir este contrato" e os campos que devem receber o valor do arquivo.</p>
          ${!res.divergencia.length ? html`<div class="empty">Nenhuma divergência.</div>` : ''}
          ${fl(res.divergencia, (x) => [...tc(x.cad), x.arquivo]).map((x) => { const s = selCor[x.chave] || { campos: [], parcelas: false, ativo: false }; const upd = (v) => setSelCor((o) => ({ ...o, [x.chave]: { ...s, ...v } }));
            return html`<div class="card" style="margin-top:12px"><div class="card-head"><div><h3>Contrato <a href=${'#/contrato/' + x.cad.id}>${x.cad.id}</a> · ${x.cad.comprador.nome} · lote ${x.cad.lote || '—'}</h3><div class="small muted">Arquivo: ${x.arquivo}${x.porEscolha ? ' · correspondência escolhida por você' : ''}</div></div>
              <label style="display:flex;gap:6px;font-weight:600"><input type="checkbox" checked=${s.ativo} onChange=${(e) => upd({ ativo: e.target.checked })} />Corrigir este contrato</label></div>
              ${x.campos.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Campo</th><th>No arquivo</th><th>No cadastro</th><th>Corrigir</th></tr></thead><tbody>
                ${x.campos.map((c) => html`<tr><td>${c.label}</td><td><b>${c.arquivo}</b></td><td>${c.cadastro}</td><td><input type="checkbox" disabled=${!s.ativo} checked=${s.campos.includes(c.id)} onChange=${(e) => upd({ campos: e.target.checked ? [...s.campos, c.id] : s.campos.filter((y) => y !== c.id) })} /></td></tr>`)}</tbody></table></div>` : ''}
              ${x.parcelas.length ? html`<details open=${x.parcelas.length <= 6} style="margin-top:10px"><summary>${x.parcelas.length} parcela(s) com valor ou vencimento diferente</summary>
                <div class="tbl-wrap"><table><thead><tr><th>Parcela</th><th>Arquivo</th><th>Cadastro</th></tr></thead><tbody>${x.parcelas.map((p) => html`<tr><td>${p.numero}${p.nova ? ' (nova)' : ''}</td><td><b>${C.brl(p.arquivo.valor)} · ${C.fmtD(p.arquivo.venc)}</b></td><td>${p.cadastro ? `${C.brl(p.cadastro.valor)} · ${C.fmtD(p.cadastro.venc)}` : '—'}</td></tr>`)}</tbody></table></div>
                <label class="small" style="display:flex;gap:6px;margin-top:6px"><input type="checkbox" disabled=${!s.ativo} checked=${s.parcelas} onChange=${(e) => upd({ parcelas: e.target.checked })} />Corrigir essas parcelas com os valores do arquivo</label></details>` : ''}
              ${x.pagamentosNovos.length ? html`<label class="small" style="display:flex;gap:6px;margin-top:8px"><input type="checkbox" checked=${!!selPag[x.chave]} onChange=${(e) => marcar(setSelPag, x.chave, e.target.checked)} />Registrar ${x.pagamentosNovos.length} pagamento(s) novo(s) do arquivo (${C.brl(x.pagamentosNovos.reduce((t, p) => t + p.valor, 0))})</label>` : ''}
            </div>`; })}` : ''}
        ${aba === 'revisao' ? html`<h2>Precisa de revisão (${n.revisao})</h2>
          ${!res.revisao.length ? html`<div class="empty">Nada para revisar.</div>` : ''}
          ${fl(res.revisao, (r) => [r.arquivo, r.msg, r.id]).map((r) => html`<div class="rev-item">${Badge(r.tipo === 'ilegivel' ? 'critico' : r.tipo === 'compra' ? 'cancelada' : 'atencao', r.tipo === 'ilegivel' ? 'Arquivo não lido' : r.tipo === 'compra' ? 'Contrato de compra' : r.tipo === 'duplicidade' ? 'Possível duplicidade' : 'Correspondência incerta')}
            <div class="msg small"><b>${r.arquivo || ''}</b> ${r.msg}
              ${r.tipo === 'incerta' ? html`<div class="stack" style="margin-top:6px">${r.opcoes.map((o) => html`<button class="btn-sm" onClick=${() => setEscolhas((e) => ({ ...e, [r.chave]: o.c.id }))}>É o contrato ${o.c.id} · ${o.c.comprador.nome} · lote ${o.c.lote || '—'} · ${o.c.animal || '—'}${o.s.animal ? ' (animal confere)' : ''} (${o.s.total}/4 dados iguais)</button>`)}
                <button class="btn-sm" onClick=${() => setEscolhas((e) => ({ ...e, [r.chave]: 'novo' }))}>É um contrato novo</button></div>` : ''}
              ${r.tipo === 'duplicidade' && r.registros ? html`<div class="stack" style="margin-top:6px">${r.registros.map((x) => html`<button class="btn-sm" onClick=${() => setEscolhas((e) => ({ ...e, ['dup:' + r.id]: x.chave }))}>Usar ${x.arquivo} (${C.brl(C.cents(x.dados.valor_total))}, ${x.dados.parcelas.length} parcelas)</button>`)}</div>` : ''}
            </div></div>`)}` : ''}
      </div>
      <div class="card" style="position:sticky;bottom:0;z-index:5"><div class="card-head"><span><b>${acoes.length}</b> alteração(ões) selecionada(s)</span>
        ${ctx.isAdmin ? html`<button class="btn-primary" disabled=${!acoes.length || busy} onClick=${() => setConfirmar(true)}>Revisar e gravar</button>` : html`<span class="small muted">Somente administradores gravam alterações.</span>`}</div>
        ${log.length ? html`<div class="sep"></div>${log.map((l) => html`<div class="small" style=${l.ok ? 'color:var(--em-700)' : 'color:var(--red)'}>${l.ok ? '✓' : '✗'} ${l.txt} — ${l.msg}</div>`)}` : ''}</div>
      ${confirmar ? html`<${Modal} wide title="Confirmar alterações" onClose=${() => setConfirmar(false)}>
        <p>Estas alterações serão gravadas. Tudo fica registrado no histórico.</p>
        <ul class="items">${acoes.map((a) => html`<li>${a.txt}</li>`)}</ul>
        ${acoes.some((a) => a.tipo === 'corrigir' && selCor[a.x.chave].campos.some((c) => c === 'comprador' || c === 'documento')) ? html`<div class="banner warn">Correções de comprador valem para todos os contratos desse comprador.</div>` : ''}
        <div class="modal-actions"><button onClick=${() => setConfirmar(false)}>Voltar</button><button class="btn-primary" disabled=${busy} onClick=${gravar}>${busy ? 'Gravando…' : 'Confirmar e gravar'}</button></div><//>` : ''}
    ` : html`<div class="empty">Selecione os arquivos para comparar.</div>`}`;
}

// ---------------------------------------------------------------------------
// Inadimplência
// ---------------------------------------------------------------------------
function InadPage({ ctx }) {
  const { model } = ctx;
  const [f, setF] = useStored('inad', { leilao: '', comprador: '', contrato: '', base: 'todos', de: '', ate: '' });
  const [faixa, setFaixa] = useState('');
  const contratos = C.filtrarContratos(model, f);
  const d = C.inadimplencia(model, contratos);
  const ranking = faixa ? d.ranking.filter((r) => r.faixas[faixa]) : d.ranking;
  const [open, setOpen] = useState(null);
  return html`
    <div class="page-head"><div><h1>Inadimplência</h1><p>Parcelas vencidas e não quitadas em ${C.fmtD(model.hoje)}</p></div></div>
    <div class="card" style="margin-bottom:16px"><${FiltroBase} model=${model} f=${f} setF=${setF} campos=${['leilao', 'comprador', 'base']} /></div>
    <div class="grid kpis">
      ${C.FAIXAS.map((fx) => html`<div class=${'kpi ' + (fx.id === '90+' ? 'red' : 'gold')} style=${'cursor:pointer;' + (faixa === fx.id ? 'outline:2px solid var(--em-700)' : '')} onClick=${() => setFaixa(faixa === fx.id ? '' : fx.id)}>
        <div class="lbl">${fx.id === '90+' ? 'Mais de 90 dias' : fx.id + ' dias'}</div><div class="val num">${C.brl(d.faixas[fx.id].valor)}</div><div class="sub">${d.faixas[fx.id].qtd} parcela(s) · clique para filtrar</div></div>`)}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Ranking dos maiores valores em atraso${faixa ? ` · faixa ${faixa}` : ''}</h2><b class="num">Total: ${C.brl(d.total)}</b></div>
      ${ranking.length ? html`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Comprador</th><th>Contato</th><th class="num">Valor em atraso</th><th class="num">Parcelas</th><th class="num">Maior atraso</th><th>Contratos</th></tr></thead><tbody>
        ${ranking.map((r, i) => html`<tr class="click" onClick=${() => setOpen(open === i ? null : i)}><td>${i + 1}</td><td><b>${r.comprador.nome}</b><div class="small muted">${C.fmtDoc(r.comprador.documento)}</div></td>
          <td class="small">${r.comprador.telefone || '—'}<div class="muted">${r.comprador.email || ''}</div></td><td class="num" style="color:var(--red);font-weight:600">${C.brl(r.valor)}</td><td class="num">${r.qtd}</td><td class="num">${r.maxDias} dias</td>
          <td>${[...r.contratos].map((id) => html`<a href=${'#/contrato/' + id} onClick=${(e) => e.stopPropagation()}>${id}</a> `)}</td></tr>
          ${open === i ? html`<tr><td colspan="7" style="background:#fafbfa"><${HistComprador} model=${model} r=${r} /></td></tr>` : ''}`)}
      </tbody></table></div>` : html`<div class="empty">Nenhuma parcela em atraso no filtro.</div>`}</div>`;
}
function HistComprador({ model, r }) {
  const cts = model.contratos.filter((c) => c.comprador_id === r.comprador.id);
  const pags = cts.flatMap((c) => c.parcelas.flatMap((p) => p.ativos.map((g) => ({ ...g, p, c })))).sort((a, b) => (a.data_pagamento < b.data_pagamento ? 1 : -1));
  return html`<div class="grid cols-2"><div><h3>Parcelas em atraso</h3><table><thead><tr><th>Contrato</th><th>Parcela</th><th>Vencimento</th><th class="num">Saldo</th><th class="num">Dias</th></tr></thead><tbody>
    ${r.parcelas.map((p) => html`<tr><td><a href=${'#/contrato/' + p.contrato_id}>${p.contrato_id}</a></td><td>${p.numero}/${p.contrato.nParc}</td><td>${C.fmtD(p.vencimento)}</td><td class="num">${C.brl(p.saldo)}</td><td class="num">${p.dias}</td></tr>`)}</tbody></table></div>
    <div><h3>Histórico de pagamentos (últimos 12)</h3><table><thead><tr><th>Data</th><th>Contrato</th><th>Parcela (venc.)</th><th class="num">Valor</th></tr></thead><tbody>
    ${pags.slice(0, 12).map((g) => html`<tr><td>${C.fmtD(g.data_pagamento)}</td><td>${g.c.id}</td><td>${g.p.numero} (${C.fmtD(g.p.vencimento)})</td><td class="num">${C.brl(g.valorC)}</td></tr>`)}
    ${!pags.length ? html`<tr><td colspan="4" class="muted">Nenhum pagamento registrado.</td></tr>` : ''}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------------------
// Central de revisão
// ---------------------------------------------------------------------------
function ItensRevisao({ ctx, c }) {
  const [res, setRes] = useState(null); const [nota, setNota] = useState('');
  const abertos = c.revisao.filter((r) => !r.resolvido).sort((a, b) => ['critico', 'atencao', 'info'].indexOf(a.severidade) - ['critico', 'atencao', 'info'].indexOf(b.severidade));
  const resolvidos = c.revisao.filter((r) => r.resolvido);
  return html`<div>
    ${abertos.map((r) => html`<div class="rev-item">${Badge(r.severidade, sevLabel[r.severidade])}<div class="msg small">${r.mensagem}</div>
      ${ctx.isAdmin ? (res === r.id ? html`<div class="stack"><input placeholder="Como foi resolvido?" value=${nota} onInput=${(e) => setNota(e.target.value)} />
        <button class="btn-sm btn-primary" disabled=${nota.trim().length < 3} onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_resolver_item', { p_item: r.id, p_nota: nota.trim() }).then(chk), 'Item resolvido')) { setRes(null); setNota(''); } }}>OK</button><button class="btn-sm" onClick=${() => setRes(null)}>×</button></div>`
        : html`<button class="btn-sm" onClick=${() => { setRes(r.id); setNota(''); }}>Resolver</button>`) : ''}</div>`)}
    ${!abertos.length ? html`<div class="small muted">Nenhuma pendência em aberto.</div>` : ''}
    ${resolvidos.length ? html`<details style="margin-top:8px"><summary class="small">${resolvidos.length} item(ns) resolvido(s)</summary>${resolvidos.map((r) => html`<div class="rev-item">${Badge('ok', 'Resolvido')}<div class="msg small">${r.mensagem}<div class="muted">→ ${r.resolucao} · ${r.resolvido_em ? new Date(r.resolvido_em).toLocaleString('pt-BR', { timeZone: C.TZ }) : ''}</div></div></div>`)}</details>` : ''}
  </div>`;
}
function RevisaoPage({ ctx }) {
  const { model, isAdmin } = ctx;
  const [sev, setSev] = useState(''); const [aprov, setAprov] = useState(null); const [nota, setNota] = useState('');
  const [modal, setModal] = useState(null);
  const lista = model.contratos.filter((c) => !c.arquivado && (c.revisao_status !== 'aprovado' || c.pendRev.some((r) => r.severidade !== 'info')))
    .filter((c) => !sev || c.pendRev.some((r) => r.severidade === sev))
    .sort((a, b) => b.pendRev.filter((r) => r.severidade === 'critico').length - a.pendRev.filter((r) => r.severidade === 'critico').length || b.id - a.id);
  const cont = (s) => model.contratos.filter((c) => !c.arquivado).reduce((n, c) => n + c.pendRev.filter((r) => r.severidade === s).length, 0);
  const aprovados = model.contratos.filter((c) => !c.arquivado && c.revisao_status === 'aprovado').length;
  const fora = model.contratos.filter((c) => !c.arquivado).reduce((s, c) => s + c.foraC, 0);
  const semSM = model.contratos.filter((c) => !c.arquivado && c.participacao_sm_pct == null).length;
  return html`
    <div class="page-head"><div><h1>Central de revisão</h1><p>Conferência dos dados importados antes de consolidar os indicadores</p></div>
      ${isAdmin ? html`<button onClick=${() => ctx.act(() => sb.rpc('rcb_conferir_todos').then(chk), 'Conferência geral refeita')}>Reexecutar conferência geral</button>` : ''}</div>
    <div class="grid kpis">
      <${Kpi} cls="red" lbl="Itens críticos" val=${cont('critico')} sub="Bloqueiam a consolidação" />
      <${Kpi} cls="gold" lbl="Itens de atenção" val=${cont('atencao')} />
      <${Kpi} lbl="Informativos" val=${cont('info')} />
      <${Kpi} cls="accent" lbl="Contratos aprovados" val=${`${aprovados} / ${model.contratos.filter((c) => !c.arquivado).length}`} />
    </div>
    <div class="banner info" style="margin-top:14px"><div><b>Pontos gerais identificados na base:</b><ul class="items" style="margin-top:6px">
      <li><b>Participação da SM:</b> ${semSM} contrato(s) sem percentual da SM informado. Os indicadores usam o valor bruto do contrato. Informe o percentual em “Editar dados” se a SM não detiver 100% do valor.</li>
      <li><b>Valores fora do cronograma:</b> ${C.brl(fora)} correspondem a entradas/parcelas que a cobrança mostra como liquidadas no cadastro ou pagas direto ao vendedor com valor zerado. Não são contados como recebidos.</li>
      <li><b>Encargos:</b> parcelas pagas com atraso aparecem com o valor já acrescido de multa/juros (valor exibido pela cobrança).</li></ul></div></div>
    <div class="stack" style="margin:14px 0"><span class="small muted">Filtrar:</span>${[['', 'Todos'], ['critico', 'Críticos'], ['atencao', 'Atenção'], ['info', 'Informativos']].map(([k, t]) => html`<button class=${'btn-sm' + (sev === k ? ' btn-primary' : '')} onClick=${() => setSev(k)}>${t}</button>`)}</div>
    ${lista.length ? lista.map((c) => html`<div class="card">
      <div class="card-head"><div><h2><a href=${'#/contrato/' + c.id}>Contrato ${c.id}</a> · ${c.comprador.nome}</h2>
        <div class="small muted">${c.leilao.nome} · lote ${c.lote || '—'} · ${C.brl(c.valorC)} · ${c.nParc} parcelas · soma ${C.brl(c.prevC)}</div></div>
        <div class="stack">${Badge(c.revisao_status, c.revisao_status === 'aprovado' ? 'Aprovado' : 'Pendente')}
          ${isAdmin ? html`<button class="btn-sm" onClick=${() => setModal({ t: 'editar', c })}>Editar dados</button><button class="btn-sm" onClick=${() => setModal({ t: 'parcelas', c })}>Editar parcelas</button>
          <button class="btn-sm btn-danger" onClick=${() => setModal({ t: 'arquivar', c })}>Arquivar</button>
          ${c.revisao_status !== 'aprovado' ? html`<button class="btn-sm btn-primary" onClick=${() => { setAprov(c.id); setNota(''); }}>Aprovar</button>` : ''}` : ''}</div></div>
      <${ItensRevisao} ctx=${ctx} c=${c} />
      ${aprov === c.id ? html`<div class="banner warn" style="margin-top:10px"><div style="flex:1"><b>Aprovar contrato ${c.id}</b>: todos os itens abertos serão marcados como resolvidos com a nota abaixo.
        ${c.pendRev.some((r) => r.severidade === 'critico') ? html`<br /><b>Atenção: há itens críticos.</b> Aprove somente após confirmar com a documentação.` : ''}
        <div class="stack" style="margin-top:8px"><input style="flex:1" placeholder="Nota de aprovação (ex.: conferido com contrato assinado)" value=${nota} onInput=${(e) => setNota(e.target.value)} />
        <button class="btn-primary btn-sm" disabled=${nota.trim().length < 3} onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_aprovar_contrato', { p_id: c.id, p_nota: nota.trim() }).then(chk), 'Contrato aprovado')) setAprov(null); }}>Confirmar aprovação</button>
        <button class="btn-sm" onClick=${() => setAprov(null)}>Cancelar</button></div></div></div>` : ''}
    </div>`) : html`<div class="card empty">Nenhum contrato pendente de revisão.</div>`}
    ${modal?.t === 'editar' ? html`<${EditarContratoModal} ctx=${ctx} c=${modal.c} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'parcelas' ? html`<${EditarParcelasModal} ctx=${ctx} c=${modal.c} onClose=${() => setModal(null)} />` : ''}
    ${modal?.t === 'arquivar' ? html`<${ArquivarModal} ctx=${ctx} c=${modal.c} onClose=${() => setModal(null)} />` : ''}`;
}

// ---------------------------------------------------------------------------
// Importação / novo contrato
// ---------------------------------------------------------------------------
function ImportarPage({ ctx }) {
  const [aba, setAba] = useState('texto');
  const [texto, setTexto] = useState('');
  const [itens, setItens] = useState(null);
  const [arquivos, setArquivos] = useState({}); // nome → File (anexado ao contrato importado)
  const [naoLidos, setNaoLidos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  // prepara os registros lidos: contrato já cadastrado (pelo número ou por leilão + data + lote + comprador), compra, novo
  const preparar = (regs) => regs.map((x, k) => {
    if (x.erro) return x;
    if (x.leilao) x = { ...x, leilao: leilaoCanon(ctx.model, x.leilao) };
    if (x.compra) return { ...x, _sel: false, _compra: true };
    if (x.id && ctx.model.cmap.has(x.id)) return { ...x, _sel: true, _dup: true };
    if (!x.id) {
      const r = compararLote(ctx.model, [{ chave: 'k' + k, arquivo: x._arquivo || '', dados: x }]);
      const achado = r.batendo[0] || r.divergencia[0];
      if (achado) return { ...x, _sel: false, _existe: achado.cad.id, _difs: achado.campos.length + achado.parcelas.length };
      const inc = r.revisao.find((y) => y.tipo === 'incerta');
      if (inc) return { ...x, _sel: false, _opcoes: inc.opcoes.map((o) => o.c.id) };
    }
    return { ...x, _sel: true, _dup: false };
  });
  const ler = (t = texto) => { setItens(preparar(lerContratos(t).map((x) => ({ ...x, _arquivo: 'texto colado' })))); setLog([]); setNaoLidos([]); };
  const lerArquivos = async (files) => {
    setBusy(true); const regs = [], falhas = [], mapa = {};
    for (const f of files) {
      try {
        const t = await arquivoParaTexto(f); mapa[f.name] = f;
        const r = lerContratos(t);
        if (!r.length) falhas.push({ nome: f.name, msg: /Resumo do repasse|Prestação de Contas|Valor final:/i.test(t) ? 'é um relatório de repasse da contabilidade; envie em Repasses da Contabilidade' : !t.trim() ? 'sem texto (PDF escaneado?)' : 'formato não reconhecido' });
        r.forEach((x) => regs.push({ ...x, _arquivo: f.name }));
      } catch (e) { falhas.push({ nome: f.name, msg: 'não foi possível ler: ' + e.message }); }
    }
    setArquivos(mapa); setNaoLidos(falhas); setItens(preparar(regs)); setLog([]); setBusy(false);
  };
  const upd = (i, path, v) => setItens((xs) => xs.map((x, j) => { if (j !== i) return x; const y = structuredClone(x); const ks = path.split('.'); let o = y; ks.slice(0, -1).forEach((k) => (o = o[k])); o[ks.at(-1)] = v; return y; }));
  const importar = async () => {
    const sel = itens.filter((x) => x._sel);
    if (!sel.length) return;
    const nNovos = sel.filter((x) => !x._dup).length, nAtual = sel.length - nNovos;
    if (!confirm(`${nNovos ? `Importar ${nNovos} contrato(s) novo(s) (entram como "pendente de revisão")` : ''}${nNovos && nAtual ? ' e ' : ''}${nAtual ? `atualizar ${nAtual} contrato(s) já cadastrado(s) (só pagamentos e situações novas)` : ''}?`)) return;
    setBusy(true); const out = [];
    for (const x of sel) {
      const { _sel, _dup, _edit, _arquivo, _compra, _existe, _opcoes, _difs, _feito, avisos, status_origem_contrato, compra, despesas, despesasArquivo, totalDespesasArquivo, registro, tipo_doc, leiloeira, ...payload } = x;
      if (_dup) {
        const r = await sb.rpc('rcb_atualizar_contrato', { p: payload });
        out.push(r.error ? { id: x.id, ok: false, msg: r.error.message } : { id: x.id, ok: true, msg: `Atualizado: ${r.data.pagamentos_novos} pagamento(s) novo(s), ${r.data.parcelas_novas} parcela(s) nova(s)${r.data.valores_divergentes ? `, ${r.data.valores_divergentes} valor(es) diferente(s) para revisar` : ''}` });
        continue;
      }
      payload.revisao = (avisos || []).map((m) => ({ severidade: 'atencao', mensagem: 'Importação: ' + m }));
      payload.revisao_status_se_ok = 'pendente';
      const r = await sb.rpc('rcb_importar_contrato', { p: payload });
      if (r.error) out.push({ id: x.id, ok: false, msg: r.error.message });
      else {
        out.push({ id: r.data, ok: true, msg: 'Importado' });
        x._novoId = r.data;
        const fArq = arquivos[x._arquivo];
        if (fArq) { try { await uploadAnexo(fArq, { contrato_id: r.data, descricao: `Documento de origem da importação (${x.tipo_doc || 'extrato da cobrança'})` }); } catch (e) { out.push({ id: r.data, ok: false, msg: 'Contrato importado, mas o arquivo não foi anexado: ' + e.message }); } }
      }
    }
    // despesas do leilão (comissão de venda, taxa de catálogo…) dos Mapas de Venda importados; nunca entram no repasse
    for (const nomeArq of [...new Set(sel.filter((x) => x._novoId && x.fonte === 'mapa_venda').map((x) => x._arquivo))]) {
      const doArq = itens.filter((x) => x._arquivo === nomeArq && !x.erro);
      const lista = [...sel.filter((x) => x._novoId && x._arquivo === nomeArq).flatMap((x) => (x.despesas || []).map((d) => ({ ...d, contrato_id: x._novoId }))), ...(doArq.find((x) => x.despesasArquivo)?.despesasArquivo || [])];
      if (!lista.length) continue;
      const r = await sb.rpc('rcb_registrar_despesas', { p: { leilao: doArq[0].leilao, leilao_id: doArq[0].leilao.leilao_id || null, arquivo: nomeArq, itens: lista } });
      out.push(r.error ? { id: nomeArq, ok: false, msg: 'Despesas do leilão não registradas: ' + r.error.message } : { id: nomeArq, ok: true, msg: `${r.data} despesa(s) do leilão registrada(s)` });
    }
    setLog(out); setBusy(false); await ctx.reload();
    setItens((xs) => xs.map((x) => (out.find((o) => o.ok && o.id === x.id) ? { ...x, _sel: false, _dup: true, _feito: true } : x)));
  };
  return html`
    <${AbasAtualizar} atual="importar" />
    <div class="page-head"><div><h1>Importar novos contratos</h1><p>Contratos novos entram como “pendente de revisão” até serem conferidos</p></div>
      </div>
    <div class="pill-tabs">${[['texto', 'Colar texto da cobrança'], ['pdf', 'Enviar arquivos (PDF ou Excel)'], ['manual', 'Cadastro manual']].map(([k, t]) => html`<button class=${aba === k ? 'on' : ''} onClick=${() => setAba(k)}>${t}</button>`)}</div>
    ${aba === 'manual' ? html`<${CadastroManual} ctx=${ctx} />` : html`
    <div class="card">
      ${aba === 'texto' ? html`<p class="small muted">Copie a tela do contrato no sistema de cobrança (do “Evento:” até a última parcela) e cole abaixo. Vários contratos podem ser colados de uma vez.</p>
        <textarea style="min-height:200px" value=${texto} onInput=${(e) => setTexto(e.target.value)} placeholder="Evento: ... Contrato 12345 - ... Parcela Valor Vencimento Pagamento ..."></textarea>
        <div class="stack" style="margin-top:10px"><button class="btn-primary" disabled=${!texto.trim()} onClick=${() => ler()}>Ler contratos</button></div>`
      : html`<p class="small muted">Envie um ou vários arquivos de uma vez (PDF ou Excel): extrato de contratos da cobrança, Nota de Leilão ou Mapa de Venda. Os dados são pré-preenchidos para conferência e o arquivo é anexado ao contrato importado.</p>
        <input type="file" multiple accept=".pdf,.xlsx,.xls,.xlsm,.csv,.txt,application/pdf" onChange=${(e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) lerArquivos(fs); }} /> ${busy ? 'Lendo…' : ''}
        ${naoLidos.length ? html`<div class="banner warn" style="margin-top:10px"><div>${naoLidos.map((n) => html`<div><b>${n.nome}</b>: ${n.msg}</div>`)}</div></div>` : ''}
`}
    </div>
    ${itens && itens.length ? html`<div class="card"><div class="card-head"><h2>Conferência antes de importar (${itens.length})</h2>
      <button class="btn-primary" disabled=${busy || !itens.some((x) => x._sel)} onClick=${importar}>${busy ? 'Importando…' : `Importar ${itens.filter((x) => x._sel).length} selecionado(s)`}</button></div>
      ${itens.map((x, i) => x.erro ? html`<div class="banner err">${x.erro}: <span class="small">${x.trecho}</span></div>` : html`<div class="rev-item" style="flex-wrap:wrap">
        <input type="checkbox" checked=${x._sel} disabled=${x._feito || x._compra} onChange=${(e) => upd(i, '_sel', e.target.checked)} />
        <div class="msg"><b>${x.id ? 'Contrato ' + x.id : 'Sem número de contrato'}</b> · ${x.comprador.nome || '(sem nome)'} · ${x.leilao.nome} (${C.fmtD(x.leilao.data)}) · lote ${x.lote || '—'}${x.tipo_doc ? html` ${Badge('cancelada', x.tipo_doc)}` : ''}<br />
          <span class="small muted">${x._arquivo}${x.registro ? ' · registro ' + x.registro : ''}${x.despesas?.length ? ' · comissão de venda ' + C.brl(C.cents(x.despesas[0].valor)) + ' (' + x.despesas[0].percentual + '%) — despesa do leilão' : ''}</span><br />
          <span class="small">${x.descricao}</span><br /><span class="small">Valor ${C.brl(C.cents(x.valor_total))} · ${x.parcelas.length} parcelas · soma ${C.brl(x.parcelas.reduce((s, p) => s + C.cents(p.valor_previsto), 0))} · ${x.parcelas.filter((p) => p.pagamento).length} pagamentos com valor · ${x.parcelas.filter((p) => p.liquidacao_externa).length} liquidadas sem valor</span>
          ${x._feito ? html`<div>${Badge('ok', 'Processado')}</div>` : x._compra ? html`<div>${Badge('cancelada', 'Contrato de compra: não entra nos recebimentos')}</div>` : x._existe ? html`<div>${Badge('pendente', `Já cadastrado como contrato ${x._existe}`)} <span class="small">${x._difs ? `${x._difs} diferença(s): confira e corrija em <a href="#/comparar">Comparar contratos</a>` : 'dados conferem'}. Não será importado de novo.</span></div>` : x._opcoes ? html`<div>${Badge('atencao', 'Possível duplicidade')} <span class="small">parecido com ${x._opcoes.map((id) => html`<a href=${'#/contrato/' + id}>${id}</a> `)}— decida em <a href="#/comparar">Comparar contratos</a> ou marque para importar como novo.</span></div>` : x._dup ? html`<div>${Badge('pendente', 'Já cadastrado: será atualizado (pagamentos novos), sem duplicar')}</div>` : html`<div>${Badge('info', 'Contrato novo')}</div>`}
          ${x.avisos.length ? html`<ul class="items small" style="margin-top:4px;color:var(--amber)">${x.avisos.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
          ${x._edit ? html`<div class="form-grid" style="margin-top:8px">
            <label class="f">Leilão<input value=${x.leilao.nome} onInput=${(e) => upd(i, 'leilao.nome', e.target.value)} /></label><label class="f">Data do leilão<input type="date" value=${x.leilao.data} onInput=${(e) => upd(i, 'leilao.data', e.target.value)} /></label>
            <label class="f">Lote<input value=${x.lote} onInput=${(e) => upd(i, 'lote', e.target.value)} /></label>
            <label class="f">Comprador<input value=${x.comprador.nome} onInput=${(e) => upd(i, 'comprador.nome', e.target.value)} /></label><label class="f">CPF/CNPJ<input value=${x.comprador.documento} onInput=${(e) => upd(i, 'comprador.documento', e.target.value)} /></label>
            <label class="f">E-mail<input value=${x.comprador.email} onInput=${(e) => upd(i, 'comprador.email', e.target.value)} /></label>
            <label class="f">Valor total<input value=${x.valor_total} onInput=${(e) => upd(i, 'valor_total', String(parseMoney(e.target.value)))} /></label>
            <label class="f">Tipo<select value=${x.tipo_venda} onChange=${(e) => upd(i, 'tipo_venda', e.target.value)}>${Object.entries(C.TIPO_LABEL).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></label>
            <label class="f">Animal<input value=${x.animal} onInput=${(e) => upd(i, 'animal', e.target.value)} /></label></div>` : ''}
        </div><button class="btn-sm" onClick=${() => upd(i, '_edit', !x._edit)}>${x._edit ? 'Fechar edição' : 'Corrigir dados'}</button></div>`)}
      ${log.length ? html`<div class="sep"></div>${log.map((l) => html`<div class=${'small ' + (l.ok ? '' : 'muted')} style=${l.ok ? 'color:var(--em-700)' : 'color:var(--red)'}>${/^\d+$/.test(String(l.id)) ? 'Contrato ' + l.id : l.id || 'Contrato'}: ${l.msg}</div>`)}` : ''}
    </div>` : itens ? html`<div class="card empty">Nenhum contrato reconhecido no texto.</div>` : ''}`}`;
}

function addMonths(iso, k, anchor) {
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(anchor, dim)).padStart(2, '0')}`;
}
function CadastroManual({ ctx }) {
  const leiloes = [...ctx.model.leiloes].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const [f, setF] = useState({ id: '', leilaoSel: '', lnome: '', ldata: '', llocal: '', cnome: '', cdoc: '', cemail: '', ctel: '', descricao: '', animal: '', acasalamento: '', tipo_venda: 'nao_identificado', percentual: '', lote: '', data_contrato: ctx.model.hoje, valor_total: '', vendedor: '', condicoes: '', obs: '' });
  const [g, setG] = useState({ entrada: '', entradaData: '', qtd: '30', valor: '', primeiro: '', intervalo: '1' });
  const [parc, setParc] = useState([]);
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const sg = (k) => (e) => setG((o) => ({ ...o, [k]: e.target.value }));
  const gerar = () => {
    const out = []; let n = 1;
    const ent = parseMoney(g.entrada);
    if (ent > 0) { if (!g.entradaData) return ctx.notify('Informe a data da entrada.', 'err'); out.push({ numero: n++, vencimento: g.entradaData, valor: moneyInput(Math.round(ent * 100)), pago: '', valorPago: '' }); }
    const q = parseInt(g.qtd, 10), v = parseMoney(g.valor), iv = parseInt(g.intervalo, 10) || 1;
    if (!(q > 0) || !(v >= 0) || !g.primeiro) return ctx.notify('Preencha quantidade, valor e primeiro vencimento.', 'err');
    const anchor = +g.primeiro.slice(8, 10);
    for (let i = 0; i < q; i++) out.push({ numero: n++, vencimento: addMonths(g.primeiro, i * iv, anchor), valor: moneyInput(Math.round(v * 100)), pago: '', valorPago: '' });
    setParc(out);
  };
  const setP = (i, k, v) => setParc((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const soma = parc.reduce((s2, p) => s2 + Math.round((parseMoney(p.valor) || 0) * 100), 0);
  const total = Math.round((parseMoney(f.valor_total) || 0) * 100);
  const salvar = async () => {
    const lei = f.leilaoSel ? leiloes.find((l) => String(l.id) === f.leilaoSel) : { nome: f.lnome, data: f.ldata, local: f.llocal };
    if (!lei?.nome || !f.cnome || !f.descricao || !total || !parc.length) return ctx.notify('Preencha leilão, comprador, descrição, valor e gere as parcelas.', 'err');
    for (const p of parc) if (p.pago && (p.pago > ctx.model.hoje || !(parseMoney(p.valorPago || p.valor) > 0))) return ctx.notify(`Parcela ${p.numero}: pagamento inválido.`, 'err');
    if (soma !== total && !confirm(`A soma das parcelas (${C.brl(soma)}) difere do valor do contrato (${C.brl(total)}). Salvar assim mesmo? O contrato ficará sinalizado na revisão.`)) return;
    setBusy(true);
    const payload = {
      id: f.id ? Number(f.id) : null, fonte: 'manual', revisao_status_se_ok: 'pendente',
      leilao: { nome: lei.nome, data: lei.data || '', local: lei.local || '' }, comprador: { nome: f.cnome, documento: f.cdoc, email: f.cemail, telefone: f.ctel },
      descricao: f.descricao, animal: f.animal, acasalamento: f.acasalamento, tipo_venda: f.tipo_venda, percentual: f.percentual ? String(f.percentual).replace(',', '.') : '', lote: f.lote,
      data_contrato: f.data_contrato, valor_total: (total / 100).toFixed(2), qtd_parcelas: parc.length, vendedor: f.vendedor, condicoes: f.condicoes, obs: f.obs,
      parcelas: parc.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor_previsto: parseMoney(p.valor).toFixed(2), status_origem: 'Cadastro manual',
        ...(p.pago ? { pagamento: { data: p.pago, valor: parseMoney(p.valorPago || p.valor).toFixed(2), obs: 'Lançado no cadastro manual' } } : {}) })),
    };
    const r = await ctx.act(() => sb.rpc('rcb_importar_contrato', { p: payload }).then(chk), 'Contrato cadastrado');
    setBusy(false);
    if (r) go('#/contrato/' + r);
  };
  return html`<div class="card"><h2 style="margin-bottom:12px">Dados da venda</h2><div class="form-grid">
    <label class="f">Nº do contrato (opcional)<input value=${f.id} onInput=${s('id')} placeholder="gerado automaticamente" /></label>
    <label class="f span2">Leilão<select value=${f.leilaoSel} onChange=${s('leilaoSel')}><option value="">+ Novo leilão</option>${leiloes.map((l) => html`<option value=${l.id}>${l.nome} · ${C.fmtD(l.data)}</option>`)}</select></label>
    ${!f.leilaoSel ? html`<label class="f">Nome do leilão<input value=${f.lnome} onInput=${s('lnome')} /></label><label class="f">Data do leilão<input type="date" value=${f.ldata} onInput=${s('ldata')} /></label><label class="f">Local<input value=${f.llocal} onInput=${s('llocal')} /></label>` : ''}
    <label class="f span3">Descrição (como no contrato)<input value=${f.descricao} onInput=${(e) => { const v = e.target.value; const a = extrairAnimal(v); setF((o) => ({ ...o, descricao: v, animal: o.animal || a.animal, tipo_venda: o.tipo_venda === 'nao_identificado' ? inferirTipo(v) : o.tipo_venda })); }} /></label>
    <label class="f">Animal / genética<input value=${f.animal} onInput=${s('animal')} /></label><label class="f">Acasalamento<input value=${f.acasalamento} onInput=${s('acasalamento')} /></label>
    <label class="f">Tipo<select value=${f.tipo_venda} onChange=${s('tipo_venda')}>${Object.entries(C.TIPO_LABEL).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></label>
    <label class="f">% comercializado<input value=${f.percentual} onInput=${s('percentual')} /></label><label class="f">Lote<input value=${f.lote} onInput=${s('lote')} /></label>
    <label class="f">Data do contrato<input type="date" value=${f.data_contrato} onInput=${s('data_contrato')} /></label>
    <label class="f">Valor total (R$)<input inputmode="decimal" value=${f.valor_total} onInput=${s('valor_total')} /></label><label class="f">Vendedor<input value=${f.vendedor} onInput=${s('vendedor')} /></label>
    <label class="f">Condições especiais<input value=${f.condicoes} onInput=${s('condicoes')} placeholder="entrada, comissão, desconto…" /></label>
    <div class="span3 sep"></div>
    <label class="f">Comprador<input value=${f.cnome} onInput=${s('cnome')} /></label><label class="f">CPF/CNPJ<input value=${f.cdoc} onInput=${s('cdoc')} /></label>
    <label class="f">E-mail<input value=${f.cemail} onInput=${s('cemail')} /></label><label class="f">Telefone<input value=${f.ctel} onInput=${s('ctel')} /></label>
    <label class="f span2">Observações<input value=${f.obs} onInput=${s('obs')} /></label>
  </div></div>
  <div class="card"><h2 style="margin-bottom:12px">Cronograma de parcelas</h2><div class="form-grid">
    <label class="f">Entrada (R$, opcional)<input inputmode="decimal" value=${g.entrada} onInput=${sg('entrada')} /></label><label class="f">Data da entrada<input type="date" value=${g.entradaData} onInput=${sg('entradaData')} /></label><span></span>
    <label class="f">Quantidade de parcelas<input type="number" min="1" value=${g.qtd} onInput=${sg('qtd')} /></label><label class="f">Valor de cada parcela (R$)<input inputmode="decimal" value=${g.valor} onInput=${sg('valor')} /></label>
    <label class="f">Primeiro vencimento<input type="date" value=${g.primeiro} onInput=${sg('primeiro')} /></label>
    <label class="f">Periodicidade<select value=${g.intervalo} onChange=${sg('intervalo')}><option value="1">Mensal</option><option value="2">Bimestral</option><option value="3">Trimestral</option><option value="6">Semestral</option><option value="12">Anual</option></select></label>
  </div><div class="stack" style="margin-top:10px"><button onClick=${gerar}>Gerar cronograma</button><span class="small muted">Depois de gerar, cada parcela pode ser ajustada individualmente (valores e datas diferentes, carências).</span></div>
  ${parc.length ? html`<div class="tbl-wrap" style="margin-top:12px;max-height:50vh"><table><thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Já paga em (opcional)</th><th>Valor pago</th></tr></thead><tbody>
    ${parc.map((p, i) => html`<tr><td>${p.numero}</td><td><input type="date" value=${p.vencimento} onInput=${(e) => setP(i, 'vencimento', e.target.value)} /></td><td><input style="width:110px" value=${p.valor} onInput=${(e) => setP(i, 'valor', e.target.value)} /></td>
      <td><input type="date" max=${ctx.model.hoje} value=${p.pago} onInput=${(e) => setP(i, 'pago', e.target.value)} /></td><td><input style="width:110px" placeholder="= valor" value=${p.valorPago} onInput=${(e) => setP(i, 'valorPago', e.target.value)} /></td></tr>`)}</tbody></table></div>
    <div class="stack" style="margin-top:10px"><span class="small">Soma: <b>${C.brl(soma)}</b> · Contrato: <b>${C.brl(total)}</b> · Diferença: <b style=${soma !== total ? 'color:var(--red)' : ''}>${C.brl(total - soma)}</b></span>
      <button class="btn-primary" style="margin-left:auto" disabled=${busy} onClick=${salvar}>${busy ? 'Salvando…' : 'Cadastrar contrato'}</button></div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------
function RelatoriosPage({ ctx }) {
  const { model } = ctx;
  const [f, setF] = useStored('rel', { tipo: 'mensal', mes: model.hoje.slice(0, 7), ano: model.hoje.slice(0, 4), leilao: '', comprador: '', contrato: '', base: 'todos', de: '', ate: '' });
  const contratos = C.filtrarContratos(model, f);
  const rel = useMemo(() => gerarRelatorio(f.tipo, model, contratos, f), [model, f]);
  const s = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const anos = [...new Set(model.parcelas.map((p) => p.vencimento.slice(0, 4)))].sort();
  const fmt = (col, v) => (v == null || v === '' ? '' : col.tipo === 'money' ? C.brl(v) : col.tipo === 'date' ? C.fmtD(v) : col.tipo === 'pct' ? C.pct(v) : v);
  return html`
    <div class="page-head"><div><h1>Exportações</h1><p>Relatórios em Excel e PDF com os mesmos cálculos do painel</p></div>
      <div class="stack"><button onClick=${() => exportarExcel(rel)}>Exportar Excel</button><button class="btn-primary" onClick=${() => exportarPDF(rel)}>Exportar PDF</button></div></div>
    <div class="card" style="margin-bottom:16px"><div class="filters">
      <label class="f">Relatório<select value=${f.tipo} onChange=${s('tipo')}>${RELATORIOS.map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></label>
      ${f.tipo === 'mensal' ? html`<label class="f" style="max-width:160px">Mês<input type="month" value=${f.mes} onInput=${s('mes')} /></label>` : ''}
      ${f.tipo === 'anual' ? html`<label class="f" style="max-width:120px">Ano<select value=${f.ano} onChange=${s('ano')}>${anos.map((a) => html`<option>${a}</option>`)}</select></label>` : ''}
    </div><div class="sep"></div><${FiltroBase} model=${model} f=${f} setF=${setF} campos=${['leilao', 'comprador', 'base', ...(['fluxo_previsto', 'fluxo_realizado', 'comparativo'].includes(f.tipo) ? ['periodo'] : [])]} /></div>
    <div class="card"><div class="card-head"><div><h2>${rel.titulo}</h2><div class="small muted">${rel.subtitulo}</div></div><span class="small muted">${rel.linhas.length} linha(s)</span></div>
      <div class="tbl-wrap" style="max-height:60vh"><table><thead><tr>${rel.colunas.map((c) => html`<th class=${['money', 'pct', 'int'].includes(c.tipo) ? 'num' : ''}>${c.t}</th>`)}</tr></thead>
        <tbody>${rel.linhas.map((l) => html`<tr>${rel.colunas.map((c) => html`<td class=${['money', 'pct', 'int', 'date'].includes(c.tipo) ? 'num' : ''}>${fmt(c, l[c.k])}</td>`)}</tr>`)}</tbody>
        ${rel.total ? html`<tfoot><tr>${rel.colunas.map((c) => html`<td class=${['money', 'pct', 'int'].includes(c.tipo) ? 'num' : ''}>${fmt(c, rel.total[c.k])}</td>`)}</tr></tfoot>` : ''}</table></div></div>`;
}

render(html`<${App} />`, document.getElementById('app'));

// "Atualizar contratos": uma entrada no menu, duas abas
function AbasAtualizar({ atual }) {
  return html`<div class="pill-tabs" style="margin-bottom:14px" role="tablist" aria-label="Atualizar contratos">
    <a role="tab" aria-selected=${atual === 'comparar'} class=${'tab-link' + (atual === 'comparar' ? ' on' : '')} href="#/comparar">Comparar com arquivos</a>
    <a role="tab" aria-selected=${atual === 'importar'} class=${'tab-link' + (atual === 'importar' ? ' on' : '')} href="#/importar">Importar novos contratos</a></div>`;
}

// Painel: situação do repasse do último mês com relatório (ou do mês passado)
function CardRepasse({ ctx }) {
  const { model } = ctx;
  const comRel = C.mesesConferencia(model).filter((x) => model.repasses.some((r) => r.mes === x && !r.substituido));
  const passado = (() => { const [y, m] = model.hoje.slice(0, 7).split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); })();
  const mes = comRel[0] && comRel[0] >= passado ? comRel[0] : passado;
  const conf = useMemo(() => C.conferencia(model, mes), [model, mes]);
  const fech = model.fechamentos?.get(mes);
  const [cls, txt] = conf.status === 'enviado' ? CONCILIACAO[conf.conciliacao] : ['cancelada', 'Aguardando relatório'];
  return html`<div class="card painel-repasse" style="margin-bottom:16px">
    <div><div class="small muted">Repasse da contabilidade</div><div style="font-size:20px;font-weight:700">${nomeMes(mes)} ${Badge(cls, txt)} ${fech?.status === 'fechado' ? Badge('info', 'Mês fechado') : ''}</div>
      <div class="small">${conf.reps.length ? html`Transferido <b>${C.brl(conf.informado)}</b> · esperado após ajustes ${C.brl(conf.esperadoAposAjustes)} · diferença <b class=${conf.dif ? 'neg' : ''}>${C.brl(conf.dif)}</b>${conf.periodosFaltando.length ? ` · falta o ${conf.periodosFaltando.map(periodoTxt).join(' e o ')}` : ''}`
        : html`Compradores pagaram ${C.brl(conf.painelMes)} no mês; aguardando o relatório.`}</div></div>
    <a class="btn btn-primary" href=${'#/repasses/' + mes}>Abrir conferência</a></div>`;
}

// muda a competência (mês + quinzena) de um relatório já enviado
function CompetenciaModal({ ctx, r, onClose }) {
  const [mes, setMes] = useState(r.mes); const [q, setQ] = useState(r.quinzena || 1);
  const fechado = (x) => ctx.model.fechamentos?.get(x)?.status === 'fechado';
  return html`<${Modal} title="Alterar competência do relatório" onClose=${onClose}>
    <table class="kv"><tbody><tr><th>Arquivo</th><td><b>${r.arquivo_nome || r.titulo}</b></td></tr><tr><th>Créditos de</th><td>${C.fmtD(r.periodo_inicio)} a ${C.fmtD(r.periodo_fim)}</td></tr>
      <tr><th>Data do relatório</th><td>${r.data_relatorio ? C.fmtD(r.data_relatorio) : '—'}</td></tr><tr><th>Competência atual</th><td>${C.competenciaTxt(r.mes, r.quinzena)}</td></tr></tbody></table>
    <div class="stack" style="gap:8px;align-items:center;margin-top:8px"><input type="month" value=${mes} onInput=${(e) => setMes(e.target.value)} aria-label="Mês" />
      <select value=${String(q)} onChange=${(e) => setQ(+e.target.value)} aria-label="Quinzena"><option value="1">1ª quinzena</option><option value="2">2ª quinzena</option></select></div>
    <p class="small muted">Todos os lançamentos do arquivo passam para ${/^\d{4}-\d{2}$/.test(mes) ? html`<b>${C.competenciaTxt(mes, q)}</b>` : 'a competência escolhida'}. Os dois meses são recalculados.</p>
    ${fechado(mes) ? html`<div class="banner err">${nomeMes(mes)} está fechado. Reabra o mês antes.</div>` : ''}
    <div class="modal-actions"><button onClick=${onClose}>Cancelar</button><button class="btn-primary" disabled=${!/^\d{4}-\d{2}$/.test(mes) || fechado(mes) || (mes === r.mes && q === r.quinzena)}
      onClick=${async () => { if (await ctx.act(() => sb.rpc('rcb_definir_competencia', { p_id: r.id, p_mes: mes, p_quinzena: q }).then(chk), `Relatório passou para ${C.competenciaTxt(mes, q)}`)) { onClose(); go('#/repasses/' + mes); } }}>Salvar</button></div><//>`;
}

// usa o leilão já cadastrado quando o nome só difere em maiúsculas/acentos (evita leilão duplicado)
function leilaoCanon(model, l) {
  if (!l) return l;
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const e = (model.leiloes || []).find((x) => n(x.nome) === n(l.nome) && (!l.data || !x.data || x.data === l.data));
  return e ? { ...l, nome: e.nome, data: e.data || l.data, leilao_id: e.id } : l;
}
