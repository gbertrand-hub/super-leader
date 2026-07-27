# Matrice de test V2.2.5

| Situation | Quiz | Certificat |
|---|---|---|
| Aucune séance, présence requise 80 % | Verrouillé | Refusé |
| Trois séances futures | Verrouillé | Refusé |
| Deux séances terminées, une future, présence 100 % | Verrouillé | Refusé |
| Toutes les séances terminées, présence 66,67 % | Verrouillé | Refusé |
| Toutes les séances terminées, présence 100 %, quiz non réussi | Accessible | Refusé |
| Toutes les séances terminées, présence >= 80 %, quiz réussi >= 70 % | Validé | Délivré |
| Présence requise 0 %, quiz réussi | Accessible selon la configuration | Délivré si le certificat est activé |
| Soumission directe avant éligibilité | Refus serveur + base | Refus base |

## Test prioritaire Staff Training

1. Ouvrir la formation avant le 5 août 2026 après la dernière séance.
2. Vérifier que « Évaluation finale verrouillée » est affiché.
3. Vérifier que le formulaire du quiz n’est pas présent dans le HTML rendu.
4. Après la dernière séance, enregistrer les présences.
5. Vérifier le déblocage uniquement à partir de 80 %.
6. Réussir le quiz à au moins 70 % et contrôler le certificat.
