# SUPER LEADER — Audit d'architecture & stabilité (V4.10.141 / A0)

**24 novembre 2026 — Audit statique initial, lecture seule — référence : V4.10.138 Golden.**

## 1. Périmètre et méthode

Inspection de l'arborescence GitHub Golden, des fichiers clés (menu, navigation, `proxy.ts`, `layout.tsx`, billing, configuration de build, feature-gate Canton) et interrogation **uniquement des métadonnées** PostgreSQL de Supabase. Aucun déploiement ni migration et aucune lecture de dossiers clients. Le nouveau scanner structurel a été simulé à partir de l'arbre Golden et de ses fichiers de configuration ; ce n'est pas un test de fonctionnement réel.

## 2. Carte des composants (confirmée)

| Dimension | Golden |
|---|---:|
| Fichiers versionnés | 712 |
| Fichiers TypeScript / TSX | 483 |
| Pages Dashboard | 134 |
| API routes | 40 |
| Fichiers Server Actions | 91 |
| Fichiers composants | 64 |
| Scripts SQL | 200 |
| Fichiers de tests conventionnels | 0 |
| Workflows CI GitHub versionnés | 0 |

### Pages par domaines représentatifs (nombre de pages de route, non nombre de fonctionnalités)

- Academy : **32** ; Finance : **13** ; CRM : **11** ; VIP : **11**.
- Contrats : **9** ; RH : **7** ; Service Client : **5**.
- Canton HQ, Ma journée, Identité 360° : routes présentes. Le Smart Sitemap V4.10.140 ajoute sa propre route et est **hors du périmètre Golden de ce rapport**.

### Chaîne de contrôle et dépendances

- Interface : routes `src/app/dashboard/**/page.tsx` et composants.
- Navigation : `src/lib/navigation/dashboard-menu.ts` + `src/components/dashboard/navigation.tsx`.
- Accès : `proxy.ts`, `src/lib/auth/**`, vérifications dans pages/API/Server Actions.
- Abonnements : `src/lib/billing/entitlements.ts`.
- Persistance : `src/lib/supabase/**`, tables et fonctions PostgreSQL.
- Canton : feature gate `src/lib/canton/feature-gate.ts`, actions et sous-systèmes QR.
- Déploiement : Next.js et Vercel. Aucun invariant « le lien est visible donc la page s'ouvre » ne doit être supposé : les règles menu et les contrôles serveur sont distincts.

## 3. Schéma réel et écart QA

**Supabase production, métadonnées seulement :**
- 315 tables publiques, 1 vue, 4 735 colonnes.
- 315 tables publiques avec RLS activé, 169 politiques RLS, 1 153 clés étrangères.
- 178 fonctions de schéma `public` et 178 triggers non internes.
- D'après les préfixes des noms de tables : Academy 74, CRM 23, Finance 22, RH & Performance 17, VIP 24, Canton & Visitors 17, Other/shared 138. Classification approximative par préfixe ; ne reflète pas nécessairement les vraies frontières métier.

**Supabase QA Canton existante :**
- 23 tables publiques, 237 colonnes et 0 vue ; branche marquée `MIGRATIONS_FAILED`.
- Absence confirmée de `performance_settings`, `daily_report_reopenings` et `profiles.time_zone`.
- Résultat : QA Canton **ne peut pas valider transversalement les modules** de Golden ou V4.10.140.
- Ne pas effacer, réinitialiser, merger ou rebases cette branche : elle contient les travaux QA Canton.

**Point critique de reproductibilité** : 200 scripts SQL dans GitHub Golden, mais seuls 10 fichiers sous `supabase/migrations/`; l'historique de migrations Supabase de production n'est pas intégralement représenté par ces 10 fichiers. Une reconstruction « migrations du dépôt seulement » ne peut pas être considérée comme fidèle sans un schéma complet exporté/vérifié.

## 4. Risques priorisés et preuves

| Niveau | Risque | Preuve / observation | Mesure recommandée |
|---|---|---|---|
| P0 | QA transversale non représentative | 315 tables prod vs 23 QA ; routes RH 500 en QA | Préproduction neuve **schéma seul + données synthétiques**, sans toucher Canton QA |
| P0 | Absence de filet de non-régression automatisé | Aucun fichier test .test/.spec et aucun workflow GitHub Actions trouvé | Tests ciblés des parcours critiques et gate de CI indépendante |
| P1 | Compilation pouvant ignorer TypeScript | `next.config.ts` définit `typescript.ignoreBuildErrors: true` | Exécuter `tsc --noEmit` comme gate obligatoire avant build ; ne désactiver la dérogation qu'après stabilisation |
| P1 | Dépendances potentiellement mouvantes | 11 dépendances `latest` dans `package.json` | Épinglage progressif après contrôle du lockfile, pas d'upgrade massif non validé |
| P1 | Droits séparés entre navigation et serveur | `dashboard-menu.ts`, `proxy.ts`, modules | Matrice de rôles, tests d'accès refusés, multi-organisations et sites |
| P1 | Développements parallèles | V4.10.139 Canton vs V4.10.140 Sitemap | Branche de consolidation après tests, comparaison de diffs avant merge |
| P2 | Liens communs et routes dynamiques | Entrées RH/Administration et Finance/Administration | Vérifier la destination par contexte, sans supprimer les doublons légitimes |
| P2 | Usage de localhost QA comme preuve fonctionnelle | Traces d'erreur sur tables QA absentes | Étiquetage explicite Inventaire vs QA fonctionnelle vs Production |

Les niveaux sont des priorités de traitement de l'audit, **pas** des vulnérabilités confirmées.

## 5. Premier instrument de prévention installé

`scripts/audit-architecture.mjs` :
- Parcourt localement les pages, API, actions, scripts SQL et répertoires de tests/CI.
- Vérifie un plancher de 134 routes et la présence de neuf routes critiques.
- Examine les liens statiques de menu et avertit sur les destinations sans page directe (une réécriture peut être légitime).
- Signale l'absence de tests, de CI, de commande TypeScript, le `ignoreBuildErrors`, et les versions flottantes.
- Exécute **zéro** requête réseau ; ne modifie **aucun** fichier ni donnée.
- **Validation réalisée :** syntaxe JS compilée et simulation du scanner sur l'inventaire GitHub Golden ; 0 erreur structurelle, 6 avertissements de maturité. **Reste à exécuter sur un clone local réel**.
- Sans `--strict`, le code de sortie échoue sur les erreurs structurelles ; avec `--strict` il échoue également sur les avertissements. **Ne pas activer `--strict` dans CI avant d'avoir résolu les avertissements préexistants.**

## 6. Stratégie de résolution : 4 portes de qualité

**Porte A — Cartographie / baseline (ouverte ici)** : cartographie Golden, risques et scanner audit (sans impact métier).

**Porte B — Intégration source** : figer un commit de Golden, comparer les changements 139/140, conserver les corrections validées, lancer audit, tsc, lint et build sur le même commit. Pas de création automatique de nouvelles fonctionnalités dans cette étape.

**Porte C — Préproduction intégrée** : instance Supabase nouvelle ; schéma seul vérifié (tables, colonnes, FKs, RLS, triggers, fonctions, storage), comptes fictifs, emails/Stripe/WhatsApp/Zoom neutralisés, secrets distincts, aucune lecture/écriture en production.

**Porte D — Campagne de non-régression** : tests d'accès et navigation owner/admin/hr/manager/employee ; parcours Ma journée, RH, CRM, Academy & finances étudiants, Canton (QR, feedback, attribution multi-sites) ; rapport PASS/FAIL ; production uniquement sur approbation.

## 7. Règles de gouvernance

- V4.10.138 Golden est **intouchable**. La branche `audit/architecture-stability-v4-10-141` sert aux outils/documentations.
- V4.10.139 Canton reste distincte, comme V4.10.140 Sitemap, jusqu'à intégration vérifiée.
- Ne jamais faire passer le succès de l'inventaire de routes pour un test de disponibilité de page.
- Un module ne peut pas être marqué « PASS » sans tests fonctionnels et d'autorisation sur la bonne base.
- Ne pas faire de « hotfix » sur une page pour cacher un manque de schéma QA.
- Les suites de tests doivent être **regroupées**, avec résultat PowerShell lisible, pour limiter les allers-retours utilisateur.

## 8. Prochaine action technique

Construire, en lecture seule, un **manifest de dépendances** sur les modules clés (route → API/action → helpers → tables) puis étudier le mécanisme de reconstruction de schéma à partir des métadonnées réelles. Avant toute nouvelle ressource payante : coûts, isolation, sauvegarde, secrets fictifs et approbation. Ne pas créer ni réinitialiser de branche Supabase sans plan validé.
