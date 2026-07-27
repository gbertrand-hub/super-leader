# Super Leader Academy V1

## 1. Objectif

Super Leader Academy transforme la formation mensuelle en un processus mesurable, sécurisé et directement relié au développement professionnel et à l’évaluation de l’Employé du mois.

Le module permet de :

- créer un catalogue de formations mensuelles ;
- distinguer les formations obligatoires et facultatives ;
- affecter les participants selon les rôles et le périmètre de supervision ;
- fournir un lien vers la ressource de formation ;
- organiser un quiz final avec une note minimale et un nombre limité de tentatives ;
- enregistrer la progression et la complétion ;
- délivrer un certificat de complétion vérifiable ;
- intégrer automatiquement la formation au calcul mensuel de performance.

## 2. Rôles et permissions

### Owner / Admin / RH

Ces rôles peuvent :

- créer et modifier une formation ;
- préparer le quiz final ;
- publier ou archiver une formation ;
- affecter tout membre actif de l’organisation ;
- suivre les participants et leurs résultats ;
- accorder une exemption motivée ;
- consulter les certificats ;
- suivre eux-mêmes une formation dans leur espace d’apprentissage.

### Manager

Le Manager peut :

- consulter le catalogue publié ;
- suivre ses propres formations ;
- affecter une formation uniquement aux collaborateurs de ses équipes officielles ;
- consulter la progression et les certificats uniquement dans son périmètre.

Il ne peut pas créer, modifier, publier ou archiver les formations.

### Employee

L’Employé peut :

- consulter les formations publiées ;
- accéder aux formations qui lui sont affectées ;
- s’inscrire à une formation disponible ;
- commencer la formation ;
- ouvrir la ressource pédagogique ;
- passer le quiz final ;
- consulter sa progression et ses résultats ;
- ouvrir, imprimer ou enregistrer son certificat.

Il ne peut pas consulter les résultats privés des autres collaborateurs ni les bonnes réponses du quiz.

## 3. Cycle complet d’une formation

1. Owner, Admin ou RH crée une formation en brouillon.
2. Il renseigne le mois, l’échéance, la durée, le caractère obligatoire, la note minimale et le nombre de tentatives.
3. Il ajoute le lien vers la ressource pédagogique.
4. Il construit le quiz final.
5. La formation est publiée lorsque le quiz contient au moins une question.
6. Les participants sont affectés par Owner/Admin/RH ou par leur Manager officiel.
7. Le participant commence la formation et accède à la ressource.
8. Il soumet le quiz final.
9. Super Leader calcule la note côté serveur.
10. En cas de réussite, la formation passe à « Terminée » et le certificat est généré.
11. La complétion est prise en compte au prochain calcul du classement mensuel.

## 4. Statuts

### Formation

- `draft` : brouillon modifiable, non visible dans le catalogue général ;
- `published` : formation disponible et affectable ;
- `archived` : formation conservée dans l’historique mais retirée du catalogue actif.

### Inscription

- `assigned` : formation affectée, non commencée ;
- `in_progress` : formation commencée ;
- `completed` : quiz réussi et formation validée ;
- `failed` : nombre maximal de tentatives atteint ou quiz non réussi ;
- `overdue` : échéance dépassée ;
- `exempted` : exemption accordée avec motif.

## 5. Certificat de complétion

Lorsqu’une formation avec certificat activé est réussie, Super Leader crée :

- un numéro unique au format `SLA-AAAAMMJJ-XXXXXXXX` ;
- un jeton public de vérification ;
- la date de délivrance ;
- le bénéficiaire ;
- le titre et la durée de la formation ;
- le résultat final ;
- l’organisation émettrice.

Le certificat peut être imprimé ou enregistré en PDF depuis le navigateur. Sa page publique de vérification confirme s’il est actif ou révoqué.

## 6. Intégration à l’Employé du mois

La migration ajoute le critère **Formation et développement** au score mensuel.

Répartition initiale proposée :

| Critère | Poids par défaut |
|---|---:|
| Présence | 20 % |
| Ponctualité | 15 % |
| Réunions | 10 % |
| Rapports journaliers | 15 % |
| Collaboration | 10 % |
| Formation et développement | 10 % |
| KPI métier | 20 % |
| **Total** | **100 %** |

Pour le mois calculé :

- seules les formations obligatoires affectées pour ce mois sont prises en compte ;
- une formation terminée ou exemptée est comptée comme complétée ;
- si aucune formation obligatoire n’est affectée, le collaborateur conserve les points du critère ;
- si une formation obligatoire reste incomplète, le collaborateur devient non éligible à l’Employé du mois jusqu’à régularisation.

Les poids restent configurables par Owner/Admin/RH, avec une somme obligatoire de 100 %.

## 7. Ma journée et notifications

Les formations assignées apparaissent :

- dans le menu **Super Leader Academy** ;
- sur le tableau de bord ;
- dans les accès rapides de **Ma journée** ;
- dans les priorités lorsque l’échéance approche ou est dépassée ;
- dans le centre de notifications après affectation et après le quiz.

## 8. Sécurité

- Toutes les actions sensibles vérifient le rôle et l’organisation côté serveur.
- Le Manager est limité à ses équipes et collaborateurs officiels.
- Le quiz est corrigé avec le client Supabase de service côté serveur.
- La colonne contenant les bonnes réponses n’est pas accessible à l’API publique authentifiée.
- Les inscriptions, tentatives et certificats respectent le périmètre du rôle.
- Les opérations importantes sont inscrites dans le journal d’audit de performance.
- Les certificats publics n’exposent que les informations nécessaires à leur vérification.

## 9. Installation

1. Appliquer les fichiers de la mise à jour dans le projet Super Leader.
2. Exécuter dans Supabase SQL Editor :

```text
supabase/021_super_leader_academy_v1.sql
```

3. Attendre le rechargement du schéma Supabase.
4. Redémarrer Super Leader avec `start.bat`.
5. Se connecter comme Owner/Admin/RH et ouvrir **Super Leader Academy**.

## 10. Limites de la V1 et évolutions prévues

La V1 utilise un lien externe pour la ressource pédagogique. Les évolutions suivantes pourront ajouter :

- hébergement de vidéos et documents dans Supabase Storage ;
- leçons multiples et progression par chapitre ;
- banque de questions et tirage aléatoire ;
- correction manuelle de questions ouvertes ;
- rappels automatiques avant l’échéance ;
- parcours de formation par poste ;
- signature visuelle personnalisée sur le certificat ;
- intégration Zoom pour les formations et réunions en direct ;
- statistiques avancées de développement des compétences.
