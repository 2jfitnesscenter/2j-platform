import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const hoursInput = z.object({
  effectiveFrom: date,
  intervals: z.array(z.object({ weekday: z.number().int().min(0).max(6), opensAt: time, closesAt: time }).strict()).max(28),
}).strict().superRefine((value, ctx) => {
  const sorted = [...value.intervals].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index]!;
    if (item.opensAt >= item.closesAt) ctx.addIssue({ code: 'custom', path: ['intervals', index, 'closesAt'], message: 'El cierre debe ser posterior a la apertura.' });
    const previous = sorted[index - 1];
    if (previous?.weekday === item.weekday && previous.closesAt > item.opensAt) ctx.addIssue({ code: 'custom', path: ['intervals', index], message: 'Los tramos de un día no pueden solaparse.' });
  }
});
const shiftInput = z.object({ professionalId: uuid, localDate: date, startsAt: time, endsAt: time }).strict().refine(value => value.startsAt < value.endsAt, { path: ['endsAt'], message: 'La salida debe ser posterior a la entrada y el turno debe terminar el mismo día local.' });

const fail = (reply: any, error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === '23505') return reply.code(409).send({ error: 'conflict' });
  if (code === '23503') return reply.code(409).send({ error: 'related_record_conflict' });
  if (['23514', '22P02'].includes(code)) return reply.code(422).send({ error: 'constraint_violation' });
  return reply.code(500).send({ error: 'internal_error' });
};

async function authorize(request: FastifyRequest, reply: any, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>, permission: string) {
  const context = await resolve(request);
  if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
  if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
  return context;
}

function findGaps(open: Array<{ startsAt: string; endsAt: string }>, shifts: Array<{ startsAt: string; endsAt: string; professionalId: string; displayName: string }>) {
  return open.flatMap(window => {
    let cursor = Date.parse(window.startsAt);
    const end = Date.parse(window.endsAt);
    const covered = shifts.map(shift => ({ start: Math.max(cursor, Date.parse(shift.startsAt)), end: Math.min(end, Date.parse(shift.endsAt)) }))
      .filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start || a.end - b.end);
    const gaps: Array<{ startsAt: string; endsAt: string }> = [];
    for (const interval of covered) {
      if (interval.start > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(interval.start).toISOString() });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < end) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(end).toISOString() });
    return gaps;
  });
}

/** Owner-only operations for dated shifts and center opening hours. No writes to the timeclock ledger. */
export function registerCenterOperationsRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/center/opening-hours', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'center.hours.manage');
    if (!context) return;
    reply.header('Cache-Control', 'no-store');
    const query = z.object({ date }).strict().partial().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_effective_date' });
    try {
      const rows = query.data.date
        ? await db`SELECT id,weekday,to_char(opens_at,'HH24:MI') AS "opensAt",to_char(closes_at,'HH24:MI') AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status FROM center_opening_hours WHERE status='active' AND valid_from<=${query.data.date}::date AND (valid_until IS NULL OR valid_until>=${query.data.date}::date) ORDER BY weekday,opens_at,valid_from`
        : await db`SELECT id,weekday,to_char(opens_at,'HH24:MI') AS "opensAt",to_char(closes_at,'HH24:MI') AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status FROM center_opening_hours WHERE status='active' ORDER BY weekday,opens_at,valid_from`;
      return { timezone: 'Atlantic/Canary', effectiveOn: query.data.date ?? null, intervals: rows };
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/center/opening-hours', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'center.hours.manage');
    if (!context) return;
    const parsed = hoursInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try {
      const rows = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-center-opening-hours'))`;
        const oldRows = await tx`SELECT id,weekday,opens_at AS "opensAt",closes_at AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status FROM center_opening_hours WHERE status='active' AND ((valid_from<${parsed.data.effectiveFrom}::date AND (valid_until IS NULL OR valid_until>=${parsed.data.effectiveFrom}::date)) OR valid_from=${parsed.data.effectiveFrom}::date) FOR UPDATE`;
        const [nextPeriod] = await tx`SELECT MIN(valid_from)::text AS "nextValidFrom" FROM center_opening_hours WHERE status='active' AND valid_from>${parsed.data.effectiveFrom}::date`;
        const validUntil = nextPeriod?.nextValidFrom
          ? new Date(Date.parse(`${nextPeriod.nextValidFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
          : null;
        const shortened = await tx`UPDATE center_opening_hours SET valid_until=${parsed.data.effectiveFrom}::date-1 WHERE status='active' AND valid_from<${parsed.data.effectiveFrom}::date AND (valid_until IS NULL OR valid_until>=${parsed.data.effectiveFrom}::date) RETURNING id,weekday,opens_at AS "opensAt",closes_at AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status`;
        const archived = await tx`UPDATE center_opening_hours SET status='archived' WHERE status='active' AND valid_from=${parsed.data.effectiveFrom}::date RETURNING id,weekday,opens_at AS "opensAt",closes_at AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status`;
        const created = [];
        for (const interval of parsed.data.intervals) {
          const [row] = await tx`INSERT INTO center_opening_hours(weekday,opens_at,closes_at,valid_from,valid_until,created_by) VALUES (${interval.weekday},${interval.opensAt},${interval.closesAt},${parsed.data.effectiveFrom},${validUntil},${context.actorId}) RETURNING id,weekday,opens_at AS "opensAt",closes_at AS "closesAt",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status`;
          if (!row) throw new Error('Opening hours insert returned no row');
          await tx`INSERT INTO staff_audit_events(actor_id,action,resource_type,resource_id,professional_id,details) VALUES (${context.actorId},'center.hours.created','center_opening_hours',${row.id},NULL,${JSON.stringify({ after: row })}::jsonb)`;
          created.push(row);
        }
        const afterById = new Map([...shortened, ...archived].map((row: any) => [row.id, row]));
        for (const old of oldRows) await tx`INSERT INTO staff_audit_events(actor_id,action,resource_type,resource_id,professional_id,details) VALUES (${context.actorId},'center.hours.replaced','center_opening_hours',${old.id},NULL,${JSON.stringify({ before: old, after: afterById.get(old.id) ?? old, effectiveFrom: parsed.data.effectiveFrom })}::jsonb)`;
        return created;
      });
      return reply.code(201).send({ timezone: 'Atlantic/Canary', effectiveFrom: parsed.data.effectiveFrom, intervals: rows });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/center/shifts', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'staff.shifts.read');
    if (!context) return;
    reply.header('Cache-Control', 'no-store');
    const query = z.object({ from: date, to: date }).strict().refine(value => value.from <= value.to && Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 30 * 86400000).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_date_range' });
    try {
      const shifts = await db`SELECT s.id,s.professional_id AS "professionalId",p.display_name AS "displayName",s.local_date::text AS "localDate",s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.status FROM staff_shift_assignments s JOIN staff_professionals p ON p.id=s.professional_id WHERE s.local_date BETWEEN ${query.data.from}::date AND ${query.data.to}::date ORDER BY s.starts_at,s.id`;
      return { timezone: 'Atlantic/Canary', shifts };
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/center/shifts', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'staff.shifts.manage');
    if (!context) return;
    const parsed = shiftInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try {
      const result = await db.begin(async tx => {
        const [person] = await tx`SELECT id,status FROM staff_professionals WHERE id=${parsed.data.professionalId} FOR UPDATE`;
        if (!person || person.status !== 'active') return { error: 'professional_not_found' as const };
        const [overlap] = await tx`SELECT EXISTS(SELECT 1 FROM staff_shift_assignments WHERE professional_id=${person.id} AND status='scheduled' AND starts_at<(((${parsed.data.localDate}::date+${parsed.data.endsAt}::time) AT TIME ZONE 'Atlantic/Canary')) AND ends_at>(((${parsed.data.localDate}::date+${parsed.data.startsAt}::time) AT TIME ZONE 'Atlantic/Canary'))) AS conflict`;
        if (overlap?.conflict) return { error: 'shift_overlap' as const };
        const [row] = await tx`INSERT INTO staff_shift_assignments(professional_id,local_date,starts_at,ends_at,created_by,updated_by) VALUES (${person.id},${parsed.data.localDate}::date,(((${parsed.data.localDate}::date+${parsed.data.startsAt}::time) AT TIME ZONE 'Atlantic/Canary')),(((${parsed.data.localDate}::date+${parsed.data.endsAt}::time) AT TIME ZONE 'Atlantic/Canary')),${context.actorId},${context.actorId}) RETURNING id,professional_id AS "professionalId",local_date::text AS "localDate",starts_at AS "startsAt",ends_at AS "endsAt",status`;
        if (!row) throw new Error('Shift insert returned no row');
        await tx`INSERT INTO staff_audit_events(actor_id,action,resource_type,resource_id,professional_id,details) VALUES (${context.actorId},'staff.shift.created','staff_shift_assignment',${row.id},${person.id},${JSON.stringify({ after: row })}::jsonb)`;
        return { row };
      });
      if ('error' in result) return reply.code(result.error === 'professional_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send(result.row);
    } catch (error) { return fail(reply, error); }
  });

  app.patch('/api/center/shifts/:shiftId/cancel', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'staff.shifts.manage');
    if (!context) return;
    const params = z.object({ shiftId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_shift_id' });
    try {
      const result = await db.begin(async tx => {
        const [old] = await tx`SELECT id,professional_id AS "professionalId",local_date::text AS "localDate",starts_at AS "startsAt",ends_at AS "endsAt",status FROM staff_shift_assignments WHERE id=${params.data.shiftId} FOR UPDATE`;
        if (!old) return null;
        if (old.status === 'cancelled') return { row: old, unchanged: true };
        const [row] = await tx`UPDATE staff_shift_assignments SET status='cancelled',updated_by=${context.actorId},updated_at=now() WHERE id=${old.id} RETURNING id,professional_id AS "professionalId",local_date::text AS "localDate",starts_at AS "startsAt",ends_at AS "endsAt",status`;
        await tx`INSERT INTO staff_audit_events(actor_id,action,resource_type,resource_id,professional_id,details) VALUES (${context.actorId},'staff.shift.cancelled','staff_shift_assignment',${old.id},${old.professionalId},${JSON.stringify({ before: old, after: row })}::jsonb)`;
        return { row, unchanged: false };
      });
      if (!result) return reply.code(404).send({ error: 'shift_not_found' });
      return result.row;
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/center/coverage', async (request, reply) => {
    const context = await authorize(request, reply, resolveAuthorization, 'owner.panel.read');
    if (!context) return;
    reply.header('Cache-Control', 'no-store');
    const parsed = z.object({ date }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_date' });
    try {
      const [hours, shifts, cash] = await Promise.all([
        db`SELECT id,(((${parsed.data.date}::date+opens_at) AT TIME ZONE 'Atlantic/Canary')) AS "startsAt",(((${parsed.data.date}::date+closes_at) AT TIME ZONE 'Atlantic/Canary')) AS "endsAt" FROM center_opening_hours WHERE status='active' AND weekday=extract(dow FROM ${parsed.data.date}::date) AND valid_from<=${parsed.data.date}::date AND (valid_until IS NULL OR valid_until>=${parsed.data.date}::date) ORDER BY opens_at,id`,
        db`SELECT s.id,s.professional_id AS "professionalId",p.display_name AS "displayName",s.starts_at AS "startsAt",s.ends_at AS "endsAt" FROM staff_shift_assignments s JOIN staff_professionals p ON p.id=s.professional_id AND p.status='active' WHERE s.local_date=${parsed.data.date}::date AND s.status='scheduled' ORDER BY s.starts_at,s.id`,
        db`SELECT id,status,opened_at AS "openedAt",closed_at AS "closedAt" FROM economic_cash_sessions WHERE local_date=${parsed.data.date}::date ORDER BY opened_at,id`,
      ]);
      const intervals = hours.map((row: any) => ({ startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString() }));
      return {
        timezone: 'Atlantic/Canary', date: parsed.data.date,
        openingIntervals: intervals,
        assignedShifts: shifts,
        staffingGaps: findGaps(intervals, shifts as any),
        cashCustody: { status: 'incomplete', recordedSessions: cash, reason: 'La custodia real no puede reconstruirse hasta registrar los traspasos A39–A44.' },
      };
    } catch (error) { return fail(reply, error); }
  });
}
