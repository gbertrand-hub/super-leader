# Matrice de test — Super Leader V2.8

| Test | Étapes | Résultat attendu |
|---|---|---|
| Migration | Exécuter `036_zoom_multi_hosts_v2_8.sql` | Succès sans ligne retournée |
| Synchronisation | Cliquer sur Synchroniser les comptes Zoom | Tous les utilisateurs Zoom actifs apparaissent |
| Affectation | Associer un hôte à un département | L’affectation est conservée après actualisation |
| Défaut département | Marquer un hôte par défaut | Un seul hôte par défaut pour le département |
| Défaut général | Marquer un hôte général | L’email général est mis à jour dans la configuration |
| Performance | Créer une réunion avec un hôte sélectionné | La réunion apparaît dans le bon compte Zoom |
| Événement | Créer une activité de type Réunion avec Zoom | La réunion apparaît dans le bon compte Zoom |
| Conflit | Créer deux réunions simultanées avec le même hôte | La deuxième création est bloquée |
| Concurrence autorisée | Activer l’option puis refaire le test | La deuxième réunion peut être créée |
| Démarrer comme hôte | Cliquer sur le bouton | Ouverture du lien hôte sans `NEXT_REDIRECT` |
| Présence | Terminer puis synchroniser | Durées et statuts sont mis à jour |
| Audit | Vérifier le journal | Synchronisation et modifications sont enregistrées |
