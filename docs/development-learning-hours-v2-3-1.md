# Super Leader V2.3.1 - Parcours de formation et heures de développement

## Objectif

Cette évolution relie les activités de formation du staff au Plan de croissance sans les confondre avec les heures supplémentaires ou la paie.

Les parcours suivis sont :

- École des Coachs ;
- École des Affaires ;
- École des Experts ;
- École des Éleveurs ;
- Lundi de la Vision ;
- lecture de livres ;
- autres formations autorisées.

Les activités peuvent avoir lieu le soir ou le week-end. Super Leader les comptabilise comme heures de développement et signale le temps réalisé hors des horaires habituels. Cette classification interne ne remplace pas les règles RH, contractuelles ou légales applicables.

## Compteurs du Plan de croissance

Le plan mensuel distingue désormais :

1. les heures d'impact et d'ajout de valeur ;
2. les heures de formation ;
3. les heures de lecture ;
4. les crédits de croissance cumulés ;
5. le temps de croissance réalisé le soir ou le week-end.

Chaque collaborateur peut recevoir un objectif mensuel spécifique pour les heures de formation et les heures de lecture. Owner, Admin et RH peuvent également définir les valeurs par défaut de l'organisation.

## Synchronisation avec Super Leader Academy

Lorsqu'une formation Academy est créée ou modifiée, elle peut être associée à un parcours de croissance.

Une présence marquée « Présent » ou « En retard » génère automatiquement une activité de développement validée. La durée réellement suivie est utilisée lorsqu'elle est disponible ; sinon, la durée prévue de la séance est retenue.

La synchronisation :

- ne crée pas de double comptage pour une même présence ;
- met à jour l'activité si la présence ou sa durée est corrigée ;
- supprime l'activité si la présence devient absente, excusée ou si l'enregistrement est supprimé ;
- ignore les séances annulées ;
- conserve le lien avec la formation, la séance et la feuille de présence d'origine.

## Déclaration manuelle

Le collaborateur utilise la déclaration manuelle lorsque :

- l'école ou la formation n'est pas encore gérée dans Academy ;
- il suit une formation externe autorisée ;
- il déclare la lecture d'un livre.

La déclaration contient :

- le parcours ;
- la date et les heures ;
- le passage éventuel à minuit ;
- le titre de la formation ou du livre ;
- l'auteur, pour un livre ;
- les principaux enseignements ;
- une action concrète à appliquer ;
- un lien de preuve éventuel.

Pour une lecture, les enseignements et l'action d'application sont obligatoires.

## Validation

Les activités provenant d'Academy sont validées automatiquement à partir de la feuille de présence.

Les déclarations manuelles sont examinées par :

- le Manager officiel dans son périmètre ;
- Owner, Admin ou RH selon leurs permissions.

Le validateur peut :

- valider toute la durée ;
- valider partiellement la durée ;
- refuser la déclaration ;
- ajouter une note obligatoire.

Un utilisateur ne peut pas valider sa propre déclaration.

## Crédits de développement

Les crédits sont calculés à partir de la durée validée et du taux configuré :

- taux par heure de formation ;
- taux par heure de lecture ;
- plafond mensuel des crédits de développement.

Les crédits de formation et de lecture complètent les crédits d'impact. Le score mensuel de croissance reste plafonné et le score final de performance ne peut pas dépasser 100 points.

## Soir, nuit et week-end

Super Leader calcule :

- les minutes situées dans la plage de nuit configurée ;
- les minutes réalisées le samedi ou le dimanche ;
- les activités qui passent après minuit.

Ces données servent au suivi du plan de croissance et à l'alerte de bien-être. Elles ne créent aucun paiement automatique.

## Permissions et confidentialité

- Owner : consultation et configuration à l'échelle de l'organisation.
- Admin : mêmes fonctions opérationnelles, sous réserve des protections du Owner.
- RH : objectifs, paramètres, validations et reporting de développement.
- Manager : consultation et validation limitées à ses équipes et collaborateurs supervisés.
- Employé : son plan, ses activités, ses progrès et ses résultats.

Les politiques RLS protègent les activités et empêchent un utilisateur d'accéder aux données d'un collaborateur hors de son périmètre.

## Intégration à l'Employé du mois

Les activités validées alimentent le critère de croissance mensuelle. Sont pris en compte :

- les crédits issus des contributions d'impact ;
- les crédits issus des formations ;
- les crédits issus de la lecture ;
- les plafonds configurés par l'organisation.

Les activités en attente, refusées ou annulées ne contribuent pas au score.

## Migration

Exécuter dans Supabase SQL Editor :

`supabase/028_development_learning_hours_v2_3_1.sql`
