import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) {
  process.stderr.write('usage: sha256-file.mjs <file>\n');
  process.exit(2);
}

try {
  process.stdout.write(`${createHash('sha256').update(await readFile(path)).digest('hex')}\n`);
} catch {
  process.stderr.write('sha256_failed\n');
  process.exit(1);
}
