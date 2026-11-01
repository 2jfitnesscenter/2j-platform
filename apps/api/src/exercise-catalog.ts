import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type postgres from 'postgres';
import { z } from 'zod';

/** Registro tal como viene del catálogo de Búnker (claves cortas). Se copia sin cambios. */
export type ExerciseSourceRow = { id: string; n: string; bp: string; eq: string; tg: string; mg: string; sm: string[]; st: string[]; img?: string | null; gif?: string | null };
type Sql = postgres.Sql;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const chunksOf = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** Lee el módulo JS del catálogo (un único `export const EXDB=[...]`) sin ejecutarlo. */
export function parseExerciseCatalogSource(text: string): ExerciseSourceRow[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('exercise_catalog_source_unreadable');
  const rows = JSON.parse(text.slice(start, end + 1)) as ExerciseSourceRow[];
  if (!Array.isArray(rows)) throw new Error('exercise_catalog_source_unreadable');
  return rows;
}

function toRecord(row: ExerciseSourceRow) {
  for (const field of ['id', 'n', 'bp', 'eq', 'tg', 'mg'] as const) {
    if (typeof row[field] !== 'string' || row[field].trim() === '') throw new Error(`exercise_catalog_row_invalid:${row.id ?? '?'}:${field}`);
  }
  if (!Array.isArray(row.sm) || !Array.isArray(row.st)) throw new Error(`exercise_catalog_row_invalid:${row.id}:lists`);
  return {
    id: row.id, name: row.n, body_part: row.bp, equipment: row.eq, target: row.tg, muscle_group: row.mg,
    secondary_muscles: row.sm, steps: row.st, image_file: row.img ?? null, gif_file: row.gif ?? null,
    content_sha256: sha256(JSON.stringify(row)),
  };
}

/**
 * Importación idempotente: inserta lo que falta y actualiza solo las filas cuyo contenido cambió.
 * Una segunda ejecución con el mismo origen no escribe nada (changed = 0). Los identificadores de origen se conservan.
 */
export async function importExerciseCatalog(sql: Sql, rows: ExerciseSourceRow[]) {
  const records = rows.map(toRecord);
  const ids = new Set(records.map(record => record.id));
  if (ids.size !== records.length) throw new Error('exercise_catalog_duplicate_id');
  let changed = 0;
  await sql.begin(async tx => {
    for (const chunk of chunksOf(records, 200)) {
      const written = await tx`INSERT INTO exercise_catalog(id,name,body_part,equipment,target,muscle_group,secondary_muscles,steps,image_file,gif_file,content_sha256)
        SELECT r.id,r.name,r.body_part,r.equipment,r.target,r.muscle_group,r.secondary_muscles,r.steps,r.image_file,r.gif_file,r.content_sha256
        FROM jsonb_to_recordset(${tx.json(chunk)}) AS r(id text, name text, body_part text, equipment text, target text, muscle_group text,
          secondary_muscles text[], steps text[], image_file text, gif_file text, content_sha256 char(64))
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, body_part=EXCLUDED.body_part, equipment=EXCLUDED.equipment, target=EXCLUDED.target,
          muscle_group=EXCLUDED.muscle_group, secondary_muscles=EXCLUDED.secondary_muscles, steps=EXCLUDED.steps,
          image_file=EXCLUDED.image_file, gif_file=EXCLUDED.gif_file, content_sha256=EXCLUDED.content_sha256, imported_at=now()
        WHERE exercise_catalog.content_sha256 <> EXCLUDED.content_sha256
        RETURNING id`;
      changed += written.length;
    }
  });
  return { total: records.length, changed };
}

const listQuery = z.object({
  muscleGroup: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
const exerciseParams = z.object({ id: z.string().regex(/^\d{4}$/) });

/**
 * Biblioteca de ejercicios para socios (A86): lectura libre, sin derecho de entrenamiento.
 * Solo exige que la petición venga de un socio activo (client()).
 */
export function registerExerciseLibraryRoutes(app: FastifyInstance, sql: Sql, client: (request: FastifyRequest, reply: any) => Promise<{ clientId: string } | null>) {
  app.get('/api/me/exercises', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const query = listQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'invalid_exercise_query' });
    const { muscleGroup, q, limit, offset } = query.data;
    const pattern = q === undefined ? null : `%${q.replace(/[\\%_]/g, match => `\\${match}`)}%`;
    const items = await sql`SELECT id, name, muscle_group AS "muscleGroup", body_part AS "bodyPart", equipment, target, image_file AS "imageFile",
        count(*) OVER()::int AS "totalCount"
      FROM exercise_catalog
      WHERE (${muscleGroup ?? null}::text IS NULL OR muscle_group = ${muscleGroup ?? null}::text)
        AND (${pattern}::text IS NULL OR name ILIKE ${pattern}::text)
      ORDER BY muscle_group, name, id
      LIMIT ${limit} OFFSET ${offset}`;
    return { items: items.map(({ totalCount: _total, ...item }) => item), page: { limit, offset, totalCount: Number(items[0]?.totalCount ?? 0) } };
  });

  app.get('/api/me/exercises/:id', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const params = exerciseParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'exercise_not_found' });
    const [exercise] = await sql`SELECT id, name, body_part AS "bodyPart", equipment, target, muscle_group AS "muscleGroup",
        secondary_muscles AS "secondaryMuscles", steps, image_file AS "imageFile", gif_file AS "gifFile"
      FROM exercise_catalog WHERE id=${params.data.id}`;
    if (!exercise) return reply.code(404).send({ error: 'exercise_not_found' });
    return { exercise };
  });
}
