# Matrice de tests - Super Leader V2.7 Zoom

## A. Installation et configuration

| Test | Compte | Action | Résultat attendu |
|---|---|---|---|
| A1 | Owner | Exécuter `035_zoom_meetings_v2_7.sql` | Migration réussie sans erreur |
| A2 | Owner | Ouvrir `/dashboard/integrations` avant variables Zoom | État Zoom non prêt, aucun secret affiché |
| A3 | Owner | Ajouter les quatre variables et redémarrer | OAuth et Webhook indiqués configurés |
| A4 | Owner | Tester la connexion avec un hôte valide | Message de succès avec l'email Zoom |
| A5 | Owner | Tester un hôte invalide | Message d'erreur lisible, aucune configuration corrompue |
| A6 | Employee | Ouvrir `/dashboard/integrations` | Redirection vers le dashboard |

## B. Création des réunions

| Test | Compte | Action | Résultat attendu |
|---|---|---|---|
| B1 | Owner/Manager autorisé | Créer une réunion sans Zoom | Réunion manuelle inchangée |
| B2 | Owner/Manager autorisé | Cocher Créer automatiquement la réunion Zoom | Réunion Zoom créée, lien participant enregistré |
| B3 | Owner | Créer une activité Réunion dans un événement avec Zoom | Activité et réunion Performance liées |
| B4 | Owner | Créer une activité non-Réunion avec la case Zoom | Aucune réunion Zoom créée |
| B5 | Owner | Provoquer une erreur DB après création Zoom | Réunion Zoom supprimée et aucune donnée partielle conservée |

## C. Parcours participant

| Test | Compte | Action | Résultat attendu |
|---|---|---|---|
| C1 | Employee invité | Ouvrir Ma journée | Réunion et badge Zoom visibles |
| C2 | Employee invité | Cliquer Rejoindre sur Zoom | Zoom s'ouvre avec le lien participant |
| C3 | Employee non invité | Consulter les réunions | Réunion non visible selon les permissions existantes |
| C4 | Manager créateur | Cliquer Démarrer comme hôte | Lien hôte obtenu à la demande et Zoom s'ouvre |
| C5 | Employee | Tenter l'action hôte directement | Action refusée |

## D. Webhooks et présence

| Test | Action | Résultat attendu |
|---|---|---|
| D1 | Valider l'URL webhook dans Zoom | Zoom accepte l'URL |
| D2 | Envoyer un webhook avec signature invalide | Réponse 401, aucun événement traité |
| D3 | Envoyer deux fois le même événement | Le second est identifié comme doublon |
| D4 | Participant interne rejoint à l'heure | Statut Présent et heure d'arrivée enregistrés |
| D5 | Participant rejoint après le délai de grâce | Statut Retard et minutes de retard calculées |
| D6 | Participant quitte puis rejoint de nouveau | Durées des sessions additionnées |
| D7 | Participant externe sans email | Session technique conservée, aucun collaborateur modifié automatiquement |
| D8 | Réunion terminée, invité sans session | Statut Absent après synchronisation finale |

## E. Synchronisation finale

| Test | Action | Résultat attendu |
|---|---|---|
| E1 | Cliquer Synchroniser la présence après la réunion | Rapport Zoom récupéré et présences mises à jour |
| E2 | Synchroniser deux fois | Pas de double comptage des sessions de rapport |
| E3 | Durée Zoom de 3600 secondes | Super Leader affiche 60 minutes |
| E4 | Présence inférieure au minimum configuré | Statut Absent |
| E5 | Présence suffisante mais retard supérieur à la grâce | Statut Retard |
| E6 | Rapport Zoom non encore disponible | Erreur enregistrée et nouvelle tentative possible |

## F. Sécurité et rôles

| Test | Compte | Résultat attendu |
|---|---|---|
| F1 | Owner/Admin | Peut configurer Zoom |
| F2 | HR/Manager | Ne peut pas modifier la configuration Zoom |
| F3 | Manager | Ne voit que les réunions autorisées par son périmètre |
| F4 | Employee | Ne voit jamais le lien hôte |
| F5 | Organisation sans `api_integrations` | Module bloqué selon le plan |
| F6 | Inspection des pages | Aucun Client Secret ni Webhook Secret affiché |

## G. Production

| Test | Action | Résultat attendu |
|---|---|---|
| G1 | Ajouter les variables Vercel puis déployer | Intégration prête en production |
| G2 | Déclarer `https://app.ileadglobal.org/api/zoom/webhook` | Validation Zoom réussie |
| G3 | Créer une réunion réelle de test | Création, accès et présence fonctionnent |
| G4 | Vérifier Supabase | Événements webhook traités et audités |
