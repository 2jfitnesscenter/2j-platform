import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { importExerciseCatalog, parseExerciseCatalogSource } from '../src/exercise-catalog.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: exercise catalog tests cannot be skipped.');
process.env.NODE_ENV ??= 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const source = parseExerciseCatalogSource(readFileSync(new URL('../data/exercises-catalog.js', import.meta.url), 'utf8'));
const json = response => response.json();

// Primera importación: en base vacía crea todo; en base con datos solo escribe lo que falta o cambió.
const first = await importExerciseCatalog(sql, source);
assert.equal(first.total, source.length);

const memberId = randomUUID();
await sql`INSERT INTO clients(id,first_name,last_name,status) VALUES (${memberId}::uuid,'Mara','Catalog test','active')`;
const member = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => ({ clientId: memberId }) });
const anonymous = buildServer(process.env.DATABASE_URL, {});
after(async () => {
  await Promise.all([member.close(), anonymous.close()]);
  await sql.end();
});

test('the import creates every exercise from the source with its original fields', async () => {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM exercise_catalog`;
  assert.equal(count, source.length);
  const [row] = await sql`SELECT id, name, body_part, equipment, target, muscle_group, secondary_muscles, steps, image_file, gif_file FROM exercise_catalog WHERE id='0001'`;
  const expected = source.find(item => item.id === '0001');
  assert.equal(row.name, expected.n);
  assert.equal(row.muscle_group, expected.mg);
  assert.equal(row.body_part, expected.bp);
  assert.deepEqual([...row.secondary_muscles], expected.sm);
  assert.deepEqual([...row.steps], expected.st);
  assert.equal(row.image_file, expected.img);
});

test('a second import with the same source changes nothing and creates no duplicates', async () => {
  const again = await importExerciseCatalog(sql, source);
  assert.deepEqual(again, { total: source.length, changed: 0 });
  const [{ rows, distinct }] = await sql`SELECT count(*)::int AS rows, count(DISTINCT id)::int AS distinct FROM exercise_catalog`;
  assert.equal(rows, source.length);
  assert.equal(distinct, source.length);
});

test('original identifiers are kept as they are in the source', async () => {
  const stored = (await sql`SELECT id FROM exercise_catalog`).map(row => row.id).sort();
  assert.deepEqual(stored, source.map(item => item.id).sort());
});

test('the library list returns the imported data and the detail returns one exercise', async () => {
  const list = await member.inject({ method: 'GET', url: '/api/me/exercises?limit=200' });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(json(list).page.totalCount, source.length);
  assert.equal(json(list).items.length, 200);
  const detail = await member.inject({ method: 'GET', url: '/api/me/exercises/0001' });
  assert.equal(detail.statusCode, 200, detail.body);
  const exercise = json(detail).exercise;
  const expected = source.find(item => item.id === '0001');
  assert.equal(exercise.name, expected.n);
  assert.equal(exercise.muscleGroup, expected.mg);
  assert.deepEqual(exercise.steps, expected.st);
  assert.deepEqual(exercise.secondaryMuscles, expected.sm);
});

test('filtering by muscle group returns exactly the exercises of that group', async () => {
  const expected = source.filter(item => item.mg === 'obliques').length;
  assert.ok(expected > 0);
  const response = await member.inject({ method: 'GET', url: '/api/me/exercises?muscleGroup=obliques&limit=200' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(json(response).page.totalCount, expected);
  assert.ok(json(response).items.every(item => item.muscleGroup === 'obliques'));
});

test('name search is case-insensitive and a search with no matches renders an empty page', async () => {
  const upper = await member.inject({ method: 'GET', url: '/api/me/exercises?q=SIT-UP&limit=200' });
  assert.equal(upper.statusCode, 200, upper.body);
  assert.ok(json(upper).items.length > 0);
  assert.ok(json(upper).items.every(item => item.name.toLowerCase().includes('sit-up')));
  const none = await member.inject({ method: 'GET', url: '/api/me/exercises?q=zzz-sin-coincidencias' });
  assert.equal(none.statusCode, 200, none.body);
  assert.deepEqual(json(none).items, []);
  assert.equal(json(none).page.totalCount, 0);
});

test('the library needs an authenticated member but no training entitlement', async () => {
  // La miembro no tiene planes ni derecho de entrenamiento: la biblioteca es libre (A86).
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/exercises' })).statusCode, 200);
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/me/exercises' })).statusCode, 401);
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/me/exercises/0001' })).statusCode, 401);
});

test('an unknown or malformed exercise id answers not found', async () => {
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/exercises/abc' })).statusCode, 404);
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/exercises/9999' })).statusCode, 404);
});

test('a source row with a missing field is refused before any write', async () => {
  const [{ before }] = await sql`SELECT count(*)::int AS before FROM exercise_catalog`;
  const broken = [...source, { id: '9998', n: '', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'abs', sm: [], st: [], img: null, gif: null }];
  await assert.rejects(importExerciseCatalog(sql, broken), /exercise_catalog_row_invalid:9998:n/);
  const [{ after }] = await sql`SELECT count(*)::int AS after FROM exercise_catalog`;
  assert.equal(after, before);
});
