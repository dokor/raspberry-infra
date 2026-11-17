import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(code) { throw new Error(code); }
export function environment(container) {
  return Object.fromEntries((container.Config?.Env ?? []).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
}
export function validateCurrent(container) {
  const project = container.Config?.Labels?.['com.docker.compose.project'];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project ?? '')) fail('existing-compose-project-required');
  if (!container.State?.Running) fail('existing-n8n-must-be-running');
  const data = (container.Mounts ?? []).filter(m => m.Destination === '/home/node/.n8n');
  if (data.length !== 1 || data[0].Type !== 'volume' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(data[0].Name ?? '')) {
    fail('existing-named-n8n-volume-required');
  }
  const env = environment(container);
  // This pipeline backs up the default SQLite store only, never an external DB.
  if ((env.DB_TYPE && env.DB_TYPE !== 'sqlite') || (env.DB_TABLE_PREFIX)
      || (env.DB_SQLITE_DATABASE && env.DB_SQLITE_DATABASE !== 'database.sqlite')
      || (env.N8N_USER_FOLDER && env.N8N_USER_FOLDER !== '/home/node')) fail('database-backup-requires-specific-procedure');
  if (!env.N8N_ENCRYPTION_KEY || env.N8N_ENCRYPTION_KEY_FILE) fail('existing-encryption-key-must-be-verified');
  return {project, volume: data[0].Name};
}
export function validateReplacement(container, model, version) {
  const state = validateCurrent(container);
  const n8n = model.services?.n8n;
  const pinned = /^n8nio\/n8n:(\d+\.\d+\.\d+)$/.exec(n8n?.image ?? '');
  // Configuration changes must not silently upgrade/downgrade the database.
  if (!pinned || version.trim() !== pinned[1]) fail('version-change-requires-tested-migration');
  const mount = n8n.volumes?.filter(m => m.target === '/home/node/.n8n') ?? [];
  if (mount.length !== 1 || mount[0].type !== 'volume'
      || model.volumes?.[mount[0].source]?.name !== state.volume) fail('existing-volume-would-change');
  const current = environment(container), next = n8n.environment ?? {};
  for (const key of ['N8N_ENCRYPTION_KEY', 'CODEX_BRIDGE_TOKEN', 'AUTOMATION_API_TOKEN']) {
    if (current[key] !== next[key] || !next[key]) fail('persistent-secrets-do-not-match-running-instance');
  }
  for (const [key, value] of Object.entries(current)) {
    if (key.startsWith('DB_') && key !== 'DB_TYPE' && key !== 'DB_SQLITE_DATABASE'
        && next[key] !== value) fail('custom-database-setting-would-change');
  }
  if (next.DB_TYPE && next.DB_TYPE !== 'sqlite') fail('database-backup-requires-specific-procedure');
  if (next.N8N_SKIP_AUTH_ON_OAUTH_CALLBACK !== 'false' || next.N8N_MFA_ENABLED !== 'true'
      || n8n.labels?.['traefik.enable'] !== 'false'
      || n8n.ports?.length !== 1 || n8n.ports[0].host_ip !== '127.0.0.1') fail('secure-overlay-required');
  return state;
}

function persistentPath(path, workspace) {
  if (!isAbsolute(path ?? '')) fail('absolute-persistent-path-required');
  // Resolve every existing ancestor so a symlink cannot put state in a checkout.
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const actual = resolve(realpathSync(ancestor), relative(ancestor, path));
  const rel = relative(realpathSync(workspace), actual);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) fail('persistent-state-inside-checkout');
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('persistent-state-symlink');
}

export function prepareN8nState({workspace, source, envFile, deployDir, backupRoot,
  docker = (args, env = process.env) => execFileSync('docker', args, {
    env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  })}) {
  for (const path of [envFile, deployDir, backupRoot]) persistentPath(path, workspace);
  if (!existsSync(envFile) || !lstatSync(envFile).isFile()) fail('persistent-n8n-env-required');
  const [container] = JSON.parse(docker(['container', 'inspect', 'n8n']));
  const state = validateCurrent(container);
  const [network] = JSON.parse(docker(['network', 'inspect', 'n8n_ingress']));
  if (!network.Internal) fail('deploy-secure-proxy-first');
  const [proxy] = JSON.parse(docker(['container', 'inspect', 'traefik']));
  if (!proxy.State?.Running || !proxy.NetworkSettings?.Networks?.n8n_ingress
      || proxy.Mounts?.some(m => m.Destination === '/var/run/docker.sock')) fail('deploy-secure-proxy-first');
  const securityDir = join(dirname(envFile), 'n8n-security');
  persistentPath(securityDir, workspace);
  const runnerToken = join(securityDir, 'runner_token');
  persistentPath(runnerToken, workspace);
  const env = {...process.env, N8N_SECURITY_DIR: securityDir, N8N_DATA_VOLUME: state.volume, N8N_INGRESS_ENABLED: 'false'};
  const model = JSON.parse(docker(['compose', '-p', state.project, '--env-file', envFile,
    '-f', join(source, 'docker-compose.yml'), '-f', join(source, 'compose.secure.yml'), 'config', '--format', 'json'], env));
  const version = docker(['exec', 'n8n', 'n8n', '--version']);
  validateReplacement(container, model, version);
  // All identity/data checks happen before copying files or stopping a container.
  mkdirSync(securityDir, {recursive: true, mode: 0o700}); chmodSync(securityDir, 0o700);
  if (!existsSync(runnerToken)) writeFileSync(runnerToken, randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o444});
  if (!lstatSync(runnerToken).isFile() || readFileSync(runnerToken).length < 32) fail('runner-secret-invalid');
  chmodSync(runnerToken, 0o444); chmodSync(envFile, 0o600);
  mkdirSync(backupRoot, {recursive: true, mode: 0o700}); chmodSync(backupRoot, 0o700);
  const backup = mkdtempSync(join(backupRoot, 'n8n-')); chmodSync(backup, 0o700);
  // Preserve the previous runtime files before replacing them.
  for (const name of ['docker-compose.yml', 'compose.secure.yml']) {
    const previous = join(deployDir, name); persistentPath(previous, workspace);
    if (existsSync(previous)) {
      copyFileSync(previous, join(backup, name)); chmodSync(join(backup, name), 0o600);
    }
  }
  mkdirSync(deployDir, {recursive: true, mode: 0o700});
  for (const name of ['docker-compose.yml', 'compose.secure.yml']) {
    const target = join(deployDir, name); persistentPath(target, workspace);
    copyFileSync(join(source, name), target); chmodSync(target, 0o600);
  }
  // Private recovery metadata stays on the Raspberry. Never upload it as an artifact.
  writeFileSync(join(backup, 'container.json'), JSON.stringify(container), {mode: 0o600});
  copyFileSync(envFile, join(backup, 'n8n.env')); chmodSync(join(backup, 'n8n.env'), 0o600);
  return {...state, securityDir, backup};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    const state = prepareN8nState({workspace: process.env.GITHUB_WORKSPACE,
      source: process.env.N8N_SOURCE_DIR, envFile: process.env.N8N_ENV_FILE,
      deployDir: process.env.N8N_DEPLOY_DIR, backupRoot: process.env.N8N_BACKUP_DIR});
    if (process.env.GITHUB_OUTPUT) {
      for (const [key, value] of Object.entries(state)) {
        if (/[\r\n]/.test(value)) fail('invalid-output-path');
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      }
    }
    console.log('Existing n8n identity and private deployment state verified.');
  } catch (error) {
    const code = /^[a-z][a-z-]+$/.test(error.message ?? '') ? error.message : 'private-preflight-failed';
    console.error(`n8n deployment stopped before restart: ${code}. No private values printed.`);
    process.exitCode = 1;
  }
}
