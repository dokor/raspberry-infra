# Accès HTTPS avec MFA natif n8n — n8n.lelouet.fr

État : configuration proposée, **pas une attestation de sécurité du Raspberry**.
La fusion ne déploie rien : les workflows proxy et n8n sont manuels. L'éditeur
public reste désactivé tant que `N8N_INGRESS_ENABLED` n'est pas explicitement `true`.
Les campagnes ne sont ni publiées, ni exécutées, ni activées par cette procédure.

## Architecture

Internet → Traefik HTTPS → connexion native n8n (mot de passe + TOTP).
Une seule adresse, un seul compte de connexion, aucun service d'authentification
supplémentaire. La page de connexion et les paramètres publics nécessaires à
l'éditeur sont accessibles sans session ; les données privées restent protégées
par n8n. Les faux en-têtes d'identité ne remplacent pas une session authentifiée.

**Avant ouverture : activer le MFA sur le compte existant d'Antoine et tester une
nouvelle connexion.** `N8N_MFA_ENABLED=true` rend le MFA disponible ; cette variable
ne l'active pas automatiquement sur un compte et n'impose pas la politique MFA à
tous les utilisateurs. Cette politique globale est une fonctionnalité sous licence,
dont cette configuration ne dépend pas. Le compte doit rester protégé par MFA.
Vérifier la liste des utilisateurs et invitations : s'il reste d'autres comptes
autorisés, traiter leurs accès avant l'ouverture, sans supprimer aveuglément leurs
projets ou données. La configuration native n'est pas une liste d'emails autorisés.

Le proxy refuse intégralement depuis Internet `/api`, les webhooks, formulaires,
MCP, métriques et contrôles de santé, ainsi que la création initiale du propriétaire
et les invitations. Ces chemins renvoient 404, même avec une session n8n valide.
La synchronisation GitHub garde son API sur `127.0.0.1:5678`. Les formulaires de
revue et triggers externes restent donc fermés : toute future ouverture doit avoir
une authentification adaptée et une recette dédiée. Le MFA de la connexion n8n
ne protège pas automatiquement ces endpoints machine.

Traefik ne monte plus le socket Docker ; un proxy d'API en lecture seule, sur son
réseau dédié, lui donne les métadonnées nécessaires. Le dashboard public est retiré.
Attention : les métadonnées Docker peuvent contenir des secrets ; seuls Traefik et
ce proxy d'API doivent être membres du réseau `docker_api`. Portainer conserve son
ancien montage et n'est pas recréé par le workflow : vérifier son exposition réelle
sur l'hôte avant l'ouverture de n8n. Il ne doit pas être accessible depuis Internet.

## Conditions avant déploiement

1. Vérifier l'OS, Docker/Compose (>= 2.24.4), l'heure/NTP, l'espace disque, la
   version n8n installée et les avis de sécurité de toutes les images. Versions
   proposées le 17/11/2026 : n8n/runners 2.47.7, Traefik 3.7.19,
   socket-proxy LTS épinglé par digest multiarchitecture. Ne pas rétrograder une instance plus récente. Tester toute
   migration de base sur une **copie**, surtout depuis n8n 1.x.
2. Relever le projet Compose, le volume n8n et la clé de chiffrement existants.
   Conserver exactement cette clé et ce volume. Ne pas afficher le contenu du `.env`,
   le résultat complet de `docker inspect` ni `docker compose config` dans les logs.
3. Sauvegarder la base/volume n8n à l'arrêt, la clé de chiffrement et les fichiers
   d'environnement ; chiffrer la copie hors machine. Restaurer la sauvegarde dans
   un environnement isolé sans réseau sortant pour prouver sa validité.
4. Inventorier tous les workflows actifs, leurs déclencheurs et leurs dépendances.
   **Bloquant pour les workflows à conserver fonctionnels :** migrer les lectures
   `$env` vers des credentials/paramètres explicites,
   et les anciens Function/FunctionItem vers Code. Recetter les appels internes.
   Ne pas réautoriser globalement l'accès aux variables pour contourner un échec.
   L'overlay autorise les requêtes internes uniquement vers `codex-bridge`,
   `browser-automations`, `searxng`, `linkedin-worker` ; ne pas ajouter une plage LAN.
5. Vérifier les règles effectives NAT, IPv4 **et IPv6**, pare-feu hôte et chaînes
   Docker : UFW seul ne garantit pas le filtrage des ports publiés par Docker.
   Aucun transfert public de 5678, 5679, 2375, 9000/9443 ou SSH. Désactiver les
   ouvertures UPnP non nécessaires. Seuls 443 et 80 pour HTTP-01/redirect vont vers
   Traefik. Contrôler aussi les autres services de ce Raspberry partagé.
6. Pour réduire le risque de déplacement vers le LAN en cas de faille, vérifier
   les règles de sortie Docker/pare-feu et, idéalement, placer le serveur en VLAN
   séparé. La protection SSRF est une couche applicative, pas un pare-feu réseau.
   Ce dépôt ne change pas aveuglément les règles du routeur ou le LAN existant.

## Préparation OVH et secrets

Créer uniquement `n8n.lelouet.fr` vers l'IP publique (A, et AAAA seulement
si IPv6 est également filtré/testé). Aucun wildcard nécessaire. Vérifier les CAA
existants et l'accès Let's Encrypt HTTP-01. Aucun token OVH n'est nécessaire ici.

Installer les fichiers de cette PR dans le dossier stable
`/srv/infra/raspberry-infra/n8n`.
Ne pas monter les fichiers d'un checkout GitHub Actions éphémère.

Préparer `/srv/infra/raspberry-infra/env/n8n-security` hors Git, mode 700 :

- `runner_token` : valeur aléatoire de 32 octets au minimum, créée sur le Raspberry
  et jamais imprimée. Le fichier doit être lisible par UID 1000 et 65532 via ses
  montages (mode 444 dans le répertoire parent 700 convient). Docker Compose local
  monte le fichier, sans chiffrement sur disque ni application de `uid/gid`.
- Conserver la clé `N8N_ENCRYPTION_KEY` existante et sauvegarder la base n8n : le
  secret MFA et les credentials restent gérés par l'instance existante.

Sur l'instance privée actuelle, ouvrir **Settings → Profile & preferences**
(**Personal** selon la version), puis **Enable 2FA**. Scanner le QR code avec son
application d'authentification, confirmer le code et sauvegarder les codes de
récupération hors ligne. Ne communiquer ni QR code, ni secret, ni codes de secours.
Tester la déconnexion puis une connexion avec mot de passe et TOTP avant la bascule.

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
     -f docker-compose.yml -f compose.secure.yml pull n8n task-runners
   ```

3. Après sauvegarde à l'arrêt et répétition sur la copie isolée, installer
   `secure-installed` dans ce dossier stable **avant** le redémarrage. Ce marqueur
   empêche l'ancien workflow n8n de réinstaller sa configuration sans protection.
   Démarrer seulement `n8n task-runners` avec les mêmes options Compose,
   `up -d --wait`. Ne pas utiliser `down -v` ni `--remove-orphans` sur la production.
   Vérifier la santé, l'enregistrement des runners, le maintien des workflows
   inactifs et l'absence d'écoute LAN sur 5678. Le sync GitHub via loopback reste
   utilisable : l'API publique n8n n'est pas désactivée globalement.
4. Confirmer que l'instance et son compte MFA ont bien été conservés et qu'aucun
   écran de création du propriétaire n'est attendu. Si ce n'est pas le cas, garder
   la route fermée et corriger l'accès privé ; ne pas exposer l'assistant de création.
5. Passer `N8N_INGRESS_ENABLED=true` uniquement après ces contrôles. Recréer le service
   n8n avec les deux fichiers Compose, puis effectuer immédiatement la recette
   suivante. Si un contrôle d'accès échoue, repasser à `false` et recréer n8n.

## Recette obligatoire avant OAuth et avant toute campagne

- Depuis un réseau extérieur (ex. mobile), certificat valide pour `n8n.lelouet.fr`,
  HTTP redirigé, port 5678 fermé, aucun dashboard/Portainer accessible.
- Navigation privée : la connexion et `/rest/settings` sont publics ; les données
  `/rest/workflows`, `/rest/credentials`, `/rest/executions` restent inaccessibles.
  Les chemins API/webhooks/formulaires/MCP/santé sont bloqués par le proxy, avec ou
  sans session. En-têtes d'identité forgés, faux `X-Forwarded-*`, accès par IP/Host
  inconnu : aucune autorisation supplémentaire.
- Mot de passe correct seul insuffisant sur le compte MFA ; TOTP correct donne
  accès. Vérifier le WebSocket de l'éditeur et les cookies Secure/HttpOnly.
- Tester déconnexion, expiration, code TOTP erroné, limitation native des échecs,
  redémarrage du Raspberry et reprise des services. Vérifier les codes de secours
  et documenter la récupération privée sans désactiver globalement l'authentification.
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
n8n obtenue après MFA. Aucun `N8N_SKIP_AUTH_ON_OAUTH_CALLBACK=true`. L'OAuth Google
sera recetté ensuite ; il n'est pas connecté par cette préparation.

## Retour arrière

Fermer d'abord la route (`N8N_INGRESS_ENABLED=false`, recréer n8n avec l'overlay).
Conserver la restriction loopback même lors d'un retour applicatif. Une image
ancienne ne doit pas ouvrir une base déjà migrée : restaurer le snapshot cohérent
avec son image et sa clé dans un volume contrôlé. Garder le marqueur anti-régression.
Ne pas remettre le dashboard HTTP, ni un accès socket direct au proxy. La suppression
de la protection nécessite une opération d'administration explicite.

## Références

- [MFA natif n8n](https://docs.n8n.io/administer/manage-users-and-access/verify-user-identity/require-two-factor-auth.md)
- [Politiques globales et licences](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/manage-security-policies.md)
- [Isolation des runners n8n](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/harden-task-runners.md)
- [Protection SSRF n8n](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/enable-ssrf-protection.md)
- [Docker et filtrage des paquets](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
