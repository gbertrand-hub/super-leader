# Super Leader V2.5.1 - Catalogue public des plans

## Objectif

Afficher les offres Starter, Growth et Enterprise sur `/pricing`, avec un choix mensuel ou annuel, les limites de collaborateurs, les modules inclus et un appel a la demande de demonstration.

## Regles

- Seuls les plans `active`, `is_public = true` et `is_internal = false` sont lus depuis Supabase.
- Le plan interne `legacy_full_access` reste masque.
- Les tarifs de lancement sont provisoires et les paiements reels restent desactives.
- Le choix annuel affiche le prix annuel, son equivalent mensuel et l economie calculee.
- Growth est presente comme l offre recommandee.
- Si le catalogue Supabase est indisponible ou pas encore publie, la page affiche un catalogue provisoire integre afin de ne jamais rester vide.

## Tarifs provisoires publies

- Starter : 49 USD / mois ou 490 USD / an, jusqu a 25 collaborateurs.
- Growth : 99 USD / mois ou 990 USD / an, jusqu a 100 collaborateurs.
- Enterprise : sur devis, limites personnalisees.

Tous les montants et toutes les limites restent modifiables depuis l administration Super Leader.

## Installation

Executer `supabase/031_public_pricing_catalog_v2_5_1.sql` apres la migration V2.5, puis redemarrer l application.
