# État ACME persistant et renouvellement TLS

Le checkout GitHub Actions ne doit pas porter le compte ACME, ses clés, ses
certificats ou le `.env` du proxy. `actions/checkout` peut supprimer les fichiers
non versionnés ; un montage de fichier peut continuer à désigner l'ancien inode
jusqu'à la recréation du conteneur. Cela rend les redémarrages et renouvellements
fragiles. L'ancien workflow créait même un `acme.json` vide s'il manquait.

Le déploiement utilise maintenant deux fichiers privés hors checkout :

- `TRAEFIK_ACME_FILE` : `/srv/infra/raspberry-infra/proxy/acme.json` ;
- `PROXY_ENV_FILE` : `/srv/infra/raspberry-infra/env/proxy.env`.

Ces chemins absolus peuvent être choisis dans les variables GitHub du dépôt.
Les fichiers restent en mode 600. Aucun contenu ACME ni environnement n'est
imprimé dans les logs ou téléversé en artefact.

Lors de la première migration, le script conserve le `.env` de l'ancien dossier
Compose déclaré par le conteneur `traefik`, puis copie le magasin encore monté
avec `docker cp traefik:/acme.json`. Il valide compte et certificats avant de
créer la copie persistante. Un magasin vide/invalide ou un environnement absent
arrête le déploiement ; il n'y a ni remise à zéro ni réémission aveugle. Un fichier
persistant existant reste prioritaire et n'est jamais remplacé par la copie ancienne.

Si l'ancien `.env` a déjà disparu, préparer le fichier `PROXY_ENV_FILE` privé avant
la fusion, avec les valeurs opérateur existantes, notamment `PORTAINER_PORT` et
`TRAEFIK_DASHBOARD_DOMAIN`. Ne pas inventer de valeurs de production à partir des
exemples. Cette procédure migre une installation existante avec un compte ACME ;
elle ne crée pas automatiquement une nouvelle autorité ni un compte vide.

Le checkout est isolé sous `proxy-source`. Le workflow recrée uniquement Traefik,
avec le nom de projet Compose existant ; Portainer et son montage de données
historique ne sont pas recréés. Une courte interruption du proxy est donc prévue
pendant l'application. Le magasin ancien reste disponible pour la sauvegarde ;
pour revenir à une image antérieure, conserver le nouveau montage persistant,
sans remettre un ancien magasin susceptible d'avoir été renouvelé depuis.

Traefik garde la durée ACME normale de 90 jours et sa fenêtre de renouvellement
de 30 jours. Son démarrage relance le contrôle des certificats éligibles. Un
certificat à 29 jours est une alerte réelle ; le changement de persistance ne
prouve pas à lui seul que l'autorité a accepté son renouvellement.

Pour obtenir cette preuve, configurer `PROXY_TLS_VERIFY_HOST` avec un nom DNS
public, ou renseigner `verify_host` au déclenchement manuel du workflow sur main.
Le contrôle attend au plus cinq minutes, vérifie chaîne TLS et SNI, puis exige
plus de 30 jours entiers restants. Il échoue si l'ancien certificat est encore
servi. Il ne modifie ni ACME ni les seuils de l'application.

En cas d'échec, consulter les logs ACME privés de Traefik, l'accès public au port
80 pour HTTP-01, les permissions du magasin et les limites de l'autorité.
Ne pas effacer `acme.json`, créer un compte concurrent ou désactiver la validation
TLS pour faire passer le contrôle. L'échec du contrôle ne restaure pas une copie
ancienne du magasin : un renouvellement réussi doit rester conservé.

Références : [configuration et fenêtre ACME de Traefik](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/tls/certificate-resolvers/acme/),
[contrôle de renouvellement au démarrage, Traefik v3.6.1](https://github.com/traefik/traefik/blob/v3.6.1/pkg/provider/acme/provider.go).
