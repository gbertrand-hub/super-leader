import Link from "next/link";
import {redirect} from "next/navigation";
import {
  cancelLeaveRequestAction,
  reviewLeaveRequestAction,
  updateAnnualLeaveBalanceAction,
  updateLeaveRequestAction,
} from "@/app/actions/performance";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type Member = {user_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};
type Leave = {id: string; user_id: string; leave_type: string; start_date: string; end_date: string; reason: string; status: string; review_note: string | null; document_storage_path: string | null; document_file_name: string | null; created_at: string};
type Balance = {id: string; user_id: string; annual_allowance: number; prior_used_days: number; adjustment_reason: string; updated_by: string; updated_at: string};
type BalanceAudit = {id: string; user_id: string; previous_annual_allowance: number; new_annual_allowance: number; previous_prior_used_days: number; new_prior_used_days: number; reason: string; changed_by: string; created_at: string};
type LeaveAudit = {id: string; subject_user_id: string | null; actor_id: string; action: string; details: Record<string, unknown> | null; created_at: string};

const allowedRoles = new Set(["owner", "admin", "hr"]);
const leaveTypes = ["annual", "sick", "family", "training", "unpaid", "other"];
const defaultAllowance = 20;
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function workdays(start: string, end: string, year: number) {
  const from = new Date(`${start < `${year}-01-01` ? `${year}-01-01` : start}T12:00:00Z`);
  const to = new Date(`${end > `${year}-12-31` ? `${year}-12-31` : end}T12:00:00Z`);
  if (from > to) return 0;
  let total = 0;
  for (const day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) if (![0, 6].includes(day.getUTCDay())) total += 1;
  return total;
}
function statusTone(status: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-900";
}
function auditReason(entry: LeaveAudit, fr: boolean) {
  const value = entry.action === "corrected" ? entry.details?.correction_reason : entry.details?.cancellation_reason;
  return typeof value === "string" && value.trim() ? value : fr ? "Motif non renseigné" : "No reason recorded";
}

export default async function LeaveCenterPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const currentYear = new Date().getUTCFullYear();
  const requestedYear = Number(one(params.year));
  const year = Number.isInteger(requestedYear) && requestedYear >= currentYear - 5 && requestedYear <= currentYear + 2 ? requestedYear : currentYear;
  const status = one(params.status) || "all";
  const rawSearch = one(params.search);
  const search = rawSearch.trim().toLowerCase();
  const success = one(params.success);
  const error = one(params.error);

  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id, role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  if (!allowedRoles.has(membership.role)) redirect("/dashboard?error=access-denied");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const [memberResult, leaveResult, balanceResult, balanceAuditResult, leaveAuditResult] = await Promise.all([
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("leave_requests").select("id, user_id, leave_type, start_date, end_date, reason, status, review_note, document_storage_path, document_file_name, created_at").eq("organization_id", membership.organization_id).lte("start_date", `${year}-12-31`).gte("end_date", `${year}-01-01`).order("created_at", {ascending: false}).limit(500),
    admin.from("leave_annual_balances").select("id, user_id, annual_allowance, prior_used_days, adjustment_reason, updated_by, updated_at").eq("organization_id", membership.organization_id).eq("leave_year", year),
    admin.from("leave_annual_balance_audit_log").select("id, user_id, previous_annual_allowance, new_annual_allowance, previous_prior_used_days, new_prior_used_days, reason, changed_by, created_at").eq("organization_id", membership.organization_id).eq("leave_year", year).order("created_at", {ascending: false}).limit(20),
    admin.from("performance_audit_log").select("id, subject_user_id, actor_id, action, details, created_at").eq("organization_id", membership.organization_id).eq("entity_type", "leave_request").in("action", ["corrected", "cancelled"]).order("created_at", {ascending: false}).limit(20),
  ]);
  const loadError = memberResult.error || leaveResult.error || balanceResult.error || balanceAuditResult.error || leaveAuditResult.error;
  if (loadError) throw new Error(loadError.message);

  const members = (memberResult.data ?? []) as Member[];
  const memberIds = members.map((member) => member.user_id);
  const {data: profileData, error: profileError} = memberIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds) : {data: [], error: null};
  if (profileError) throw new Error(profileError.message);
  const profiles = (profileData ?? []) as Profile[];
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const name = (id: string | null) => {
    if (!id) return fr ? "Collaborateur" : "Employee";
    const profile = profilesById.get(id);
    return profile?.full_name || profile?.email || id;
  };
  const matches = (id: string) => !search || `${profilesById.get(id)?.full_name ?? ""} ${profilesById.get(id)?.email ?? ""}`.toLowerCase().includes(search);
  const leaves = (leaveResult.data ?? []) as Leave[];
  const balances = (balanceResult.data ?? []) as Balance[];
  const balanceByUser = new Map(balances.map((balance) => [balance.user_id, balance]));
  const filtered = leaves.filter((leave) => (status === "all" || leave.status === status) && matches(leave.user_id));
  const visibleMembers = members.filter((member) => matches(member.user_id)).sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), locale));
  const approvedDays = new Map<string, number>();
  for (const leave of leaves) if (leave.status === "approved" && leave.leave_type === "annual") approvedDays.set(leave.user_id, (approvedDays.get(leave.user_id) ?? 0) + workdays(leave.start_date, leave.end_date, year));
  const pending = leaves.filter((leave) => leave.status === "pending");
  const approved = leaves.filter((leave) => leave.status === "approved");
  const today = new Date().toISOString().slice(0, 10);
  const awayToday = new Set(approved.filter((leave) => leave.start_date <= today && leave.end_date >= today).map((leave) => leave.user_id));
  const usedTotal = members.reduce((sum, member) => sum + (approvedDays.get(member.user_id) ?? 0) + Number(balanceByUser.get(member.user_id)?.prior_used_days ?? 0), 0);
  const returnTo = `/dashboard/hr/leave?${new URLSearchParams({year: String(year), status, search: rawSearch}).toString()}`;
  const pendingHref = `/dashboard/hr/leave?${new URLSearchParams({year: String(year), status: "pending", search: ""}).toString()}#leave-requests`;
  const labels: Record<string, string> = fr
    ? {annual: "Congé annuel", sick: "Maladie", family: "Familial", training: "Formation", unpaid: "Sans solde", other: "Autre", pending: "En attente", approved: "Approuvé", rejected: "Refusé", cancelled: "Annulé"}
    : {annual: "Annual leave", sick: "Sick leave", family: "Family leave", training: "Training", unpaid: "Unpaid", other: "Other", pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled"};

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-[1500px]">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">{fr ? "Centre RH" : "HR centre"}</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">{fr ? "Congés & absences" : "Leave & absence"}</h1><p className="mt-3 max-w-3xl text-slate-300">{fr ? "Droits ajustables · congés antérieurs intégrés · demandes corrigibles · traçabilité complète." : "Adjustable entitlement · prior leave included · correctable requests · complete audit trail."}</p></div><div className="flex gap-2"><Link href="/dashboard/hr" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black">{fr ? "Dashboard RH" : "HR dashboard"}</Link><Link href="/dashboard/performance?view=absences" className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Créer une demande" : "Create request"}</Link></div></div></header>
    {success || error ? <div className={`mt-4 rounded-2xl border p-4 font-bold ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || success}</div> : null}
    <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Link href={pendingHref} aria-label={fr ? `Voir les ${pending.length} demandes en attente RH` : `View ${pending.length} pending HR requests`} className={`group rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 ${status === "pending" && !search ? "border-amber-500 bg-amber-100 text-amber-950 ring-2 ring-amber-300" : "border-amber-200 bg-amber-50 text-amber-900"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide opacity-75">{fr ? "En attente RH" : "Pending HR"}</p><p className="mt-2 text-3xl font-black">{pending.length}</p></div><span aria-hidden="true" className="text-2xl font-black transition group-hover:translate-x-1">→</span></div><p className="mt-2 text-xs font-bold underline decoration-dotted underline-offset-4">{fr ? "Cliquer pour traiter les demandes" : "Click to review requests"}</p></Link>{[[fr ? "Approuvées cette année" : "Approved this year", approved.length, "border-emerald-200 bg-emerald-50 text-emerald-800"], [fr ? "En congé aujourd’hui" : "Away today", awayToday.size, "border-indigo-200 bg-indigo-50 text-indigo-800"], [fr ? "Jours annuels consommés" : "Annual days used", usedTotal, "border-sky-200 bg-sky-50 text-sky-800"]].map(([label, value, classes]) => <article key={String(label)} className={`rounded-2xl border p-5 ${classes}`}><p className="text-xs font-black uppercase tracking-wide opacity-75">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}</section>
    <form className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4"><label className="text-xs font-black text-slate-600">{fr ? "Année" : "Year"}<select name="year" defaultValue={year} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5">{[currentYear - 1, currentYear, currentYear + 1].map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-black text-slate-600">{fr ? "Statut" : "Status"}<select name="status" defaultValue={status} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="all">{fr ? "Tous" : "All"}</option>{["pending", "approved", "rejected", "cancelled"].map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label><label className="text-xs font-black text-slate-600">{fr ? "Employé" : "Employee"}<input name="search" defaultValue={rawSearch} placeholder={fr ? "Nom ou e-mail" : "Name or email"} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><button className="self-end rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white">{fr ? "Actualiser" : "Refresh"}</button></form>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]"><article id="leave-requests" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "Traitement" : "Review"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Demandes de congé" : "Leave requests"}</h2>{status === "pending" && !search ? <p className="mt-1 text-sm font-bold text-amber-800">{fr ? `${filtered.length} demande(s) en attente à traiter` : `${filtered.length} pending request(s) to review`}</p> : null}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">{filtered.length}</span></div><div className="mt-5 space-y-4">
      {filtered.map((leave) => <div key={leave.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{name(leave.user_id)}</p><p className="mt-1 text-sm text-slate-500">{labels[leave.leave_type] || leave.leave_type} · {leave.start_date} → {leave.end_date} · <strong>{workdays(leave.start_date, leave.end_date, year)} {fr ? "jour(s) ouvré(s)" : "weekday(s)"}</strong></p></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusTone(leave.status)}`}>{labels[leave.status] || leave.status}</span></div><p className="mt-3 text-sm leading-6 text-slate-700">{leave.reason}</p>{leave.document_storage_path ? <a href={`/api/attachments/leave/${leave.id}`} className="mt-2 inline-block text-sm font-black text-indigo-700 underline">{fr ? "Ouvrir le justificatif" : "Open document"}{leave.document_file_name ? ` · ${leave.document_file_name}` : ""}</a> : null}{leave.review_note ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{leave.review_note}</p> : null}
        {leave.status === "pending" ? allowedRoles.has(membership.role) ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{[["approved", fr ? "Approuver" : "Approve", "bg-emerald-600"], ["rejected", fr ? "Refuser" : "Reject", "bg-red-600"]].map(([decision, label, color]) => <form key={decision} action={reviewLeaveRequestAction} className="space-y-2"><input type="hidden" name="requestId" value={leave.id}/><input type="hidden" name="status" value={decision}/><input type="hidden" name="returnTo" value={returnTo}/><input name="reviewNote" required={decision === "rejected"} placeholder={fr ? "Note RH" : "HR note"} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button className={`w-full rounded-xl px-4 py-2.5 font-black text-white ${color}`}>{label}</button></form>)}</div> : null : null}
        {allowedRoles.has(membership.role) && ["pending", "approved"].includes(leave.status) ? <div className="mt-4 grid gap-3 lg:grid-cols-2"><details className="rounded-xl border border-indigo-200 bg-indigo-50/40"><summary className="cursor-pointer px-4 py-3 text-sm font-black text-indigo-800">{fr ? "Corriger la demande" : "Correct request"}</summary><form action={updateLeaveRequestAction} className="grid gap-3 border-t border-indigo-100 p-4 sm:grid-cols-2"><input type="hidden" name="requestId" value={leave.id}/><input type="hidden" name="returnTo" value={returnTo}/><label className="text-xs font-bold text-slate-600 sm:col-span-2">Type<select name="leaveType" defaultValue={leave.leave_type} className={field}>{leaveTypes.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label><label className="text-xs font-bold text-slate-600">{fr ? "Début" : "Start"}<input type="date" name="startDate" required defaultValue={leave.start_date} className={field}/></label><label className="text-xs font-bold text-slate-600">{fr ? "Fin" : "End"}<input type="date" name="endDate" required defaultValue={leave.end_date} className={field}/></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">{fr ? "Motif du congé" : "Leave reason"}<textarea name="reason" minLength={3} maxLength={2000} required defaultValue={leave.reason} className={`${field} min-h-20`}/></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">{fr ? "Pourquoi cette correction ?" : "Why this correction?"}<textarea name="correctionReason" minLength={3} maxLength={1000} required className={`${field} min-h-20`}/></label><button className="rounded-lg bg-indigo-700 px-3 py-2.5 font-black text-white sm:col-span-2">{fr ? "Enregistrer la correction" : "Save correction"}</button></form></details><details className="rounded-xl border border-red-200 bg-red-50/40"><summary className="cursor-pointer px-4 py-3 text-sm font-black text-red-800">{fr ? "Annuler la demande" : "Cancel request"}</summary><form action={cancelLeaveRequestAction} className="space-y-3 border-t border-red-100 p-4"><input type="hidden" name="requestId" value={leave.id}/><input type="hidden" name="returnTo" value={returnTo}/><textarea name="cancellationReason" minLength={3} maxLength={1000} required placeholder={fr ? "Motif obligatoire" : "Required reason"} className={`${field} min-h-20`}/><button className="w-full rounded-lg bg-red-700 px-3 py-2.5 font-black text-white">{fr ? "Confirmer l’annulation" : "Confirm cancellation"}</button></form></details></div> : null}
      </div>)}
      {!filtered.length ? <div className="rounded-2xl bg-slate-50 p-8 text-center font-bold text-slate-600">{fr ? "Aucune demande pour ces filtres." : "No requests for these filters."}</div> : null}
    </div></article>

    <aside className="space-y-5"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "Soldes annuels" : "Annual balances"}</p><h2 className="mt-1 text-2xl font-black">{year}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Les congés antérieurs sont des jours pris hors de Super Leader. Ne les doublez pas avec une demande approuvée." : "Prior leave means days taken outside Super Leader. Do not duplicate approved requests."}</p><div className="mt-5 space-y-4">
      {visibleMembers.map((member) => { const balance = balanceByUser.get(member.user_id); const allowance = Number(balance?.annual_allowance ?? defaultAllowance); const approvedUsed = approvedDays.get(member.user_id) ?? 0; const priorUsed = Number(balance?.prior_used_days ?? 0); const total = approvedUsed + priorUsed; const remaining = Math.max(0, allowance - total); const overdrawn = Math.max(0, total - allowance); return <div key={member.user_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{name(member.user_id)}</p><p className="mt-1 text-xs text-slate-500">{fr ? `${approvedUsed} approuvés + ${priorUsed} antérieurs · ${allowance} accordés` : `${approvedUsed} approved + ${priorUsed} prior · ${allowance} granted`}</p></div><span className={`rounded-full px-2.5 py-1 text-sm font-black ${remaining <= 3 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{remaining} {fr ? "restants" : "left"}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${overdrawn ? "bg-red-600" : "bg-indigo-600"}`} style={{width: `${allowance > 0 ? Math.min(100, total / allowance * 100) : total ? 100 : 0}%`}}/></div>{overdrawn ? <p className="mt-2 text-xs font-black text-red-700">{fr ? `Dépassement de ${overdrawn} jour(s).` : `Overdrawn by ${overdrawn} day(s).`}</p> : null}<details className="mt-3 rounded-xl border border-indigo-200 bg-white"><summary className="cursor-pointer px-3 py-2 text-sm font-black text-indigo-700">{fr ? "Ajuster le solde" : "Adjust balance"}</summary><form action={updateAnnualLeaveBalanceAction} className="grid gap-3 border-t border-indigo-100 p-3 sm:grid-cols-2"><input type="hidden" name="userId" value={member.user_id}/><input type="hidden" name="leaveYear" value={year}/><input type="hidden" name="returnTo" value={returnTo}/><label className="text-xs font-bold text-slate-600">{fr ? "Droits annuels" : "Annual entitlement"}<input type="number" name="annualAllowance" min="0" max="365" required defaultValue={allowance} className={field}/></label><label className="text-xs font-bold text-slate-600">{fr ? "Jours pris auparavant" : "Prior days used"}<input type="number" name="priorUsedDays" min="0" max="365" required defaultValue={priorUsed} className={field}/></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">{fr ? "Motif obligatoire" : "Required reason"}<textarea name="reason" minLength={3} maxLength={1000} required defaultValue={balance?.adjustment_reason ?? ""} className={`${field} min-h-20`}/></label><button className="rounded-lg bg-indigo-600 px-3 py-2 font-black text-white sm:col-span-2">{fr ? "Enregistrer et recalculer" : "Save and recalculate"}</button></form></details></div>; })}
      {!visibleMembers.length ? <p className="rounded-xl bg-slate-50 p-5 text-center font-bold text-slate-600">{fr ? "Aucun employé trouvé." : "No employee found."}</p> : null}
    </div></section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "Traçabilité" : "Audit trail"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Corrections et annulations" : "Corrections and cancellations"}</h2><div className="mt-4 space-y-3">{((leaveAuditResult.data ?? []) as LeaveAudit[]).map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-black">{name(entry.subject_user_id)}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase">{entry.action === "corrected" ? (fr ? "Corrigée" : "Corrected") : (fr ? "Annulée" : "Cancelled")}</span></div><p className="mt-1 text-slate-600">{auditReason(entry, fr)}</p><p className="mt-1 text-xs text-slate-500">{name(entry.actor_id)} · {new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short", timeZone: "UTC"}).format(new Date(entry.created_at))} UTC</p></div>)}{!leaveAuditResult.data?.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">{fr ? "Aucune correction ou annulation enregistrée." : "No correction or cancellation recorded."}</p> : null}</div></section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "Traçabilité des soldes" : "Balance audit trail"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Derniers ajustements" : "Recent adjustments"}</h2><div className="mt-4 space-y-3">{((balanceAuditResult.data ?? []) as BalanceAudit[]).map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-black">{name(entry.user_id)}</p><p className="mt-1 text-slate-600">{fr ? `Droits ${entry.previous_annual_allowance} → ${entry.new_annual_allowance} · Antérieurs ${entry.previous_prior_used_days} → ${entry.new_prior_used_days}` : `Entitlement ${entry.previous_annual_allowance} → ${entry.new_annual_allowance} · Prior ${entry.previous_prior_used_days} → ${entry.new_prior_used_days}`}</p><p className="mt-1 text-xs text-slate-500">{entry.reason} · {name(entry.changed_by)} · {new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short", timeZone: "UTC"}).format(new Date(entry.created_at))} UTC</p></div>)}{!balanceAuditResult.data?.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">{fr ? "Aucun ajustement enregistré pour cette année." : "No adjustment recorded for this year."}</p> : null}</div></section></aside></section>

    <section className="mt-5 rounded-3xl border border-dashed border-violet-300 bg-violet-50 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "Feuille de route" : "Roadmap"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Améliorations à venir" : "Coming improvements"}</h2></div><span className="rounded-full bg-violet-200 px-3 py-1 text-xs font-black uppercase text-violet-900">{fr ? "À venir" : "Coming soon"}</span></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{(fr ? ["Jours fériés par pays", "Demandes en demi-journées", "Acquisition mensuelle des droits", "Report du solde entre années"] : ["Country-specific public holidays", "Half-day requests", "Monthly entitlement accrual", "Year-to-year balance carry-over"]).map((item) => <div key={item} className="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-violet-950">{item}</div>)}</div></section>
  </div></main>;
}
