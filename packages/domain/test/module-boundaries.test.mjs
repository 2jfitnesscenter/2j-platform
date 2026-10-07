import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contract = JSON.parse(await readFile(new URL('../../../docs/architecture/domain/module-boundaries.json', import.meta.url), 'utf8'));

test('module dependency allowlist references known modules and has no cycles', () => {
  const modules = new Set(contract.modules);
  assert.equal(Object.keys(contract.dependencies).length, modules.size);
  for (const [module, dependencies] of Object.entries(contract.dependencies)) {
    assert.ok(modules.has(module), `unknown module ${module}`);
    for (const dependency of dependencies) assert.ok(modules.has(dependency), `${module} references unknown ${dependency}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (module) => {
    assert.ok(!visiting.has(module), `dependency cycle reaches ${module}`);
    if (visited.has(module)) return;
    visiting.add(module);
    contract.dependencies[module].forEach(visit);
    visiting.delete(module);
    visited.add(module);
  };
  modules.forEach(visit);
});

test('backend contract keeps transactions local and side effects post-commit', () => {
  assert.equal(contract.rules.database, 'postgresql');
  assert.equal(contract.rules.transactionOwner, 'single-domain-use-case');
  assert.equal(contract.rules.externalEffects, 'after-commit-outbox');
});
