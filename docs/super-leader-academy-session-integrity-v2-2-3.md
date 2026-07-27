# Super Leader Academy V2.2.3 - Intégrité des séances et gouvernance du quiz

## Objectif

Cette version garantit qu'une formation récurrente possède de vraies séances, que les inscriptions ne sont pas dupliquées et que l'évaluation finale respecte la présence minimale configurée.

## Règles fonctionnelles

- Une seule inscription est conservée par collaborateur et par formation.
- Cliquer plusieurs fois sur « Commencer » ne crée jamais une nouvelle inscription.
- Les compteurs de l'employé utilisent uniquement les formations publiées et réellement visibles.
- Les séries actives peuvent être réparées afin de recréer les séances manquantes sans dupliquer les séances existantes.
- Les feuilles de présence sont créées pour chaque participant et chaque séance.
- Si la présence minimale est supérieure à 0 %, le quiz reste verrouillé tant qu'aucune séance n'existe.
- Le quiz reste verrouillé tant que le participant n'atteint pas le taux de présence requis.
- Le certificat reste conditionné à la réussite du quiz et à la présence minimale.

## Réparation automatique

La migration `024_academy_session_integrity_v2_2_3.sql` analyse toutes les séries actives existantes et génère les séances manquantes. Elle ne crée pas de doublons grâce à la contrainte unique `(course_id, starts_at)`.

Un bouton « Réparer et générer les séances » est également proposé aux administrateurs lorsqu'une formation possède une série active mais aucune séance visible.

## Sécurité

La réparation manuelle est réservée aux rôles Owner, Admin et RH. Le contrôle est appliqué dans l'action serveur et dans la fonction SQL sécurisée.
