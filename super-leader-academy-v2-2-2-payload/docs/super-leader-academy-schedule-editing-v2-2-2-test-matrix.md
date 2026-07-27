# Matrice de test V2.2.2

| Test | Resultat attendu |
|---|---|
| Modifier une serie hebdomadaire en intensive mensuelle | La nouvelle configuration reste affichee apres actualisation |
| Changer les dates ou l'heure | Les futures seances non commencees sont remplacees |
| Modifier une serie avec des presences deja saisies | Les seances concernees et leurs presences restent intactes |
| Creer une serie identique | Operation refusee avec un message de doublon |
| Creer une seance au meme horaire qu'une autre serie | Operation refusee avec un message de conflit |
| Archiver sans motif | Operation refusee |
| Archiver avec motif | Serie archivee et prochaines seances annulees |
| Restaurer une serie | Serie active, puis regeneration disponible apres enregistrement |
| Manager ou Employe tente de modifier une serie | Operation refusee cote serveur |
| Consulter la revision | Le numero de revision augmente apres chaque changement |
