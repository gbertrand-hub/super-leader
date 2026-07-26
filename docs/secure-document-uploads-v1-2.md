# Super Leader - Téléversement sécurisé des justificatifs V1.2

Cette version remplace les simples liens par un téléversement direct dans un bucket Supabase privé.

## Documents concernés

- justificatifs des demandes d'absence ;
- preuve du premier versement lors d'une vente ;
- preuve des versements enregistrés par l'équipe de recouvrement.

## Sécurité

- bucket privé `super-leader-private` ;
- fichiers limités à 10 Mo ;
- formats : PDF, JPG/JPEG, PNG, WEBP, HEIC/HEIF, DOC et DOCX ;
- téléversement direct vers Supabase avec une URL signée temporaire ;
- aucun fichier ne traverse la fonction Vercel ;
- consultation au moyen d'un lien signé de 60 secondes ;
- contrôle d'accès par organisation, rôle, propriétaire, superviseur ou agent de suivi ;
- conservation des anciens liens externes pour compatibilité.

## Autorisations

### Justificatif d'absence

Accessible par l'employé concerné, son superviseur, les managers, les RH et les administrateurs autorisés.

### Preuve de vente ou paiement

Accessible par le vendeur, le responsable du recouvrement et les responsables autorisés.

## Migration

Exécuter `supabase/014_secure_document_uploads.sql` après les migrations Ventes et Performance.
