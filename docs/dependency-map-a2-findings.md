# Super Leader — Cartographie des dépendances A2

**Date :** 24 novembre 2026  
**Référence :** `V4.10.138 Golden` (134 pages).  
**Source :** sortie PowerShell de `node scripts/map-dependencies.mjs` sur le worktree Golden `super-leader-v4-10-141-audit`.

## Contrôle observé

| Mesure | Valeur |
|---|---:|
| Pages Dashboard | 134 |
| Routes API | 40 |
| Fichiers source analysés | 353 |
| Routes avec au moins une importation locale non résolue | 1 |
| Routes présentant des appels dynamiques `.from(...)` suspects | 73 |

Les deux dernières lignes sont **des signaux heuristiques à inspecter**, pas des dysfonctionnements confirmés. Une dépendance vers un fichier importé ne signifie pas que tout son code s'exécute à chaque visite.

## Code mutualisé — portée potentielle sur les pages du Dashboard

| Code | Routes référentes |
|---|---:|
| `src/i18n/config.ts`, `messages.ts`, `server.ts` | 82 chacune |
| `src/lib/auth/permissions.ts` | 53 |
| `src/lib/auth/scope.ts` | 53 |
| `src/lib/billing/entitlements.ts` | 35 |
| `src/lib/storage/private-attachments.ts` | 29 |
| `src/lib/academy/access.ts` | 24 |
| `src/lib/timezone.ts` | 20 |
| `src/lib/auth/access-control.ts` | 19 |
| `src/lib/notifications/service.ts` | 14 |

**Priorité :** travailler sur autorisations, périmètre de données, abonnements, internationalisation et pièces jointes avec des tests transversaux. La navigation globale et les layouts constituent également des points d'impact : leur dépendance à une page peut être indirecte.

## Échantillon de dépendances vers des tables

| Route | Références de tables (directes + transitives) | Fichiers actions |
|---|---:|---:|
| `/dashboard/my-day` | 55 | 2 |
| `/dashboard/hr` | 20 | 0 |
| `/dashboard/crm` | 24 | 1 |
| `/dashboard/finance` | 15 | 1 |
| `/dashboard/academy/students/finance-control` | 19 | 1 |
| `/dashboard/admin/identity-audit` | 8 | 1 |
| `/dashboard/canton-visitors` | 21 | 3 |

Ces valeurs reflètent des correspondances statiques de requêtes `.from()` dans la chaîne des imports. Elles ne signifient **ni** que ces tables sont consultées à chaque chargement **ni** que ce sont les seules tables requises.

## Instrument A2 renforcé

`scripts/map-dependencies.mjs` prend désormais en charge :

- `--impact src/lib/auth/permissions.ts` : pages Dashboard et routes API potentiellement touchées par la modification d'un fichier.
- `--unresolved` : liste les routes et les chemins des imports non résolus.
- `--focus /dashboard/hr` : détail d'une page.
- Les dépendances globales via `src/app/layout.tsx`, `src/app/dashboard/layout.tsx` et `proxy.ts` sont signalées distinctement.

**À vérifier localement :** les nouvelles options ont été ajoutées à GitHub et leur syntaxe JavaScript validée. Leur précision doit être confrontée à l'arbre réel et aux modules métier.

## Suite proposée

1. Identifier le seul import non résolu (vrai défaut ou faux positif).
2. Étudier le résultat des impacts autorisations, abonnements et layouts.
3. Construire des tests automatiques pour les parcours qui traversent RH, CRM, Finance, Academy et Canton.
4. Corréler ces chemins avec le schéma de préproduction à reproduire, sans toucher aux données réelles.

**Garde-fou :** branche audit seulement ; aucun changement produit, aucune migration Supabase, aucun déploiement Vercel.
