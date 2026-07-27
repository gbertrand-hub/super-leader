# Super Leader Academy V2.2.1

## Formations récurrentes et sessions intensives

Cette version permet à une même formation de comporter plusieurs séries de séances.

Exemple pour **Formation des Leaders** :

- série hebdomadaire : chaque lundi et vendredi ;
- série intensive mensuelle : 3 jours consécutifs au début de chaque mois ;
- lien Zoom propre à chaque série ;
- feuille de présence pour chaque séance ;
- certificat délivré lorsque le quiz et le taux de présence sont validés.

## Structure fonctionnelle

### Programme de formation

Le programme conserve :

- son titre et sa description ;
- son mois de référence ;
- sa date limite ;
- sa note minimale au quiz ;
- son nombre maximal de tentatives ;
- son taux minimal de présence ;
- l'activation du certificat.

### Séries récurrentes

Un programme peut recevoir plusieurs séries :

1. **Hebdomadaire** : sélection d'un ou plusieurs jours de la semaine.
2. **Intensive mensuelle** : premier jour du mois et nombre de jours consécutifs.
3. **Séance unique** : création d'une seule séance.

Chaque série définit une période, une heure, une durée, un fuseau horaire et un lien Zoom.

### Séances

La création d'une série génère automatiquement toutes les séances comprises dans sa période. Chaque séance contient :

- une date et une heure locales ;
- un fuseau horaire ;
- une durée ;
- un statut : planifiée, terminée ou annulée ;
- un bouton **Rejoindre sur Zoom** pour les participants affectés ;
- une feuille de présence.

### Présences

Les statuts disponibles sont :

- Invité ;
- Présent ;
- En retard ;
- Absent ;
- Excusé.

Une absence excusée est retirée du nombre de séances exigées. Les séances annulées ne sont pas comptabilisées.

### Certification

Le certificat est créé uniquement lorsque :

- le quiz atteint la note minimale ;
- le taux de présence atteint le seuil configuré, 80 % par défaut.

Le certificat affiche le résultat au quiz et le taux de présence validé.

### Employé du mois

Une formation obligatoire est considérée comme terminée uniquement après validation du quiz et de la présence. Son statut final continue donc d'alimenter automatiquement le critère **Formation et développement** du score mensuel.

## Permissions

- **Owner / Admin / RH** : configurent les programmes, les séries et les séances.
- **Manager** : consulte les séances et enregistre la présence de ses collaborateurs supervisés.
- **Employé** : consulte ses propres séances, rejoint Zoom et suit sa progression.

## Limite actuelle de l'intégration Zoom

Cette version fournit le bouton sécurisé **Rejoindre sur Zoom** et le suivi manuel de présence. La création automatique des réunions Zoom et la récupération automatique des participants par l'API Zoom seront ajoutées dans une phase distincte.
