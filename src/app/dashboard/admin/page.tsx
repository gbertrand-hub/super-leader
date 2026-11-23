import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { isPlatformOrganization } from "@/lib/acquisition/platform";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type MembershipRow = {
  organization_id: string;
  role: string;
  organizations:
    | { name?: string | null }
    | { name?: string | null }[]
    | null;
};

type MemberRow = {
  user_id: string;
  role: string;
};

type AdminTile = {
  key: string;
  href: string;
  icon: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  roles: string[];
  badge?: number | string | null;
  tone?: "indigo" | "emerald" | "amber" | "rose" | "slate";
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function firstOrganization(value: MembershipRow["organizations"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const toneClass = {
  indigo: "border-indigo-200 bg-indigo-50 hover:border-indigo-400 hover:bg-indigo-100",
  emerald: "border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100",
  amber: "border-amber-200 bg-amber-50 hover:border-amber-400 hover:bg-amber-100",
  rose: "border-rose-200 bg-rose-50 hover:border-rose-400 hover:bg-rose-100",
  slate: "border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-slate-100",
} as const;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { locale } = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const requestedOrganizationId = one(params.organization).trim();
  const { data: membershipRows, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id,role,organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true);

  if (membershipError) throw new Error(membershipError.message);

  const memberships = ((membershipRows ?? []) as MembershipRow[])
    .map((row) => ({
      ...row,
      organization: firstOrganization(row.organizations),
    }))
    .filter((row) => ["owner", "admin", "hr"].includes(String(row.role ?? "")));

  const membership = requestedOrganizationId
    ? memberships.find((row) => String(row.organization_id) === requestedOrganizationId) ?? null
    : memberships.find((row) => String(row.organization?.name ?? "").trim().toLowerCase() === "ilead global")
      ?? memberships[0]
      ?? null;

  if (!membership) redirect("/dashboard");

  const organizationId = String(membership.organization_id);
  const organizationName = String(membership.organization?.name ?? "Organisation");
  const role = String(membership.role);
  const isFullAdmin = ["owner", "admin"].includes(role);
  const canReviewIleadAccess =
    organizationName.trim().toLowerCase() === "ilead global" ||
    isPlatformOrganization({ organizationId, organizationName });

  const [{ data: memberRows }, { data: teamRows }, { data: invitationRows }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    admin
      .from("teams")
      .select("id,manager_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    admin
      .from("organization_invitations")
      .select("status")
      .eq("organization_id", organizationId)
      .in("status", ["pending", "expired"]),
  ]);

  const members = (memberRows ?? []) as MemberRow[];
  const activeMemberIds = members.map((member) => String(member.user_id));
  const staffNeedingTeamIds = members
    .filter((member) => !["owner", "admin"].includes(String(member.role)))
    .map((member) => String(member.user_id));
  const teamIds = (teamRows ?? []).map((team) => String(team.id));

  const [{ data: teamMemberRows }, { data: profileRows }, accessResult, entitlementResult] = await Promise.all([
    teamIds.length
      ? admin.from("team_members").select("user_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
    activeMemberIds.length
      ? admin.from("profiles").select("id,must_change_password").in("id", activeMemberIds)
      : Promise.resolve({ data: [] as { id: string; must_change_password: boolean | null }[], error: null }),
    canReviewIleadAccess
      ? admin
          .from("internal_access_requests")
          .select("id,status")
          .eq("status", "pending")
      : Promise.resolve({ data: [] as { id: string; status: string }[], error: null }),
    getOrganizationEntitlements(organizationId).catch(() => null),
  ]);

  const effectiveTeamMemberIds = new Set([
    ...(teamMemberRows ?? []).map((row) => String(row.user_id)),
    ...(teamRows ?? [])
      .map((team) => team.manager_id)
      .filter(Boolean)
      .map((managerId) => String(managerId)),
  ]);
  const membersWithoutTeam = staffNeedingTeamIds.filter(
    (userId) => !effectiveTeamMemberIds.has(userId),
  ).length;
  const firstLoginPending = (profileRows ?? []).filter((profile) => profile.must_change_password === true).length;
  const accessRequestsPending = (accessResult.data ?? []).length;
  const invitationsPending = (invitationRows ?? []).length;
  const activeMembers = members.length;
  const activeModules = entitlementResult?.enabledFeatures?.length ?? 0;
  const attentionCount = accessRequestsPending + invitationsPending + membersWithoutTeam + firstLoginPending;

  const organizationQuery = `organization=${encodeURIComponent(organizationId)}`;
  const tiles: AdminTile[] = [
    ...(canReviewIleadAccess
      ? [{
          key: "access",
          href: `/dashboard/acquisition?view=internal&status=pending&${organizationQuery}`,
          icon: "🔐",
          titleFr: "Demandes d’accès iLEAD",
          titleEn: "iLEAD access requests",
          descriptionFr: "Vérifier, approuver ou refuser les demandes et attribuer les accès.",
          descriptionEn: "Review, approve or reject requests and assign access.",
          roles: ["owner", "admin", "hr"],
          badge: accessRequestsPending,
          tone: "rose" as const,
        }]
      : []),
    {
      key: "members",
      href: `/dashboard/members?${organizationQuery}`,
      icon: "🏢",
      titleFr: "Collaborateurs & rôles",
      titleEn: "Staff & roles",
      descriptionFr: "Afficher tous les collaborateurs, leurs e-mails, rôles généraux et affectations.",
      descriptionEn: "View all staff, emails, organization roles and assignments.",
      roles: ["owner", "admin", "hr"],
      badge: activeMembers,
      tone: "indigo",
    },
    {
      key: "first-login",
      href: `/dashboard/members?${organizationQuery}&focus=onboarding&onboarding=all`,
      icon: "✉️",
      titleFr: "Invitations & première connexion",
      titleEn: "Invitations & first login",
      descriptionFr: "Suivre les invitations, mots de passe temporaires et premières connexions.",
      descriptionEn: "Track invitations, temporary passwords and first logins.",
      roles: ["owner", "admin", "hr"],
      badge: invitationsPending + firstLoginPending,
      tone: "amber",
    },
    {
      key: "assignments",
      href: "/dashboard/team?status=active&manager=all",
      icon: "👥",
      titleFr: "Équipes & responsables",
      titleEn: "Teams & leaders",
      descriptionFr: "Gérer les départements, les membres et les responsables sans changer leur rôle général.",
      descriptionEn: "Manage departments, members and team leaders without changing organization roles.",
      roles: ["owner", "admin", "hr"],
      badge: membersWithoutTeam,
      tone: "emerald",
    },
    {
      key: "finance-responsibilities",
      href: "/dashboard/finance/settings",
      icon: "💳",
      titleFr: "Responsabilités Finance",
      titleEn: "Finance responsibilities",
      descriptionFr: "Vérifier qui consulte les dossiers, valide les paiements et gère les fonctions sensibles.",
      descriptionEn: "Review who can view accounts, validate payments and manage sensitive functions.",
      roles: ["owner", "admin"],
      tone: "amber",
    },
    {
      key: "badges",
      href: "/dashboard/badges/manage",
      icon: "⭐",
      titleFr: "Badges & validation",
      titleEn: "Badges & validation",
      descriptionFr: "Contrôler les badges officiels et les validations autorisées.",
      descriptionEn: "Manage official badges and authorized validations.",
      roles: ["owner", "admin", "hr"],
      tone: "slate",
    },
    {
      key: "audit",
      href: "/dashboard/messages?view=audit",
      icon: "🛡️",
      titleFr: "Audit de messagerie",
      titleEn: "Messaging audit",
      descriptionFr: "Examiner les éléments de messagerie accessibles à l’administration.",
      descriptionEn: "Review messaging items available to administrators.",
      roles: ["owner", "admin"],
      tone: "slate",
    },
    {
      key: "identity-audit",
      href: `/dashboard/admin/identity-audit?${organizationQuery}`,
      icon: "🔎",
      titleFr: "Audit global des identités",
      titleEn: "Global identity audit",
      descriptionFr: "Voir les rôles cumulés, inscriptions multi-écoles et liens CRM sans modifier les données.",
      descriptionEn: "Review cumulative roles, multi-school enrollments and CRM links without changing data.",
      roles: ["owner", "admin"],
      tone: "amber",
    },
    {
      key: "subscription",
      href: "/dashboard/subscription",
      icon: "🧩",
      titleFr: "Modules & abonnement",
      titleEn: "Modules & subscription",
      descriptionFr: "Voir les modules actifs, le plan et l’état de l’abonnement.",
      descriptionEn: "Review enabled modules, plan and subscription status.",
      roles: ["owner", "admin"],
      badge: activeModules,
      tone: "indigo",
    },
    {
      key: "integrations",
      href: "/dashboard/integrations",
      icon: "🔌",
      titleFr: "Intégrations",
      titleEn: "Integrations",
      descriptionFr: "Gérer les connexions externes autorisées pour l’organisation.",
      descriptionEn: "Manage authorized external connections for the organization.",
      roles: ["owner", "admin"],
      tone: "emerald",
    },
    {
      key: "help",
      href: "/dashboard/help-center",
      icon: "❓",
      titleFr: "Centre d’aide utilisateur",
      titleEn: "User Help Centre",
      descriptionFr: "Ouvrir les tutoriels pratiques adaptés au rôle de l’utilisateur.",
      descriptionEn: "Open practical tutorials tailored to the user’s role.",
      roles: ["owner", "admin", "hr"],
      tone: "slate",
    },
  ];

  const visibleTiles = tiles.filter((tile) => tile.roles.includes(role));

  const attentionItems = [
    ...(canReviewIleadAccess && accessRequestsPending > 0
      ? [{
          label: fr ? `${accessRequestsPending} demande(s) d’accès à traiter` : `${accessRequestsPending} access request(s) to review`,
          href: `/dashboard/acquisition?view=internal&status=pending&${organizationQuery}`,
        }]
      : []),
    ...(invitationsPending > 0
      ? [{
          label: fr ? `${invitationsPending} invitation(s) en attente` : `${invitationsPending} pending invitation(s)`,
          href: `/dashboard/members?${organizationQuery}&focus=onboarding&onboarding=invitations`,
        }]
      : []),
    ...(firstLoginPending > 0
      ? [{
          label: fr ? `${firstLoginPending} première(s) connexion(s) à finaliser` : `${firstLoginPending} first login(s) to complete`,
          href: `/dashboard/members?${organizationQuery}&focus=onboarding&onboarding=first-login`,
        }]
      : []),
    ...(membersWithoutTeam > 0
      ? [{
          label: fr ? `${membersWithoutTeam} collaborateur(s) sans équipe` : `${membersWithoutTeam} staff member(s) without a team`,
          href: `/dashboard/members?${organizationQuery}&filter=without-team`,
        }]
      : []),
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-xl">
          <div className="p-7 sm:p-9">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-400">
                  SUPER LEADER · ADMINISTRATION
                </p>
                <h1 className="mt-3 text-3xl font-black sm:text-5xl">
                  {fr ? "Centre de commandement Administration" : "Administration Command Center"}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  {fr
                    ? "Les demandes, accès, membres, affectations, modules et outils sensibles sont réunis au même endroit selon votre rôle."
                    : "Requests, access, members, assignments, modules and sensitive tools are brought together according to your role."}
                </p>
                <p className="mt-4 text-sm font-bold text-indigo-300">
                  {organizationName} · {role.toUpperCase()}
                </p>
              </div>
              <Link
                href="/dashboard/help-center"
                className="w-fit rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:bg-white/15"
              >
                {fr ? "Ouvrir le centre d’aide →" : "Open Help Centre →"}
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label={fr ? "Indicateurs Administration" : "Administration indicators"}>
          {[
            [fr ? "Demandes d’accès" : "Access requests", canReviewIleadAccess ? accessRequestsPending : "—", "text-rose-700"],
            [fr ? "Invitations" : "Invitations", invitationsPending, "text-amber-700"],
            [fr ? "Membres actifs" : "Active members", activeMembers, "text-indigo-700"],
            [fr ? "Sans équipe" : "Without team", membersWithoutTeam, "text-emerald-700"],
            [fr ? "1re connexion" : "First login", firstLoginPending, "text-violet-700"],
            [fr ? "Modules actifs" : "Active modules", isFullAdmin ? activeModules : "—", "text-slate-700"],
          ].map(([label, value, color]) => (
            <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
              <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">
                {fr ? "Bureau Administration" : "Administration office"}
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {fr ? "Actions administratives rapides" : "Administration quick actions"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {fr
                  ? "Les fonctions utilisées fréquemment restent visibles sans chercher dans les sous-menus."
                  : "Frequently used functions remain visible without hunting through submenus."}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
              {fr ? "Accès selon votre rôle" : "Access follows your role"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleTiles.map((tile) => (
              <Link
                key={tile.key}
                href={tile.href}
                className={`group min-h-36 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${toneClass[tile.tone ?? "slate"]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-2xl" aria-hidden="true">{tile.icon}</span>
                  {tile.badge !== null && tile.badge !== undefined ? (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700 shadow-sm">
                      {tile.badge}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 text-base font-black text-slate-950">
                  {fr ? tile.titleFr : tile.titleEn}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {fr ? tile.descriptionFr : tile.descriptionEn}
                </p>
                <p className="mt-3 text-xs font-black text-indigo-700 group-hover:underline">
                  {fr ? "Ouvrir →" : "Open →"}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className={`mt-5 rounded-3xl border p-5 shadow-sm ${attentionCount > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${attentionCount > 0 ? "text-amber-800" : "text-emerald-800"}`}>
                {fr ? "À traiter aujourd’hui" : "To handle today"}
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {attentionCount > 0
                  ? fr ? `${attentionCount} action(s) nécessitent votre attention` : `${attentionCount} action(s) need your attention`
                  : fr ? "Aucune action administrative urgente" : "No urgent administration action"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {fr
                  ? "Cette file rassemble uniquement les éléments détectés dans votre périmètre actuel."
                  : "This queue only combines items detected in your current scope."}
              </p>
            </div>
            <span className="rounded-full bg-white px-4 py-2 text-sm font-black shadow-sm">
              {attentionCount}
            </span>
          </div>

          {attentionItems.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {attentionItems.map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-white hover:text-indigo-800"
                >
                  {item.label} →
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-bold text-emerald-800">
              {fr ? "Les contrôles administratifs suivis ici sont en ordre." : "The administration checks tracked here are in order."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
