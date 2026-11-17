# Central n8n

Cette stack est l'unique instance n8n du Raspberry.

Les workflows métier restent versionnés dans leurs repositories respectifs. n8n fournit le runtime central et orchestre les services internes via le réseau Docker `automation`.

## Architecture

```text
                         n8n
                          |
                  network: automation
          ________________|________________
         |                                 |
         v                                 v
   codex-bridge                  browser-automations
   Codex / LLM                   Playwright / Chromium
                                           |
                                           +-- modules métier
```

Les services spécifiques à un projet peuvent également rejoindre `automation`.

## Configuration persistante

La configuration de production ne doit pas vivre dans le checkout GitHub Actions.

Chemin utilisé par défaut :

```text
/srv/infra/raspberry-infra/env/n8n.env
```

Préparation :

```bash
sudo mkdir -p /srv/infra/raspberry-infra/env
sudo cp infra/n8n/.env.example /srv/infra/raspberry-infra/env/n8n.env
sudo chmod 600 /srv/infra/raspberry-infra/env/n8n.env
```

Le chemin peut être remplacé avec la variable GitHub Actions `N8N_ENV_FILE`.

## Version n8n

`N8N_IMAGE` est obligatoire et ne possède plus de fallback `:latest`.

Avant le premier déploiement, relever la version actuellement utilisée/validée puis renseigner par exemple :

```text
N8N_IMAGE=n8nio/n8n:X.Y.Z
```

Une montée de version doit être explicite.

## Migration des données existantes

La valeur par défaut de `N8N_DATA_VOLUME` reste :

```text
prospection-auto_n8n_data
```

uniquement afin de faciliter la migration depuis l'ancienne instance.

La valeur de `N8N_ENCRYPTION_KEY` doit être strictement identique à celle de cette instance, sinon les credentials existants ne pourront pas être déchiffrés.

Ne jamais lancer deux instances n8n simultanément sur le même volume et ne jamais utiliser `docker compose down -v` pendant la migration.

## Réseau / exposition

n8n rejoint `automation`.

Par défaut :

```text
N8N_BIND_ADDRESS=127.0.0.1
```

Donc le port 5678 n'est pas exposé sur toutes les interfaces du Raspberry.

Si l'éditeur ou les webhooks doivent être accessibles à distance, configurer explicitement Traefik et les valeurs `N8N_HOST`, `N8N_PROTOCOL`, `N8N_EDITOR_BASE_URL` et `WEBHOOK_URL`.

## Codex

`codex-bridge` est construit depuis :

```text
ghcr.io/dokor/codex-runtime:0.156.1-r1
```

n8n l'appelle uniquement sur le réseau interne :

```text
POST http://codex-bridge:3010/run
Authorization: Bearer <CODEX_BRIDGE_TOKEN>
```

L'authentification Codex persiste dans le volume `codex_home`.

Première authentification :

```bash
docker compose --env-file /srv/infra/raspberry-infra/env/n8n.env build codex-bridge
docker compose --env-file /srv/infra/raspberry-infra/env/n8n.env run --rm --entrypoint codex codex-bridge login
docker compose --env-file /srv/infra/raspberry-infra/env/n8n.env run --rm --entrypoint codex codex-bridge login status
```

## Browser automations

Le worker Playwright est générique.

Variables côté n8n :

```text
BROWSER_AUTOMATIONS_URL=http://browser-automations:3000
AUTOMATION_API_TOKEN=<token partagé>
```

Contrat :

```text
POST {{$env.BROWSER_AUTOMATIONS_URL}}/run/<automation-id>
Authorization: Bearer {{$env.AUTOMATION_API_TOKEN}}
```

Les noms de sites, paramètres et procédures de session restent dans les modules métier.

## Compatibilité prospection

Les variables `SEARXNG_BASE_URL`, `LINKEDIN_WORKER_URL`, `ARGOS_BASE_URL`, `N8N_REVIEW_FORM_URL` et `DRY_RUN` sont conservées temporairement pour faciliter la migration de l'ancien stack `prospection-auto`.

Elles pourront être retirées de l'infra centrale quand ces dépendances seront entièrement modularisées.

## Déploiement

Le workflow **Deploy central n8n** reste manuel, limité à `main`, et applique
`docker-compose.yml` avec `compose.secure.yml`. Voir les prérequis dans
[SECURE-ACCESS.md](SECURE-ACCESS.md) avant son lancement.

Il :

1. vérifie le projet, le volume et les secrets de l'instance existante ;
2. refuse un changement de version implicite et un stockage non pris en charge ;
3. prépare les fichiers persistants et le secret du runner sans les publier ;
4. sauvegarde les données SQLite à l'arrêt sur le Raspberry ;
5. recrée uniquement n8n et ses runners, puis vérifie leur démarrage ;
6. ouvre l'éditeur HTTPS seulement si `expose_editor` a été coché et contrôle les accès.

Les secrets, snapshots et métadonnées de récupération restent privés sur le
Raspberry. Aucun diagnostic distant ni activation de workflow métier n'est ajouté.
Codex bridge doit déjà être installé ; ce déploiement ne le reconstruit pas.
# Accès extérieur protégé

Pour `n8n.lelouet.fr`, suivre [SECURE-ACCESS.md](SECURE-ACCESS.md). L'overlay
`compose.secure.yml` prépare HTTPS, le MFA natif n8n et le durcissement ;
il ne doit être appliqué qu'après sauvegarde, inventaire et recette de migration.
