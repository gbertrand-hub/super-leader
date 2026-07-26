# Ma journee & Centre operationnel des equipes V1

## Objectif

Reunir dans une page unique les obligations et priorites quotidiennes de chaque collaborateur, tout en donnant aux superviseurs une vue immediate de leur equipe.

## Vue collaborateur

- pointage de debut et de fin de journee;
- etat du rapport journalier et heure limite;
- reunions attribuees aujourd'hui;
- taches CRM et clients a relancer;
- paiements et dossiers de recouvrement;
- feedbacks clients urgents;
- plans d'action a echeance;
- notifications non lues;
- score mensuel et position;
- priorites triees automatiquement par urgence.

## Vue superviseur

- collaborateurs planifies;
- presents, retardataires et absents;
- rapports journaliers manquants;
- taches clients en retard;
- feedbacks clients urgents;
- tableau individuel des presences et rapports du jour.

## Navigation

La page est disponible a l'adresse:

`/dashboard/my-day`

Elle devient la premiere destination apres la connexion. Le tableau de bord analytique existant reste accessible dans le menu.

## Base de donnees

Aucune nouvelle migration Supabase n'est necessaire. La page consolide les donnees des modules deja installes: Performance, Notifications, CRM, Recouvrement et Plans d'action.
