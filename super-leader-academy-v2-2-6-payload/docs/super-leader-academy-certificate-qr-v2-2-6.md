# Super Leader Academy V2.2.6 - Certificat officiel iLEAD et QR sécurisé

## Objectif

Cette version transforme le certificat Academy en justificatif officiel iLEAD Global, imprimable et vérifiable publiquement.

## Éléments du certificat

- Logo officiel iLEAD Global.
- Nom du titulaire.
- Titre de la formation.
- Date de délivrance.
- Durée de la formation.
- Résultat final.
- Taux de présence validé.
- Numéro unique du certificat.
- Statut actif ou révoqué.
- QR code de vérification.
- Adresse publique de vérification affichée en clair.

## Fonctionnement du QR code

Le QR code encode l’adresse publique suivante :

`{NEXT_PUBLIC_SITE_URL}/academy/verify/{verification_token}`

Le jeton de vérification est un UUID aléatoire propre au certificat. La page publique lit directement le statut actuel du certificat dans Supabase. Un certificat révoqué ne peut donc pas apparaître comme valide après révocation.

## Configuration requise

La variable d’environnement `NEXT_PUBLIC_SITE_URL` doit contenir l’adresse publique de production, par exemple :

`https://app.ileadglobal.org`

En local, la valeur reste :

`http://localhost:3002`

## Confidentialité

La page publique affiche uniquement les informations nécessaires à la vérification du certificat. Elle est configurée pour ne pas être indexée par les moteurs de recherche.

## Révocation

Les colonnes de révocation existaient déjà dans `academy_certificates` : statut, date, auteur et motif. Aucun changement SQL n’est nécessaire pour V2.2.6.
