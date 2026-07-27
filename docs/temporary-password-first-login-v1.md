# Première connexion et mot de passe temporaire V1

## Objectif

Permettre aux responsables autorisés d’activer rapidement un collaborateur avec un mot de passe temporaire, tout en imposant la création d’un mot de passe personnel lors de la première connexion.

## Parcours

1. Le propriétaire, l’administrateur ou les RH ouvre **Membres & affectations**.
2. Dans une invitation, il choisit **Activer avec un mot de passe temporaire**.
3. Super Leader crée ou confirme le compte et génère un secret aléatoire.
4. Les instructions peuvent être envoyées immédiatement par email avec Resend.
5. Le collaborateur se connecte avec son email et le mot de passe temporaire.
6. Tous les autres écrans sont bloqués jusqu’à la création de son mot de passe personnel.
7. Après le changement, la session temporaire est fermée et le collaborateur se reconnecte normalement.

## Sécurité

- Le mot de passe temporaire n’est jamais stocké en clair dans la base.
- Il est affiché une seule fois à l’administrateur.
- Sa durée par défaut est de 48 heures, configurable de 1 à 168 heures.
- Les colonnes de sécurité du profil sont protégées contre les modifications par l’utilisateur.
- Les émissions, régénérations, envois, expirations et changements sont journalisés.
- La régénération d’un accès temporaire remplace immédiatement l’ancien mot de passe.

## Variables facultatives

```env
TEMPORARY_PASSWORD_EXPIRY_HOURS=48
TEMPORARY_ACCESS_FROM_EMAIL=notifications@ileadglobal.org
TEMPORARY_ACCESS_FROM_NAME=Super Leader
```

L’envoi email réutilise `RESEND_API_KEY`. Si l’adresse spécifique est vide, le système utilise `NOTIFICATION_FROM_EMAIL`, puis `FEEDBACK_FROM_EMAIL`.
