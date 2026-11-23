import Link from "next/link";
import {LanguageSwitcher} from "@/components/i18n/language-switcher";
import {RecoveryHashRedirect} from "@/components/auth/recovery-hash-redirect";
import {getI18n} from "@/i18n/server";
import {createClient} from "@/lib/supabase/server";

type IconName =
  | "workflow"
  | "people"
  | "sales"
  | "finance"
  | "academy"
  | "events"
  | "message"
  | "growth"
  | "security"
  | "check"
  | "arrow";

function Icon({name, className = "h-6 w-6"}: {name: IconName; className?: string}) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "workflow") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
        <path d="M10 6.5h4a3 3 0 0 1 3 3V14M14 17.5h-4a3 3 0 0 1-3-3V10" />
      </svg>
    );
  }
  if (name === "people") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a4.5 4.5 0 0 1 8 0" />
      </svg>
    );
  }
  if (name === "sales") {
    return (
      <svg {...common}>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
        <path d="m3 8 6-4 6 3 7-5" />
      </svg>
    );
  }
  if (name === "finance") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M8 15h3M15 15h2" />
      </svg>
    );
  }
  if (name === "academy") {
    return (
      <svg {...common}>
        <path d="m3 9 9-5 9 5-9 5-9-5Z" />
        <path d="M7 12v4.5c2.8 2 7.2 2 10 0V12M21 9v6" />
      </svg>
    );
  }
  if (name === "events") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 17h2" />
      </svg>
    );
  }
  if (name === "message") {
    return (
      <svg {...common}>
        <path d="M7 18.5 3.5 21v-5.2A8 8 0 1 1 7 18.5Z" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    );
  }
  if (name === "growth") {
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V6M16 20v-9M22 20V3" />
        <path d="m4 8 5-4 6 3 7-5" />
      </svg>
    );
  }
  if (name === "security") {
    return (
      <svg {...common}>
        <path d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ProductPreview({labels}: {labels: Record<string, string>}) {
  const modules = [
    [labels.priorities, "08", "bg-indigo-500"],
    [labels.sales, "12", "bg-sky-500"],
    [labels.finance, "$", "bg-emerald-500"],
    [labels.academy, "04", "bg-amber-500"],
  ];

  return (
    <div className="relative mx-auto w-full max-w-[620px]">
      <div className="absolute -inset-8 rounded-[3rem] bg-indigo-500/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.8rem] border border-white/15 bg-white shadow-2xl shadow-slate-950/35">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-bold text-slate-600">app.ileadglobal.org</span>
          <span className="h-6 w-6 rounded-full bg-indigo-100" />
        </div>

        <div className="grid min-h-[410px] grid-cols-[90px_1fr] bg-slate-100 sm:grid-cols-[126px_1fr]">
          <aside className="bg-slate-950 p-3 text-white sm:p-4">
            <div className="mb-6 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400 text-xs text-slate-950">★</span>
              <span className="hidden text-[9px] font-black sm:inline">SUPER LEADER</span>
            </div>
            <div className="space-y-2.5">
              {[0, 1, 2, 3, 4, 5, 6].map((item) => (
                <div key={item} className={`h-7 rounded-lg ${item === 0 ? "bg-indigo-600" : "bg-white/[0.07]"}`} />
              ))}
            </div>
          </aside>

          <div className="p-4 sm:p-5">
            <div className="rounded-2xl bg-slate-950 px-5 py-5 text-white">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-400">{labels.command}</p>
              <p className="mt-2 text-lg font-black sm:text-xl">{labels.hello}</p>
              <p className="mt-1 text-[11px] text-slate-300">{labels.overview}</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {modules.map(([label, value, colour]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className={`mb-3 block h-2 w-8 rounded-full ${colour}`} />
                  <p className="text-[9px] font-bold text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1.25fr_.75fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-slate-900">{labels.execution}</p>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[8px] font-black text-emerald-700">LIVE</span>
                </div>
                <div className="mt-5 space-y-3">
                  {[78, 62, 88, 54].map((width, index) => (
                    <div key={width}>
                      <div className="mb-1 flex justify-between text-[8px] font-bold text-slate-400">
                        <span>{[labels.team, labels.crm, labels.academy, labels.events][index]}</span>
                        <span>{width}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-indigo-500" style={{width: `${width}%`}} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-black text-slate-900">{labels.today}</p>
                <div className="mt-4 space-y-3">
                  {["bg-amber-400", "bg-indigo-500", "bg-emerald-500"].map((colour, index) => (
                    <div key={colour} className="flex items-center gap-2">
                      <span className={`h-8 w-1 rounded-full ${colour}`} />
                      <div className="flex-1">
                        <span className="block h-2 rounded bg-slate-200" />
                        <span className="mt-1 block h-1.5 w-2/3 rounded bg-slate-100" />
                      </div>
                      <span className="text-[8px] font-bold text-slate-400">0{index + 8}:00</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs font-semibold text-slate-400">{labels.demo}</p>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  const {locale, t} = await getI18n();
  const fr = locale === "fr";

  const copy = fr
    ? {
        nav: [
          ["Solution", "#solution"],
          ["Modules", "#modules"],
          ["Academy", "#academy"],
          ["Sécurité", "#securite"],
          ["Plans", "/pricing"],
        ],
        eyebrow: "Plateforme de pilotage opérationnel",
        titleA: "Pilotez toute votre organisation",
        titleB: "depuis une seule plateforme.",
        subtitle:
          "Super Leader réunit équipes, RH, ventes, finances, Academy, événements et communication dans un seul système de pilotage — avec responsabilités, performance et décisions visibles en temps réel.",
        demo: "Demander une démonstration",
        discover: "Voir comment ça fonctionne",
        internalQuestion: "Vous êtes collaborateur iLEAD Global ?",
        internalLink: "Demander votre accès interne",
        proof: ["Priorités & rapports", "RH & équipes", "CRM & ventes", "Finance", "Super Leader Academy", "Audit & sécurité"],
        proofStripTitle: "Un système conçu pour remplacer les suivis dispersés.",
        proofStats: [
          ["9", "domaines opérationnels reliés"],
          ["1", "source de vérité pour l'organisation"],
          ["FR / EN", "expérience bilingue"],
          ["AUDIT", "actions sensibles traçables"],
        ],
        conversionEyebrow: "Pourquoi changer maintenant",
        conversionTitle: "Moins d'outils à recoller. Plus d'exécution visible.",
        conversionBeforeTitle: "Quand les opérations sont dispersées",
        conversionBefore: ["Priorités dans un outil, ventes dans un autre", "Paiements et preuves difficiles à rapprocher", "Responsabilités connues oralement mais peu pilotées", "Direction obligée de reconstruire l'information"],
        conversionAfterTitle: "Avec Super Leader",
        conversionAfter: ["Un cycle quotidien commun à toute l'organisation", "CRM, ventes et finance reliés au même contexte", "Rôles, responsabilités et permissions visibles", "Indicateurs consolidés pour agir plus vite"],
        preview: {
          command: "Centre de pilotage",
          hello: "Toute l'organisation. Une seule vue.",
          overview: "Aperçu opérationnel en temps réel",
          priorities: "Priorités",
          sales: "Ventes",
          finance: "Finance",
          academy: "Academy",
          execution: "Exécution par activité",
          team: "Équipe",
          crm: "CRM",
          events: "Événements",
          today: "Aujourd'hui",
          demo: "Aperçu illustratif de l'environnement Super Leader",
        },
        outcomeEyebrow: "Un système de travail connecté",
        outcomeTitle: "Remplacez les silos par une seule source de vérité opérationnelle.",
        outcomeSubtitle:
          "Les priorités, responsabilités, clients, paiements, formations, documents et décisions restent reliés au bon collaborateur, à la bonne équipe et au bon contexte.",
        outcomes: [
          ["workflow", "Exécuter avec clarté", "Priorités du matin, tâches, échéances, rapports journaliers et suivi des résultats dans un même cycle d'exécution."],
          ["people", "Responsabiliser les équipes", "Rôles, responsabilités, superviseurs, permissions et visibilité adaptée à chaque niveau de l'organisation."],
          ["growth", "Décider avec des données", "Direction et managers disposent d'indicateurs consolidés pour suivre activité, performance, ventes, finance et apprentissage."],
        ],
        modulesEyebrow: "Modules opérationnels",
        modulesTitle: "Super Leader couvre le parcours complet de l'organisation.",
        modulesSubtitle: "Activez les domaines dont vous avez besoin tout en gardant une expérience unifiée pour vos équipes.",
        modules: [
          ["workflow", "Exécution & performance", "Priorités quotidiennes, tâches, présence, rapports, KPI, suivi manager et reconnaissance de la performance."],
          ["people", "RH & équipes", "Départements, équipes, rôles, congés, politiques de travail, profils collaborateurs et gouvernance managériale."],
          ["sales", "CRM, ventes & recouvrement", "Prospects, secteurs, scoring, ambassadeurs, opportunités, ventes, commissions et suivi des encaissements."],
          ["finance", "Finance & paiements", "Paiements, créances, facturation, trésorerie, paie, documents financiers et traçabilité des allocations."],
          ["academy", "Super Leader Academy", "Écoles, programmes, cohortes, sessions récurrentes, appel, évaluations, certificats et responsabilités académiques."],
          ["events", "Événements & missions", "Équipes temporaires, objectifs, tâches, budgets, documents et pilotage opérationnel des événements."],
          ["message", "Communication interne", "Messagerie, notifications, réactions, consignes et recherche globale sécurisée dans l'organisation."],
          ["growth", "VIP & croissance", "Adhésions, suivi commercial VIP, campagnes, funnel, indicateurs de croissance et pilotage marketing."],
          ["security", "Gouvernance & fiabilité", "Permissions, audit, isolation des organisations, sécurité documentaire et centre de santé opérationnelle."],
        ],
        operatingEyebrow: "Une journée avec Super Leader",
        operatingTitle: "De la priorité du matin à la décision de direction.",
        steps: [
          ["01", "Planifier", "Chaque collaborateur commence avec ses priorités, tâches, échéances et responsabilités visibles."],
          ["02", "Exécuter", "Le travail avance dans les modules concernés : CRM, Finance, Academy, RH, événements ou opérations internes."],
          ["03", "Rendre compte", "Présences, rapports, paiements, preuves, résultats et blocages sont enregistrés au fil de l'activité."],
          ["04", "Piloter", "Managers et direction voient les écarts, risques, progrès et décisions à prendre sans reconstruire l'information manuellement."],
        ],
        academyEyebrow: "Super Leader Academy",
        academyTitle: "Une vraie opération académique, pas seulement un catalogue de cours.",
        academyText:
          "Gérez plusieurs écoles, les étudiants, les responsabilités, les séances et les présences depuis la même plateforme que le reste de votre organisation.",
        academyItems: [
          ["Écoles & accès", "Inscription à l'école, programmes, cohortes et règles d'accès adaptées à votre modèle pédagogique."],
          ["Sessions récurrentes", "Hebdomadaire, toutes les 2 semaines, mensuelle ou dernier jour ciblé du mois."],
          ["Présences", "Feuilles d'appel synchronisées, rattrapage de présence passée et historique auditable."],
          ["Responsabilités", "Missions, tâches, KPI et visibilité adaptées aux responsables académiques."],
          ["Validation", "Quiz, suivi des acquis et certificats vérifiables avec QR code."],
        ],
        audienceEyebrow: "Pour les organisations qui veulent exécuter",
        audienceTitle: "Conçu pour structurer des opérations réelles, pas seulement produire des tableaux de bord.",
        audiences: [
          ["Entreprises & groupes", "Coordonnez plusieurs départements, équipes et niveaux de management dans un cadre commun."],
          ["Instituts & académies", "Reliez administration, étudiants, formateurs, sessions, présences, paiements et responsabilités."],
          ["Équipes commerciales", "Reliez acquisition, CRM, ventes, encaissements, commissions, recouvrement et marketing."],
          ["Organisations multi-activités", "Pilotez RH, finance, événements, formation et opérations sans multiplier les outils déconnectés."],
        ],
        securityEyebrow: "Sécurité, gouvernance et traçabilité",
        securityTitle: "Chacun voit ce qu'il doit voir. Les actions sensibles restent traçables.",
        securityText:
          "Les permissions sont appliquées selon l'organisation, l'équipe, la fonction et le périmètre métier. Les contrôles serveur et les politiques de données restent l'autorité finale.",
        securityItems: [
          "Isolation des organisations et contrôle par rôles",
          "Managers limités à leurs équipes et responsabilités",
          "Journal d'audit pour les actions sensibles",
          "Documents, exports et recherches soumis aux permissions",
          "Centre de santé et de fiabilité pour les opérations critiques",
        ],
        pathsEyebrow: "Commencer avec Super Leader",
        pathsTitle: "Deux parcours, une même plateforme.",
        organisationTitle: "Pour votre organisation",
        organisationText: "Découvrez comment Super Leader peut remplacer les suivis dispersés par un système opérationnel adapté à votre structure.",
        organisationCta: "Demander une démonstration",
        internalTitle: "Pour les collaborateurs iLEAD",
        internalText: "Vous travaillez déjà avec iLEAD Global ? Demandez votre accès à l'espace interne sécurisé.",
        internalCta: "Demander un accès interne",
        finalEyebrow: "Une organisation. Un système. Une exécution visible.",
        finalTitle: "Passez d'une accumulation d'outils à un vrai système de pilotage.",
        finalText: "Présentez-nous votre organisation, vos équipes et vos processus. Nous vous montrerons comment Super Leader peut les réunir dans un environnement unique.",
        pricing: "Voir les plans",
        footer: "Super Leader — Planifier · Exécuter · Mesurer · Progresser",
      }
    : {
        nav: [
          ["Solution", "#solution"],
          ["Modules", "#modules"],
          ["Academy", "#academy"],
          ["Security", "#securite"],
          ["Plans", "/pricing"],
        ],
        eyebrow: "Operational management platform",
        titleA: "Run your whole organisation",
        titleB: "from one platform.",
        subtitle:
          "Super Leader brings teams, HR, sales, finance, Academy, events and communication into one operating system — with visible accountability, performance and real-time decisions.",
        demo: "Request a demo",
        discover: "See how it works",
        internalQuestion: "Are you an iLEAD Global team member?",
        internalLink: "Request internal access",
        proof: ["Priorities & reports", "HR & teams", "CRM & sales", "Finance", "Super Leader Academy", "Audit & security"],
        proofStripTitle: "One system designed to replace scattered operational follow-up.",
        proofStats: [
          ["9", "connected operational domains"],
          ["1", "source of truth for the organisation"],
          ["FR / EN", "bilingual experience"],
          ["AUDIT", "traceable sensitive actions"],
        ],
        conversionEyebrow: "Why change now",
        conversionTitle: "Less tool stitching. More visible execution.",
        conversionBeforeTitle: "When operations are scattered",
        conversionBefore: ["Priorities in one tool, sales in another", "Payments and evidence are hard to reconcile", "Responsibilities are known verbally but poorly managed", "Leaders rebuild information before they can decide"],
        conversionAfterTitle: "With Super Leader",
        conversionAfter: ["One daily operating cycle across the organisation", "CRM, sales and finance connected to the same context", "Roles, responsibilities and permissions made visible", "Consolidated signals for faster decisions"],
        preview: {
          command: "Command centre",
          hello: "Your whole organisation. One view.",
          overview: "Real-time operational overview",
          priorities: "Priorities",
          sales: "Sales",
          finance: "Finance",
          academy: "Academy",
          execution: "Execution by activity",
          team: "Team",
          crm: "CRM",
          events: "Events",
          today: "Today",
          demo: "Illustrative preview of the Super Leader workspace",
        },
        outcomeEyebrow: "A connected operating system",
        outcomeTitle: "Replace silos with one operational source of truth.",
        outcomeSubtitle:
          "Priorities, responsibilities, clients, payments, learning, documents and decisions remain connected to the right person, team and business context.",
        outcomes: [
          ["workflow", "Execute with clarity", "Morning priorities, tasks, deadlines, daily reports and results tracking in one execution cycle."],
          ["people", "Create accountability", "Roles, responsibilities, supervisors, permissions and visibility adapted to every level of the organisation."],
          ["growth", "Make decisions with data", "Leaders and managers get consolidated signals across activity, performance, sales, finance and learning."],
        ],
        modulesEyebrow: "Operational modules",
        modulesTitle: "Super Leader covers the full organisational journey.",
        modulesSubtitle: "Activate the domains you need while keeping one unified experience for your teams.",
        modules: [
          ["workflow", "Execution & performance", "Daily priorities, tasks, attendance, reports, KPIs, manager follow-up and performance recognition."],
          ["people", "HR & teams", "Departments, teams, roles, leave, work policies, employee profiles and management governance."],
          ["sales", "CRM, sales & collections", "Leads, sectors, scoring, ambassadors, opportunities, sales, commissions and payment follow-up."],
          ["finance", "Finance & payments", "Payments, receivables, invoicing, cash flow, payroll, financial documents and allocation traceability."],
          ["academy", "Super Leader Academy", "Schools, programmes, cohorts, recurring sessions, attendance, assessments, certificates and academic responsibilities."],
          ["events", "Events & missions", "Temporary teams, objectives, tasks, budgets, documents and operational event management."],
          ["message", "Internal communication", "Messaging, notifications, reactions, instructions and secure global search across the organisation."],
          ["growth", "VIP & growth", "Memberships, VIP commercial follow-up, campaigns, funnel management, growth indicators and marketing control."],
          ["security", "Governance & reliability", "Permissions, audit, organisation isolation, document security and an operational health centre."],
        ],
        operatingEyebrow: "A day with Super Leader",
        operatingTitle: "From morning priorities to leadership decisions.",
        steps: [
          ["01", "Plan", "Every person starts with visible priorities, tasks, deadlines and responsibilities."],
          ["02", "Execute", "Work moves through the right module: CRM, Finance, Academy, HR, events or internal operations."],
          ["03", "Report", "Attendance, reports, payments, evidence, results and blockers are captured as work happens."],
          ["04", "Lead", "Managers and executives see gaps, risks, progress and decisions without rebuilding information manually."],
        ],
        academyEyebrow: "Super Leader Academy",
        academyTitle: "Real academic operations, not just a course catalogue.",
        academyText:
          "Manage multiple schools, students, responsibilities, sessions and attendance from the same platform that runs the rest of your organisation.",
        academyItems: [
          ["Schools & access", "School enrolment, programmes, cohorts and access rules that match your learning model."],
          ["Recurring sessions", "Weekly, every two weeks, monthly or a specific last weekday of the month."],
          ["Attendance", "Synced attendance sheets, retroactive capture and auditable history."],
          ["Responsibilities", "Missions, tasks, KPIs and visibility tailored to academic responsibility holders."],
          ["Validation", "Quizzes, learning follow-up and QR-verifiable certificates."],
        ],
        audienceEyebrow: "For organisations that need execution",
        audienceTitle: "Built to structure real operations, not just generate dashboards.",
        audiences: [
          ["Companies & groups", "Coordinate multiple departments, teams and management layers within one operating framework."],
          ["Institutes & academies", "Connect administration, students, trainers, sessions, attendance, payments and responsibilities."],
          ["Commercial teams", "Connect acquisition, CRM, sales, collections, commissions, recovery and marketing."],
          ["Multi-activity organisations", "Run HR, finance, events, learning and operations without multiplying disconnected tools."],
        ],
        securityEyebrow: "Security, governance and traceability",
        securityTitle: "People see what they should see. Sensitive actions remain traceable.",
        securityText:
          "Permissions are applied by organisation, team, function and business scope. Server-side controls and data policies remain the final authority.",
        securityItems: [
          "Organisation isolation and role-based access",
          "Managers limited to their teams and responsibilities",
          "Audit trail for sensitive actions",
          "Documents, exports and search governed by permissions",
          "Health and reliability centre for critical operations",
        ],
        pathsEyebrow: "Get started with Super Leader",
        pathsTitle: "Two pathways. One platform.",
        organisationTitle: "For your organisation",
        organisationText: "See how Super Leader can replace scattered follow-up with an operating system tailored to your structure.",
        organisationCta: "Request a demo",
        internalTitle: "For iLEAD team members",
        internalText: "Already working with iLEAD Global? Request access to the secure internal workspace.",
        internalCta: "Request internal access",
        finalEyebrow: "One organisation. One system. Visible execution.",
        finalTitle: "Move from a collection of tools to a real operating system.",
        finalText: "Show us your organisation, teams and processes. We will show you how Super Leader can bring them into one environment.",
        pricing: "View plans",
        footer: "Super Leader — Plan · Execute · Measure · Grow",
      };

  return (
    <main className="min-h-screen overflow-hidden bg-slate-50 text-slate-950">
      <RecoveryHashRedirect />

      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_12%_14%,rgba(99,102,241,.38),transparent_31%),radial-gradient(circle_at_88%_8%,rgba(245,158,11,.2),transparent_25%),radial-gradient(circle_at_78%_88%,rgba(14,165,233,.16),transparent_28%)]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-24 pt-5 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl sm:px-5">
            <Link href="/" className="flex items-center gap-3" aria-label={t("brand.name")}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 font-black text-slate-950 shadow-lg shadow-amber-400/20">★</span>
              <div>
                <p className="text-sm font-black tracking-wide">{t("brand.name")}</p>
                <p className="hidden text-[10px] text-slate-400 sm:block">{t("brand.shortPromise")}</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm font-bold text-slate-300 xl:flex">
              {copy.nav.map(([label, href]) => (
                <a key={href} href={href} className="transition hover:text-white">{label}</a>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <LanguageSwitcher variant="dark" />
              {data.user ? (
                <Link className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-300" href="/dashboard">
                  {t("home.dashboard")}
                </Link>
              ) : (
                <>
                  <Link className="hidden rounded-xl border border-white/20 px-4 py-2 text-sm font-black transition hover:bg-white/10 sm:inline-flex" href="/login">
                    {t("home.login")}
                  </Link>
                  <Link className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500" href="/signup">
                    {copy.demo}
                  </Link>
                </>
              )}
            </div>
          </header>

          <div className="grid items-center gap-16 pb-4 pt-16 lg:grid-cols-[.92fr_1.08fr] lg:pt-24">
            <div>
              <p className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.19em] text-amber-300">
                {copy.eyebrow}
              </p>
              <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-[4.25rem]">
                {copy.titleA}
                <span className="mt-2 block bg-gradient-to-r from-amber-300 via-white to-indigo-300 bg-clip-text text-transparent">{copy.titleB}</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">{copy.subtitle}</p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 font-black shadow-xl shadow-indigo-600/25 transition hover:-translate-y-0.5 hover:bg-indigo-500">
                  {copy.demo}<Icon name="arrow" className="h-5 w-5" />
                </Link>
                <a href="#fonctionnement" className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-4 font-black transition hover:bg-white/10">
                  {copy.discover}
                </a>
                <Link href="/pricing" className="inline-flex items-center justify-center px-3 py-4 text-sm font-black text-amber-300 transition hover:text-amber-200">
                  {copy.pricing}
                </Link>
              </div>

              <p className="mt-5 text-sm text-slate-400">
                {copy.internalQuestion}{" "}
                <Link href="/ilead-access" className="font-black text-amber-300 underline decoration-amber-300/40 underline-offset-4 transition hover:text-amber-200">
                  {copy.internalLink}
                </Link>
              </p>

              <div className="mt-9 flex flex-wrap gap-2.5">
                {copy.proof.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300">
                    <Icon name="check" className="h-4 w-4 text-emerald-400" />{item}
                  </span>
                ))}
              </div>
            </div>

            <ProductPreview labels={copy.preview} />
          </div>
        </div>
      </section>

      <section className="relative -mt-7 px-5 sm:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">{copy.proofStripTitle}</p>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 lg:max-w-3xl lg:grid-cols-4">
              {copy.proofStats.map(([value, label]) => (
                <div key={label} className="rounded-2xl bg-slate-50 px-4 py-4 text-center">
                  <p className="text-2xl font-black tracking-tight text-slate-950">{value}</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="solution" className="px-5 pb-8 pt-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.conversionEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.conversionTitle}</h2>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="rounded-[1.8rem] border border-rose-200 bg-rose-50/70 p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-100 font-black text-rose-700">×</span>
                <h3 className="text-xl font-black text-slate-950">{copy.conversionBeforeTitle}</h3>
              </div>
              <div className="mt-6 space-y-3">
                {copy.conversionBefore.map((item) => (
                  <p key={item} className="flex gap-3 text-sm leading-6 text-slate-700"><span className="mt-1 text-rose-500">●</span><span>{item}</span></p>
                ))}
              </div>
            </article>
            <article className="rounded-[1.8rem] border border-emerald-200 bg-emerald-50/70 p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Icon name="check" className="h-5 w-5" /></span>
                <h3 className="text-xl font-black text-slate-950">{copy.conversionAfterTitle}</h3>
              </div>
              <div className="mt-6 space-y-3">
                {copy.conversionAfter.map((item) => (
                  <p key={item} className="flex gap-3 text-sm leading-6 text-slate-700"><Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-emerald-600" /><span>{item}</span></p>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 md:grid-cols-3 md:p-6">
          {copy.outcomes.map(([icon, title, text]) => (
            <article key={title} className="rounded-2xl bg-slate-50 p-6">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-100 text-indigo-700"><Icon name={icon as IconName} /></span>
              <h2 className="mt-5 text-lg font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.outcomeEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{copy.outcomeTitle}</h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">{copy.outcomeSubtitle}</p>
          </div>
        </div>
      </section>

      <section id="modules" className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.modulesEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.modulesTitle}</h2>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-600">{copy.modulesSubtitle}</p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {copy.modules.map(([icon, title, text], index) => {
              const tones = [
                "bg-indigo-100 text-indigo-700",
                "bg-violet-100 text-violet-700",
                "bg-sky-100 text-sky-700",
                "bg-emerald-100 text-emerald-700",
                "bg-amber-100 text-amber-700",
                "bg-orange-100 text-orange-700",
                "bg-cyan-100 text-cyan-700",
                "bg-fuchsia-100 text-fuchsia-700",
                "bg-slate-200 text-slate-700",
              ];
              return (
                <article key={title} className="group rounded-[1.6rem] border border-slate-200 bg-slate-50 p-7 transition hover:-translate-y-1 hover:border-indigo-200 hover:bg-white hover:shadow-xl hover:shadow-indigo-950/5">
                  <div className="flex items-start justify-between gap-4">
                    <span className={`grid h-12 w-12 place-items-center rounded-2xl ${tones[index]}`}><Icon name={icon as IconName} /></span>
                    <span className="text-xs font-black text-slate-300">0{index + 1}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-black">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="fonctionnement" className="bg-slate-950 px-5 py-24 text-white sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">{copy.operatingEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.operatingTitle}</h2>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-4">
            {copy.steps.map(([number, title, text]) => (
              <article key={number} className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/5 p-7">
                <p className="text-5xl font-black text-white/10">{number}</p>
                <h3 className="mt-5 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-400">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="academy" className="px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-start gap-12 lg:grid-cols-[.9fr_1.1fr]">
          <div className="lg:sticky lg:top-8">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.academyEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{copy.academyTitle}</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">{copy.academyText}</p>
            <div className="mt-8 rounded-[1.8rem] bg-slate-950 p-7 text-white shadow-xl">
              <div className="flex items-center gap-4">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-400 text-slate-950"><Icon name="academy" className="h-7 w-7" /></span>
                <div>
                  <p className="text-sm font-black uppercase tracking-[.18em] text-amber-300">Academy Operations</p>
                  <p className="mt-1 text-lg font-black">{fr ? "Du calendrier à la certification" : "From schedule to certification"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {copy.academyItems.map(([title, text], index) => (
              <article key={title} className="flex gap-5 rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-sm">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-100 text-sm font-black text-indigo-700">0{index + 1}</span>
                <div>
                  <h3 className="text-lg font-black">{title}</h3>
                  <p className="mt-2 leading-7 text-slate-600">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.audienceEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.audienceTitle}</h2>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {copy.audiences.map(([title, text], index) => (
              <article key={title} className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-7">
                <span className="text-xs font-black uppercase tracking-[.18em] text-indigo-500">0{index + 1}</span>
                <h3 className="mt-4 text-2xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="securite" className="px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[.95fr_1.05fr]">
          <div>
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.securityEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{copy.securityTitle}</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">{copy.securityText}</p>
            <div className="mt-8 space-y-3">
              {copy.securityItems.map((item) => (
                <p key={item} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Icon name="check" className="h-4 w-4" /></span>
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/15 sm:p-8">
            <p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">{fr ? "Visibilité par périmètre" : "Visibility by scope"}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ["Owner", fr ? "Organisation" : "Organisation"],
                [fr ? "Administrateur" : "Administrator", fr ? "Configuration" : "Configuration"],
                [fr ? "Responsable RH" : "HR Manager", fr ? "RH & équipes" : "HR & teams"],
                ["Manager", fr ? "Équipe" : "Team"],
                [fr ? "Responsable spécialisé" : "Specialist lead", fr ? "Périmètre métier" : "Business scope"],
                [fr ? "Collaborateur" : "Employee", fr ? "Ses responsabilités" : "Own responsibilities"],
              ].map(([role, scope]) => (
                <div key={role} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="font-black">{role}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-400">{scope}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.pathsEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.pathsTitle}</h2>
          </div>
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <article className="relative overflow-hidden rounded-[2rem] bg-indigo-600 p-8 text-white shadow-xl shadow-indigo-600/15 sm:p-10">
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Icon name="people" className="h-7 w-7" /></span>
              <h3 className="mt-8 text-3xl font-black">{copy.organisationTitle}</h3>
              <p className="mt-4 max-w-xl text-lg leading-8 text-indigo-100">{copy.organisationText}</p>
              <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-4 font-black text-indigo-700 transition hover:bg-amber-300 hover:text-slate-950">
                {copy.organisationCta}<Icon name="arrow" className="h-5 w-5" />
              </Link>
            </article>

            <article className="relative overflow-hidden rounded-[2rem] bg-amber-400 p-8 text-slate-950 shadow-xl shadow-amber-500/15 sm:p-10">
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/25" />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white"><Icon name="security" className="h-7 w-7" /></span>
              <h3 className="mt-8 text-3xl font-black">{copy.internalTitle}</h3>
              <p className="mt-4 max-w-xl text-lg leading-8 text-amber-950/75">{copy.internalText}</p>
              <Link href="/ilead-access" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-4 font-black text-white transition hover:bg-indigo-700">
                {copy.internalCta}<Icon name="arrow" className="h-5 w-5" />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-950 px-7 py-14 text-center text-white shadow-2xl shadow-indigo-900/20 sm:px-12 sm:py-16">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-300">{copy.finalEyebrow}</p>
          <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">{copy.finalTitle}</h2>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-indigo-100">{copy.finalText}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-7 py-4 font-black text-slate-950 transition hover:bg-amber-300">
              {copy.demo}<Icon name="arrow" className="h-5 w-5" />
            </Link>
            <Link href="/pricing" className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-7 py-4 font-black transition hover:bg-white/10">
              {copy.pricing}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400 font-black text-slate-950">★</span>
            <p className="font-black">{copy.footer}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-5 text-sm font-bold text-slate-500">
            <Link href="/pricing" className="hover:text-indigo-600">{copy.pricing}</Link>
            <Link href="/signup" className="hover:text-indigo-600">{copy.demo}</Link>
            <Link href="/ilead-access" className="hover:text-indigo-600">{copy.internalLink}</Link>
            <Link href="/login" className="hover:text-indigo-600">{t("home.login")}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
