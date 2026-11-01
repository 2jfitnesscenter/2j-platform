// Importación idempotente del catálogo de ejercicios (A88). Uso: DATABASE_URL=... pnpm --filter @2j/api exercises:import
// Nunca apuntar a una base real sin aprobación del propietario: primero base vacía, luego base con datos.
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { migrateDatabase } from '../src/migrate.ts';
import { importExerciseCatalog, parseExerciseCatalogSource } from '../src/exercise-catalog.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 2, connect_timeout: 5 });
try {
  await migrateDatabase(sql);
  const source = await readFile(new URL('../data/exercises-catalog.js', import.meta.url), 'utf8');
  const result = await importExerciseCatalog(sql, parseExerciseCatalogSource(source));
  console.log(JSON.stringify({ source: 'data/exercises-catalog.js', ...result }));
} finally {
  await sql.end();
}
