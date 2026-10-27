import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareProxyState, validateAcme } from './proxy-state.mjs';

const state = JSON.stringify({ le: { Account: { PrivateKey: 'synthetic-account-key' }, Certificates: [
  { domain: { main: 'app.example.com' }, certificate: 'synthetic-certificate', key: 'synthetic-leaf-key' },
] } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'proxy-state-test-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('proxy-state-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, 'checkout'), legacy = join(root, 'legacy');
  mkdirSync(workspace); mkdirSync(legacy);
  writeFileSync(join(legacy, '.env'), 'TRAEFIK_DASHBOARD_DOMAIN=traefik.example.com\nPORTAINER_PORT=9000\n');
  writeFileSync(join(legacy, 'acme.json'), state);
  let copies = 0;
  const options = { workspace, envFile: join(root, 'private', 'proxy.env'), acmeFile: join(root, 'private', 'acme.json'),
    docker(args) {
      if (args[0] === 'container') return JSON.stringify([{Config:{Labels:{
        'com.docker.compose.project':'proxy', 'com.docker.compose.project.working_dir':legacy,
      }}}]);
      assert.equal(args[0], 'cp'); assert.equal(args[1], 'traefik:/acme.json');
      copies++; copyFileSync(join(legacy, 'acme.json'), args[2]);
    } };
  return { options, legacy, copies: () => copies };
}
test('migrates exact live state and environment, then preserves the authoritative renewed store', t => {
  const f = fixture(t);
  assert.deepEqual(prepareProxyState(f.options), {project:'proxy'});
  assert.equal(readFileSync(f.options.acmeFile, 'utf8'), state);
  assert.equal(readFileSync(f.options.envFile, 'utf8'), readFileSync(join(f.legacy, '.env'), 'utf8'));
  const renewed = state.replace('synthetic-certificate', 'renewed-certificate');
  writeFileSync(f.options.acmeFile, renewed);
  prepareProxyState(f.options);
  assert.equal(readFileSync(f.options.acmeFile, 'utf8'), renewed);
  assert.equal(f.copies(), 1);
});
test('rejects empty, invalid and incomplete stores without creating a replacement', t => {
  for (const invalid of ['', '{}', '{', '{"le":{"Account":{},"Certificates":[]}}']) {
    const f = fixture(t); writeFileSync(join(f.legacy, 'acme.json'), invalid);
    assert.throws(() => prepareProxyState(f.options), /acme-/);
    assert.equal(existsSync(f.options.acmeFile), false);
    assert.equal(readFileSync(join(f.legacy, 'acme.json'), 'utf8'), invalid);
  }
});
test('an invalid persistent store is never overwritten from an older live snapshot', t => {
  const f = fixture(t); mkdirSync(join(f.options.acmeFile, '..'), {recursive:true});
  writeFileSync(f.options.acmeFile, 'invalid-current-state');
  assert.throws(() => prepareProxyState(f.options), /acme-invalid/);
  assert.equal(readFileSync(f.options.acmeFile, 'utf8'), 'invalid-current-state');
  assert.equal(f.copies(), 0);
});
test('missing legacy environment stops before migration without guessing production values', t => {
  const f = fixture(t); rmSync(join(f.legacy, '.env'));
  assert.throws(() => prepareProxyState(f.options), /persistent-proxy-env-required/);
  assert.equal(existsSync(f.options.acmeFile), false); assert.equal(f.copies(), 0);
});
test('runtime paths inside the checkout are refused', t => {
  const f = fixture(t);
  assert.throws(() => prepareProxyState({...f.options, acmeFile:join(f.options.workspace,'acme.json')}), /outside-checkout/);
});
test('existing runtime symlinks are refused', {skip:process.platform === 'win32'}, t => {
  const f = fixture(t); mkdirSync(join(f.options.acmeFile, '..'), {recursive:true});
  symlinkSync(join(f.legacy, '.env'), f.options.envFile);
  assert.throws(() => prepareProxyState(f.options), /regular-file/);
});
test('validation errors never contain private state', () => {
  assert.throws(() => validateAcme('synthetic-private-value'), error => !error.message.includes('synthetic-private-value'));
});
