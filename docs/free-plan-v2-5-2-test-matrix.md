# Matrice de tests — Super Leader V2.5.2

## Catalogue public

- [ ] `/pricing` affiche Free, Starter, Growth et Enterprise.
- [ ] Free affiche 0 USD / Gratuit.
- [ ] Free indique 5 utilisateurs maximum, propriétaire inclus.
- [ ] Le bouton Free ouvre `/signup?plan=free`.
- [ ] Le plan interne Legacy Full Access reste masqué.

## Inscription Free

- [ ] La page affiche « Plan Free sélectionné ».
- [ ] L’effectif est limité à 1–5.
- [ ] Le bouton indique une demande d’activation gratuite.
- [ ] La demande enregistre `requested_plan_code = free`.
- [ ] Une tentative de soumission Free avec un autre effectif est refusée côté serveur.

## Acquisition

- [ ] Le pipeline affiche le plan demandé.
- [ ] Le statut `Plan Free approuvé` est disponible.
- [ ] La conversion n’est pas possible avant approbation.
- [ ] La conversion crée l’organisation et le propriétaire.
- [ ] La conversion attribue Free avec le statut `active`.
- [ ] Free n’a ni date de fin d’essai ni date de fin de période.
- [ ] En cas d’échec d’abonnement, l’organisation et le membership sont annulés.

## Limites et fonctionnalités

- [ ] Le propriétaire compte comme premier utilisateur.
- [ ] Quatre collaborateurs supplémentaires peuvent être ajoutés.
- [ ] La sixième place totale est refusée.
- [ ] Les données existantes restent disponibles après atteinte de la limite.
- [ ] CRM/Ventes redirige vers Abonnement & plans.
- [ ] Feedback, Reconnaissance, Performance, Academy et Croissance restent accessibles.

## Conversion vers Starter

- [ ] La page Abonnement affiche un bloc de limite Free.
- [ ] Le lien de comparaison ouvre `/pricing`.
- [ ] L’administrateur plateforme peut attribuer Starter manuellement.
- [ ] Après attribution Starter, la limite passe à 25 utilisateurs.
