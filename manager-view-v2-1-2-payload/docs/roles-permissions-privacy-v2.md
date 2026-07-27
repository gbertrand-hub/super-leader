# Super Leader - Roles, permissions et confidentialite V2

## Matrice appliquee

- **Owner** : acces a toute l'organisation et a tous les modules.
- **Admin** : acces a toute l'organisation, sans pouvoir modifier ou desactiver l'Owner.
- **HR** : personnes, equipes, absences, performance et rapports RH. Aucun droit de gestion commerciale ou financiere.
- **Manager** : lui-meme, les collaborateurs dont `member_work_schedules.supervisor_id` correspond a son compte et les membres des equipes dont il est le responsable officiel.
- **Employee** : ses propres donnees, plus l'annuaire minimal necessaire au feedback et a la reconnaissance via les pages serveur.

## Couches de protection

1. Menu et raccourcis adaptes au role.
2. Protection des URL dans `proxy.ts`.
3. Verification des actions serveur sensibles.
4. Filtrage des requetes avec le perimetre du manager.
5. Politiques Supabase RLS pour les profils, membres, equipes et affectations.
6. Protection du mot de passe temporaire conservee.

## Installation Supabase

Executer dans SQL Editor :

```text
supabase/019_roles_permissions_privacy_v2.sql
```

## Regle de supervision

Le perimetre du Manager est calcule avec deux sources complementaires :

```text
member_work_schedules.supervisor_id = manager
teams.manager_id = manager -> team_members.user_id
```

Le Manager peut gerer les affectations de membres uniquement dans les equipes qu'il dirige et uniquement pour les collaborateurs deja visibles dans son perimetre.

## Notifications

Les notifications sont toujours creees pour un destinataire precis. La creation est maintenant refusee lorsque le destinataire n'a plus de membership actif dans l'organisation. Les rappels de rapport destines au Manager utilisent directement le `supervisor_id` actif du collaborateur.

## Classement et parametres RH

- Le Manager peut saisir les KPI de ses collaborateurs supervises.
- Le calcul du classement global, le verrouillage, la publication de l'Employe du mois et les parametres RH sensibles sont reserves a Owner, Admin et HR.
- Les positions globales ne peuvent donc pas etre ecrasees par un calcul limite a une seule equipe.
