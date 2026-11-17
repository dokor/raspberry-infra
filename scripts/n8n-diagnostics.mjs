import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Never print inspect, environment contents, command errors, or application logs.
export function summarizeContainer(c) {
  const labels = c.Config?.Labels ?? {};
  const env = Object.fromEntries((c.Config?.Env ?? []).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
  const flags = ['DB_TYPE', 'N8N_MFA_ENABLED', 'N8N_SECURE_COOKIE', 'N8N_PROXY_HOPS',
    'N8N_BLOCK_ENV_ACCESS_IN_NODE', 'N8N_RUNNERS_MODE'];
  return {
    name: c.Name, image: c.Config?.Image, running: c.State?.Running,
    project: labels['com.docker.compose.project'],
    workingDirectory: labels['com.docker.compose.project.working_dir'],
    composeFiles: labels['com.docker.compose.project.config_files'],
    user: c.Config?.User, privileged: c.HostConfig?.Privileged,
    readOnly: c.HostConfig?.ReadonlyRootfs, ports: c.HostConfig?.PortBindings,
    networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
    mounts: (c.Mounts ?? []).map(m => ({type: m.Type, name: m.Name, source: m.Source,
      destination: m.Destination, writable: m.RW})),
    flags: Object.fromEntries(flags.map(key => [key, env[key] ?? '(default)'])),
    encryptionKeyInEnvironment: Boolean(env.N8N_ENCRYPTION_KEY),
  };
}

export function collectDiagnostics(run = (command, args) => execFileSync(command, args,
  {encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})) {
  function read(command, args) {
    try { return {ok: true, output: run(command, args).trim()}; }
    catch { return {ok: false, output: 'Unavailable or insufficient read permissions'}; }
  }
  const report = {
    os: read('cat', ['/etc/os-release']), architecture: read('uname', ['-m']),
    clock: read('timedatectl', ['status']), disk: read('df', ['-h', '/', '/srv']),
    memory: read('free', ['-h']), docker: read('docker', ['version', '--format', '{{.Server.Version}}']),
    compose: read('docker', ['compose', 'version', '--short']),
    containers: read('docker', ['ps', '-a', '--format', '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}']),
    n8nVersion: read('docker', ['exec', 'n8n', 'n8n', '--version']),
    services: {}, listeners: read('ss', ['-lntu']),
    ufw: read('sudo', ['-n', 'ufw', 'status', 'verbose']),
    nftables: read('sudo', ['-n', 'nft', 'list', 'ruleset']),
    iptables: read('sudo', ['-n', 'iptables', '-S']),
    nat: read('sudo', ['-n', 'iptables', '-t', 'nat', '-S']),
    ip6tables: read('sudo', ['-n', 'ip6tables', '-S']),
    nat6: read('sudo', ['-n', 'ip6tables', '-t', 'nat', '-S']),
  };
  for (const name of ['n8n', 'traefik', 'portainer']) {
    try { report.services[name] = summarizeContainer(JSON.parse(run('docker', ['container', 'inspect', name]))[0]); }
    catch { report.services[name] = {unavailable: true}; }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = collectDiagnostics();
  const serialized = JSON.stringify(report, null, 2);
  console.log(serialized);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Raspberry diagnostics (read only)\n\nNo secrets or application logs collected. Router/NAT rules still need a separate check.\n\n\`\`\`json\n${serialized}\n\`\`\`\n`);
  if (!report.docker.ok || report.services.n8n.unavailable) process.exitCode = 1;
}
