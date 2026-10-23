import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const forbiddenPath = /(^|\/)(\.git|node_modules|data|backups|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))($|\/)/i;

export async function listReleaseFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (forbiddenPath.test(path)) throw new Error(`forbidden_release_path:${path}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push({ path, absolute });
      else throw new Error(`unsupported_release_entry:${path}`);
    }
  }
  await visit(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function createPilotManifest(root, metadata) {
  if (!/^[0-9a-f]{40}$/.test(metadata.commit ?? '') || !/^[0-9a-f]{40}$/.test(metadata.tree ?? '')) {
    throw new Error('invalid_git_identity');
  }
  if (metadata.channel !== 'internal-pilot' || metadata.fiscalGate !== 'closed' || metadata.publicExposure !== false) {
    throw new Error('unsafe_release_mode');
  }
  const files = await listReleaseFiles(root);
  for (const required of ['source.tar', 'apps/admin-web/dist/index.html', 'apps/api/dist/server.js']) {
    if (!files.some((file) => file.path === required)) throw new Error(`required_release_file_missing:${required}`);
  }
  const entries = [];
  for (const file of files) {
    const info = await stat(file.absolute);
    if (!info.isFile()) throw new Error(`invalid_release_file:${file.path}`);
    const digest = createHash('sha256').update(await readFile(file.absolute)).digest('hex');
    entries.push({ path: file.path, size: info.size, sha256: digest });
  }
  return {
    schemaVersion: 1,
    channel: 'internal-pilot',
    commit: metadata.commit,
    tree: metadata.tree,
    fiscalGate: 'closed',
    publicExposure: false,
    runtime: { apiBindAddress: '127.0.0.1', authentication: 'development-demo-only' },
    deploymentAllowed: false,
    files: entries,
  };
}

export async function writePilotManifest(root, metadata) {
  const manifest = await createPilotManifest(root, metadata);
  await writeFile(join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}
