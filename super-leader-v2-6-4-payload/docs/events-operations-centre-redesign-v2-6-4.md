# Super Leader V2.6.4 - Centre operationnel evenementiel

## Objectif

Transformer la page Evenements en un centre de pilotage plus lisible, sans modifier le modele de donnees V2.6.3.

## Changements fonctionnels

- Le formulaire permanent de creation est masque par defaut.
- Le bouton `+ Creer un evenement` ouvre un formulaire dedie.
- Un selecteur permet de passer rapidement d'un evenement a un autre.
- L'evenement selectionne utilise une banniere compacte avec dates, lieu, responsable et statut.
- Des actions rapides ouvrent directement l'ajout de membre, de tache, d'activite ou de document.
- La page est organisee en onglets : Vue d'ensemble, Equipe, Taches, Planning, Budget, Documents et Rapport final.
- La vue d'ensemble affiche les prochaines echeances, les taches critiques, la prochaine activite, les risques, les membres sans tache et les documents recents.
- Le budget dispose d'une vue dediee avec budget previsionnel, engagements, depenses et solde.
- Le compteur `En cours` utilise maintenant les dates reelles de debut et de fin au lieu de compter tous les evenements en preparation.
- Les actions serveur reviennent dans l'onglet concerne apres enregistrement.

## Compatibilite

- Aucune nouvelle table.
- Aucune migration Supabase.
- Les donnees et permissions V2.6.3 restent intactes.
- Les equipes permanentes et les roles systeme ne sont pas modifies.
