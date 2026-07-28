# Matrice de tests - V2.6.1

| Test | Resultat attendu |
|---|---|
| Owner ouvre la fiche d un Manager actif | Bouton Reinitialiser l acces visible |
| Manager ouvre Membres & affectations | Aucun controle de mot de passe visible |
| Owner cible son propre compte | Controle masque |
| Owner cible un autre Owner | Controle masque |
| Membre desactive | Controle masque jusqu a reactivation |
| Lien securise avec email | Email envoye et lien affiche pour copie |
| Lien securise sans email | Lien affiche sans envoi |
| Resend absent | Lien genere avec avertissement d envoi |
| Mot de passe temporaire | Ancien mot de passe remplace immediatement |
| Premiere connexion temporaire | Redirection vers le changement obligatoire |
| Mot de passe temporaire copie | Secret affiche uniquement dans la reponse courante |
| Changement via lien securise | Champs temporaires nettoyes dans `profiles` |
| Audit | Evenements presents dans `temporary_access_audit_log` |
| Isolation organisation | Impossible de cibler un membre d une autre organisation |
| Build | `npm run build` a confirmer dans l environnement utilisateur |
