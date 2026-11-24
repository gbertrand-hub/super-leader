# Super Leader — B2 : état de préparation de la préproduction intégrée

**Relevé de métadonnées : 24 novembre 2026.** Source GitHub Golden V4.10.138 et métadonnées Supabase lues sans aucune modification. Le fichier `docs/preproduction-schema-metadata-baseline-v4-10-141.json` est un instantané daté, pas une vérité automatiquement actualisée.

## État confirmé

| Indicateur | Supabase production | Supabase QA Canton |
|---|---:|---:|
| Tables dans `public` | 315 | 23 |
| Colonnes `public` | 4 735 | 237 |
| Vues `public` | 1 | 0 |
| Tables avec RLS activée | 315 | 23 |
| Migrations enregistrées | 15 | 14 |
| Statut branche QA | — | `MIGRATIONS_FAILED` |

Le dépôt Golden ne contient que **10** fichiers de migration dans `supabase/migrations/`. Sur les 15 migrations enregistrées côté production, **6** n'ont pas de fichier équivalent dans ce dossier ; un des dix fichiers versionnés ne figure pas dans cet historique. Les 190 autres scripts SQL hors dossier migrations ne sont pas automatiquement équivalents à une chaîne de migration reproductible. **Aucune restauration automatisée du schéma ne doit être lancée sur cette seule base.**

## Examen de sécurité : signaux à vérifier, pas vulnérabilités établies

- RLS est activée sur **315/315** tables publiques. **195** tables publiques n'ont pas de politique explicite repérée dans `pg_policies`. Cela peut être volontaire (accès refusé par défaut). Ne pas transformer ce nombre en constat de fuite.
- Il existe **117** fonctions `SECURITY DEFINER` sous `public`, dont **82** avec un droit d'exécution effectif pour le rôle `anon`. Parmi ces 82 fonctions, **39** retournent `trigger` et **43** ont un autre type de retour. Cette distinction réduit le champ de revue prioritaire des fonctions directement invocables, mais la simple présence d'un droit EXECUTE ne prouve pas une exploitation possible.
- La vue publique relevée, `academy_student_confirmed_allocations`, porte `security_invoker=true`. Les droits des rôles et les politiques de ses tables sous-jacentes restent à auditer dans le contexte des appels réels.
- Aucun code de fonction privilégiée ni aucune donnée utilisateur n'ont été exportés. Une **revue individuelle autorisations / `search_path` / paramètres / mutations / vérification `auth.uid()`** reste nécessaire pour les 43 fonctions non-trigger avant de conclure.
- Ne jamais « corriger » ces signaux en appliquant des GRANT/REVOKE ou de nouvelles politiques en production sans analyse de dépendances et scénario de retour arrière.

## Résultat de la porte B2

**ÉTAT : BLOQUÉ POUR RECONSTRUCTION AUTOMATIQUE DU SCHÉMA.**

La première étape est d'établir un schéma de référence *structure uniquement* et sa méthode de reproduction sur un environnement jetable ; elle doit être validée en comparant tables, colonnes, fonctions, FKs, triggers, RLS et storage, pas simplement leurs décomptes.

La branche QA Canton doit rester intacte, même si son statut de migrations est dégradé. La préproduction complète devra être **distincte**, utiliser des données synthétiques et des secrets de test, et désactiver les envois externes (Zoom, WhatsApp, Stripe, email, webhooks, tâches programmées). Aucun nouveau projet ou branche Supabase n'a été créé.

## Outil ajouté

`node scripts/audit-preproduction-readiness.mjs`

Ce script effectue, **sans réseau**, la comparaison entre l'historique connu de la production à la date du relevé et les fichiers de migration présents dans le dépôt. Il émet un état `NOT READY` et expose les écarts à corriger ; il ne lance aucune migration.

## Critères de sortie

1. Inventaire complet du schéma de référence, sans données clients.
2. Reproductibilité du schéma démontrée sur une base jetable isolée.
3. Revue des fonctions privilégiées et des permissions des API.
4. Tests de séparation des organisations et des rôles sur utilisateurs fictifs.
5. Confirmation des coûts et autorisation explicite avant toute création de ressource potentiellement payante.
6. Seulement ensuite : tests RH, Academy, CRM, Finance et Canton sur la même préproduction.

**Production : inchangée. V4.10.138 Golden : inchangée. QA Canton : inchangée.**
