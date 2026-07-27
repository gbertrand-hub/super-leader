# Matrice de tests - Vue Manager V2.1.2

## Preparation

- Un Owner actif.
- Un Manager responsable d'au moins deux equipes.
- Deux Employes, dont un deja rattache a une equipe du Manager.
- Les migrations 019 et 020 ainsi que le correctif 021 deja appliques.

## Interface du Manager

1. Se connecter avec le Manager.
2. Ouvrir `Membres & affectations`.
3. Verifier que seuls ses collaborateurs apparaissent.
4. Verifier l'absence des controles de role et de desactivation.
5. Verifier que seules les equipes dirigees par ce Manager apparaissent dans la liste d'affectation.
6. Affecter le collaborateur a une deuxieme equipe dirigee.
7. Retirer le collaborateur de cette equipe.

Resultat attendu : les affectations autorisees reussissent et les actions administratives sensibles ne sont pas affichees.

## Protection contre une requete hors perimetre

1. Recuperer l'identifiant d'une equipe dirigee par un autre Manager.
2. Tenter de soumettre manuellement cet identifiant a l'action d'affectation.
3. Tenter de soumettre l'identifiant d'un collaborateur hors du perimetre du Manager.

Resultat attendu : l'action est refusee et aucun enregistrement `team_members` n'est cree ou supprime.

## Owner, Admin et RH

- Owner/Admin conservent les controles de role, de statut et d'affectation.
- RH conserve les controles de personnes et d'affectation prevus par la matrice V2.
- Le changement du Manager officiel d'une equipe reste invisible au Manager lui-meme.

## Employe

- L'Employe ne peut pas ouvrir les pages d'administration des equipes ou des membres par URL directe.
