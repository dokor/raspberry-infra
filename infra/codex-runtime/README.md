# Shared Codex runtime

Image Docker commune contenant Codex CLI et les dépendances système nécessaires aux usages du homelab.

Image publiée :

```text
ghcr.io/dokor/codex-runtime:0.156.1-r1
```

## Objectif

Éviter que chaque service réinstalle sa propre copie de Codex.

Les consommateurs gardent des conteneurs, credentials, workspaces et politiques de sécurité séparés, mais héritent de la même couche Docker contenant Codex :

```text
codex-runtime
├── codex-bridge  -> n8n / Argos / automations
└── ADE worker    -> workspaces ADE isolés
```

Docker peut ainsi dédupliquer les couches identiques présentes sur le Raspberry.

## Version

La version est volontairement épinglée à `0.156.1`.

Une montée de version doit créer une nouvelle révision/tag du runtime et être validée séparément avant de mettre à jour les consommateurs.

## Publication

Le workflow `Publish shared Codex runtime` :

- valide le build sur les pull requests ;
- publie les images ARM64 et AMD64 après merge sur `main` ;
- publie le tag versionné `0.156.1-r1` et un tag de commit ;
- ne force pas les consommateurs à partager le même `CODEX_HOME`.

Le partage concerne l'image/binaire, pas les credentials ni les processus.
