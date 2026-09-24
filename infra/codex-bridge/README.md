# Codex bridge

Petit service HTTP interne permettant à n8n d'appeler Codex sans exposer une clé API OpenAI générique.

Le bridge lance `codex exec` dans un conteneur isolé, conserve l'authentification Codex dans un volume Docker dédié et renvoie uniquement la réponse finale à n8n.

Le binaire Codex n'est pas installé dans cette image : elle hérite de `ghcr.io/dokor/codex-runtime:0.156.1-r1`, runtime commun également destiné au worker ADE.

## Endpoints

- `GET /health` : health check sans authentification.
- `GET /status` : vérifie `codex login status`.
- `POST /run` : exécute un prompt Codex.

`/status` et `/run` exigent :

```text
Authorization: Bearer <CODEX_BRIDGE_TOKEN>
```

Le service n'expose volontairement aucune route permettant d'exécuter une commande shell arbitraire.

## Authentification Codex

Depuis `infra/n8n` :

```bash
docker compose build codex-bridge
docker compose run --rm --entrypoint codex codex-bridge login
docker compose run --rm --entrypoint codex codex-bridge login status
```

Suivre ensuite les instructions affichées par Codex pour connecter le compte ChatGPT/Codex.

Les credentials sont conservés dans le volume `codex_home` et ne sont jamais commités.

## Exemple n8n

```http
POST http://codex-bridge:3010/run
Authorization: Bearer {{$env.CODEX_BRIDGE_TOKEN}}
Content-Type: application/json
```

Corps minimal :

```json
{
  "prompt": "Résume ce texte en trois points."
}
```

Pour une sortie structurée, ajouter un JSON Schema :

```json
{
  "prompt": "Classe ce prospect.",
  "schema": {
    "type": "object",
    "properties": {
      "score": { "type": "integer" },
      "reason": { "type": "string" }
    },
    "required": ["score", "reason"],
    "additionalProperties": false
  }
}
```

La réponse contient alors `structuredOutput`.

## Limites

- concurrence à 1 par défaut afin d'éviter de consommer le quota Codex trop vite ;
- timeout à 180 secondes par défaut ;
- service accessible uniquement sur le réseau Docker `automation` ;
- le workspace Codex du bridge est isolé et ne monte aucun repository applicatif.
