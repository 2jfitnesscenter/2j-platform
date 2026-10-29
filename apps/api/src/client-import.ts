import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2_000;
const MAX_XLS_COLUMNS = 64;
const uuid = z.string().uuid();

export type ClientImportRow = {
  rowNumber: number; firstName: string; lastName: string; email: string | null; phone: string | null; birthDate: string | null; errors: string[];
  externalId?: string | null; memberNumber?: string | null; joinedAt?: string | null; gender?: 'F' | 'M' | null;
  lastReservationAt?: string | null; provenance?: string | null; tags?: string | null; activityStatus?: 'active' | 'inactive';
  completenessStatus?: 'complete' | 'imported_incomplete'; incompleteFields?: string[]; duplicateFields?: string[]; reviewFlags?: string[];
};
export type ClientImportPreview = {
  rows: ClientImportRow[]; rowCount: number; validCount: number; invalidCount: number; sourceFormat: 'csv' | 'xlsx' | 'xls';
  timpSummary?: { total: number; active: number; inactive: number; incomplete: number; incompleteByField: Record<'email' | 'phone' | 'gender' | 'birthDate', number>; duplicateEmailRows: number; duplicatePhoneRows: number; minorsReview: number };
};

function decodeCsv(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data.subarray(2));
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

function chooseDelimiter(header: string): ',' | ';' {
  let commas = 0; let semicolons = 0; let quoted = false;
  for (let i = 0; i < header.length; i += 1) {
    const char = header[i]!;
    if (char === '"' && header[i + 1] === '"' && quoted) { i += 1; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

export function parseCsvRows(data: Buffer): string[][] {
  const text = decodeCsv(data).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('invalid_encoding');
  const firstLineEnd = text.search(/[\r\n]/);
  const delimiter = chooseDelimiter(firstLineEnd < 0 ? text : text.slice(0, firstLineEnd));
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error('invalid_csv');
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
  return rows;
}

/** Reject malformed/oversized ZIP containers before the XLSX parser can expand their contents. */
export function validateXlsxContainer(data: Buffer) {
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('invalid_excel');
  const minOffset = Math.max(0, data.length - 65_557);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > data.length) throw new Error('invalid_excel');
  const entries = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || entries < 1 || entries > 256 || centralOffset + centralSize > eocd) throw new Error('invalid_excel');
  let offset = centralOffset; let totalExpanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid_excel');
    const flags = data.readUInt16LE(offset + 8);
    const expanded = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    if ((flags & 1) !== 0 || expanded === 0xffffffff || nameLength < 1) throw new Error('invalid_excel');
    const nameEnd = offset + 46 + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (next > eocd) throw new Error('invalid_excel');
    const name = data.toString('utf8', offset + 46, nameEnd);
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || name.toLocaleLowerCase('en-US').includes('vbaproject')) throw new Error('invalid_excel');
    totalExpanded += expanded;
    if (totalExpanded > 20 * 1024 * 1024) throw new Error('excel_expanded_too_large');
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw new Error('invalid_excel');
}

export async function parseXlsxRows(data: Buffer): Promise<string[][]> {
  validateXlsxContainer(data);
  let workbook: ExcelJS.Workbook;
  try { workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data as any); }
  catch { throw new Error('invalid_excel'); }
  if (workbook.worksheets.length !== 1) throw new Error('one_sheet_required');
  const sheet = workbook.worksheets[0]!;
  if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_XLS_COLUMNS) throw new Error('too_many_rows');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number > MAX_ROWS + 1) throw new Error('too_many_rows');
    const cells: string[] = [];
    for (let column = 1; column <= Math.max(1, row.cellCount); column += 1) {
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Hyperlink) throw new Error('formula_not_allowed');
      const value = cell.value;
      if (value instanceof Date) cells.push(`${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`);
      else if (value == null) cells.push('');
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') cells.push(String(value));
      else throw new Error('cell_type_not_allowed');
    }
    if (cells.some((value) => value.trim() !== '')) rows.push(cells);
  });
  if (rows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
  return rows;
}

const headerKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s-]+/g, '_');
const timpColumns = {
  externalId: ['id'], firstName: ['nombre'], lastName: ['apellidos'], joinedAt: ['fecha_de_alta', 'fecha_alta'],
  memberNumber: ['codigo_de_cliente', 'codigo_cliente'], email: ['correo_electronico', 'correo', 'email'],
  phone: ['telefono', 'movil'], gender: ['genero'], birthDate: ['fecha_de_nacimiento', 'fecha_nacimiento'],
  lastReservationAt: ['fecha_ultima_reserva', 'fecha_de_ultima_reserva'], provenance: ['procedencias', 'procedencia'], tags: ['etiquetas'],
} as const;
const timpKeys = Object.values(timpColumns).flat();
const timpRequired = Object.keys(timpColumns) as Array<keyof typeof timpColumns>;
const columns = {
  firstName: new Set(['nombre', 'first_name', 'firstname']),
  lastName: new Set(['apellidos', 'apellido', 'last_name', 'lastname', 'surname']),
  email: new Set(['email', 'correo', 'correo_electronico']),
  phone: new Set(['telefono', 'phone', 'movil', 'mobile']),
  birthDate: new Set(['fecha_nacimiento', 'fecha_de_nacimiento', 'birth_date', 'birthdate']),
} as const;

function dateOnly(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(text);
  const es = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(text);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : es ? [Number(es[3]), Number(es[2]), Number(es[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const d = new Date(Date.UTC(year!, month! - 1, day!));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month! - 1 && d.getUTCDate() === day ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

function isoDateFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

function canaryDateOnly(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

/** Parse legacy binary Excel (.xls) with hard bounds and without evaluating formulas or links. */
export function parseXlsRows(data: Buffer): string[][] {
  if (data.length === 0) throw new Error('file_required');
  if (data.length > MAX_BYTES) throw new Error('file_too_large');
  if (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) throw new Error('invalid_excel');
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(data, { type: 'buffer', cellDates: true, bookVBA: false, WTF: false }); }
  catch { throw new Error('invalid_excel'); }
  if (workbook.SheetNames.length !== 1) throw new Error('one_sheet_required');
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet || !sheet['!ref']) throw new Error('header_required');
  let range: XLSX.Range;
  try { range = XLSX.utils.decode_range(sheet['!ref']); } catch { throw new Error('invalid_excel'); }
  if (range.e.r - range.s.r + 1 > MAX_ROWS + 1) throw new Error('too_many_rows');
  if (range.e.c - range.s.c + 1 > MAX_XLS_COLUMNS) throw new Error('too_many_columns');
  return extractXlsRows(sheet, range);
}

/** Convert a bounded worksheet range while rejecting cells that could execute or redirect data. */
export function extractXlsRows(sheet: XLSX.WorkSheet, range: XLSX.Range): string[][] {
  const header: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })] as XLSX.CellObject | undefined;
    if (cell?.f || cell?.l) throw new Error('formula_not_allowed');
    header.push(cell?.v == null ? '' : String(cell.w ?? cell.v));
  }
  const dateIndexes = new Set(header.map(headerKey).flatMap((key, index) => ['fecha_de_alta', 'fecha_alta', 'fecha_de_nacimiento', 'fecha_nacimiento', 'fecha_ultima_reserva', 'fecha_de_ultima_reserva'].includes(key) ? [index] : []));
  const rows: string[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })] as XLSX.CellObject | undefined;
      if (cell?.f || cell?.l) throw new Error('formula_not_allowed');
      const value = cell?.v;
      if (value == null) row.push('');
      else if (value instanceof Date) row.push(isoDateFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) ?? '');
      else if (typeof value === 'number' && dateIndexes.has(column - range.s.c)) {
        const date = XLSX.SSF.parse_date_code(value);
        row.push(date ? isoDateFromParts(date.y, date.m, date.d) ?? '' : String(cell?.w ?? value));
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') row.push(String(cell?.w ?? value));
      else throw new Error('cell_type_not_allowed');
    }
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  if (rows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
  return rows;
}

function isTimpHeader(header: string[]): boolean {
  const normalized = header.map(headerKey);
  return timpRequired.every((field) => normalized.some((key) => (timpColumns[field] as readonly string[]).includes(key)));
}

const normalizePhone = (value: string) => value.normalize('NFKC').replace(/[^\d+]/g, '');
const missingFields = ['email', 'phone', 'gender', 'birthDate'] as const;

export function previewTimpRows(rawRows: string[][], sourceFormat: ClientImportPreview['sourceFormat'], options: { existingEmails?: ReadonlySet<string>; existingPhones?: ReadonlySet<string>; now?: Date } = {}): ClientImportPreview {
  if (!rawRows.length) throw new Error('header_required');
  if (rawRows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
  const header = rawRows[0]!.map(headerKey);
  if (!isTimpHeader(rawRows[0]!)) throw new Error('timp_columns_missing');
  if (new Set(header).size !== header.length) throw new Error('duplicate_columns');
  const indexes = Object.fromEntries(Object.entries(timpColumns).map(([key, aliases]) => [key, header.findIndex((value) => (aliases as readonly string[]).includes(value))])) as Record<keyof typeof timpColumns, number>;
  if (Object.values(indexes).some((index) => index < 0) || Object.values(indexes).some((index) => header.filter((value) => value === header[index]).length > 1)) throw new Error('duplicate_columns');
  const recognized = new Set<string>(timpKeys);
  const ignored = header.map((key, index) => ({ key, index })).filter(({ key }) => !recognized.has(key));
  const debtColumns = new Set(['deuda_total']);
  if (ignored.some(({ key, index }) => !debtColumns.has(key) && rawRows.slice(1).some((row) => (row[index] ?? '').trim() !== ''))) throw new Error('unsupported_columns');
  const now = options.now ?? new Date();
  const today = canaryDateOnly(now);
  const cutoff = shiftDate(today, -365);
  const rows = rawRows.slice(1).map((values, index): ClientImportRow => {
    const cell = (key: keyof typeof timpColumns) => (values[indexes[key]] ?? '').normalize('NFKC').trim();
    const rawBirthDate = cell('birthDate'); const rawJoinedAt = cell('joinedAt'); const rawLastReservation = cell('lastReservationAt');
    const birthDate = rawBirthDate ? dateOnly(rawBirthDate) : null;
    const joinedAt = rawJoinedAt ? dateOnly(rawJoinedAt) : null;
    const lastReservationAt = rawLastReservation ? dateOnly(rawLastReservation) : null;
    const emailRaw = cell('email'); const email = emailRaw ? emailRaw.toLocaleLowerCase('en-US') : null;
    const phoneRaw = cell('phone'); const phone = phoneRaw || null;
    const genderRaw = cell('gender').toLocaleUpperCase('en-US');
    const gender = genderRaw === 'F' || genderRaw === 'M' ? genderRaw : null;
    const firstName = cell('firstName'); const lastName = cell('lastName');
    const errors: string[] = [];
    if (!cell('externalId')) errors.push('source_id_missing');
    if (!firstName || firstName.length > 80) errors.push('first_name_invalid');
    if (!lastName || lastName.length > 100) errors.push('last_name_invalid');
    if (rawBirthDate && !birthDate) errors.push('birth_date_invalid');
    if (rawJoinedAt && !joinedAt) errors.push('joined_date_invalid');
    if (rawLastReservation && !lastReservationAt) errors.push('last_reservation_date_invalid');
    if (genderRaw && !gender) errors.push('gender_invalid');
    if (email && !z.string().email().max(254).safeParse(email).success) errors.push('email_invalid');
    if (phone && phone.length > 40) errors.push('phone_invalid');
    if (values.length !== header.length) errors.push('column_count_mismatch');
    if (lastReservationAt && lastReservationAt > today) errors.push('last_reservation_in_future');
    const incompleteFields = missingFields.filter((field) => field === 'email' ? !email : field === 'phone' ? !phone : field === 'gender' ? !gender : !birthDate);
    const activityStatus = lastReservationAt && lastReservationAt <= today && lastReservationAt >= cutoff ? 'active' : 'inactive';
    return {
      rowNumber: index + 2, firstName, lastName, email, phone, birthDate, errors,
      externalId: cell('externalId') || null, memberNumber: cell('memberNumber') || null, joinedAt, gender,
      lastReservationAt, provenance: cell('provenance') || null, tags: cell('tags') || null, activityStatus,
      completenessStatus: incompleteFields.length ? 'imported_incomplete' : 'complete', incompleteFields,
      duplicateFields: [], reviewFlags: birthDate ? [] : ['minor_review'],
    };
  });
  const duplicateRows = (field: 'email' | 'phone', existing: ReadonlySet<string> = new Set()) => {
    const key = (row: ClientImportRow) => field === 'email' ? row.email : row.phone ? normalizePhone(row.phone) : null;
    const groups = new Map<string, ClientImportRow[]>();
    for (const row of rows) { const value = key(row); if (value) groups.set(value, [...(groups.get(value) ?? []), row]); }
    let count = 0;
    for (const [value, group] of groups) if (group.length > 1 || existing.has(value)) {
      for (const row of group) { row.duplicateFields!.push(field); count += 1; }
    }
    return count;
  };
  const emailSet = new Set([...(options.existingEmails ?? [])].map((value) => value.toLocaleLowerCase('en-US')));
  const phoneSet = new Set([...(options.existingPhones ?? [])].map(normalizePhone));
  const duplicateEmailRows = duplicateRows('email', emailSet);
  const duplicatePhoneRows = duplicateRows('phone', phoneSet);
  const incompleteByField = Object.fromEntries(missingFields.map((field) => [field, rows.filter((row) => row.incompleteFields!.includes(field)).length])) as Record<typeof missingFields[number], number>;
  const validCount = rows.filter((row) => row.errors.length === 0).length;
  return {
    rows, rowCount: rows.length, validCount, invalidCount: rows.length - validCount, sourceFormat,
    timpSummary: {
      total: rows.length, active: rows.filter((row) => row.activityStatus === 'active').length,
      inactive: rows.filter((row) => row.activityStatus === 'inactive').length,
      incomplete: rows.filter((row) => row.completenessStatus === 'imported_incomplete').length,
      incompleteByField, duplicateEmailRows, duplicatePhoneRows,
      minorsReview: rows.filter((row) => row.reviewFlags?.includes('minor_review')).length,
    },
  };
}

export function previewClientRows(rawRows: string[][], sourceFormat: 'csv' | 'xlsx', existingEmails: ReadonlySet<string> = new Set()): ClientImportPreview {
  if (!rawRows.length) throw new Error('header_required');
  if (rawRows.length > MAX_ROWS + 1) throw new Error('too_many_rows');
  const header = rawRows[0]!.map(headerKey);
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, aliases]) => [key, header.findIndex((value) => aliases.has(value))])) as Record<keyof typeof columns, number>;
  if (indexes.firstName < 0 || indexes.lastName < 0) throw new Error('required_columns_missing');
  if (new Set(header).size !== header.length) throw new Error('duplicate_columns');
  const recognized = new Set(Object.values(columns).flatMap((aliases) => [...aliases]));
  if (header.some((value) => !recognized.has(value))) throw new Error('unsupported_columns');
  if (Object.values(columns).some((aliases) => header.filter((value) => aliases.has(value)).length > 1)) throw new Error('duplicate_columns');
  const seenEmails = new Set<string>();
  const rows = rawRows.slice(1).map((values, i): ClientImportRow => {
    const cell = (key: keyof typeof columns) => indexes[key] < 0 ? '' : (values[indexes[key]] ?? '').normalize('NFKC').trim();
    const firstName = cell('firstName'); const lastName = cell('lastName');
    const emailRaw = cell('email'); const email = emailRaw ? emailRaw.toLocaleLowerCase('en-US') : null;
    const phoneRaw = cell('phone'); const phone = phoneRaw || null;
    const birthRaw = cell('birthDate'); const birthDate = dateOnly(birthRaw);
    const errors: string[] = [];
    if (values.length !== header.length) errors.push('column_count_mismatch');
    if (!firstName || firstName.length > 80) errors.push('first_name_invalid');
    if (!lastName || lastName.length > 100) errors.push('last_name_invalid');
    if (email && (!z.string().email().max(254).safeParse(email).success || existingEmails.has(email) || seenEmails.has(email))) errors.push('email_duplicate_or_invalid');
    if (email) seenEmails.add(email);
    if (phone && phone.length > 40) errors.push('phone_invalid');
    if (birthRaw && !birthDate) errors.push('birth_date_invalid');
    return { rowNumber: i + 2, firstName, lastName, email, phone, birthDate, errors };
  });
  const validCount = rows.filter((row) => row.errors.length === 0).length;
  return { rows, rowCount: rows.length, validCount, invalidCount: rows.length - validCount, sourceFormat };
}

export function previewClientCsv(data: Buffer, existingEmails: ReadonlySet<string> = new Set()): ClientImportPreview {
  if (data.length === 0) throw new Error('file_required');
  if (data.length > MAX_BYTES) throw new Error('file_too_large');
  return previewClientRows(parseCsvRows(data), 'csv', existingEmails);
}

export async function previewClientXlsx(data: Buffer, existingEmails: ReadonlySet<string> = new Set()): Promise<ClientImportPreview> {
  if (data.length === 0) throw new Error('file_required');
  if (data.length > MAX_BYTES) throw new Error('file_too_large');
  return previewClientRows(await parseXlsxRows(data), 'xlsx', existingEmails);
}

export function registerClientImportRoutes(app: FastifyInstance, db: DB, resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>, enabled = false) {
  app.post('/api/clients/import/preview', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolveStaff(request);
    if (!actor) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(actor, 'clients.manage')) return reply.code(403).send({ error: 'permission_denied' });
    if (!enabled) return reply.code(404).send({ error: 'client_import_preview_disabled' });
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart_required' });
    let fileData: Buffer | null = null;
    let sourceFormat: 'csv' | 'xlsx' | 'xls' = 'csv';
    try {
      const file = await request.file({ limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 } });
      if (!file || file.fieldname !== 'file') return reply.code(400).send({ error: 'file_required' });
      const filename = file.filename.toLocaleLowerCase('en-US');
      if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) { file.file.resume(); return reply.code(415).send({ error: 'spreadsheet_format_unsupported' }); }
      sourceFormat = filename.endsWith('.xlsx') ? 'xlsx' : filename.endsWith('.xls') ? 'xls' : 'csv';
      fileData = await file.toBuffer();
      if (file.file.truncated || fileData.length > MAX_BYTES) return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_BYTES });
    } catch (error: any) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_BYTES });
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    let parsed: ClientImportPreview;
    try {
      const rawRows = sourceFormat === 'csv' ? parseCsvRows(fileData!) : sourceFormat === 'xlsx' ? await parseXlsxRows(fileData!) : parseXlsRows(fileData!);
      const timp = isTimpHeader(rawRows[0] ?? []);
      if (sourceFormat === 'xls' && !timp) throw new Error('timp_columns_missing');
      const preliminary = timp ? previewTimpRows(rawRows, sourceFormat) : previewClientRows(rawRows, sourceFormat as 'csv' | 'xlsx');
      const emails = new Set(preliminary.rows.flatMap((row) => row.email ? [row.email] : []));
      const phones = new Set(preliminary.rows.flatMap((row) => row.phone ? [normalizePhone(row.phone)] : []));
      const existing: Array<{ email: string | null; phone: string | null }> = emails.size || phones.size ? await db`
        SELECT lower(email) AS email,phone FROM clients WHERE status='active' AND (
          (email IS NOT NULL AND lower(email)=ANY(${[...emails]}::text[])) OR
          (phone IS NOT NULL AND regexp_replace(phone,'[^0-9+]','','g')=ANY(${[...phones]}::text[]))
        )` as Array<{ email: string | null; phone: string | null }> : [];
      const existingEmails = new Set(existing.flatMap((row) => row.email ? [row.email] : []));
      const existingPhones = new Set(existing.flatMap((row) => row.phone ? [normalizePhone(row.phone)] : []));
      parsed = timp ? previewTimpRows(rawRows, sourceFormat, { existingEmails, existingPhones })
        : sourceFormat === 'csv' ? previewClientRows(rawRows, 'csv', existingEmails) : previewClientRows(rawRows, 'xlsx', existingEmails);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_csv';
      const status = code === 'file_too_large' ? 413 : 400;
      return reply.code(status).send({ error: ['file_required', 'file_too_large', 'header_required', 'too_many_rows', 'too_many_columns', 'required_columns_missing', 'timp_columns_missing', 'duplicate_columns', 'unsupported_columns', 'invalid_csv', 'invalid_encoding', 'invalid_excel', 'excel_expanded_too_large', 'one_sheet_required', 'formula_not_allowed', 'cell_type_not_allowed'].includes(code) ? code : 'invalid_spreadsheet' });
    }
    try {
      await db.begin(async (tx) => {
        await tx`INSERT INTO client_import_preview_audit(id,actor_id,source_format,row_count,valid_count,invalid_count) VALUES (${randomUUID()},${actor.actorId},${parsed.sourceFormat},${parsed.rowCount},${parsed.validCount},${parsed.invalidCount})`;
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      request.log.error({ databaseCode: code, route: 'POST /api/clients/import/preview' }, 'client import preview audit failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.send({ mode: 'dry_run', commitAvailable: false, approvalRequiredForRealImport: true, ...parsed });
  });
}
