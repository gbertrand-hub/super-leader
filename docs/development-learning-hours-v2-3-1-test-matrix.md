# Matrice de tests - Super Leader V2.3.1

## Activation

- [ ] La migration 028 s'exécute sans erreur.
- [ ] Les paramètres de formation et de lecture apparaissent dans le Plan de croissance.
- [ ] Les plans existants reçoivent les objectifs par défaut sans perdre leurs données.
- [ ] Le champ Parcours de croissance apparaît dans la création et la modification d'une formation Academy.

## Parcours iLEAD

- [ ] École des Coachs est disponible.
- [ ] École des Affaires est disponible.
- [ ] École des Experts est disponible.
- [ ] École des Éleveurs est disponible.
- [ ] Lundi de la Vision est disponible.
- [ ] Autre formation est disponible.
- [ ] Lecture de livres est disponible dans la déclaration manuelle.

## Synchronisation Academy

- [ ] Une présence « Présent » crée une seule activité de développement.
- [ ] Une présence « En retard » crée une seule activité de développement.
- [ ] Un double enregistrement de présence ne crée pas de doublon.
- [ ] Une modification de la durée suivie met à jour la durée et les crédits.
- [ ] Une présence changée en « Absent » supprime l'activité synchronisée.
- [ ] Une présence changée en « Excusé » supprime l'activité synchronisée.
- [ ] Une séance annulée n'alimente pas le Plan de croissance.
- [ ] Une séance du soir calcule les minutes de nuit selon les paramètres.
- [ ] Une séance de week-end calcule les minutes de week-end.

## Déclaration manuelle

- [ ] Un employé peut déclarer une école non encore gérée dans Academy.
- [ ] Un employé peut déclarer une autre formation autorisée.
- [ ] Une durée inférieure à 15 minutes est refusée.
- [ ] Une durée supérieure à 24 heures est refusée.
- [ ] Le passage à minuit calcule correctement la durée.
- [ ] Une lecture exige le titre, les enseignements et l'action d'application.
- [ ] Un lien de preuve non HTTP/HTTPS est refusé.
- [ ] Une déclaration en attente peut être annulée par son auteur.
- [ ] Une activité Academy ne peut pas être annulée manuellement par l'employé.

## Validation par rôle

- [ ] Le Manager voit uniquement les activités de ses collaborateurs supervisés.
- [ ] Le Manager ne peut pas valider sa propre activité.
- [ ] Le Manager peut valider, valider partiellement ou refuser une activité de son périmètre.
- [ ] Owner, Admin et RH peuvent examiner les activités autorisées à l'échelle de l'organisation.
- [ ] Un utilisateur hors périmètre est refusé côté serveur même avec une requête modifiée.
- [ ] La décision est enregistrée dans le journal d'audit.
- [ ] Le collaborateur reçoit une notification après la décision.

## Plan de croissance et score

- [ ] L'objectif d'heures de formation est enregistré par mois.
- [ ] L'objectif d'heures de lecture est enregistré par mois.
- [ ] Les compteurs distinguent formation, lecture et impact.
- [ ] Les crédits de formation utilisent le taux configuré.
- [ ] Les crédits de lecture utilisent le taux configuré.
- [ ] Le plafond mensuel de crédits de développement est respecté.
- [ ] Une activité en attente, refusée ou annulée n'alimente pas le score.
- [ ] Une activité validée ou Academy alimente le score du bon mois.
- [ ] Le score final de l'Employé du mois reste plafonné à 100.

## Bien-être et paie

- [ ] Les heures du soir et du week-end apparaissent dans le compteur dédié.
- [ ] Elles ne créent aucun paiement automatique.
- [ ] L'alerte de bien-être utilise aussi les formations et lectures.
- [ ] L'interface maintient la séparation entre développement, travail et heures supplémentaires RH.

## RLS et intégrité

- [ ] Un employé ne peut lire que ses propres activités.
- [ ] Un Manager ne peut lire que les activités de son périmètre.
- [ ] La référence unique de présence Academy empêche les doublons.
- [ ] La suppression d'une présence supprime uniquement l'activité synchronisée correspondante.
- [ ] Les anciennes contributions d'impact restent intactes après la migration.
