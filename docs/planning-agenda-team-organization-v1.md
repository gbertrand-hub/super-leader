# Planning, Agenda & Organisation des équipes V1

## Objectif

Centraliser les horaires individuels et collectifs, les jours de repos, le télétravail, les rotations, les congés approuvés et les réunions obligatoires.

## Fonctions principales

- planning mensuel personnel et d'équipe;
- création d'une journée précise;
- modèles d'horaires réutilisables;
- génération de plusieurs journées sur une période;
- brouillon, publication et annulation;
- détection des conflits avec les congés approuvés;
- alerte lorsqu'une réunion obligatoire est hors de l'horaire planifié;
- notification automatique lors d'une publication, modification ou annulation;
- prise en compte dans Ma journée, le pointage et le calcul mensuel de performance;
- interface française et anglaise.

## Base de données

Exécuter `supabase/016_planning_agenda_team_organization.sql` après les migrations Performance et Notifications.

## Route

- `/dashboard/schedule`

## Règles importantes

- une seule journée de planning par collaborateur et par date;
- un jour de repos ne comporte ni heure de début, ni heure de fin, ni rapport requis;
- une journée publiée ne peut pas chevaucher un congé approuvé;
- un brouillon peut être supprimé;
- un planning publié est annulé, jamais supprimé, afin de conserver l'historique;
- les managers gèrent uniquement leurs collaborateurs supervisés;
- les propriétaires, administrateurs et RH ont une vue globale.
