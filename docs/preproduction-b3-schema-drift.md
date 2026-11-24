# Super Leader — B3, empreintes structurelles de schéma (audit en lecture seule)

**Date de capture : 24 novembre 2026.** Branche de travail : `audit/architecture-stability-v4-10-141`.

## Résultat nouveau et vérifiable

Nous avons interrogé les **métadonnées structurelles** des deux projets Supabase, sans requêter de lignes commerciales, de profils ou de données clients.

| Objet du schéma public | Production | QA Canton |
|---|---:|---:|
| Tables | **315** | **23** |
| Fonctions/procédures | **178** | **13** |
| Vues | **1** | **0** |
| Extensions installées (tous schémas) | **6** | **6** |
| Tables production absentes de QA | — | **292** |
| Tables QA absentes de production | — | **0** |
| Tables communes avec au moins une différence structurelle détectée | — | **16 sur 23** |

Parmi les 16 tables communes différentes figurent `organization_members`, `organizations`, `profiles`, `crm_clients`, `crm_follow_up_tasks`, `crm_interactions`, et certaines tables Canton. Les écarts peuvent concerner colonnes, contraintes, politiques RLS, triggers, index et privilèges SQL.

**Conclusion technique :** la QA Canton actuelle n'est ni une copie complète ni une reproduction structurelle de la production. Les tests transversaux RH, Finance, Academy et CRM nécessitent un **autre environnement** dont le schéma a été reproduit et vérifié.

## Fichiers nouveaux

- `scripts/sql/public-schema-fingerprint.sql` : requête SQL **lecture seule**, sans `SELECT` sur les données métiers ; calcule des empreintes MD5 de définitions structurelles. Ne permet pas de restaurer le schéma.
- `docs/schema-fingerprints/production-2026-11-24.json` : référence par objet pour le schéma public de production.
- `docs/schema-fingerprints/canton-qa-2026-11-24.json` : état de la QA Canton.
- `scripts/compare-schema-fingerprints.mjs` : compare deux fichiers **hors ligne**, sans réseau ni écriture en base.
- `tests/schema-fingerprint.test.mjs` : 3 tests automatisés de dérive structurelle, notamment la divergence connue 315/23.

Commandes : `npm run audit:schema-drift` et `npm run test:stability`. La suite est maintenant composée de **19 tests** à valider en local et en CI. Le comparateur signale `STRUCTURALLY IDENTICAL: NO` pour production contre QA : c'est le résultat *attendu*. L'option `--require-match` est destinée **uniquement** à la future préproduction complète, où un désaccord devra empêcher une validation.

## Limites et sécurité

Les empreintes ne constituent pas une sauvegarde et ne couvrent pas automatiquement tous les schémas gérés (notamment `auth`/`storage`), données, ACL de schémas, buckets, tâches externes, secrets, comportement des politiques ou appels RPC. MD5 sert ici d'indice de dérive, non de preuve cryptographique.

Ne pas recréer de compte Auth à partir de données production ni restaurer un dump de données. La politique de permissions doit être **testée avec de nouveaux comptes fictifs**. Une future reconstruction du schéma devra utiliser un outil documenté et être exercée d'abord dans une base temporaire et isolée.

## Ordre de travail restant

1. Établir la procédure reproductible d'export **schéma uniquement**, ses dépendances PostgreSQL/extension et l'absence de données personnelles dans l'artefact.
2. Vérifier les particularités des 6 extensions et des objets hors `public` nécessaires au fonctionnement.
3. Reconstituer le schéma sur une **base jetable isolée** et comparer les empreintes structurelles, en distinguant les écarts techniques de rôles propriétaires attendus.
4. Inspecter les fonctions `SECURITY DEFINER` et leur périmètre d'exécution avant tout accès public ou démo.
5. Créer une préproduction intégrée privée après vérification des coûts et validation ; ensuite seulement tests fonctionnels multi-organisations et candidats V4.10.139–140.

**Important :** le sous-domaine `demo.ileadglobal.org` est réservé dans la stratégie commerciale, mais ne constitue pas une tâche prioritaire de ce chantier.

**Aucune migration, aucun nouvel environnement payant, aucun déploiement Vercel et aucune écriture en production ou QA Canton n'ont été effectués.**
