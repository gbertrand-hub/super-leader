export type HelpGuide = {
  id: string;
  category: "getting_started" | "daily_work" | "sales" | "management" | "administration";
  title: {fr: string; en: string};
  summary: {fr: string; en: string};
  duration: number;
  roles?: string[];
  href: string;
  steps: Array<{fr: string; en: string}>;
};

const LEADERS = ["owner", "admin", "executive", "hr", "manager"];

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: "first-steps", category: "getting_started", duration: 4, href: "/dashboard/profile",
    title: {fr: "Bien démarrer dans Super Leader", en: "Getting started with Super Leader"},
    summary: {fr: "Configure ton profil et repère les espaces essentiels.", en: "Set up your profile and find the essential areas."},
    steps: [
      {fr: "Ouvre ton profil depuis ta carte dans le menu de gauche.", en: "Open your profile from your card in the left menu."},
      {fr: "Vérifie ton nom, ta langue, ton fuseau horaire et ta photo.", en: "Check your name, language, time zone and photo."},
      {fr: "Utilise la recherche du menu pour trouver rapidement un module.", en: "Use menu search to quickly find a module."},
      {fr: "Commence chaque journée dans Ma journée.", en: "Start each day in My day."},
    ],
  },
  {
    id: "my-day", category: "daily_work", duration: 6, href: "/dashboard/my-day",
    title: {fr: "Organiser Ma journée", en: "Organise My day"},
    summary: {fr: "Priorités, activités, réunions et rapport quotidien au même endroit.", en: "Priorities, activities, meetings and daily report in one place."},
    steps: [
      {fr: "Consulte les priorités et rendez-vous prévus aujourd’hui.", en: "Review today's priorities and appointments."},
      {fr: "Mets à jour l’avancement de tes tâches pendant la journée.", en: "Update task progress during the day."},
      {fr: "Rédige ton rapport avant l’heure de fermeture de la journée.", en: "Write your report before the workday closes."},
      {fr: "Vérifie la confirmation d’envoi; après fermeture, seul le superviseur peut rouvrir la date.", en: "Check the submission confirmation; after closure, only a supervisor can reopen the date."},
    ],
  },
  {
    id: "notifications", category: "daily_work", duration: 3, href: "/dashboard/notifications",
    title: {fr: "Gérer ses notifications", en: "Manage notifications"},
    summary: {fr: "Identifier les actions importantes et conserver une boîte claire.", en: "Identify important actions and keep a clear inbox."},
    steps: [
      {fr: "Ouvre le centre de notifications depuis le menu.", en: "Open the notification centre from the menu."},
      {fr: "Clique sur une notification pour rejoindre l’élément concerné.", en: "Select a notification to open the related item."},
      {fr: "Marque comme lues les notifications déjà traitées.", en: "Mark processed notifications as read."},
    ],
  },
  {
    id: "sales-day", category: "sales", duration: 7, href: "/dashboard/crm/my-sales-day",
    title: {fr: "Piloter sa journée commerciale", en: "Run your sales day"},
    summary: {fr: "Prioriser les prospects et documenter chaque interaction.", en: "Prioritise leads and document every interaction."},
    steps: [
      {fr: "Ouvre Ma journée commerciale et examine les suivis attendus.", en: "Open My sales day and review expected follow-ups."},
      {fr: "Contacte le prospect puis enregistre le résultat réel de l’échange.", en: "Contact the lead and record the actual outcome."},
      {fr: "Planifie la prochaine action avec une date précise.", en: "Schedule the next action with a precise date."},
      {fr: "Déclare une vente uniquement après avoir vérifié le client, le produit et la preuve.", en: "Declare a sale only after checking the customer, product and evidence."},
    ],
  },
  {
    id: "sale-proof", category: "sales", duration: 5, href: "/dashboard/sales",
    title: {fr: "Enregistrer une vente et sa preuve", en: "Record a sale and its evidence"},
    summary: {fr: "Créer un dossier de vente complet qui peut être vérifié.", en: "Create a complete sales record that can be verified."},
    steps: [
      {fr: "Sélectionne le bon client et le produit vendu.", en: "Select the correct customer and sold product."},
      {fr: "Saisis le montant, le mode de règlement et le premier paiement.", en: "Enter the amount, payment method and first payment."},
      {fr: "Ajoute une preuve lisible avant la soumission.", en: "Add readable evidence before submitting."},
      {fr: "Relis le récapitulatif pour éviter les doublons.", en: "Review the summary to avoid duplicates."},
    ],
  },
  {
    id: "team-reports", category: "management", duration: 6, roles: LEADERS, href: "/dashboard/hr/daily-reports",
    title: {fr: "Suivre les rapports de son équipe", en: "Track team reports"},
    summary: {fr: "Contrôler les rapports manquants et intervenir avec traçabilité.", en: "Monitor missing reports and intervene with an audit trail."},
    steps: [
      {fr: "Choisis la date et le périmètre d’équipe autorisé.", en: "Choose the date and authorised team scope."},
      {fr: "Repère les rapports soumis, incomplets ou absents.", en: "Identify submitted, incomplete or missing reports."},
      {fr: "Relance les collaborateurs avant la fermeture.", en: "Remind team members before closure."},
      {fr: "Après fermeture, complète le rapport ou rouvre uniquement la date nécessaire; l’action est auditée.", en: "After closure, complete the report or reopen only the required date; the action is audited."},
    ],
  },
  {
    id: "meetings", category: "management", duration: 7, roles: LEADERS, href: "/dashboard/performance?view=meetings",
    title: {fr: "Créer une réunion et convoquer les participants", en: "Create a meeting and invite participants"},
    summary: {fr: "Programmer Zoom et sélectionner rapidement une grande équipe.", en: "Schedule Zoom and quickly select a large team."},
    steps: [
      {fr: "Renseigne le sujet, la date et l’heure, puis vérifie le compte Zoom autorisé pour ton rôle.", en: "Enter the subject, date and time, then verify the Zoom account allowed for your role."},
      {fr: "Utilise Tout sélectionner, Managers uniquement ou un département.", en: "Use Select all, Managers only or a department."},
      {fr: "Vérifie le compteur et retire les personnes non concernées.", en: "Check the counter and remove anyone not concerned."},
      {fr: "Crée la réunion puis vérifie la convocation et le lien Zoom.", en: "Create the meeting, then check the invitation and Zoom link."},
    ],
  },
  {
    id: "invite-member", category: "administration", duration: 6, roles: ["owner", "admin", "hr"], href: "/dashboard/members",
    title: {fr: "Inviter un nouveau collaborateur", en: "Invite a new team member"},
    summary: {fr: "Créer un accès initial clair et sécurisé.", en: "Create a clear and secure initial access."},
    steps: [
      {fr: "Crée le membre avec son e-mail, son rôle et ses affectations.", en: "Create the member with email, role and assignments."},
      {fr: "Génère l’accès temporaire et transmets les instructions prévues.", en: "Generate temporary access and send the intended instructions."},
      {fr: "Demande au collaborateur de remplacer le mot de passe à la première connexion.", en: "Ask the member to replace the password at first sign-in."},
      {fr: "Contrôle ensuite l’état d’activation sans demander son mot de passe personnel.", en: "Then check activation status without asking for their personal password."},
    ],
  },
  {
    id: "roles", category: "administration", duration: 8, roles: ["owner", "admin"], href: "/dashboard/roles-permissions",
    title: {fr: "Comprendre les rôles et permissions", en: "Understand roles and permissions"},
    summary: {fr: "Donner uniquement l’accès nécessaire à chaque responsabilité.", en: "Grant only the access required for each responsibility."},
    steps: [
      {fr: "Examine le rôle actuel et le périmètre organisationnel du membre.", en: "Review the member's current role and organisational scope."},
      {fr: "Compare les permissions avant toute modification.", en: "Compare permissions before making a change."},
      {fr: "Attribue le niveau minimal permettant d’accomplir le travail.", en: "Assign the minimum level required to perform the work."},
      {fr: "Teste l’affichage avec un compte représentatif après le changement.", en: "Test visibility with a representative account after the change."},
    ],
  },
  {
    id: "module-status", category: "administration", duration: 4, roles: ["owner", "admin"], href: "/dashboard/module-status",
    title: {fr: "Lire l’état des modules", en: "Read module status"},
    summary: {fr: "Distinguer ce qui est disponible, partiel ou encore à réaliser.", en: "Distinguish what is available, partial or still to be delivered."},
    steps: [
      {fr: "Consulte le résumé global et la date de l’audit.", en: "Review the global summary and audit date."},
      {fr: "Ouvre le domaine métier qui t’intéresse.", en: "Open the relevant business domain."},
      {fr: "Lis les travaux restants et les dépendances techniques.", en: "Read the remaining work and technical dependencies."},
      {fr: "Ne considère un statut Disponible comme validé qu’après les tests utilisateurs périodiques.", en: "Treat Available as validated only after periodic user testing."},
    ],
  },
];

export function guidesForRole(role: string) {
  return HELP_GUIDES.filter((guide) => !guide.roles || guide.roles.includes(role));
}
