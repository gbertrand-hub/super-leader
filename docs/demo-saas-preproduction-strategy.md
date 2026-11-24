# Super Leader — Stratégie Préproduction & Démonstration SaaS

**Proposition retenue :** valoriser la préproduction intégrée comme *socle technique* d'un espace de démonstration commerciale, **sans mélanger leurs données ni leurs accès**.

## Objectifs distincts

| Environnement | Public | Usage | Données | Opérations |
| --- | --- | --- | --- | --- |
| Production | Entreprises clientes et équipes ILEAD | Exploitation métier réelle | Données réelles par organisation | Production normale, changements sur validation |
| Préproduction intégrée | Équipe technique / testeurs autorisés | Tests d'intégration, migrations, autorisations, régression | Synthétiques, scénario réinitialisable | Fonctionnalités sous test, integrations externes simulées |
| Démonstration SaaS | Prospects, entreprises invitées, équipe commerciale | Découvrir et manipuler Super Leader | Synthétiques exclusivement, sociétés fictives | Fonctionnalités sûres ; aucune communication/paiement/visite réelle |

**Règle non négociable : préproduction et démonstration sont des instances et bases distinctes.** Leurs *scripts de création, versions vérifiées, scénarios fictifs et tests* peuvent être mutualisés. Un prospect ne doit jamais pouvoir toucher à la QA, ni à une future copie de données réelles.

## Parcours commercial envisagé

1. Page de présentation de Super Leader (FR/EN), démonstration des modules, bouton « Demander une démonstration ».
2. Compte prospect à durée limitée ou session accompagnée, avec invitation individuelle, limite de débit et journalisation minimale.
3. Entreprise fictive préconfigurée avec collaborateurs fictifs et rôles fictifs (dirigeant, manager, employé).
4. Parcours guidés : CRM → opportunité → suivi client ; RH → activités → rapport ; Academy → inscription → session ; Finance → aperçu ; Canton → rendez-vous et feedback simulés.
5. Explication des fonctions optionnelles, limites du mode démo, données d'exemple clairement étiquetées.
6. CTA « Demander une offre / Créer mon entreprise » vers un **onboarding de production neuf**. Les données de démonstration ne sont pas migrées vers le compte réel.

## Mesures de protection obligatoires

- Aucun compte, email, nom, fichier, mot de passe, jeton ou pièce jointe de production.
- Auth et sessions isolées, organisation démo isolée par tenant ou session, politiques RLS vérifiées, droits minimaux. Aucun rôle avec service role ni privilèges d'administration technique.
- Emails, WhatsApp, Zoom, Stripe, PayPal, notifications push, cron, webhooks et stockage export externe désactivés ou dirigés vers des simulateurs de test.
- Écriture dans la démo autorisée uniquement sur données synthétiques isolées ; réinitialisation automatique/sur demande avec contrôle de concurrence et suppression des sessions périmées.
- Accès public **contrôlé** (invitation, durée/limitation, anti-abus). Ne pas exposer une instance brute de préproduction.
- Rendre visibles les exemples et badges « DEMO — Données fictives », dans les deux langues.
- Vérifier explicitement accès refusés entre entreprises, routes API, Server Actions, fonctions SQL SECURITY DEFINER, storage et liens QR.
- Déployer sur sous-domaine dédié **à confirmer** ; ne pas présumer que `demo.ileadglobal.org` est configuré.
- Sauvegarde/restauration et métriques d'usage sans données personnelles non nécessaires.
- Documenter coûts/quotas et obtenir approbation avant création de ressources Supabase/Vercel éventuellement facturables.

## Ordre de réalisation et portes de qualité

**Porte 1 — État du schéma :** reconstruire fidèlement le schéma Supabase (315 tables publiques au relevé), fonctions, triggers, RLS, FKs, stockage et autorisations ; ne pas s'appuyer sur les dix migrations versionnées seules.

**Porte 2 — Préproduction privée :** base structure complète, comptes fictifs et intégrations neutralisées ; contrôler Academy / CRM / Finance / RH / Canton et tous les rôles.

**Porte 3 — Package de données démo :** créer un *seed déterministe et réversible*, entreprises fictives et jeux de données interconnectés, scripts de reset, scénarios guidés FR/EN.

**Porte 4 — Contrôles de sécurité :** vérification autorisations réelles, isolation des organisations, protection API / RPC / stockage ; tests anti-abus et de session limitée.

**Porte 5 — Publication démo distincte :** environnement Vercel/Supabase de démonstration séparé et supervisé, accessible aux prospects seulement après validation. Conversion prospect → production **par nouveau compte**, sans copie de données démo.

## État d'implémentation

**Conception ajoutée à la branche audit.** Aucun nouvel environnement, sous-domaine, base, droit ou compte prospect créé ; aucune modification de production ni de QA Canton. La création de préproduction intégrée demeure bloquée par la reproductibilité incomplète du schéma (voir `docs/preproduction-b2-readiness-findings.md`).
