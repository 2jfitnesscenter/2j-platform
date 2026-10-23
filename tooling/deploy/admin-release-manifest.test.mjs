import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPilotManifest, writePilotManifest } from './admin-release-manifest.mjs';

const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), channel: 'internal-pilot', fiscalGate: 'closed', publicExposure: false };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), '2j-admin-release-'));
  await mkdir(join(root, 'apps/admin-web/dist'), { recursive: true });
  await mkdir(join(root, 'apps/api/dist'), { recursive: true });
  await writeFile(join(root, 'source.tar'), 'source');
  await writeFile(join(root, 'apps/admin-web/dist/index.html'), '<main>Admin</main>');
  await writeFile(join(root, 'apps/api/dist/server.js'), 'server');
  return root;
}

test('manifest requires internal pilot, closed fiscal gate and non-public exposure', async () => {
  const root = await fixture();
  try {
    const manifest = await createPilotManifest(root, identity);
    assert.equal(manifest.channel, 'internal-pilot');
    assert.equal(manifest.fiscalGate, 'closed');
    assert.equal(manifest.publicExposure, false);
    assert.equal(manifest.deploymentAllowed, false);
    assert.equal(manifest.runtime.apiBindAddress, '127.0.0.1');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('manifest rejects production/public release modes', async () => {
  const root = await fixture();
  try {
    await assert.rejects(createPilotManifest(root, { ...identity, channel: 'production' }), /unsafe_release_mode/);
    await assert.rejects(createPilotManifest(root, { ...identity, publicExposure: true }), /unsafe_release_mode/);
    await assert.rejects(createPilotManifest(root, { ...identity, fiscalGate: 'open' }), /unsafe_release_mode/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('manifest rejects secret and local-data paths', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, '.env.local'), 'DATABASE_URL=secret');
    await assert.rejects(createPilotManifest(root, identity), /forbidden_release_path:\.env\.local/);
    await rm(join(root, '.env.local'));
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data/customer.json'), '{}');
    await assert.rejects(createPilotManifest(root, identity), /forbidden_release_path:data/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('manifest permits the tracked non-secret .env.example template', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, '.env.example'), 'DATABASE_URL=postgres://127.0.0.1/example');
    const manifest = await createPilotManifest(root, identity);
    assert.ok(manifest.files.some((file) => file.path === '.env.example'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('manifest hashes every included artifact and is written only once', async () => {
  const root = await fixture();
  try {
    const manifest = await writePilotManifest(root, identity);
    assert.equal(manifest.files.length, 3);
    assert.ok(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
    assert.deepEqual(JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8')), manifest);
    await assert.rejects(writePilotManifest(root, identity), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release archive hash helper returns a SHA-256 digest', async () => {
  const root = await fixture();
  try {
    const archive = join(root, 'candidate.zip');
    await writeFile(archive, 'synthetic archive');
    const actual = execFileSync(process.execPath, [join(process.cwd(), 'tooling/deploy/sha256-file.mjs'), archive], { encoding: 'utf8' }).trim();
    const expected = createHash('sha256').update('synthetic archive').digest('hex');
    assert.equal(actual, expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});
