# Correctif des fuseaux horaires IANA V1

Le moteur JavaScript `Intl.DateTimeFormat` attend un identifiant de fuseau horaire IANA, par exemple :

- `Africa/Douala` pour le Cameroun ;
- `Europe/Dublin` pour l'Irlande ;
- `America/Chicago` pour Dallas, Texas ;
- `UTC` pour le temps universel.

Un libelle d'affichage comme `Afrique Centrale` n'est pas un identifiant technique valide et provoquait une erreur `RangeError` dans le Planning.

Ce correctif :

1. convertit automatiquement les anciens libelles connus ;
2. utilise un fuseau valide de secours au lieu de faire tomber la page ;
3. normalise les nouvelles saisies dans les actions serveur ;
4. ajoute une validation dans Supabase pour empecher de nouvelles valeurs invalides ;
5. corrige `Afrique Centrale` en `Africa/Douala`.
