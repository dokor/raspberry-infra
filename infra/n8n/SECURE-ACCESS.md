# Accès HTTPS personnel avec MFA — n8n.lelouet.fr

État : configuration proposée, **pas une attestation de sécurité du Raspberry**.
La fusion ne déploie rien : les workflows proxy et n8n sont manuels. L'éditeur
public reste désactivé tant que `N8N_INGRESS_ENABLED` n'est pas explicitement `true`.
Les campagnes ne sont ni publiées, ni exécutées, ni activées par cette procédure.

## Architecture

Internet → Traefik HTTPS → Authelia (mot de passe + TOTP, compte `antoine` seulement)
→ authentification native n8n. Il n'y a aucune route de contournement pour REST,
API, formulaires, webhooks, WebSocket ou retour OAuth. Une panne Authelia ferme l'accès.
Les callbacks Google sont des navigations du navigateur déjà authentifié ; aucun
endpoint ne sera ouvert sans MFA pour les faire fonctionner.

Le cookie de la passerelle porte seulement sur `n8n.lelouet.fr`, pas tout
`lelouet.fr`. Expiration 2 h, inactivité 15 min, pas de connexion permanente.
Pas d'inscription publique, de reset de mot de passe public ni de compte invité.
Les notifications d'enrôlement sont un fichier **privé sur le Raspberry** : pas de
SMTP/Gmail requis. Il faut lire le lien d'enrôlement par une session administrateur
locale/SSH, jamais dans un log CI ou dans le chat. La perte du téléphone se traite
par cette même voie privée ; conserver une sauvegarde du second facteur hors ligne.

Traefik ne monte plus le socket Docker ; un proxy d'API en lecture seule, sur son
réseau dédié, lui donne les métadonnées nécessaires. Le dashboard public est retiré.
Attention : les métadonnées Docker peuvent contenir des secrets ; seuls Traefik et
ce proxy d'API doivent être membres du réseau `docker_api`. Portainer conserve son
ancien montage et n'est pas recréé par le workflow : vérifier son exposition réelle
sur l'hôte avant l'ouverture de n8n. Il ne doit pas être accessible depuis Internet.

## Conditions avant déploiement

1. Vérifier l'OS, Docker/Compose (>= 2.24.4), l'heure/NTP, l'espace disque, la
   version n8n installée et les avis de sécurité de toutes les images. Versions
   proposées le 17/11/2026 : n8n/runners 2.47.7, Authelia 4.39.28, Traefik 3.7.19,
   socket-proxy 0.5.0. Ne pas rétrograder une instance plus récente. Tester toute
   migration de base sur une **copie**, surtout depuis n8n 1.x.
2. Relever le projet Compose, le volume n8n et la clé de chiffrement existants.
   Conserver exactement cette clé et ce volume. Ne pas afficher le contenu du `.env`,
   le résultat complet de `docker inspect` ni `docker compose config` dans les logs.
3. Sauvegarder la base/volume n8n à l'arrêt, la clé de chiffrement et les fichiers
   d'environnement ; chiffrer la copie hors machine. Restaurer la sauvegarde dans
   un environnement isolé sans réseau sortant pour prouver sa validité.
4. Inventorier tous les workflows actifs, leurs déclencheurs et leurs dépendances.
   **Bloquant :** migrer les lectures `$env` vers des credentials/paramètres explicites,
   et les anciens Function/FunctionItem vers Code. Recetter les appels internes.
   Ne pas réautoriser globalement l'accès aux variables pour contourner un échec.
   L'overlay autorise les requêtes internes uniquement vers `codex-bridge`,
   `browser-automations`, `searxng`, `linkedin-worker` ; ne pas ajouter une plage LAN.
5. Vérifier les règles effectives NAT, IPv4 **et IPv6**, pare-feu hôte et chaînes
   Docker : UFW seul ne garantit pas le filtrage des ports publiés par Docker.
   Aucun transfert public de 5678, 5679, 9091, 2375, 9000/9443 ou SSH. Désactiver les
   ouvertures UPnP non nécessaires. Seuls 443 et 80 pour HTTP-01/redirect vont vers
   Traefik. Contrôler aussi les autres services de ce Raspberry partagé.
6. Pour réduire le risque de déplacement vers le LAN en cas de faille, vérifier
   les règles de sortie Docker/pare-feu et, idéalement, placer le serveur en VLAN
   séparé. La protection SSRF est une couche applicative, pas un pare-feu réseau.
   Ce dépôt ne change pas aveuglément les règles du routeur ou le LAN existant.

## Préparation OVH et secrets

Créer `n8n.lelouet.fr` et `auth.n8n.lelouet.fr` vers l'IP publique (A, et AAAA seulement
si IPv6 est également filtré/testé). Aucun wildcard nécessaire. Vérifier les CAA
existants et l'accès Let's Encrypt HTTP-01. Aucun token OVH n'est nécessaire ici.

Installer les fichiers de cette PR dans le dossier stable
`/srv/infra/raspberry-infra/n8n`, en conservant la structure `authelia/`.
Ne pas monter les fichiers d'un checkout GitHub Actions éphémère.

Préparer `/srv/infra/raspberry-infra/env/n8n-security` hors Git, mode 700 :

- `session_secret`, `storage_key`, `runner_token` : trois valeurs aléatoires distinctes
  de 32 octets au minimum, créées sur le Raspberry et jamais imprimées. Le token
  runner doit être lisible par UID 1000 et 65532 via ses montages de fichier (mode
  444 dans le répertoire parent 700 convient) ; les deux secrets Authelia sont
  lisibles par UID 1000 seulement. Docker Compose local monte les fichiers de
  secrets, il ne chiffre pas ceux-ci sur disque et n'applique pas `uid/gid` dessus.
- `users.yml` : copie de `authelia/users.example.yml`, avec le seul compte `antoine`
  et un hash Argon2id de son mot de passe unique. Générer ce hash avec
  `docker run --rm -it authelia/authelia:4.39.28 authelia crypto hash generate argon2`
  (saisie interactive, pas de mot de passe dans une ligne de commande).
- `authelia-data/` : dossier mode 700, UID/GID 1000, base SQLite et notifications.
  Sauvegarder ce dossier avec la clé `storage_key` pour conserver les facteurs MFA.

Ajouter au `.env` n8n privé existant, sans le remplacer :

```dotenv
N8N_SECURITY_DIR=/srv/infra/raspberry-infra/env/n8n-security
N8N_INGRESS_ENABLED=false
```

## Bascule contrôlée

Après approbation du déploiement et validation des conditions ci-dessus :

1. Déployer le proxy via **Deploy infra proxy (Traefik)** sur `main`. Cette opération
   crée le réseau interne `n8n_ingress`, conserve ACME, démarre le proxy Docker puis
   recrée Traefik. Vérifier les sites existants et les certificats après sa courte
   interruption. Le dashboard HTTP précédemment publié disparaît volontairement.
2. Sur le Raspberry, utiliser **le nom de projet Compose existant** (à relever),
   le `.env` existant et les deux fichiers, dans cet ordre :

   ```sh
   cd /srv/infra/raspberry-infra/n8n
   # Renseigner PROJECT avec le nom relevé, sans inventer un nouveau projet.
   export N8N_ENV_FILE=/srv/infra/raspberry-infra/env/n8n.env
   docker compose -p "$PROJECT" --env-file "$N8N_ENV_FILE" \
     -f docker-compose.yml -f compose.secure.yml config --quiet
   docker compose -p "$PROJECT" --env-file "$N8N_ENV_FILE" \
     -f docker-compose.yml -f compose.secure.yml pull n8n task-runners authelia
   docker compose -p "$PROJECT" --env-file "$N8N_ENV_FILE" \
     -f docker-compose.yml -f compose.secure.yml run --rm --no-deps authelia authelia config validate
   ```

3. Après sauvegarde à l'arrêt et répétition sur la copie isolée, installer
   `secure-installed` dans ce dossier stable **avant** le redémarrage. Ce marqueur
   empêche l'ancien workflow n8n de réinstaller sa configuration sans protection.
   Démarrer seulement `n8n authelia task-runners` avec les mêmes options Compose,
   `up -d --wait`. Ne pas utiliser `down -v` ni `--remove-orphans` sur la production.
   Vérifier la santé, l'enregistrement des runners, le maintien des workflows
   inactifs et l'absence d'écoute LAN sur 5678. Le sync GitHub via loopback reste
   utilisable : l'API publique n8n n'est pas désactivée globalement.
4. Sur `https://auth.n8n.lelouet.fr`, Antoine choisit son TOTP et termine l'enrôlement
   par le lien du fichier privé. Vérifier le certificat et conserver le secours.
5. Passer `N8N_INGRESS_ENABLED=true` uniquement après ces contrôles. Recréer le service
   n8n avec les deux fichiers Compose, puis effectuer immédiatement la recette
   suivante. Si un contrôle d'accès échoue, repasser à `false` et recréer n8n.

## Recette obligatoire avant OAuth et avant toute campagne

- Depuis un réseau extérieur (ex. mobile), certificat valide pour les deux noms,
  HTTP redirigé, port 5678 fermé, aucun dashboard/Portainer accessible.
- Navigation privée : éditeur, `/rest/settings`, `/api/v1/workflows`, webhooks,
  formulaires et callback OAuth inaccessibles sans MFA. En-têtes d'identité forgés,
  faux `X-Forwarded-*`, accès par IP/Host inconnu : aucune autorisation supplémentaire.
- Mot de passe correct seul insuffisant ; MFA correct + compte n8n existant donne
  accès. Compte autre qu'Antoine refusé. Vérifier le WebSocket de l'éditeur.
- Tester déconnexion, expiration, code TOTP erroné, limitation des échecs, arrêt
  d'Authelia (accès fermé), redémarrage du Raspberry et reprise des services.
- Exécuter `n8n audit` en privé, examiner les résultats, la portée des credentials,
  la liste des utilisateurs n8n et l'accès aux fichiers/env/nodes interdits.
- Recetter les workflows utiles avec données fictives et dry-run ; aucune activation,
  aucun email réel. L'exécution de code doit passer par le runner externe.
- Vérifier sauvegarde chiffrée, restauration, renouvellement TLS, synchronisation
  horaire, espace disque et journal des échecs. Appliquer les mises à jour de sécurité
  après validation et sauvegarde ; ne pas utiliser des mises à jour `latest` aveugles.

La CI utilise de vrais conteneurs et des données synthétiques pour TLS, MFA et
refus d'accès. Elle ne prouve ni la sécurité du routeur/OS, ni la migration de la
base existante, ni la compatibilité de tous les workflows métier.

Le retour OAuth Google sera ensuite
`https://n8n.lelouet.fr/rest/oauth2-credential/callback`, en conservant la session
Authelia **et** la session n8n. Aucune exception MFA ni `N8N_SKIP_AUTH_ON_OAUTH_CALLBACK`.

## Retour arrière

Fermer d'abord la route (`N8N_INGRESS_ENABLED=false`, recréer n8n avec l'overlay).
Conserver la restriction loopback même lors d'un retour applicatif. Une image
ancienne ne doit pas ouvrir une base déjà migrée : restaurer le snapshot cohérent
avec son image et sa clé dans un volume contrôlé. Garder le marqueur anti-régression.
Ne pas remettre le dashboard HTTP, ni un accès socket direct au proxy. La suppression
de la protection nécessite une opération d'administration explicite.

## Références

- [Authelia avec Traefik](https://www.authelia.com/integration/proxies/traefik/)
- [Politiques Authelia](https://www.authelia.com/configuration/security/access-control/)
- [Isolation des runners n8n](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/harden-task-runners.md)
- [Protection SSRF n8n](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/enable-ssrf-protection.md)
- [Docker et filtrage des paquets](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
