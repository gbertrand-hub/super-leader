# Matrice de tests - Super Leader V2.4

## Inscription publique

- [ ] Le formulaire refuse les champs obligatoires manquants.
- [ ] Le consentement de contact est obligatoire.
- [ ] Une demande de demo est creee sans organisation automatique.
- [ ] L'email de confirmation renvoie vers `/dashboard`.
- [ ] Le prospect voit son statut et aucun module interne.
- [ ] `/dashboard/company` ne permet plus de creer librement une organisation.

## Pipeline de demonstration

- [ ] Owner/Admin iLEAD voient l'onglet Prospects.
- [ ] RH ne voit pas l'onglet Prospects.
- [ ] Une organisation cliente externe ne voit pas Acquisition.
- [ ] Le changement de statut est conserve apres actualisation.
- [ ] Le responsable commercial et la date de demo sont conserves.
- [ ] La conversion cree une organisation distincte et attribue le role Owner au demandeur.
- [ ] Une seconde conversion est bloquee.

## Demande interne

- [ ] `/ilead-access` est accessible sans connexion.
- [ ] Le demandeur ne choisit pas son role systeme.
- [ ] Owner/Admin/RH recoivent une notification.
- [ ] La demande apparait dans l'onglet Acces iLEAD.
- [ ] Le refus exige une note.
- [ ] L'approbation cree ou reutilise le compte Auth.
- [ ] Le membership iLEAD est actif avec le role choisi.
- [ ] Les equipes choisies sont affectees.
- [ ] Le superviseur est enregistre dans le planning individuel.
- [ ] Un Manager peut etre affecte comme responsable d'une equipe.
- [ ] Le mot de passe temporaire expire et doit etre change au premier login.
- [ ] Un email est envoye lorsque Resend est configure.

## Securite et audit

- [ ] Les tables ne sont pas lisibles avec une session utilisateur standard.
- [ ] Un Employee ou Manager ne peut pas ouvrir `/dashboard/acquisition`.
- [ ] Un Owner d'une organisation cliente ne peut pas ouvrir le pipeline plateforme.
- [ ] Les changements de statut, conversions et approbations sont audites.
