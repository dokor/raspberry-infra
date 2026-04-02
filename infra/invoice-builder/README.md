Service de facturation auto-hébergé basé sur :
https://github.com/piratuks/invoice-builder

---

## 🎯 Objectif

- Générer des factures simplement
- Hébergement local (LAN uniquement)
- Données persistées (PostgreSQL)
- Intégré dans l’infra Docker du Raspberry

---

## 🧱 Architecture

- 1 conteneur `invoice-builder` (frontend + backend)
- 1 conteneur `postgres`
- Réseau Docker isolé
- Pas d’exposition publique (pas de Traefik)


[ Navigateur LAN ]
↓
http://RASPBERRY:8086

↓
[ invoice-builder ]
↓
[ postgres ]


---

## 📁 Structure


infra/invoice-builder/
├── docker-compose.yml
├── .env
├── app/ # repo upstream cloné
└── data/ # stockage local (fallback SQLite + fichiers)


---

## ⚙️ Configuration

Créer un fichier `.env` :

```env
POSTGRES_DB=invoice_builder
POSTGRES_USER=invoice_builder
POSTGRES_PASSWORD=change-me
🚀 Installation
cd /srv/infra/raspberry-infra/infra/invoice-builder

# créer les dossiers
mkdir -p data

# récupérer le code
git clone https://github.com/piratuks/invoice-builder.git app

# build + lancement
docker compose up -d --build
🌐 Accès

Depuis le réseau local :

http://IP_DU_RASPBERRY:8086

Exemple :

http://192.168.1.50:8086
🗄️ Configuration PostgreSQL (dans l’app)

Lors du premier lancement, configurer la base :

Host: postgres
Port: 5432
Database: invoice_builder
Username: invoice_builder
Password: (valeur du .env)

⚠️ Le hostname postgres correspond au nom du service Docker.

🔐 Sécurité
Aucun accès externe (LAN uniquement)
PostgreSQL non exposé
Communication interne via réseau Docker

Option plus restrictive (local uniquement) :

ports:
  - "127.0.0.1:8086:3001"
🔄 Mise à jour
cd app
git pull

cd ..
docker compose up -d --build
💾 Sauvegardes

À sauvegarder :

volume PostgreSQL (postgres-data)
dossier data/

Exemple :

docker run --rm \
  -v invoice-builder_postgres-data:/volume \
  -v $(pwd):/backup \
  busybox tar czf /backup/postgres-backup.tar.gz /volume
🧪 Debug

Logs :

docker compose logs -f

Rebuild complet :

docker compose build --no-cache
docker compose up -d
⚠️ Notes
L’image Docker officielle ne supporte pas ARM → build local obligatoire sur Raspberry
VITE_API_URL inutile en Docker (proxy interne)
SQLite reste disponible mais PostgreSQL recommandé