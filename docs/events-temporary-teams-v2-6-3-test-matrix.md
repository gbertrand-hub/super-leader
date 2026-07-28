# Matrice de tests - Evenements et equipes temporaires V2.6.3

## Installation

- [ ] La migration `034_events_temporary_teams_v2_6_3.sql` s'execute sans erreur.
- [ ] Le menu `Evenements` apparait pour une organisation ayant la fonctionnalite `events`.
- [ ] Free et Starter ne voient pas le module, sauf override explicite.

## Creation

- [ ] Owner/Admin/RH peut creer un evenement.
- [ ] Une date de fin anterieure au debut est refusee.
- [ ] Un responsable doit etre un membre actif de l'organisation.
- [ ] L'evenement nouvellement cree s'ouvre automatiquement.

## Visibilite

- [ ] Owner/Admin/RH voit tous les evenements de l'organisation.
- [ ] Un Manager non affecte ne voit pas l'evenement.
- [ ] Un employe affecte voit uniquement ses evenements.
- [ ] Aucun utilisateur ne voit les evenements d'une autre organisation.

## Equipe temporaire

- [ ] Un membre de Communication peut etre ajoute a la cellule Media sans perdre son equipe permanente.
- [ ] Un membre peut etre designe gestionnaire de l'evenement sans changement de role systeme.
- [ ] Le responsable principal ne peut pas etre retire avant d'etre remplace.
- [ ] Une notification est creee lors de l'affectation.

## Taches

- [ ] Un gestionnaire cree une tache et l'affecte a un membre de mission.
- [ ] Le membre recoit une notification.
- [ ] Le membre affecte peut mettre a jour sa progression et son statut.
- [ ] Un membre non affecte ne peut pas modifier la tache.
- [ ] Les taches en retard apparaissent dans l'indicateur.

## Planning

- [ ] Une session peut etre ajoutee avec heure, lieu, responsable et lien Zoom.
- [ ] Les dates sont affichees selon le fuseau horaire de l'evenement.
- [ ] Le lien de reunion s'ouvre dans un nouvel onglet.

## Documents et rapport

- [ ] Un gestionnaire ajoute un document par URL valide.
- [ ] Les URL non HTTP/HTTPS sont refusees.
- [ ] Le rapport final peut etre enregistre et modifie.
- [ ] Les revenus et depenses utilisent la devise de l'evenement.

## Audit et abonnements

- [ ] Les creations, affectations, retraits, taches, planning, documents et rapport final sont journalises.
- [ ] Legacy, Growth et Enterprise ont la fonctionnalite `events`.
- [ ] Le module ne modifie aucune ligne dans `teams` ou `team_members`.
