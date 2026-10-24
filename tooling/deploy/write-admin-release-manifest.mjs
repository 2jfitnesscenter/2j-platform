import { writePilotManifest } from './admin-release-manifest.mjs';

const [root, commit, tree] = process.argv.slice(2);
if (!root || !commit || !tree || process.argv.length !== 5) {
  process.stderr.write('usage: write-admin-release-manifest.mjs <release-root> <commit> <tree>\n');
  process.exit(2);
}
try {
  const manifest = await writePilotManifest(root, { commit, tree, channel: 'internal-pilot', fiscalGate: 'closed', publicExposure: false });
  process.stdout.write(`MANIFEST_FILES=${manifest.files.length}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'manifest_failed'}\n`);
  process.exit(1);
}
