# Matrice de tests — V2.6.2

| Test | Action | Résultat attendu |
|---|---|---|
| Clôture annulée | Cliquer `Journée terminée`, puis `Annuler` | La fenêtre se ferme et aucune heure de départ n'est enregistrée |
| Clôture confirmée | Cliquer `Journée terminée`, puis `Confirmer` | L'heure de départ est enregistrée une seule fois |
| Double clic | Cliquer rapidement plusieurs fois | Une seule fenêtre et une seule soumission |
| Français | Interface FR | `Confirmation requise`, `Annuler`, `Confirmer` |
| Anglais | Interface EN | `Confirmation required`, `Cancel`, `Confirm` |
| Ma journée | Tester depuis `/dashboard/my-day` | La fenêtre apparaît avant la clôture |
| Performance | Tester depuis `/dashboard/performance?view=attendance` | La même fenêtre apparaît avant la clôture |
| Rapport | Soumettre un rapport | La confirmation personnalisée apparaît |
| Réouverture | Rouvrir une journée avec motif | La confirmation apparaît avant l'action |
