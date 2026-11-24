# Super Leader — B4 : procédure de reconstruction du schéma, étape préparatoire

**État au 24 novembre 2026 : préflight disponible, pas de reconstruction ni de migration exécutée.**

## Résultat confirmé de B3

- Comparaison hors ligne : 315 tables production / 23 tables QA Canton, 292 tables manquantes, 16 sur 23 tables communes différentes.
- Fonctions : 178 production / 13 QA Canton, 168 absentes et 3 spécifiques QA.
- `npm run test:stability` : **19 PASS / 0 FAIL**, confirmé sur PowerShell.
- La QA Canton doit rester en place et ne constitue pas l'environnement global de test.

## Dépendances PostgreSQL non couvertes par les seuls nombres de tables

| Constat en lecture seule | Production | QA Canton | Décision |
|---|---|---|---|
| Extensions installées | `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` | `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` | Examiner les besoins de chaque extension avant restauration |
| Vault | 0.3.1 | 0.3.2 | Expliquer la différence de version et éviter la copie de secrets |
| Tâches pg_cron | **1 active** | extension absente | Ne **jamais** réactiver automatiquement les tâches sur préproduction ; simuler cron |
| Buckets Storage | 1 (métadonnées, sans contenu inspecté) | 0 | Définir un bucket fictif si nécessaire, sans copier les objets |
| PostgreSQL production | 17.6 | version non relevée | Vérifier la compatibilité du serveur cible |
| Tables système Auth | 27 | non relevé | Pas de copie d'utilisateurs réels |

Ces résultats proviennent de requêtes de **métadonnées uniquement**. Aucune définition de tâche cron, clé Vault, objet Storage, identité d'utilisateur ou ligne métier n'a été exporté.

## Procédure préparée dans GitHub

`scripts/preproduction/Export-SchemaOnly.ps1`

Par défaut, le script fonctionne en **préflight local** : détecte la présence de Supabase CLI, la disponibilité de Docker, vérifie les flags `supabase db dump`, et refuse de poursuivre si le dépôt local n'est pas relié au projet de production attendu.

Mode facultatif `-ExportSchema` : utilise `supabase db dump --linked --schema public --file <chemin privé>` pour extraire le **schéma public sans données** dans un dossier privé hors des worktrees Git. L'export ne crée **aucune migration**, ne restaure **aucune donnée**, ne crée **aucune instance** et ne modifie **pas** la production.

**Attention :** le SQL contient potentiellement des définitions de fonctions avec des valeurs ou informations sensibles. Il ne doit **jamais** être poussé dans GitHub, joint au chat, envoyé par email ou stocké dans un répertoire synchronisé publiquement. Les définitions des schémas `auth` et `storage` sont exclues par ce dump volontairement limité à `public`. Des adaptations spécifiques devront être évaluées séparément.

Ce script est prévu pour Windows PowerShell ; **son exécution réelle n'a pas encore été validée** sur la machine utilisateur. Ne pas utiliser de mode export avant que le préflight soit validé.

## Étapes restant avant un environnement complet

1. Valider le préflight local ; sauvegarder le schéma **sans données**, dans un espace privé non synchronisé.
2. Examiner l'export localement : objets nécessaires, extensions, compatibilité PostgreSQL 17, fonctions et déclencheurs, droits et politiques RLS.
3. Préparer un environnement temporaire complètement séparé (local si possible), avec services et données fictifs ; garder les tâches cron et intégrations externes désactivées.
4. Restaurer **uniquement** ce schéma dans l'environnement jetable, puis comparer les empreintes structurelles; vérifier les différences de propriétaires/ACL attendues.
5. Tester les parcours Academy, RH, CRM, Finance et Canton, autorisations et accès croisés.
6. Établir ensuite une préproduction hébergée complète avec estimation de coûts et accord spécifique ; l'environnement démo sera un espace **séparé** et ultérieur.

La référence `V4.10.138 Golden`, la QA Canton et la production restent inchangées.
