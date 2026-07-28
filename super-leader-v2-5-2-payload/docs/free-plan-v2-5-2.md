# Super Leader V2.5.2 — Plan Free et conversion vers Starter

## Objectif

Permettre aux très petites organisations de commencer avec Super Leader sans paiement, tout en conservant des limites claires et un parcours contrôlé d’activation.

## Plan Free

- Prix : 0 USD.
- Durée : sans limite de durée.
- Utilisateurs actifs : 5 maximum, propriétaire inclus.
- Carte bancaire : non requise.
- Activation : après vérification de la demande par l’équipe Super Leader.

## Fonctions incluses

- Feedback continu.
- Reconnaissance.
- Équipes et rôles.
- Performance et Employé du mois.
- Super Leader Academy.
- Plans de croissance.

## Fonctions non incluses

- CRM, ventes, commissions et recouvrement.
- Automatisation du feedback.
- Rapports avancés.
- Personnalisation de la marque.
- Intégrations API.
- Support prioritaire.

## Limite des utilisateurs

La limite de 5 utilisateurs actifs inclut le propriétaire. Les invitations en attente sont également prises en compte par l’action serveur avant une nouvelle invitation.

Lorsque la limite est atteinte :

- aucune donnée n’est supprimée ;
- l’organisation conserve l’accès à ses données ;
- l’ajout ou la réactivation d’un utilisateur supplémentaire est bloqué ;
- le propriétaire est invité à passer au plan Starter.

## Parcours public

1. Le visiteur choisit Free sur `/pricing`.
2. Il ouvre `/signup?plan=free`.
3. Le formulaire limite l’effectif déclaré à 1–5.
4. La demande est enregistrée avec `requested_plan_code = free`.
5. L’équipe Super Leader vérifie la demande dans Acquisition.
6. Le statut devient `Plan Free approuvé`.
7. La conversion crée l’organisation, le propriétaire et un abonnement Free actif.

## Conversion vers Starter

Pendant la phase sans paiements réels, le passage vers Starter reste manuel depuis l’administration des abonnements. Le propriétaire Free dispose d’un appel à l’action vers la page de comparaison des plans.

## Sécurité

- Le plan demandé est validé côté serveur.
- Une demande Free ne peut pas déclarer plus de 5 utilisateurs.
- L’activation échoue et annule la création de l’organisation si l’abonnement ne peut pas être créé.
- Les fonctionnalités sont contrôlées par les entitlements V2.5.
- La limite des membres est aussi protégée par le trigger Supabase existant.

## Migration

Exécuter après V2.5.1 :

`supabase/032_free_plan_v2_5_2.sql`
