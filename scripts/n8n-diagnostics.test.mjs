import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDiagnostics, summarizeContainer } from './n8n-diagnostics.mjs';

test('container report excludes credentials, labels and command payloads', () => {
  const result = summarizeContainer({Name: '/n8n', Config: {
    Env: ['N8N_ENCRYPTION_KEY=private-key', 'TOKEN=private-token', 'N8N_MFA_ENABLED=true'],
    Cmd: ['private-command'], Labels: {'private-label': 'private-label-value', 'com.docker.compose.project': 'existing'},
  }, Mounts: [{Type: 'volume', Name: 'existing-data', Destination: '/home/node/.n8n'}]});
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('private-'));
  assert.equal(result.encryptionKeyInEnvironment, true);
  assert.equal(result.project, 'existing');
  assert.equal(result.flags.N8N_MFA_ENABLED, 'true');
});

test('command failures never leak stderr or partial secret-bearing inspect output', () => {
  const report = collectDiagnostics(() => { throw new Error('private-env-value'); });
  assert.ok(!JSON.stringify(report).includes('private-env-value'));
  assert.equal(report.docker.ok, false);
  assert.equal(report.services.n8n.unavailable, true);
});
