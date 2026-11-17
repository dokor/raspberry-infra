"""Real proxy + native n8n MFA test, on a disposable GitHub-hosted Docker engine only.

No production credentials, DNS, ACME, SMTP, workflow execution or external API calls.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time

import yaml

ROOT = Path(__file__).resolve().parents[1]


def run(*args, env=None):
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode:
        # Only synthetic data is used in this test, but omit cookies and responses.
        raise RuntimeError(f"{args[0]} {args[1]} failed: {result.stderr[-3000:]}")
    return result.stdout


def load(path):
    return yaml.safe_load((ROOT / path).read_text())


def check_model(model):
    n = model['services']['n8n']
    assert len(n['ports']) == 1 and n['ports'][0]['host_ip'] == '127.0.0.1'
    assert n['labels']['traefik.enable'] == 'false', 'public route must default closed'
    assert n['environment']['N8N_BLOCK_ENV_ACCESS_IN_NODE'] == 'true'
    assert n['environment']['N8N_SSRF_PROTECTION_ENABLED'] == 'true'
    assert n['environment']['N8N_SECURE_COOKIE'] == 'true'
    assert n['environment']['N8N_RUNNERS_MODE'] == 'external'
    assert n['environment']['N8N_MFA_ENABLED'] == 'true'
    assert n['environment']['N8N_SKIP_AUTH_ON_OAUTH_CALLBACK'] == 'false'
    assert 'forwardAuth' not in json.dumps(load('infra/proxy/dynamic/n8n.yml'))
    assert set(model['services']) == {'n8n', 'task-runners', 'codex-bridge'}
    for name in ('n8n', 'task-runners'):
        service = model['services'][name]
        assert service['read_only'] and service['cap_drop'] == ['ALL']
        assert 'no-new-privileges:true' in service['security_opt']
        assert service['user'].split(':')[0] != '0'
        assert not service.get('privileged', False)
    assert set(model['services']['task-runners']['networks']) == {'runners'}
    assert model['networks']['runners']['internal']
    assert set(model['secrets']) == {'runner_token'}
    print('PASS: merged Compose security invariants', flush=True)


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Run only in disposable GitHub-hosted CI, never on the Raspberry.')
    with tempfile.TemporaryDirectory(prefix='n8n-security-') as directory:
        tmp = Path(directory)
        # Containers with distinct unprivileged UIDs need traversal of this synthetic directory.
        tmp.chmod(0o755)
        private = tmp / 'private'
        private.mkdir(mode=0o755)
        for name in ('runner_token',):
            (private / name).write_text('synthetic-ci-' + name + '-' + 'a' * 64)
            (private / name).chmod(0o444)
        (tmp / 'proxy.env').touch()
        (tmp / 'acme.json').touch()
        env = dict(os.environ, N8N_IMAGE='n8nio/n8n:2.47.7',
                   N8N_ENCRYPTION_KEY='synthetic-ci-encryption-key',
                   CODEX_BRIDGE_TOKEN='synthetic-ci-bridge-token',
                   AUTOMATION_API_TOKEN='synthetic-ci-worker-token',
                   N8N_SECURITY_DIR=str(private), PROXY_ENV_FILE=str(tmp / 'proxy.env'),
                   TRAEFIK_ACME_FILE=str(tmp / 'acme.json'), PORTAINER_PORT='9000')
        merged = json.loads(run('docker', 'compose', '-f', 'infra/n8n/docker-compose.yml',
                                '-f', 'infra/n8n/compose.secure.yml', 'config', '--format', 'json', env=env))
        check_model(merged)
        proxy = json.loads(run('docker', 'compose', '-f', 'infra/proxy/docker-compose.yml',
                              'config', '--format', 'json', env=env))
        for service in [merged['services'][name] for name in ('n8n', 'task-runners')] + [
                proxy['services'][name] for name in ('traefik', 'docker-socket-proxy')]:
            manifest = json.loads(run('docker', 'buildx', 'imagetools', 'inspect', '--raw', service['image']))
            assert any(m.get('platform', {}).get('architecture') == 'arm64'
                       for m in manifest.get('manifests', [])), f"ARM64 missing: {service['image']}"
        print('PASS: all production images include ARM64', flush=True)
        # Real trusted TLS for the test hosts, without issuing public certificates.
        run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-keyout', str(tmp / 'key.pem'), '-out', str(tmp / 'cert.pem'),
            '-subj', '/CN=n8n.lelouet.fr', '-addext',
            'subjectAltName=DNS:n8n.lelouet.fr')
        dynamic = tmp / 'dynamic'
        shutil.copytree(ROOT / 'infra/proxy/dynamic', dynamic)
        (dynamic / 'test-cert.yml').write_text(yaml.safe_dump({'tls': {'certificates': [
            {'certFile': '/test/cert.pem', 'keyFile': '/test/key.pem'}]}}))
        static = load('infra/proxy/traefik.yml')
        del static['certificatesResolvers']
        (tmp / 'traefik.yml').write_text(yaml.safe_dump(static))
        services = {name: merged['services'][name] for name in ('n8n', 'task-runners')}
        services.update({name: proxy['services'][name] for name in ('traefik', 'docker-socket-proxy')})
        for name, service in services.items():
            service.pop('container_name', None)
            service.pop('restart', None)
            labels = service.get('labels', {})
            for key in list(labels):
                if key.endswith('.tls.certresolver'):
                    del labels[key]
                    labels[key.removesuffix('.certresolver')] = 'true'
            if 'traefik.docker.network' in labels:
                labels['traefik.docker.network'] = 'security-test-ingress'
        services['n8n']['ports'] = ['127.0.0.1:15678:5678']
        services['traefik']['ports'] = ['127.0.0.1:8080:80', '127.0.0.1:8443:443']
        services['traefik']['volumes'] = [f'{tmp}/traefik.yml:/traefik.yml:ro',
            f'{dynamic}:/etc/traefik/dynamic:ro', f'{tmp}:/test:ro']
        services['traefik'].pop('env_file', None)
        networks = {name: {'internal': True} for name in ('automation', 'runners', 'docker_api')}
        networks['n8n_ingress'] = {'internal': True, 'name': 'security-test-ingress'}
        networks['proxy'] = {}
        fixture = {'services': services, 'networks': networks,
                   'volumes': {'n8n_data': {}}, 'secrets': merged['secrets']}
        compose_file = tmp / 'compose.yml'
        compose_file.write_text(yaml.safe_dump(fixture))
        prefix = ('docker', 'compose', '-p', 'n8n-security-test', '-f', str(compose_file))

        def compose(*args):
            return run(*prefix, *args)

        def request(path='/', extra=(), body=None, cookies=False, internal=False):
            url = ('http://127.0.0.1:15678' if internal else 'https://n8n.lelouet.fr:8443') + path
            command = ['curl', '--silent', '--show-error', '--noproxy', '*', '--max-time', '10',
                       '--path-as-is', '--cacert', str(tmp / 'cert.pem'),
                       '--resolve', 'n8n.lelouet.fr:8443:127.0.0.1',
                       '--dump-header', str(tmp / 'headers'), '--output', str(tmp / 'body'),
                       '--write-out', '%{http_code}', url]
            if cookies:
                command += ['--cookie', str(tmp / 'cookies'), '--cookie-jar', str(tmp / 'cookies')]
            if body is not None:
                command += ['-H', 'Content-Type: application/json', '-H', 'Origin: https://n8n.lelouet.fr:8443',
                            '--data', json.dumps(body)]
            command += list(extra)
            code = int(run(*command))
            return code, (tmp / 'headers').read_text(), (tmp / 'body').read_text()

        def totp(secret, offset=0):
            key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
            digest = hmac.new(key, struct.pack('>Q', int(time.time()) // 30 + offset), hashlib.sha1).digest()
            start = digest[-1] & 15
            return f'{(struct.unpack(">I", digest[start:start + 4])[0] & 0x7fffffff) % 1000000:06d}'

        try:
            compose('up', '-d', '--wait', '--wait-timeout', '240')
            # Public exposure is opt-in; bootstrap is possible only over loopback.
            assert request('/signin')[0] == 404
            password = 'Synthetic-CI-only-password!'
            email = 'owner@example.invalid'
            code, _, _ = request('/rest/owner/setup', internal=True, body={
                'email': email, 'password': password, 'firstName': 'Synthetic', 'lastName': 'Owner'})
            assert code == 200, f'local owner setup: {code}'
            services['n8n']['labels']['traefik.enable'] = 'true'
            compose_file.write_text(yaml.safe_dump(fixture))
            compose('up', '-d', '--no-deps', '--wait', '--wait-timeout', '240', 'n8n')
            for attempt in range(30):
                try:
                    if request('/signin')[0] == 200:
                        break
                except RuntimeError:
                    pass
                time.sleep(1)
            else:
                raise AssertionError('editor route did not become healthy')
            print('PASS: default-closed ingress and explicit HTTPS editor exposure', flush=True)
            assert 'Task Broker' in compose('logs', 'n8n') or 'runner' in compose('logs', 'task-runners').lower()
            # The login page and public bootstrap settings are intentionally public.
            for path in ('/', '/signin', '/rest/settings'):
                code, headers, _ = request(path)
                assert code == 200, (path, code)
                assert 'strict-transport-security:' in headers.lower()
            for path in ('/rest/workflows', '/rest/credentials', '/rest/executions', '/rest/mfa/qr'):
                assert request(path)[0] == 401, path
            forged = ['-H', 'Remote-User: antoine', '-H', 'Remote-Groups: admin',
                      '-H', 'X-Forwarded-User: antoine', '-H', 'X-Forwarded-For: 127.0.0.1',
                      '-H', 'X-Forwarded-Host: localhost', '-H', 'X-Forwarded-Proto: https']
            assert request('/rest/workflows', extra=forged)[0] == 401
            print('PASS: private REST endpoints reject anonymous requests and forged headers', flush=True)
            blocked = ('/api/v1/workflows', '/api', '/webhook/test', '/webhook-test/test',
                       '/webhook-waiting/test', '/form/test', '/form-test/test', '/form-waiting/test',
                       '/mcp/test', '/mcp-test/test', '/mcp-server/http', '/metrics', '/healthz/readiness',
                       '/rest/owner/setup', '/rest/invitations', '/rest/resolve-signup-token',
                       '/API/v1/workflows', '/%61pi/v1/workflows', '/webhook%2Ftest')
            for path in blocked:
                code, _, body = request(path)
                assert (code == 404 and body.strip() == '404 page not found') or (
                    '%2F' in path and code == 400), (path, code)
            assert request('/api/v1/workflows', internal=True)[0] == 401
            assert request('/healthz/readiness', internal=True)[0] == 200
            print('PASS: machine APIs/triggers/bootstrap are blocked at the edge; local API remains', flush=True)
            login = {'emailOrLdapLoginId': email, 'password': password}
            assert request('/rest/login', body=login, cookies=True)[0] == 200
            code, _, body = request('/rest/mfa/qr', cookies=True)
            assert code == 200
            enrollment = json.loads(body)['data']
            secret = enrollment['secret']
            assert enrollment['recoveryCodes'], 'native MFA recovery codes must be provided'
            assert request('/rest/mfa/enable', body={'mfaCode': totp(secret)}, cookies=True)[0] == 200
            assert request('/rest/logout', body={}, cookies=True)[0] == 200
            assert request('/rest/workflows', cookies=True)[0] == 401
            assert request('/rest/login', body=login, cookies=True)[0] == 401
            assert request('/rest/workflows', cookies=True)[0] == 401
            valid_tokens = {totp(secret, offset) for offset in range(-10, 11)}
            wrong_token = next(f'{i:06d}' for i in range(100) if f'{i:06d}' not in valid_tokens)
            assert request('/rest/login', body={**login, 'mfaCode': wrong_token}, cookies=True)[0] == 401
            print('PASS: enrolled native MFA rejects password-only and incorrect TOTP', flush=True)
            code, headers, _ = request('/rest/login', body={**login, 'mfaCode': totp(secret)}, cookies=True)
            assert code == 200, f'password + native MFA: {code}'
            assert 'httponly' in headers.lower() and 'secure' in headers.lower()
            assert request('/rest/workflows', cookies=True)[0] == 200
            for path in ('/api/v1/workflows', '/webhook/test', '/form/test', '/mcp-server/http'):
                assert request(path, cookies=True)[0] == 404
            assert request('/rest/logout', body={}, cookies=True)[0] == 200
            assert request('/rest/workflows', cookies=True)[0] == 401
            print('PASS: native MFA login succeeds, cookie is secure, logout revokes access', flush=True)
            invalid_login = {'emailOrLdapLoginId': 'rate-test@example.invalid', 'password': password}
            for _ in range(5):
                assert request('/rest/login', body=invalid_login)[0] == 401
            assert request('/rest/login', body=invalid_login)[0] == 429
            assert request('/rest/login', body=invalid_login, extra=['-H', 'X-Forwarded-For: 203.0.113.17'])[0] == 429
            print('PASS: native login rate limit cannot be reset by forged forwarded IP', flush=True)
            denied = subprocess.run([*prefix, 'exec', '-T', 'docker-socket-proxy', 'wget', '-S',
                                     '-O', '-', '--post-data={}',
                                     'http://127.0.0.1:2375/containers/create'],
                                    text=True, capture_output=True)
            assert denied.returncode != 0 and '403' in denied.stderr
            print('PASS: Docker API mutations are denied', flush=True)
        except Exception:
            # This stack contains synthetic credentials only and never executes business workflows.
            for name in services:
                print(compose('logs', '--tail', '35', name), flush=True)
            raise
        finally:
            # Only disposable CI services and synthetic volumes from this named project.
            compose('down', '--volumes', '--remove-orphans')


if __name__ == '__main__':
    main()
