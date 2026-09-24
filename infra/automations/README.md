# Shared browser automations

Ce dossier déploie le **worker Playwright partagé** de la plateforme d'automatisation du homelab.

Il complète l'instance n8n centrale :

```text
                         n8n
                          |
                  network: automation
          ________________|________________
         |                                 |
         v                                 v
   codex-bridge                  browser-automations
   LLM / Codex                   Playwright / Chromium
                                           |
                                           +-- automation A
                                           +-- automation B
                                           +-- futurs modules
```

## Responsabilités

**n8n possède l'orchestration** :

- schedules et déclenchements ;
- retries et gestion d'erreurs ;
- conditions et branchements ;
- validations humaines ;
- notifications ;
- appels vers les workers.

**browser-automations possède uniquement l'exécution navigateur** :

- Playwright / Chromium ;
- logique DOM propre aux sites ;
- sessions navigateur persistantes ;
- verrouillage des exécutions concurrentes.

Il n'y a donc **ni cron, ni notification métier, ni seconde instance n8n** dans ce service.

## Réseau

Le worker et n8n rejoignent tous les deux le réseau Docker externe privé `automation`.

Le worker n'expose aucun port sur l'hôte. Il est joignable uniquement par les autres services du réseau :

```text
http://browser-automations:3000
```

## Authentification interne

Le worker exige un Bearer token.

La même valeur doit être configurée à deux endroits :

1. secret GitHub Actions `AUTOMATION_API_TOKEN` de `dokor/raspberry-infra`, utilisé au déploiement du worker ;
2. variable `AUTOMATION_API_TOKEN` dans `infra/n8n/.env`, utilisée par les workflows n8n.

Générer par exemple une valeur avec :

```bash
openssl rand -hex 32
```

## Déploiement

Le workflow `Deploy shared browser automations` se déclenche après merge sur `main` lorsqu'un fichier de `infra/automations/` change. Il peut aussi être lancé manuellement.

Il :

1. vérifie/crée le réseau `automation` ;
2. s'authentifie à GHCR ;
3. récupère `ghcr.io/dokor/browser-automations:latest` ;
4. redémarre uniquement le worker.

L'image `ghcr.io/dokor/browser-automations:latest` doit être publiée avant le premier déploiement de cette stack. L'infrastructure ne dépend pas de l'identité d'un module métier particulier.

## Sessions navigateur

Les sessions sont persistées dans le volume Docker `browser-automation-data`.

La création et l'installation d'une session spécifique à un site sont documentées avec le module concerné, pas dans ce repository d'infrastructure.

## Appel depuis n8n

Le contrat générique est :

```http
POST http://browser-automations:3000/run/<automation-id>
Authorization: Bearer <AUTOMATION_API_TOKEN>
```

n8n traite ensuite le résultat, les retries et les notifications.

## Ajouter une automatisation

Une nouvelle automatisation navigateur ne doit pas créer un nouveau compose ou un nouveau cron.

Le flux cible est :

1. ajouter un module au worker partagé ;
2. publier la nouvelle image `browser-automations` ;
3. ajouter/versionner le workflow n8n correspondant dans le repository métier ;
4. laisser n8n planifier et orchestrer l'appel.

Les paramètres et procédures propres à un site restent avec son module et ne remontent pas dans `raspberry-infra`.
