import Link from "next/link";
import {redirect} from "next/navigation";
import {reopenDailyPrioritiesAction, revokeDailyPrioritiesReopeningAction} from "@/app/actions/daily-execution";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};
type Task = {user_id: string; work_date: string; priority: string; progress_status: string; due_time: string | null; completed_at: string | null};
type Plan = {user_id: string; work_date: string; status: string; submitted_at: string | null};
type Attendance = {user_id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null};
type Reopening = {id: string; user_id: string; work_date: string; reason: string; reason_code: string; expires_at: string; status: string; reopened_by: string; created_at: string};
type Settings = {plan_lock_time: string | null};

const allowedRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);
const completedStatuses = new Set(["completed"]);
const unfinishedStatuses = new Set(["todo", "in_progress", "partial", "blocked", "deferred"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isoDate(value: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function Metric({label, value, detail, tone}: {label: string; value: string | number; detail: string; tone: "indigo" | "emerald" | "amber" | "rose"}) {
  const colors = {indigo: "bg-indigo-50 text-indigo-800", emerald: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-900", rose: "bg-rose-50 text-rose-800"};
  return <article className={`rounded-3xl p-5 ${colors[tone]}`}><p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">{label}</p><p className="mt-3 text-4xl font-black">{value}</p><p className="mt-2 text-sm font-bold opacity-75">{detail}</p></article>;
}

function Message({kind, children}: {kind: "success" | "error"; children: string}) {
  return <p className={`mt-5 rounded-2xl border p-4 text-sm font-black ${kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>{children}</p>;
}

export default async function DailyPrioritiesAnalyticsPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const today = new Date().toISOString().slice(0, 10);
  const to = isoDate(first(params.to), today);
  const from = isoDate(first(params.from), shiftDate(to, -29));
  const selectedUser = first(params.member);
  const success = first(params.success);
  const error = first(params.error);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin.from("organization_members").select("organization_id, role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (membershipError || !membership) redirect("/dashboard/company");
  if (!allowedRoles.has(membership.role)) redirect("/dashboard?error=access-denied");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const visibleIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});
  const scopedIds = selectedUser && visibleIds.includes(selectedUser) ? [selectedUser] : visibleIds;
  if (!scopedIds.length) redirect("/dashboard?error=access-denied");

  const [profilesResult, tasksResult, plansResult, attendanceResult, reopeningsResult, settingsResult] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", visibleIds),
    admin.from("daily_work_tasks").select("user_id, work_date, priority, progress_status, due_time, completed_at").eq("organization_id", membership.organization_id).gte("work_date", from).lte("work_date", to).in("user_id", scopedIds),
    admin.from("daily_work_plans").select("user_id, work_date, status, submitted_at").eq("organization_id", membership.organization_id).gte("work_date", from).lte("work_date", to).in("user_id", scopedIds),
    admin.from("attendance_records").select("user_id, work_date, clock_in_at, clock_out_at").eq("organization_id", membership.organization_id).eq("work_date", to).in("user_id", visibleIds).not("clock_in_at", "is", null),
    admin.from("daily_priority_reopenings").select("id,user_id,work_date,reason,reason_code,expires_at,status,reopened_by,created_at").eq("organization_id", membership.organization_id).eq("work_date", to).in("user_id", visibleIds).eq("status", "active").gt("expires_at", new Date().toISOString()),
    admin.from("daily_execution_settings").select("plan_lock_time").eq("organization_id", membership.organization_id).maybeSingle<Settings>(),
  ]);
  const loadError = profilesResult.error || tasksResult.error || plansResult.error || attendanceResult.error || reopeningsResult.error || settingsResult.error;
  if (loadError) throw new Error(loadError.message);

  const profiles = (profilesResult.data ?? []) as Profile[];
  const tasks = (tasksResult.data ?? []) as Task[];
  const plans = (plansResult.data ?? []) as Plan[];
  const attendances = (attendanceResult.data ?? []) as Attendance[];
  const reopenings = (reopeningsResult.data ?? []) as Reopening[];
  const lockTime = String(settingsResult.data?.plan_lock_time || "10:00").slice(0, 5);
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.full_name?.trim() || profile.email || (fr ? "Membre" : "Member")]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const plansForSelectedDate = new Map(plans.filter((plan) => plan.work_date === to).map((plan) => [plan.user_id, plan]));
  const reopeningByUser = new Map(reopenings.map((row) => [row.user_id, row]));
  const missingRows = attendances
    .filter((attendance) => !plansForSelectedDate.has(attendance.user_id))
    .map((attendance) => ({attendance, profile: profileById.get(attendance.user_id), reopening: reopeningByUser.get(attendance.user_id)}))
    .sort((a, b) => (nameById.get(a.attendance.user_id) ?? "").localeCompare(nameById.get(b.attendance.user_id) ?? ""));

  const completed = tasks.filter((task) => completedStatuses.has(task.progress_status));
  const unfinished = tasks.filter((task) => unfinishedStatuses.has(task.progress_status));
  const critical = tasks.filter((task) => ["critical", "high"].includes(task.priority));
  const criticalCompleted = critical.filter((task) => completedStatuses.has(task.progress_status));
  const deferred = tasks.filter((task) => task.progress_status === "deferred");

  const daily = new Map<string, {total: number; completed: number}>();
  tasks.forEach((task) => {
    const row = daily.get(task.work_date) ?? {total: 0, completed: 0};
    row.total += 1;
    if (completedStatuses.has(task.progress_status)) row.completed += 1;
    daily.set(task.work_date, row);
  });
  const trend = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);

  const memberRows = scopedIds.map((id) => {
    const memberTasks = tasks.filter((task) => task.user_id === id);
    const done = memberTasks.filter((task) => completedStatuses.has(task.progress_status)).length;
    const blocked = memberTasks.filter((task) => task.progress_status === "blocked").length;
    const delayed = memberTasks.filter((task) => ["deferred", "partial"].includes(task.progress_status)).length;
    return {id, name: nameById.get(id) ?? id, total: memberTasks.length, done, blocked, delayed, rate: percent(done, memberTasks.length)};
  }).filter((row) => row.total > 0).sort((a, b) => b.rate - a.rate || b.total - a.total);

  const query = new URLSearchParams({from, to});
  const returnTo = `/dashboard/hr/daily-priorities?${query.toString()}`;

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-[1500px]">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">{fr ? "Exécution quotidienne" : "Daily execution"}</p><div className="mt-2 flex flex-wrap items-end justify-between gap-5"><div><h1 className="text-3xl font-black sm:text-4xl">{fr ? "Priorités quotidiennes & réouvertures" : "Daily priorities & reopenings"}</h1><p className="mt-3 max-w-3xl text-slate-300">{fr ? "Repérez les priorités non soumises, réouvrez exceptionnellement la saisie après l’heure limite et conservez une trace d’audit." : "Find missing priorities, exceptionally reopen submission after the deadline and retain a complete audit trail."}</p></div><Link href="/dashboard/my-day#daily-priorities" className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Ouvrir mes priorités" : "Open my priorities"}</Link></div></header>

    {success ? <Message kind="success">{success}</Message> : null}
    {error ? <Message kind="error">{error}</Message> : null}

    <section id="reopen-priorities" className="mt-5 rounded-3xl border-2 border-amber-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "Gouvernance du matin" : "Morning governance"}</p>
          <h2 className="mt-1 text-2xl font-black">{fr ? "Priorités non soumises" : "Missing priorities"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{fr ? `La saisie normale se verrouille à ${lockTime}. Une réouverture est individuelle, temporaire, motivée et auditée.` : `Normal submission locks at ${lockTime}. A reopening is individual, temporary, justified and audited.`}</p>
        </div>
        <div className="rounded-2xl bg-amber-100 px-5 py-3 text-center text-amber-950"><p className="text-3xl font-black">{missingRows.length}</p><p className="text-xs font-black uppercase">{fr ? "à traiter" : "to handle"}</p></div>
      </div>

      <div className="mt-5 grid gap-4">
        {missingRows.map(({attendance, profile, reopening}) => {
          const memberName = profile?.full_name?.trim() || profile?.email || attendance.user_id;
          return <article key={attendance.user_id} className={`rounded-2xl border p-4 ${reopening ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="font-black">{memberName}</p>
                <p className="mt-1 text-sm text-slate-600">{profile?.email || ""}</p>
                <p className="mt-2 text-xs font-bold text-slate-500">{fr ? "Présence enregistrée" : "Attendance recorded"} · {attendance.clock_in_at ? new Date(attendance.clock_in_at).toLocaleTimeString(fr ? "fr-FR" : "en-GB", {hour: "2-digit", minute: "2-digit"}) : "—"}</p>
                {reopening ? <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-emerald-900"><strong>{fr ? "Réouvert jusqu’au" : "Reopened until"}:</strong> {new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(reopening.expires_at))}<br/><span className="text-xs">{reopening.reason}</span></div> : <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">{fr ? "Aucun plan de priorités soumis pour cette journée." : "No daily priority plan has been submitted for this day."}</p>}
              </div>

              {reopening ? <form action={revokeDailyPrioritiesReopeningAction} className="shrink-0">
                <input type="hidden" name="reopeningId" value={reopening.id}/>
                <input type="hidden" name="returnTo" value={returnTo}/>
                <button className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-50">{fr ? "Fermer la réouverture" : "Close reopening"}</button>
              </form> : <form action={reopenDailyPrioritiesAction} className="grid w-full gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 xl:max-w-[680px] xl:grid-cols-[1fr_120px_1.5fr_auto]">
                <input type="hidden" name="userId" value={attendance.user_id}/>
                <input type="hidden" name="workDate" value={to}/>
                <input type="hidden" name="returnTo" value={returnTo}/>
                <label className="text-xs font-black text-amber-950">{fr ? "Motif" : "Reason"}<select name="reasonCode" className="mt-1.5 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"><option value="internet">{fr ? "Connexion Internet" : "Internet connection"}</option><option value="technical">{fr ? "Problème technique" : "Technical issue"}</option><option value="manager_request">{fr ? "Demande du manager" : "Manager request"}</option><option value="other">{fr ? "Autre" : "Other"}</option></select></label>
                <label className="text-xs font-black text-amber-950">{fr ? "Durée" : "Duration"}<select name="durationMinutes" defaultValue="60" className="mt-1.5 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"><option value="30">30 min</option><option value="60">1 h</option><option value="120">2 h</option><option value="180">3 h</option></select></label>
                <label className="text-xs font-black text-amber-950">{fr ? "Note obligatoire" : "Required note"}<input name="reason" required minLength={5} placeholder={fr ? "Ex. mauvaise connexion Internet ce matin" : "E.g. poor Internet connection this morning"} className="mt-1.5 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"/></label>
                <button className="self-end rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-400">{fr ? "Réouvrir" : "Reopen"}</button>
              </form>}
            </div>
          </article>;
        })}
        {!missingRows.length ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-black text-emerald-900">{fr ? "Toutes les personnes présentes dans votre périmètre ont soumis leurs priorités pour cette date." : "Everyone present in your scope has submitted their priorities for this date."}</div> : null}
      </div>
    </section>

    <form className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_1fr_1.5fr_auto]" action="/dashboard/hr/daily-priorities"><label className="text-sm font-black">{fr ? "Du" : "From"}<input type="date" name="from" defaultValue={from} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"/></label><label className="text-sm font-black">{fr ? "Au" : "To"}<input type="date" name="to" defaultValue={to} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"/></label><label className="text-sm font-black">{fr ? "Membre" : "Member"}<select name="member" defaultValue={selectedUser} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="">{fr ? "Tout mon périmètre" : "My whole scope"}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{nameById.get(profile.id)}</option>)}</select></label><button className="self-end rounded-xl bg-indigo-700 px-5 py-2.5 font-black text-white">{fr ? "Appliquer" : "Apply"}</button></form>

    <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label={fr ? "Taux d’exécution" : "Completion rate"} value={`${percent(completed.length, tasks.length)}%`} detail={`${completed.length}/${tasks.length} ${fr ? "priorités terminées" : "priorities completed"}`} tone="emerald"/><Metric label={fr ? "Priorités critiques" : "Critical priorities"} value={`${percent(criticalCompleted.length, critical.length)}%`} detail={`${criticalCompleted.length}/${critical.length} ${fr ? "terminées" : "completed"}`} tone="indigo"/><Metric label={fr ? "Reportées" : "Deferred"} value={deferred.length} detail={`${percent(deferred.length, tasks.length)}% ${fr ? "du total" : "of total"}`} tone="amber"/><Metric label={fr ? "À traiter" : "Needs attention"} value={unfinished.length} detail={fr ? "Non terminées sur la période" : "Unfinished during the period"} tone="rose"/></section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]"><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black">{fr ? "Tendance sur 14 jours" : "14-day trend"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Part des priorités terminées chaque jour" : "Share of priorities completed each day"}</p><div className="mt-6 flex h-64 items-end gap-2">{trend.map(([date, row]) => {const rate = percent(row.completed, row.total); return <div key={date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-black text-slate-500">{rate}%</span><div className="w-full rounded-t-lg bg-indigo-600" style={{height: `${Math.max(4, rate * 1.8)}px`}}/><span className="text-[9px] font-bold text-slate-400">{date.slice(5)}</span></div>})}{!trend.length ? <p className="m-auto text-sm font-bold text-slate-500">{fr ? "Aucune priorité pour cette période." : "No priorities in this period."}</p> : null}</div></article>
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="p-5 sm:p-6"><h2 className="text-xl font-black">{fr ? "Résultats par membre" : "Results by member"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? `${plans.length} plans analysés` : `${plans.length} plans analyzed`}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">{fr ? "Membre" : "Member"}</th><th className="px-5 py-3">{fr ? "Total" : "Total"}</th><th className="px-5 py-3">{fr ? "Terminées" : "Completed"}</th><th className="px-5 py-3">{fr ? "Bloquées" : "Blocked"}</th><th className="px-5 py-3">{fr ? "Reportées/partielles" : "Deferred/partial"}</th><th className="px-5 py-3">{fr ? "Taux" : "Rate"}</th></tr></thead><tbody>{memberRows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-5 py-4 font-black"><Link className="text-indigo-700 hover:underline" href={`/dashboard/hr/daily-priorities?${query.toString()}&member=${row.id}`}>{row.name}</Link></td><td className="px-5 py-4">{row.total}</td><td className="px-5 py-4 text-emerald-700">{row.done}</td><td className="px-5 py-4 text-rose-700">{row.blocked}</td><td className="px-5 py-4 text-amber-700">{row.delayed}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 font-black ${row.rate >= 80 ? "bg-emerald-100 text-emerald-800" : row.rate >= 60 ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800"}`}>{row.rate}%</span></td></tr>)}{!memberRows.length ? <tr><td colSpan={6} className="px-5 py-12 text-center font-bold text-slate-500">{fr ? "Aucune donnée pour ces filtres." : "No data for these filters."}</td></tr> : null}</tbody></table></div></article></section>
  </div></main>;
}
