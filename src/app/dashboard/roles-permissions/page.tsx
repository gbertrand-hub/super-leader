import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {appRoles, requireAccessContext, type AppRole} from "@/lib/auth/access-control";

type AccessLevel = "all" | "scope" | "self" | "none";

type Capability = {
  key: string;
  fr: string;
  en: string;
  access: Record<AppRole, AccessLevel>;
};

const capabilities: Capability[] = [
  {key: "organization", fr: "Organisation et paramètres", en: "Organisation and settings", access: {owner: "all", admin: "all", executive: "none", hr: "scope", manager: "none", employee: "none"}},
  {key: "people", fr: "Membres et profils", en: "Members and profiles", access: {owner: "all", admin: "all", executive: "scope", hr: "all", manager: "scope", employee: "self"}},
  {key: "teams", fr: "Équipes et affectations", en: "Teams and assignments", access: {owner: "all", admin: "all", executive: "scope", hr: "scope", manager: "scope", employee: "self"}},
  {key: "performance", fr: "Performance et rapports journaliers", en: "Performance and daily reports", access: {owner: "all", admin: "all", executive: "scope", hr: "all", manager: "scope", employee: "self"}},
  {key: "schedule", fr: "Horaires, événements et absences", en: "Schedules, events and leave", access: {owner: "all", admin: "all", executive: "scope", hr: "all", manager: "scope", employee: "self"}},
  {key: "crm", fr: "CRM, ventes et clients", en: "CRM, sales and customers", access: {owner: "all", admin: "all", executive: "none", hr: "none", manager: "scope", employee: "self"}},
  {key: "finance", fr: "Finance et paie", en: "Finance and payroll", access: {owner: "all", admin: "all", executive: "none", hr: "none", manager: "self", employee: "self"}},
  {key: "reports", fr: "Rapports de pilotage", en: "Management reports", access: {owner: "all", admin: "all", executive: "scope", hr: "scope", manager: "scope", employee: "none"}},
  {key: "security", fr: "Rôles, sécurité et abonnement", en: "Roles, security and subscription", access: {owner: "all", admin: "all", executive: "none", hr: "none", manager: "none", employee: "none"}},
];

const roleNames: Record<AppRole, {fr: string; en: string}> = {
  owner: {fr: "Propriétaire", en: "Owner"},
  admin: {fr: "Administrateur", en: "Administrator"},
  executive: {fr: "Exécutif", en: "Executive"},
  hr: {fr: "Ressources humaines", en: "Human resources"},
  manager: {fr: "Manager", en: "Manager"},
  employee: {fr: "Employé", en: "Employee"},
};

const roleDescriptions: Record<AppRole, {fr: string; en: string}> = {
  owner: {fr: "Contrôle complet de l’organisation. Le rôle Owner ne peut pas être attribué, modifié ou désactivé par un autre rôle.", en: "Full organisation control. The Owner role cannot be assigned, changed or disabled by another role."},
  admin: {fr: "Administration générale, sans pouvoir modifier ni désactiver l’Owner.", en: "General administration, without permission to change or disable the Owner."},
  executive: {fr: "Vision de pilotage sur les personnes, équipes, performance et rapports, selon son périmètre.", en: "Leadership visibility over people, teams, performance and reports within the assigned scope."},
  hr: {fr: "Gestion des personnes, équipes, absences et performance. Aucun droit de gestion commerciale ou financière.", en: "People, teams, leave and performance management. No commercial or financial administration rights."},
  manager: {fr: "Accès à soi-même, à ses collaborateurs supervisés et aux équipes dont il est responsable.", en: "Access to self, direct reports and teams under the manager’s responsibility."},
  employee: {fr: "Accès à ses propres données et aux fonctions opérationnelles qui lui sont attribuées.", en: "Access to personal data and assigned operational features."},
};

const tones: Record<AccessLevel, string> = {
  all: "border-emerald-200 bg-emerald-50 text-emerald-800",
  scope: "border-sky-200 bg-sky-50 text-sky-800",
  self: "border-amber-200 bg-amber-50 text-amber-800",
  none: "border-slate-200 bg-slate-50 text-slate-400",
};

export default async function RolesPermissionsPage() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const context = await requireAccessContext();
  if (context.role !== "owner" && context.role !== "admin") redirect("/dashboard/my-day");
  const labels: Record<AccessLevel, string> = fr
    ? {all: "Organisation", scope: "Périmètre", self: "Personnel", none: "Aucun"}
    : {all: "Organisation", scope: "Assigned scope", self: "Personal", none: "None"};

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <header className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-9">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-indigo-300">Super Leader V4.6.9</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">{fr ? "Rôles & permissions" : "Roles & permissions"}</h1>
      <p className="mt-3 max-w-3xl leading-7 text-slate-300">{fr ? "Vue administrative des droits réellement appliqués dans Super Leader. La matrice reflète les contrôles du menu, des pages serveur, des actions sensibles, des périmètres et des règles Supabase." : "Administrative view of the permissions currently enforced in Super Leader. The matrix reflects menu, server page, sensitive action, scope and Supabase controls."}</p>
    </header>

    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {appRoles.map((role) => <article key={role} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black">{fr ? roleNames[role].fr : roleNames[role].en}</h2><span className="rounded-full bg-slate-950 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">{role}</span></div>
        <p className="mt-3 text-sm leading-6 text-slate-600">{fr ? roleDescriptions[role].fr : roleDescriptions[role].en}</p>
      </article>)}
    </section>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-6"><h2 className="text-2xl font-black">{fr ? "Matrice d’accès appliquée" : "Enforced access matrix"}</h2><div className="mt-4 flex flex-wrap gap-2">{(["all","scope","self","none"] as AccessLevel[]).map(level => <span key={level} className={`rounded-full border px-3 py-1 text-xs font-black ${tones[level]}`}>{labels[level]}</span>)}</div></div>
      <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">{fr ? "Domaine" : "Domain"}</th>{appRoles.map(role => <th key={role} className="px-3 py-4 text-center">{fr ? roleNames[role].fr : roleNames[role].en}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{capabilities.map(capability => <tr key={capability.key} className="hover:bg-slate-50/70"><th className="px-5 py-4 font-black text-slate-800">{fr ? capability.fr : capability.en}</th>{appRoles.map(role => {const level = capability.access[role]; return <td key={role} className="px-3 py-4 text-center"><span className={`inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-black ${tones[level]}`}>{labels[level]}</span></td>;})}</tr>)}</tbody></table></div>
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h2 className="font-black text-indigo-950">{fr ? "Défense en profondeur" : "Layered protection"}</h2><p className="mt-2 text-sm leading-6 text-indigo-900">{fr ? "Le menu n’est qu’une première couche : les URL, actions serveur, requêtes par périmètre et politiques RLS protègent également les données." : "The menu is only the first layer: URLs, server actions, scoped queries and RLS policies also protect data."}</p></article>
      <article className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><h2 className="font-black text-sky-950">{fr ? "Périmètre Manager" : "Manager scope"}</h2><p className="mt-2 text-sm leading-6 text-sky-900">{fr ? "Le périmètre réunit les collaborateurs supervisés et les membres des équipes dont le Manager est responsable." : "The scope combines direct reports and members of teams managed by the Manager."}</p></article>
      <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-black text-amber-950">{fr ? "Matrice non modifiable" : "Read-only matrix"}</h2><p className="mt-2 text-sm leading-6 text-amber-900">{fr ? "Cette première version documente les règles effectivement codées. Elle n’affiche pas de faux interrupteurs qui ne modifieraient pas la sécurité réelle." : "This first version documents the rules actually enforced. It does not show misleading switches that would not change real security."}</p></article>
    </section>
  </div></main>;
}
