# Shared browser automations

Ce dossier déploie le **worker Playwright partagé** de la plateforme d'automatisation du homelab.

Il complète l'instance n8n centrale de `../n8n` :

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
                                           +-- hellcase.daily
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
- verrouillage d'une même automatisation pour éviter les exécutions concurrentes.

Il n'y a donc **ni cron, ni notification métier, ni seconde instance n8n** dans ce service.

## Réseau

Le worker et n8n rejoignent tous les deux le réseau Docker externe privé `automation`.

Le worker n'expose aucun port sur l'hôte. Il est joignable uniquement par les autres services du réseau :

```text
http://browser-automations:3000
```

La stack n8n centrale est apportée par les PR parentes de cette PR stackée ; aucune modification manuelle d'un ancien compose n8n n'est nécessaire.

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

## Session navigateur

Les sessions sont persistées dans le volume Docker `browser-automation-data`.

Pour Hellcase, créer d'abord `hellcase-session.json` depuis une machine avec interface graphique, puis copier le fichier une seule fois :

```bash
docker cp /tmp/hellcase-session.json browser-automations:/app/data/hellcase-session.json
rm /tmp/hellcase-session.json
```

## Appel depuis n8n

Exemple :

```http
POST http://browser-automations:3000/run/hellcase.daily
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

## Dépendance applicative

L'image est produite par `dokor/hellcase-daily#3`, qui transforme le projet historique Hellcase en worker générique multi-automatisations.

Cette PR d'infrastructure ne doit être déployée qu'après publication réussie de :

```text
ghcr.io/dokor/browser-automations:latest
```
