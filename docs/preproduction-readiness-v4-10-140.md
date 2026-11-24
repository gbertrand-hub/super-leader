# Super Leader — Préproduction complète et stabilisation V4.10.139–140

**Date :** 24 novembre 2026  
**Statut :** audit préparatoire, lecture seule. **Aucun déploiement ni migration effectué.**  
**Branche de travail :** `feature/v4-10-140-smart-sitemap`.

## État vérifié

| Mesure | Production | Branche QA Canton |
|---|---:|---:|
| Projet Supabase | `jjbuxrlvxnlnrjcorpwt` | `xehstmnqljjhacjiukvc` |
| Tables publiques | **315** | **23** |
| Vues publiques | **1** | **0** |
| Colonnes publiques | **4 735** | **237** |
| Tables publiques avec RLS activé | **315/315** | **23/23** |
| Historique des migrations appliquées | **15** | **14** |
| État de la branche Supabase | principal, sain | **MIGRATIONS_FAILED** malgré projet QA accessible |

*Mesures issues de requêtes SQL de métadonnées et de la liste des branches ; aucune donnée utilisateur n'a été consultée.*

Cette différence explique les erreurs locales `performance_settings`, `daily_report_reopenings` et `profiles.time_zone`. Les tests Canton précédents restent utiles ; **ne pas écraser la branche QA Canton**.

Dans GitHub Golden `v4.10.138`, seulement une partie de l'historique DB figure dans `supabase/migrations/`, et des scripts SQL historiques supplémentaires sont sous `supabase/`. **La reconstruction automatique de toute la base à partir des seules migrations du dépôt n'est pas encore prouvée.**

## Architecture cible

1. **Production verrouillée :** V4.10.138 Golden, domaine `app.ileadglobal.org`, projet Supabase principal. Aucune opération d'écriture, de reset, de merge ou d'application de migration dans ce projet.
2. **QA Canton existante :** conserver la branche et les comptes fictifs qui permettent les tests métier V4.10.139. Pas de changement de base sans plan de sauvegarde.
3. **Préproduction intégrée nouvelle :** projet/branche Supabase **isolé(e)**, schéma complet, pas de données clients réelles, comptes et scénarios fictifs ; déploiement Vercel de test séparé et non aliasé au domaine officiel.
4. **Candidate intégrée :** consolider uniquement les commits V4.10.139 et V4.10.140 **après** audit de conflits, validations techniques et fonctionnelles.

## Séquence de mise en place — gates

### A. Préparation (sans impact production)

- [x] Mesurer l'écart de schéma (315 contre 23 tables).
- [x] Constater l'état `MIGRATIONS_FAILED` de la branche QA Canton.
- [ ] Diagnostiquer l'historique des migrations et rechercher une méthode **schéma uniquement** reproductible, testée en environnement jetable.
- [ ] Confirmer les coûts et les permissions du nouvel environnement ; **aucune ressource payante créée à ce stade**.
- [ ] Prévoir le plan de sauvegarde, de retour arrière et de destruction des données fictives.

### B. Construire un environnement sûr

- [ ] Créer une nouvelle instance de préproduction **sans écraser** la QA Canton.
- [ ] Reproduire et valider le schéma, les fonctions, les politiques RLS, les extensions requises, les triggers et les contraintes ; **aucun export de données d'exploitation**.
- [ ] Générer séparément des comptes Auth, organisations et enregistrements synthétiques ; ne pas cloner les mots de passe, tokens, clés, fichiers personnels ou messages.
- [ ] Configurer uniquement des identifiants de test et des intégrations en mode simulation (emails, paiements, WhatsApp, Zoom, webhooks, cron). Vérifier que l'environnement n'envoie pas de communications réelles.
- [ ] Configurer un environnement Vercel de préproduction avec secrets distincts, protection d'accès et domaine de test (pas `app.ileadglobal.org`).

### C. Conditions minimales de validation

- [ ] Comparer de façon détaillée tables, colonnes, types, contraintes et politiques RLS avec une **référence de schéma figée** (les seuls nombres ne suffisent pas).
- [ ] Tests de connexion et d'autorisation owner/admin/manager/employee + affectations multi-sites.
- [ ] Tests en navigateur sur RH / Ma journée, Academy Finance, Identité 360°, CRM et Canton.
- [ ] QR : seuls les codes du site sélectionné apparaissent ; formulaire d'arrivée, avis et itinéraire Maps.
- [ ] Smart Sitemap : tous les liens attendus, restrictions correctes, diagnostic utilisateur, aucun lien vers une page inexistante.
- [ ] Contrôles `npm run sitemap:audit`, `npx tsc --noEmit`, `npm run build` et essais d'accès refusés.
- [ ] Aucune exception 500 connue dans les parcours tests ; zéro requête dirigée vers les services de production.

## Principes de sécurité et d'exploitation

- **Fail closed** : une permission de navigation n'est pas une permission API. Tester les endpoints eux-mêmes.
- **Pas de copie des données clients** : utiliser un schéma seul et des données fictives, avec validation des politiques.
- **Pas de migration sur le projet principal** durant la préparation ; proscrire `merge_branch`, `reset_branch` et `rebase_branch` sur la branche Canton existante sans plan spécifique.
- **Ne pas augmenter le périmètre en cascade** : les erreurs de modules dues à la base Canton ne sont pas des régressions applicatives démontrées.
- **Déploiement contrôlé** : version candidate uniquement après rapport PASS signé ; promotion au domaine officiel uniquement avec validation explicite.

## Prochaine action technique

Examiner les migrations historiques et la stratégie de reconstruction du schéma. Le statut Supabase `MIGRATIONS_FAILED` et la faiblesse des fichiers de migration versionnés doivent être résolus **avant** de créer une autre branche susceptible d'échouer ou d'entraîner des frais.
