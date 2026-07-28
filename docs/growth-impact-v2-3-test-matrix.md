# Matrice de tests - Super Leader V2.3

## Activation

- [ ] La migration 027 s'exécute sans erreur.
- [ ] Le menu « Plan de croissance » apparaît pour les cinq rôles.
- [ ] Une organisation existante reçoit ses paramètres par défaut.
- [ ] Une nouvelle organisation reçoit automatiquement ses paramètres.

## Employé

- [ ] L'employé voit uniquement son propre plan.
- [ ] Il peut enregistrer son objectif mensuel.
- [ ] Il peut déclarer une contribution de 15 minutes à 12 heures.
- [ ] Une contribution passant minuit calcule correctement sa durée.
- [ ] Les minutes de nuit et de week-end sont calculées.
- [ ] Un lien autre que HTTP/HTTPS est refusé.
- [ ] Une pièce justificative privée peut être ajoutée puis ouverte.
- [ ] Une déclaration en attente peut être annulée.
- [ ] Une contribution déjà examinée ne peut plus être annulée.
- [ ] L'employé ne peut ni valider sa propre contribution ni modifier les crédits.

## Manager

- [ ] Le Manager voit uniquement ses équipes et collaborateurs supervisés.
- [ ] Il ne voit aucun collaborateur hors périmètre, même avec une URL modifiée.
- [ ] Il peut définir le plan d'un collaborateur supervisé.
- [ ] Il peut valider, valider partiellement ou refuser une contribution de son périmètre.
- [ ] Il ne peut pas valider sa propre contribution.
- [ ] Il peut classer une activité comme contribution de croissance ou à examiner par les RH.

## Owner, Admin et RH

- [ ] Ils voient les contributions autorisées à l'échelle de l'organisation.
- [ ] Ils peuvent modifier les paramètres organisationnels.
- [ ] Le Owner reste protégé contre les modifications de propriété existantes.
- [ ] Le RH peut ouvrir les pièces justificatives d'impact.

## Crédits et performance

- [ ] Une validation complète utilise toute la durée déclarée.
- [ ] Une validation partielle exige une durée inférieure à la durée déclarée.
- [ ] Un refus attribue 0 minute et 0 crédit.
- [ ] Les multiplicateurs faible, modéré, élevé et stratégique sont corrects.
- [ ] Une contribution ne dépasse pas 10 crédits.
- [ ] Le plafond mensuel de crédits est respecté.
- [ ] Le classement affiche le score et les crédits de croissance.
- [ ] Le score total reste plafonné à 100.
- [ ] Une contribution en attente, refusée ou annulée n'alimente pas le score.

## Confidentialité, notifications et audit

- [ ] La soumission notifie le superviseur ou Manager autorisé.
- [ ] La décision notifie le collaborateur.
- [ ] Toutes les validations apparaissent dans le journal d'audit.
- [ ] Les clients authentifiés ne peuvent pas modifier directement les tables depuis Supabase.
- [ ] Les pièces jointes utilisent des URL signées temporaires.

## Bien-être

- [ ] Le seuil de nuit/week-end déclenche l'alerte de bien-être.
- [ ] Les activités de nuit et week-end ne reçoivent aucun bonus automatique.
- [ ] Le module précise que les heures d'impact sont distinctes de la paie.
