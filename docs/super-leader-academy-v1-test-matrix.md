# Super Leader Academy V1 - Matrice de tests

## Préconditions

- Les migrations 001 à 020 sont déjà exécutées.
- La migration `021_super_leader_academy_v1.sql` est exécutée avec succès.
- Il existe au moins un compte Owner, un RH, un Manager avec une équipe officielle et un Employé dans cette équipe.

## Tests Owner / Admin / RH

| Test | Résultat attendu |
|---|---|
| Ouvrir `/dashboard/academy` | Le catalogue, la création et la configuration sont visibles. |
| Créer une formation valide | La formation est créée en brouillon. |
| Publier sans question | Publication refusée. |
| Ajouter deux options et une bonne réponse | La question est enregistrée. |
| Publier après ajout du quiz | La formation devient publiée. |
| Affecter un membre actif | L’inscription est créée et une notification est envoyée. |
| Affecter une seconde fois le même membre | Aucun doublon n’est créé. |
| Accorder une exemption sans motif | Action refusée. |
| Accorder une exemption motivée | Statut `exempted`, audit enregistré. |
| Modifier les poids de performance avec un total différent de 100 | Enregistrement refusé. |

## Tests Manager

| Test | Résultat attendu |
|---|---|
| Ouvrir l’Academy | Le catalogue publié et son espace d’apprentissage sont visibles. |
| Créer ou modifier une formation | Aucun contrôle de création/configuration n’est visible ; action serveur refusée. |
| Affecter un collaborateur supervisé | Affectation réussie. |
| Affecter un membre d’une autre équipe via formulaire falsifié | Action refusée. |
| Consulter les participants | Seuls le Manager et les collaborateurs de son périmètre sont visibles. |
| Consulter un certificat hors périmètre par URL | Redirection vers l’Academy avec accès refusé. |

## Tests Employé

| Test | Résultat attendu |
|---|---|
| Ouvrir l’Academy | Le catalogue publié est visible. |
| S’inscrire à une formation publiée | Une inscription unique est créée. |
| Commencer la formation | Statut `in_progress`, progression initiale enregistrée. |
| Ouvrir la ressource | Le lien s’ouvre dans un nouvel onglet. |
| Soumettre le quiz avec des réponses incorrectes | Note calculée, tentative enregistrée, statut mis à jour. |
| Dépasser le maximum de tentatives | Nouvelle tentative refusée. |
| Réussir le quiz | Statut `completed`, progression 100 %, notification envoyée. |
| Ouvrir le certificat | Certificat affiché avec numéro unique. |
| Imprimer le certificat | La boîte d’impression permet l’enregistrement en PDF. |
| Consulter les bonnes réponses via l’API Supabase authentifiée | Accès refusé à `academy_quiz_questions`. |

## Tests certificat public

| Test | Résultat attendu |
|---|---|
| Ouvrir `/academy/verify/<token-valide>` sans connexion | Certificat valide, bénéficiaire, formation, organisation et numéro affichés. |
| Utiliser un token inexistant | Page introuvable. |
| Vérifier un certificat révoqué | Statut révoqué clairement affiché. |

## Tests performance

| Test | Résultat attendu |
|---|---|
| Calculer un mois sans formation obligatoire affectée | Le critère Formation reçoit son poids complet. |
| Calculer avec 2 formations obligatoires, 1 terminée | Le score Formation correspond à 50 % du poids. |
| Calculer avec une formation obligatoire incomplète | Raison `mandatory_training_incomplete`, employé non éligible. |
| Terminer la formation puis recalculer | Score Formation et éligibilité sont mis à jour. |
| Ouvrir le classement | Colonne Formation et fraction terminées/requises visibles. |

## Tests Ma journée

| Test | Résultat attendu |
|---|---|
| Formation assignée et non terminée | Accès rapide Academy visible. |
| Échéance future | Priorité avec date et progression. |
| Échéance dépassée | Priorité urgente « formation en retard ». |
| Cliquer la priorité | Ouverture directe de la formation concernée. |

## Validation finale

- Aucun rôle ne voit de données hors de son périmètre.
- Les bonnes réponses du quiz ne sont jamais exposées côté client ou API publique.
- Une seule inscription et un seul certificat existent par participant et formation.
- Le score total configuré reste égal à 100 %.
- Les textes français et anglais sont disponibles.
