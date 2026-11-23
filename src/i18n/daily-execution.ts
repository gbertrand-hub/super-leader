export type DailyExecutionLocale = "fr" | "en";

export function dailyExecutionCopy(locale: string) {
  const fr = locale === "fr";
  return {
    eyebrow: fr ? "DISCIPLINE QUOTIDIENNE" : "DAILY DISCIPLINE",
    title: fr ? "Mes 6 priorités du jour" : "My 6 priorities for today",
    subtitle: fr
      ? "Prépare au moins six tâches avec un résultat attendu clair. Tu peux commencer avant le pointage : Super Leader sauvegarde automatiquement ton brouillon et l’active après le démarrage de la journée."
      : "Prepare at least six tasks with a clear expected outcome. You can start before clock-in: Super Leader automatically saves your draft and activates it after the workday starts.",
    triggerTitle: fr ? "Ta journée a commencé - planifie maintenant tes résultats" : "Your workday has started - now plan your results",
    triggerHelp: fr
      ? "Le pointage a bien été enregistré. Complète ce plan avant de poursuivre ta journée."
      : "Your clock-in was recorded. Complete this plan before continuing your workday.",
    migrationRequired: fr ? "Migration 052 requise" : "Migration 052 required",
    migrationHelp: fr
      ? "Exécute la migration Supabase 052_daily_execution_cycle_v3_4_2.sql avant d’utiliser les priorités quotidiennes."
      : "Run Supabase migration 052_daily_execution_cycle_v3_4_2.sql before using daily priorities.",
    startFirst: fr ? "Commence d’abord ta journée" : "Start your workday first",
    startFirstHelp: fr
      ? "Le plan quotidien se déclenche immédiatement après le pointage d’arrivée."
      : "The daily plan is triggered immediately after clock-in.",
    prepareBeforeClockInTitle: fr ? "Prépare tes priorités sans risque de les perdre" : "Prepare your priorities without losing them",
    prepareBeforeClockInHelp: fr
      ? "Tu peux remplir les six tâches avant de commencer ta journée. Un brouillon local est sauvegardé automatiquement sur cet appareil."
      : "You can fill in the six tasks before starting your workday. A local draft is automatically saved on this device.",
    submitted: fr ? "Plan soumis" : "Plan submitted",
    incomplete: fr ? "Plan incomplet" : "Plan incomplete",
    completed: fr ? "Cycle terminé" : "Cycle completed",
    taskCount: (count: number, minimum: number) => fr ? `${count}/${minimum} tâches définies` : `${count}/${minimum} tasks defined`,
    editPlan: fr ? "Modifier le plan du jour" : "Edit today’s plan",
    createPlan: fr ? "Définir mes priorités" : "Define my priorities",
    planHelp: fr
      ? "Les premières lignes obligatoires correspondent au minimum défini par l’organisation. Les lignes suivantes permettent d’ajouter des priorités supplémentaires."
      : "The required first rows match the organisation minimum. The following rows let you add extra priorities.",
    task: (index: number) => fr ? `Tâche ${index}` : `Task ${index}`,
    taskTitle: fr ? "Action à accomplir" : "Action to complete",
    taskTitlePlaceholder: fr ? "Ex. Finaliser le rapport mensuel" : "E.g. Finalise the monthly report",
    expectedOutcome: fr ? "Résultat attendu" : "Expected outcome",
    expectedOutcomePlaceholder: fr ? "Ex. Rapport vérifié et transmis au Directeur général" : "E.g. Report checked and sent to the Managing Director",
    priority: fr ? "Priorité" : "Priority",
    dueTime: fr ? "Échéance" : "Due time",
    category: fr ? "Projet / catégorie" : "Project / category",
    categoryPlaceholder: fr ? "Ex. Finance, CRM, Formation" : "E.g. Finance, CRM, Training",
    optional: fr ? "facultatif" : "optional",
    savePlan: fr ? "Enregistrer mes priorités" : "Save my priorities",
    savePlanBeforeClockIn: fr ? "Continuer vers le démarrage de la journée" : "Continue to start the workday",
    autosaveTitle: fr ? "Protection automatique de ta saisie" : "Automatic input protection",
    autosaveHelp: fr ? "Chaque modification est conservée automatiquement dans ce navigateur." : "Every change is automatically preserved in this browser.",
    autosavedAt: (time: string) => fr ? `Brouillon sauvegardé automatiquement à ${time}` : `Draft automatically saved at ${time}`,
    draftRestored: fr ? "Brouillon restauré" : "Draft restored",
    saveDraft: fr ? "Conserver le brouillon maintenant" : "Save draft now",
    startRequiredTitle: fr ? "Ta journée n’a pas encore commencé" : "Your workday has not started yet",
    startRequiredHelp: fr
      ? "Tes tâches sont conservées. Tu peux commencer ta journée et Super Leader enregistrera automatiquement le plan juste après le pointage."
      : "Your tasks are preserved. You can start your workday and Super Leader will automatically save the plan immediately after clock-in.",
    startAndSave: fr ? "Commencer ma journée et enregistrer" : "Start my workday and save",
    keepDraft: fr ? "Conserver comme brouillon" : "Keep as draft",
    progressTitle: fr ? "Suivi de mes tâches" : "Track my tasks",
    progressHelp: fr
      ? "Mets à jour le statut pendant la journée. Le résultat final sera demandé lors du rapport journalier."
      : "Update the status during the day. The final outcome will be requested in the daily report.",
    saveStatus: fr ? "Mettre à jour" : "Update",
    openReport: fr ? "Compléter le rapport journalier" : "Complete the daily report",
    reportSectionTitle: fr ? "Résultats des priorités du matin" : "Outcomes of the morning priorities",
    reportSectionHelp: fr
      ? "Pour chaque tâche, indique le statut final et le résultat réellement obtenu. Une justification et une action suivante sont obligatoires lorsqu’elle n’est pas terminée."
      : "For each task, provide the final status and actual outcome. A reason and next action are required when it was not completed.",
    noPlanForReport: fr ? "Le plan quotidien est obligatoire avant le rapport" : "The daily plan is required before the report",
    noPlanForReportHelp: fr
      ? "Retourne dans Ma journée et définis au moins six priorités avant de soumettre le rapport."
      : "Return to My day and define at least six priorities before submitting the report.",
    finalStatus: fr ? "Statut final" : "Final status",
    chooseStatus: fr ? "Choisir le statut" : "Choose status",
    actualOutcome: fr ? "Résultat réellement obtenu" : "Actual outcome",
    actualOutcomePlaceholder: fr ? "Décris le résultat concret, vérifiable et livré." : "Describe the concrete, verifiable result that was delivered.",
    reason: fr ? "Motif / obstacle" : "Reason / obstacle",
    reasonPlaceholder: fr ? "Obligatoire si la tâche n’est pas terminée." : "Required when the task was not completed.",
    nextAction: fr ? "Action suivante" : "Next action",
    nextActionDate: fr ? "Nouvelle date" : "New date",
    planStatus: fr ? "Plan du jour" : "Daily plan",
    teamMissing: fr ? "Plan non défini" : "Plan not defined",
    teamReady: fr ? "Plan défini" : "Plan defined",
    teamTasks: fr ? "Exécution" : "Execution",
    reportDateDisplay: fr ? "Date du rapport" : "Report date",
    displayDate: fr ? "Afficher" : "Display",
    prioritiesAnalysis: fr ? "Analyse des priorités quotidiennes" : "Daily priorities analytics",
    prioritiesSettings: fr ? "Règles avancées des priorités" : "Advanced priority rules",
    messages: {
      migration: fr ? "La migration 052 doit être exécutée avant cette action." : "Migration 052 must be run before this action.",
      clockInFirst: fr ? "Commence d’abord ta journée avant de définir tes priorités." : "Clock in before defining your priorities.",
      dayClosed: fr ? "La journée de travail est déjà clôturée. Le plan du matin ne peut plus être modifié." : "The workday is already closed. The morning plan can no longer be changed.",
      todayOnly: fr ? "Le plan ne peut être créé que pour la journée de travail en cours." : "The plan can only be created for the current workday.",
      minimum: (minimum: number) => fr ? `Définis au moins ${minimum} tâches complètes.` : `Define at least ${minimum} complete tasks.`,
      incompleteTask: (index: number) => fr ? `Complète le titre et le résultat attendu de la tâche ${index}.` : `Complete the title and expected outcome for task ${index}.`,
      reportLocked: fr ? "Le rapport a déjà été soumis : le plan du jour est verrouillé." : "The report was already submitted: the daily plan is locked.",
      saved: fr ? "Tes priorités du jour ont été enregistrées." : "Your priorities for today were saved.",
      statusSaved: fr ? "Le statut de la tâche a été mis à jour." : "The task status was updated.",
      invalidTask: fr ? "Cette tâche n’est pas disponible." : "This task is not available.",
      invalidOutcome: fr ? "Complète le statut final et le résultat de chacune des tâches du jour." : "Complete the final status and outcome for every daily task.",
      incompleteOutcome: (title: string) => fr ? `Complète le résultat final de la tâche : ${title}` : `Complete the final outcome for: ${title}`,
      reasonRequired: (title: string) => fr ? `Ajoute un motif et une action suivante pour la tâche non terminée : ${title}` : `Add a reason and next action for the unfinished task: ${title}`,
      planRequired: fr ? "Définis au moins six priorités dans Ma journée avant de soumettre ce rapport." : "Define at least six priorities in My day before submitting this report.",
    },
    priorities: {
      low: fr ? "Faible" : "Low",
      normal: fr ? "Normale" : "Normal",
      high: fr ? "Haute" : "High",
      critical: fr ? "Critique" : "Critical",
    },
    progressStatuses: {
      todo: fr ? "À faire" : "To do",
      in_progress: fr ? "En cours" : "In progress",
      completed: fr ? "Terminée" : "Completed",
      partial: fr ? "Partiellement terminée" : "Partially completed",
      blocked: fr ? "Bloquée" : "Blocked",
      deferred: fr ? "Reportée" : "Deferred",
      cancelled: fr ? "Annulée" : "Cancelled",
    },
    nextActions: {
      none: fr ? "Aucune - tâche terminée" : "None - task completed",
      tomorrow: fr ? "Reporter à demain" : "Carry over to tomorrow",
      reschedule: fr ? "Reprogrammer à une autre date" : "Reschedule to another date",
      follow_up: fr ? "Créer un suivi" : "Create a follow-up",
      request_help: fr ? "Demander l’aide du responsable" : "Request manager help",
      cancel: fr ? "Annuler avec justification" : "Cancel with justification",
    },
  };
}
