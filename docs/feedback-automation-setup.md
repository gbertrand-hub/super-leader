# Super Leader - Configuration de l'automatisation omnicanale du feedback V2

Cette version automatise la demande de feedback après la clôture d'une interaction CRM. Elle prend en charge l'email avec Resend, les SMS avec Twilio, WhatsApp Business Platform / Cloud API, les liens web, les relances et le suivi des statuts de livraison.

## 1. Installer la migration Supabase

Dans Supabase, ouvrir **SQL Editor**, créer une nouvelle requête et exécuter intégralement :

```text
supabase/011_feedback_automation_omnichannel.sql
```

La migration `010_crm_clients_feedback.sql` doit déjà être installée.

## 2. Variables communes dans Vercel

Dans **Vercel > Super Leader > Settings > Environment Variables**, ajouter :

```text
NEXT_PUBLIC_SITE_URL=https://super-leader-eosin.vercel.app
CRON_SECRET=une-longue-valeur-aleatoire
```

Utiliser la même valeur de site dans l'environnement Production. Ne jamais placer les clés secrètes dans une variable commençant par `NEXT_PUBLIC_`.

## 3. Email avec Resend

Ajouter :

```text
RESEND_API_KEY=
FEEDBACK_FROM_EMAIL=feedback@votre-domaine.com
FEEDBACK_FROM_NAME=Super Leader
RESEND_WEBHOOK_SECRET=
```

Dans Resend, créer un webhook vers :

```text
https://super-leader-eosin.vercel.app/api/webhooks/resend
```

Activer au minimum les événements envoyés, livrés, retardés, échoués, rebondis, ouverts, cliqués et signalés comme indésirables. Copier ensuite le secret de signature du webhook dans `RESEND_WEBHOOK_SECRET`.

## 4. SMS avec Twilio

Ajouter :

```text
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_FROM_NUMBER=
```

Renseigner soit `TWILIO_MESSAGING_SERVICE_SID`, soit `TWILIO_FROM_NUMBER`. Le module transmet automatiquement cette adresse de suivi à Twilio :

```text
https://super-leader-eosin.vercel.app/api/webhooks/twilio
```

Le numéro du client doit être enregistré au format international, par exemple `+353...`, `+1...` ou `+237...`.

## 5. WhatsApp Business Platform / Cloud API

Ajouter :

```text
WHATSAPP_GRAPH_VERSION=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_FEEDBACK_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE_FR=fr
WHATSAPP_TEMPLATE_LANGUAGE_EN=en_US
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
```

Dans Meta Developers, configurer le webhook :

```text
https://super-leader-eosin.vercel.app/api/webhooks/whatsapp
```

Utiliser exactement la valeur de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` comme jeton de vérification et abonner l'application au champ `messages`.

### Structure du modèle WhatsApp

Créer et faire approuver un modèle comportant :

- variable de corps `{{1}}` : nom du client ;
- variable de corps `{{2}}` : nom du collaborateur ;
- bouton URL dynamique numéro 0 ;
- URL de base : `https://super-leader-eosin.vercel.app/feedback/customer/{{1}}`.

Le code transmet le jeton de feedback comme variable du bouton URL. Les versions française et anglaise doivent utiliser le même nom de modèle ou des traductions rattachées au même modèle.

## 6. Planification Vercel

Le fichier `vercel.json` contient une exécution quotidienne à 09:00 UTC :

```json
{
  "crons": [
    {
      "path": "/api/cron/feedback-automation",
      "schedule": "0 9 * * *"
    }
  ]
}
```

Les demandes avec un délai de `0 minute` sont envoyées immédiatement lors de la clôture de l'interaction. Le cron traite les demandes différées, les nouvelles tentatives et les relances. Sur un plan Vercel autorisant des exécutions plus fréquentes, la planification peut être remplacée par une fréquence horaire.

## 7. Activer l'automatisation dans Super Leader

Après le déploiement, ouvrir :

```text
/dashboard/feedback-automation
```

Puis :

1. activer la création automatique après les échanges ;
2. conserver `0 minute` pour un envoi instantané ;
3. sélectionner les résultats d'interaction autorisés ;
4. activer les canaux réellement configurés ;
5. configurer le délai et le nombre de relances ;
6. choisir un canal de secours ;
7. enregistrer les réglages.

Le système respecte aussi le consentement du client, le statut « ne pas contacter » et le délai anti-sollicitation déjà configuré dans le CRM.

## 8. Test recommandé

1. Créer un client avec une adresse email ou un numéro valide.
2. Activer l'autorisation de feedback et choisir son canal préféré.
3. Enregistrer une interaction avec le résultat **Résolu**.
4. Vérifier la demande dans `/dashboard/feedback-automation`.
5. Ouvrir le lien public et envoyer une note.
6. Vérifier que la demande passe à **Terminée**.
7. Tester une note faible afin de confirmer la création de la tâche de suivi urgente.

## 9. Diagnostic rapide

- **Prêt** : demande créée, mais aucun envoi automatique n'a été effectué.
- **En attente** : envoi programmé pour plus tard.
- **Envoyé** : le fournisseur a accepté le message.
- **Livré** : le fournisseur confirme la livraison.
- **Ouvert** : le message ou le formulaire a été ouvert.
- **Échec** : le fournisseur a rejeté le message ou une erreur est survenue.
- **Terminé** : le client a envoyé sa réponse.

Le bouton **Exécuter maintenant** permet de traiter manuellement les demandes et relances en attente pour l'organisation courante.
