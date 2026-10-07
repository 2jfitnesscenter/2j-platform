import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(await readFile(resolve(root, 'tokens.json'), 'utf8'));
assert.match(tokens.version, /^\d+\.\d+\.\d+$/);
assert.match(tokens.brand.primary, /^#[0-9a-f]{6}$/i);
assert.match(tokens.brand.strong, /^#[0-9a-f]{6}$/i);
assert.ok(tokens.space['1'] && tokens.space['4'] && tokens.space['8']);
assert.ok(tokens.typography.fontFamily && tokens.radius.md && tokens.elevation.low && tokens.motion.normal);
const required = ['canvas', 'surface', 'textPrimary', 'textSecondary', 'textOnBrand', 'border', 'brand', 'focus'];
for (const name of ['light', 'dark']) {
  const colors = tokens.themes[name].color;
  for (const key of required) assert.ok(colors[key], `${name} theme missing ${key}`);
  for (const [key, value] of Object.entries(colors)) assert.match(value, /^#[0-9a-f]{6}$/i, `${name}.${key} is not hex`);
}
assert.deepEqual(tokens.themes.contrastPairs?.brand, ['textOnBrand'], 'Only the primary brand color is approved as a text surface');
assert.ok(Array.isArray(tokens.themes.contrastPairs?.canvas), 'Canvas text contrast pairs must be explicit');
console.log('Design token shape and color values are valid');
