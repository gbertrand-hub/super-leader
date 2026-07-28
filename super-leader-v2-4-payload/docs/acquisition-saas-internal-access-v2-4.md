# Super Leader V2.4 - Acquisition SaaS et demandes d'acces internes

## Objectif

Super Leader distingue desormais deux parcours qui ne doivent jamais etre confondus :

1. **Organisations externes** : creation d'un compte prospect et demande de demonstration.
2. **Collaborateurs iLEAD Global** : demande interne soumise a validation avant toute activation.

## Parcours public des organisations

La page `/signup` collecte :

- identite et coordonnees du demandeur ;
- nom, pays, secteur et taille de l'organisation ;
- besoins prioritaires ;
- modules souhaites ;
- date de demonstration preferee ;
- consentement de contact.

La demande est enregistree dans `demo_requests`. Le compte n'obtient pas automatiquement une organisation. Apres confirmation de l'email, le prospect voit le statut de sa demande dans son tableau de bord.

### Pipeline commercial

Statuts disponibles :

- Nouvelle demande ;
- A contacter ;
- Demonstration programmee ;
- Demonstration effectuee ;
- Essai approuve ;
- Client actif ;
- Refusee ;
- Archivee.

Owner et Admin de l'organisation plateforme peuvent affecter un responsable commercial, programmer une demonstration, enregistrer des notes et convertir un prospect en organisation cliente.

## Parcours interne iLEAD

La page publique `/ilead-access` collecte :

- nom, email et telephone ;
- entite iLEAD ;
- departement et fonction ;
- responsable indique ;
- equipe souhaitee ;
- matricule eventuel ;
- motif de la demande.

La demande est enregistree dans `internal_access_requests`. Le demandeur ne choisit jamais son role systeme.

### Approbation

Owner, Admin ou RH peuvent :

- verifier ou refuser la demande ;
- attribuer le role Employee, Manager, HR ou Admin ;
- affecter une ou plusieurs equipes ;
- designer un superviseur ;
- designer l'equipe dirigee si le role est Manager ;
- generer un mot de passe temporaire ;
- envoyer les instructions par email ;
- imposer le changement du mot de passe a la premiere connexion.

## Securite

- Les tables d'acquisition ne sont pas accessibles directement aux roles `anon` ou `authenticated`.
- Toutes les operations passent par des actions serveur avec la cle `service_role`.
- La page d'administration est reservee a l'organisation plateforme definie par `SUPER_LEADER_PLATFORM_ORGANIZATION_ID` ou, a defaut, par le nom `iLEAD Global`.
- Les organisations clientes converties ne voient jamais le pipeline global.
- La creation libre d'une organisation depuis `/dashboard/company` est desactivee.
- Toutes les decisions sont enregistrees dans `acquisition_audit_log`.

## Variables d'environnement

```env
SUPER_LEADER_PLATFORM_ORGANIZATION_ID=
SUPER_LEADER_PLATFORM_ORGANIZATION_NAME=iLEAD Global
```

En production, l'utilisation de l'UUID est recommandee.
