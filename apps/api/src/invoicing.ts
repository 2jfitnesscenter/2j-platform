import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ObjectStorage } from './object-storage.js';
import { rateBreakdown, renderInvoicePdf, type InvoiceDocumentData, type InvoiceLine, type InvoiceLogo } from './invoice-pdf.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const MAX_LOGO_BYTES = 512 * 1024;
const READ = 'billing.read-tax';
const MANAGE = 'billing.invoices.manage';
const REQUIRED_ISSUER_FIELDS = [['issuerName', 'nombre o razón social'], ['issuerTaxId', 'NIF'], ['issuerAddress', 'dirección']] as const;

type LogoKind = { mime: 'image/png' | 'image/jpeg' | 'image/svg+xml'; extension: 'png' | 'jpg' | 'svg' };
/** The real type is decided from the bytes, never from the file name or the declared content type. */
export function sniffLogo(data: Buffer): LogoKind | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  const head = data.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', extension: 'svg' };
  return null;
}
/** An SVG logo is embedded in a document that may be opened anywhere: no scripts, no external or embedded resources, no entities. */
export function svgIsSafe(svg: string) {
  return !/<script|<foreignObject|<iframe|<object|<embed|<image\b|<use\b|<!ENTITY|<!DOCTYPE|javascript:|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?!#)|url\(\s*["']?\s*(?!#)(?:https?:|data:|\/\/)/i.test(svg);
}

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.union([text(max), z.literal('').transform(() => null), z.null()]).optional();
const settingsInput = z.object({
  issuerName: optionalText(160), issuerTaxId: optionalText(30), issuerAddress: optionalText(240), issuerPostalCode: optionalText(20), issuerLocality: optionalText(100), issuerProvince: optionalText(100),
  defaultIgicBasisPoints: z.number().int().min(0).max(10_000).optional(), defaultSeriesId: uuid.nullable().optional(), footerText: optionalText(600), legalText: optionalText(1500),
}).strict();

const euros = (cents: number) => cents;

type BuiltPdf = { pdf: Buffer; filename: string; length: number };
/** Renders the stored, immutable document. `onlyClientId` makes a member lookup match only that client's own documents. */
export async function buildDocumentPdf(db: DB, storage: ObjectStorage, documentId: string, variant: 'a4' | 'ticket', onlyClientId: string | null = null): Promise<BuiltPdf | null> {
  const [row] = await db`SELECT d.*,o.document_number AS "originalNumber",o.document_date::text AS "originalDate" FROM economic_fiscal_documents d LEFT JOIN economic_fiscal_documents o ON o.id=d.rectifies_document_id WHERE d.id=${documentId}::uuid AND (${onlyClientId}::uuid IS NULL OR d.client_id=${onlyClientId}::uuid)`;
  if (!row) return null;
  const issuerSnapshot = row.issuer_snapshot as Record<string, any>;
  let logo: InvoiceLogo | null = null;
  if (issuerSnapshot.logo?.key) { const bytes = await storage.get(issuerSnapshot.logo.key); if (bytes) logo = { bytes, mime: issuerSnapshot.logo.mime }; }
  const methods = (row.payment_methods as Array<{ method: string; amountCents: number }>) ?? [];
  const totals = row.totals_snapshot as InvoiceDocumentData['totals'];
  const data: InvoiceDocumentData = {
    documentType: row.document_type, documentNumber: row.document_number, documentDate: String(row.document_date).slice(0, 10),
    rectifies: row.rectifies_document_id ? { documentNumber: row.originalNumber, documentDate: String(row.originalDate), reason: row.rectification_reason } : null,
    issuer: { name: issuerSnapshot.name, taxId: issuerSnapshot.taxId, address: issuerSnapshot.address, postalCode: issuerSnapshot.postalCode, locality: issuerSnapshot.locality, province: issuerSnapshot.province, footerText: issuerSnapshot.footerText, legalText: issuerSnapshot.legalText },
    client: row.client_snapshot as InvoiceDocumentData['client'], lines: row.lines_snapshot as InvoiceLine[], totals,
    paymentMethods: methods, paymentStatus: row.rectifies_document_id ? null : methods.reduce((sum, item) => sum + Number(item.amountCents), 0) >= Number(totals.grossCents) ? 'paid' : 'pending',
  };
  const pdf = await renderInvoicePdf(data, { logo, variant });
  const safeNumber = String(row.document_number).replace(/[^A-Za-z0-9._-]/g, '_');
  return { pdf, length: pdf.length, filename: `${data.rectifies ? 'rectificativa' : data.documentType === 'full_invoice' ? 'factura' : 'ticket'}-${safeNumber}.pdf` };
}
const sendPdf = (reply: any, built: BuiltPdf) => reply.header('Content-Type', 'application/pdf').header('Content-Length', built.length).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
  .header('Content-Disposition', `inline; filename="${built.filename}"`).send(built.pdf);

/**
 * Member self-service: a member sees only the documents of the client the authenticated session resolves to (never a client id from the request).
 * The list carries no issuer/client snapshots; the PDF is the same immutable document staff print. A document of another client answers 404.
 */
export function registerMemberInvoiceRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, resolveClient: (request: FastifyRequest) => Promise<{ clientId: string } | null>, storage: ObjectStorage) {
  async function member(request: FastifyRequest, reply: any) {
    reply.header('Cache-Control', 'private, no-store');
    const actor = await resolveClient(request);
    if (!actor || !uuid.safeParse(actor.clientId).success) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    const clientId = actor.clientId.toLowerCase();
    const [active] = await db`SELECT id FROM clients WHERE id=${clientId}::uuid AND status='active'`;
    if (!active) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    return clientId;
  }
  app.get('/api/me/invoices', async (request, reply) => {
    const clientId = await member(request, reply); if (!clientId) return;
    const items = await db`SELECT d.id,d.document_type AS "documentType",d.status,d.document_number AS "documentNumber",d.document_date::text AS "documentDate",(d.totals_snapshot->>'grossCents')::bigint AS "grossCents",
        (d.rectifies_document_id IS NOT NULL) AS "isRectification",EXISTS(SELECT 1 FROM economic_fiscal_documents r WHERE r.rectifies_document_id=d.id) AS "isRectified"
      FROM economic_fiscal_documents d WHERE d.client_id=${clientId}::uuid ORDER BY d.issued_at DESC,d.id DESC LIMIT 200`;
    return { items: items.map((row: any) => ({ ...row, grossCents: Number(row.grossCents) })) };
  });
  app.get('/api/me/invoices/:invoiceId/pdf', async (request, reply) => {
    const clientId = await member(request, reply); if (!clientId) return;
    const params = z.object({ invoiceId: uuid }).strict().safeParse(request.params);
    const query = z.object({ variant: z.enum(['a4', 'ticket']).default('a4') }).strict().safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const built = await buildDocumentPdf(db, storage, params.data.invoiceId, query.data.variant, clientId);
    if (!built) return reply.code(404).send({ error: 'document_not_found' });
    return sendPdf(reply, built);
  });
}

export function registerInvoicingRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>, storage: ObjectStorage) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }
  async function audit(tx: any, context: AuthorizationContext, action: string, type: string, id: string, clientId: string | null, details: Record<string, unknown> = {}) {
    await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},${action},${type},${id},${clientId},${JSON.stringify(details)}::jsonb)`;
  }
  const readSettings = async (tx: any) => {
    const [row] = await tx`SELECT issuer_name AS "issuerName",issuer_tax_id AS "issuerTaxId",issuer_address AS "issuerAddress",issuer_postal_code AS "issuerPostalCode",issuer_locality AS "issuerLocality",issuer_province AS "issuerProvince",
      default_igic_basis_points AS "defaultIgicBasisPoints",default_series_id AS "defaultSeriesId",footer_text AS "footerText",legal_text AS "legalText",logo_key AS "logoKey",logo_mime AS "logoMime",updated_at AS "updatedAt" FROM economic_invoice_settings WHERE singleton=true`;
    return row as Record<string, any>;
  };
  const missingFields = (settings: Record<string, any>, seriesId: string | null) => [
    ...REQUIRED_ISSUER_FIELDS.filter(([key]) => !String(settings[key] ?? '').trim()).map(([, label]) => label),
    ...(seriesId ? [] : ['serie de numeración']),
  ];

  // ------------------------------------------------------------------------------------------------------------------ settings
  app.get('/api/economics/invoice-settings', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, READ); if (!context) return;
    const settings = await readSettings(db);
    const series = await db`SELECT id,name,prefix,next_number AS "nextNumber",active FROM economic_invoice_series ORDER BY name`;
    const { logoKey, logoMime, ...visible } = settings;
    return { ...visible, hasLogo: Boolean(logoKey), logoMime: logoMime ?? null, series: series.map((row: any) => ({ ...row, nextNumber: Number(row.nextNumber) })), missing: missingFields(settings, settings.defaultSeriesId), canManage: can(context, MANAGE) };
  });

  app.put('/api/economics/invoice-settings', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    const body = settingsInput.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const patch = body.data;
    try {
      const result = await db.begin(async (tx) => {
        if (patch.defaultSeriesId) { const [series] = await tx`SELECT id FROM economic_invoice_series WHERE id=${patch.defaultSeriesId}::uuid AND active=true`; if (!series) return { error: 'series_not_found' as const }; }
        const current = await readSettings(tx);
        const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) } as Record<string, any>;
        await tx`UPDATE economic_invoice_settings SET issuer_name=${next.issuerName ?? null},issuer_tax_id=${next.issuerTaxId ?? null},issuer_address=${next.issuerAddress ?? null},issuer_postal_code=${next.issuerPostalCode ?? null},issuer_locality=${next.issuerLocality ?? null},issuer_province=${next.issuerProvince ?? null},
          default_igic_basis_points=${next.defaultIgicBasisPoints},default_series_id=${next.defaultSeriesId ?? null},footer_text=${next.footerText ?? null},legal_text=${next.legalText ?? null},updated_by=${context.actorId},updated_at=now() WHERE singleton=true`;
        await audit(tx, context, 'invoice.settings_updated', 'invoice_settings', '00000000-0000-4000-8000-000000000001', null, { fields: Object.keys(patch) });
        return { ok: true as const };
      });
      if ('error' in result) return reply.code(404).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    } catch { return reply.code(500).send({ error: 'invoice_settings_failed' }); }
  });

  app.put('/api/economics/invoice-settings/logo', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart_required' });
    let bytes: Buffer;
    try {
      const file = await request.file({ limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0, parts: 1 } });
      if (!file || file.fieldname !== 'file') return reply.code(400).send({ error: 'file_required' });
      bytes = await file.toBuffer();
      if (file.file.truncated || bytes.length > MAX_LOGO_BYTES) return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_LOGO_BYTES });
    } catch (error: any) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_LOGO_BYTES });
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    if (bytes.length === 0) return reply.code(400).send({ error: 'file_required' });
    const kind = sniffLogo(bytes);
    if (!kind) return reply.code(415).send({ error: 'unsupported_logo_type', allowed: ['image/png', 'image/jpeg', 'image/svg+xml'] });
    if (kind.mime === 'image/svg+xml' && !svgIsSafe(bytes.toString('utf8'))) return reply.code(422).send({ error: 'unsafe_svg' });
    // Content-addressed and never overwritten: an issued invoice keeps pointing at the exact logo it was issued with.
    const key = `invoice-logos/${createHash('sha256').update(bytes).digest('hex')}.${kind.extension}`;
    try { await storage.put(key, bytes, { contentType: kind.mime }); }
    catch { return reply.code(503).send({ error: 'storage_unavailable' }); }
    await db.begin(async (tx) => {
      await tx`UPDATE economic_invoice_settings SET logo_key=${key},logo_mime=${kind.mime},updated_by=${context.actorId},updated_at=now() WHERE singleton=true`;
      await audit(tx, context, 'invoice.logo_changed', 'invoice_settings', '00000000-0000-4000-8000-000000000001', null, { mime: kind.mime, sizeBytes: bytes.length });
    });
    return reply.code(200).send({ hasLogo: true, logoMime: kind.mime });
  });

  app.delete('/api/economics/invoice-settings/logo', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    // Only the setting is cleared: the stored file stays because issued invoices may still reference it.
    await db.begin(async (tx) => {
      await tx`UPDATE economic_invoice_settings SET logo_key=NULL,logo_mime=NULL,updated_by=${context.actorId},updated_at=now() WHERE singleton=true`;
      await audit(tx, context, 'invoice.logo_removed', 'invoice_settings', '00000000-0000-4000-8000-000000000001', null, {});
    });
    return reply.code(200).send({ hasLogo: false });
  });

  app.get('/api/economics/invoice-settings/logo', async (request, reply) => {
    const context = await auth(request, reply, READ); if (!context) return;
    const settings = await readSettings(db);
    if (!settings.logoKey) return reply.code(404).send({ error: 'logo_not_found' });
    const bytes = await storage.get(settings.logoKey);
    if (!bytes) return reply.code(404).send({ error: 'logo_not_found' });
    return reply.header('Content-Type', settings.logoMime).header('Cache-Control', 'private, no-store').header('Content-Security-Policy', 'sandbox').header('X-Content-Type-Options', 'nosniff').send(bytes);
  });

  // ------------------------------------------------------------------------------------------------------------------ issuing
  /** Takes the next number of the series inside the caller's transaction: a rolled-back issue gives the number back, so numbering has no gaps. */
  async function issueFromDraft(tx: any, context: AuthorizationContext, draftId: string) {
    const [draft] = await tx`SELECT id,client_id AS "clientId",series_id AS "seriesId",document_type AS "documentType",source_charge_id AS "sourceChargeId",line_items AS lines,payment_methods AS "paymentMethods",fiscal_snapshot AS "fiscalSnapshot",net_cents AS "netCents",tax_cents AS "taxCents",gross_cents AS "grossCents" FROM economic_invoice_drafts WHERE id=${draftId}::uuid FOR UPDATE`;
    if (!draft) return { error: 'draft_not_found' as const };
    const [already] = await tx`SELECT id,document_number AS "documentNumber",status FROM economic_fiscal_documents WHERE draft_id=${draftId}::uuid AND rectifies_document_id IS NULL`;
    if (already) return { document: { id: already.id as string, documentNumber: already.documentNumber as string, status: already.status as string }, replay: true as const };
    const settings = await readSettings(tx);
    const missing = missingFields(settings, draft.seriesId);
    if (missing.length) return { error: 'issuer_incomplete' as const, missing };
    const [taken] = await tx`SELECT * FROM economic_take_next_document_number(${draft.seriesId}::uuid)`;
    if (!taken) return { error: 'series_inactive' as const };
    const lines = (draft.lines as InvoiceLine[]).map((line) => ({ ...line, quantity: line.quantity ?? 1, unitNetCents: line.unitNetCents ?? line.netCents }));
    const profile = draft.fiscalSnapshot as Record<string, any>;
    let client: Record<string, unknown>;
    if (profile?.legalName) client = { name: profile.legalName, taxId: profile.taxId ?? null, address: profile.billingAddress ?? null, postalCode: profile.postalCode ?? null, locality: profile.locality ?? null, province: profile.province ?? null, countryCode: profile.countryCode ?? null };
    else { const [person] = await tx`SELECT first_name AS "firstName",last_name AS "lastName" FROM clients WHERE id=${draft.clientId}::uuid`; client = { name: draft.documentType === 'full_invoice' || !person ? null : `${person.firstName} ${person.lastName}` }; }
    const issuer = { name: settings.issuerName, taxId: settings.issuerTaxId, address: settings.issuerAddress, postalCode: settings.issuerPostalCode ?? null, locality: settings.issuerLocality ?? null, province: settings.issuerProvince ?? null, footerText: settings.footerText ?? null, legalText: settings.legalText ?? null, logo: settings.logoKey ? { key: settings.logoKey, mime: settings.logoMime } : null };
    const totals = { netCents: Number(draft.netCents), taxCents: Number(draft.taxCents), grossCents: Number(draft.grossCents), byRate: rateBreakdown(lines) };
    const [document] = await tx`INSERT INTO economic_fiscal_documents(draft_id,document_type,status,series_id,series_name,document_number,source_charge_id,client_id,issuer_snapshot,client_snapshot,lines_snapshot,payment_methods,totals_snapshot,issued_by)
      VALUES (${draft.id}::uuid,${draft.documentType},'issued',${draft.seriesId}::uuid,${taken.series_name},${taken.display_number},${draft.sourceChargeId}::uuid,${draft.clientId}::uuid,${JSON.stringify(issuer)}::jsonb,${JSON.stringify(client)}::jsonb,${JSON.stringify(lines)}::jsonb,${JSON.stringify(draft.paymentMethods)}::jsonb,${JSON.stringify(totals)}::jsonb,${context.actorId})
      RETURNING id,document_number AS "documentNumber",status`;
    if (!document) throw new Error('document insert returned no row');
    await audit(tx, context, 'invoice.issued', 'fiscal_document', document.id, draft.clientId, { documentNumber: document.documentNumber, documentType: draft.documentType, grossCents: euros(Number(draft.grossCents)) });
    return { document: { id: document.id as string, documentNumber: document.documentNumber as string, status: document.status as string }, replay: false as const };
  }
  const issueStatus = (error: string) => error === 'draft_not_found' ? 404 : error === 'issuer_incomplete' ? 409 : 409;

  app.post('/api/economics/invoice-drafts/:draftId/issue', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    const params = z.object({ draftId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin((tx) => issueFromDraft(tx, context, params.data.draftId));
      if ('error' in result) return reply.code(issueStatus(result.error)).send({ error: result.error, ...('missing' in result ? { missing: result.missing } : {}) });
      return reply.code(result.replay ? 200 : 201).send({ ...result.document, replay: result.replay });
    } catch { return reply.code(500).send({ error: 'invoice_issue_failed' }); }
  });

  /** One step for the screens: a paid charge becomes a ticket or an invoice with one line at the default IGIC rate. */
  app.post('/api/economics/charges/:chargeId/invoice', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    const params = z.object({ chargeId: uuid }).strict().safeParse(request.params);
    const body = z.object({ documentType: z.enum(['simplified_ticket', 'full_invoice']), seriesId: uuid.optional(), igicBasisPoints: z.number().int().min(0).max(10_000).optional() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async (tx) => {
        const [charge] = await tx`SELECT id,client_id AS "clientId",concept,amount_cents AS "amountCents",state FROM economic_charges WHERE id=${params.data.chargeId}::uuid FOR UPDATE`;
        if (!charge) return { error: 'charge_not_found' as const };
        if (charge.state === 'void') return { error: 'charge_void' as const };
        const [existing] = await tx`SELECT id,document_number AS "documentNumber",status FROM economic_fiscal_documents WHERE source_charge_id=${charge.id}::uuid AND rectifies_document_id IS NULL AND NOT EXISTS (SELECT 1 FROM economic_fiscal_documents r WHERE r.rectifies_document_id=economic_fiscal_documents.id) LIMIT 1`;
        if (existing) return { error: 'already_documented' as const, document: existing };
        const methods = await tx`SELECT s.method,COALESCE(sum(s.amount_cents),0)::bigint AS "amountCents" FROM economic_transactions t JOIN economic_payment_splits s ON s.transaction_id=t.id WHERE t.charge_id=${charge.id}::uuid AND t.kind='payment' GROUP BY s.method ORDER BY s.method`;
        if (!methods.length) return { error: 'payment_required' as const };
        const settings = await readSettings(tx);
        const seriesId = body.data.seriesId ?? settings.defaultSeriesId ?? null;
        const missing = missingFields(settings, seriesId);
        if (missing.length) return { error: 'issuer_incomplete' as const, missing };
        const [profile] = await tx`SELECT legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode" FROM client_fiscal_profiles WHERE client_id=${charge.clientId}::uuid`;
        if (body.data.documentType === 'full_invoice' && (!profile?.taxId || !profile.billingAddress)) return { error: 'client_fiscal_data_missing' as const };
        const rate = body.data.igicBasisPoints ?? Number(settings.defaultIgicBasisPoints);
        const gross = Number(charge.amountCents);
        const net = Math.round(gross * 10_000 / (10_000 + rate));
        const line = { description: charge.concept, quantity: 1, unitNetCents: net, netCents: net, taxTreatment: 'taxable', taxRateBasisPoints: rate, taxCents: gross - net, taxDescription: null };
        const draftId = randomUUID();
        const requestHash = createHash('sha256').update(`charge-invoice:${charge.id}:${body.data.documentType}:${rate}`).digest('hex');
        await tx`INSERT INTO economic_invoice_drafts(id,client_id,series_id,series_name,invoice_number,concept,net_cents,tax_basis_points,tax_cents,gross_cents,tax_description,fiscal_snapshot,created_by,idempotency_key,request_hash,document_type,source_charge_id,line_items,tax_treatment,tax_rate_basis_points,payment_methods)
          VALUES (${draftId}::uuid,${charge.clientId}::uuid,${seriesId}::uuid,NULL,NULL,${charge.concept},${net},${rate},${gross - net},${gross},NULL,${JSON.stringify(profile ?? {})}::jsonb,${context.actorId},${randomUUID()}::uuid,${requestHash},${body.data.documentType},${charge.id}::uuid,${JSON.stringify([line])}::jsonb,'taxable',${rate},${JSON.stringify(methods.map((m: any) => ({ method: m.method, amountCents: Number(m.amountCents) })))}::jsonb)`;
        const issued = await issueFromDraft(tx, context, draftId);
        return issued;
      });
      if ('error' in result) return reply.code(result.error === 'charge_not_found' ? 404 : 409).send({ error: result.error, ...('missing' in result ? { missing: result.missing } : {}), ...('document' in result ? { document: result.document } : {}) });
      return reply.code(201).send({ ...result.document, replay: result.replay });
    } catch { return reply.code(500).send({ error: 'invoice_issue_failed' }); }
  });

  app.post('/api/economics/documents/:documentId/rectify', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, MANAGE); if (!context) return;
    const params = z.object({ documentId: uuid }).strict().safeParse(request.params);
    const body = z.object({ reason: text(240, 3) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async (tx) => {
        const [original] = await tx`SELECT * FROM economic_fiscal_documents WHERE id=${params.data.documentId}::uuid FOR UPDATE`;
        if (!original) return { error: 'document_not_found' as const };
        if (original.status !== 'issued') return { error: 'cannot_rectify_a_rectification' as const };
        const [existing] = await tx`SELECT id FROM economic_fiscal_documents WHERE rectifies_document_id=${original.id}::uuid`;
        if (existing) return { error: 'already_rectified' as const };
        const [taken] = await tx`SELECT * FROM economic_take_next_document_number(${original.series_id}::uuid)`;
        if (!taken) return { error: 'series_inactive' as const };
        const negate = (value: number) => (value === 0 ? 0 : -value);
        const lines = (original.lines_snapshot as InvoiceLine[]).map((line) => ({ ...line, netCents: negate(line.netCents), taxCents: negate(line.taxCents), unitNetCents: line.unitNetCents ?? line.netCents }));
        const originalTotals = original.totals_snapshot as Record<string, any>;
        const totals = { netCents: negate(Number(originalTotals.netCents)), taxCents: negate(Number(originalTotals.taxCents)), grossCents: negate(Number(originalTotals.grossCents)), byRate: rateBreakdown(lines) };
        const [document] = await tx`INSERT INTO economic_fiscal_documents(draft_id,document_type,status,series_id,series_name,document_number,source_charge_id,client_id,issuer_snapshot,client_snapshot,lines_snapshot,payment_methods,totals_snapshot,rectifies_document_id,rectification_reason,issued_by)
          VALUES (${original.draft_id}::uuid,${original.document_type},'rectified',${original.series_id}::uuid,${taken.series_name},${taken.display_number},${original.source_charge_id}::uuid,${original.client_id}::uuid,${JSON.stringify(original.issuer_snapshot)}::jsonb,${JSON.stringify(original.client_snapshot)}::jsonb,${JSON.stringify(lines)}::jsonb,'[]'::jsonb,${JSON.stringify(totals)}::jsonb,${original.id}::uuid,${body.data.reason},${context.actorId})
          RETURNING id,document_number AS "documentNumber",status`;
        if (!document) throw new Error('rectifying document insert returned no row');
        await audit(tx, context, 'invoice.rectified', 'fiscal_document', document.id, original.client_id, { rectifies: original.document_number, documentNumber: document.documentNumber });
        return { document };
      });
      if ('error' in result) return reply.code(result.error === 'document_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send(result.document);
    } catch { return reply.code(500).send({ error: 'invoice_rectify_failed' }); }
  });

  // ------------------------------------------------------------------------------------------------------------------ reading and PDF
  app.get('/api/economics/charges/:chargeId/documents', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, READ); if (!context) return;
    const params = z.object({ chargeId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const items = await db`SELECT d.id,d.document_type AS "documentType",d.status,d.document_number AS "documentNumber",d.document_date::text AS "documentDate",(d.totals_snapshot->>'grossCents')::bigint AS "grossCents",d.rectifies_document_id AS "rectifiesDocumentId",
        EXISTS(SELECT 1 FROM economic_fiscal_documents r WHERE r.rectifies_document_id=d.id) AS "isRectified"
      FROM economic_fiscal_documents d WHERE d.source_charge_id=${params.data.chargeId}::uuid ORDER BY d.issued_at,d.id`;
    return { items: items.map((row: any) => ({ ...row, grossCents: Number(row.grossCents) })), canIssue: can(context, MANAGE) };
  });

  app.get('/api/economics/documents/:documentId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, READ); if (!context) return;
    const params = z.object({ documentId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [row] = await db`SELECT id,document_type AS "documentType",status,series_name AS "seriesName",document_number AS "documentNumber",document_date::text AS "documentDate",source_charge_id AS "chargeId",client_id AS "clientId",
      issuer_snapshot AS issuer,client_snapshot AS client,lines_snapshot AS lines,payment_methods AS "paymentMethods",totals_snapshot AS totals,rectifies_document_id AS "rectifiesDocumentId",rectification_reason AS "rectificationReason",issued_at AS "issuedAt"
      FROM economic_fiscal_documents WHERE id=${params.data.documentId}::uuid`;
    return row ?? reply.code(404).send({ error: 'document_not_found' });
  });

  app.get('/api/economics/documents/:documentId/pdf', async (request, reply) => {
    const context = await auth(request, reply, READ); if (!context) return;
    const params = z.object({ documentId: uuid }).strict().safeParse(request.params);
    const query = z.object({ variant: z.enum(['a4', 'ticket']).default('a4') }).strict().safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const built = await buildDocumentPdf(db, storage, params.data.documentId, query.data.variant);
    if (!built) return reply.code(404).send({ error: 'document_not_found' });
    return sendPdf(reply, built);
  });
}
