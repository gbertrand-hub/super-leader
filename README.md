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
