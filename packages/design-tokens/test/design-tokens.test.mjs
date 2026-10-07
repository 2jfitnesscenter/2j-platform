import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    for (const name of ['textPrimary', 'textSecondary', 'success', 'warning', 'danger', 'info', 'focus']) {
      assert.ok(contrast(colors[name], colors.canvas) >= 4.5, `${mode}.${name} must contrast with canvas`);
    }
    assert.ok(contrast(colors.textOnBrand, colors.brand) >= 4.5, `${mode}.textOnBrand must contrast with brand`);
  });
}

test('brand colors remain aligned with the 2J source palette', () => {
  assert.equal(tokens.brand.primary, '#73b52e');
  assert.equal(tokens.brand.strong, '#578923');
});
