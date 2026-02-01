# 🚀 DEPLOYMENT_GUIDE — Raspberry Homelab

## 1. Introduction

Ce guide décrit une méthode standardisée, reproductible et légère pour déployer des projets web
sur un Raspberry Pi à l’aide de Docker, Traefik et GitHub Actions (runner self-hosted).

Objectif principal :

> Un push sur la branche `main` déclenche automatiquement un déploiement en production.

Ce guide couvre :
- des sites vitrines (HTML / Nginx)
- des applications Next.js
- des backends Java
- des WordPress avec base de données

---

## 2. Déroulement général du déploiement

1. Le Raspberry héberge :
   - Docker
   - Traefik (reverse proxy)
   - un runner GitHub Actions self-hosted
2. Chaque projet dispose de :
   - son dépôt GitHub
   - son `docker-compose.yml`
3. Le Raspberry contient un clone “production” du dépôt dans `/srv/apps/<project>`
4. À chaque push sur `main` :
   - GitHub Actions déclenche le runner
   - le runner met à jour le dépôt (`git pull`)
   - le runner relance le projet avec Docker Compose

---

## 3. Organisation des dossiers sur le Raspberry

```
/srv/
├─ infra/
│  └─ raspberry-infra/
│     ├─ proxy/        (Traefik)
│     ├─ databases/    (MariaDB)
│     └─ monitoring/   (Grafana / Prometheus)
│
├─ apps/
│  ├─ wordpress-site/
│  ├─ nextjs-app/
│  ├─ java-backend/
│  └─ static-site/
│
└─ backups/
```

Chaque dossier dans `/srv/apps` correspond à un projet déployé.

---

## 4. Réseaux Docker

### Réseau `proxy`
- réseau Docker externe
- utilisé par Traefik
- utilisé par tous les services exposés publiquement

```bash
docker network create proxy
```

### Réseaux internes
- un réseau interne par projet (ex: `wp-net`, `java-net`)
- utilisé pour les bases de données et services internes
- non exposé publiquement

---

## 5. Workflow GitHub Actions standard

Fichier `.github/workflows/deploy.yml` :

```yaml
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
```

---

## 6. Exemples de projets

### 6.1 Site vitrine (HTML / Nginx)

**Dockerfile**
```dockerfile
FROM nginx:alpine
COPY public /usr/share/nginx/html
```

**docker-compose.yml**
```yaml
services:
  site:
    build: .
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.site.rule=Host(`site.example.com`)"
      - "traefik.http.services.site.loadbalancer.server.port=80"

networks:
  proxy:
    external: true
```

---

### 6.2 Application Next.js

**Dockerfile**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

**docker-compose.yml**
```yaml
services:
  nextjs:
    build: .
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.nextjs.rule=Host(`app.example.com`)"
      - "traefik.http.services.nextjs.loadbalancer.server.port=3000"

networks:
  proxy:
    external: true
```

---

### 6.3 Backend Java

**Dockerfile**
```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -DskipTests package assembly:single

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*-jar-with-dependencies.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
```

**docker-compose.yml**
```yaml
services:
  backend:
    build: .
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.example.com`)"
      - "traefik.http.services.api.loadbalancer.server.port=8080"

networks:
  proxy:
    external: true
```

---

### 6.4 WordPress + base de données

```yaml
services:
  wordpress:
    image: wordpress:php8.2-apache
    restart: unless-stopped
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_NAME: wp_site
      WORDPRESS_DB_USER: wp_user
      WORDPRESS_DB_PASSWORD: strongpassword
    networks:
      - proxy
      - wp-net
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.wp.rule=Host(`wp.example.com`)"
      - "traefik.http.services.wp.loadbalancer.server.port=80"

  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: wp_site
      MYSQL_USER: wp_user
      MYSQL_PASSWORD: strongpassword
      MYSQL_ROOT_PASSWORD: rootpassword
    volumes:
      - db_data:/var/lib/mysql
    networks:
      - wp-net

volumes:
  db_data:

networks:
  wp-net:
  proxy:
    external: true
```

---

## 7. Bonnes pratiques

- Ne pas versionner de fichiers `.env`
- Ne pas exposer de ports directement
- Traefik est l’unique point d’entrée HTTP/HTTPS
- Un projet = un `docker-compose.yml`
- Le runner déploie toujours depuis `/srv/apps`

---

## 8. Résultat

- Déploiement automatisé
- Infrastructure simple et robuste
- Adaptée au Raspberry Pi 5
- Facilement extensible

---
