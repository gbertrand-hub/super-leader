# Super Leader V2.8 — Zoom Multi-Host & Department Routing

## Objectif

V2.8 permet à iLEAD Global d’utiliser plusieurs comptes Zoom rattachés au même compte principal. Chaque compte hôte peut être associé à un département ou pôle Super Leader, puis sélectionné lors de la création d’une réunion.

## Fonctions

- Synchronisation des utilisateurs Zoom actifs depuis l’application Server-to-Server OAuth.
- Registre des comptes Zoom hôtes dans Super Leader.
- Association d’un compte Zoom à un département ou pôle.
- Compte Zoom par défaut pour chaque département.
- Compte Zoom général par défaut pour l’organisation.
- Sélection du département et du compte hôte dans Performance → Réunions.
- Sélection du département et du compte hôte dans Événements → Planning.
- Détection des conflits horaires sur un même compte Zoom.
- Option permettant d’autoriser les réunions simultanées pour un compte qui le supporte.
- Enregistrement du compte hôte et du département sur chaque réunion.
- Journal d’audit pour la synchronisation et les changements de configuration.
- Correction du bouton « Démarrer comme hôte » afin que la redirection Next.js ne soit pas interceptée comme une erreur.

## Migration Supabase

Exécuter uniquement :

```text
supabase/036_zoom_multi_hosts_v2_8.sql
```

Résultat attendu :

```text
Success. No rows returned
```

## Autorisations Zoom

L’application Zoom Server-to-Server OAuth doit pouvoir :

- lire un utilisateur ;
- lister les utilisateurs du compte avec l’opération `GET /users` ;
- créer et lire les réunions des utilisateurs ;
- consulter les participants des réunions terminées.

Dans le Zoom App Marketplace, ajouter le scope associé à « List users » / « View all users ». Selon l’interface Zoom utilisée, le scope granulaire peut apparaître sous le nom `user:read:list_users:admin`.

## Première configuration

1. Ouvrir `Administration → Intégrations`.
2. Cliquer sur `Synchroniser les comptes Zoom`.
3. Pour chaque compte Zoom :
   - choisir le département ;
   - activer le compte ;
   - choisir, si nécessaire, le compte par défaut du département ;
   - choisir le compte général par défaut ;
   - autoriser ou non les réunions simultanées.
4. Enregistrer chaque compte.
5. Ouvrir `Performance → Réunions` et créer une réunion test.
6. Vérifier dans Zoom que la réunion apparaît sous le compte hôte sélectionné.

## Routage automatique

Quand un département est choisi, le formulaire sélectionne automatiquement :

1. le compte marqué « par défaut » pour ce département ;
2. sinon, le premier compte actif de ce département ;
3. sinon, le compte général par défaut de l’organisation.

## Contrôle des conflits

Par défaut, Super Leader refuse de créer deux réunions qui se chevauchent sur le même compte Zoom. Pour un compte Zoom disposant réellement de la capacité de réunions simultanées, activer l’option correspondante dans Intégrations.
