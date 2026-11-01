import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const FONT = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
const FONT_SEMIBOLD = require.resolve('@fontsource/inter/files/inter-latin-600-normal.woff');

export type EconomyPdfSummary = {
  from: string;
  to: string;
  generatedAt: string;
  actorId: string;
  soldCents: number;
  collectedCents: number;
  pendingCents: number;
  overdueCents: number;
  overdueCount: number;
  byMethod: Array<{ method: string; cents: number }>;
  custodyNotice: string | null;
};

export async function buildEconomySummaryPdf(summary: EconomyPdfSummary): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Resumen económico 2J', Author: '2J Platform' } });
  doc.registerFont('regular', FONT).registerFont('semibold', FONT_SEMIBOLD);
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const graphite = '#23272B';
  const muted = '#626A70';
  doc.font('semibold').fontSize(20).fillColor(graphite).text('INFORME ECONÓMICO', { continued: true });
  doc.font('regular').fontSize(9).fillColor('#52633A').text('   2J FITNESS CENTER', { align: 'right' });
  doc.moveDown(0.6).moveTo(48, doc.y).lineTo(547, doc.y).lineWidth(2).strokeColor('#A4D65E').stroke();
  doc.moveDown(0.7).font('semibold').fontSize(11).fillColor(graphite).text(`Periodo: ${summary.from} — ${summary.to}`);
  doc.moveDown(0.2).font('regular').fontSize(9).fillColor(muted).text(`Generado: ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'short', timeStyle: 'short' }).format(new Date(summary.generatedAt))} · Usuario: ${summary.actorId}`);
  const money = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const line = (label: string, value: string) => {
    doc.moveDown(0.5).font('regular').fontSize(10).fillColor(muted).text(label, 52, doc.y, { continued: true });
    doc.font('semibold').fillColor(graphite).text(value, { align: 'right' });
  };
  doc.moveDown(1).font('semibold').fontSize(13).fillColor(graphite).text('Totales del periodo');
  line('Vendido', money(summary.soldCents));
  line('Cobrado', money(summary.collectedCents));
  line('Pendiente', money(summary.pendingCents));
  doc.moveDown(0.5).font('semibold').fontSize(11).fillColor(graphite).text('Impagos a fecha de generación');
  line(`Cargos vencidos (${summary.overdueCount})`, money(summary.overdueCents));
  doc.moveDown(0.9).font('semibold').fontSize(11).fillColor(graphite).text('Cobros por método');
  for (const row of summary.byMethod) line(row.method, money(row.cents));
  if (summary.custodyNotice) {
    doc.moveDown(1).roundedRect(48, doc.y, 499, 48, 6).fill('#F2F4EF');
    doc.font('semibold').fontSize(9).fillColor(graphite).text('Aviso de custodia', 60, doc.y - 36);
    doc.font('regular').fontSize(9).fillColor(muted).text(summary.custodyNotice, 60, doc.y - 21, { width: 475 });
  }
  doc.moveDown(2).font('regular').fontSize(8).fillColor(muted).text('Zona horaria: Atlantic/Canary. Los importes de caja y diferencias solo se incluyen para usuarios con permiso owner.panel.read.', { width: 499 });
  doc.end();
  return result;
}
