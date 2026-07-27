# Matrice de tests - Gestion des equipes V2.1

## Preparation

1. Executer `supabase/020_team_management_v2_1.sql`.
2. Disposer d'au moins un compte Owner, un Manager et deux Employes.
3. Creer deux equipes de test.

## Owner / Admin

- Ouvrir une carte d'equipe.
- Modifier le nom et le departement.
- Affecter un Manager.
- Ajouter un Employe.
- Retirer un Employe.
- Archiver puis restaurer l'equipe.
- Verifier que chaque action apparait dans l'historique.

Resultat attendu : toutes les operations reussissent, sauf l'affectation du Owner comme membre ou d'un compte non-Manager comme responsable.

## RH

- Ouvrir toutes les equipes.
- Affecter un Manager.
- Ajouter et retirer des membres.
- Essayer de modifier le nom de l'equipe.
- Essayer d'archiver l'equipe.

Resultat attendu : les affectations reussissent ; les modifications structurelles sont absentes de l'interface et refusees cote serveur.

## Manager

- Se connecter avec le Manager affecte a l'equipe A.
- Ouvrir `Departements & equipes`.
- Verifier que seule l'equipe A apparait.
- Ouvrir la fiche de l'equipe.
- Verifier que les formulaires de modification structurelle et de changement du Manager sont absents.
- Verifier que l'ajout et le retrait de membres sont disponibles uniquement pour ses equipes et ses collaborateurs visibles.
- Ouvrir `Membres & affectations`.
- Verifier que seuls les collaborateurs des equipes dirigees apparaissent.

Resultat attendu : aucune autre equipe ni aucun autre collaborateur de l'organisation n'est visible. Les affectations internes a son perimetre reussissent ; toute requete hors perimetre est refusee.

## Employe

- Saisir directement `/dashboard/team`.

Resultat attendu : redirection vers le tableau de bord.

## Cycle de vie

- Archiver une equipe.
- Verifier qu'elle disparait de la vue du Manager.
- Verifier qu'elle reste visible dans la section archivee du Owner/Admin/RH.
- Restaurer l'equipe.

## Changement de role ou desactivation du Manager

- Retirer le role Manager au responsable d'une equipe, ou desactiver son compte.
- Recharger la fiche de l'equipe.

Resultat attendu : l'affectation du responsable est retiree, la supervision de planning courante est nettoyee et une trace est ajoutee a l'historique.
