# Super Leader - Matrice de tests Roles, permissions et confidentialite V2

Cette matrice doit etre executee apres l'installation de `supabase/019_roles_permissions_privacy_v2.sql`.

## Comptes de test recommandes

Creer au minimum :

- 1 Owner ;
- 1 Admin ;
- 1 HR ;
- 2 Managers appartenant a des perimetres differents ;
- 2 Employees supervises par le Manager A ;
- 1 Employee supervise par le Manager B ;
- 1 Employee sans superviseur ;
- 1 compte desactive ;
- 1 compte avec mot de passe temporaire.

## Tests d'acces aux pages

| Test | Owner | Admin | HR | Manager | Employee |
|---|---:|---:|---:|---:|---:|
| Ouvrir `/dashboard/company` | Autorise | Autorise | Autorise | Refuse | Refuse |
| Ouvrir `/dashboard/team` | Autorise | Autorise | Autorise | Autorise dans son perimetre | Refuse |
| Ouvrir `/dashboard/members` | Autorise | Autorise | Autorise | Autorise dans son perimetre | Refuse |
| Ouvrir `/dashboard/sales` | Autorise | Autorise | Refuse | Autorise dans son perimetre | Autorise sur ses donnees |
| Ouvrir `/dashboard/collections` | Autorise | Autorise | Refuse | Autorise dans son perimetre | Autorise sur ses dossiers |
| Ouvrir `/dashboard/crm` | Autorise | Autorise | Refuse | Autorise dans son perimetre | Autorise sur ses clients |
| Ouvrir `/dashboard/feedback-automation` | Autorise | Autorise | Refuse | Lecture de son perimetre | Refuse |
| Ouvrir `/dashboard/reports` | Autorise | Autorise | Autorise | Autorise dans son perimetre | Refuse |
| Ouvrir les parametres Performance | Autorise | Autorise | Autorise | Refuse | Refuse |

Tester chaque URL en cliquant dans le menu puis en la saisissant directement dans le navigateur.

## Tests du perimetre Manager

Pour le Manager A :

1. L'ecran Membres affiche le Manager A et uniquement ses collaborateurs supervises.
2. Le Manager B et ses collaborateurs n'apparaissent jamais.
3. L'Employee sans superviseur n'apparait pas.
4. Les listes deroulantes de ventes, CRM, recouvrement, rapports, KPI et planning respectent le meme perimetre.
5. Une tentative de modification par identifiant direct d'un collaborateur hors perimetre est refusee cote serveur.
6. Un export CSV ne contient aucune ligne hors perimetre.
7. Une piece jointe d'un autre perimetre retourne un refus d'acces.
8. Une notification ne revele pas de donnees appartenant au Manager B.

Repeter les memes tests avec le Manager B.

## Tests HR

1. HR peut consulter et administrer les membres, les absences, les presences, les rapports et les performances.
2. HR ne voit pas les liens Ventes, Recouvrement, CRM et Automatisation des feedbacks.
3. Une ouverture directe de ces URL est refusee.
4. Les actions serveur de produit, vente, paiement, commission, recouvrement et CRM sont refusees.
5. HR peut calculer le classement global, traiter les contestations et publier l'Employe du mois.

## Tests Owner et Admin

1. Owner et Admin voient toute l'organisation.
2. Admin ne peut ni modifier le role de l'Owner, ni desactiver son compte.
3. Owner conserve toutes les fonctions de gouvernance.
4. Les operations financieres sensibles restent limitees a Owner/Admin.
5. Les changements sensibles sont inscrits dans le journal d'audit.

## Tests Employee

1. L'Employee ne voit que ses ventes, ses clients, ses dossiers de recouvrement, ses presences, ses absences, ses rapports, son score et son planning.
2. Il ne peut pas ouvrir les pages Entreprise, Equipes, Membres, Rapports globaux ou Parametres RH.
3. Il peut selectionner les collegues necessaires dans Feedback et Reconnaissance sans voir leurs donnees privees.
4. Il ne peut ni telecharger une piece jointe d'un collegue, ni exporter ses donnees.
5. Une tentative d'acces direct avec un identifiant appartenant a un autre utilisateur est refusee.

## Comptes particuliers

### Compte desactive

- La connexion ne donne acces a aucun module de l'organisation.
- Les politiques RLS ne retournent aucune donnee organisationnelle.

### Mot de passe temporaire

- L'utilisateur est redirige vers la creation de son mot de passe personnel.
- Il ne peut pas ouvrir le tableau de bord avant cette operation.
- Apres changement du mot de passe, son role et son perimetre normal sont appliques.

## Validation technique

- Executer `npm run build` dans un environnement ou les dependances sont installees.
- Tester les cinq roles dans des sessions ou navigateurs distincts.
- Inspecter les reponses reseau : aucune donnee hors perimetre ne doit etre retournee, meme si elle est masquee par l'interface.
- Tester les exports, telechargements et actions avec des identifiants modifies manuellement.
- Verifier les policies Supabase avec un JWT de chaque role.
