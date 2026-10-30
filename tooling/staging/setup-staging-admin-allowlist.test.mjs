import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = await readFile(new URL('./setup-staging.sh', import.meta.url), 'utf8');
const validator = script.match(/validate_admin_allow_ips\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(validator, 'the staging script must expose its exact allowlist validator');
const canExecuteBash = process.platform !== 'win32';

function validate(value) {
  return spawnSync('bash', ['-lc', `${validator}\nvalidate_admin_allow_ips`], {
    encoding: 'utf8',
    env: { ...process.env, ADMIN_ALLOW_IPS: value },
  });
}

test('admin allowlist is opt-in and accepts exact IPs and narrow CIDRs', { skip: !canExecuteBash && 'Bash/Python validator runs in Ubuntu CI; unavailable in this Windows environment' }, () => {
  for (const value of ['', '83.57.105.60', '83.57.105.0/24 2001:db8:abcd::/64', '2001:db8::1']) {
    const result = validate(value);
    assert.equal(result.status, 0, `${value || '(omitted)'} should be accepted: ${result.stderr}`);
  }
});

test('admin allowlist rejects malformed IPs, broad CIDRs and non-canonical networks', { skip: !canExecuteBash && 'Bash/Python validator runs in Ubuntu CI; unavailable in this Windows environment' }, () => {
  for (const value of ['999.1.1.1', '10.0.0.0/23', '2001:db8::/63', '0.0.0.0/0', '::/0', '10.0.0.1/24', '::::']) {
    const result = validate(value);
    assert.notEqual(result.status, 0, `${value} must fail closed`);
  }
});

test('Admin Caddy allowlist matches the direct peer, not forwarded client headers', () => {
  const start = script.indexOf('# Platform admin.');
  const end = script.indexOf('# Búnker (', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const adminSite = script.slice(start, end);
  assert.match(adminSite, /@denied not remote_ip \$\{allow\}/);
  assert.doesNotMatch(adminSite, /client_ip|X-Forwarded-For|X-Real-IP/i);
});

test('the configured validator uses strict standard IP parsing and bounded prefixes', () => {
  assert.match(validator, /ipaddress\.ip_network\(value, strict=True\)/);
  assert.match(validator, /minimum = 24 if network\.version == 4 else 64/);
  assert.match(validator, /len\(entries\) > 32/);
});
