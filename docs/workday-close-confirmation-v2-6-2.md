# Super Leader V2.6.2 — Confirmation fiable de clôture

## Objectif

Empêcher la clôture immédiate d'une journée lorsque le collaborateur clique par erreur sur le bouton de fin de journée.

## Correction

Le composant partagé `ConfirmSubmitButton` n'utilise plus la boîte native `window.confirm`, qui peut être ignorée ou supprimée selon le navigateur, l'hydratation ou l'état de la page. Il affiche désormais une fenêtre modale Super Leader avant toute soumission.

## Règles

- Le premier clic n'exécute jamais l'action serveur.
- `Annuler` ferme la fenêtre sans modifier la journée.
- `Confirmer` soumet le formulaire une seule fois.
- Le bouton est désactivé pendant la soumission.
- La confirmation s'applique aussi aux réouvertures et aux soumissions de rapport qui utilisent le même composant.
- Les textes sont disponibles en français et en anglais.

## Migration

Aucune migration Supabase n'est requise.
