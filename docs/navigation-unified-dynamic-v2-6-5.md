# Super Leader V2.6.5 — Navigation unifiée et menu dynamique

## Objectif

Centraliser tous les grands modules du tableau de bord dans une seule configuration afin qu’aucune page principale ne soit oubliée dans le menu latéral.

## Sections du menu

1. **Travail quotidien** : Ma journée, Tableau de bord, Notifications, Mon planning.
2. **Développement** : Feedback, Reconnaissance, Plans d’action, Academy, Plan de croissance, Performance.
3. **Organisation** : Entreprise, Départements & équipes, Membres & affectations, Événements.
4. **Activité commerciale** : CRM, Ventes & commissions, Recouvrement, Automatisation feedback.
5. **Administration** : Acquisition & accès, Abonnement & plans, Rapports.

## Règles d’affichage

- Les liens sont filtrés selon le rôle du membre.
- Les modules réservés à la plateforme Super Leader restent limités à l’espace plateforme.
- Les fonctionnalités non incluses dans le plan sont masquées pour les employés et managers.
- Owner et Admin voient les modules non inclus avec un badge **Plan** et sont redirigés vers l’abonnement pour les activer.
- Un compte sans organisation ne voit que le tableau de bord d’accueil.
- Les pages de détail restent accessibles depuis leur module parent et ne sont pas dupliquées dans le menu.

## Configuration centrale

Le fichier `src/lib/navigation/dashboard-menu.ts` contient désormais :

- l’ordre des sections ;
- les libellés ;
- les icônes ;
- les routes ;
- les rôles autorisés ;
- les fonctionnalités d’abonnement requises ;
- les restrictions propres à l’espace plateforme.

Toute nouvelle page principale devra être ajoutée à cette configuration unique.

## Compatibilité

- Français et anglais.
- Navigation ordinateur et mobile.
- Plans Free, Starter, Growth, Enterprise et Accès complet historique.
- Aucun changement de base de données requis.
