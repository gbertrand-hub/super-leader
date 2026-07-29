# Super Leader V2.7 - Zoom API et présence automatique aux réunions

## Objectif

V2.7 relie les réunions Super Leader à Zoom afin de permettre la création d'une réunion depuis la plateforme, l'accès en un clic et la remontée automatique des présences, retards et durées de participation.

## Périmètre

- Configuration Zoom réservée au Owner et à l'Admin.
- Authentification Zoom Server-to-Server OAuth pour le compte Zoom de l'organisation.
- Création automatique d'une réunion Zoom depuis Performance > Réunions.
- Création automatique d'une réunion Zoom depuis le planning d'un événement.
- Bouton Rejoindre sur Zoom dans Performance, Ma journée et les événements.
- Bouton Démarrer comme hôte pour l'auteur ou un responsable autorisé.
- Webhooks Zoom pour les entrées et sorties des participants.
- Synchronisation manuelle du rapport final des participants après la réunion.
- Calcul de la durée totale, du retard et du pourcentage de présence.
- Mise à jour des statuts Invité, Présent, Retard et Absent.
- Journal technique des événements webhook et journal d'audit Super Leader.

## Règles de présence

- Le délai de grâce pour le retard est configurable par organisation.
- Le pourcentage minimum de présence est configurable par organisation.
- Plusieurs connexions du même participant sont additionnées.
- La durée reçue dans le rapport Zoom est convertie de secondes en minutes.
- Un participant invité sans présence retrouvée après la fin de la réunion est marqué absent.
- Un participant externe dont Zoom ne fournit pas l'adresse email reste non rapproché automatiquement. Une correction manuelle reste possible dans Super Leader.

## Sécurité

- Les identifiants Zoom sont enregistrés uniquement dans les variables d'environnement.
- Le lien hôte Zoom n'est pas affiché aux participants et n'est pas conservé durablement dans l'interface.
- Les webhooks sont validés avec la signature HMAC `x-zm-signature` et une fenêtre anti-rejeu de cinq minutes.
- Les événements webhook sont dédupliqués avant traitement.
- Les tables techniques Zoom sont accessibles uniquement avec le rôle serveur Supabase.
- Le Manager ne voit et ne gère que les réunions de son périmètre habituel.

## Configuration Zoom requise

Créer une application Zoom **Server-to-Server OAuth** dans Zoom App Marketplace, puis :

1. Activer l'application.
2. Ajouter les autorisations nécessaires pour :
   - lire un utilisateur Zoom ;
   - créer, lire et supprimer les réunions des utilisateurs du compte ;
   - lire les participants des réunions passées.
3. Activer les Event Subscriptions.
4. Déclarer l'URL :

```text
{NEXT_PUBLIC_SITE_URL}/api/zoom/webhook
```

5. Souscrire au minimum aux événements :
   - `meeting.started` ;
   - `meeting.ended` ;
   - `meeting.deleted` ;
   - `meeting.participant_joined` ;
   - `meeting.participant_left`.
6. Copier les identifiants et le secret du webhook dans les variables d'environnement.

## Variables d'environnement

```text
ZOOM_ACCOUNT_ID=
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=
```

En production, ajouter ces variables dans Vercel puis lancer un nouveau déploiement.

## Configuration dans Super Leader

Ouvrir :

```text
/dashboard/integrations
```

Puis renseigner :

- l'adresse email du compte Zoom hôte ;
- l'activation de Zoom pour l'organisation ;
- la création Zoom proposée par défaut ;
- la synchronisation automatique des présences ;
- le délai de grâce ;
- le pourcentage minimum de présence.

## Abonnement

V2.7 utilise la fonctionnalité d'abonnement `api_integrations`. Elle est prévue pour Enterprise et reste disponible pour l'organisation iLEAD Global grâce à son plan historique complet.

## Limites connues

- Le rapport final des participants Zoom peut ne pas être disponible immédiatement à la seconde où la réunion se termine. Le bouton Synchroniser la présence permet une nouvelle tentative.
- Certaines informations des participants externes peuvent être vides dans Zoom, notamment l'adresse email. Dans ce cas, Super Leader ne peut pas toujours rapprocher automatiquement le participant d'un collaborateur.
- La récupération des participants passés dépend du niveau de compte Zoom et des autorisations disponibles.
- Cette version ouvre Zoom dans son application ou dans le navigateur. L'intégration du Meeting SDK directement dans Super Leader reste une évolution ultérieure.
