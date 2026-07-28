# Super Leader V2.6.3 - Evenements et equipes temporaires

## Objectif

Le module permet de piloter des conferences et autres evenements sans modifier la structure permanente de l'organisation. Un collaborateur conserve son departement, ses equipes et son role systeme, tout en recevant une mission temporaire dans un evenement.

## Perimetre V2.6.3

- Creation d'un evenement avec dates, lieu, fuseau horaire, objectifs, responsable, budget et nombre de participants attendu.
- Statuts : brouillon, preparation, ouvert, en cours, termine, annule et archive.
- Equipe de mission transversale composee de membres de plusieurs equipes permanentes.
- Roles evenementiels libres : coordination, logistique, communication, protocole, finance, inscription, technique, etc.
- Possibilite de deleguer la gestion de l'evenement a un membre sans lui attribuer un role systeme Manager.
- Taches, jalons, priorites, responsables, echeances, budget, progression et preuve de realisation.
- Planning evenementiel avec reunions, sessions, voyages, logistique, repetitions, installation et liens Zoom.
- Documents centralises par lien : contrats, devis, factures, programme, marketing, voyages, presentations et rapport.
- Rapport final : participants reels, revenus, depenses, objectifs, resultats, incidents, lecons et recommandations.
- Notifications lors des affectations de membres et de taches.
- Journal d'audit de toutes les operations importantes.

## Permissions

- Owner, Admin et RH voient tous les evenements et peuvent les creer.
- Le responsable principal voit et gere son evenement.
- Un membre peut recevoir le droit `Peut gerer cet evenement` sans devenir Manager de l'organisation.
- Les autres membres voient seulement les evenements auxquels ils sont affectes.
- Un responsable de tache peut mettre a jour sa propre progression, son statut, ses notes et sa preuve.
- Les equipes permanentes et les roles systeme ne sont jamais modifies par les affectations evenementielles.

## Abonnements

La fonctionnalite `events` est activee pour :

- Acces complet historique ;
- Growth ;
- Enterprise.

Elle reste desactivee pour Free et Starter dans cette version.

## Installation

Executer :

```text
supabase/034_events_temporary_teams_v2_6_3.sql
```

Puis ouvrir :

```text
/dashboard/events
```

## Evolutions prevues

Les inscriptions publiques, billetterie, QR d'acces, budget avec workflow d'achat, WhatsApp et presence automatique pourront etre ajoutes dans une version ulterieure.
