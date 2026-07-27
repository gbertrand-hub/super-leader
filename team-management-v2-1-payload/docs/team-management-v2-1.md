# Super Leader V2.1 - Gestion complete des departements et equipes

## Objectif

Transformer la page `Departements & equipes` en un veritable module de configuration de la structure organisationnelle.

## Fonctionnalites

- Les cartes d'equipe sont cliquables.
- Chaque equipe possede une fiche de configuration.
- Owner et Admin peuvent creer, renommer, modifier le departement, archiver et restaurer une equipe.
- Owner, Admin et RH peuvent affecter ou retirer le Manager et les membres.
- Le Manager voit uniquement les equipes dont il est le responsable officiel.
- Les collaborateurs d'une equipe alimentent automatiquement le perimetre de visibilite du Manager dans les autres modules.
- L'historique conserve les changements de responsable, de membres et de cycle de vie.
- Les equipes archivees ne sont pas supprimees et conservent leur historique.

## Matrice de permissions

| Operation | Owner | Admin | RH | Manager | Employee |
|---|---:|---:|---:|---:|---:|
| Voir toutes les equipes | Oui | Oui | Oui | Non | Non |
| Voir ses equipes | Oui | Oui | Oui | Oui | Non dans ce module |
| Creer une equipe | Oui | Oui | Non | Non | Non |
| Modifier nom/departement | Oui | Oui | Non | Non | Non |
| Affecter le Manager | Oui | Oui | Oui | Non | Non |
| Ajouter/retirer des membres | Oui | Oui | Oui | Non | Non |
| Archiver/restaurer | Oui | Oui | Non | Non | Non |
| Consulter l'historique | Oui | Oui | Oui | Ses equipes | Non |

## Migration Supabase

Executer apres la migration 019 :

```text
supabase/020_team_management_v2_1.sql
```

Cette migration ajoute notamment :

- `teams.manager_id` ;
- `teams.is_active`, `teams.archived_at` et `teams.updated_at` ;
- `team_activity_log` ;
- les politiques RLS de la version 2.1 ;
- l'extension du perimetre Manager aux membres des equipes qu'il dirige.

## Regle importante

Le Manager d'une equipe n'est pas ajoute comme membre ordinaire de cette meme equipe. Il est enregistre dans `teams.manager_id`. Les collaborateurs sont enregistres dans `team_members`.

Le superviseur des rapports journaliers reste configurable dans le planning individuel. L'affectation d'equipe determine la visibilite generale du Manager ; le planning determine les operations specifiques de validation des rapports.
