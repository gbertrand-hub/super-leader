# Super Leader V2.5 - Plans, abonnements et contrôle des fonctionnalités

## Objectif

V2.5 prépare la commercialisation de Super Leader sans activer immédiatement les paiements réels. Elle permet de configurer les offres, attribuer des essais, contrôler les modules et tester la facturation manuelle.

## Plans fournis

- **Starter** : petite organisation, fonctions essentielles et limite provisoire de collaborateurs.
- **Growth** : Academy, croissance, CRM, automatisations et rapports avancés.
- **Enterprise** : fonctions complètes, personnalisation, intégrations et support prioritaire.
- **Accès complet historique** : plan interne non commercial qui préserve toutes les fonctions des organisations déjà existantes pendant la transition.

Les prix, devises, limites, périodes d’essai et fonctionnalités sont modifiables depuis `Abonnement & plans`.

## Statuts d’abonnement

- Brouillon
- Essai
- Actif
- Paiement en attente
- Annulation programmée
- Annulé
- Suspendu
- Expiré

Une annulation programmée conserve l’accès jusqu’à la fin de la période en cours.

## Contrôle des fonctionnalités

Les fonctionnalités sont définies par le plan :

- Feedback continu
- Reconnaissance
- Équipes et rôles
- Performance
- Super Leader Academy
- Plans de croissance
- CRM, ventes et recouvrement
- Automatisation du feedback
- Rapports avancés
- Personnalisation de la marque
- Intégrations API
- Support prioritaire

Les contrôles sont appliqués dans le menu, le tableau de bord, les pages et les principales actions serveur.

## Limite de collaborateurs

Le plan peut définir un nombre maximal de collaborateurs actifs. La limite est contrôlée :

- avant l’envoi d’une invitation ;
- lors de l’activation ou de la réactivation d’un compte ;
- au niveau de la base de données.

Les invitations en attente sont incluses dans le contrôle effectué par l’interface.

## Conversion d’un prospect

Lorsqu’une demande de démonstration est convertie en organisation cliente, Super Leader attribue automatiquement un essai Starter si V2.5 est activé.

## Coupons

La plateforme peut créer des coupons :

- pourcentage ou montant fixe ;
- plan spécifique ou tous les plans ;
- nombre maximal d’utilisations ;
- date d’expiration ;
- activation ou désactivation.

Les coupons sont préparés pour la future intégration du prestataire de paiement. Ils ne débitent aucun client en V2.5.

## Factures manuelles de test

Le platform Owner/Admin peut créer une facture de test, définir son montant, sa devise, son échéance et son statut. Les statuts disponibles sont : Draft, Open, Paid, Void et Uncollectible.

## Sécurité

- Le catalogue global est administré uniquement depuis l’organisation plateforme iLEAD Global.
- Une organisation cliente voit uniquement son propre abonnement et ses factures.
- Les actions globales nécessitent le rôle Owner ou Admin dans l’espace plateforme.
- Les tables sensibles sont gérées côté serveur avec `service_role`.
- Toutes les modifications importantes sont inscrites dans `subscription_events`.

## Mode test

Ajouter dans `.env.local` et Vercel :

```text
SUPER_LEADER_BILLING_MODE=test
SUPER_LEADER_BILLING_PROVIDER=manual
```

Aucun paiement bancaire réel n’est déclenché. Stripe ou un autre prestataire sera intégré dans une phase ultérieure après validation des tarifs, taxes, conditions et politiques commerciales.

## Migration

Exécuter uniquement :

```text
supabase/030_subscriptions_feature_control_v2_5.sql
```

Cette migration conserve l’accès complet des organisations existantes en leur attribuant le plan interne historique.
