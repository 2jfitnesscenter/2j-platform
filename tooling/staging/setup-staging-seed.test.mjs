import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const script = await readFile(new URL('./setup-staging.sh', import.meta.url), 'utf8');
const seed = script.slice(script.indexOf('cmd_seed() {'), script.indexOf('\n# ----------------------------------------------------------------------------------------------------------------------------------------------------\nvalidate_conf()'));

test('staging seed requires the exact explicit target and matching staging domain before Docker runs', () => {
  assert.match(script, /^DOMAIN="2jfit\.com"$/m, 'new staging installations default to the owner-confirmed .com domain');
  assert.match(seed, /--target-host/);
  assert.match(seed, /\[ "\$target_host" = "2jfit\.com" \]/);
  assert.match(seed, /\[ "\$DOMAIN" = "\$target_host" \]/);
  assert.ok(seed.indexOf('[ "$DOMAIN" = "$target_host" ]') < seed.indexOf('docker run'));
  assert.match(seed, /docker run[\s\S]*-e STAGING_SEED=1[\s\S]*-e "STAGING_SEED_HOST=\$target_host"/);
  assert.match(script, /seed\) cmd_seed "\$@"/);
});

test('only the staging Admin API is bound to the synthetic owner actor', () => {
  const admin = script.slice(script.indexOf('  platform-admin-api:'), script.indexOf('  platform-member-api:'));
  const member = script.slice(script.indexOf('  platform-member-api:'), script.indexOf('EOF', script.indexOf('  platform-member-api:')));
  assert.match(admin, /PLATFORM_OWNER_ACTOR_ID: local-demo:admin/);
  assert.doesNotMatch(member, /PLATFORM_OWNER_ACTOR_ID/);
});
