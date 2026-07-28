# Super Leader V2.6.3.1 — Modification et affectation tardive des tâches

## Objectif
Permettre au responsable d'un événement de corriger une tâche après sa création, notamment lorsqu'elle a été créée sans responsable.

## Comportement
- Le responsable de l'événement, Owner, Admin, RH ou membre disposant de `can_manage` peut modifier : titre, description, jalon, responsable, priorité, échéance, budget prévisionnel et devise.
- Le responsable peut laisser la tâche non affectée ou l'affecter plus tard à un membre actif de l'équipe de mission.
- Le nouveau responsable reçoit une notification lors de l'affectation.
- Le collaborateur affecté peut mettre à jour uniquement le statut, l'avancement, la preuve et les notes.
- Les changements sont inscrits dans le journal d'activité de l'événement.

## Base de données
Aucune nouvelle migration SQL n'est requise.
