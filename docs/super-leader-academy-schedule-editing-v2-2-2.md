# Super Leader Academy V2.2.2 - Edition des planifications recurrentes

## Objectif

Cette version permet de modifier une serie de formation existante sans creer de doublon et sans perdre l'historique de presence.

## Regles de fonctionnement

- Owner, Admin et RH peuvent creer, modifier, archiver et restaurer une serie.
- Une modification recalcule uniquement les seances futures qui n'ont pas commence et dont aucune presence significative n'a ete enregistree.
- Les seances passees et les seances avec un statut Present, En retard, Absent ou Excuse sont conservees.
- Une serie ne peut pas generer une seance au meme horaire qu'une autre serie du meme programme.
- L'archivage exige un motif et annule les prochaines seances de la serie.
- La restauration reactive la serie. L'administrateur doit ensuite ouvrir la serie et enregistrer la planification afin de recreer les futures seances.
- Chaque changement cree une revision avec l'ancienne configuration, la nouvelle configuration, l'auteur, le motif et le nombre de seances remplacees.

## Procedure de modification

1. Ouvrir Super Leader Academy.
2. Selectionner la formation.
3. Dans Planification recurrente, ouvrir la serie concernee.
4. Modifier le type, les dates, l'heure, la duree, les jours, le fuseau ou le lien Zoom.
5. Ajouter un motif si necessaire.
6. Cliquer sur Enregistrer la planification puis confirmer.

## Cas d'une formation intensive mensuelle

Pour une formation de trois jours en debut de mois :

- Type : Intensive mensuelle
- Premier jour du mois : date du premier jour de la session
- Nombre de jours consecutifs : 3
- Periode : mois ou cycle couvert par la formation

## Securite

Les actions sont verifiees cote serveur et dans une fonction transactionnelle Supabase. Le simple masquage d'un bouton ne constitue pas la protection principale.
