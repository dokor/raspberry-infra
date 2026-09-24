# 🏗️ Raspberry Infrastructure

Infrastructure commune du homelab Raspberry Pi 5.

Ce dépôt contient les briques transverses partagées par plusieurs projets. Les applications métier restent dans leurs propres repositories.

## Architecture

```text
Raspberry Pi 5
│
├── proxy
│   └── Traefik
│
├── databases
│   └── bases partagées
│
└── automation platform
    ├── n8n
    │   └── orchestration, schedules, retries, validations
    ├── codex-bridge
    │   └── accès LLM interne pour n8n
    ├── codex-runtime
    │   └── image Codex versionnée commune
    └── browser-automations
        └── Playwright / Chromium / sessions persistantes
```

## Dossiers principaux

```text
/infra
  /proxy
  /databases
  /n8n
  /codex-bridge
  /codex-runtime
  /automations
```

## Réseaux Docker

### `proxy`

Réseau externe utilisé par Traefik et les services volontairement exposés en HTTP/HTTPS.

```bash
docker network create proxy
```

### `automation`

Réseau externe privé utilisé par n8n et les services transverses d'automatisation.

```bash
docker network create automation
```

`codex-bridge` et `browser-automations` n'exposent pas de port public.

n8n est lié à `127.0.0.1:5678` par défaut. Une exposition distante doit passer explicitement par le proxy ou une autre configuration maîtrisée.

## Images partagées

GHCR est utilisé pour les images internes réutilisables, notamment :

```text
ghcr.io/dokor/codex-runtime:<version>
ghcr.io/dokor/browser-automations:<version>
```

Les images de runtime importantes doivent être versionnées. Éviter de faire dépendre la production implicitement de `:latest`.

## Configuration et secrets

- aucun secret versionné ;
- les exemples vivent dans des `.env.example` ;
- les valeurs de production sont stockées hors du checkout GitHub Actions ;
- n8n utilise par défaut `/srv/infra/raspberry-infra/env/n8n.env` ;
- les tokens CI restent dans GitHub Actions Secrets.

## CI/CD

Les déploiements utilisent le runner GitHub Actions :

```text
self-hosted + raspberry
```

Les workflows ne suivent pas tous la même cadence :

- certains services simples peuvent être redéployés sur modification de `main` ;
- les migrations sensibles, comme n8n, restent déclenchées manuellement ;
- les images partagées sont construites et publiées sur GHCR depuis GitHub Actions.

Voir `DEPLOYMENT_GUIDE.md` pour les conventions.

## Sécurité

- Traefik reste le point d'entrée HTTP/HTTPS public ;
- pas de DB Admin UI publique ;
- pas de secrets dans Git ;
- services internes sur des réseaux Docker privés ;
- UFW / Fail2ban côté hôte ;
- images et runtimes sensibles versionnés.

## Licence

Usage personnel.
