# Shared browser automations

Worker Playwright partagé de la plateforme d'automatisation.

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

- schedules et déclenchements ;
- retries ;
- conditions ;
- validations humaines ;
- notifications.

Le worker possède :

- Playwright / Chromium ;
- logique DOM ;
- sessions ;
- exécution des modules.

Il ne doit pas contenir de cron ou de logique de notification métier.

## Réseau

Le service rejoint le réseau externe privé `automation` et n'expose aucun port sur l'hôte.

Adresse interne :

```text
http://browser-automations:3000
```

## Authentification

Le worker exige :

```text
Authorization: Bearer <AUTOMATION_API_TOKEN>
```

La même valeur doit être :

- le secret GitHub Actions `AUTOMATION_API_TOKEN` de ce repository ;
- la valeur `AUTOMATION_API_TOKEN` dans le fichier d'environnement n8n.

## Image

Par défaut :

```text
ghcr.io/dokor/browser-automations:latest
```

La variable GitHub Actions `BROWSER_AUTOMATIONS_IMAGE` permet de sélectionner un autre tag sans modifier le compose.

À terme, préférer un tag versionné validé plutôt que `:latest`.

## Sessions

Les données de session sont persistées dans :

```text
browser-automation-data
```

Les procédures propres à un site restent documentées avec le module concerné et non dans `raspberry-infra`.

## Ajouter une automatisation

1. ajouter le module au worker générique ;
2. publier une nouvelle image ;
3. versionner le workflow n8n dans le repository métier ;
4. laisser n8n orchestrer l'appel.

Aucun nouveau compose ni nouveau cron n'est nécessaire.
