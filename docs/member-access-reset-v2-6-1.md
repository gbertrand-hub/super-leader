# Super Leader V2.6.1 - Reinitialisation d acces depuis la fiche membre

## Objectif

Permettre au Proprietaire, a l Administrateur et aux RH de restaurer l acces d un collaborateur actif directement depuis `Membres & affectations`, y compris lorsqu il a ete cree depuis une demande d acces interne et ne possede plus d invitation visible.

## Options disponibles

### Lien securise

- Genere un lien personnel de recuperation Supabase.
- Peut etre envoye immediatement par email avec Resend.
- Le lien reste visible une seule fois dans l interface afin de pouvoir etre copie manuellement.
- Le collaborateur choisit son nouveau mot de passe.

### Mot de passe temporaire

- Remplace immediatement le mot de passe actuel.
- Expire selon `TEMPORARY_PASSWORD_EXPIRY_HOURS`, avec 48 heures par defaut.
- Impose le changement du mot de passe a la prochaine connexion.
- Peut etre envoye immediatement par email avec Resend.
- Le secret n est jamais stocke en clair et n est affiche qu apres sa generation.

## Permissions

- Autorise : Owner, Admin, RH.
- Non autorise : Manager, Employee.
- Le compte Owner est protege.
- Un administrateur ne peut pas utiliser ce controle pour son propre compte.
- Un membre desactive doit etre reactive avant la reinitialisation.

## Audit

Les operations utilisent `temporary_access_audit_log` :

- generation du lien ou du mot de passe temporaire ;
- envoi ou echec de l email ;
- changement final du mot de passe.

## Email

Les emails utilisent les variables existantes :

- `RESEND_API_KEY`
- `TEMPORARY_ACCESS_FROM_EMAIL` ou `NOTIFICATION_FROM_EMAIL`
- `TEMPORARY_ACCESS_FROM_NAME` ou `NOTIFICATION_FROM_NAME`

Aucune migration SQL supplementaire n est necessaire.
