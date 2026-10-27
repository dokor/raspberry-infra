import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const dockerCommand = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
export function validateAcme(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('acme-invalid'); }
  const resolver = data?.le;
  if (!resolver?.Account?.PrivateKey || !Array.isArray(resolver.Certificates) || !resolver.Certificates.length
      || resolver.Certificates.some(cert => !cert.domain?.main || !cert.certificate || !cert.key)) throw new Error('acme-incomplete');
}
function privateFile(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('state-not-a-regular-file');
  chmodSync(path, 0o600);
}
function outsideCheckout(path, workspace) {
  const rel = relative(resolve(workspace), resolve(path));
  if (!isAbsolute(path) || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) throw new Error('state-must-be-outside-checkout');
}

/** Only copy missing state. A current store is authoritative and is never reset. */
export function prepareProxyState({ workspace, envFile, acmeFile, docker = dockerCommand }) {
  outsideCheckout(envFile, workspace); outsideCheckout(acmeFile, workspace);
  const [container] = JSON.parse(docker(['container', 'inspect', 'traefik']));
  const project = container.Config?.Labels?.['com.docker.compose.project'];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project ?? '')) throw new Error('proxy-project-unverified');
  if (!existsSync(envFile)) {
    const legacy = container.Config?.Labels?.['com.docker.compose.project.working_dir'];
    if (!isAbsolute(legacy ?? '') || !existsSync(join(legacy, '.env'))) throw new Error('persistent-proxy-env-required');
    mkdirSync(dirname(envFile), { recursive: true, mode: 0o700 });
    writeFileSync(envFile, readFileSync(join(legacy, '.env')), { flag: 'wx', mode: 0o600 });
  }
  privateFile(envFile);
  mkdirSync(dirname(acmeFile), { recursive: true, mode: 0o700 });
  if (!existsSync(acmeFile)) {
    // Read the still-mounted store, even if a previous checkout unlinked its host file.
    const temp = mkdtempSync(join(dirname(acmeFile), '.acme-migration-'));
    const snapshot = join(temp, 'acme.json');
    try {
      docker(['cp', 'traefik:/acme.json', snapshot]);
      privateFile(snapshot); validateAcme(readFileSync(snapshot, 'utf8'));
      writeFileSync(acmeFile, readFileSync(snapshot), { flag: 'wx', mode: 0o600 });
    } finally {
      if (existsSync(snapshot)) unlinkSync(snapshot);
      rmdirSync(temp);
    }
  }
  privateFile(acmeFile); validateAcme(readFileSync(acmeFile, 'utf8'));
  return { project };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    const result = prepareProxyState({ workspace: process.env.GITHUB_WORKSPACE,
      envFile: process.env.PROXY_ENV_FILE, acmeFile: process.env.TRAEFIK_ACME_FILE });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `project=${result.project}\n`);
    console.log('Persistent proxy state verified; ACME contents remain private.');
  } catch { console.error('Proxy state preparation failed. Check private paths and the migration runbook; no empty ACME store was created.'); process.exitCode = 1; }
}
