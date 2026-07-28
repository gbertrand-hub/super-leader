# Matrice de tests - Super Leader V2.5

## Installation

- [ ] La migration 030 s’exécute sans erreur.
- [ ] Les plans Starter, Growth, Enterprise et Legacy apparaissent en base.
- [ ] Les organisations existantes conservent leurs modules.
- [ ] `/dashboard/subscription` s’ouvre pour Owner/Admin.
- [ ] Le menu affiche `Abonnement & plans`.

## Catalogue des plans

- [ ] Le platform Owner peut modifier le nom, le statut et la description.
- [ ] Le prix mensuel et annuel peuvent rester vides.
- [ ] Le mode `Sur devis` masque les prix fixes.
- [ ] La limite de collaborateurs est enregistrée.
- [ ] Les fonctionnalités cochées restent enregistrées après actualisation.
- [ ] Le plan Legacy ne peut pas être modifié depuis l’écran normal.

## Attribution

- [ ] Un essai peut être attribué à une organisation.
- [ ] La date de fin d’essai est calculée.
- [ ] Un plan actif peut remplacer l’essai.
- [ ] Une organisation ne possède qu’un abonnement courant.
- [ ] La suspension retire les modules du menu.
- [ ] La réactivation restaure les modules.

## Contrôle des modules

- [ ] Un module non inclus disparaît du menu.
- [ ] Le raccourci correspondant disparaît du tableau de bord.
- [ ] L’URL directe redirige vers l’abonnement.
- [ ] Une action serveur du module refusé ne peut pas être exécutée.
- [ ] La page d’abonnement explique la fonctionnalité manquante.

## Limite des collaborateurs

- [ ] Une invitation est refusée lorsque la limite est atteinte.
- [ ] Une activation est bloquée par le trigger Supabase lorsque la limite est atteinte.
- [ ] Une désactivation libère une place.
- [ ] Un plan illimité n’applique aucune restriction.

## Conversion prospect

- [ ] La conversion crée l’organisation et le Owner.
- [ ] Un essai Starter est créé automatiquement.
- [ ] La conversion reste possible si V2.5 n’est pas encore migré.

## Annulation

- [ ] Le client peut programmer l’annulation.
- [ ] L’accès reste actif jusqu’à la fin de période.
- [ ] Le client peut annuler la demande d’annulation.
- [ ] Le platform Admin peut suspendre avec un motif.

## Coupons et factures

- [ ] Deux coupons ne peuvent pas partager le même code.
- [ ] Un coupon peut être désactivé et réactivé.
- [ ] Une facture manuelle reçoit un numéro unique.
- [ ] Une facture peut passer de Open à Paid.
- [ ] Le client voit uniquement ses propres factures.

## Page publique

- [ ] `/pricing` fonctionne sans migration et affiche un message de préparation.
- [ ] Les plans actifs et publics apparaissent après configuration.
- [ ] Les plans en brouillon ne sont pas affichés.
- [ ] Le bouton de démonstration conduit à `/signup`.

## Permissions

- [ ] Owner plateforme : administration complète.
- [ ] Admin plateforme : administration complète.
- [ ] RH plateforme : aucun accès à la gestion des abonnements.
- [ ] Owner client : consultation de son abonnement et annulation programmée.
- [ ] Admin client : consultation de son abonnement.
- [ ] Manager/Employé : aucun accès à la page de facturation.
