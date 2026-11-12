import * as C from './calc.js';

export const RELATORIOS = [
  ['mensal', 'Relatório financeiro mensal'],
  ['anual', 'Relatório anual'],
  ['por_comprador', 'Contratos por comprador'],
  ['atraso', 'Parcelas em atraso'],
  ['fluxo_previsto', 'Fluxo de caixa previsto'],
  ['fluxo_realizado', 'Pagamentos dos compradores (realizado)'],
  ['comparativo', 'Comparativo previsto × realizado'],
];

const col = (k, t, tipo = 'text') => ({ k, t, tipo });
const somar = (linhas, keys) => Object.fromEntries(keys.map((k) => [k, linhas.reduce((s, l) => s + (l[k] || 0), 0)]));

export function gerarRelatorio(tipo, model, contratos, f) {
  const base = f.base === 'aprovados' ? 'Somente contratos revisados' : 'Todos os contratos ativos';
  const nomeFiltro = [f.leilao && model.leiloes.find((l) => String(l.id) === String(f.leilao))?.nome, f.comprador && model.compradores.find((c) => String(c.id) === String(f.comprador))?.nome].filter(Boolean).join(' · ');
  const sub = (x) => [x, base, nomeFiltro, `Posição em ${C.fmtD(model.hoje)}`].filter(Boolean).join(' · ');

  if (tipo === 'mensal') {
    const key = f.mes || model.hoje.slice(0, 7);
    const { rows, pagRows, s } = C.detalheBucket(model, contratos, 'contratual', 'mes', key);
    const linhas = rows.map((p) => ({
      comprador: p.contrato.comprador.nome, contrato: p.contrato_id, leilao: p.contrato.leilao.nome, lote: p.contrato.lote || '', parcela: `${p.numero}/${p.contrato.nParc}`,
      vencimento: p.vencimento, previsto: p.prev, recebido: p.rec, saldo: p.saldo, status: C.STATUS_LABEL[p.status], pagto: p.ativos.map((g) => C.fmtD(g.data_pagamento)).join(', '),
    }));
    return {
      titulo: `Relatório mensal · ${C.bucketLongLabel(key)}`,
      subtitulo: sub(`Previsto ${C.brl(s.previsto)} · recebido destas parcelas ${C.brl(s.recebidoDasParcelas)} · vencido não pago ${C.brl(s.vencidoNaoPago)} · pago pelos compradores no mês ${C.brl(s.caixa)} (${pagRows.length} pagamentos)`),
      colunas: [col('comprador', 'Comprador'), col('contrato', 'Contrato', 'int'), col('leilao', 'Leilão'), col('lote', 'Lote'), col('parcela', 'Parcela'), col('vencimento', 'Vencimento', 'date'),
        col('previsto', 'Previsto', 'money'), col('recebido', 'Recebido', 'money'), col('saldo', 'Saldo', 'money'), col('status', 'Status'), col('pagto', 'Data pgto.')],
      linhas, total: { comprador: 'Total', ...somar(linhas, ['previsto', 'recebido', 'saldo']) },
    };
  }
  if (tipo === 'anual') {
    const ano = f.ano || model.hoje.slice(0, 4);
    const fa = { de: `${ano}-01`, ate: `${ano}-12` };
    const ct = new Map(C.serie(model, contratos, 'contratual', 'mes', fa).map((s) => [s.key, s]));
    const cx = new Map(C.serie(model, contratos, 'caixa', 'mes', fa).map((s) => [s.key, s]));
    const linhas = C.MESES_LONGOS.map((m, i) => {
      const k = `${ano}-${String(i + 1).padStart(2, '0')}`; const a = ct.get(k) || { previsto: 0, recebido: 0 }; const b = cx.get(k) || { recebido: 0 };
      return { mes: m, previsto: a.previsto, recContratual: a.recebido, difContratual: a.previsto - a.recebido, caixa: b.recebido, difCaixa: a.previsto - b.recebido, taxa: a.previsto ? a.recebido / a.previsto : null };
    });
    const t = somar(linhas, ['previsto', 'recContratual', 'difContratual', 'caixa', 'difCaixa']);
    return {
      titulo: `Relatório anual · ${ano}`, subtitulo: sub('Regime contratual (por vencimento) e fluxo de caixa (por data de pagamento) lado a lado'),
      colunas: [col('mes', 'Mês'), col('previsto', 'Bruto previsto', 'money'), col('recContratual', 'Recebido das parcelas do mês', 'money'), col('difContratual', 'Diferença (contratual)', 'money'),
        col('caixa', 'Pago pelos compradores', 'money'), col('difCaixa', 'Diferença (pagos no mês)', 'money'), col('taxa', '% recebido', 'pct')],
      linhas, total: { mes: 'Total', ...t, taxa: t.previsto ? t.recContratual / t.previsto : null },
    };
  }
  if (tipo === 'por_comprador') {
    const linhas = [...contratos].sort((a, b) => a.comprador.nome.localeCompare(b.comprador.nome) || a.id - b.id).map((c) => ({
      comprador: c.comprador.nome, doc: C.fmtDoc(c.comprador.documento), contrato: c.id, leilao: c.leilao.nome, lote: c.lote || '', animal: c.animal || c.descricao,
      valor: c.valorC, recebido: c.recC, vencido: c.saldoVencido, futuro: c.saldoFuturo, situacao: C.SITUACAO_LABEL[c.situacao],
    }));
    return {
      titulo: 'Contratos por comprador', subtitulo: sub(`${new Set(linhas.map((l) => l.doc + l.comprador)).size} compradores`),
      colunas: [col('comprador', 'Comprador'), col('doc', 'CPF/CNPJ'), col('contrato', 'Contrato', 'int'), col('leilao', 'Leilão'), col('lote', 'Lote'), col('animal', 'Animal / objeto'),
        col('valor', 'Valor contratado', 'money'), col('recebido', 'Recebido', 'money'), col('vencido', 'Vencido', 'money'), col('futuro', 'A vencer', 'money'), col('situacao', 'Situação')],
      linhas, total: { comprador: 'Total', ...somar(linhas, ['valor', 'recebido', 'vencido', 'futuro']) },
    };
  }
  if (tipo === 'atraso') {
    const linhas = contratos.flatMap((c) => c.parcelas.filter((p) => p.vencida)).sort((a, b) => b.dias - a.dias).map((p) => ({
      comprador: p.contrato.comprador.nome, telefone: p.contrato.comprador.telefone || '', contrato: p.contrato_id, leilao: p.contrato.leilao.nome, parcela: `${p.numero}/${p.contrato.nParc}`,
      vencimento: p.vencimento, dias: p.dias, faixa: (C.FAIXAS.find((fx) => p.dias >= fx.de && p.dias <= fx.ate) || {}).id, previsto: p.prev, recebido: p.rec, saldo: p.saldo,
    }));
    return {
      titulo: 'Parcelas em atraso', subtitulo: sub(`${linhas.length} parcelas vencidas e não quitadas`),
      colunas: [col('comprador', 'Comprador'), col('telefone', 'Telefone'), col('contrato', 'Contrato', 'int'), col('leilao', 'Leilão'), col('parcela', 'Parcela'), col('vencimento', 'Vencimento', 'date'),
        col('dias', 'Dias', 'int'), col('faixa', 'Faixa'), col('previsto', 'Previsto', 'money'), col('recebido', 'Recebido', 'money'), col('saldo', 'Saldo em atraso', 'money')],
      linhas, total: { comprador: 'Total', ...somar(linhas, ['previsto', 'recebido', 'saldo']) },
    };
  }
  if (tipo === 'fluxo_previsto') {
    let acum = 0;
    const linhas = C.serie(model, contratos, 'contratual', 'mes', f).map((s) => {
      const saldo = contratos.reduce((t, c) => t + c.parcelas.filter((p) => !p.cancelada && p.vencimento.slice(0, 7) === s.key).reduce((u, p) => u + p.saldo, 0), 0);
      acum += s.previsto;
      return { mes: C.bucketLongLabel(s.key), previsto: s.previsto, recebido: s.recebido, saldo, acum, situacao: s.futuro ? 'Futuro' : s.atual ? 'Mês atual' : 'Passado' };
    });
    return {
      titulo: 'Fluxo de caixa previsto', subtitulo: sub('Por mês de vencimento contratual'),
      colunas: [col('mes', 'Mês'), col('previsto', 'Previsto', 'money'), col('recebido', 'Já recebido destas parcelas', 'money'), col('saldo', 'Saldo a receber', 'money'), col('acum', 'Previsto acumulado', 'money'), col('situacao', 'Período')],
      linhas, total: { mes: 'Total', ...somar(linhas, ['previsto', 'recebido', 'saldo']) },
    };
  }
  if (tipo === 'fluxo_realizado') {
    const ids = new Set(contratos.map((c) => c.id));
    const linhas = model.pagamentos.filter((g) => !g.estornado && ids.has(g.contrato.id) && (!f.de || g.data_pagamento >= f.de + '-01') && (!f.ate || g.data_pagamento <= f.ate + '-31')).map((g) => ({
      data: g.data_pagamento, comprador: g.contrato.comprador.nome, contrato: g.contrato.id, leilao: g.contrato.leilao.nome, parcela: `${g.parcela.numero}/${g.contrato.nParc}`,
      vencimento: g.parcela.vencimento, valor: g.valorC, forma: g.forma || '', origem: g.origem === 'importacao' ? 'Importado' : 'Manual',
    }));
    return {
      titulo: 'Pagamentos dos compradores (realizado)', subtitulo: sub(`${linhas.length} pagamentos registrados, pela data do pagamento (o crédito na conta da SM está em Repasses da Contabilidade)`),
      colunas: [col('data', 'Data pgto.', 'date'), col('comprador', 'Comprador'), col('contrato', 'Contrato', 'int'), col('leilao', 'Leilão'), col('parcela', 'Parcela'), col('vencimento', 'Vencimento', 'date'), col('valor', 'Valor', 'money'), col('forma', 'Forma'), col('origem', 'Origem')],
      linhas, total: { data: 'Total', ...somar(linhas, ['valor']) },
    };
  }
  // comparativo
  const ct = C.serie(model, contratos, 'caixa', 'mes', f);
  let ap = 0, ar = 0;
  const linhas = ct.map((s) => { ap += s.previsto; ar += s.recebido; return { mes: C.bucketLongLabel(s.key), previsto: s.previsto, realizado: s.recebido, dif: s.previsto - s.recebido, ap, ar, da: ap - ar }; });
  return {
    titulo: 'Comparativo previsto × realizado', subtitulo: sub('Previsto pelo vencimento; realizado pela data real de pagamento'),
    colunas: [col('mes', 'Mês'), col('previsto', 'Bruto previsto', 'money'), col('realizado', 'Pago pelos compradores', 'money'), col('dif', 'Diferença', 'money'), col('ap', 'Previsto acumulado', 'money'), col('ar', 'Realizado acumulado', 'money'), col('da', 'Diferença acumulada', 'money')],
    linhas, total: { mes: 'Total', ...somar(linhas, ['previsto', 'realizado', 'dif']) },
  };
}

const arquivo = (rel, ext) => `SM_${rel.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_')}_${C.hojeISO()}.${ext}`;
const txt = (c, v) => (v == null || v === '' ? '' : c.tipo === 'money' ? C.brl(v) : c.tipo === 'date' ? C.fmtD(v) : c.tipo === 'pct' ? C.pct(v) : String(v));

export function exportarExcel(rel) {
  const X = window.XLSX; if (!X) return alert('Biblioteca de Excel não carregou.');
  const val = (c, v) => (v == null || v === '' ? '' : c.tipo === 'money' ? C.toReais(v) : c.tipo === 'date' ? C.fmtD(v) : v);
  const aoa = [['SM Agropecuária — ' + rel.titulo], [rel.subtitulo], [], rel.colunas.map((c) => c.t), ...rel.linhas.map((l) => rel.colunas.map((c) => val(c, l[c.k])))];
  if (rel.total) aoa.push(rel.colunas.map((c) => val(c, rel.total[c.k])));
  const ws = X.utils.aoa_to_sheet(aoa);
  const n = aoa.length;
  rel.colunas.forEach((c, j) => {
    if (c.tipo !== 'money' && c.tipo !== 'pct') return;
    for (let i = 4; i < n; i++) { const ref = X.utils.encode_cell({ r: i, c: j }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = c.tipo === 'money' ? '"R$" #,##0.00' : '0.0%'; }
  });
  ws['!cols'] = rel.colunas.map((c) => ({ wch: c.tipo === 'money' ? 16 : c.tipo === 'date' ? 12 : 26 }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Relatório');
  X.writeFile(wb, arquivo(rel, 'xlsx'));
}

export function exportarPDF(rel) {
  const J = window.jspdf?.jsPDF; if (!J) return alert('Biblioteca de PDF não carregou.');
  const doc = new J({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFillColor(6, 56, 42); doc.rect(0, 0, doc.internal.pageSize.getWidth(), 54, 'F');
  doc.setTextColor(255); doc.setFontSize(14); doc.text('SM Agropecuária — ' + rel.titulo, 32, 34);
  doc.setTextColor(90); doc.setFontSize(8.5); doc.text(doc.splitTextToSize(rel.subtitulo, doc.internal.pageSize.getWidth() - 64), 32, 72);
  const right = (c) => (['money', 'pct', 'int', 'date'].includes(c.tipo) ? 'right' : 'left');
  doc.autoTable({
    startY: 88, head: [rel.colunas.map((c) => c.t)], body: rel.linhas.map((l) => rel.colunas.map((c) => txt(c, l[c.k]))),
    foot: rel.total ? [rel.colunas.map((c) => txt(c, rel.total[c.k]))] : undefined,
    styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [15, 92, 69] }, footStyles: { fillColor: [241, 247, 244], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(rel.colunas.map((c, i) => [i, { halign: right(c) }])),
    didDrawPage: () => { const h = doc.internal.pageSize.getHeight(); doc.setFontSize(7); doc.setTextColor(140); doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: C.TZ })} · página ${doc.internal.getNumberOfPages()}`, 32, h - 16); },
  });
  doc.save(arquivo(rel, 'pdf'));
}
