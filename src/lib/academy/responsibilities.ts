export type LocalizedText = {fr: string; en: string};

export type AcademyResponsibilityProfile = {
  code:
    | "school_direction"
    | "academic_coordination"
    | "trainer"
    | "student_followup"
    | "communication"
    | "marketing"
    | "finance"
    | "data_analyst"
    | "observer";
  title: LocalizedText;
  mission: LocalizedText;
  responsibilities: LocalizedText[];
  daily?: LocalizedText[];
  weekly?: LocalizedText[];
  monthly?: LocalizedText[];
  beforeSession?: LocalizedText[];
  afterSession?: LocalizedText[];
  kpis: LocalizedText[];
  restrictions?: LocalizedText[];
};

const t = (fr: string, en: string): LocalizedText => ({fr, en});

export const ACADEMY_RESPONSIBILITY_PROFILES: AcademyResponsibilityProfile[] = [
  {
    code: "school_direction",
    title: t("Direction d’école", "School leadership"),
    mission: t(
      "Assurer la direction générale de l’école et garantir que les objectifs académiques, administratifs et de développement sont atteints.",
      "Lead the school and ensure academic, administrative and development objectives are achieved.",
    ),
    responsibilities: [
      t("Superviser l’ensemble des activités de l’école.", "Supervise all school activities."),
      t("Veiller à la qualité de l’expérience des étudiants.", "Ensure the quality of the student experience."),
      t("Superviser la coordination académique et les responsables fonctionnels.", "Supervise academic coordination and functional leads."),
      t("S’assurer que le calendrier académique est respecté.", "Ensure the academic calendar is respected."),
      t("Traiter ou arbitrer les problèmes importants remontés par l’équipe.", "Handle or arbitrate major issues escalated by the team."),
      t("Organiser les réunions de coordination de l’école.", "Organize school coordination meetings."),
      t("S’assurer que les formateurs disposent des informations nécessaires.", "Ensure trainers have the information they need."),
      t("Contrôler les indicateurs de performance de l’école.", "Monitor school performance indicators."),
      t("Faire le lien entre l’école et la Direction de iLEAD Global Institute.", "Act as the link between the school and iLEAD Global Institute leadership."),
      t("Proposer les améliorations nécessaires.", "Propose necessary improvements."),
    ],
    daily: [
      t("Consulter les alertes et problèmes remontés.", "Review alerts and escalated issues."),
      t("Vérifier les activités importantes du jour.", "Review the day’s key activities."),
      t("Valider les décisions nécessitant son autorisation.", "Approve decisions requiring authorization."),
      t("Répondre aux escalades de l’équipe.", "Respond to team escalations."),
    ],
    weekly: [
      t("Organiser ou présider la réunion de coordination.", "Organize or chair the coordination meeting."),
      t("Examiner les absences et difficultés des étudiants.", "Review student absences and difficulties."),
      t("Contrôler l’avancement du programme.", "Monitor program progress."),
      t("Examiner le rapport du Responsable du suivi.", "Review the Student Follow-up Lead report."),
      t("Examiner les principaux indicateurs académiques.", "Review key academic indicators."),
      t("Vérifier les prochaines sessions et événements.", "Review upcoming sessions and events."),
    ],
    monthly: [
      t("Produire le rapport de performance de l’école.", "Produce the school performance report."),
      t("Examiner les taux de participation, progression et abandon.", "Review participation, progression and dropout rates."),
      t("Réaliser une revue de performance de l’équipe académique.", "Conduct a performance review of the academic team."),
      t("Soumettre les recommandations à la Direction de l’Institut.", "Submit recommendations to Institute leadership."),
    ],
    kpis: [
      t("Taux d’assiduité", "Attendance rate"),
      t("Taux de progression", "Progression rate"),
      t("Taux d’abandon", "Dropout rate"),
      t("Satisfaction des étudiants", "Student satisfaction"),
      t("Respect du calendrier académique", "Academic calendar compliance"),
      t("Nombre de problèmes non résolus", "Number of unresolved issues"),
      t("Taux de réalisation des activités prévues", "Completion rate of planned activities"),
    ],
  },
  {
    code: "academic_coordination",
    title: t("Coordination académique", "Academic coordination"),
    mission: t(
      "Organiser et coordonner toutes les activités pédagogiques afin que les cours se déroulent correctement.",
      "Organize and coordinate teaching activities so classes run properly.",
    ),
    responsibilities: [
      t("Préparer le calendrier académique.", "Prepare the academic calendar."),
      t("Programmer les cours et sessions.", "Schedule classes and sessions."),
      t("Coordonner les formateurs.", "Coordinate trainers."),
      t("Confirmer la disponibilité des formateurs.", "Confirm trainer availability."),
      t("Vérifier que les supports de formation sont disponibles.", "Ensure training materials are available."),
      t("S’assurer que chaque session possède son formateur, son lien et son contenu.", "Ensure each session has a trainer, connection link and content."),
      t("Organiser les remplacements en cas d’indisponibilité.", "Arrange replacements when needed."),
      t("Contrôler la progression du programme.", "Monitor program progress."),
      t("Collaborer avec le Responsable du suivi pour identifier les difficultés académiques.", "Work with the Student Follow-up Lead to identify academic difficulties."),
      t("Informer la Direction d’école des incidents académiques.", "Inform School Leadership of academic incidents."),
    ],
    daily: [
      t("Vérifier les sessions prévues.", "Review scheduled sessions."),
      t("Confirmer les formateurs.", "Confirm trainers."),
      t("Vérifier les liens de connexion et supports.", "Check connection links and materials."),
      t("Gérer les changements de dernière minute.", "Handle last-minute changes."),
    ],
    weekly: [
      t("Vérifier le planning de la semaine suivante.", "Review next week’s schedule."),
      t("Contrôler les sessions réalisées.", "Review completed sessions."),
      t("Identifier les retards dans le programme.", "Identify program delays."),
      t("Faire le point avec les formateurs.", "Check in with trainers."),
    ],
    kpis: [
      t("Pourcentage de sessions réalisées à temps", "Percentage of sessions delivered on time"),
      t("Nombre de sessions annulées", "Number of cancelled sessions"),
      t("Nombre de changements de dernière minute", "Number of last-minute changes"),
      t("Respect du programme académique", "Academic program compliance"),
      t("Disponibilité des supports pédagogiques", "Availability of teaching materials"),
    ],
  },
  {
    code: "trainer",
    title: t("Formateur", "Trainer"),
    mission: t(
      "Transmettre les connaissances, compétences et outils prévus dans le programme et accompagner les étudiants dans leur apprentissage.",
      "Deliver the knowledge, skills and tools in the program and support students in their learning.",
    ),
    responsibilities: [
      t("Préparer les enseignements.", "Prepare teaching sessions."),
      t("Respecter le programme pédagogique.", "Follow the teaching program."),
      t("Animer les cours et ateliers.", "Deliver classes and workshops."),
      t("Répondre aux questions des étudiants.", "Answer student questions."),
      t("Donner les exercices ou travaux prévus.", "Assign planned exercises or work."),
      t("Évaluer les étudiants lorsque cela est nécessaire.", "Assess students when required."),
      t("Signaler les étudiants rencontrant des difficultés.", "Flag students experiencing difficulties."),
      t("Remplir le rapport de session.", "Complete the session report."),
      t("Respecter les horaires.", "Respect scheduled times."),
      t("Participer aux réunions pédagogiques demandées.", "Attend requested teaching meetings."),
    ],
    beforeSession: [
      t("Consulter le module à enseigner.", "Review the module to be taught."),
      t("Préparer les supports.", "Prepare materials."),
      t("Vérifier le lien et l’heure de la session.", "Check the session link and time."),
      t("Préparer les exercices.", "Prepare exercises."),
    ],
    afterSession: [
      t("Marquer la session comme réalisée.", "Mark the session as completed."),
      t("Enregistrer les présences.", "Record attendance."),
      t("Ajouter les observations importantes.", "Add important observations."),
      t("Signaler les étudiants nécessitant un suivi.", "Flag students requiring follow-up."),
    ],
    kpis: [
      t("Ponctualité", "Punctuality"),
      t("Sessions réalisées", "Sessions delivered"),
      t("Satisfaction des étudiants", "Student satisfaction"),
      t("Qualité des évaluations", "Assessment quality"),
      t("Respect du programme", "Program compliance"),
      t("Taux de participation des étudiants", "Student participation rate"),
    ],
  },
  {
    code: "student_followup",
    title: t("Responsable du suivi", "Student follow-up lead"),
    mission: t(
      "S’assurer qu’aucun étudiant ne soit oublié et accompagner chaque étudiant dans sa progression.",
      "Ensure no student is overlooked and support each student’s progression.",
    ),
    responsibilities: [
      t("Suivre les présences.", "Monitor attendance."),
      t("Identifier les étudiants absents.", "Identify absent students."),
      t("Contacter les étudiants qui ne participent plus.", "Contact students who have stopped participating."),
      t("Identifier les étudiants en difficulté.", "Identify students experiencing difficulties."),
      t("Vérifier la progression individuelle.", "Review individual progression."),
      t("Assurer les relances nécessaires.", "Carry out required follow-ups."),
      t("Documenter chaque intervention.", "Document each intervention."),
      t("Escalader les situations importantes.", "Escalate important situations."),
      t("Accompagner les étudiants jusqu’à la résolution de leurs difficultés.", "Support students until their difficulties are resolved."),
      t("Produire un rapport de suivi.", "Produce a follow-up report."),
    ],
    daily: [
      t("Consulter les nouvelles alertes étudiants.", "Review new student alerts."),
      t("Contacter les absents.", "Contact absent students."),
      t("Traiter les demandes de suivi.", "Handle follow-up requests."),
      t("Mettre à jour les dossiers.", "Update records."),
    ],
    weekly: [
      t("Produire la liste des étudiants à risque.", "Produce the at-risk student list."),
      t("Vérifier les cas ouverts.", "Review open cases."),
      t("Présenter le rapport de suivi à la Direction d’école.", "Present the follow-up report to School Leadership."),
    ],
    kpis: [
      t("Nombre d’étudiants suivis", "Number of students followed up"),
      t("Taux de réponse aux relances", "Response rate to follow-ups"),
      t("Taux de retour après absence", "Return rate after absence"),
      t("Nombre de cas non résolus", "Number of unresolved cases"),
      t("Délai moyen de prise en charge", "Average handling time"),
      t("Taux d’abandon", "Dropout rate"),
    ],
  },
  {
    code: "communication",
    title: t("Responsable communication", "Communications lead"),
    mission: t(
      "Assurer une communication claire, régulière et professionnelle entre l’école, les étudiants et les différentes parties prenantes.",
      "Ensure clear, regular and professional communication between the school, students and stakeholders.",
    ),
    responsibilities: [
      t("Préparer les annonces.", "Prepare announcements."),
      t("Informer les étudiants des cours et événements.", "Inform students about classes and events."),
      t("Communiquer les changements de programme.", "Communicate program changes."),
      t("Préparer les rappels importants.", "Prepare important reminders."),
      t("Publier les communications approuvées.", "Publish approved communications."),
      t("S’assurer que les informations diffusées sont exactes.", "Ensure published information is accurate."),
      t("Coordonner les communications avec la Direction.", "Coordinate communications with leadership."),
      t("Gérer le calendrier des communications.", "Manage the communications calendar."),
    ],
    kpis: [
      t("Communications envoyées à temps", "Communications sent on time"),
      t("Taux de lecture", "Read rate"),
      t("Nombre d’erreurs dans les communications", "Number of communication errors"),
      t("Respect du calendrier de communication", "Communication calendar compliance"),
      t("Délai de diffusion des informations urgentes", "Time to distribute urgent information"),
    ],
  },
  {
    code: "marketing",
    title: t("Responsable marketing", "Marketing lead"),
    mission: t(
      "Développer la visibilité de l’école et contribuer au recrutement de nouveaux étudiants.",
      "Grow the school’s visibility and contribute to new student recruitment.",
    ),
    responsibilities: [
      t("Préparer les campagnes de promotion.", "Prepare promotional campaigns."),
      t("Promouvoir les formations et événements.", "Promote programs and events."),
      t("Collaborer avec l’équipe commerciale.", "Collaborate with the sales team."),
      t("Produire ou coordonner les contenus marketing.", "Produce or coordinate marketing content."),
      t("Suivre les prospects générés.", "Track generated prospects."),
      t("Mesurer les performances des campagnes.", "Measure campaign performance."),
      t("Identifier les programmes ayant besoin de davantage de visibilité.", "Identify programs that need more visibility."),
      t("Préparer le calendrier marketing.", "Prepare the marketing calendar."),
    ],
    kpis: [
      t("Nombre de prospects générés", "Number of prospects generated"),
      t("Nombre d’inscriptions provenant des campagnes", "Number of enrollments from campaigns"),
      t("Coût par prospect lorsque applicable", "Cost per lead where applicable"),
      t("Taux de conversion", "Conversion rate"),
      t("Engagement sur les publications", "Content engagement"),
      t("Performance des campagnes", "Campaign performance"),
    ],
  },
  {
    code: "finance",
    title: t("Responsable financier", "Finance lead"),
    mission: t(
      "Assurer le suivi financier des activités de l’école et fournir une visibilité claire sur les paiements et obligations financières.",
      "Monitor the school’s financial activities and provide clear visibility into payments and financial obligations.",
    ),
    responsibilities: [
      t("Suivre les paiements des étudiants.", "Track student payments."),
      t("Identifier les échéances arrivées à terme.", "Identify due and overdue payments."),
      t("Vérifier les informations financières des inscriptions.", "Verify financial information related to enrollments."),
      t("Produire les rapports financiers de l’école.", "Produce school financial reports."),
      t("Signaler les anomalies.", "Flag anomalies."),
      t("Collaborer avec Finance centrale.", "Collaborate with central Finance."),
      t("Contrôler les dépenses autorisées de l’école lorsque applicable.", "Monitor authorized school expenses where applicable."),
      t("Fournir les indicateurs financiers à la Direction.", "Provide financial indicators to leadership."),
    ],
    restrictions: [
      t(
        "Ne pas modifier arbitrairement les dossiers académiques ou commerciaux : les responsabilités concernent les informations et opérations financières autorisées.",
        "Do not arbitrarily modify academic or sales records: responsibilities are limited to authorized financial information and operations.",
      ),
    ],
    kpis: [
      t("Montants encaissés", "Amounts collected"),
      t("Paiements en retard", "Overdue payments"),
      t("Taux de recouvrement", "Collection rate"),
      t("Nombre d’anomalies financières", "Number of financial anomalies"),
      t("Délai de traitement des paiements", "Payment processing time"),
      t("Fiabilité des rapports", "Report reliability"),
    ],
  },
  {
    code: "data_analyst",
    title: t("Analyste de données", "Data analyst"),
    mission: t(
      "Transformer les données de l’école en informations permettant à la Direction de prendre de meilleures décisions.",
      "Turn school data into information that helps leadership make better decisions.",
    ),
    responsibilities: [
      t("Analyser les inscriptions.", "Analyze enrollments."),
      t("Analyser l’assiduité.", "Analyze attendance."),
      t("Analyser la progression.", "Analyze progression."),
      t("Identifier les tendances d’abandon.", "Identify dropout trends."),
      t("Analyser les performances des cohortes.", "Analyze cohort performance."),
      t("Produire les tableaux de bord.", "Produce dashboards."),
      t("Identifier les anomalies dans les données.", "Identify data anomalies."),
      t("Préparer des rapports pour la Direction.", "Prepare reports for leadership."),
      t("Faire des recommandations basées sur les données.", "Make data-based recommendations."),
    ],
    kpis: [
      t("Fiabilité des données", "Data reliability"),
      t("Rapports produits à temps", "Reports delivered on time"),
      t("Nombre d’anomalies détectées", "Number of anomalies detected"),
      t("Qualité des tableaux de bord", "Dashboard quality"),
      t("Pertinence des recommandations", "Relevance of recommendations"),
    ],
  },
  {
    code: "observer",
    title: t("Observateur", "Observer"),
    mission: t(
      "Observer le fonctionnement de l’école et fournir un regard indépendant sans intervenir directement dans les opérations sauf autorisation particulière.",
      "Observe how the school operates and provide an independent perspective without directly intervening unless specifically authorized.",
    ),
    responsibilities: [
      t("Observer les sessions.", "Observe sessions."),
      t("Observer la qualité des interactions.", "Observe the quality of interactions."),
      t("Identifier les bonnes pratiques.", "Identify good practices."),
      t("Identifier les dysfonctionnements.", "Identify dysfunctions."),
      t("Documenter les observations.", "Document observations."),
      t("Produire des rapports objectifs.", "Produce objective reports."),
      t("Faire des recommandations.", "Make recommendations."),
      t("Signaler immédiatement tout problème grave à la Direction.", "Immediately report any serious issue to leadership."),
    ],
    restrictions: [
      t("Ne dirige pas les formateurs.", "Does not direct trainers."),
      t("Ne modifie pas le programme.", "Does not modify the program."),
      t("Ne sanctionne pas les étudiants.", "Does not sanction students."),
      t("Ne prend pas de décisions financières.", "Does not make financial decisions."),
      t("Ne modifie pas les dossiers des étudiants sauf autorisation particulière.", "Does not modify student records unless specifically authorized."),
    ],
    kpis: [
      t("Nombre d’observations réalisées", "Number of observations completed"),
      t("Rapports soumis", "Reports submitted"),
      t("Problèmes détectés", "Problems detected"),
      t("Recommandations mises en œuvre", "Recommendations implemented"),
    ],
  },
];


export const ACADEMY_STAFF_ROLE_TO_RESPONSIBILITY_CODE = {
  director: "school_direction",
  academic_coordinator: "academic_coordination",
  instructor: "trainer",
  follow_up: "student_followup",
  communication: "communication",
  marketing: "marketing",
  finance: "finance",
  data_analyst: "data_analyst",
  observer: "observer",
} as const;

export function academyStaffRoleToResponsibilityCode(role: string) {
  return ACADEMY_STAFF_ROLE_TO_RESPONSIBILITY_CODE[
    role as keyof typeof ACADEMY_STAFF_ROLE_TO_RESPONSIBILITY_CODE
  ] ?? null;
}

export const ACADEMY_RESPONSIBILITY_CODES = ACADEMY_RESPONSIBILITY_PROFILES.map((profile) => profile.code);

export function getAcademyResponsibilityProfile(code: string) {
  return ACADEMY_RESPONSIBILITY_PROFILES.find((profile) => profile.code === code) ?? null;
}

export type AcademyResponsibilityProfileOverrideRow = {
  role_code: string;
  profile_json: unknown;
  revision: number;
  is_customized?: boolean;
};

export type EffectiveAcademyResponsibilityProfile = AcademyResponsibilityProfile & {
  revision: number;
  customized: boolean;
};

function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.fr === "string" && typeof row.en === "string";
}

function isLocalizedTextArray(value: unknown): value is LocalizedText[] {
  return Array.isArray(value) && value.every(isLocalizedText);
}

function parseAcademyResponsibilityProfile(value: unknown): AcademyResponsibilityProfile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const code = String(row.code ?? "");
  if (!ACADEMY_RESPONSIBILITY_CODES.includes(code as (typeof ACADEMY_RESPONSIBILITY_CODES)[number])) return null;
  if (!isLocalizedText(row.title) || !isLocalizedText(row.mission)) return null;
  if (!isLocalizedTextArray(row.responsibilities) || !isLocalizedTextArray(row.kpis)) return null;

  const optionalList = (key: string) => {
    const candidate = row[key];
    if (candidate === undefined || candidate === null) return undefined;
    return isLocalizedTextArray(candidate) ? candidate : undefined;
  };

  return {
    code: code as AcademyResponsibilityProfile["code"],
    title: row.title,
    mission: row.mission,
    responsibilities: row.responsibilities,
    daily: optionalList("daily"),
    weekly: optionalList("weekly"),
    monthly: optionalList("monthly"),
    beforeSession: optionalList("beforeSession"),
    afterSession: optionalList("afterSession"),
    kpis: row.kpis,
    restrictions: optionalList("restrictions"),
  };
}

export function buildEffectiveAcademyResponsibilityProfiles(
  overrides: AcademyResponsibilityProfileOverrideRow[] | null | undefined,
): EffectiveAcademyResponsibilityProfile[] {
  const overrideByRole = new Map((overrides ?? []).map((row) => [row.role_code, row]));

  return ACADEMY_RESPONSIBILITY_PROFILES.map((defaultProfile) => {
    const override = overrideByRole.get(defaultProfile.code);
    const parsed = override ? parseAcademyResponsibilityProfile(override.profile_json) : null;
    if (!parsed || parsed.code !== defaultProfile.code) {
      return {...defaultProfile, revision: 1, customized: false};
    }
    return {
      ...parsed,
      revision: Math.max(2, Number(override?.revision ?? 2)),
      customized: override?.is_customized !== false,
    };
  });
}

export function getAcademyResponsibilityProfileFrom<T extends AcademyResponsibilityProfile>(
  profiles: readonly T[],
  code: string,
): T | null {
  return profiles.find((profile) => profile.code === code) ?? null;
}
