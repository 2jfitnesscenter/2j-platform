import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const require = createRequire(import.meta.url);
const FONT_REGULAR = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
const FONT_SEMIBOLD = require.resolve('@fontsource/inter/files/inter-latin-600-normal.woff');

export type InvoiceLine = { description: string; quantity?: number | null; unitNetCents?: number | null; netCents: number; taxTreatment: 'taxable' | 'exempt' | 'non_subject'; taxRateBasisPoints: number | null; taxCents: number; taxDescription?: string | null };
export type InvoiceParty = { name?: string | null; taxId?: string | null; address?: string | null; postalCode?: string | null; locality?: string | null; province?: string | null };
export type InvoiceTotals = { netCents: number; taxCents: number; grossCents: number; byRate?: Array<{ taxTreatment: string; rateBasisPoints: number | null; baseCents: number; taxCents: number }> };
export type InvoiceDocumentData = {
  documentType: 'simplified_ticket' | 'full_invoice';
  /** Present on a rectifying invoice: the number and date of the invoice it corrects, and why. */
  rectifies?: { documentNumber: string; documentDate: string; reason: string } | null;
  documentNumber: string;
  documentDate: string;
  issuer: InvoiceParty & { footerText?: string | null; legalText?: string | null };
  client: InvoiceParty;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  paymentMethods: Array<{ method: string; amountCents: number }>;
  paymentStatus?: 'paid' | 'pending' | null;
};
export type InvoiceLogo = { bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/svg+xml' };
export type InvoiceVariant = 'a4' | 'ticket';

const GRAPHITE = '#23272b';
const MUTED = '#6b7178';
const RULE = '#d9dde1';
const LIME = '#a4d65e';
const METHOD_LABEL: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };

export const eurosText = (cents: number) => `${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100)}`;
const percentText = (basisPoints: number | null) => basisPoints == null ? '—' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(basisPoints / 100)} %`;
const dateText = (value: string) => { const [year, month, day] = value.slice(0, 10).split('-'); return `${day}/${month}/${year}`; };
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function partyLines(party: InvoiceParty): string[] {
  const place = [clean(party.postalCode), clean(party.locality)].filter(Boolean).join(' ');
  return [clean(party.address), [place, clean(party.province)].filter(Boolean).join(', ')].filter(Boolean);
}

/** Rate breakdown by tax treatment/rate, computed from the lines when the snapshot has none (older documents). */
export function rateBreakdown(lines: InvoiceLine[]) {
  const groups = new Map<string, { taxTreatment: string; rateBasisPoints: number | null; baseCents: number; taxCents: number }>();
  for (const line of lines) {
    const key = line.taxTreatment === 'taxable' ? `t:${line.taxRateBasisPoints ?? 0}` : line.taxTreatment;
    const group = groups.get(key) ?? { taxTreatment: line.taxTreatment, rateBasisPoints: line.taxTreatment === 'taxable' ? line.taxRateBasisPoints ?? 0 : null, baseCents: 0, taxCents: 0 };
    group.baseCents += line.netCents; group.taxCents += line.taxCents; groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (left.rateBasisPoints ?? -1) - (right.rateBasisPoints ?? -1));
}
const treatmentLabel = (group: { taxTreatment: string; rateBasisPoints: number | null }) => group.taxTreatment === 'taxable' ? `IGIC ${percentText(group.rateBasisPoints)}` : group.taxTreatment === 'exempt' ? 'Exento de IGIC' : 'No sujeto a IGIC';

function drawLogo(doc: PDFKit.PDFDocument, logo: InvoiceLogo, x: number, y: number, maxWidth: number, maxHeight: number) {
  if (logo.mime === 'image/svg+xml') SVGtoPDF(doc, logo.bytes.toString('utf8'), x, y, { width: maxWidth, height: maxHeight, assumePt: true, preserveAspectRatio: 'xMinYMin meet', fontCallback: (_family: string, bold: boolean) => bold ? 'semibold' : 'regular' });
  else doc.image(logo.bytes, x, y, { fit: [maxWidth, maxHeight] });
}

function setup(doc: PDFKit.PDFDocument) { doc.registerFont('regular', FONT_REGULAR); doc.registerFont('semibold', FONT_SEMIBOLD); doc.font('regular').fillColor(GRAPHITE); }

function documentTitle(data: InvoiceDocumentData) {
  if (data.rectifies) return 'FACTURA RECTIFICATIVA';
  return data.documentType === 'full_invoice' ? 'FACTURA' : 'TICKET';
}
function statusText(data: InvoiceDocumentData) {
  const methods = data.paymentMethods.filter((item) => item.amountCents !== 0).map((item) => METHOD_LABEL[item.method] ?? item.method);
  return { methods: [...new Set(methods)].join(' + '), status: data.paymentStatus === 'paid' ? 'Pagada' : data.paymentStatus === 'pending' ? 'Pendiente de pago' : '' };
}

function renderA4(doc: PDFKit.PDFDocument, data: InvoiceDocumentData, logo: InvoiceLogo | null) {
  const left = 48; const right = doc.page.width - 48; const width = right - left; const bottomLimit = () => doc.page.height - 64;
  // Header: logo (or the business name in brand type) on the left, title, number and date on the right.
  const top = 48;
  if (logo) drawLogo(doc, logo, left, top, 150, 56);
  else if (clean(data.issuer.name)) doc.font('semibold').fontSize(18).fillColor(GRAPHITE).text(clean(data.issuer.name), left, top, { width: 260 });
  doc.font('semibold').fontSize(20).fillColor(GRAPHITE).text(documentTitle(data), left + 280, top, { width: width - 280, align: 'right' });
  doc.rect(right - 36, top + 28, 36, 3).fill(LIME);
  doc.font('regular').fontSize(10).fillColor(MUTED).text(`Nº ${data.documentNumber}`, left + 280, top + 40, { width: width - 280, align: 'right' }).text(`Fecha ${dateText(data.documentDate)}`, left + 280, doc.y, { width: width - 280, align: 'right' });
  let y = Math.max(doc.y, top + 64) + 22;

  if (data.rectifies) {
    doc.font('regular').fontSize(9).fillColor(MUTED).text(`Rectifica la factura ${data.rectifies.documentNumber} de fecha ${dateText(data.rectifies.documentDate)}.`, left, y, { width });
    doc.text(`Motivo: ${clean(data.rectifies.reason)}`, left, doc.y, { width });
    y = doc.y + 14;
  }

  // Issuer and client blocks. Empty fields are simply not printed.
  const colWidth = (width - 24) / 2;
  const block = (title: string, party: InvoiceParty, x: number) => {
    doc.font('semibold').fontSize(8).fillColor(MUTED).text(title, x, y, { width: colWidth, characterSpacing: 0.6 });
    doc.font('semibold').fontSize(10).fillColor(GRAPHITE);
    if (clean(party.name)) doc.text(clean(party.name), x, doc.y + 2, { width: colWidth });
    doc.font('regular').fontSize(9).fillColor(GRAPHITE);
    if (clean(party.taxId)) doc.text(`NIF ${clean(party.taxId)}`, x, doc.y, { width: colWidth });
    for (const line of partyLines(party)) doc.text(line, x, doc.y, { width: colWidth });
    return doc.y;
  };
  const issuerEnd = block('EMISOR', data.issuer, left);
  const clientEnd = data.documentType === 'full_invoice' || clean(data.client.name) ? block('CLIENTE', data.client, left + colWidth + 24) : y;
  y = Math.max(issuerEnd, clientEnd) + 22;

  // Lines table with a header that repeats on every page.
  const cols = [{ key: 'concept', label: 'Concepto', x: left, w: 198, align: 'left' }, { key: 'qty', label: 'Cant.', x: left + 198, w: 36, align: 'right' }, { key: 'unit', label: 'Precio', x: left + 234, w: 66, align: 'right' }, { key: 'base', label: 'Base', x: left + 300, w: 66, align: 'right' }, { key: 'rate', label: 'IGIC', x: left + 366, w: 52, align: 'right' }, { key: 'amount', label: 'Importe', x: left + 418, w: width - 418, align: 'right' }] as const;
  const header = () => {
    doc.font('semibold').fontSize(8).fillColor(MUTED);
    for (const col of cols) doc.text(col.label.toUpperCase(), col.x, y, { width: col.w, align: col.align as 'left' | 'right', characterSpacing: 0.4 });
    y += 14; doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(GRAPHITE).stroke(); y += 6;
  };
  header();
  for (const line of data.lines) {
    const quantity = line.quantity ?? 1;
    const description = clean(line.description) + (line.taxTreatment !== 'taxable' && line.taxDescription ? ` (${clean(line.taxDescription)})` : '');
    doc.font('regular').fontSize(9.5);
    const height = Math.max(doc.heightOfString(description, { width: cols[0].w - 8 }), 12);
    if (y + height + 10 > bottomLimit() - 24) { doc.addPage(); y = 56; header(); doc.font('regular').fontSize(9.5); }
    const values: Record<string, string> = { concept: description, qty: new Intl.NumberFormat('es-ES').format(quantity), unit: eurosText(line.unitNetCents ?? line.netCents), base: eurosText(line.netCents), rate: line.taxTreatment === 'taxable' ? percentText(line.taxRateBasisPoints) : line.taxTreatment === 'exempt' ? 'Exento' : 'No sujeto', amount: eurosText(line.netCents + line.taxCents) };
    doc.fillColor(GRAPHITE);
    for (const col of cols) doc.text(values[col.key]!, col.x, y, { width: col.key === 'concept' ? col.w - 8 : col.w, align: col.align as 'left' | 'right' });
    y += height + 8; doc.moveTo(left, y - 3).lineTo(right, y - 3).lineWidth(0.4).strokeColor(RULE).stroke();
  }

  // Totals: taxable base, one row per tax rate, total.
  const breakdown = data.totals.byRate?.length ? data.totals.byRate : rateBreakdown(data.lines);
  const rows: Array<[string, string, boolean]> = [['Base imponible', eurosText(data.totals.netCents), false], ...breakdown.map((group): [string, string, boolean] => [`${treatmentLabel(group)} sobre ${eurosText(group.baseCents)}`, eurosText(group.taxCents), false]), ['TOTAL', eurosText(data.totals.grossCents), true]];
  const need = rows.length * 18 + 110;
  if (y + need > bottomLimit()) { doc.addPage(); y = 56; }
  y += 10;
  const labelX = left + width - 280;
  for (const [label, value, strong] of rows) {
    if (strong) { doc.moveTo(labelX, y - 2).lineTo(right, y - 2).lineWidth(0.8).strokeColor(GRAPHITE).stroke(); y += 4; }
    doc.font(strong ? 'semibold' : 'regular').fontSize(strong ? 12 : 9.5).fillColor(GRAPHITE).text(label, labelX, y, { width: 190, align: 'left' }).text(value, labelX + 190, y, { width: 90, align: 'right' });
    y += strong ? 22 : 17;
  }
  const payment = statusText(data);
  if (payment.methods || payment.status) {
    y += 6;
    doc.font('regular').fontSize(9).fillColor(MUTED).text([payment.methods ? `Forma de pago: ${payment.methods}` : '', payment.status].filter(Boolean).join('  ·  '), left, y, { width });
    y = doc.y;
  }

  // Footer: business data and the editable legal text, only what exists.
  const footer = [clean(data.issuer.footerText), clean(data.issuer.legalText)].filter(Boolean);
  if (footer.length) {
    doc.font('regular').fontSize(8).fillColor(MUTED);
    const text = footer.join('\n');
    const footerHeight = doc.heightOfString(text, { width });
    const footerTop = Math.max(y + 24, doc.page.height - 56 - footerHeight);
    if (footerTop + footerHeight > doc.page.height - 36) doc.addPage();
    const placed = footerTop + footerHeight > doc.page.height - 36 ? 56 : footerTop;
    doc.moveTo(left, placed - 8).lineTo(right, placed - 8).lineWidth(0.4).strokeColor(RULE).stroke();
    doc.text(text, left, placed, { width });
  }
}

function renderTicket(doc: PDFKit.PDFDocument, data: InvoiceDocumentData, logo: InvoiceLogo | null) {
  const left = 14; const width = doc.page.width - 28; let y = 16;
  if (logo) { drawLogo(doc, logo, left, y, width, 40); y += 48; }
  else if (clean(data.issuer.name)) { doc.font('semibold').fontSize(11).fillColor(GRAPHITE).text(clean(data.issuer.name), left, y, { width, align: 'center' }); y = doc.y + 2; }
  doc.font('regular').fontSize(7.5).fillColor(MUTED);
  if (clean(data.issuer.taxId)) { doc.text(`NIF ${clean(data.issuer.taxId)}`, left, y, { width, align: 'center' }); y = doc.y; }
  for (const line of partyLines(data.issuer)) { doc.text(line, left, y, { width, align: 'center' }); y = doc.y; }
  y += 6; doc.rect(left + width / 2 - 14, y, 28, 2).fill(LIME); y += 8;
  doc.font('semibold').fontSize(9).fillColor(GRAPHITE).text(documentTitle(data), left, y, { width, align: 'center' });
  doc.font('regular').fontSize(7.5).fillColor(MUTED).text(`Nº ${data.documentNumber} · ${dateText(data.documentDate)}`, left, doc.y + 1, { width, align: 'center' });
  y = doc.y + 6;
  if (data.rectifies) { doc.text(`Rectifica ${data.rectifies.documentNumber}. ${clean(data.rectifies.reason)}`, left, y, { width, align: 'center' }); y = doc.y + 4; }
  if (clean(data.client.name)) { doc.fillColor(GRAPHITE).text(clean(data.client.name) + (clean(data.client.taxId) ? ` · NIF ${clean(data.client.taxId)}` : ''), left, y, { width, align: 'center' }); y = doc.y + 4; }
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(RULE).stroke(); y += 6;
  for (const line of data.lines) {
    doc.font('regular').fontSize(8).fillColor(GRAPHITE).text(clean(line.description), left, y, { width: width - 52 });
    const lineEnd = doc.y;
    doc.text(eurosText(line.netCents + line.taxCents), left + width - 52, y, { width: 52, align: 'right' });
    y = Math.max(lineEnd, doc.y) + 3;
  }
  y += 2; doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(RULE).stroke(); y += 6;
  const breakdown = data.totals.byRate?.length ? data.totals.byRate : rateBreakdown(data.lines);
  const row = (label: string, value: string, strong = false) => { doc.font(strong ? 'semibold' : 'regular').fontSize(strong ? 10 : 7.5).fillColor(GRAPHITE).text(label, left, y, { width: width - 70 }); doc.text(value, left + width - 70, y, { width: 70, align: 'right' }); y = doc.y + 2; };
  row('Base imponible', eurosText(data.totals.netCents));
  for (const group of breakdown) row(`${treatmentLabel(group)} (${eurosText(group.baseCents)})`, eurosText(group.taxCents));
  row('TOTAL', eurosText(data.totals.grossCents), true);
  const payment = statusText(data);
  if (payment.methods || payment.status) { doc.font('regular').fontSize(7.5).fillColor(MUTED).text([payment.methods, payment.status].filter(Boolean).join(' · '), left, y + 2, { width, align: 'center' }); y = doc.y; }
  const footer = [clean(data.issuer.footerText), clean(data.issuer.legalText)].filter(Boolean).join('\n');
  if (footer) { doc.font('regular').fontSize(6.5).fillColor(MUTED).text(footer, left, y + 8, { width, align: 'center' }); y = doc.y; }
  return y + 16;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => { doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
}

/** Renders an issued document (from its immutable snapshots) to a PDF: A4 for invoices, a compact 80 mm roll for tickets. */
export async function renderInvoicePdf(data: InvoiceDocumentData, options: { logo?: InvoiceLogo | null; variant?: InvoiceVariant } = {}): Promise<Buffer> {
  const logo = options.logo ?? null;
  const info = { Title: `${documentTitle(data)} ${data.documentNumber}`, Producer: '2J Platform', Creator: '2J Platform' };
  if (options.variant === 'ticket') {
    // First pass on a tall page to measure the content, second pass on a page of exactly that height.
    const probe = new PDFDocument({ size: [226.77, 3000], margin: 0, info, compress: false }); setup(probe); const probeDone = collect(probe);
    const height = renderTicket(probe, data, logo); probe.end(); await probeDone;
    const doc = new PDFDocument({ size: [226.77, Math.max(160, Math.ceil(height))], margin: 0, info }); setup(doc); const done = collect(doc);
    renderTicket(doc, data, logo); doc.end(); return done;
  }
  const doc = new PDFDocument({ size: 'A4', margin: 0, info, bufferPages: false }); setup(doc); const done = collect(doc);
  renderA4(doc, data, logo); doc.end(); return done;
}
