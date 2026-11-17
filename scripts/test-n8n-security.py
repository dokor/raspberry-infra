"""Real proxy + Authelia + n8n test, on a disposable GitHub-hosted Docker engine only.

No production credentials, DNS, ACME, SMTP, workflow execution or external API calls.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.parse

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
    for name in ('n8n', 'authelia', 'task-runners'):
        service = model['services'][name]
        assert service['read_only'] and service['cap_drop'] == ['ALL']
        assert 'no-new-privileges:true' in service['security_opt']
        assert service['user'].split(':')[0] != '0'
        assert not service.get('privileged', False)
    assert set(model['services']['task-runners']['networks']) == {'runners'}
    assert model['networks']['runners']['internal']
    assert not model['services']['authelia'].get('ports')
    gate = load('infra/n8n/authelia/configuration.yml')
    assert gate['access_control'] == {'default_policy': 'deny', 'rules': [
        {'domain': 'n8n.lelouet.fr', 'subject': 'user:antoine', 'policy': 'two_factor'}]}
    assert gate['session']['cookies'][0]['domain'] == 'n8n.lelouet.fr'
    assert gate['session']['remember_me'] == -1
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
        (private / 'authelia-data').mkdir(mode=0o777)
        (private / 'authelia-data').chmod(0o777)
        for name in ('runner_token', 'session_secret', 'storage_key'):
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
        for service in [merged['services'][name] for name in ('n8n', 'task-runners', 'authelia')] + [
                proxy['services'][name] for name in ('traefik', 'docker-socket-proxy')]:
            manifest = json.loads(run('docker', 'buildx', 'imagetools', 'inspect', '--raw', service['image']))
            assert any(m.get('platform', {}).get('architecture') == 'arm64'
                       for m in manifest.get('manifests', [])), f"ARM64 missing: {service['image']}"
        print('PASS: all production images include ARM64', flush=True)
        authelia_image = merged['services']['authelia']['image']
        digest = run('docker', 'run', '--rm', authelia_image, 'authelia', 'crypto', 'hash',
                     'generate', 'argon2', '--password', 'Synthetic-CI-only-password!')
        password_hash = re.search(r'\$argon2id\$\S+', digest).group(0)
        users = load('infra/n8n/authelia/users.example.yml')
        users['users']['antoine']['password'] = password_hash
        (private / 'users.yml').write_text(yaml.safe_dump(users))
        (private / 'users.yml').chmod(0o444)
        # Real trusted TLS for the test hosts, without issuing public certificates.
        run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-keyout', str(tmp / 'key.pem'), '-out', str(tmp / 'cert.pem'),
            '-subj', '/CN=n8n.lelouet.fr', '-addext',
            'subjectAltName=DNS:n8n.lelouet.fr,DNS:auth.n8n.lelouet.fr')
        dynamic = tmp / 'dynamic'
        shutil.copytree(ROOT / 'infra/proxy/dynamic', dynamic)
        (dynamic / 'test-cert.yml').write_text(yaml.safe_dump({'tls': {'certificates': [
            {'certFile': '/test/cert.pem', 'keyFile': '/test/key.pem'}]}}))
        static = load('infra/proxy/traefik.yml')
        del static['certificatesResolvers']
        (tmp / 'traefik.yml').write_text(yaml.safe_dump(static))
        services = {name: merged['services'][name] for name in ('n8n', 'authelia', 'task-runners')}
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
        services['n8n']['labels']['traefik.enable'] = 'true'
        services['n8n']['ports'] = ['127.0.0.1:15678:5678']
        services['authelia']['networks']['n8n_ingress'] = {'aliases': ['n8n-authelia']}
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

        def request(host, path='/', extra=(), body=None, cookies=False):
            command = ['curl', '--silent', '--show-error', '--noproxy', '*', '--max-time', '10',
                       '--cacert', str(tmp / 'cert.pem'), '--resolve', f'{host}:8443:127.0.0.1',
                       '--dump-header', str(tmp / 'headers'), '--output', str(tmp / 'body'),
                       '--write-out', '%{http_code}', f'https://{host}:8443{path}']
            if cookies:
                command += ['--cookie', str(tmp / 'cookies'), '--cookie-jar', str(tmp / 'cookies')]
            if body is not None:
                command += ['-H', 'Content-Type: application/json', '-H', f'Origin: https://{host}',
                            '--data', json.dumps(body)]
            command += list(extra)
            code = int(run(*command))
            return code, (tmp / 'headers').read_text(), (tmp / 'body').read_text()

        try:
            compose('up', '-d', '--wait', '--wait-timeout', '240')
            print('PASS: n8n, external runners, gateway and proxy start', flush=True)
            for attempt in range(30):
                try:
                    if request('auth.n8n.lelouet.fr', '/api/health')[0] == 200:
                        break
                except RuntimeError:
                    pass
                time.sleep(1)
            else:
                raise AssertionError('gateway route did not become healthy')
            assert 'Task Broker' in compose('logs', 'n8n') or 'runner' in compose('logs', 'task-runners').lower()
            # The API and OAuth callback get exactly the same MFA gate as the editor.
            for path in ('/', '/signin', '/rest/settings', '/api/v1/workflows', '/webhook/test',
                         '/form/test', '/rest/oauth2-credential/callback?code=synthetic'):
                code, headers, body = request('n8n.lelouet.fr', path)
                assert code in (302, 303), (path, code)
                assert 'https://auth.n8n.lelouet.fr' in headers
                assert 'strict-transport-security:' in headers.lower()
            forged = ['-H', 'Remote-User: antoine', '-H', 'Remote-Groups: admin',
                      '-H', 'X-Forwarded-User: antoine', '-H', 'X-Forwarded-For: 127.0.0.1',
                      '-H', 'X-Forwarded-Host: auth.n8n.lelouet.fr', '-H', 'X-Forwarded-Proto: https']
            assert request('n8n.lelouet.fr', extra=forged)[0] in (302, 303)
            print('PASS: anonymous paths and forged identity headers stay blocked', flush=True)
            policy = compose('exec', '-T', 'authelia', 'authelia', 'access-control', 'check-policy',
                             '--url', 'https://n8n.lelouet.fr', '--username', 'someone-else')
            assert 'deny' in policy.lower(), policy
            code, _, _ = request('auth.n8n.lelouet.fr', '/api/firstfactor', cookies=True, body={
                'username': 'antoine', 'password': 'Synthetic-CI-only-password!',
                'targetURL': 'https://n8n.lelouet.fr', 'keepMeLoggedIn': False})
            assert code == 200, f'first factor: {code}'
            assert request('n8n.lelouet.fr', cookies=True)[0] in (302, 303)
            print('PASS: correct password alone does not reach n8n', flush=True)
            # Seed a synthetic test TOTP using the supported admin CLI; never real user data.
            compose('exec', '-T', 'authelia', 'authelia', 'storage', 'user', 'totp',
                    'generate', 'antoine')
            exported = compose('exec', '-T', 'authelia', 'authelia', 'storage', 'user', 'totp',
                               'export', 'uri')
            uri = re.search(r'otpauth://[^\s]+', exported).group(0)
            params = urllib.parse.parse_qs(urllib.parse.urlparse(uri).query)
            secret = params['secret'][0]
            secret_bytes = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
            counter = int(time.time()) // int(params.get('period', ['30'])[0])
            digest = hmac.new(secret_bytes, struct.pack('>Q', counter), hashlib.sha1).digest()
            offset = digest[-1] & 15
            token = f'{(struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000:06d}'
            code, _, _ = request('auth.n8n.lelouet.fr', '/api/secondfactor/totp', cookies=True,
                                body={'token': token, 'targetURL': 'https://n8n.lelouet.fr'})
            assert code == 200, f'second factor: {code}'
            assert request('n8n.lelouet.fr', '/rest/settings', cookies=True)[0] == 200
            print('PASS: valid password + TOTP reaches native n8n login', flush=True)
            compose('stop', 'authelia')
            assert request('n8n.lelouet.fr', cookies=True)[0] in (500, 502, 503)
            print('PASS: gateway outage denies access even with a previous session', flush=True)
        finally:
            # Only disposable CI services and synthetic volumes from this named project.
            compose('down', '--volumes', '--remove-orphans')


if __name__ == '__main__':
    main()
