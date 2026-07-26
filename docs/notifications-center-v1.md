# Super Leader — Centre de notifications, alertes et rappels automatiques V1

## Objectif

Centraliser dans Super Leader les événements opérationnels qui exigent une information, une validation ou une action. Les notifications sont créées immédiatement dans l’application par des déclencheurs Supabase. Les rappels liés au temps et les emails sont traités par une tâche planifiée Vercel.

## Modules couverts

- Rapports journaliers : échéance proche, rapport manquant, correction, validation, réouverture et expiration.
- Absences : nouvelle demande, approbation, refus et annulation.
- Réunions : invitation et rappel dans les 24 heures.
- Ventes : vente à vérifier, changement de statut et commission.
- Recouvrement : paiement à confirmer, paiement confirmé, échéance proche ou en retard.
- CRM : nouvelle tâche, tâche proche de l’échéance ou en retard.
- Feedback client : alerte immédiate pour une note de 1 ou 2 sur 5 et notification positive à partir de 4 sur 5.
- Performance : contestation de score et publication de l’Employé du mois.

## Interface

Adresse locale :

`http://localhost:3002/dashboard/notifications`

Adresse de production :

`https://app.ileadglobal.org/dashboard/notifications`

Filtres disponibles :

- Non lues
- Toutes
- Urgentes
- À traiter
- Préférences

Le menu affiche un badge rouge avec le nombre de notifications non lues.

## Migration Supabase

Exécuter dans Supabase SQL Editor :

`supabase/015_notifications_center.sql`

La migration crée :

- `notification_preferences`
- `notifications`
- `notification_audit_log`
- les fonctions de création sécurisée et de déduplication
- les déclencheurs reliés aux modules existants

Toutes les opérations applicatives passent par la clé serveur. Les tables sont protégées par RLS et ne sont pas directement accessibles aux utilisateurs authentifiés.

## Emails avec Resend

Variables recommandées dans `.env.local` et Vercel :

```env
RESEND_API_KEY=re_...
NOTIFICATION_FROM_EMAIL=notifications@ileadglobal.org
NOTIFICATION_FROM_NAME=Super Leader
```

Lorsque `NOTIFICATION_FROM_EMAIL` est absent, le système réutilise `FEEDBACK_FROM_EMAIL`.

Le domaine d’envoi doit être vérifié dans Resend avant l’utilisation de l’adresse `notifications@ileadglobal.org`.

## Automatisation Vercel

Le fichier `vercel.json` contient deux tâches quotidiennes :

- feedback omnicanal à 09:00 UTC ;
- notifications et rappels à 16:00 UTC.

La route ajoutée est :

`/api/cron/notifications`

Elle utilise la variable :

```env
CRON_SECRET=une-valeur-longue-et-secrete
```

Le traitement quotidien :

1. recherche les rapports proches de l’échéance ou manquants ;
2. prépare les rappels de réunions ;
3. détecte les échéances de recouvrement ;
4. détecte les tâches CRM proches ou en retard ;
5. envoie les emails en attente selon les préférences de chaque utilisateur.

## Test recommandé

1. Exécuter la migration 015.
2. Relancer `npm run dev`.
3. Ouvrir `/dashboard/notifications`.
4. Soumettre une demande d’absence depuis un compte employé.
5. Vérifier l’apparition immédiate chez le superviseur ou les RH.
6. Approuver ou refuser la demande.
7. Vérifier la notification reçue par l’employé.
8. Enregistrer une vente ou un paiement en attente.
9. Tester une note client de 2/5.
10. Ouvrir les préférences et désactiver une catégorie email.

## Points de gouvernance

- Les alertes importantes restent visibles dans l’application même si l’email est désactivé.
- Chaque lecture, archivage et changement de préférences est inscrit dans le journal d’audit.
- Une clé de déduplication empêche la création répétée de la même alerte.
- Les notifications archivées ne sont plus affichées dans les listes actives, mais restent conservées dans la base pour l’historique.
- Les SMS et WhatsApp pour les notifications internes ne sont pas activés dans cette V1. Ils pourront être ajoutés plus tard pour les alertes critiques.
