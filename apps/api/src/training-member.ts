import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canaryBusinessDate } from '@2j/domain';
import type { createDatabase } from './db.js';
import { resolveEffectiveClientAssignments } from './entitlements.js';

type DB = ReturnType<typeof createDatabase>['client'];
type ClientActor = { clientId: string } | null;
type Client = (request: FastifyRequest, reply: any) => Promise<ClientActor>;

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const exerciseName = z.string().trim().min(1).max(80);
const setBody = z.object({
  exerciseName,
  setIndex: z.number().int().min(1).max(50),
  reps: z.number().int().min(0).max(100),
  weightKg: z.number().min(0).max(1000),
  rir: z.number().int().min(0).max(10).nullable().optional(),
}).strict();

/** ISO weekday (1 = lunes ... 7 = domingo) of a YYYY-MM-DD business date. */
export function isoWeekday(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Acceso al entrenamiento: lo decide Platform con la misma lectura de asignaciones efectivas que el resto de puertas de entrenamiento
 * (operationalAccess activo y un derecho training_access). No se duplica lógica de cuotas.
 */
export async function hasTrainingEntitlement(db: DB, clientId: string, now: Date) {
  const entitlements = await resolveEffectiveClientAssignments(db, clientId, now);
  return entitlements.effective.assignments.some(assignment => assignment.operationalAccess === 'active' && assignment.rights.some(right => right.rightType === 'training_access'));
}

/** Rutas de entrenamiento de un socio (slice 1): hoy, sesión, series, cierre e historial. */
export function registerTrainingMemberRoutes(app: FastifyInstance, db: DB, client: Client, memberNow: () => Date) {
  /** Identifica al socio y exige el derecho de entrenamiento. Responde 403 con el motivo y la acción; devuelve null si no pasa. */
  async function gate(request: FastifyRequest, reply: any) {
    const actor = await client(request, reply);
    if (!actor) return null;
    const now = memberNow();
    if (!(await hasTrainingEntitlement(db, actor.clientId, now))) {
      reply.code(403).send({ error: 'training_entitlement_required', reason: 'entitlement_required', action: 'contact_front_desk' });
      return null;
    }
    return { clientId: actor.clientId, date: canaryBusinessDate(now) };
  }

  async function todaysRoutine(clientId: string, date: string) {
    const [routine] = await db`SELECT r.id, r.name FROM training_routines r
      WHERE r.client_id=${clientId}::uuid AND r.status='active' AND ${isoWeekday(date)}::smallint = ANY(r.scheduled_weekdays)
      ORDER BY r.created_at, r.id LIMIT 1`;
    return routine ? { id: String(routine.id), name: String(routine.name) } : null;
  }

  async function routineExercises(routineId: string) {
    const rows = await db`SELECT position, exercise_name AS "exerciseName", target_sets AS "targetSets"
      FROM training_routine_exercises WHERE routine_id=${routineId}::uuid ORDER BY position`;
    return rows.map(row => ({ position: Number(row.position), exerciseName: String(row.exerciseName), targetSets: Number(row.targetSets) }));
  }

  async function openSession(clientId: string) {
    const [session] = await db`SELECT s.id, s.routine_id AS "routineId", s.started_at AS "startedAt" FROM training_sessions s
      WHERE s.client_id=${clientId}::uuid AND s.status='in_progress'`;
    return session ? { id: String(session.id), routineId: session.routineId ? String(session.routineId) : null, startedAt: new Date(session.startedAt).toISOString() } : null;
  }

  app.get('/api/me/training/today', async (request, reply) => {
    const ctx = await gate(request, reply); if (!ctx) return;
    const session = await openSession(ctx.clientId);
    const routine = await todaysRoutine(ctx.clientId, ctx.date);
    if (!routine) return { status: 'rest_day' as const, date: ctx.date, openSessionId: session?.id ?? null };
    return { status: 'training_day' as const, date: ctx.date, routine: { ...routine, exercises: await routineExercises(routine.id) }, openSessionId: session?.id ?? null };
  });

  app.post('/api/me/training/sessions', async (request, reply) => {
    const ctx = await gate(request, reply); if (!ctx) return;
    const body = z.object({ routineId: uuid.optional() }).strict().safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_training_session' });
    const existing = await openSession(ctx.clientId);
    if (existing) return reply.code(200).send({ session: existing });
    let routineId: string | null = null;
    if (body.data.routineId) {
      const [routine] = await db`SELECT id FROM training_routines WHERE id=${body.data.routineId}::uuid AND client_id=${ctx.clientId}::uuid AND status='active'`;
      if (!routine) return reply.code(404).send({ error: 'training_routine_not_found' });
      routineId = String(routine.id);
    } else {
      const routine = await todaysRoutine(ctx.clientId, ctx.date);
      if (!routine) return reply.code(409).send({ error: 'no_routine_today' });
      routineId = routine.id;
    }
    try {
      const [session] = await db`INSERT INTO training_sessions(client_id,routine_id,status,business_date)
        VALUES (${ctx.clientId}::uuid,${routineId}::uuid,'in_progress',${ctx.date}::date)
        RETURNING id, routine_id AS "routineId", started_at AS "startedAt"`;
      if (!session) return reply.code(500).send({ error: 'training_session_not_created' });
      return reply.code(201).send({ session: { id: String(session.id), routineId: String(session.routineId), startedAt: new Date(session.startedAt).toISOString() } });
    } catch (error: any) {
      // Otra petición abrió la sesión entre la lectura y el insert: se devuelve esa.
      if (error?.code !== '23505') throw error;
      return reply.code(200).send({ session: await openSession(ctx.clientId) });
    }
  });

  async function ownSession(clientId: string, sessionId: string) {
    const [session] = await db`SELECT id, status FROM training_sessions WHERE id=${sessionId}::uuid AND client_id=${clientId}::uuid`;
    return session ? { id: String(session.id), status: String(session.status) } : null;
  }

  app.post('/api/me/training/sessions/:id/sets', async (request, reply) => {
    const ctx = await gate(request, reply); if (!ctx) return;
    const params = z.object({ id: uuid }).safeParse(request.params);
    const body = setBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_training_set' });
    const session = await ownSession(ctx.clientId, params.data.id);
    if (!session) return reply.code(404).send({ error: 'training_session_not_found' });
    if (session.status !== 'in_progress') return reply.code(409).send({ error: 'session_not_open' });
    const { exerciseName: name, setIndex, reps, weightKg, rir } = body.data;
    const [set] = await db`INSERT INTO training_session_sets(session_id,exercise_name,set_index,reps,weight_kg,rir)
      VALUES (${session.id}::uuid,${name},${setIndex},${reps},${weightKg},${rir ?? null})
      ON CONFLICT (session_id,exercise_name,set_index) DO UPDATE SET reps=EXCLUDED.reps, weight_kg=EXCLUDED.weight_kg, rir=EXCLUDED.rir, updated_at=now()
      RETURNING exercise_name AS "exerciseName", set_index AS "setIndex", reps, weight_kg::float8 AS "weightKg", rir`;
    if (!set) return reply.code(500).send({ error: 'training_set_not_saved' });
    return { set: { exerciseName: String(set.exerciseName), setIndex: Number(set.setIndex), reps: Number(set.reps), weightKg: Number(set.weightKg), rir: set.rir == null ? null : Number(set.rir) } };
  });

  app.post('/api/me/training/sessions/:id/finish', async (request, reply) => {
    const ctx = await gate(request, reply); if (!ctx) return;
    const params = z.object({ id: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_training_session' });
    const session = await ownSession(ctx.clientId, params.data.id);
    if (!session) return reply.code(404).send({ error: 'training_session_not_found' });
    if (session.status === 'finished') return { session: { id: session.id, status: 'finished' } };
    const [countRow] = await db`SELECT count(*)::int AS count FROM training_session_sets WHERE session_id=${session.id}::uuid`;
    if (Number(countRow?.count ?? 0) === 0) return reply.code(409).send({ error: 'no_sets_logged' });
    const [finished] = await db`UPDATE training_sessions SET status='finished', finished_at=now()
      WHERE id=${session.id}::uuid AND status='in_progress'
      RETURNING id, status, finished_at AS "finishedAt"`;
    if (!finished) return reply.code(409).send({ error: 'session_not_open' });
    return { session: { id: String(finished.id), status: 'finished' as const, finishedAt: new Date(finished.finishedAt).toISOString() } };
  });

  app.get('/api/me/training/history', async (request, reply) => {
    const ctx = await gate(request, reply); if (!ctx) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'invalid_training_history' });
    const sessions = await db`SELECT s.id, s.started_at AS "startedAt", s.finished_at AS "finishedAt", r.name AS "routineName"
      FROM training_sessions s LEFT JOIN training_routines r ON r.id=s.routine_id
      WHERE s.client_id=${ctx.clientId}::uuid AND s.status='finished'
      ORDER BY s.started_at DESC, s.id DESC LIMIT ${query.data.limit}`;
    const ids = sessions.map(session => String(session.id));
    const sets = ids.length === 0 ? [] : await db`SELECT session_id AS "sessionId", exercise_name AS "exerciseName", set_index AS "setIndex", reps, weight_kg::float8 AS "weightKg", rir
      FROM training_session_sets WHERE session_id = ANY(${ids}::uuid[]) ORDER BY exercise_name, set_index`;
    const bySession = new Map<string, Map<string, Array<{ setIndex: number; reps: number; weightKg: number; rir: number | null }>>>();
    for (const set of sets) {
      const exercises = bySession.get(String(set.sessionId)) ?? new Map();
      const list = exercises.get(String(set.exerciseName)) ?? [];
      list.push({ setIndex: Number(set.setIndex), reps: Number(set.reps), weightKg: Number(set.weightKg), rir: set.rir == null ? null : Number(set.rir) });
      exercises.set(String(set.exerciseName), list);
      bySession.set(String(set.sessionId), exercises);
    }
    return {
      sessions: sessions.map(session => {
        const exercises = [...(bySession.get(String(session.id))?.entries() ?? [])].map(([exerciseName, sets]) => ({ exerciseName, sets }));
        return {
          id: String(session.id),
          routineName: session.routineName ? String(session.routineName) : null,
          startedAt: new Date(session.startedAt).toISOString(),
          finishedAt: new Date(session.finishedAt).toISOString(),
          setCount: exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
          exercises,
        };
      }),
    };
  });
}
