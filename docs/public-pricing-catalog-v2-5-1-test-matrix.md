# Matrice de tests - Super Leader V2.5.1

| Test | Resultat attendu |
|---|---|
| Ouvrir `/pricing` | Trois cartes Starter, Growth et Enterprise sont visibles. |
| Choisir Mensuel | Starter affiche 49 USD/mois et Growth 99 USD/mois. |
| Choisir Annuel | Starter affiche 490 USD/an et Growth 990 USD/an avec economie. |
| Plan Growth | Badge `Le plus populaire` visible. |
| Plan Enterprise | Prix `Sur devis` et limites personnalisees. |
| Modules | Chaque plan affiche uniquement ses fonctions activees. |
| Limites | Starter 25 collaborateurs, Growth 100, Enterprise personnalise. |
| CTA | Chaque bouton ouvre `/signup` avec le plan et la periodicite dans l URL. |
| Plan historique | `Acces complet historique` ne doit jamais apparaitre publiquement. |
| Catalogue DB absent | Les trois offres provisoires integrees restent visibles avec une note de synchronisation. |
| Langue EN | Titres, descriptions, periodes et appels a l action sont en anglais. |
| Mobile | Les cartes sont empilees sans debordement horizontal. |
