import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(await readFile(resolve(root, 'tokens.json'), 'utf8'));
const flatten = (value, prefix = []) => Object.entries(value).flatMap(([key, item]) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? flatten(item, [...prefix, key])
    : [[prefix.concat(key).join('-'), item]],
);
const lines = [
  '/* Generated from tokens.json. Do not edit by hand. */',
  ':root {',
  '  color-scheme: light;',
  ...flatten(tokens.typography).map(([key, value]) => `  --2j-type-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`),
  ...flatten(tokens.space).map(([key, value]) => `  --2j-space-${key}: ${value};`),
  ...flatten(tokens.radius).map(([key, value]) => `  --2j-radius-${key}: ${value};`),
  ...flatten(tokens.elevation).map(([key, value]) => `  --2j-elevation-${key}: ${value};`),
  ...flatten(tokens.motion).map(([key, value]) => `  --2j-motion-${key}: ${value};`),
  ...flatten(tokens.themes.light.color).map(([key, value]) => `  --2j-color-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`),
  '}',
  '',
  ':root[data-theme="dark"] {',
  '  color-scheme: dark;',
  ...flatten(tokens.themes.dark.color).map(([key, value]) => `  --2j-color-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`),
  '}',
  '',
  `${tokens.v2.scope} {`,
  '  color-scheme: light;',
  '  font-family: var(--2j-type-font-family);',
  ...flatten({ type: tokens.v2.typography, radius: tokens.v2.radius, elevation: tokens.v2.elevation, control: tokens.v2.control, layout: tokens.v2.layout, z: tokens.v2.z })
    .map(([key, value]) => `  --2j-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`),
  ...flatten(tokens.v2.color).map(([key, value]) => `  --2j-color-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`),
  '}',
  '',
].join('\n');
const outputPath = resolve(root, 'src/tokens.css');
if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current.replaceAll('\r\n', '\n') !== lines) {
    console.error('tokens.css is stale; regenerate from tokens.json');
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines);
}
