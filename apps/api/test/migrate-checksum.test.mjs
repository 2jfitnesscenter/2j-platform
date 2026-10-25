import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { classifyStoredChecksum, migrateDatabase, migrationChecksums } from '../src/migrate.ts';
import { verifyMigrationChecksums } from '../scripts/verify-migration-checksums.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: migration checksum tests need PostgreSQL.');

const sha = (text) => createHash('sha256').update(text).digest('hex');
const toCrlf = (text) => text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const sourceUrl = new URL(process.env.DATABASE_URL);
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
const created = [], clients = [], dirs = [];

async function freshDatabase() {
  const name = `mig_eol_${randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  created.push(name);
  const url = new URL(sourceUrl); url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 2, connect_timeout: 5 });
  clients.push(sql);
  return { sql, url: url.toString() };
}
async function folder(files) {
  const dir = await mkdtemp(join(tmpdir(), 'mig-eol-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return pathToFileURL(`${dir}/`);
}
/** What the PREVIOUS runner did: hash the raw text of the file as it is on disk and store that. `eol` imitates a checkout with that line ending. */
async function previousRunner(sql, directory, { eol, lfOnly = [] }) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const raw = await readFile(new URL(name, directory), 'utf8');
    const contents = eol === 'crlf' && !lfOnly.includes(name) ? toCrlf(raw) : raw.replace(/\r\n/g, '\n');
    await sql.begin(async (tx) => { await tx.unsafe(contents); await tx`INSERT INTO schema_migrations(name, checksum) VALUES (${name}, ${sha(contents)})`; });
  }
}
const rows = (sql) => sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`;

const SYNTH = {
  '0001_a.sql': 'CREATE TABLE mig_a (id integer PRIMARY KEY);\nINSERT INTO mig_a VALUES (1);\n',
  '0002_b.sql': '-- second\nCREATE TABLE mig_b (id integer PRIMARY KEY, note text);\n',
  '0003_c.sql': 'ALTER TABLE mig_b ADD COLUMN extra text;\n',
};

after(async () => {
  for (const sql of clients) await sql.end({ timeout: 2 }).catch(() => {});
  for (const name of created) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  await admin.end({ timeout: 2 });
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('the checksum classification: LF form is canonical, CRLF form of the SAME content is accepted, anything else is a content mismatch', () => {
  const text = SYNTH['0001_a.sql'];
  const { canonical, crlf } = migrationChecksums(text);
  assert.notEqual(canonical, crlf);
  assert.equal(migrationChecksums(toCrlf(text)).canonical, canonical, 'a CRLF checkout normalizes to the same canonical checksum');
  assert.equal(classifyStoredChecksum(canonical, toCrlf(text)), 'match');
  assert.equal(classifyStoredChecksum(crlf, text), 'mismatch-eol-only');
  assert.equal(classifyStoredChecksum(` ${canonical} `, text), 'match', 'char(64) padding is tolerated');
  assert.equal(classifyStoredChecksum(sha(`${text}-- changed\n`), text), 'mismatch-content');
  assert.equal(classifyStoredChecksum(sha(text.replace('1', '2')), text), 'mismatch-content');
  assert.equal(classifyStoredChecksum(sha(text.replace(/\n/g, '\r')), text), 'mismatch-content', 'a lone CR is not an accepted form');
});

test('(a) a fresh database migrates and stores the LF-normalized checksum, whatever line endings the files have; a second run changes nothing', async () => {
  const { sql } = await freshDatabase();
  const directory = await folder({ '0001_a.sql': toCrlf(SYNTH['0001_a.sql']), '0002_b.sql': SYNTH['0002_b.sql'], '0003_c.sql': toCrlf(SYNTH['0003_c.sql']) });
  const first = await migrateDatabase(sql, { directory });
  assert.deepEqual(first.map((row) => row.name), Object.keys(SYNTH));
  for (const row of first) assert.equal(row.checksum.trim(), sha(SYNTH[row.name]), `${row.name} stored as the LF checksum`);
  const before = await rows(sql);
  await migrateDatabase(sql, { directory });
  assert.deepEqual(await rows(sql), before, 'rerun is a no-op');
});

test('(b) a database migrated with CRLF checksums by the previous runner is accepted and not rewritten', async () => {
  const { sql } = await freshDatabase();
  const directory = await folder(SYNTH);
  await previousRunner(sql, directory, { eol: 'crlf' });
  const before = await rows(sql);
  for (const row of before) assert.equal(row.checksum.trim(), sha(toCrlf(SYNTH[row.name])));
  await migrateDatabase(sql, { directory });                                  // LF files on disk now
  await migrateDatabase(sql, { directory: await folder(Object.fromEntries(Object.entries(SYNTH).map(([n, t]) => [n, toCrlf(t)]))) });   // and CRLF files
  assert.deepEqual(await rows(sql), before, 'schema_migrations is never rewritten');
});

test('(c) a database migrated with LF checksums by the previous runner is accepted from an LF and from a CRLF checkout', async () => {
  const { sql } = await freshDatabase();
  const directory = await folder(SYNTH);
  await previousRunner(sql, directory, { eol: 'lf' });
  const before = await rows(sql);
  await migrateDatabase(sql, { directory });
  await migrateDatabase(sql, { directory: await folder(Object.fromEntries(Object.entries(SYNTH).map(([n, t]) => [n, toCrlf(t)]))) });
  assert.deepEqual(await rows(sql), before);
});

test('(d) a real content change fails, even when only one character differs, in either line ending, and nothing after it is applied', async () => {
  for (const eol of ['lf', 'crlf']) {
    const { sql } = await freshDatabase();
    await previousRunner(sql, await folder(SYNTH), { eol });
    const before = await rows(sql);
    for (const edit of [(t) => t.replace('(id integer', '(id bigint'), (t) => `${t}-- appended\n`, (t) => t.replace(/\n/g, ' \n')]) {
      const changed = { ...SYNTH, '0002_b.sql': edit(SYNTH['0002_b.sql']), '0004_new.sql': 'CREATE TABLE mig_never (id integer);\n' };
      const directory = await folder(eol === 'crlf' ? Object.fromEntries(Object.entries(changed).map(([n, t]) => [n, toCrlf(t)])) : changed);
      await assert.rejects(() => migrateDatabase(sql, { directory }), /Migration checksum mismatch for 0002_b\.sql/);
      assert.deepEqual(await rows(sql), before, 'no row was added or changed');
      const [{ present }] = await sql`SELECT to_regclass('public.mig_never') IS NOT NULL AS present`;
      assert.equal(present, false, 'migrations after the mismatch are not applied');
    }
  }
});

test('(e) the mixed state of the pilot volume 084 (every migration with a CRLF checksum except 0029 with an LF one) passes, with the real repository migrations', async () => {
  const { sql, url } = await freshDatabase();
  const directory = new URL('../migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const upTo29 = await folder(Object.fromEntries(await Promise.all(names.filter((name) => name <= '0029_member_booking_pilot_cohort.sql').map(async (name) => [name, await readFile(new URL(name, directory), 'utf8')]))));
  await previousRunner(sql, upTo29, { eol: 'crlf', lfOnly: ['0029_member_booking_pilot_cohort.sql'] });
  const before = await rows(sql);
  const stored = Object.fromEntries(before.map((row) => [row.name, row.checksum.trim()]));
  const contents29 = await readFile(new URL('0029_member_booking_pilot_cohort.sql', directory), 'utf8');
  assert.equal(stored['0029_member_booking_pilot_cohort.sql'], migrationChecksums(contents29).canonical, '0029 carries the LF checksum');
  assert.equal(stored['0001_initial.sql'], migrationChecksums(await readFile(new URL('0001_initial.sql', directory), 'utf8')).crlf, 'the others carry the CRLF checksum');
  const report = await verifyMigrationChecksums(url);
  assert.equal(report.filter((row) => row.status === 'mismatch-content').length, 0);
  assert.equal(report.find((row) => row.name.startsWith('0029')).status, 'match');
  assert.equal(report.find((row) => row.name.startsWith('0001')).status, 'mismatch-eol-only');
  await migrateDatabase(sql);                                                  // the real runner, the real directory: applies the rest, accepts the mix
  const after = await rows(sql);
  for (const row of before) assert.equal(after.find((candidate) => candidate.name === row.name).checksum, row.checksum, `${row.name} untouched`);
  assert.equal(after.length, names.length);
});

test('the read-only report classifies match / mismatch-eol-only / mismatch-content / not-applied / applied-but-missing-from-repo and performs no write', async () => {
  const { sql, url } = await freshDatabase();
  const directory = await folder(SYNTH);
  await previousRunner(sql, directory, { eol: 'crlf' });
  await sql`UPDATE schema_migrations SET checksum=${sha(SYNTH['0001_a.sql'])} WHERE name='0001_a.sql'`;                // an LF one
  await sql`UPDATE schema_migrations SET checksum=${sha('something else')} WHERE name='0003_c.sql'`;                    // a different migration
  await sql`INSERT INTO schema_migrations(name, checksum) VALUES ('0009_gone.sql', ${sha('gone')})`;
  const repo = await folder({ ...SYNTH, '0004_new.sql': 'SELECT 1;\n' });
  const before = await rows(sql);
  const report = Object.fromEntries((await verifyMigrationChecksums(url, repo)).map((row) => [row.name, row.status]));
  assert.deepEqual(report, { '0001_a.sql': 'match', '0002_b.sql': 'mismatch-eol-only', '0003_c.sql': 'mismatch-content', '0004_new.sql': 'not-applied', '0009_gone.sql': 'applied-but-missing-from-repo' });
  assert.deepEqual(await rows(sql), before, 'nothing changed');
  // PostgreSQL itself refuses a write inside the report's transaction, and the report never creates schema_migrations on a database without one.
  const empty = await freshDatabase();
  assert.deepEqual((await verifyMigrationChecksums(empty.url, repo)).map((row) => row.status), ['not-applied', 'not-applied', 'not-applied', 'not-applied']);
  const [{ present }] = await empty.sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
  assert.equal(present, false);
});

test('the repository pins migration line endings to LF', async () => {
  const attributes = await readFile(new URL('../../../.gitattributes', import.meta.url), 'utf8');
  assert.match(attributes, /^apps\/api\/migrations\/\*\.sql\s+text\s+eol=lf\s*$/m);
});
