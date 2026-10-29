import { crc32, deflateRawSync } from 'node:zlib';

/** Generador mínimo de .xlsx (OOXML dentro de un zip) sin dependencias: texto en línea, números, cabecera en negrita y formato de importe. */
export type XlsxCell = string | number | null;
export type XlsxSheet = { name: string; rows: XlsxCell[][]; money?: number[] };

const escapeXml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
/** El texto libre (nombres, conceptos) que una hoja de cálculo podría leer como fórmula se neutraliza igual que en el CSV. */
export const neutralizeFormula = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const columnName = (index: number) => { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name; };
const sheetName = (name: string, used: Set<string>) => { let base = name.replace(/[\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja'; let candidate = base; for (let i = 2; used.has(candidate.toLowerCase()); i += 1) candidate = `${base.slice(0, 28)} ${i}`; used.add(candidate.toLowerCase()); return candidate; };

function sheetXml(sheet: XlsxSheet) {
  const money = new Set(sheet.money ?? []);
  const rows = sheet.rows.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => {
    if (cell === null || cell === '') return '';
    const ref = `${columnName(c)}${r + 1}`;
    if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"${money.has(c) ? ' s="2"' : ''}><v>${cell}</v></c>` : '';
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(neutralizeFormula(cell))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const widths = (sheet.rows[0] ?? []).map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(48, Math.max(12, ...sheet.rows.slice(0, 200).map((row) => String(row[c] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${widths ? `<cols>${widths}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
}

function zip(files: Array<{ name: string; data: Buffer }>) {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const packed = deflateRawSync(file.data); const crc = crc32(file.data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(0x5821, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(8, 10); head.writeUInt32LE(0x5821, 12); head.writeUInt32LE(crc, 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(file.data.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, name, packed); central.push(head, name); offset += 30 + name.length + packed.length;
  }
  const centralBuffer = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuffer, end]);
}

export function buildXlsx(sheets: XlsxSheet[]) {
  const used = new Set<string>(); const names = sheets.map((sheet) => sheetName(sheet.name, used));
  const text = (value: string) => Buffer.from(value, 'utf8');
  const files = [
    { name: '[Content_Types].xml', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>') },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: text(sheetXml(sheet)) })),
  ];
  return zip(files);
}
