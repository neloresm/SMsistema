// Exportação da conferência do repasse MECOB (PDF e Excel), organizada em seções.
import * as C from './calc.js';

const CATM = Object.fromEntries(C.CONF_CATS.map((c) => [c.id, c]));
const CURTO = {
  taxa_maior: 'Honorário acima', taxa_menor: 'Honorário abaixo', faltou: 'Fora do relatório', sem_regra: 'Taxa sem regra', debito: 'Débito',
  taxa_direto_dif: 'Hon. pag. direto diferente', sem_parcela: 'Sem parcela no cadastro', sem_pagamento: 'Pagamento não registrado', fora_regra: 'Parcela fora da regra',
  arred: 'Arredondamento', direto: 'Hon. pagamento direto', mes_anterior: 'Pago no mês anterior', encargo: 'Juros/multa repassados', agrupada: 'Parcelas agrupadas',
  ok: 'Conferido', aguardando: 'Aguardando relatório',
};
const EXTRATO = { sem_relatorio: 'Sem relatório', pendente: 'Repasse informado pela MECOB (extrato não conferido)', confirmado: 'Confirmado no extrato bancário', divergente: 'Divergente no extrato bancário' };
const nomeMes = (m) => `${C.MESES_LONGOS[+m.slice(5) - 1]} de ${m.slice(0, 4)}`;
// as fontes padrão do PDF não têm alguns símbolos: troca por equivalentes
const pdfTxt = (s) => String(s ?? '').replace(/ | | /g, ' ').replace(/−/g, '-').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const brl = (c) => pdfTxt(C.brl(c));
const sg = (c) => (c > 0 ? '+' : '') + brl(c);
const arquivo = (m, ext) => `SM_Conferencia_Repasse_MECOB_${m}.${ext}`;

function dadosLinhas(conf) {
  return conf.itens.map((i) => ({
    i, cat: CURTO[i.cat] || i.cat, ctr: i.ctr, lote: i.lote, parc: (i.ref ? i.ref + ' ' : '') + i.parcelasTxt, comp: i.comprador,
    venc: i.vencimento || '', pago: i.pagoEm || '', cred: i.data_credito || '', bruto: i.bruto || 0, honEsp: i.honEsp || 0, honInf: i.honInf ?? i.taxa ?? 0,
    esp: i.esp, inf: i.inf, dif: i.dif, why: i.why, problema: !CATM[i.cat].neutro, resolvido: !!i.resolvido,
  }));
}
function ponte(conf, pct) {
  const base = conf.itens.filter((i) => !CATM[i.cat].fora && i.esp > 0);
  const linhas = [
    ['Pago pelos compradores (parcelas do mês)', base.reduce((s, i) => s + i.bruto, 0), ''],
    [`(-) Honorário de ${pct}%`, -base.reduce((s, i) => s + i.honEsp, 0), ''],
  ];
  if (conf.diretoEsp) linhas.push([`(-) ${pct}% sobre pagamentos diretos ao vendedor`, -conf.diretoEsp, '']);
  linhas.push(['= Deveria repassar', conf.esperado, 'tot']);
  for (const r of conf.reps) linhas.push([`Relatório MECOB: créditos de ${C.fmtD(r.periodo_inicio).slice(0, 5)} a ${C.fmtD(r.periodo_fim)}`, C.cents(r.valor_final), '']);
  linhas.push(['= Total informado pela MECOB', conf.informado, 'tot']);
  linhas.push(['Diferença (informado - esperado)', conf.dif, 'dif']);
  return linhas;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export function conferenciaPDF(conf, model) {
  const J = window.jspdf?.jsPDF; if (!J) return alert('Biblioteca de PDF não carregou.');
  const doc = new J({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 32;
  const VERDE = [23, 107, 70], VERDE_L = [230, 241, 235], OURO = [184, 154, 94], CINZA = [92, 103, 97], CINZA2 = [138, 147, 142], VERM = [194, 65, 45], VERM_L = [251, 236, 232], LINHA = [226, 223, 216];
  const pct = model.honorarioPct, mesTxt = nomeMes(conf.mes), gerado = new Date().toLocaleString('pt-BR', { timeZone: C.TZ });
  let y = 0;

  // cabeçalho
  doc.setFillColor(...VERDE); doc.rect(0, 0, W, 58, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(pdfTxt('Conferência do repasse MECOB'), M, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(pdfTxt(`SM Agropecuária · ${mesTxt}`), M, 45);
  doc.setFontSize(8.5); doc.text(pdfTxt(`Gerado em ${gerado}`), W - M, 45, { align: 'right' });
  y = 76;

  // 1. resumo em 4 quadros
  const caixas = [
    ['Deveria repassar', brl(conf.esperado), `Parcelas pagas no mês, menos ${pct}% de honorário`],
    ['MECOB informou', brl(conf.informado), `${conf.reps.length} relatório(s) · ${EXTRATO[conf.extrato].split(' (')[0]}`],
    ['Taxas descontadas', brl(conf.honInf + conf.taxasInf), `Honorários ${brl(conf.honInf)} + avulsas ${brl(conf.taxasInf)}`],
    ['Diferença', sg(conf.dif), conf.dif < 0 ? 'A SM recebeu menos que o esperado' : conf.dif > 0 ? 'A MECOB informou mais que o esperado' : 'Bate com o esperado'],
  ];
  const bw = (W - 2 * M - 3 * 10) / 4;
  caixas.forEach(([lbl, val, sub], k) => {
    const x = M + k * (bw + 10), dif = k === 3 && conf.dif !== 0;
    doc.setDrawColor(...(dif ? VERM : LINHA)); doc.setFillColor(...(dif ? VERM_L : [255, 255, 255])); doc.roundedRect(x, y, bw, 62, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...CINZA2); doc.text(pdfTxt(lbl), x + 10, y + 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...(dif ? VERM : [17, 26, 21])); doc.text(val, x + 10, y + 36);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA); doc.text(doc.splitTextToSize(pdfTxt(sub), bw - 20)[0], x + 10, y + 52);
  });
  y += 76;
  doc.setFontSize(9); doc.setTextColor(...CINZA);
  const pend = conf.pendencias;
  doc.text(pdfTxt(`Situação: ${pend ? `${pend} item(ns) para conferir com a MECOB` : 'nenhuma pendência'} · Conta da SM: ${EXTRATO[conf.extrato]}`), M, y);
  y += 16;

  const titulo = (t, sub) => {
    if (y > H - 90) { doc.addPage(); y = M + 10; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 26, 21); doc.text(pdfTxt(t), M, y);
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...CINZA2); doc.text(pdfTxt(sub), M, y + 12); y += 12; }
    y += 8;
  };
  const alinhar = (cols, extra) => (d) => { if (d.section !== 'body' && cols[d.column.index]?.halign) d.cell.styles.halign = cols[d.column.index].halign; if (extra) extra(d); };
  const base = { theme: 'plain', styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }, textColor: [28, 38, 33], lineColor: LINHA, lineWidth: { bottom: 0.5 } },
    headStyles: { fillColor: [251, 250, 247], textColor: CINZA, fontStyle: 'bold', fontSize: 8 }, margin: { left: M, right: M } };

  // 2. ponte (esquerda) + 3. motivos (direita)
  const meia = (W - 2 * M - 20) / 2;
  titulo('Como chegamos ao valor esperado');
  const y0 = y;
  doc.autoTable({ ...base, startY: y0, margin: { left: M, right: W - M - meia }, tableWidth: meia,
    head: [['Conta', 'Valor']], body: ponte(conf, pct).map(([t, v, k]) => [pdfTxt(t), { content: k === 'dif' ? sg(v) : brl(v), k }]),
    columnStyles: { 1: { halign: 'right', cellWidth: 92, overflow: 'visible' } },
    didParseCell: alinhar({ 1: { halign: 'right' } }, (d) => { const k = d.row.raw?.[1]?.k; if (d.section === 'body' && k) { d.cell.styles.fontStyle = 'bold'; if (k === 'dif' && conf.dif) d.cell.styles.textColor = VERM; if (k === 'tot' || k === 'dif') d.cell.styles.fillColor = [246, 244, 239]; } }) });
  const yEsq = doc.lastAutoTable.finalY;
  const probs = conf.cats.filter((c) => !c.neutro), neutros = conf.cats.filter((c) => c.neutro);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 26, 21);
  doc.text(pdfTxt(probs.length ? `Por que a diferença de ${brl(Math.abs(conf.dif))}` : 'Nenhuma divergência'), M + meia + 20, y0 - 8);
  doc.autoTable({ ...base, startY: y0, margin: { left: M + meia + 20, right: M }, tableWidth: meia,
    head: [['Motivo', 'Itens', 'Valor']],
    body: [...probs.map((c) => [pdfTxt(c.t), String(c.qtd), sg(c.dif)]), [{ content: 'Total explicado', styles: { fontStyle: 'bold' } }, '', { content: sg(probs.reduce((s, c) => s + c.dif, 0)), styles: { fontStyle: 'bold' } }],
      ...neutros.map((c) => [{ content: pdfTxt(`${c.t} (sem diferença)`), styles: { textColor: CINZA2 } }, { content: String(c.qtd), styles: { textColor: CINZA2 } }, { content: c.id === 'encargo' ? '+' + brl(conf.encargos) + ' pagos' : c.id === 'aguardando' ? brl(conf.aguardando) : 'OK', styles: { textColor: CINZA2 } }])],
    columnStyles: { 1: { halign: 'center', cellWidth: 40 }, 2: { halign: 'right', cellWidth: 92, overflow: 'visible' } },
    didParseCell: alinhar({ 1: { halign: 'center' }, 2: { halign: 'right' } }, (d) => { if (d.section === 'body' && d.column.index === 2 && typeof d.cell.raw === 'string' && d.cell.raw.startsWith('-')) d.cell.styles.textColor = VERM; }) });
  y = Math.max(yEsq, doc.lastAutoTable.finalY) + 22;

  // 4. detalhe das diferenças: linha de valores + explicação em linha própria
  const linhas = dadosLinhas(conf);
  const probsL = linhas.filter((l) => l.problema);
  if (probsL.length) {
    titulo('Detalhe de cada diferença', 'Cada item mostra os valores e, logo abaixo, a explicação. Item e explicação ficam sempre na mesma página.');
    // larguras fixas para as colunas ficarem alinhadas entre os blocos
    const fixas = [54, 44, 70, 62, 82, 82, 82];
    const wComp = W - 2 * M - fixas.reduce((s, x) => s + x, 0);
    const cols = { 0: { cellWidth: 54 }, 1: { cellWidth: 44 }, 2: { cellWidth: 70 }, 3: { cellWidth: wComp, overflow: 'ellipsize' }, 4: { cellWidth: 62 },
      5: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 6: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 7: { halign: 'right', cellWidth: 82, overflow: 'visible' } };
    const cab = ['Contrato', 'Lote', 'Parcela', 'Comprador', 'Crédito', 'Esperado', 'Informado', 'Diferença'];
    for (const c of probs) {
      // título do motivo + cabeçalho das colunas (não fica sozinho no fim da página)
      if (y > H - 120) { doc.addPage(); y = M + 10; }
      doc.autoTable({ ...base, startY: y, pageBreak: 'avoid', head: [cab], columnStyles: cols, didParseCell: alinhar(cols),
        body: [[{ content: pdfTxt(`${c.t}  ·  ${c.qtd} item(ns)  ·  ${sg(c.dif)}`), colSpan: 8, styles: { fontStyle: 'bold', fillColor: VERDE_L, textColor: [15, 59, 42] } }]] });
      y = doc.lastAutoTable.finalY;
      for (const l of probsL.filter((x) => x.i.cat === c.id)) {
        doc.autoTable({ ...base, startY: y, pageBreak: 'avoid', showHead: false, columnStyles: cols, body: [
          [l.ctr, l.lote, pdfTxt(l.parc), pdfTxt(l.comp), C.fmtD(l.cred || l.pago), brl(l.esp), brl(l.inf), { content: sg(l.dif), styles: { textColor: l.dif < 0 ? VERM : [28, 38, 33], fontStyle: 'bold' } }],
          [{ content: pdfTxt(`Por quê: ${l.why}${l.resolvido ? `  [Resolvido: ${l.i.resolucao}]` : ''}`), colSpan: 8, styles: { fontSize: 8, textColor: CINZA, fontStyle: 'italic', cellPadding: { top: 1, bottom: 6, left: 14, right: 6 } } }]] });
        y = doc.lastAutoTable.finalY;
      }
      y += 10;
    }
    y += 12;
  }

  // 5. relatórios recebidos
  titulo('Relatórios da MECOB considerados');
  doc.autoTable({ ...base, startY: y, head: [['Relatório', 'Créditos de', 'Créditos', 'Taxas', 'Valor final', 'Conta da SM']],
    body: conf.reps.map((r) => [pdfTxt(r.titulo || '-'), `${C.fmtD(r.periodo_inicio)} a ${C.fmtD(r.periodo_fim)}`, brl(C.cents(r.creditos)), brl(C.cents(r.taxas)), { content: brl(C.cents(r.valor_final)), styles: { fontStyle: 'bold' } },
      pdfTxt(r.extrato_status === 'confirmado' ? `Confirmado em ${C.fmtD(r.extrato_data)} (${brl(C.cents(r.extrato_valor))})` : r.extrato_status === 'divergente' ? `Divergente: ${brl(C.cents(r.extrato_valor))}` : 'Aguardando extrato')]),
    foot: [[{ content: 'Total', styles: { fontStyle: 'bold' } }, '', brl(conf.reps.reduce((s, r) => s + C.cents(r.creditos), 0)), brl(conf.reps.reduce((s, r) => s + C.cents(r.taxas), 0)), { content: brl(conf.informado), styles: { fontStyle: 'bold' } }, '']],
    footStyles: { fillColor: [246, 244, 239], textColor: [17, 26, 21], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 'auto', overflow: 'ellipsize' }, 1: { cellWidth: 112 }, 2: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 3: { halign: 'right', cellWidth: 72, overflow: 'visible' }, 4: { halign: 'right', cellWidth: 86, overflow: 'visible' }, 5: { cellWidth: 170 } },
    didParseCell: alinhar({ 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }) });

  // 6. todas as linhas (nova página)
  doc.addPage(); y = M + 10;
  titulo('Todas as parcelas e taxas conferidas', 'Honorário = desconto aplicado pela MECOB na linha. Situação explica cada linha; os detalhes estão na seção anterior.');
  doc.autoTable({ ...base, startY: y, styles: { ...base.styles, fontSize: 7.6, cellPadding: { top: 2.2, bottom: 2.2, left: 4, right: 4 } },
    head: [['Contrato', 'Lote', 'Parcela', 'Comprador', 'Venc.', 'Pago em', 'Crédito', 'Valor pago', 'Honorário', 'Esperado', 'Informado', 'Diferença', 'Situação']],
    body: linhas.map((l) => [l.ctr, l.lote, pdfTxt(l.parc), pdfTxt(l.comp), C.fmtD(l.venc), C.fmtD(l.pago), C.fmtD(l.cred), l.bruto ? brl(l.bruto) : '-', brl(l.honInf), brl(l.esp), brl(l.inf),
      { content: l.dif ? sg(l.dif) : '-', styles: { textColor: l.dif < 0 ? VERM : [28, 38, 33], fontStyle: l.dif ? 'bold' : 'normal' } }, pdfTxt(l.cat + (l.resolvido ? ' (resolvido)' : ''))]),
    foot: [['Total', '', '', '', '', '', '', brl(linhas.reduce((s, l) => s + l.bruto, 0)), brl(linhas.reduce((s, l) => s + l.honInf, 0)), brl(conf.esperado), brl(conf.somaLinhas), sg(conf.dif), '']],
    footStyles: { fillColor: [246, 244, 239], textColor: [17, 26, 21], fontStyle: 'bold' },
    didParseCell: alinhar({ 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' } }),
    columnStyles: { 0: { cellWidth: 46 }, 1: { cellWidth: 34 }, 2: { cellWidth: 50 }, 3: { cellWidth: 'auto', overflow: 'ellipsize' }, 4: { cellWidth: 50 }, 5: { cellWidth: 50 }, 6: { cellWidth: 50 },
      7: { halign: 'right', cellWidth: 64, overflow: 'visible' }, 8: { halign: 'right', cellWidth: 58, overflow: 'visible' }, 9: { halign: 'right', cellWidth: 64, overflow: 'visible' }, 10: { halign: 'right', cellWidth: 64, overflow: 'visible' }, 11: { halign: 'right', cellWidth: 60, overflow: 'visible' }, 12: { cellWidth: 98, overflow: 'ellipsize' } } });

  // rodapé com paginação
  const n = doc.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA2);
    doc.text(pdfTxt(`SM Agropecuária · Recebimentos · Conferência do repasse MECOB · ${mesTxt}`), M, H - 14);
    doc.text(`Página ${p} de ${n}`, W - M, H - 14, { align: 'right' });
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Excel (uma aba por seção, números e datas de verdade)
// ---------------------------------------------------------------------------
const dt = (iso) => (iso ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : '');
const rs = (c) => Math.round(c) / 100;
export function conferenciaExcel(conf, model, soGerar = false) {
  const X = window.XLSX; if (!X) return alert('Biblioteca de Excel não carregou.');
  const FMT_RS = '"R$" #,##0.00;[Red]-"R$" #,##0.00', FMT_D = 'dd/mm/yyyy';
  const pct = model.honorarioPct, mesTxt = nomeMes(conf.mes);
  const wb = X.utils.book_new();
  const aba = (nome, aoa, larguras, fmts = {}, filtro) => {
    const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
    const rng = X.utils.decode_range(ws['!ref']);
    for (let r = rng.s.r; r <= rng.e.r; r++) for (let c = rng.s.c; c <= rng.e.c; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })]; if (!cell) continue;
      if (cell.t === 'n' && fmts[c] === 'rs') cell.z = FMT_RS;
      if (cell.t === 'd' || cell.v instanceof Date) cell.z = FMT_D;
    }
    ws['!cols'] = larguras.map((w) => ({ wch: w }));
    if (filtro) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: filtro, c: 0 }, e: { r: rng.e.r, c: rng.e.c } }) };
    X.utils.book_append_sheet(wb, ws, nome);
  };
  const linhas = dadosLinhas(conf);
  const probs = conf.cats.filter((c) => !c.neutro), neutros = conf.cats.filter((c) => c.neutro);

  // Resumo
  const resumo = [
    [`SM Agropecuária — Conferência do repasse MECOB — ${mesTxt}`], [`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: C.TZ })}`], [],
    ['RESUMO', 'Valor'], ['Deveria repassar', rs(conf.esperado)], ['MECOB informou', rs(conf.informado)], ['Taxas descontadas (total)', rs(conf.honInf + conf.taxasInf)],
    ['   Honorários', rs(conf.honInf)], ['   Taxas avulsas', rs(conf.taxasInf)], ['Diferença (informado - esperado)', rs(conf.dif)],
    ['Itens para conferir', conf.pendencias], ['Conta da SM', EXTRATO[conf.extrato]], [],
    ['COMO CHEGAMOS AO VALOR ESPERADO', 'Valor'], ...ponte(conf, pct).map(([t, v]) => [t, rs(v)]), [],
    ['POR QUE A DIFERENÇA', 'Valor', 'Itens'], ...probs.map((c) => [c.t, rs(c.dif), c.qtd]), ['Total explicado', rs(probs.reduce((s, c) => s + c.dif, 0)), ''], [],
    ['CONFERIDO SEM DIFERENÇA', 'Valor', 'Itens'], ...neutros.map((c) => [c.t, c.id === 'encargo' ? rs(conf.encargos) : c.id === 'aguardando' ? rs(conf.aguardando) : 0, c.qtd]),
  ];
  aba('Resumo', resumo, [78, 18, 8], { 1: 'rs' });

  // Diferenças
  aba('Diferenças', [['Motivo', 'Contrato', 'Lote', 'Parcela', 'Comprador', 'Crédito / pago em', 'Esperado', 'Informado', 'Diferença', 'Resolvido', 'Explicação'],
    ...linhas.filter((l) => l.problema).map((l) => [CATM[l.i.cat].t, +l.ctr || l.ctr, l.lote, l.parc, l.comp, dt(l.cred || l.pago), rs(l.esp), rs(l.inf), rs(l.dif), l.resolvido ? `Sim: ${l.i.resolucao}` : 'Não', l.why])],
    [30, 10, 8, 12, 34, 15, 14, 14, 14, 18, 120], { 6: 'rs', 7: 'rs', 8: 'rs' }, 0);

  // Todas as linhas
  aba('Todas as linhas', [['Contrato', 'Lote', 'Parcela', 'Comprador', 'Vencimento', 'Pago em', 'Crédito MECOB', 'Valor pago', 'Honorário esperado', 'Honorário cobrado', 'Esperado', 'Informado', 'Diferença', 'Situação', 'Explicação'],
    ...linhas.map((l) => [+l.ctr || l.ctr, l.lote, l.parc, l.comp, dt(l.venc), dt(l.pago), dt(l.cred), rs(l.bruto), rs(l.honEsp), rs(l.honInf), rs(l.esp), rs(l.inf), rs(l.dif), l.cat + (l.resolvido ? ' (resolvido)' : ''), l.why]),
    ['Total', '', '', '', '', '', '', rs(linhas.reduce((s, l) => s + l.bruto, 0)), rs(linhas.reduce((s, l) => s + l.honEsp, 0)), rs(linhas.reduce((s, l) => s + l.honInf, 0)), rs(conf.esperado), rs(conf.somaLinhas), rs(conf.dif), '', '']],
    [10, 8, 12, 34, 12, 12, 13, 14, 16, 16, 14, 14, 14, 24, 120], { 7: 'rs', 8: 'rs', 9: 'rs', 10: 'rs', 11: 'rs', 12: 'rs' }, 0);

  // Relatórios MECOB
  aba('Relatórios MECOB', [['Relatório', 'Arquivo', 'Créditos de', 'Créditos até', 'Créditos', 'Débitos', 'Taxas', 'Valor final', 'Conta da SM', 'Data no extrato', 'Valor no extrato'],
    ...conf.reps.map((r) => [r.titulo || '', r.arquivo_nome || '', dt(r.periodo_inicio), dt(r.periodo_fim), +r.creditos, +r.debitos, +r.taxas, +r.valor_final,
      { confirmado: 'Confirmado', divergente: 'Divergente', pendente: 'Aguardando extrato' }[r.extrato_status], dt(r.extrato_data), r.extrato_valor == null ? '' : +r.extrato_valor])],
    [40, 50, 13, 13, 14, 12, 12, 14, 20, 15, 16], { 4: 'rs', 5: 'rs', 6: 'rs', 7: 'rs', 10: 'rs' });

  if (soGerar) return wb;
  X.writeFile(wb, arquivo(conf.mes, 'xlsx'));
}

export function baixarPDF(conf, model) { const d = conferenciaPDF(conf, model); if (d) d.save(arquivo(conf.mes, 'pdf')); }
