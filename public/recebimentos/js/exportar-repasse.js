// Exportação da conferência do repasse da contabilidade (PDF e Excel), organizada em seções.
import * as C from './calc.js';

const CATM = Object.fromEntries(C.CONF_CATS.map((c) => [c.id, c]));
const CURTO = {
  outros_descontos: 'Outro desconto', faltou: 'Sem repasse', base_divergente: 'Base diferente', debito: 'Débito', sem_parcela: 'Sem parcela no cadastro',
  sem_pagamento: 'Pagamento não registrado', fora_regra: 'Parcela fora da regra', recebido_outro: 'Repassado em outro relatório', encargo: 'Juros/multa repassados',
  agrupada: 'Parcelas agrupadas', ok: 'Conferido', outro_mes: 'Pago em outro mês', duplicada: 'Repetida (ignorada)', aguardando: 'Aguardando relatório',
};
const EXTRATO = { sem_relatorio: 'Sem relatório', pendente: 'Transferência informada pela contabilidade (extrato não conferido)', confirmado: 'Confirmado no extrato bancário', divergente: 'Divergente no extrato bancário' };
const nomeMes = (m) => `${C.MESES_LONGOS[+m.slice(5) - 1]} de ${m.slice(0, 4)}`;
const pdfTxt = (s) => String(s ?? '').replace(/ | | /g, ' ').replace(/−/g, '-').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const brl = (c) => pdfTxt(C.brl(c));
const sg = (c) => (c > 0 ? '+' : '') + brl(c);
const pct = (x) => (x == null ? '-' : pdfTxt(C.pctTxt(x)));
const arquivo = (m, ext) => `SM_Conferencia_Repasse_Contabilidade_${m}.${ext}`;
const contabNomes = (conf) => [...new Set(conf.reps.map((r) => r.contabilidade?.nome).filter(Boolean))].join(', ') || '-';

function dadosLinhas(conf) {
  return conf.itens.map((i) => ({
    i, cat: CURTO[i.cat] || i.cat, ctr: i.ctr, lote: i.lote, parc: (i.ref ? i.ref + ' ' : '') + i.parcelasTxt, comp: i.comprador,
    venc: i.vencimento || '', pago: i.pagoEm || '', cred: i.data_credito || '', bruto: i.bruto || 0, base: i.base || 0, taxa: i.linha?.tipo === 'credito' ? i.taxa : i.estimado ? i.taxa : 0,
    desconto: i.desconto || 0, taxaPct: i.taxaPct ?? null, esp: i.esp, inf: i.inf, dif: i.dif, why: i.why, problema: !CATM[i.cat].neutro, fora: !!CATM[i.cat].fora, resolvido: !!i.resolvido,
  }));
}
function ponte(conf) {
  const l = [
    ['Pago pelos compradores no mês (2ª parcela em diante)', conf.bruto, ''],
    [`(-) Taxas cobradas sobre essas parcelas${conf.taxasEstimadas ? ' (parte estimada pela taxa média)' : ''}`, -(conf.taxas + conf.taxasEstimadas), ''],
    ['= Repasse líquido esperado', conf.esperado, 'tot'],
    ['Relatórios enviados para o mês (valor final)', conf.totalRelatoriosMes, ''],
  ];
  if (conf.paraOutrosMeses) l.push(['(-) Linhas desses relatórios pagas em outros meses', -conf.paraOutrosMeses, '']);
  if (conf.deOutrosRelatorios) l.push(['(+) Parcelas do mês repassadas em relatórios de outros meses', conf.deOutrosRelatorios, '']);
  l.push(['= Transferido referente ao mês', conf.informado, 'tot']);
  l.push(['Diferença (transferido - esperado)', conf.dif, 'dif']);
  return l;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export function conferenciaPDF(conf, model) {
  const J = window.jspdf?.jsPDF; if (!J) return alert('Biblioteca de PDF não carregou.');
  const doc = new J({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 32;
  const VERDE = [23, 107, 70], VERDE_L = [230, 241, 235], CINZA = [92, 103, 97], CINZA2 = [138, 147, 142], VERM = [194, 65, 45], VERM_L = [251, 236, 232], LINHA = [226, 223, 216], AMBAR = [183, 121, 31];
  const mesTxt = nomeMes(conf.mes), gerado = new Date().toLocaleString('pt-BR', { timeZone: C.TZ });
  let y = 0;
  doc.setFillColor(...VERDE); doc.rect(0, 0, W, 58, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(pdfTxt('Conferência do repasse da Contabilidade'), M, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(pdfTxt(`SM Agropecuária · ${mesTxt} · Contabilidade: ${contabNomes(conf)}`), M, 45);
  doc.setFontSize(8.5); doc.text(pdfTxt(`Gerado em ${gerado}`), W - M, 45, { align: 'right' });
  y = 76;
  const cob = conf.taxaCobertura;
  const caixas = [
    ['Repasse líquido esperado', brl(conf.esperado), 'Pago pelos compradores - taxas cobradas'],
    ['Transferido pela contabilidade', brl(conf.informado), conf.confirmadoConta ? `Confirmado na conta: ${brl(conf.confirmadoConta)}` : EXTRATO[conf.extrato].split(' (')[0]],
    ['Taxas descontadas', brl(conf.taxas + conf.outrosDescontos), `Sobre parcelas ${brl(conf.taxas)} + outros ${brl(conf.outrosDescontos)}`],
    ['Taxa média da contabilidade', pct(conf.taxaMedia), cob.n === cob.total ? `Todas as ${cob.total} linhas de parcelas` : `Cobre ${cob.n} de ${cob.total} linhas`],
    ['Diferença', sg(conf.dif), conf.dif < 0 ? 'A SM recebeu menos que o esperado' : conf.dif > 0 ? 'Transferido acima do esperado' : 'Bate com o esperado'],
  ];
  const bw = (W - 2 * M - 4 * 10) / 5;
  caixas.forEach(([lbl, val, sub], k) => {
    const x = M + k * (bw + 10), dif = k === 4 && conf.dif !== 0;
    doc.setDrawColor(...(dif ? VERM : LINHA)); doc.setFillColor(...(dif ? VERM_L : [255, 255, 255])); doc.roundedRect(x, y, bw, 62, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...CINZA2); doc.text(pdfTxt(lbl), x + 10, y + 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14.5); doc.setTextColor(...(dif ? VERM : [17, 26, 21])); doc.text(val, x + 10, y + 36);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...CINZA); doc.text(doc.splitTextToSize(pdfTxt(sub), bw - 20)[0], x + 10, y + 52);
  });
  y += 76;
  doc.setFontSize(9); doc.setTextColor(...CINZA);
  doc.text(pdfTxt(`Situação: ${conf.pendencias ? `${conf.pendencias} item(ns) para conferir com a contabilidade` : 'nenhuma pendência'} · Conta da SM: ${EXTRATO[conf.extrato]}`), M, y);
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
  const meia = (W - 2 * M - 20) / 2;

  // conta do esperado (esquerda) + motivos (direita)
  titulo('Como chegamos aos valores');
  const y0 = y;
  doc.autoTable({ ...base, startY: y0, margin: { left: M, right: W - M - meia }, tableWidth: meia, head: [['Conta', 'Valor']],
    body: ponte(conf).map(([t, v, k]) => [pdfTxt(t), { content: k === 'dif' ? sg(v) : brl(v), k }]),
    columnStyles: { 1: { halign: 'right', cellWidth: 92, overflow: 'visible' } },
    didParseCell: alinhar({ 1: { halign: 'right' } }, (d) => { const k = d.row.raw?.[1]?.k; if (d.section === 'body' && k) { d.cell.styles.fontStyle = 'bold'; if (k === 'dif' && conf.dif) d.cell.styles.textColor = VERM; d.cell.styles.fillColor = [246, 244, 239]; } }) });
  const yEsq = doc.lastAutoTable.finalY;
  const probs = conf.cats.filter((c) => !c.neutro), neutros = conf.cats.filter((c) => c.neutro);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 26, 21);
  doc.text(pdfTxt(probs.length ? `Por que a diferença de ${brl(Math.abs(conf.dif))}` : 'Nenhuma divergência'), M + meia + 20, y0 - 8);
  doc.autoTable({ ...base, startY: y0, margin: { left: M + meia + 20, right: M }, tableWidth: meia, head: [['Motivo', 'Itens', 'Valor']],
    body: [...probs.map((c) => [pdfTxt(c.t), String(c.qtd), sg(c.dif)]), [{ content: 'Total explicado', styles: { fontStyle: 'bold' } }, '', { content: sg(probs.reduce((s, c) => s + c.dif, 0)), styles: { fontStyle: 'bold' } }],
      ...neutros.map((c) => [{ content: pdfTxt(`${c.t}${c.fora ? ' (fora da conta)' : ' (sem diferença)'}`), styles: { textColor: CINZA2 } }, { content: String(c.qtd), styles: { textColor: CINZA2 } }, { content: c.id === 'encargo' ? '+' + brl(conf.encargos) : c.id === 'aguardando' ? brl(conf.aguardando) : c.fora ? '-' : 'OK', styles: { textColor: CINZA2 } }])],
    columnStyles: { 1: { halign: 'center', cellWidth: 40 }, 2: { halign: 'right', cellWidth: 92, overflow: 'visible' } },
    didParseCell: alinhar({ 1: { halign: 'center' }, 2: { halign: 'right' } }, (d) => { if (d.section === 'body' && d.column.index === 2 && typeof d.cell.raw === 'string' && d.cell.raw.startsWith('-R')) d.cell.styles.textColor = VERM; }) });
  y = Math.max(yEsq, doc.lastAutoTable.finalY) + 22;

  // taxa média
  titulo('Taxa média da contabilidade', 'Soma das taxas cobradas ÷ soma das bases brutas × 100. Cada parcela pesa pelo seu valor.');
  const tcols = { 1: { halign: 'right', cellWidth: 70 }, 2: { halign: 'right', cellWidth: 100, overflow: 'visible' }, 3: { halign: 'right', cellWidth: 100, overflow: 'visible' }, 4: { halign: 'right', cellWidth: 80 } };
  const linhasT = conf.porRelatorio.map((x) => [pdfTxt(`${x.r.titulo || x.r.arquivo_nome} (${C.fmtD(x.r.periodo_inicio)} a ${C.fmtD(x.r.periodo_fim)}) · ${x.r.contabilidade?.nome || '-'}`), `${x.n}/${x.nLinhas}`, brl(x.base), brl(x.taxa), { content: pct(x.media), styles: { fontStyle: 'bold' } }]);
  doc.autoTable({ ...base, startY: y, head: [['Relatório', 'Linhas', 'Base bruta', 'Taxas', 'Taxa média']], body: linhasT,
    foot: [[pdfTxt('Consolidado do mês (sem repetições, pelo mês do pagamento)'), `${cob.n}/${cob.total}`, '', brl(conf.taxas), pct(conf.taxaMedia)]],
    footStyles: { fillColor: [246, 244, 239], textColor: [17, 26, 21], fontStyle: 'bold' }, columnStyles: { 0: { cellWidth: 'auto' }, ...tcols }, didParseCell: alinhar(tcols) });
  y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(8.5); doc.setTextColor(...(cob.n === cob.total && !cob.semBase ? CINZA : AMBAR));
  const obs = [cob.n === cob.total ? `A média cobre todas as ${cob.total} linhas de parcelas do mês.` : `Atenção: a média cobre ${cob.n} de ${cob.total} linhas; as demais não têm taxa e base identificadas.`,
    cob.semBase ? `${cob.semBase} desconto(s) avulso(s) não informam base e ficaram fora da média.` : '',
    conf.predominante != null ? `Taxa mais frequente: ${conf.predominante.toLocaleString('pt-BR')}%. ${conf.foraPadrao.length ? `${conf.foraPadrao.length} parcela(s) com taxa diferente: ${conf.foraPadrao.map((i) => `${i.ctr}/${i.parcelasTxt} (${C.pctTxt(i.taxaPct)})`).join(', ')}.` : 'Todas as parcelas com a mesma taxa.'}` : ''].filter(Boolean).join(' ');
  doc.text(doc.splitTextToSize(pdfTxt(obs), W - 2 * M), M, y + 4);
  y += 30;

  // detalhe das diferenças
  const linhas = dadosLinhas(conf);
  const probsL = linhas.filter((l) => l.problema);
  if (probsL.length) {
    titulo('Detalhe de cada diferença', 'Cada item mostra os valores e, logo abaixo, a explicação. Item e explicação ficam sempre na mesma página.');
    const fixas = [54, 44, 70, 62, 60, 82, 82, 82];
    const wComp = W - 2 * M - fixas.reduce((s, x) => s + x, 0);
    const cols = { 0: { cellWidth: 54 }, 1: { cellWidth: 44 }, 2: { cellWidth: 70 }, 3: { cellWidth: wComp, overflow: 'ellipsize' }, 4: { cellWidth: 62 }, 5: { halign: 'right', cellWidth: 60 },
      6: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 7: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 8: { halign: 'right', cellWidth: 82, overflow: 'visible' } };
    const cab = ['Contrato', 'Lote', 'Parcela', 'Comprador', 'Pago em', 'Taxa', 'Esperado', 'Transferido', 'Diferença'];
    for (const c of probs) {
      if (y > H - 120) { doc.addPage(); y = M + 10; }
      doc.autoTable({ ...base, startY: y, pageBreak: 'avoid', head: [cab], columnStyles: cols, didParseCell: alinhar(cols),
        body: [[{ content: pdfTxt(`${c.t}  ·  ${c.qtd} item(ns)  ·  ${sg(c.dif)}`), colSpan: 9, styles: { fontStyle: 'bold', fillColor: VERDE_L, textColor: [15, 59, 42] } }]] });
      y = doc.lastAutoTable.finalY;
      for (const l of probsL.filter((x) => x.i.cat === c.id)) {
        doc.autoTable({ ...base, startY: y, pageBreak: 'avoid', showHead: false, columnStyles: cols, body: [
          [l.ctr, l.lote, pdfTxt(l.parc), pdfTxt(l.comp), C.fmtD(l.pago || l.cred), l.taxaPct != null ? pct(l.taxaPct) : l.desconto ? brl(l.desconto) : '-', brl(l.esp), brl(l.inf), { content: sg(l.dif), styles: { textColor: l.dif < 0 ? VERM : [28, 38, 33], fontStyle: 'bold' } }],
          [{ content: pdfTxt(`Por quê: ${l.why}${l.resolvido ? `  [Resolvido: ${l.i.resolucao}]` : ''}`), colSpan: 9, styles: { fontSize: 8, textColor: CINZA, fontStyle: 'italic', cellPadding: { top: 1, bottom: 6, left: 14, right: 6 } } }]] });
        y = doc.lastAutoTable.finalY;
      }
      y += 10;
    }
    y += 12;
  }

  // relatórios
  titulo('Relatórios da contabilidade considerados');
  const rcols = { 2: { halign: 'right', cellWidth: 82, overflow: 'visible' }, 3: { halign: 'right', cellWidth: 72, overflow: 'visible' }, 4: { halign: 'right', cellWidth: 86, overflow: 'visible' } };
  doc.autoTable({ ...base, startY: y, head: [['Relatório', 'Créditos de', 'Créditos', 'Descontos', 'Valor final', 'Contabilidade', 'Conta da SM']],
    body: conf.reps.map((r) => [pdfTxt(r.titulo || '-'), `${C.fmtD(r.periodo_inicio)} a ${C.fmtD(r.periodo_fim)}`, brl(C.cents(r.creditos)), brl(C.cents(r.taxas) + C.cents(r.debitos)), { content: brl(C.cents(r.valor_final)), styles: { fontStyle: 'bold' } },
      pdfTxt(r.contabilidade?.nome || '-'), pdfTxt(r.extrato_status === 'confirmado' ? `Confirmado em ${C.fmtD(r.extrato_data)} (${brl(C.cents(r.extrato_valor))})` : r.extrato_status === 'divergente' ? `Divergente: ${brl(C.cents(r.extrato_valor))}` : 'Aguardando extrato')]),
    foot: [[{ content: 'Total', styles: { fontStyle: 'bold' } }, '', brl(conf.reps.reduce((s, r) => s + C.cents(r.creditos), 0)), brl(conf.reps.reduce((s, r) => s + C.cents(r.taxas) + C.cents(r.debitos), 0)), { content: brl(conf.totalRelatoriosMes), styles: { fontStyle: 'bold' } }, '', '']],
    footStyles: { fillColor: [246, 244, 239], textColor: [17, 26, 21], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 'auto', overflow: 'ellipsize' }, 1: { cellWidth: 112 }, ...rcols, 5: { cellWidth: 90, overflow: 'ellipsize' }, 6: { cellWidth: 150 } }, didParseCell: alinhar(rcols) });

  // todas as linhas
  doc.addPage(); y = M + 10;
  titulo('Todas as parcelas e descontos conferidos', 'Base = valor bruto do relatório (taxa + transferido). Taxa em % sobre a base. Os detalhes de cada diferença estão na seção anterior.');
  const acols = { 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' } };
  doc.autoTable({ ...base, startY: y, styles: { ...base.styles, fontSize: 7.4, cellPadding: { top: 2.2, bottom: 2.2, left: 4, right: 4 } },
    head: [['Contrato', 'Lote', 'Parcela', 'Comprador', 'Venc.', 'Pago em', 'Crédito', 'Valor pago', 'Base', 'Taxa', 'Esperado', 'Transferido', 'Diferença', 'Situação']],
    body: linhas.map((l) => [l.ctr, l.lote, pdfTxt(l.parc), pdfTxt(l.comp), C.fmtD(l.venc), C.fmtD(l.pago), C.fmtD(l.cred), l.bruto ? brl(l.bruto) : '-', l.base ? brl(l.base) : '-',
      l.taxaPct != null ? pct(l.taxaPct) : l.desconto ? brl(l.desconto) : '-', brl(l.esp), brl(l.inf),
      { content: l.dif ? sg(l.dif) : '-', styles: { textColor: l.dif < 0 ? VERM : [28, 38, 33], fontStyle: l.dif ? 'bold' : 'normal' } }, pdfTxt(l.cat + (l.resolvido ? ' (resolvido)' : ''))]),
    foot: [['Total', '', '', '', '', '', '', '', '', '', brl(conf.esperado), brl(conf.informado), sg(conf.dif), '']],
    footStyles: { fillColor: [246, 244, 239], textColor: [17, 26, 21], fontStyle: 'bold' }, didParseCell: alinhar(acols),
    columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 32 }, 2: { cellWidth: 48 }, 3: { cellWidth: 'auto', overflow: 'ellipsize' }, 4: { cellWidth: 48 }, 5: { cellWidth: 48 }, 6: { cellWidth: 48 },
      7: { halign: 'right', cellWidth: 60, overflow: 'visible' }, 8: { halign: 'right', cellWidth: 60, overflow: 'visible' }, 9: { halign: 'right', cellWidth: 42, overflow: 'visible' }, 10: { halign: 'right', cellWidth: 60, overflow: 'visible' },
      11: { halign: 'right', cellWidth: 60, overflow: 'visible' }, 12: { halign: 'right', cellWidth: 56, overflow: 'visible' }, 13: { cellWidth: 96, overflow: 'ellipsize' } } });

  const n = doc.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA2);
    doc.text(pdfTxt(`SM Agropecuária · Recebimentos · Conferência do repasse da Contabilidade · ${mesTxt}`), M, H - 14);
    doc.text(`Página ${p} de ${n}`, W - M, H - 14, { align: 'right' });
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
const dt = (iso) => (iso ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : '');
const rs = (c) => Math.round(c) / 100;
export function conferenciaExcel(conf, model, soGerar = false) {
  const X = window.XLSX; if (!X) return alert('Biblioteca de Excel não carregou.');
  const FMT_RS = '"R$" #,##0.00;[Red]-"R$" #,##0.00', FMT_D = 'dd/mm/yyyy', FMT_P = '0.00%';
  const mesTxt = nomeMes(conf.mes), cob = conf.taxaCobertura;
  const wb = X.utils.book_new();
  const aba = (nome, aoa, larguras, fmts = {}) => {
    const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
    const rng = X.utils.decode_range(ws['!ref']);
    for (let r = rng.s.r; r <= rng.e.r; r++) for (let c = rng.s.c; c <= rng.e.c; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })]; if (!cell) continue;
      if (cell.t === 'n' && fmts[c] === 'rs') cell.z = FMT_RS;
      if (cell.t === 'n' && fmts[c] === 'pct') cell.z = FMT_P;
      if (cell.t === 'd' || cell.v instanceof Date) cell.z = FMT_D;
    }
    ws['!cols'] = larguras.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, nome);
  };
  const linhas = dadosLinhas(conf);
  const probs = conf.cats.filter((c) => !c.neutro), neutros = conf.cats.filter((c) => c.neutro);
  aba('Resumo', [
    [`SM Agropecuária — Conferência do repasse da Contabilidade — ${mesTxt}`], [`Contabilidade: ${contabNomes(conf)} · Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: C.TZ })}`], [],
    ['RESUMO', 'Valor'], ['Repasse líquido esperado', rs(conf.esperado)], ['Transferido pela contabilidade', rs(conf.informado)], ['Confirmado na conta da SM', rs(conf.confirmadoConta)],
    ['Taxas descontadas (total)', rs(conf.taxas + conf.outrosDescontos)], ['   Taxas sobre parcelas', rs(conf.taxas)], ['   Outros descontos', rs(conf.outrosDescontos)],
    ['Diferença (transferido - esperado)', rs(conf.dif)], ['Itens para conferir', conf.pendencias], ['Conta da SM', EXTRATO[conf.extrato]], [],
    ['TAXA MÉDIA DA CONTABILIDADE', 'Taxa'], ['Consolidado do mês (soma das taxas ÷ soma das bases)', conf.taxaMedia ?? ''], ['Linhas cobertas', `${cob.n} de ${cob.total}`],
    ...conf.porRelatorio.map((x) => [`Relatório: ${x.r.titulo || x.r.arquivo_nome} (${C.fmtD(x.r.periodo_inicio)} a ${C.fmtD(x.r.periodo_fim)})`, x.media ?? '']),
    ['Taxa mais frequente (%)', conf.predominante ?? ''], [],
    ['COMO CHEGAMOS AOS VALORES', 'Valor'], ...ponte(conf).map(([t, v]) => [t, rs(v)]), [],
    ['POR QUE A DIFERENÇA', 'Valor', 'Itens'], ...probs.map((c) => [c.t, rs(c.dif), c.qtd]), ['Total explicado', rs(probs.reduce((s, c) => s + c.dif, 0)), ''], [],
    ['CONFERIDO SEM DIFERENÇA OU FORA DA CONTA', '', 'Itens'], ...neutros.map((c) => [c.t, '', c.qtd]),
  ], [80, 18, 8], { 1: 'rs' });
  // as células de taxa no resumo são percentuais
  const wsR = wb.Sheets.Resumo; for (const ref of Object.keys(wsR)) { if (ref[0] === '!') continue; const cell = wsR[ref]; const row = X.utils.decode_cell(ref).r; const label = wsR[X.utils.encode_cell({ r: row, c: 0 })]?.v || '';
    if (cell.t === 'n' && X.utils.decode_cell(ref).c === 1 && /Consolidado do mês|^Relatório:/.test(label)) cell.z = FMT_P; if (cell.t === 'n' && /Taxa mais frequente/.test(label)) cell.z = '0.00'; }
  aba('Diferenças', [['Motivo', 'Contrato', 'Lote', 'Parcela', 'Comprador', 'Pago em', 'Taxa (%)', 'Esperado', 'Transferido', 'Diferença', 'Resolvido', 'Explicação'],
    ...linhas.filter((l) => l.problema).map((l) => [CATM[l.i.cat].t, +l.ctr || l.ctr, l.lote, l.parc, l.comp, dt(l.pago || l.cred), l.taxaPct ?? '', rs(l.esp), rs(l.inf), rs(l.dif), l.resolvido ? `Sim: ${l.i.resolucao}` : 'Não', l.why])],
    [32, 10, 8, 12, 34, 12, 10, 14, 14, 14, 18, 120], { 6: 'pct', 7: 'rs', 8: 'rs', 9: 'rs' });
  aba('Todas as linhas', [['Contrato', 'Lote', 'Parcela', 'Comprador', 'Vencimento', 'Pago em', 'Crédito', 'Valor pago', 'Base bruta', 'Taxa (R$)', 'Taxa (%)', 'Outro desconto', 'Esperado', 'Transferido', 'Diferença', 'Situação', 'Fora da conta', 'Explicação'],
    ...linhas.map((l) => [+l.ctr || l.ctr, l.lote, l.parc, l.comp, dt(l.venc), dt(l.pago), dt(l.cred), rs(l.bruto), rs(l.base), rs(l.taxa), l.taxaPct ?? '', rs(l.desconto), rs(l.esp), rs(l.inf), rs(l.dif), l.cat + (l.resolvido ? ' (resolvido)' : ''), l.fora ? 'Sim' : '', l.why]),
    ['Total', '', '', '', '', '', '', '', '', rs(conf.taxas), conf.taxaMedia ?? '', rs(conf.outrosDescontos), rs(conf.esperado), rs(conf.informado), rs(conf.dif), '', '', '']],
    [10, 8, 12, 34, 12, 12, 12, 14, 14, 12, 10, 14, 14, 14, 14, 24, 10, 120], { 7: 'rs', 8: 'rs', 9: 'rs', 10: 'pct', 11: 'rs', 12: 'rs', 13: 'rs', 14: 'rs' });
  aba('Relatórios', [['Relatório', 'Arquivo', 'Contabilidade', 'Créditos de', 'Créditos até', 'Taxa média', 'Créditos', 'Débitos', 'Outros descontos', 'Valor final', 'Conta da SM', 'Data no extrato', 'Valor no extrato'],
    ...conf.reps.map((r) => { const t = conf.porRelatorio.find((x) => x.r.id === r.id); return [r.titulo || '', r.arquivo_nome || '', r.contabilidade?.nome || '', dt(r.periodo_inicio), dt(r.periodo_fim), t?.media ?? '', +r.creditos, +r.debitos, +r.taxas, +r.valor_final,
      { confirmado: 'Confirmado', divergente: 'Divergente', pendente: 'Aguardando extrato' }[r.extrato_status], dt(r.extrato_data), r.extrato_valor == null ? '' : +r.extrato_valor]; })],
    [40, 50, 20, 13, 13, 11, 14, 12, 15, 14, 20, 15, 16], { 5: 'pct', 6: 'rs', 7: 'rs', 8: 'rs', 9: 'rs', 12: 'rs' });
  if (soGerar) return wb;
  X.writeFile(wb, arquivo(conf.mes, 'xlsx'));
}

export function baixarPDF(conf, model) { const d = conferenciaPDF(conf, model); if (d) d.save(arquivo(conf.mes, 'pdf')); }
