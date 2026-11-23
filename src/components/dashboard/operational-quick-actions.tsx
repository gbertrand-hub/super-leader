"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useI18n} from "@/i18n/client";

type OperationalQuickActionsProps = {
  
  placement?: "global" | "inline";
role: string;
  enabledFeatures: string[];
  unreadNotificationCount?: number;
  unreadMessageCount?: number;
  isPlatformWorkspace?: boolean;
  organizationId?: string | null;
  canAccessAcademyFinanceControl?: boolean;
};

type Tile = {
  key: string;
  href: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  icon: string;
  roles?: string[];
  feature?: string;
  badge?: string | number | null;
  academyFinanceControlOnly?: boolean;
  organizationScoped?: boolean;
};

type Office = {
  key: string;
  eyebrowFr: string;
  eyebrowEn: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  tiles: Tile[];
};

const FINANCE_ROLES = ["owner", "admin"];
const COMMERCIAL_ROLES = ["owner", "admin", "manager", "employee"];
const COMMERCIAL_LEADERS = ["owner", "admin", "manager"];
const HR_LEADERS = ["owner", "admin", "executive", "hr", "manager"];
const HR_ADMINS = ["owner", "admin", "hr"];
const ADMIN_ROLES = ["owner", "admin"];

function starts(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function officeForPath(
  pathname: string,
  unreadNotificationCount: number,
  unreadMessageCount: number,
): Office | null {
  if (starts(pathname, ["/dashboard/finance"])) {
    return {
      key: "finance",
      eyebrowFr: "Bureau Finance",
      eyebrowEn: "Finance office",
      titleFr: "Actions financières rapides",
      titleEn: "Finance quick actions",
      descriptionFr: "Les opérations les plus fréquentes sont accessibles ici sans chercher dans les sous-menus.",
      descriptionEn: "The most frequent finance operations are available here without hunting through submenus.",
      tiles: [
        {key: "payments", href: "/dashboard/finance/payments", titleFr: "Encaissements à contrôler", titleEn: "Payments to review", descriptionFr: "Vérifier et confirmer les paiements bancaires.", descriptionEn: "Review and confirm bank payments.", icon: "💳", roles: FINANCE_ROLES},
        {key: "documents", href: "/dashboard/finance/documents", titleFr: "Factures & reçus", titleEn: "Invoices & receipts", descriptionFr: "Créer, retrouver et contrôler les documents financiers.", descriptionEn: "Create, find and review financial documents.", icon: "🧾", roles: FINANCE_ROLES},
        {key: "accounts", href: "/dashboard/finance/customer-accounts", titleFr: "Comptes clients", titleEn: "Customer accounts", descriptionFr: "Rapprocher vente, facture, banque et reçu.", descriptionEn: "Reconcile sale, invoice, bank payment and receipt.", icon: "👥", roles: FINANCE_ROLES},
        {key: "receivables", href: "/dashboard/finance/receivables", titleFr: "Créances & relances", titleEn: "Receivables & reminders", descriptionFr: "Suivre les soldes, échéances et relances automatiques.", descriptionEn: "Track balances, due dates and automated reminders.", icon: "💰", roles: FINANCE_ROLES},
        {key: "close", href: "/dashboard/finance/close", titleFr: "Clôture & contrôle", titleEn: "Close & control", descriptionFr: "Contrôler la période et préparer la clôture financière.", descriptionEn: "Review the period and prepare the financial close.", icon: "✅", roles: FINANCE_ROLES},
        {key: "settings", href: "/dashboard/finance/settings", titleFr: "Paramètres Finance", titleEn: "Finance settings", descriptionFr: "Devise, fiscalité, banques, échéances et responsables.", descriptionEn: "Currency, tax, banks, payment terms and owners.", icon: "⚙️", roles: FINANCE_ROLES},
      ],
    };
  }

  if (starts(pathname, ["/dashboard/crm", "/dashboard/sales", "/dashboard/collections"])) {
    return {
      key: "crm",
      eyebrowFr: "Bureau Commercial",
      eyebrowEn: "Sales office",
      titleFr: "Ventes & relation client",
      titleEn: "Sales & customer operations",
      descriptionFr: "Passer rapidement du prospect à la vente, puis au suivi client et au recouvrement.",
      descriptionEn: "Move quickly from lead to sale, then customer follow-up and collections.",
      tiles: [
        {key: "pipeline", href: "/dashboard/crm/pipeline", titleFr: "Pipeline commercial", titleEn: "Sales pipeline", descriptionFr: "Prioriser les prospects et opportunités.", descriptionEn: "Prioritize leads and opportunities.", icon: "🎯", roles: COMMERCIAL_ROLES, feature: "crm_sales"},
        {key: "salesday", href: "/dashboard/crm/my-sales-day", titleFr: "Ma journée commerciale", titleEn: "My sales day", descriptionFr: "Voir les actions commerciales à exécuter aujourd’hui.", descriptionEn: "See the sales actions to execute today.", icon: "📅", roles: COMMERCIAL_ROLES, feature: "crm_sales"},
        {key: "clients", href: "/dashboard/crm", titleFr: "Clients & interactions", titleEn: "Clients & interactions", descriptionFr: "Rechercher un client et retrouver son historique.", descriptionEn: "Find a customer and review interaction history.", icon: "👤", roles: COMMERCIAL_ROLES, feature: "crm_sales"},
        {key: "sales", href: "/dashboard/sales", titleFr: "Ventes", titleEn: "Sales", descriptionFr: "Créer, rechercher et suivre les ventes.", descriptionEn: "Create, search and track sales.", icon: "🛒", roles: COMMERCIAL_ROLES, feature: "crm_sales"},
        {key: "collections", href: "/dashboard/collections", titleFr: "Suivi des paiements", titleEn: "Payment follow-up", descriptionFr: "Suivre les soldes et responsables de recouvrement.", descriptionEn: "Track balances and collection owners.", icon: "💵", roles: COMMERCIAL_ROLES, feature: "crm_sales"},
        {key: "analytics", href: "/dashboard/crm/analytics", titleFr: "Performance commerciale", titleEn: "Sales performance", descriptionFr: "Analyser le pipeline et les résultats de l’équipe.", descriptionEn: "Analyze pipeline and team results.", icon: "📈", roles: COMMERCIAL_LEADERS, feature: "crm_sales"},
      ],
    };
  }

  if (starts(pathname, ["/dashboard/hr", "/dashboard/performance", "/dashboard/members", "/dashboard/team", "/dashboard/schedule"])) {
    return {
      key: "hr",
      eyebrowFr: "Bureau RH",
      eyebrowEn: "HR office",
      titleFr: "Actions RH rapides",
      titleEn: "HR quick actions",
      descriptionFr: "Les demandes récurrentes des collaborateurs restent visibles et accessibles selon votre rôle.",
      descriptionEn: "Recurring employee requests stay visible and accessible according to your role.",
      tiles: [
        {key: "hrhome", href: "/dashboard/hr", titleFr: "Bureau RH opérationnel", titleEn: "HR operations office", descriptionFr: "Voir les priorités RH regroupées au même endroit.", descriptionEn: "See HR priorities grouped in one place.", icon: "🧭", roles: HR_LEADERS},
        {key: "reports", href: "/dashboard/hr/daily-reports", titleFr: "Rapports de la journée", titleEn: "Daily reports", descriptionFr: "Contrôler, rappeler ou réouvrir les rapports.", descriptionEn: "Review, remind or reopen reports.", icon: "📝", roles: HR_LEADERS},
        {key: "priorities", href: "/dashboard/hr/daily-priorities", titleFr: "Priorités du matin", titleEn: "Morning priorities", descriptionFr: "Voir les non-soumises et réouvrir exceptionnellement après l’heure limite.", descriptionEn: "See missing submissions and exceptionally reopen them after the deadline.", icon: "🎯", roles: HR_LEADERS, feature: "performance"},
        {key: "schedules", href: "/dashboard/performance?view=settings", titleFr: "Horaires de travail", titleEn: "Work schedules", descriptionFr: "Gérer Fixe, Flexible ou Autonome.", descriptionEn: "Manage Fixed, Flexible or Autonomous schedules.", icon: "⏱️", roles: HR_ADMINS, feature: "performance"},
        {key: "attendance", href: "/dashboard/performance?view=attendance", titleFr: "Présences & ponctualité", titleEn: "Attendance & punctuality", descriptionFr: "Traiter retards, absences et anomalies de pointage.", descriptionEn: "Handle lateness, absences and attendance issues.", icon: "🕒", roles: HR_LEADERS, feature: "performance"},
        {key: "members", href: "/dashboard/members", titleFr: "Employés & affectations", titleEn: "Employees & assignments", descriptionFr: "Gérer équipes, managers et affectations.", descriptionEn: "Manage teams, managers and assignments.", icon: "👥", roles: HR_LEADERS, feature: "teams"},
        {key: "planning", href: "/dashboard/schedule", titleFr: "Planning de l’équipe", titleEn: "Team planning", descriptionFr: "Programmer et vérifier les journées de travail.", descriptionEn: "Schedule and review work days.", icon: "📆", roles: HR_LEADERS},
      ],
    };
  }

  if (starts(pathname, ["/dashboard/events"])) {
    return {
      key: "events",
      eyebrowFr: "Bureau Events",
      eyebrowEn: "Events office",
      titleFr: "Pilotage événementiel",
      titleEn: "Event operations",
      descriptionFr: "Centraliser objectifs, tâches, équipe, planning, budget et rapport final.",
      descriptionEn: "Centralize objectives, tasks, team, schedule, budget and final report.",
      tiles: [
        {key: "events", href: "/dashboard/events", titleFr: "Centre des événements", titleEn: "Events center", descriptionFr: "Retrouver tous les événements et leurs indicateurs.", descriptionEn: "Find all events and their indicators.", icon: "🎪", feature: "events"},
        {key: "eventtasks", href: "/dashboard/events", titleFr: "Objectifs & tâches", titleEn: "Objectives & tasks", descriptionFr: "Piloter l’exécution et mesurer les résultats.", descriptionEn: "Drive execution and measure results.", icon: "🎯", feature: "events"},
        {key: "eventschedule", href: "/dashboard/events", titleFr: "Planning événement", titleEn: "Event schedule", descriptionFr: "Réunions, logistique et jalons clés.", descriptionEn: "Meetings, logistics and key milestones.", icon: "📅", feature: "events"},
        {key: "eventteam", href: "/dashboard/events", titleFr: "Équipe temporaire", titleEn: "Temporary team", descriptionFr: "Rôles, responsabilités et droits propres à l’événement.", descriptionEn: "Event-specific roles, responsibilities and permissions.", icon: "👥", feature: "events"},
      ],
    };
  }

  if (starts(pathname, ["/dashboard/academy"])) {
    return {
      key: "academy",
      eyebrowFr: "Bureau Academy",
      eyebrowEn: "Academy office",
      titleFr: "Formation & progression",
      titleEn: "Learning & progress",
      descriptionFr: "Accéder rapidement aux parcours, sessions, progression et certificats autorisés.",
      descriptionEn: "Quickly access authorized programs, sessions, progress and certificates.",
      tiles: [
        {key: "academy", href: "/dashboard/academy", titleFr: "Academy", titleEn: "Academy", descriptionFr: "Vue centrale des formations et cohortes accessibles.", descriptionEn: "Central view of available programs and cohorts.", icon: "🎓", feature: "academy"},
        {key: "students", href: "/dashboard/academy/students", titleFr: "Étudiants", titleEn: "Students", descriptionFr: "Retrouver les inscriptions et dossiers étudiants.", descriptionEn: "Find enrollments and student records.", icon: "👥", feature: "academy"},
        {key: "student-finance", href: "/dashboard/academy/students/finance-control", titleFr: "Centre financier étudiant", titleEn: "Student finance control", descriptionFr: "Voir, corriger et rapprocher paiements, soldes et échéances.", descriptionEn: "Review and correct payments, balances and installments.", icon: "💳", feature: "academy", academyFinanceControlOnly: true, organizationScoped: true},
        {key: "identity-360", href: "/dashboard/admin/identity-audit", titleFr: "Identités 360°", titleEn: "Identity 360°", descriptionFr: "Relier CRM, compte utilisateur et inscriptions Academy.", descriptionEn: "Connect CRM, user account and Academy enrollments.", icon: "🪪", roles: ["owner", "admin"], organizationScoped: true},
        {key: "schedule", href: "/dashboard/schedule", titleFr: "Sessions & agenda", titleEn: "Sessions & agenda", descriptionFr: "Retrouver les sessions planifiées dans votre agenda.", descriptionEn: "Find scheduled sessions in your agenda.", icon: "📅", feature: "academy"},
        {key: "messages", href: "/dashboard/messages", titleFr: "Communication", titleEn: "Communication", descriptionFr: "Échanger avec les participants et responsables.", descriptionEn: "Communicate with participants and leaders.", icon: "💬", feature: "academy", badge: unreadMessageCount > 0 ? unreadMessageCount : null},
        {key: "notifications", href: "/dashboard/notifications", titleFr: "Notifications", titleEn: "Notifications", descriptionFr: "Voir les alertes liées aux activités et échéances.", descriptionEn: "See alerts related to activities and deadlines.", icon: "🔔", feature: "academy", badge: unreadNotificationCount > 0 ? unreadNotificationCount : null},
      ],
    };
  }

  if (starts(pathname, ["/dashboard/company", "/dashboard/acquisition", "/dashboard/subscription", "/dashboard/integrations"])) {
    return {
      key: "admin",
      eyebrowFr: "Bureau Administration",
      eyebrowEn: "Administration office",
      titleFr: "Administration & accès",
      titleEn: "Administration & access",
      descriptionFr: "Regrouper les fonctions sensibles sans contourner les permissions existantes.",
      descriptionEn: "Group sensitive functions without bypassing existing permissions.",
      tiles: [
        {key: "company", href: "/dashboard/company", titleFr: "Entreprise & membres", titleEn: "Company & members", descriptionFr: "Gérer l’organisation et les accès autorisés.", descriptionEn: "Manage the organization and authorized access.", icon: "🏢", roles: ADMIN_ROLES},
        {key: "members", href: "/dashboard/members", titleFr: "Membres & invitations", titleEn: "Members & invitations", descriptionFr: "Inviter, réactiver ou organiser les collaborateurs.", descriptionEn: "Invite, reactivate or organize collaborators.", icon: "✉️", roles: ["owner", "admin", "hr"]},
        {key: "access", href: "/dashboard/acquisition?view=internal", titleFr: "Demandes d’accès", titleEn: "Access requests", descriptionFr: "Accéder au centre de traitement des demandes internes.", descriptionEn: "Open the internal access request center.", icon: "🔐", roles: ["owner", "admin", "hr"]},
        {key: "subscription", href: "/dashboard/subscription", titleFr: "Abonnement & modules", titleEn: "Subscription & modules", descriptionFr: "Contrôler les fonctionnalités actives de l’organisation.", descriptionEn: "Review the organization’s enabled features.", icon: "🧩", roles: ADMIN_ROLES},
        {key: "integrations", href: "/dashboard/integrations", titleFr: "Intégrations", titleEn: "Integrations", descriptionFr: "Configurer les connexions autorisées.", descriptionEn: "Configure authorized connections.", icon: "🔌", roles: ADMIN_ROLES},
      ],
    };
  }

  return null;
}

export function OperationalQuickActions({
  placement = "global",
  role,
  enabledFeatures,
  unreadNotificationCount = 0,
  unreadMessageCount = 0,
  organizationId = null,
  canAccessAcademyFinanceControl = false,
}: OperationalQuickActionsProps) {
  const pathname = usePathname();
  const {locale} = useI18n();
  // CRM_CARREFOUR_PLACEMENT_V4_8_67_V2
  const isInline = placement === "inline";
  if (!isInline && ["/dashboard/crm/analytics", "/dashboard/events", "/dashboard/academy"].includes(pathname)) return null;
  const fr = locale === "fr";
  const office = officeForPath(pathname, unreadNotificationCount, unreadMessageCount);
  if (!office) return null;

  const tiles = office.tiles.filter((tile) => {
    if (tile.roles && !tile.roles.includes(role)) return false;
    if (tile.feature && !enabledFeatures.includes(tile.feature)) return false;
    if (tile.academyFinanceControlOnly && !canAccessAcademyFinanceControl) return false;
    return true;
  });

  if (!tiles.length) return null;

  return (
    <section
      data-super-leader-operational-office="v4.8.67"
      className="print:hidden"
      aria-label={fr ? office.titleFr : office.titleEn}
    >
      <div className={isInline ? "mt-6" : "mx-auto max-w-7xl px-4 pt-4 sm:px-6"}>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">
                {fr ? office.eyebrowFr : office.eyebrowEn}
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">
                {fr ? office.titleFr : office.titleEn}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                {fr ? office.descriptionFr : office.descriptionEn}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
              {fr ? "Accès selon votre rôle" : "Access follows your role"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((tile) => {
              const resolvedHref = tile.organizationScoped && organizationId
                ? `${tile.href}${tile.href.includes("?") ? "&" : "?"}organization=${encodeURIComponent(organizationId)}`
                : tile.href;
              return (
              <Link
                key={tile.key}
                href={resolvedHref}
                className="group flex min-h-28 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-sm"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-xl shadow-sm" aria-hidden="true">
                  {tile.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-black text-slate-950 group-hover:text-indigo-800">
                      {fr ? tile.titleFr : tile.titleEn}
                    </span>
                    {tile.badge ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
                        {tile.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    {fr ? tile.descriptionFr : tile.descriptionEn}
                  </span>
                  <span className="mt-2 block text-xs font-black text-indigo-700 group-hover:underline">
                    {fr ? "Ouvrir →" : "Open →"}
                  </span>
                </span>
              </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
