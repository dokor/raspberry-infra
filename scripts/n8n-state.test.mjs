import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { prepareN8nState, validateReplacement } from './n8n-state.mjs';

function models() {
  const secrets = {N8N_ENCRYPTION_KEY: 'synthetic-existing-key', CODEX_BRIDGE_TOKEN: 'synthetic-bridge', AUTOMATION_API_TOKEN: 'synthetic-api'};
  const container = {State: {Running: true}, Config: {Labels: {'com.docker.compose.project': 'existing'},
    Env: Object.entries(secrets).map(([k,v]) => `${k}=${v}`)},
    Mounts: [{Type: 'volume', Name: 'existing-volume', Destination: '/home/node/.n8n'}]};
  const model = {services: {n8n: {image: 'n8nio/n8n:2.47.7',
    environment: {...secrets, N8N_SKIP_AUTH_ON_OAUTH_CALLBACK: 'false', N8N_MFA_ENABLED: 'true'},
    labels: {'traefik.enable': 'false'}, ports: [{host_ip: '127.0.0.1'}],
    volumes: [{type: 'volume', source: 'n8n_data', target: '/home/node/.n8n'}]}},
    volumes: {n8n_data: {name: 'existing-volume'}}};
  return {container, model};
}

test('preserves current project, named volume and encryption key at the same version', () => {
  const {container, model} = models();
  assert.deepEqual(validateReplacement(container, model, '2.47.7\n'), {project: 'existing', volume: 'existing-volume'});
});

test('refuses a new volume, different key, public port, OAuth bypass or implicit version change', () => {
  const mutations = [
    m => {m.volumes.n8n_data.name = 'empty-volume';},
    m => {m.services.n8n.environment.N8N_ENCRYPTION_KEY = 'other-private-key';},
    m => {m.services.n8n.environment.AUTOMATION_API_TOKEN = 'other-private-token';},
    m => {m.services.n8n.ports[0].host_ip = '0.0.0.0';},
    m => {m.services.n8n.environment.N8N_SKIP_AUTH_ON_OAUTH_CALLBACK = 'true';},
    m => {m.services.n8n.labels['traefik.enable'] = 'true';},
    m => {m.services.n8n.image = 'n8nio/n8n:2.48.0';},
  ];
  for (const mutate of mutations) {
    const {container, model} = models(); mutate(model);
    assert.throws(() => validateReplacement(container, model, '2.47.7'), e => !e.message.includes('private-'));
  }
});

test('refuses an external or customized database instead of taking an irrelevant SQLite backup', () => {
  for (const setting of ['DB_TYPE=postgresdb', 'DB_TABLE_PREFIX=custom_', 'DB_SQLITE_DATABASE=other.sqlite', 'N8N_USER_FOLDER=/other']) {
    const {container, model} = models(); container.Config.Env.push(setting);
    assert.throws(() => validateReplacement(container, model, '2.47.7'), /specific-procedure/);
  }
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'n8n-state-test-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('n8n-state-test-'));
    rmSync(root, {recursive: true, force: true});
  });
  const workspace = join(root, 'checkout'), source = join(workspace, 'infra'), deployDir = join(root, 'runtime');
  mkdirSync(source, {recursive: true}); mkdirSync(deployDir);
  for (const name of ['docker-compose.yml', 'compose.secure.yml']) writeFileSync(join(source, name), 'synthetic-new-compose');
  writeFileSync(join(deployDir, 'docker-compose.yml'), 'synthetic-old-compose');
  const envFile = join(root, 'existing.env'); writeFileSync(envFile, 'PRIVATE=synthetic-original-env\n');
  const data = models(), calls = [];
  const options = {workspace, source, deployDir, envFile, backupRoot: join(root, 'backups'), docker(args, env) {
    calls.push(args);
    if (args[0] === 'container' && args[2] === 'n8n') return JSON.stringify([data.container]);
    if (args[0] === 'container' && args[2] === 'traefik') return JSON.stringify([{State: {Running: true}, NetworkSettings: {Networks: {n8n_ingress: {}}}}]);
    if (args[0] === 'network') return JSON.stringify([{Internal: true}]);
    if (args[0] === 'compose') {
      assert.equal(env.N8N_DATA_VOLUME, 'existing-volume'); assert.equal(env.N8N_INGRESS_ENABLED, 'false');
      return JSON.stringify(data.model);
    }
    if (args[0] === 'exec') return '2.47.7\n';
    throw new Error('Unexpected Docker mutation');
  }};
  return {...data, options, calls};
}

test('prepares persistent files, preserves environment/token and backs up old compose without restarting', t => {
  const f = fixture(t), result = prepareN8nState(f.options);
  assert.equal(result.project, 'existing');
  assert.equal(readFileSync(f.options.envFile, 'utf8'), 'PRIVATE=synthetic-original-env\n');
  assert.equal(readFileSync(join(result.backup, 'docker-compose.yml'), 'utf8'), 'synthetic-old-compose');
  assert.equal(readFileSync(join(result.backup, 'n8n.env'), 'utf8'), 'PRIVATE=synthetic-original-env\n');
  const secret = readFileSync(join(result.securityDir, 'runner_token'), 'utf8');
  assert.equal(secret.length, 64);
  prepareN8nState(f.options);
  assert.equal(readFileSync(join(result.securityDir, 'runner_token'), 'utf8'), secret);
  assert.ok(f.calls.every(args => ['container', 'network', 'compose', 'exec'].includes(args[0])));
});

test('failed identity check leaves current runtime and environment untouched', t => {
  const f = fixture(t); f.model.services.n8n.environment.N8N_ENCRYPTION_KEY = 'wrong-secret';
  assert.throws(() => prepareN8nState(f.options), /secrets-do-not-match/);
  assert.equal(readFileSync(join(f.options.deployDir, 'docker-compose.yml'), 'utf8'), 'synthetic-old-compose');
  assert.equal(existsSync(f.options.backupRoot), false);
});

test('refuses secret-bearing runtime files in the checkout', t => {
  const f = fixture(t);
  assert.throws(() => prepareN8nState({...f.options, backupRoot: join(f.options.workspace, 'backups')}), /inside-checkout/);
});

test('refuses symlinked persistent files', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), linked = join(f.options.deployDir, 'linked.env');
  symlinkSync(f.options.envFile, linked);
  assert.throws(() => prepareN8nState({...f.options, envFile: linked}), /symlink/);
});

test('deployment shell backs up before replacing n8n and handles failures without deleting data', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), root = join(f.options.deployDir, 'shell-test');
  mkdirSync(root);
  const workflow = readFileSync(new URL('../.github/workflows/deploy-n8n.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const script = workflow.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  assert.ok(script.includes('docker cp n8n:'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const mock = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), tool = path.basename(process.argv[1]);
fs.appendFileSync(process.env.EVENTS, JSON.stringify({tool, args, ingress: process.env.N8N_INGRESS_ENABLED})+'\\n');
if (tool === 'docker') {
  if (args[0] === 'cp') {
    if (process.env.FAIL_CASE === 'backup') process.exit(1);
    fs.writeFileSync(path.join(args[2], 'database.sqlite'), 'synthetic-snapshot');
  }
  if (args[0] === 'compose' && args.includes('up') && process.env.FAIL_CASE === 'start') process.exit(1);
} else if (tool === 'curl') {
  const url = args.at(-1);
  if (url.includes('/healthz/readiness')) process.exit(0);
  if (url.endsWith('/signin')) process.stdout.write('200');
  else if (url.includes('/rest/workflows') && process.env.FAIL_CASE === 'public') process.stdout.write('200');
  else if (/\\/rest\\/(workflows|credentials|executions)$/.test(url)) process.stdout.write('401');
  else process.stdout.write('404');
}
`;
  for (const name of ['docker', 'curl', 'sleep']) writeFileSync(join(bin, name), mock, {mode: 0o755});
  for (const scenario of ['private', 'public-success', 'backup', 'start', 'public']) {
    const backup = join(root, scenario); mkdirSync(backup);
    const events = join(backup, 'events');
    let failed = false;
    try { execFileSync('bash', ['-c', script], {encoding: 'utf8', stdio: 'pipe', env: {...process.env,
      PATH: bin + ':' + process.env.PATH, N8N_DEPLOY_DIR: f.options.deployDir, N8N_PROJECT: 'existing',
      N8N_ENV_FILE: f.options.envFile, BACKUP_DIR: backup, EXPOSE_EDITOR: scenario.startsWith('public') ? 'true' : 'false',
      FAIL_CASE: scenario, EVENTS: events}}); } catch { failed = true; }
    assert.equal(failed, ['backup', 'start', 'public'].includes(scenario), scenario);
    const calls = readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
    const deploys = calls.filter(c => c.tool === 'docker' && c.args[0] === 'compose' && c.args.includes('up'));
    assert.ok(calls.findIndex(c => c.args[0] === 'stop') < calls.findIndex(c => c.args[0] === 'cp'));
    if (scenario === 'backup') {
      assert.equal(deploys.length, 0);
      assert.ok(calls.some(c => c.args[0] === 'start'));
    } else {
      assert.ok(calls.findIndex(c => c.args[0] === 'cp') < calls.findIndex(c => c.args.includes('up')));
      assert.equal(readFileSync(join(backup, 'data', 'database.sqlite'), 'utf8'), 'synthetic-snapshot');
      assert.equal(deploys[0].ingress, 'false');
      if (scenario !== 'public-success') assert.equal(deploys.at(-1).ingress, 'false');
      if (scenario === 'start') assert.ok(calls.filter(c => c.args[0] === 'stop').length >= 2);
    }
    assert.ok(!calls.some(c => c.args.includes('down') || c.args.includes('--remove-orphans') || c.args.includes('rm')));
  }
});
