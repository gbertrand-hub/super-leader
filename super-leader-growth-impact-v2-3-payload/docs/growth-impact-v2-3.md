# Super Leader V2.3 - Plan de croissance et contributions d'impact

## Objectif

Le module valorise les contributions volontaires qui développent les compétences du collaborateur et créent une valeur mesurable pour l'organisation, sans les confondre automatiquement avec le temps de travail ou les heures supplémentaires payables.

Trois compteurs restent distincts :

1. heures de travail prévues par le poste et le planning ;
2. heures supplémentaires soumises aux règles RH, contractuelles et de paie ;
3. heures d'impact et d'ajout de valeur intégrées au plan de croissance.

Le libellé interne ne détermine jamais à lui seul le traitement RH. Lorsqu'une contribution doit être examinée comme temps de travail potentiel, le validateur la classe « A examiner par les RH ».

## Plan mensuel de croissance

Chaque collaborateur peut avoir un plan mensuel contenant :

- un objectif d'heures d'impact ;
- un objectif de crédits de croissance ;
- une compétence prioritaire ;
- un objectif concret de développement.

Le collaborateur peut définir son plan. Son Manager officiel, le RH, l'Admin ou le Owner peut également le définir dans son périmètre autorisé.

## Déclaration d'une contribution

Le collaborateur renseigne :

- la date, l'heure de début et l'heure de fin ;
- le passage éventuel à minuit ;
- la catégorie de contribution ;
- le titre et la description ;
- la compétence développée ;
- le projet, l'équipe ou le bénéficiaire ;
- le résultat ou livrable obtenu ;
- l'impact estimé ;
- un lien de preuve et/ou une pièce justificative privée.

Super Leader calcule automatiquement :

- la durée totale ;
- la partie réalisée pendant la plage de nuit configurée ;
- la partie réalisée le samedi ou le dimanche.

Une déclaration doit durer entre 15 minutes et 12 heures. Les liens de preuve sont limités aux protocoles HTTP et HTTPS.

## Catégories disponibles

- apprentissage et recherche ;
- mentorat ;
- innovation ;
- documentation ;
- soutien interéquipes ;
- impact communautaire ;
- amélioration de processus ;
- projet spécial ;
- représentation de l'organisation ;
- autre contribution.

## Validation

Le Manager officiel peut examiner uniquement les collaborateurs de son périmètre. Owner, Admin et RH peuvent examiner les contributions autorisées à l'échelle de l'organisation. Un utilisateur ne peut pas valider sa propre contribution.

Le validateur choisit :

- validée ;
- partiellement validée ;
- refusée.

Il précise la durée reconnue, le niveau d'impact, le traitement RH et une note obligatoire. Les décisions et modifications sont enregistrées dans le journal d'audit.

## Crédits de croissance

Les crédits combinent la durée reconnue et le niveau d'impact :

- faible : multiplicateur 1 ;
- modéré : multiplicateur 1,5 ;
- élevé : multiplicateur 2 ;
- stratégique : multiplicateur 3.

Une contribution est plafonnée à 10 crédits. Le nombre de crédits pris en compte chaque mois est également plafonné par les paramètres de l'organisation.

Les crédits alimentent un bonus configurable dans le calcul mensuel de performance. Par défaut :

- objectif : 10 crédits ;
- bonus maximal : 10 points ;
- plafond mensuel pris en compte : 20 crédits ;
- score total final plafonné à 100 points.

## Bien-être et repos

Les activités de nuit et du week-end sont identifiées, mais ne valent pas automatiquement davantage. Une alerte de bien-être apparaît lorsque le volume cumulé dépasse le seuil configuré. Le but est de reconnaître l'initiative sans encourager le sacrifice du repos.

## Permissions

- Owner : toute l'organisation, paramètres et validations.
- Admin : toute l'organisation, paramètres et validations, sauf protections du Owner.
- RH : toute l'organisation, paramètres, validations et examen du traitement RH.
- Manager : ses équipes et collaborateurs supervisés uniquement.
- Employé : son plan, ses déclarations, ses preuves et ses résultats.

Les pièces jointes sont stockées dans l'espace privé et accessibles uniquement au collaborateur, à son périmètre de supervision et aux rôles RH autorisés.

## Intégration à l'Employé du mois

Le classement mensuel affiche un critère « Initiative & ajout de valeur » avec :

- le score de croissance obtenu ;
- le nombre de crédits validés.

Le calcul n'utilise que les contributions validées ou partiellement validées pendant le mois sélectionné.

## Paramètres organisationnels

Owner, Admin et RH peuvent configurer :

- l'objectif mensuel d'heures par défaut ;
- l'objectif de crédits par défaut ;
- le bonus maximal dans le score mensuel ;
- le plafond de crédits comptabilisés ;
- le début et la fin de la période de nuit ;
- le seuil d'alerte de bien-être.

## Migration

Exécuter dans Supabase SQL Editor :

`supabase/027_growth_impact_v2_3.sql`
