import { readFile } from 'node:fs/promises';
import { createDatabase } from './db.js';
const { client } = createDatabase();
try { await client.unsafe(await readFile(new URL('../migrations/0001_services_plans_rights.sql', import.meta.url), 'utf8')); console.log('Database migrations applied.'); }
finally { await client.end(); }
