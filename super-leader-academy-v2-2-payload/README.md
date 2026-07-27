# Super Leader - Starter V1

Base technique de l'application Super Leader.

## Installation Windows

1. Extraire le ZIP.
2. Ouvrir le dossier dans Visual Studio Code.
3. Double-cliquer sur `install.bat` ou executer `./install.ps1` dans PowerShell.
4. Ouvrir `.env.local` et remplacer les valeurs par votre Project URL et votre Publishable Key Supabase.
5. Executer `start.bat` ou `npm run dev`.
6. Ouvrir http://localhost:3002.

## Important

- Ne jamais placer la cle `service_role` dans `.env.local` avec un prefixe `NEXT_PUBLIC_`.
- Le fichier `.env.local` n'est pas inclus avec de vraies cles.
- Le port de developpement est fixe a 3002.

## Verification

```powershell
npm run build
```

## Mise a jour - Roles, permissions et confidentialite V2

Apres la configuration initiale de Supabase, executer les migrations dans l'ordre. Pour cette version, les dernieres migrations requises sont :

```text
supabase/019_roles_permissions_privacy_v2.sql
supabase/020_team_management_v2_1.sql
```

La migration 019 renforce les roles et la confidentialite. La migration 020 transforme les equipes en fiches configurables, ajoute le Manager officiel, l'archivage, l'historique et le perimetre Manager base sur les membres des equipes dirigees.

Documentation :

- `docs/roles-permissions-privacy-v2.md`
- `docs/permissions-v2-test-matrix.md`
- `docs/team-management-v2-1.md`
- `docs/team-management-v2-1-test-matrix.md`
- `docs/manager-view-v2-1-2.md`
- `docs/manager-view-v2-1-2-test-matrix.md`

## Mise à jour - Super Leader Academy V2.2

Après les migrations précédentes, exécuter également :

```text
supabase/021_super_leader_academy_v1.sql
```

Cette migration active le catalogue mensuel de formations, les quiz, les certificats vérifiables et le critère Formation dans l’Employé du mois.

Documentation :

- `docs/super-leader-academy-v1.md`
- `docs/super-leader-academy-v1-test-matrix.md`
