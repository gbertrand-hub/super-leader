# Matrice de tests - Super Leader V2.6

## Activation

- [ ] La migration 033 s'execute sans erreur.
- [ ] Performance ne demande plus l'installation de la gouvernance V2.6.
- [ ] Les parametres de nuit, de longue journee et de reouverture sont visibles pour Owner/Admin/RH.
- [ ] Les anciens pointages et rapports restent disponibles.

## Employe - cloture de journee

- [ ] Le bouton Journee terminee demande une confirmation.
- [ ] Annuler la confirmation ne modifie rien.
- [ ] Confirmer enregistre l'heure de depart une seule fois.
- [ ] Une deuxieme cloture est refusee.
- [ ] L'employe ne dispose d'aucun bouton de reouverture.
- [ ] Une journee commencee avant minuit peut etre cloturee apres minuit.
- [ ] Le total travaille est correct.
- [ ] Le temps hors planning est correct.
- [ ] Le temps de nuit est correct pour une plage traversant minuit.
- [ ] Le temps du samedi et du dimanche est correct.
- [ ] Une alerte de bien-etre apparait selon le seuil et les periodes configurees.

## Reouverture de journee

- [ ] Le Manager voit uniquement les journees cloturees de ses collaborateurs supervises.
- [ ] Il ne peut pas rouvrir sa propre journee.
- [ ] Owner/Admin/RH peuvent gouverner une journee autorisee, y compris la leur.
- [ ] Un motif de moins de 10 caracteres est refuse.
- [ ] L'ancienne heure de depart est conservee dans l'historique.
- [ ] Les anciens totaux sont conserves dans l'historique.
- [ ] L'employe est notifie.
- [ ] Le journal d'audit contient l'acteur, le collaborateur, la date et le motif.
- [ ] Le nombre maximal de reouvertures est respecte.
- [ ] La nouvelle cloture ferme la reouverture active et recalcule tous les compteurs.

## Rapport journalier unique

- [ ] La premiere soumission cree un rapport et le verrouille.
- [ ] Le formulaire normal disparait pour la date deja soumise.
- [ ] Une seconde soumission directe est refusee cote serveur.
- [ ] Une contrainte unique empeche un doublon en base.
- [ ] Le rapport affiche son numero de version.

## Correction du rapport

- [ ] Le Manager ne peut ouvrir une correction que pour un collaborateur supervise.
- [ ] Owner/Admin/RH peuvent ouvrir une correction dans leur perimetre.
- [ ] Un motif de moins de 10 caracteres est refuse.
- [ ] Une seule reouverture active existe par collaborateur et date.
- [ ] Le formulaire de correction est pre-rempli avec le rapport existant.
- [ ] La nouvelle soumission augmente le numero de revision.
- [ ] La version precedente est conservee dans `daily_report_versions`.
- [ ] Le rapport corrige est de nouveau verrouille.
- [ ] La reouverture est marquee comme utilisee.
- [ ] L'employe est notifie de l'autorisation de correction.
- [ ] Le superviseur ne peut pas completer a la place d'un employe lorsqu'un rapport existe deja.

## Reunions et interface

- [ ] Ma journee affiche le bouton Mes reunions.
- [ ] Le bouton ouvre `/dashboard/performance?view=meetings`.
- [ ] Les reunions du jour restent dans les priorites et l'agenda.
- [ ] Les libelles FR et EN ne montrent aucune cle technique.

## Securite et audit

- [ ] Une URL ou une requete modifiee ne permet pas a un Manager d'agir hors de son equipe.
- [ ] Un Employe ne peut appeler aucune action de reouverture.
- [ ] Les nouvelles tables ont RLS activee et sont accessibles uniquement par le service role.
- [ ] Toutes les reouvertures et revisions apparaissent dans le journal d'audit.
- [ ] Les notifications ne sont envoyees qu'a un membre actif de l'organisation.
