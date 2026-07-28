# Matrice de test - Academy V2.2.6

## Certificat connecté

1. Ouvrir un certificat terminé depuis un compte autorisé.
2. Vérifier la présence du logo iLEAD Global.
3. Vérifier le nom, la formation, le score, la présence, la date et le numéro.
4. Vérifier le badge `Certificat valide`.
5. Scanner le QR code depuis un téléphone.
6. Vérifier que le lien ouvre le domaine public configuré.
7. Imprimer ou enregistrer le certificat en PDF et vérifier que le QR reste lisible.

## Vérification publique

1. Ouvrir le lien sans être connecté.
2. Vérifier que la page affiche le logo et le statut valide.
3. Vérifier le titulaire, la formation, l’organisation, le numéro, le score et la présence.
4. Vérifier qu’un jeton inconnu retourne une page introuvable.

## Révocation

1. Passer un certificat de `active` à `revoked` dans un environnement de test.
2. Vérifier que le certificat connecté affiche le statut révoqué.
3. Vérifier que la page publique affiche également le statut révoqué et le motif.

## Configuration

1. Vérifier `NEXT_PUBLIC_SITE_URL` en local.
2. Vérifier `NEXT_PUBLIC_SITE_URL` dans Vercel Production.
3. Scanner un QR généré en production et confirmer qu’il ne pointe pas vers localhost.
