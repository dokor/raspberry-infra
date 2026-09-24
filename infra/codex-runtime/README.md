# Shared Codex runtime

Image Docker commune contenant Codex CLI et les dépendances système nécessaires aux usages du homelab.

Image publiée :

```text
ghcr.io/dokor/codex-runtime:0.156.1-r1
```

## Objectif

Éviter que chaque service réinstalle sa propre copie de Codex.

Les consommateurs héritent de la même couche Docker mais gardent leurs propres processus, credentials, `CODEX_HOME`, workspaces et politiques de sécurité.

```text
codex-runtime
├── codex-bridge
│   └── n8n
├── ADE worker
│   └── workspaces ADE isolés
└── Argos summary service
    └── génération de synthèse de rapport
```

Le partage concerne donc le runtime installé, pas un serveur Codex unique.

Docker peut dédupliquer les couches identiques présentes sur le Raspberry.

## Version

La version est volontairement épinglée à `0.156.1` avec la révision d'image `r1`.

Une montée de version doit produire un nouveau tag du runtime puis mettre à jour explicitement les consommateurs.

## Publication

Le workflow `Publish shared Codex runtime` :

- valide le build sur les pull requests ;
- publie les images ARM64 et AMD64 après merge sur `main` ;
- publie le tag versionné `0.156.1-r1` et un tag de commit ;
- ne partage aucun credential entre les consommateurs.

Si le package reste privé, chaque repository consommateur doit avoir un accès Actions en lecture au package.
