import Link from "next/link";
import {redirect} from "next/navigation";
import {
  approveEmployeeBadgeRequestAction,
  changeEmployeeBadgeStatusAction,
  rejectEmployeeBadgeRequestAction,
} from "@/app/actions/badges";
import {getI18n} from "@/i18n/server";
import {EMPLOYEE_BADGE_ADMIN_ROLES} from "@/lib/badges/snapshot";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams: Promise<Record<string, string | string[] | undefined>>};
type RequestRow = {
  id: string;
  user_id: string;
  request_type: string;
  status: string;
  reason: string | null;
  requested_at: string;
};
type BadgeRow = {
  id: string;
  user_id: string;
  badge_number: string;
  issue_number: number;
  status: string;
  valid_from: string;
  valid_until: string;
  needs_reissue: boolean;
  full_name_snapshot: string;
  role_label_snapshot: string;
};
type ProfileRow = {id: string; full_name: string | null; email: string | null; avatar_storage_path: string | null};
type MembershipRow = {user_id: string; role: string; is_active: boolean};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function EmployeeBadgeAdminPage({searchParams}: Props) {
  const query = await searchParams;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();
  if (!membership) redirect("/dashboard/company");
  if (!EMPLOYEE_BADGE_ADMIN_ROLES.has(membership.role)) redirect("/dashboard/members");

  const [requestsResult, badgesResult, membershipsResult] = await Promise.all([
    admin
      .from("employee_badge_requests")
      .select("id,user_id,request_type,status,reason,requested_at")
      .eq("organization_id", membership.organization_id)
      .eq("status", "pending")
      .order("requested_at", {ascending: true}),
    admin
      .from("employee_badges")
      .select("id,user_id,badge_number,issue_number,status,valid_from,valid_until,needs_reissue,full_name_snapshot,role_label_snapshot")
      .eq("organization_id", membership.organization_id)
      .in("status", ["active", "suspended", "revoked", "expired"])
      .order("issued_at", {ascending: false}),
    admin
      .from("organization_members")
      .select("user_id,role,is_active")
      .eq("organization_id", membership.organization_id),
  ]);

  const migrationMissing = [requestsResult.error, badgesResult.error].some((error) => ["42P01", "PGRST205"].includes(String(error?.code ?? "")));
  if (migrationMissing) return <MigrationRequired fr={fr} />;
  if (requestsResult.error) throw new Error(requestsResult.error.message);
  if (badgesResult.error) throw new Error(badgesResult.error.message);
  if (membershipsResult.error) throw new Error(membershipsResult.error.message);

  const requests = (requestsResult.data ?? []) as RequestRow[];
  const badges = (badgesResult.data ?? []) as BadgeRow[];
  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const userIds = Array.from(new Set([...requests.map((item) => item.user_id), ...badges.map((item) => item.user_id)]));
  const profilesResult = userIds.length
    ? await admin.from("profiles").select("id,full_name,email,avatar_storage_path").in("id", userIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profiles = new Map(((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const membershipMap = new Map(memberships.map((item) => [item.user_id, item]));
  const today = new Date().toISOString().slice(0, 10);
  const activeCount = badges.filter((badge) => badge.status === "active" && badge.valid_until >= today && membershipMap.get(badge.user_id)?.is_active).length;
  const suspendedCount = badges.filter((badge) => badge.status === "suspended").length;
  const updateCount = badges.filter((badge) => badge.needs_reissue).length;
  const formatDate = (value: string) => new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
  const success = first(query.success);
  const error = first(query.error);

  const requestTypeLabel: Record<string, string> = fr
    ? {initial: "Première émission", update: "Mise à jour", renewal: "Renouvellement", replacement: "Remplacement"}
    : {initial: "First issue", update: "Update", renewal: "Renewal", replacement: "Replacement"};

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Super Leader · V3.3.0</p>
              <h1 className="mt-2 text-3xl font-black">{fr ? "Badges collaborateurs" : "Employee badges"}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{fr ? "Owner, Admin et RH contrôlent l’émission, le renouvellement, la suspension et la révocation des badges officiels iLEAD Global." : "Owners, Admins and HR control issuance, renewal, suspension and revocation of official iLEAD Global badges."}</p>
            </div>
            <Link href="/dashboard/members" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black hover:bg-white/10">← {fr ? "Membres" : "Members"}</Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [fr ? "Demandes en attente" : "Pending requests", requests.length, "bg-indigo-50 text-indigo-900"],
            [fr ? "Badges actifs" : "Active badges", activeCount, "bg-emerald-50 text-emerald-900"],
            [fr ? "Badges suspendus" : "Suspended badges", suspendedCount, "bg-amber-50 text-amber-900"],
            [fr ? "Mises à jour requises" : "Updates required", updateCount, "bg-cyan-50 text-cyan-900"],
          ].map(([label, value, className]) => <article key={String(label)} className={`rounded-3xl p-5 ${className}`}><p className="text-sm font-bold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-2xl font-black">{fr ? "Demandes à examiner" : "Requests to review"}</h2>
            <p className="mt-1 text-sm text-slate-500">{fr ? "Le badge n’est pas visible chez le collaborateur avant l’approbation." : "The badge is not visible to the employee before approval."}</p>
          </div>
          <div className="mt-5 grid gap-5">
            {requests.length ? requests.map((request) => {
              const profile = profiles.get(request.user_id);
              const member = membershipMap.get(request.user_id);
              return (
                <article key={request.id} className="rounded-2xl border border-slate-200 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">{profile?.full_name || profile?.email || (fr ? "Collaborateur" : "Employee")}</h3>
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">{requestTypeLabel[request.request_type] ?? request.request_type}</span>
                        {!member?.is_active ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-800">{fr ? "Compte désactivé" : "Disabled account"}</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{profile?.email || "—"}</p>
                      <p className="mt-3 text-sm text-slate-600">{request.reason || (fr ? "Aucun commentaire." : "No comment.")}</p>
                      <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">{new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(request.requested_at))}</p>
                    </div>
                    <div className="grid w-full gap-3 xl:max-w-2xl xl:grid-cols-2">
                      <form action={approveEmployeeBadgeRequestAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <input type="hidden" name="requestId" value={request.id} />
                        <label className="text-xs font-black uppercase text-emerald-900">{fr ? "Validité" : "Validity"}</label>
                        <select name="validMonths" defaultValue="12" className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 font-bold">
                          <option value="6">6 {fr ? "mois" : "months"}</option>
                          <option value="12">12 {fr ? "mois" : "months"}</option>
                          <option value="24">24 {fr ? "mois" : "months"}</option>
                        </select>
                        <textarea name="reviewNote" rows={2} maxLength={2000} placeholder={fr ? "Note facultative" : "Optional note"} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2" />
                        <button disabled={!member?.is_active} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-black text-white disabled:opacity-40">{fr ? "Approuver et émettre" : "Approve and issue"}</button>
                      </form>
                      <form action={rejectEmployeeBadgeRequestAction} className="rounded-2xl border border-red-200 bg-red-50 p-4">
                        <input type="hidden" name="requestId" value={request.id} />
                        <label className="text-xs font-black uppercase text-red-900">{fr ? "Motif du refus" : "Rejection reason"}</label>
                        <textarea name="reviewNote" required minLength={3} rows={4} maxLength={2000} className="mt-2 w-full rounded-xl border border-red-200 bg-white px-3 py-2" />
                        <button className="mt-3 w-full rounded-xl bg-red-700 px-4 py-2.5 font-black text-white">{fr ? "Refuser" : "Reject"}</button>
                      </form>
                    </div>
                  </div>
                </article>
              );
            }) : <p className="rounded-2xl bg-slate-50 p-6 text-center font-bold text-slate-500">{fr ? "Aucune demande de badge en attente." : "No pending badge requests."}</p>}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">{fr ? "Registre des badges" : "Badge register"}</h2>
          <div className="mt-5 grid gap-4">
            {badges.length ? badges.map((badge) => {
              const profile = profiles.get(badge.user_id);
              const member = membershipMap.get(badge.user_id);
              const expired = badge.valid_until < today;
              const effectiveStatus = expired && badge.status === "active" ? "expired" : badge.status;
              return (
                <article key={badge.id} className="rounded-2xl border border-slate-200 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">{badge.full_name_snapshot}</h3>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${effectiveStatus === "active" ? "bg-emerald-100 text-emerald-800" : effectiveStatus === "suspended" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{effectiveStatus}</span>
                        {badge.needs_reissue ? <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-800">{fr ? "Réédition requise" : "Reissue required"}</span> : null}
                        {!member?.is_active ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-800">{fr ? "Compte désactivé" : "Disabled account"}</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{profile?.email || "—"} · {badge.role_label_snapshot}</p>
                      <p className="mt-2 font-mono text-sm font-black text-slate-700">{badge.badge_number}</p>
                      <p className="mt-2 text-sm text-slate-600">{fr ? "Expiration" : "Expiry"}: <strong>{formatDate(badge.valid_until)}</strong></p>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
                      <Link href={`/dashboard/badges/card/${badge.id}`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black">{fr ? "Voir" : "View"}</Link>
                      {effectiveStatus === "active" ? (
                        <form action={changeEmployeeBadgeStatusAction} className="flex gap-2"><input type="hidden" name="badgeId" value={badge.id} /><input type="hidden" name="nextStatus" value="suspended" /><input name="reason" required minLength={3} placeholder={fr ? "Motif suspension" : "Suspension reason"} className="w-40 rounded-xl border border-amber-300 px-3 py-2 text-sm" /><button className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white">{fr ? "Suspendre" : "Suspend"}</button></form>
                      ) : null}
                      {effectiveStatus === "suspended" ? (
                        <form action={changeEmployeeBadgeStatusAction}><input type="hidden" name="badgeId" value={badge.id} /><input type="hidden" name="nextStatus" value="active" /><button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white">{fr ? "Réactiver" : "Reactivate"}</button></form>
                      ) : null}
                      {["active", "suspended"].includes(effectiveStatus) ? (
                        <form action={changeEmployeeBadgeStatusAction} className="flex gap-2"><input type="hidden" name="badgeId" value={badge.id} /><input type="hidden" name="nextStatus" value="revoked" /><input name="reason" required minLength={3} placeholder={fr ? "Motif révocation" : "Revocation reason"} className="w-40 rounded-xl border border-red-300 px-3 py-2 text-sm" /><button className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white">{fr ? "Révoquer" : "Revoke"}</button></form>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            }) : <p className="rounded-2xl bg-slate-50 p-6 text-center font-bold text-slate-500">{fr ? "Aucun badge n’a encore été émis." : "No badge has been issued yet."}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-10"><div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-2xl font-black text-amber-950">{fr ? "Migration Badges requise" : "Badge migration required"}</h1><p className="mt-3 text-amber-900">{fr ? "Exécute la migration Supabase suivante :" : "Run the following Supabase migration:"}</p><code className="mt-4 block rounded-xl bg-slate-950 p-4 text-sm font-bold text-white">050_employee_badges_identity_v3_3_0.sql</code></div></main>;
}
