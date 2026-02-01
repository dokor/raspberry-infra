📦 Guide de déploiement – Raspberry Homelab
# 🚀 Raspberry Deployment Guide
Guide de déploiement standard pour projets Docker sur Raspberry Pi  
(Stack : Docker · Traefik · GitHub Actions · Runner self-hosted)

---

## 🎯 Objectif

Ce guide décrit **UNE méthode unique et reproductible** pour déployer automatiquement sur un Raspberry Pi :

- des **WordPress + base de données**
- des **applications Next.js**
- des **backends Java**
- des **sites vitrines (HTML / Nginx)**

À la fin :
> **un push sur `main` = déploiement automatique en production**

---

## 🧱 Architecture globale

Internet
↓
Traefik (80 / 443)
↓
Docker services
├─ WordPress
├─ Next.js
├─ Java backend
├─ Sites vitrines
└─ Bases de données (MariaDB)

---

### Rôles
- **Traefik** : reverse proxy unique
- **Docker Compose** : orchestration locale
- **GitHub Actions (runner sur le Pi)** : déploiement automatique

---

## 📁 Organisation des dossiers sur le Raspberry
/srv/
├─ infra/
│ └─ raspberry-infra/
│ ├─ proxy/
│ ├─ databases/
│ └─ monitoring/
│
├─ apps/
│ ├─ wordpress-site/
│ ├─ nextjs-app/
│ ├─ java-backend/
│ └─ static-site/
│
└─ backups/

👉 **Chaque projet = un dossier + un docker-compose**

---

## 🌐 Réseaux Docker standards

- `proxy` → exposition publique via Traefik
- `<project>-net` → réseau interne (DB, cache, etc.)

Traefik est **le seul service** exposé sur :
- `80`
- `443`

---

## 🔁 Déploiement standard (commun à tous les projets)

### Principe clé
- Le Raspberry contient un **clone “prod”** du repo
- GitHub Actions :
  - se connecte au Raspberry
  - fait un `git pull`
  - lance `docker compose up -d --build`

⚠️ **Le runner ne déploie jamais depuis son workspace GitHub**

---

## 🧩 Workflow GitHub Actions (modèle universel)

À placer dans **tous les projets** :  
`.github/workflows/deploy.yml`


name: Deploy on Raspberry

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

jobs:
  deploy:
    runs-on:
      - self-hosted
      - raspberry

    steps:
      - name: Deploy from Raspberry
        run: |
          set -e
          cd /srv/apps/PROJECT_NAME
          git fetch --all
          git reset --hard origin/main
          docker compose up -d --build --remove-orphans
          
➡️ Remplacer PROJECT_NAME par le nom du dossier réel.
