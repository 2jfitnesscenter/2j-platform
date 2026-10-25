import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { activateSettledEntitlementPeriods } from './assignment-periods.js';
import { appendNotificationEvent } from './notifications.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const taxId = z.string().trim().transform(value => value.toUpperCase().replace(/[\s-]/g, '')).nullable().optional().refine(value => !value || /^(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/.test(value), 'Formato de NIF/NIE/CIF no válido. La validación de formato no verifica la identidad.');

export function registerEconomicExtensions(app: FastifyInstance<any, any, any, any, any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }
  async function audit(tx: any, context: AuthorizationContext, action: string, type: string, id: string, clientId: string | null, details: Record<string, unknown> = {}) {
    await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},${action},${type},${id},${clientId},${JSON.stringify(details)}::jsonb)`;
  }
  async function cashSnapshot(tx: any, sessionId: string) {
    const [row] = await tx`SELECT s.id,s.local_date AS "localDate",s.opening_cents AS "openingCents",s.status,s.opened_at AS "openedAt",s.opened_by AS "openedBy",s.closed_at AS "closedAt",s.closed_by AS "closedBy",s.expected_cents AS "frozenExpectedCents",s.counted_cents AS "countedCents",s.difference_cents AS "differenceCents",
      COALESCE(sum(ps.amount_cents) FILTER(WHERE et.kind='payment' AND ps.method='cash'),0)::bigint AS "cashPaymentsCents",
      COALESCE(sum(ps.amount_cents) FILTER(WHERE et.kind='refund' AND ps.method='cash'),0)::bigint AS "cashRefundsCents",
      COALESCE((SELECT sum(a.amount_cents) FROM economic_cash_adjustments a WHERE a.cash_session_id=s.id),0)::bigint AS "adjustmentsCents"
      FROM economic_cash_sessions s LEFT JOIN economic_transactions et ON et.cash_session_id=s.id LEFT JOIN economic_payment_splits ps ON ps.transaction_id=et.id WHERE s.id=${sessionId}
      GROUP BY s.id`;
    if (!row) return null;
    const expectedCents = row.frozenExpectedCents == null
      ? Number(row.openingCents) + Number(row.cashPaymentsCents) - Number(row.cashRefundsCents) + Number(row.adjustmentsCents)
      : Number(row.frozenExpectedCents);
    return { ...row, expectedCents, liveExpectedCents: expectedCents, differenceCents: row.differenceCents == null ? null : Number(row.differenceCents) };
  }
  async function openCashForToday(tx: any, context: AuthorizationContext) {
    const [session] = await tx`SELECT id FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE`;
    return session ? String(session.id) : null;
  }
  async function closeCash(request: FastifyRequest, reply: any, sessionId: string, countedCents: number, context: AuthorizationContext) {
    try {
      const result = await db.begin(async tx => {
        const [session] = await tx`SELECT id,local_date,status FROM economic_cash_sessions WHERE id=${sessionId} FOR UPDATE`;
        if (!session) return { error: 'cash_session_not_found' as const };
        if (session.status !== 'open') return { error: 'cash_already_closed' as const };
        const snapshot = await cashSnapshot(tx, session.id);
        if (!snapshot) return { error: 'cash_session_not_found' as const };
        const difference = countedCents - snapshot.expectedCents;
        const [closed] = await tx`UPDATE economic_cash_sessions SET status=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,close_kind=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,expected_cents=${snapshot.expectedCents},counted_cents=${countedCents},difference_cents=${difference},closed_by=${context.actorId},closed_at=now() WHERE id=${session.id} AND status='open' RETURNING id,status,local_date AS "localDate",opened_at AS "openedAt",closed_at AS "closedAt",closed_by AS "closedBy",opening_cents AS "openingCents",expected_cents AS "expectedCents",counted_cents AS "countedCents",difference_cents AS "differenceCents"`;
        if (!closed) return { error: 'cash_already_closed' as const };
        await audit(tx, context, 'cash.closed', 'cash_session', session.id, null, { localDate: String(session.local_date), lateClose: closed.status === 'late_close', openingCents: snapshot.openingCents, cashPaymentsCents: snapshot.cashPaymentsCents, cashRefundsCents: snapshot.cashRefundsCents, adjustmentsCents: snapshot.adjustmentsCents, expectedCents: snapshot.expectedCents, countedCents, differenceCents: difference });
        return { closed, snapshot };
      });
      if ('error' in result) return reply.code(result.error === 'cash_session_not_found' ? 404 : 409).send({ error: result.error });
      return { ...result.closed, cashPaymentsCents: result.snapshot.cashPaymentsCents, cashRefundsCents: result.snapshot.cashRefundsCents, adjustmentsCents: result.snapshot.adjustmentsCents };
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      app.log.error({ databaseCode: code, route: 'POST /api/economics/cash/close' }, 'cash close failed');
      return reply.code(code === '55000' ? 409 : 500).send({ error: code === '55000' ? 'cash_transition_invalid' : 'cash_close_failed' });
    }
  }

  app.get('/api/economics/cash/today', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth(request, reply, 'billing.read-basic')) return;
    const [session] = await db`SELECT id FROM economic_cash_sessions WHERE status='open' OR local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY (status='open') DESC,opened_at DESC LIMIT 1`;
    return { session: session ? await cashSnapshot(db, session.id) : null, timezone: 'Atlantic/Canary' };
  });
  app.post('/api/economics/cash/open', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const parsed = z.object({ openingCents: z.number().int().min(0).max(100_000_000_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-open-cash'))`;
        const [open] = await tx`SELECT id FROM economic_cash_sessions WHERE status='open' LIMIT 1 FOR UPDATE`;
        if (open) return { error: 'cash_already_open' as const };
        const [row] = await tx`INSERT INTO economic_cash_sessions(local_date,opening_cents,opened_by) VALUES ((now() AT TIME ZONE 'Atlantic/Canary')::date,${parsed.data.openingCents},${context.actorId}) RETURNING id,local_date AS "localDate",opening_cents AS "openingCents",status,opened_at AS "openedAt"`;
        if (!row) throw new Error('cash session insert returned no row');
        await audit(tx, context, 'cash.opened', 'cash_session', row.id, null, { openingCents: parsed.data.openingCents, localDate: String(row.localDate) });
        return { row };
      });
      if ('error' in result) return reply.code(409).send({ error: result.error });
      return reply.code(201).send(result.row);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '23505' ? 409 : 500).send({ error: code === '23505' ? 'cash_session_exists' : 'cash_open_failed' });
    }
  });
  const closeBody = z.object({ countedCents: z.number().int().min(0).max(100_000_000_000) }).strict();
  app.post('/api/economics/cash/close', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const parsed = closeBody.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const [session] = await db`SELECT id FROM economic_cash_sessions WHERE local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AND status='open'`;
    if (!session) return reply.code(409).send({ error: 'cash_not_open' });
    return closeCash(request, reply, session.id, parsed.data.countedCents, context);
  });
  app.post('/api/economics/cash/:sessionId/close', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    const parsed = closeBody.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'validation_error' });
    return closeCash(request, reply, params.data.sessionId, parsed.data.countedCents, context);
  });
  app.post('/api/economics/cash/adjustments', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const parsed = z.object({ amountCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).refine(value => value !== 0), reason: z.string().trim().min(3).max(240) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const id = await openCashForToday(tx, context);
        if (!id) return { error: 'cash_not_open' as const };
        const [row] = await tx`INSERT INTO economic_cash_adjustments(cash_session_id,amount_cents,reason,actor_id) VALUES (${id},${parsed.data.amountCents},${parsed.data.reason},${context.actorId}) RETURNING id,amount_cents AS "amountCents",reason,created_at AS "createdAt"`;
        if (!row) throw new Error('cash adjustment insert returned no row');
        await audit(tx, context, 'cash.adjusted', 'cash_adjustment', row.id, null, { sessionId: id, amountCents: parsed.data.amountCents, reason: parsed.data.reason });
        return { row };
      });
      if ('error' in result) return reply.code(409).send({ error: result.error });
      return reply.code(201).send(result.row);
    } catch { return reply.code(500).send({ error: 'cash_adjustment_failed' }); }
  });

  app.post('/api/economics/charges/:chargeId/void', async (request, reply) => {
    const context = await auth(request, reply, 'billing.payments.manage'); if (!context) return;
    const params = z.object({ chargeId: uuid }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(240) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const [charge] = await tx`SELECT id,client_id AS "clientId",state FROM economic_charges WHERE id=${params.data.chargeId} FOR UPDATE`;
        if (!charge) return { error: 'charge_not_found' as const };
        if (charge.state !== 'pending') return { error: 'charge_not_pending' as const };
        const [money] = await tx`SELECT count(*)::int count FROM economic_transactions WHERE charge_id=${charge.id}`;
        if (Number(money?.count) > 0) return { error: 'refund_required' as const };
        const [row] = await tx`UPDATE economic_charges SET state='void',void_reason=${body.data.reason},voided_by=${context.actorId},voided_at=now() WHERE id=${charge.id} AND state='pending' RETURNING id,state,void_reason AS "voidReason",voided_at AS "voidedAt"`;
        if (!row) return { error: 'charge_not_pending' as const };
        await audit(tx, context, 'charge.voided', 'charge', charge.id, charge.clientId, { reason: body.data.reason });
        return { row };
      });
      if ('error' in result) return reply.code(result.error === 'charge_not_found' ? 404 : 409).send({ error: result.error });
      return result.row;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '55000' ? 409 : 500).send({ error: code === '55000' ? 'charge_transition_invalid' : 'charge_void_failed' });
    }
  });

  app.post('/api/economics/transfer-proofs', { bodyLimit: 3_000_000 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, 'billing.payments.manage'); if (!context) return;
    const parsed = z.object({ chargeId: uuid, amountCents: z.number().int().min(1).max(100_000_000_000), contentType: z.enum(['application/pdf','image/jpeg','image/png','image/webp']), fileName: z.string().trim().min(1).max(180), base64: z.string().min(4).max(2_800_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const bytes = Buffer.from(parsed.data.base64, 'base64');
    if (!bytes.length || bytes.length > 2_097_152 || bytes.toString('base64').replace(/=+$/,'') !== parsed.data.base64.replace(/=+$/,'')) return reply.code(400).send({ error: 'invalid_file' });
    const signature = parsed.data.contentType === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
      : parsed.data.contentType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : parsed.data.contentType === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
      : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!signature) return reply.code(400).send({ error: 'file_type_mismatch' });
    const digest = createHash('sha256').update(bytes).digest('hex');
    try {
      const result = await db.begin(async tx => {
        const [charge] = await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents",state FROM economic_charges WHERE id=${parsed.data.chargeId} FOR UPDATE`;
        if (!charge) return { error: 'charge_not_found' as const };
        if (charge.state !== 'pending' || parsed.data.amountCents > Number(charge.amountCents)) return { error: 'charge_closed' as const };
        const [balance] = await tx`SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint paid,COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint net FROM economic_transactions WHERE charge_id=${charge.id}`;
        if (Number(balance?.paid ?? 0) > 0 && Number(balance?.net ?? 0) === 0) return { error: 'charge_refunded' as const };
        const [proof] = await tx`INSERT INTO economic_transfer_proofs(charge_id,amount_cents,content_type,file_name,file_bytes,sha256,submitted_by) VALUES (${charge.id},${parsed.data.amountCents},${parsed.data.contentType},${parsed.data.fileName},${bytes},${digest},${context.actorId}) RETURNING id,status`;
        if (!proof) throw new Error('proof insert returned no row');
        await audit(tx, context, 'transfer_proof.submitted', 'transfer_proof', proof.id, charge.clientId, { amountCents: parsed.data.amountCents, sha256: digest });
        const admins=await tx`SELECT auth_actor_id AS actor_id FROM staff_professionals WHERE status='active' AND base_role='admin' AND auth_actor_id IS NOT NULL`;
        for(const recipient of admins)await appendNotificationEvent(tx,{type:'staff.transfer_pending',aggregateType:'transfer_proof',aggregateId:proof.id,staffActorId:recipient.actor_id,dedupeKey:`transfer-proof:${proof.id}:${recipient.actor_id}`});
        return { id: proof.id, status: proof.status };
      });
      if ('error' in result) return reply.code(result.error === 'charge_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send(result);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '23505' ? 409 : 500).send({ error: code === '23505' ? 'duplicate_proof' : 'transfer_proof_failed' });
    }
  });
  app.get('/api/economics/transfer-proofs', async (request, reply) => {
    if (!await auth(request, reply, 'billing.validate_transfer')) return;
    return { items: await db`SELECT id,charge_id AS "chargeId",amount_cents AS "amountCents",content_type AS "contentType",file_name AS "fileName",status,submitted_by AS "submittedBy",submitted_at AS "submittedAt",reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",decision_note AS "decisionNote" FROM economic_transfer_proofs ORDER BY submitted_at DESC LIMIT 100` };
  });
  app.get('/api/economics/transfer-proofs/:proofId/file', async (request, reply) => {
    if (!await auth(request, reply, 'billing.validate_transfer')) return;
    const params = z.object({ proofId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_proof_id' });
    const [file] = await db`SELECT content_type AS "contentType",file_name AS "fileName",file_bytes AS bytes FROM economic_transfer_proofs WHERE id=${params.data.proofId}`;
    if (!file) return reply.code(404).send({ error: 'proof_not_found' });
    reply.header('Cache-Control','no-store').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return reply.type(file.contentType).send(file.bytes);
  });
  app.post('/api/economics/transfer-proofs/:proofId/review', async (request, reply) => {
    const context = await auth(request, reply, 'billing.validate_transfer'); if (!context) return;
    const params = z.object({ proofId: uuid }).safeParse(request.params);
    const body = z.object({ decision: z.enum(['validated','rejected']), note: z.string().trim().min(3).max(240).optional() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const [proof] = await tx`SELECT id,charge_id AS "chargeId",amount_cents AS "amountCents",status,submitted_by AS "submittedBy" FROM economic_transfer_proofs WHERE id=${params.data.proofId} FOR UPDATE`;
        if (!proof) return { error: 'proof_not_found' as const };
        if (proof.submittedBy === context.actorId) return { error: 'self_review_forbidden' as const };
        if (proof.status !== 'pending_validation') return { error: 'proof_already_reviewed' as const };
        const [charge] = await tx`SELECT id,client_id AS "clientId",state,amount_cents AS "amountCents" FROM economic_charges WHERE id=${proof.chargeId} FOR UPDATE`;
        if (!charge || charge.state !== 'pending') return { error: 'charge_closed' as const };
        let transactionId: string | null = null;
        if (body.data.decision === 'validated') {
          const [balance] = await tx`SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint paid,COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint cents FROM economic_transactions WHERE charge_id=${charge.id}`;
          if (Number(balance?.paid ?? 0) > 0 && Number(balance?.cents ?? 0) === 0) return { error: 'charge_refunded' as const };
          if (Number(balance?.cents ?? 0) + Number(proof.amountCents) > Number(charge.amountCents)) return { error: 'amount_exceeds_balance' as const };
          transactionId = randomUUID();
          const requestHash = createHash('sha256').update(`proof:${proof.id}:${proof.amountCents}`).digest('hex');
          const [cash] = await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date FOR UPDATE`;
          await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,note,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${transactionId},${charge.id},${charge.clientId},'payment',${proof.amountCents},'Justificante de transferencia validado',${context.actorId},${proof.id},${requestHash},NULL)`;
          await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${transactionId},'transfer',${proof.amountCents})`;
          await audit(tx, context, 'payment.transfer_validated', 'transaction', transactionId, charge.clientId, { amountCents: proof.amountCents, proofId: proof.id });
          await activateSettledEntitlementPeriods(tx,charge.id,context.actorId);
          void cash;
        }
        const [updated] = await tx`UPDATE economic_transfer_proofs SET status=${body.data.decision},reviewed_by=${context.actorId},reviewed_at=now(),decision_note=${body.data.note ?? null},transaction_id=${transactionId} WHERE id=${proof.id} RETURNING id,status,reviewed_at AS "reviewedAt"`;
        if (!updated) throw new Error('proof review update returned no row');
        await audit(tx, context, `transfer_proof.${body.data.decision}`, 'transfer_proof', proof.id, charge.clientId, { note: body.data.note ?? null });
        return updated;
      });
      if ('error' in result) return reply.code(result.error === 'proof_not_found' ? 404 : result.error === 'self_review_forbidden' ? 403 : 409).send({ error: result.error });
      return result;
    } catch { return reply.code(500).send({ error: 'transfer_review_failed' }); }
  });

  app.get('/api/clients/:clientId/fiscal-profile', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    if (!await auth(request, reply, 'billing.read-tax')) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [profile] = await db`SELECT client_id AS "clientId",legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode",updated_at AS "updatedAt" FROM client_fiscal_profiles WHERE client_id=${params.data.clientId}`;
    return profile ?? reply.code(404).send({ error: 'fiscal_profile_not_found' });
  });
  app.put('/api/clients/:clientId/fiscal-profile', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'billing.write-tax'); if (!context) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    const body = z.object({ legalName: z.string().trim().min(1).max(160), taxId, billingAddress: z.string().trim().max(240).nullable().optional(), postalCode: z.string().trim().max(20).nullable().optional(), locality: z.string().trim().max(100).nullable().optional(), province: z.string().trim().max(100).nullable().optional(), countryCode: z.string().regex(/^[A-Z]{2}$/).default('ES') }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', message: body.success ? undefined : body.error.issues[0]?.message });
    try {
      const result = await db.begin(async tx => {
        const [profile] = await tx`INSERT INTO client_fiscal_profiles(client_id,legal_name,tax_id,billing_address,postal_code,locality,province,country_code,updated_by) VALUES (${params.data.clientId},${body.data.legalName},${body.data.taxId ?? null},${body.data.billingAddress ?? null},${body.data.postalCode ?? null},${body.data.locality ?? null},${body.data.province ?? null},${body.data.countryCode},${context.actorId}) ON CONFLICT(client_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,tax_id=EXCLUDED.tax_id,billing_address=EXCLUDED.billing_address,postal_code=EXCLUDED.postal_code,locality=EXCLUDED.locality,province=EXCLUDED.province,country_code=EXCLUDED.country_code,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING client_id AS "clientId",legal_name AS "legalName",tax_id AS "taxId",country_code AS "countryCode",updated_at AS "updatedAt"`;
        if (!profile) return null;
        await audit(tx, context, 'client_fiscal_profile.updated', 'fiscal_profile', params.data.clientId, params.data.clientId, { taxIdFormatValidated: Boolean(body.data.taxId), identityVerified: false });
        return profile;
      });
      return result ?? reply.code(404).send({ error: 'client_not_found' });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '23503' ? 404 : 500).send({ error: code === '23503' ? 'client_not_found' : 'fiscal_profile_update_failed' });
    }
  });
  app.post('/api/economics/invoice-series', async (request, reply) => {
    const context = await auth(request, reply, 'billing.invoices.manage'); if (!context) return;
    const body = z.object({ name: z.string().trim().min(1).max(80), prefix: z.string().trim().min(1).max(20) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const [row] = await db`INSERT INTO economic_invoice_series(name,prefix) VALUES (${body.data.name},${body.data.prefix}) RETURNING id,name,prefix,active`;
      if (!row) throw new Error('invoice series insert returned no row');
      await audit(db, context, 'invoice.series_created', 'invoice_series', row.id, null, { name: row.name });
      return reply.code(201).send(row);
    } catch { return reply.code(409).send({ error: 'invoice_series_conflict' }); }
  });
  app.post('/api/economics/invoice-drafts', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'billing.invoices.manage'); if (!context) return;
    const key = uuid.safeParse(request.headers['idempotency-key']); if (!key.success) return reply.code(400).send({ error: 'idempotency_key_required' });
    const lineSchema = z.object({ description:z.string().trim().min(1).max(240), netCents:z.number().int().min(0).max(100_000_000_000), taxTreatment:z.enum(['taxable','exempt','non_subject']), taxBasisPoints:z.number().int().min(0).max(10_000).optional(), taxDescription:z.string().trim().min(3).max(160).optional() }).strict();
    const body = z.object({ clientId: uuid, seriesId: uuid, concept: z.string().trim().min(1).max(240).optional(), netCents: z.number().int().min(0).max(100_000_000_000).optional(), taxTreatment: z.enum(['taxable','exempt','non_subject']).optional(), taxBasisPoints: z.number().int().min(0).max(10_000).optional(), taxDescription: z.string().trim().min(3).max(160).optional(), lines:z.array(lineSchema).min(1).max(100).optional(), documentType: z.enum(['simplified_ticket','full_invoice']).default('simplified_ticket'), sourceChargeId: uuid }).strict().superRefine((value, issue) => {
      if (!value.lines && (!value.concept || value.netCents===undefined || value.taxTreatment===undefined)) issue.addIssue({ code:'custom', path:['lines'], message:'Indica las líneas del documento o una línea simple completa.' });
      for (const [index,line] of (value.lines??[]).entries()) {
        if (line.taxTreatment==='taxable' && line.taxBasisPoints===undefined) issue.addIssue({ code:'custom', path:['lines',index,'taxBasisPoints'], message:'Indica el tipo IGIC aplicable a esta línea.' });
        if (line.taxTreatment!=='taxable' && !line.taxDescription) issue.addIssue({ code:'custom', path:['lines',index,'taxDescription'], message:'Explica el tratamiento fiscal pendiente de revisión.' });
      }
      if (!value.lines && value.taxTreatment==='taxable' && value.taxBasisPoints===undefined) issue.addIssue({ code:'custom', path:['taxBasisPoints'], message:'Indica el tipo IGIC de la línea.' });
      if (!value.lines && value.taxTreatment!=='taxable' && !value.taxDescription) issue.addIssue({ code:'custom', path:['taxDescription'], message:'Explica el tratamiento fiscal pendiente de revisión.' });
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const data = body.data; const normalizedLines = data.lines ?? [{ description:data.concept!, netCents:data.netCents!, taxTreatment:data.taxTreatment!, taxBasisPoints:data.taxBasisPoints, taxDescription:data.taxDescription }];
    const lines = normalizedLines.map(line=>({description:line.description,netCents:line.netCents,taxTreatment:line.taxTreatment,taxRateBasisPoints:line.taxTreatment==='taxable'?line.taxBasisPoints:null,taxCents:line.taxTreatment==='taxable'?Math.round(line.netCents*(line.taxBasisPoints??0)/10_000):0,taxDescription:line.taxDescription??null}));
    const netCents=lines.reduce((sum,line)=>sum+line.netCents,0);const taxCents=lines.reduce((sum,line)=>sum+line.taxCents,0);const treatments=[...new Set(lines.map(line=>line.taxTreatment))];const overallTreatment=treatments.length>1?'mixed':treatments[0]!;const concept=data.concept??lines.map(line=>line.description).join(' · ').slice(0,240);const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [existing] = await tx`SELECT id,request_hash AS "requestHash" FROM economic_invoice_drafts WHERE idempotency_key=${key.data}`;
        if (existing) return existing.requestHash.trim() === requestHash ? { id: existing.id, replay: true as const } : { error:'idempotency_conflict' as const };
        const [charge] = await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents" FROM economic_charges WHERE id=${data.sourceChargeId}`;
        if (!charge || charge.clientId !== data.clientId) return { error:'source_charge_not_found' as const };
        const paymentMethods = await tx`SELECT s.method,COALESCE(sum(s.amount_cents),0)::bigint AS "amountCents" FROM economic_transactions t JOIN economic_payment_splits s ON s.transaction_id=t.id WHERE t.charge_id=${charge.id} AND t.kind='payment' GROUP BY s.method ORDER BY s.method`;
        if (!paymentMethods.length) return { error:'payment_required' as const };
        const [profile] = await tx`SELECT legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode" FROM client_fiscal_profiles WHERE client_id=${data.clientId}`;
        const [series] = await tx`SELECT id,name FROM economic_invoice_series WHERE id=${data.seriesId} AND active=true`;
        if (!series) return { error:'series_not_found' as const };
        if (data.documentType === 'full_invoice' && (!profile?.taxId || !profile.billingAddress || !profile.postalCode || !profile.locality || !profile.province || !profile.countryCode)) return { error:'complete_fiscal_profile_required' as const };
        if (netCents + taxCents !== Number(charge.amountCents)) return { error:'document_total_mismatch' as const };
        const id = randomUUID();
        const auditTreatment=overallTreatment;
        await tx`INSERT INTO economic_invoice_drafts(id,client_id,series_id,series_name,invoice_number,concept,net_cents,tax_basis_points,tax_cents,gross_cents,tax_description,fiscal_snapshot,created_by,idempotency_key,request_hash,document_type,source_charge_id,line_items,tax_treatment,tax_rate_basis_points,payment_methods) VALUES (${id},${data.clientId},${series.id},NULL,NULL,${concept},${netCents},${data.taxBasisPoints??lines.find(line=>line.taxTreatment==='taxable')?.taxRateBasisPoints??0},${taxCents},${netCents+taxCents},${data.taxDescription??null},${JSON.stringify(profile??{})}::jsonb,${context.actorId},${key.data},${requestHash},${data.documentType},${data.sourceChargeId},${JSON.stringify(lines)}::jsonb,${overallTreatment},${overallTreatment==='taxable'?data.taxBasisPoints??lines[0]?.taxRateBasisPoints??0:null},${JSON.stringify(paymentMethods)}::jsonb)`;
        await audit(tx, context, 'invoice.draft_created', 'invoice_draft', id, data.clientId, { documentType:data.documentType, sourceChargeId:data.sourceChargeId, netCents, taxTreatment:auditTreatment, officialNumberAssigned:false });
        return { id, replay:false as const };
      });
      if ('error' in result) return reply.code(result.error === 'series_not_found' || result.error === 'source_charge_not_found' ? 404 : result.error === 'idempotency_conflict' || result.error === 'payment_required' ? 409 : 422).send({ error:result.error });
      return reply.code(result.replay ? 200 : 201).send({ id:result.id, status:'draft', officialNumber:null, officiallyIssued:false });
    } catch { return reply.code(500).send({ error:'invoice_draft_failed' }); }
  });
  app.post('/api/economics/invoice-drafts/:draftId/issue', async (request, reply) => {
    if (!await auth(request, reply, 'billing.invoices.manage')) return;
    reply.header('Cache-Control','no-store');
    const params = z.object({ draftId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error:'validation_error' });
    return reply.code(423).send({ error:'legal_fiscal_gate_closed', message:'La emisión oficial seguirá bloqueada hasta aprobar requisitos fiscales y legales.' });
  });
  app.get('/api/economics/document-policy',async(request,reply)=>{
    if(!await auth(request,reply,'billing.read-tax'))return;
    const [policy]=await db`SELECT retention_months AS "retentionMonths",updated_by AS "updatedBy",updated_at AS "updatedAt" FROM economic_document_policy WHERE singleton=true`;
    return policy??reply.code(500).send({error:'document_policy_missing'});
  });
  app.put('/api/economics/document-policy',async(request,reply)=>{
    const context=await auth(request,reply,'billing.invoices.manage');if(!context)return;
    const body=z.object({retentionMonths:z.number().int().min(1).max(1200).nullable()}).strict().safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:'validation_error'});
    try{return await db.begin(async tx=>{const [policy]=await tx`UPDATE economic_document_policy SET retention_months=${body.data.retentionMonths},updated_by=${context.actorId},updated_at=now() WHERE singleton=true RETURNING retention_months AS "retentionMonths",updated_at AS "updatedAt"`;if(!policy)return reply.code(500).send({error:'document_policy_missing'});const [auditId]=await tx`SELECT gen_random_uuid() AS id`;await audit(tx,context,'document.retention_policy.updated','document_policy',auditId!.id,null,{retentionMonths:body.data.retentionMonths,automaticDeletion:false});return policy;});}catch{return reply.code(500).send({error:'document_policy_update_failed'});}
  });
}
