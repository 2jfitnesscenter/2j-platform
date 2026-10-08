import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createDatabase } from './db.js';

export async function migrateDatabase(client: ReturnType<typeof createDatabase>['client']) {
  await client`CREATE TABLE schema_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`.catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42P07') return;
    throw error;
  });
  const directory = new URL('../migrations/', import.meta.url);
  const migrations = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const name of migrations) {
    const contents = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(contents).digest('hex');
    await client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(2072010)`;
      const [existing] = await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum.trim() !== checksum) throw new Error(`Migration checksum mismatch for ${name}`);
        return;
      }
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations(name, checksum) VALUES (${name}, ${checksum})`;
    });
  }
  return await client`SELECT name, checksum FROM schema_migrations ORDER BY name`;
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  const { client } = createDatabase();
  try { const rows = await migrateDatabase(client); console.log(`Verified ${rows.length} checksummed database migration(s).`); }
  finally { await client.end(); }
}
