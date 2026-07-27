# Super Leader V2.1.2 - Vue Manager simplifiee et securisee

## Objectif

Rendre la page `Membres & affectations` claire pour le Manager, sans afficher de commandes administratives qu'il ne peut pas utiliser.

## Regles appliquees

- Le Manager voit uniquement les collaborateurs presents dans les equipes qu'il dirige ou places sous sa supervision active.
- Les controles de changement de role et d'activation/desactivation ne sont plus affiches au Manager.
- Le Manager peut affecter ou retirer un collaborateur uniquement dans une equipe dont il est le responsable officiel.
- Le Manager ne peut pas utiliser une action serveur pour viser une autre equipe ou un collaborateur hors de son perimetre.
- Le changement du responsable d'une equipe reste reserve au Owner, a l'Admin et au RH.
- La creation, la modification, l'archivage et la restauration des equipes restent reserves au Owner et a l'Admin.

## Interface Manager

La page affiche :

- le nom et l'email du collaborateur ;
- son statut en lecture seule ;
- son role en lecture seule ;
- les equipes dirigees auxquelles il appartient ;
- une commande d'affectation uniquement vers les autres equipes gerees par ce Manager.

Les boutons `Modifier le role` et `Desactiver` sont absents, et non simplement grises.

## Securite cote serveur

Chaque ajout ou retrait verifie simultanement :

1. que l'utilisateur connecte possede un membership actif ;
2. que son role autorise la gestion des membres d'equipe ;
3. que l'equipe cible appartient a son organisation ;
4. que le Manager est officiellement responsable de l'equipe cible ;
5. que le collaborateur cible appartient deja a son perimetre de supervision.

Une requete fabriquee manuellement vers une autre equipe ou un autre collaborateur est refusee.

## Migration Supabase

Aucune nouvelle migration SQL n'est requise. Cette version utilise les tables et politiques deja installees par les migrations 019, 020 et le correctif de schema 021.
