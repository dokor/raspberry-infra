# 🏗️ Raspberry Infrastructure

Ce dépôt contient **l’infrastructure commune** de mon homelab sur Raspberry Pi 5.
Il ne contient pas les projets applicatifs (WordPress, Java, Next, etc.), mais uniquement les briques
qui servent de fondation :

- Reverse Proxy (Traefik / Nginx Proxy Manager)
- Bases de données partagées
- Réseaux Docker communs
- Services transverses d’infra

---

## 🎯 Objectif

Fournir une base stable pour :
- héberger plusieurs projets web
- gérer proprement les domaines et certificats
- centraliser les bases de données
- séparer proprement infra / apps

---

## 🧱 Architecture

```
/infra
  /proxy          -> reverse proxy principal (80/443)
  /databases      -> instance(s) DB partagées
  /secure-db      -> DB isolée pour projet critique (optionnel)
```
Les projets applicatifs tournent dans des dépôts séparés et utilisent l’infra via :
- réseaux Docker communs
- URLs exposées via proxy

---

## 🌐 Réseaux Docker

Deux types de réseaux :

### 🔹 Réseau proxy (commun)
Réseau Docker externe partagé pour tout ce qui doit être exposé publiquement :

`docker network create proxy`

Tous les services “web” s’y connectent + le reverse proxy.

### 🔹 Réseaux internes
Chaque projet gère ses réseaux internes indépendamment.
Dans ce repo : réseaux pour DB si besoin d’isolement.

---

## 🗄️ Bases de Données

### DB principale (mutualisée)
- 1 instance
- plusieurs bases (une par projet)
- utilisateurs séparés

### DB sécurisée (optionnelle)
- instance isolée
- réservée au projet critique
- réseau privé dédié

---

## 🚀 Déploiement

📌 via **GitHub Actions Self-Hosted Runner (Raspberry)**

Sur le Raspberry :

```
git clone https://github.com/....../raspberry-infra.git
cd raspberry-infra
cd infra/proxy && docker compose up -d
cd ../databases && docker compose up -d
```

---

## 🔐 Sécurité

- Aucun mot de passe dans le repo
- `.env` locaux uniquement
- DB Admin UI non publique
- HTTPS via Reverse Proxy

---

## 📦 CI/CD

- workflows GitHub
- runner `self-hosted` + `raspberry`

---

## ✅ Checklist avant production

- [ ] Docker installé
- [ ] Réseau `proxy` créé
- [ ] Runner GitHub opérationnel
- [ ] Certificats configurés
- [ ] `.env` présents (hors repo)
- [ ] Monitoring opérationnel

---

## 📜 Licence

Usage personnel.
