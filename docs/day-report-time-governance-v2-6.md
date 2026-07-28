# Super Leader V2.6 - Gouvernance de Ma journee, rapports et temps

## Objectif

Cette version securise la cloture de la journee, empeche les doubles rapports et fournit une lecture fiable du temps effectif. Elle distingue le temps travaille, le temps hors planning, le travail de nuit et le week-end sans transformer automatiquement ces periodes en heures supplementaires payables.

## Cloture de la journee

L'employe doit confirmer l'action « Journee terminee ». Une fois la journee cloturee :

- l'heure de depart est enregistree ;
- le total travaille est calcule ;
- le temps situe hors de l'horaire planifie est isole ;
- les minutes de nuit et de week-end sont identifiees ;
- l'employe ne peut plus annuler lui-meme la cloture.

Une journee ouverte avant minuit peut etre cloturee apres minuit : Super Leader retrouve la derniere presence encore ouverte et utilise la date initiale de travail ainsi que son planning.

## Reouverture controlee

Une journee cloturee peut etre rouverte uniquement par :

- le Manager officiellement affecte au collaborateur ;
- le Responsable RH ;
- l'Administrateur ;
- le Proprietaire.

Le motif comporte au moins 10 caracteres. L'ancienne heure de depart et les anciens totaux sont conserves dans `attendance_reopenings`. L'employe recoit une notification et toute l'operation est inscrite dans le journal d'audit.

Le nombre maximal de reouvertures par jour est configurable. Le Proprietaire, l'Administrateur ou le RH peut egalement gouverner sa propre journee ; un Manager ne peut pas rouvrir la sienne.

## Rapport journalier unique

Une seule ligne `daily_reports` est autorisee par collaborateur et par date. Apres la premiere soumission :

- le rapport est verrouille ;
- le formulaire normal n'est plus disponible pour cette date ;
- une nouvelle soumission directe est refusee cote serveur ;
- une correction exige une autorisation de reouverture.

## Correction d'un rapport

Le Manager officiel, le RH, l'Admin ou le Owner peut ouvrir une fenetre de correction avec :

- un motif obligatoire ;
- une duree limitee ;
- un facteur de score conforme aux parametres de l'organisation.

Avant l'enregistrement d'une correction, la version precedente est copiee dans `daily_report_versions`. Le rapport principal conserve ensuite son numero de revision, sa nouvelle date de verrouillage et le motif de la derniere correction.

Le superviseur ne peut pas ecraser un rapport existant en utilisant l'option « completer a la place de l'employe ». Cette option reste reservee aux dates cloturees sans rapport.

## Classification du temps

Pour chaque cloture, Super Leader calcule :

- `total_work_minutes` : duree entre l'arrivee et le depart ;
- `scheduled_work_minutes` : duree theorique du planning ;
- `outside_schedule_minutes` : partie travaillee hors de la plage planifiee ;
- `night_minutes` : partie comprise dans la plage de nuit configuree ;
- `weekend_minutes` : partie realisee le samedi ou le dimanche.

Ces compteurs peuvent se chevaucher. Par exemple, une heure effectuee le dimanche a 23 h peut etre a la fois une heure de week-end, de nuit et hors planning.

Ces valeurs servent au suivi, a la sante organisationnelle et aux analyses. Elles ne creent aucun paiement automatique. Les heures supplementaires payables restent soumises a la politique RH, au contrat et au droit applicable. Les heures d'impact et d'ajout de valeur restent gerees separement dans le Plan de croissance.

## Bien-etre

Une alerte apparait lorsque :

- la duree totale depasse le seuil configure ;
- du travail de nuit est detecte ;
- du travail le week-end est detecte.

Le seuil d'une longue journee est configurable par Owner, Admin ou RH. La valeur par defaut est de 720 minutes.

## Reunions dans Ma journee

Le bloc des acces rapides contient maintenant « Mes reunions ». Il ouvre directement l'onglet Reunions de Performance. Les reunions du jour restent egalement visibles dans les priorites et l'agenda.

## Parametres organisationnels

Les roles Owner, Admin et RH peuvent configurer :

- l'activation de la reouverture des journees ;
- le nombre maximal de reouvertures par jour ;
- le seuil d'alerte d'une longue journee ;
- le debut et la fin de la plage de nuit ;
- les regles deja existantes de verrouillage et de reouverture des rapports.

## Permissions

- Owner : gouvernance de toute l'organisation et de sa propre journee.
- Admin : gouvernance de toute l'organisation, sauf protections du Owner deja existantes.
- RH : gouvernance RH de toute l'organisation.
- Manager : uniquement les collaborateurs officiellement supervises ; jamais sa propre journee.
- Employe : pointage, cloture confirmee, rapport unique et consultation de ses propres historiques.

## Migration

Executer dans Supabase SQL Editor :

`supabase/033_day_report_time_governance_v2_6.sql`
