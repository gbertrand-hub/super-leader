# Matrice de test - Academy V2.2.4

| Test | Résultat attendu |
|---|---|
| Owner ouvre Academy | L'assistant en cinq étapes est visible |
| Employé ouvre Academy | L'assistant n'est pas visible |
| Création d'une séance unique | Une série et une séance sont créées |
| Création hebdomadaire lundi/vendredi | Toutes les séances comprises dans la période sont générées |
| Intensive mensuelle sur trois jours | Trois séances consécutives sont générées chaque mois |
| Dates personnalisées | Une séance est créée pour chaque date unique |
| Publication avec certificat sans quiz | Refus avec message explicite |
| Brouillon avec certificat sans quiz | Brouillon créé, publication possible après ajout du quiz |
| Affectation à toute l'organisation | Tous les membres actifs sont inscrits une seule fois |
| Affectation à plusieurs équipes | Les membres et managers des équipes sont inscrits sans doublon |
| Affectation à des collaborateurs précis | Seuls les membres sélectionnés sont inscrits |
| Échec pendant la création | Aucun cours partiel n'est conservé |
| Publication immédiate | Formation publiée, séances générées, notifications créées |
| Formation sans certificat | Publication autorisée sans quiz |
| Formation existante | Les données et séries existantes restent inchangées |
