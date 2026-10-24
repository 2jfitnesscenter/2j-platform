// READ-ONLY report: for every migration file in the repository, compare the checksum a database stored with the LF and CRLF forms of the file.
//   DATABASE_URL=postgres://… pnpm --filter @2j/api exec tsx scripts/verify-migration-checksums.ts [--json]
// The whole run happens inside one `READ ONLY` transaction (PostgreSQL itself refuses any write), it never creates `schema_migrations`, never
// edits a row and never applies a migration. Exit code: 0 = nothing wrong, 1 = at least one content mismatch, 2 = could not run.
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { classifyStoredChecksum, type MigrationChecksumVerdict } from '../src/migrate.js';

export type MigrationReportRow = {
  name: string;
  stored: string | null;
  status: MigrationChecksumVerdict | 'not-applied' | 'applied-but-missing-from-repo';
};

export async function verifyMigrationChecksums(databaseUrl: string, directory = new URL('../migrations/', import.meta.url)): Promise<MigrationReportRow[]> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    const stored = await sql.begin('read only', async (tx) => {
      const [{ present }] = await tx`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
      return present ? await tx`SELECT name, checksum FROM schema_migrations ORDER BY name` : [];
    });
    const byName = new Map(stored.map((row) => [String(row.name), String(row.checksum).trim()]));
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    const rows: MigrationReportRow[] = [];
    for (const name of files) {
      const checksum = byName.get(name);
      if (checksum === undefined) { rows.push({ name, stored: null, status: 'not-applied' }); continue; }
      rows.push({ name, stored: checksum, status: classifyStoredChecksum(checksum, await readFile(new URL(name, directory), 'utf8')) });
      byName.delete(name);
    }
    for (const [name, checksum] of byName) rows.push({ name, stored: checksum, status: 'applied-but-missing-from-repo' });
    return rows;
  } finally { await sql.end(); }
}

if (process.argv[1]?.endsWith('verify-migration-checksums.ts')) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required (read-only report).'); process.exit(2); }
  try {
    const rows = await verifyMigrationChecksums(url);
    if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else {
      for (const row of rows) console.log(`${row.status.padEnd(30)} ${row.name}  ${row.stored ? row.stored.slice(0, 16) : ''}`);
      const count = (status: string) => rows.filter((row) => row.status === status).length;
      console.log(`\nmatch ${count('match')} · mismatch-eol-only ${count('mismatch-eol-only')} (accepted by the runner) · mismatch-content ${count('mismatch-content')} (the runner refuses) · not-applied ${count('not-applied')} · applied-but-missing-from-repo ${count('applied-but-missing-from-repo')}`);
    }
    process.exit(rows.some((row) => row.status === 'mismatch-content') ? 1 : 0);
  } catch (error) { console.error(`could not read the database: ${(error as Error).message}`); process.exit(2); }
}
