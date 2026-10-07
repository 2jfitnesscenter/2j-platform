import { readdir, readFile } from 'node:fs/promises';
import { createDatabase } from './db.js';
const { client } = createDatabase();
try {
  const directory = new URL('../migrations/', import.meta.url);
  const migrations = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const migration of migrations) await client.unsafe(await readFile(new URL(migration, directory), 'utf8'));
  console.log(`Applied ${migrations.length} database migrations.`);
}
finally { await client.end(); }
