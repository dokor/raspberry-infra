# 🚀 Deployment guide — Raspberry homelab

## 1. Principes

Le homelab utilise Docker, Docker Compose, Traefik et un runner GitHub Actions self-hosted.

Il n'existe pas un unique modèle de déploiement pour tous les composants :

- les applications métier peuvent être redéployées automatiquement après merge sur `main` ;
- les services d'infrastructure ont des workflows ciblés par chemin ;
- les migrations sensibles peuvent rester manuelles via `workflow_dispatch` ;
- les images partagées sont construites sur GitHub Actions et publiées sur GHCR.

L'objectif est de garder les déploiements reproductibles sans mélanger code, secrets et données persistantes.

## 2. Organisation

```text
/srv/
├─ infra/
│  └─ raspberry-infra/
│     └─ env/
│        └─ n8n.env
├─ apps/
│  ├─ project-a/
│  └─ project-b/
└─ backups/
```

Le répertoire `/srv/infra/raspberry-infra/env` contient les configurations persistantes nécessaires aux workflows d'infrastructure. Il ne doit pas être dans Git.

## 3. Réseaux Docker

### `proxy`

Réseau externe des services exposés via Traefik.

```bash
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
```

### `automation`

Réseau externe privé de la plateforme d'automatisation :

```bash
docker network inspect automation >/dev/null 2>&1 || docker network create automation
```

Il relie notamment :

- n8n ;
- codex-bridge ;
- browser-automations ;
- les services métier qui doivent être appelés par n8n.

## 4. Images partagées / GHCR

GHCR est utilisé pour distribuer des images ARM64/AMD64 communes.

Exemples :

```text
ghcr.io/dokor/codex-runtime:0.156.1-r1
ghcr.io/dokor/browser-automations:<tag>
```

Un workflow qui doit tirer un package privé doit :

1. demander `packages: read` ;
2. effectuer un login `ghcr.io` avec le `GITHUB_TOKEN` ;
3. disposer de l'accès Actions au package si celui-ci est privé.

## 5. Configuration persistante

Ne pas compter sur un fichier `.env` laissé dans le workspace d'un `actions/checkout`.

Le checkout du runner est un espace de travail CI, pas le stockage des secrets de production.

Pour n8n, le chemin par défaut est :

```text
/srv/infra/raspberry-infra/env/n8n.env
```

Le workflow accepte un autre emplacement via la variable GitHub Actions `N8N_ENV_FILE`.

Préparation initiale :

```bash
sudo mkdir -p /srv/infra/raspberry-infra/env
sudo cp infra/n8n/.env.example /srv/infra/raspberry-infra/env/n8n.env
sudo chmod 600 /srv/infra/raspberry-infra/env/n8n.env
```

Puis renseigner les vraies valeurs.

## 6. Déploiement n8n

Le déploiement n8n reste volontairement manuel pendant la migration.

Le workflow :

1. checkout le code de `main` ;
2. crée/vérifie le réseau `automation` ;
3. s'authentifie à GHCR ;
4. charge le fichier d'environnement persistant ;
5. valide Docker Compose ;
6. récupère l'image n8n ;
7. construit `codex-bridge` depuis le runtime Codex partagé ;
8. applique le compose.

L'image n8n doit être explicitement épinglée dans `N8N_IMAGE`.

## 7. Browser automations

Le worker navigateur est générique.

```text
n8n
  |
  | POST /run/<automation-id>
  v
browser-automations
  └── Playwright / Chromium / sessions
```

n8n garde la responsabilité de l'orchestration. Les paramètres métier propres aux sites restent avec leurs modules respectifs.

## 8. Déploiement d'une application métier

Pattern courant :

```yaml
jobs:
  deploy:
    runs-on:
      - self-hosted
      - raspberry
    steps:
      - name: Deploy
        run: |
          set -Eeuo pipefail
          cd /srv/apps/PROJECT_NAME
          git fetch origin main
          git reset --hard origin/main
          docker compose up -d --build --remove-orphans
```

Ce pattern n'est pas obligatoire pour l'infrastructure elle-même : les workflows `raspberry-infra` peuvent travailler depuis leur checkout CI lorsque les données persistantes restent en dehors de ce checkout.

## 9. Exposition réseau

- Traefik est le point d'entrée public HTTP/HTTPS ;
- les services internes utilisent `expose` ou aucun mapping de port ;
- n8n est lié à `127.0.0.1:5678` par défaut ;
- une exposition distante de n8n doit être configurée explicitement, idéalement via Traefik ;
- les bases ne doivent pas être rendues publiques.

## 10. Checklist

- [ ] runner `self-hosted + raspberry` disponible
- [ ] réseaux `proxy` et `automation` créés
- [ ] secrets GitHub configurés
- [ ] fichiers d'environnement persistants présents hors Git
- [ ] accès GHCR configuré pour les packages privés
- [ ] images de production épinglées
- [ ] volumes Docker vérifiés avant toute migration
- [ ] aucun `docker compose down -v` pendant une migration de données
