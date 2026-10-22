import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(await readFile(resolve(root, 'tokens.json'), 'utf8'));
const luminance = (hex) => {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

for (const mode of ['light', 'dark']) {
  test(`${mode} semantic text and status colors meet WCAG AA`, () => {
    const colors = tokens.themes[mode].color;
    for (const [background, foregrounds] of Object.entries(tokens.themes.contrastPairs)) {
      for (const foreground of foregrounds) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5,
          `${mode}.${foreground} on ${background} must meet WCAG AA`);
      }
    }
    assert.deepEqual(tokens.themes.contrastPairs.brand, ['textOnBrand'], 'brandStrong is not an approved text surface');
  });
}

test('brand colors remain aligned with the 2J source palette', () => {
  assert.equal(tokens.brand.primary, '#73b52e');
  assert.equal(tokens.brand.strong, '#578923');
});

test('V2 layer keeps one brand green and meets its documented contrast pairs', () => {
  const v2 = tokens.v2;
  assert.equal(v2.color.brand, tokens.brand.primary, 'V2 must not introduce a second brand green');
  assert.equal(v2.color.brandStrong, tokens.brand.strong);
  for (const [foreground, background, minimum] of v2.contrastPairs) {
    assert.ok(contrast(v2.color[foreground], v2.color[background]) >= minimum,
      `v2.${foreground} on ${background} must reach ${minimum}:1`);
  }
});

test('V2 radius scale is 6 / 10 / 12 / 16 / 20 / pill and is scoped to the opt-in selector', () => {
  const px = (rem) => parseFloat(rem) * 16;
  assert.deepEqual(['xs', 'sm', 'md', 'lg', 'xl'].map((key) => px(tokens.v2.radius[key])), [6, 10, 12, 16, 20]);
  assert.equal(tokens.v2.radius.pill, '999px');
  assert.equal(tokens.v2.scope, '[data-2j-design="v2"]');
});

test('generated CSS check accepts Windows CRLF checkouts', async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), '2j-token-crlf-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(resolve(temporaryRoot, 'tooling'), { recursive: true });
  await mkdir(resolve(temporaryRoot, 'src'), { recursive: true });
  await writeFile(resolve(temporaryRoot, 'tokens.json'), await readFile(resolve(root, 'tokens.json')));
  await writeFile(resolve(temporaryRoot, 'tooling/generate-css.mjs'), await readFile(resolve(root, 'tooling/generate-css.mjs')));
  const generatedCss = await readFile(resolve(root, 'src/tokens.css'), 'utf8');
  await writeFile(resolve(temporaryRoot, 'src/tokens.css'), generatedCss.replace(/\r?\n/g, '\r\n'));

  const result = spawnSync(process.execPath, [resolve(temporaryRoot, 'tooling/generate-css.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
