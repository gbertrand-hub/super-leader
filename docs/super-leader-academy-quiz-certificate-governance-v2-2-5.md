# Super Leader Academy V2.2.5

## Verrouillage strict du quiz et du certificat

Pour une formation dont la présence minimale est supérieure à 0 %, l’évaluation finale est accessible uniquement lorsque les trois conditions suivantes sont réunies :

1. au moins une séance non annulée existe ;
2. toutes les séances non annulées sont terminées ;
3. le taux de présence atteint le seuil configuré.

Les séances futures ne sont pas comptabilisées comme des absences. Une séance terminée sans statut de présence compte comme une absence. Les statuts `Présent` et `Retard` comptent comme une participation. Une absence excusée est retirée du nombre de séances attendues.

Le certificat exige en plus la réussite du quiz selon la note minimale définie pour la formation.

## Couches de protection

- Interface : le formulaire du quiz est remplacé par un message de verrouillage.
- Action serveur : une soumission manuelle est refusée avant toute écriture.
- Base Supabase : des triggers bloquent les tentatives de quiz et certificats non éligibles, y compris via un appel direct.
- Journalisation : les opérations normales de quiz et de présence conservent leurs traces d’audit existantes.

## Messages affichés

- Aucune séance planifiée.
- Des séances sont encore à venir ou en cours.
- Présence inférieure au minimum requis.
- Évaluation disponible lorsque toutes les conditions sont remplies.
