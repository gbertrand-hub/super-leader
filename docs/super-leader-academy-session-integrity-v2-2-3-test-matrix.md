# Matrice de tests V2.2.3

| Test | Résultat attendu |
|---|---|
| Exécuter la migration 024 avec une série active sans séances | Les séances manquantes sont générées |
| Exécuter la migration une deuxième fois | Aucun doublon n'est créé |
| Affecter deux fois la même formation au même employé | L'inscription existante est conservée |
| Cliquer deux fois sur Commencer | Le statut reste En cours, sans nouvelle inscription |
| Formation avec présence requise et 0 séance | Quiz verrouillé |
| Présence inférieure au minimum | Quiz verrouillé avec taux actuel et taux requis |
| Présence égale ou supérieure au minimum | Quiz disponible |
| Quiz réussi avec présence suffisante | Formation terminée et certificat créé si activé |
| Compteurs avec une inscription liée à une formation archivée | L'inscription archivée n'est pas comptée dans les formations actives |
| Owner sur une formation avec série active mais 0 séance | Bouton de réparation visible |
| Employé sur la même formation | Message d'indisponibilité, aucun bouton administratif |
