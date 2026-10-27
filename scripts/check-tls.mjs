import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export function certificateDays(cert, now = Date.now()) {
  const expires = Date.parse(cert?.valid_to);
  if (!Number.isFinite(expires)) throw new Error('certificate-date-unavailable');
  return Math.floor((expires - now) / 86400000);
}
export function verifyHost(host) {
  if (typeof host !== 'string' || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /\.(?:local|internal|localhost|test|invalid)$/.test(host)) throw new Error('public-host-required');
  return host;
}
export function probeCertificate(host) {
  verifyHost(host);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true });
    socket.setTimeout(10000, () => socket.destroy(new Error('tls-timeout')));
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        resolve({ daysRemaining: certificateDays(cert), expiresAt: new Date(cert.valid_to).toISOString() });
      } catch (error) { reject(error); }
      finally { socket.end(); }
    });
  });
}
export async function waitForRenewal(host, { probe = probeCertificate, now = Date.now, wait = sleep } = {}) {
  verifyHost(host);
  const deadline = now() + 300000;
  while (true) {
    try { const result = await probe(host); if (result.daysRemaining > 30) return result; } catch { /* Startup/challenge failures remain bounded. */ }
    if (now() >= deadline) throw new Error('certificate-renewal-not-confirmed');
    await wait(Math.min(10000, deadline - now()));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await waitForRenewal(process.env.VERIFY_HOST))); }
  catch { console.error('Public certificate renewal not confirmed. Inspect private ACME diagnostics; the previous state was preserved.'); process.exitCode = 1; }
}
