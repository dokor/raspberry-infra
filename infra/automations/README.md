# Browser automations

Worker Playwright interne de la plateforme d'automatisation.

## Architecture

```text
n8n
  |
  | network: automation
  | POST /run/<automation-id>
  v
browser-automations
  |
  +-- Playwright / Chromium
  +-- sessions persistantes
  +-- modules navigateur
```

## Responsabilités

n8n possède :

- les schedules et déclenchements ;
- les retries ;
- les conditions ;
- les validations humaines ;
- les notifications.

Le worker possède :

- Playwright / Chromium ;
- la logique DOM ;
- les sessions ;
- l'exécution des modules.

Il ne contient ni cron, ni notification métier.

## Réseau

Le service rejoint le réseau Docker privé `automation` et n'expose aucun port sur l'hôte.

```text
http://browser-automations:3000
```

## Déploiement manuel

Les déploiements restent volontairement sous contrôle direct sur le Raspberry : aucune GitHub Action de déploiement n'est utilisée.

Dans ce dossier sur le Raspberry :

```bash
cp .env.example .env
chmod 600 .env
```

Renseigner dans `.env` :

```env
AUTOMATION_API_TOKEN=<secret long et aléatoire>
BROWSER_AUTOMATIONS_IMAGE=ghcr.io/dokor/browser-automations:latest
HEADLESS=true
DRY_RUN=true
```

Puis déployer :

```bash
docker network inspect automation >/dev/null 2>&1 || docker network create automation
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 browser-automations
```

Si GHCR demande une authentification, se connecter manuellement avec un jeton GitHub ayant uniquement l'accès `read:packages`.

Le service utilise `restart: unless-stopped` : après ce premier déploiement, il redémarre automatiquement avec Docker après un redémarrage du Raspberry.

## Authentification interne

Le worker exige :

```text
Authorization: Bearer <AUTOMATION_API_TOKEN>
```

La même valeur doit être configurée dans l'environnement n8n, qui l'envoie lors des appels HTTP au worker. Ne jamais versionner ce token.

## Sessions

Les données de session sont persistées dans le volume Docker `browser-automation-data`. Les procédures propres à un site restent documentées avec son module ; aucune session ou cookie ne doit être ajouté au dépôt.

## Mise à jour

La publication d'une nouvelle image vient de `dokor/hellcase-daily`. Après validation de son image, choisir explicitement quand lancer les quatre commandes de déploiement manuel ci-dessus.

## Ajouter une automatisation

1. ajouter le module au worker ;
2. publier une nouvelle image ;
3. versionner le workflow n8n dans le dépôt métier ;
4. laisser n8n orchestrer l'appel.

Aucun nouveau compose ni nouveau cron n'est nécessaire.
