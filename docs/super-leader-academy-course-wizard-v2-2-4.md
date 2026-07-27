# Super Leader Academy V2.2.4

## Assistant complet de création des formations

La création d'une formation est désormais regroupée dans un seul parcours en cinq étapes.

1. **Informations générales**
   - titre, description, mois, date limite, catégorie et ressource;
   - durée totale, note minimale, tentatives et présence requise;
   - caractère obligatoire et délivrance du certificat.

2. **Planification**
   - séance unique;
   - rythme hebdomadaire;
   - session intensive mensuelle;
   - dates personnalisées;
   - heure, durée, fuseau horaire et lien Zoom;
   - génération immédiate des séries et des séances.

3. **Quiz final**
   - plusieurs questions et réponses;
   - points et bonne réponse;
   - quiz obligatoire avant la publication lorsque le certificat est activé;
   - brouillon autorisé même lorsque le quiz n'est pas encore terminé.

4. **Participants**
   - aucun participant pour le moment;
   - toute l'organisation;
   - une ou plusieurs équipes;
   - collaborateurs précis.

5. **Vérification et publication**
   - résumé de la formation, de la planification, du quiz et des affectations;
   - création comme brouillon complet;
   - ou création, génération des séances, publication et affectation en une seule opération.

## Sécurité et intégrité

La migration `025_academy_course_creation_wizard_v2_2_4.sql` installe une fonction transactionnelle. Une erreur lors de la création d'une question, d'une série, d'une séance ou d'une inscription annule l'ensemble de l'opération afin d'éviter les formations partielles.

Seuls les rôles Owner, Admin et RH peuvent utiliser l'assistant. Les participants sélectionnés doivent être des membres actifs de la même organisation. Les affectations par équipe sont résolues côté serveur.

## Compatibilité

Les formations déjà créées restent disponibles et continuent d'utiliser les écrans de configuration, d'édition des séries, de présence et de certification existants.
