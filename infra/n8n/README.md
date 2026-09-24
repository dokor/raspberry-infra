# Central n8n

Cette stack devient l'unique instance n8n du Raspberry.

Les projets métier ne doivent plus embarquer leur propre n8n. Ils exposent leurs services sur le réseau Docker partagé `automation` et conservent leurs workflows versionnés dans leur propre repository.

## Architecture

```text
                    n8n
                     |
             network: automation
          ___________|________________________
         |                  |                 |
         v                  v                 v
prospection-auto       codex-bridge      browser-automations
  - searxng             - codex exec      - modules navigateur
  - linkedin-worker     - ChatGPT auth    - sessions persistantes
```

## Données existantes

La stack est volontairement configurée pour réutiliser par défaut le volume Docker créé par l'ancienne instance de `prospection-auto` :

```text
prospection-auto_n8n_data
```

Cela permet de conserver :

- workflows créés/importés dans l'interface ;
- credentials ;
- Data Tables ;
- historique/configuration n8n.

La variable `N8N_DATA_VOLUME` permet de changer ce nom si le volume réel sur le Raspberry diffère.

## Important : clé de chiffrement

La valeur de `N8N_ENCRYPTION_KEY` doit être **strictement identique** à celle utilisée par l'ancienne instance n8n.

Sinon les credentials déjà stockés dans le volume ne pourront plus être déchiffrés.

## Migration depuis prospection-auto

Ne lancez jamais l'ancienne et la nouvelle instance n8n en même temps sur le même volume.

1. Vérifier le volume actuel :

```bash
docker volume ls | grep n8n
docker volume inspect prospection-auto_n8n_data
```

2. Récupérer la valeur actuelle de `N8N_ENCRYPTION_KEY`.

3. Préparer la nouvelle configuration :

```bash
cd infra/n8n
cp .env.example .env
```

4. Arrêter uniquement l'ancien n8n :

```bash
cd /chemin/vers/prospection-auto
docker compose stop n8n
```

5. Créer le réseau partagé si nécessaire :

```bash
docker network inspect automation >/dev/null 2>&1 || docker network create automation
```

6. Démarrer l'instance centrale :

```bash
cd /chemin/vers/raspberry-infra/infra/n8n
docker compose up -d
```

7. Vérifier que les workflows, credentials et Data Tables sont présents.

8. Déployer ensuite la version de `prospection-auto` qui ne contient plus son propre service n8n.

Ne jamais utiliser `docker compose down -v` sur l'ancienne stack pendant la migration.

## Modules

L'instance centrale peut recevoir les variables nécessaires aux workflows de chaque module.

Pour l'instant, la compatibilité avec `prospection-auto` est conservée avec :

- `SEARXNG_BASE_URL`
- `LINKEDIN_WORKER_URL`
- `ARGOS_BASE_URL`
- `N8N_REVIEW_FORM_URL`
- `DRY_RUN`

Ces variables ne déploient pas les services associés : elles donnent seulement à n8n leurs adresses.

Les services eux-mêmes restent dans leur repository métier et rejoignent le réseau `automation`.

## AI / Codex

Le service `codex-bridge` fournit un point d'entrée commun aux workflows n8n qui ont besoin d'un LLM cloud.

Il hérite de l'image partagée `ghcr.io/dokor/codex-runtime:0.156.1-r1`, également prévue pour le worker ADE. Codex n'est donc plus réinstallé dans chaque projet : Docker peut réutiliser la même couche contenant le CLI sur le Raspberry, tout en gardant les processus et credentials séparés.

Le bridge exécute `codex exec` dans un conteneur séparé de n8n. L'authentification Codex est conservée dans le volume `codex_home`, tandis que n8n appelle uniquement l'API HTTP interne :

```text
POST http://codex-bridge:3010/run
Authorization: Bearer <CODEX_BRIDGE_TOKEN>
```

Préparer l'authentification une seule fois :

```bash
cd infra/n8n
docker pull ghcr.io/dokor/codex-runtime:0.156.1-r1
docker compose build codex-bridge
docker compose run --rm --entrypoint codex codex-bridge login
docker compose run --rm --entrypoint codex codex-bridge login status
```

Le bridge limite la concurrence à 1 par défaut pour protéger le quota Codex. Il accepte également un JSON Schema afin de produire une sortie structurée exploitable directement par n8n.

Voir `../codex-bridge/README.md` pour le contrat HTTP.

## Browser automations

Le worker Playwright partagé est un service générique de la même plateforme centrale. n8n reste propriétaire de l'orchestration : planning, retries, conditions, validation humaine et notifications. Le worker ne fait que l'exécution navigateur et la persistance des sessions.

Configurer dans `.env` :

```text
BROWSER_AUTOMATIONS_URL=http://browser-automations:3000
AUTOMATION_API_TOKEN=<même valeur que le secret GitHub Actions du worker>
```

Contrat d'appel :

```text
POST {{$env.BROWSER_AUTOMATIONS_URL}}/run/<automation-id>
Authorization: Bearer {{$env.AUTOMATION_API_TOKEN}}
```

Les noms, paramètres et procédures propres aux automatisations métier restent dans leurs repositories/modules respectifs.

Le service n'est pas exposé sur l'hôte : n8n le joint uniquement via le réseau Docker privé `automation`.

Voir `../automations/README.md` pour le contrat et l'ajout de nouveaux modules.

## Déploiement

Le workflow GitHub fourni est volontairement manuel afin de ne pas migrer automatiquement l'instance n8n existante lors du merge.

Une fois la migration préparée, lancer **Deploy central n8n** depuis GitHub Actions.
