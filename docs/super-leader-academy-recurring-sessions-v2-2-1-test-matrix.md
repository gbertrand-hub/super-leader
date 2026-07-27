# Matrice de tests - Academy V2.2.1

## Installation

- Exécuter `022_academy_recurring_sessions_v2_2_1.sql` après la migration 021.
- Vérifier que la page Academy s'ouvre sans message d'activation.

## Owner / Admin / RH

- Créer une série hebdomadaire avec lundi et vendredi.
- Vérifier la génération des dates dans la période choisie.
- Créer une deuxième série intensive mensuelle avec jour 1 et 3 jours.
- Vérifier que les deux séries coexistent dans le même programme.
- Vérifier le lien Zoom de chaque séance.
- Annuler une séance et confirmer qu'elle ne compte plus dans le taux de présence.
- Enregistrer les statuts Présent, En retard, Absent et Excusé.

## Manager

- Vérifier qu'il ne peut pas créer une série.
- Vérifier qu'il voit seulement les participants de son périmètre.
- Enregistrer la présence d'un collaborateur supervisé.
- Tenter de modifier la présence d'un employé hors périmètre et confirmer le refus.

## Employé

- Vérifier qu'une séance apparaît uniquement après inscription ou affectation.
- Ouvrir le bouton Rejoindre sur Zoom.
- Vérifier la séance du jour dans Ma journée.
- Réussir le quiz avec une présence insuffisante : aucun certificat ne doit être créé.
- Atteindre le seuil de présence : la formation doit passer à Terminée et le certificat doit être disponible.

## Certificat et performance

- Vérifier l'affichage du score du quiz.
- Vérifier l'affichage du taux de présence et du nombre de séances.
- Vérifier la page publique de validation du certificat.
- Recalculer la performance mensuelle et confirmer la prise en compte de la formation terminée.
