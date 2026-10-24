import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createDatabase } from './db.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The migration text with every CRLF turned into LF. A checkout with `autocrlf` on Windows must not change what a migration "is". */
export const normalizeMigrationEol = (contents: string) => contents.replace(/\r\n/g, '\n');

/**
 * The checksums a migration may legitimately have in `schema_migrations`:
 *  - `canonical`: SHA-256 of the LF form. This is what new rows store.
 *  - `crlf`: SHA-256 of the SAME content with CRLF line endings, as written by the previous runner on a Windows checkout.
 * (The LF form is also what the previous runner stored on Linux/CI.) Anything else is a different migration, not a different line ending.
 */
export function migrationChecksums(contents: string) {
  const normalized = normalizeMigrationEol(contents);
  return { normalized, canonical: sha256(normalized), crlf: sha256(normalized.replace(/\n/g, '\r\n')) };
}

export type MigrationChecksumVerdict = 'match' | 'mismatch-eol-only' | 'mismatch-content';

/** `match`: stored equals the LF form. `mismatch-eol-only`: stored equals the CRLF form of the same content (accepted). Anything else: `mismatch-content` (refused). */
export function classifyStoredChecksum(stored: string, contents: string): MigrationChecksumVerdict {
  const { canonical, crlf } = migrationChecksums(contents);
  const value = stored.trim();
  if (value === canonical) return 'match';
  if (value === crlf) return 'mismatch-eol-only';
  return 'mismatch-content';
}

export async function migrateDatabase(client: ReturnType<typeof createDatabase>['client'], options: { directory?: URL } = {}) {
  await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(2072010)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  });
  const directory = options.directory ?? new URL('../migrations/', import.meta.url);
  const migrations = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const name of migrations) {
    const contents = await readFile(new URL(name, directory), 'utf8');
    const { normalized, canonical } = migrationChecksums(contents);
    await client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(2072010)`;
      const [existing] = await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        // Never rewritten here: a row stays exactly as it was recorded, whichever accepted form it has.
        if (classifyStoredChecksum(existing.checksum, contents) === 'mismatch-content') throw new Error(`Migration checksum mismatch for ${name}`);
        return;
      }
      await tx.unsafe(normalized);
      await tx`INSERT INTO schema_migrations(name, checksum) VALUES (${name}, ${canonical})`;
    });
  }
  return await client`SELECT name, checksum FROM schema_migrations ORDER BY name`;
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  const { client } = createDatabase();
  try { const rows = await migrateDatabase(client); console.log(`Verified ${rows.length} checksummed database migration(s).`); }
  finally { await client.end(); }
}
