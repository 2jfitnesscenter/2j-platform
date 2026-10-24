import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

const directory = new URL('../migrations/', import.meta.url);
const prefixOf = (name) => name.match(/^(\d{4})_/)?.[1];

test('every migration file is named NNNN_name.sql and no two files share the same numeric prefix', async () => {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(names.length > 0);
  const unnumbered = names.filter((name) => prefixOf(name) === undefined);
  assert.deepEqual(unnumbered, [], 'migration files must start with a four-digit number and an underscore');
  const byPrefix = new Map();
  for (const name of names) byPrefix.set(prefixOf(name), [...(byPrefix.get(prefixOf(name)) ?? []), name]);
  const duplicated = [...byPrefix].filter(([, files]) => files.length > 1).map(([prefix, files]) => `${prefix}: ${files.join(', ')}`);
  assert.deepEqual(duplicated, [], 'two migrations with the same number: renumber one of them before merging (see docs of the migration runner)');
});

test('the duplicate-prefix check really detects a duplicate', () => {
  const names = ['0001_a.sql', '0002_b.sql', '0002_c.sql'];
  const seen = new Map();
  for (const name of names) seen.set(prefixOf(name), [...(seen.get(prefixOf(name)) ?? []), name]);
  assert.deepEqual([...seen].filter(([, files]) => files.length > 1), [['0002', ['0002_b.sql', '0002_c.sql']]]);
});
