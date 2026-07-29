# Matrice de tests — Navigation V2.6.5

| Test | Résultat attendu |
|---|---|
| Owner iLEAD avec accès complet | Toutes les sections et tous les grands modules autorisés apparaissent |
| Admin avec module non inclus | Le module apparaît verrouillé avec le badge Plan et ouvre Abonnement & plans |
| Manager | Les outils personnels, ses équipes, membres supervisés, événements et modules commerciaux autorisés apparaissent |
| Employé | Seuls les outils personnels et modules auxquels il a droit apparaissent |
| RH | Entreprise, équipes, membres, performance, rapports et acquisition plateforme apparaissent selon le plan |
| Organisation externe | Acquisition & accès plateforme est masqué |
| Compte sans organisation | Seul Tableau de bord apparaît |
| Plan Free | Les modules payants sont masqués pour les collaborateurs ; Owner/Admin voient les possibilités d’évolution |
| Notifications non lues | Le compteur rouge reste visible dans la section Travail quotidien |
| Route active | Le lien actif est surligné dans sa section |
| Français / anglais | Les titres des cinq sections et tous les liens sont traduits |
| Mobile | Le menu s’ouvre, se ferme et se referme après sélection d’un lien |
| Couverture des routes | Chaque page principale existante sous `/dashboard` possède un lien parent dans la configuration |
