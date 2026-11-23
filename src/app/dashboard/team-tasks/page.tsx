import {redirect} from "next/navigation";
import {assignTeamTaskAction, cancelDelegatedTaskAction, removePersonalPriorityByManagerAction, updatePersonalPriorityByManagerAction} from "@/app/actions/team-tasks";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string; is_active: boolean};
type Profile = {id: string; full_name: string | null; email: string | null};
type Plan = {id: string; user_id: string; status: string};
type PersonalTask = {id: string; plan_id: string; user_id: string; title: string; expected_outcome: string; priority: string; due_time: string | null; category: string | null; progress_status: string; manager_controlled: boolean; manager_modified_at: string | null; manager_change_reason: string | null; manager_removed_at: string | null; manager_removed_reason: string | null};
type DelegatedTask = {id: string; assignee_id: string; assigned_by: string; title: string; expected_outcome: string; instructions: string | null; priority: string; due_time: string | null; status: string; status_note: string | null; source_type: string; source_label: string | null; created_at: string};

const leaderRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function personName(profile: Profile | undefined, fallback: string) {
  return profile?.full_name?.trim() || profile?.email || fallback;
}

function statusLabel(status: string, fr: boolean) {
  const map: Record<string, [string, string]> = {
    todo: ["À faire", "To do"], in_progress: ["En cours", "In progress"], completed: ["Terminée", "Completed"],
    partial: ["Partielle", "Partial"], blocked: ["Bloquée", "Blocked"], deferred: ["Reportée", "Deferred"], cancelled: ["Annulée", "Cancelled"],
  };
  return map[status]?.[fr ? 0 : 1] ?? status;
}

function taskTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50";
  if (status === "blocked") return "border-rose-200 bg-rose-50";
  if (["in_progress", "partial"].includes(status)) return "border-amber-200 bg-amber-50";
  return "border-slate-200 bg-white";
}

function Metric({label, value, detail, tone}: {label: string; value: string | number; detail: string; tone: "indigo" | "violet" | "emerald" | "rose"}) {
  const tones = {indigo: "border-indigo-200 bg-indigo-50", violet: "border-violet-200 bg-violet-50", emerald: "border-emerald-200 bg-emerald-50", rose: "border-rose-200 bg-rose-50"};
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{detail}</p></div>;
}

export default async function TeamTasksPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  if (!leaderRoles.has(membership.role)) redirect("/dashboard/my-day");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const requestedDate = first(params.date);
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayIso();
  const selectedMember = first(params.member);
  const success = first(params.success);
  const error = first(params.error);

  const visibleIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});
  const scopeIds = visibleIds.length ? visibleIds : [authData.user.id];

  const [{data: profilesData, error: profilesError}, {data: plansData, error: plansError}, {data: personalData, error: personalError}, {data: delegatedData, error: delegatedError}] = await Promise.all([
    admin.from("profiles").select("id,full_name,email").in("id", scopeIds),
    admin.from("daily_work_plans").select("id,user_id,status").eq("organization_id", membership.organization_id).eq("work_date", workDate).in("user_id", scopeIds),
    admin.from("daily_work_tasks").select("id,plan_id,user_id,title,expected_outcome,priority,due_time,category,progress_status,manager_controlled,manager_modified_at,manager_change_reason,manager_removed_at,manager_removed_reason").eq("organization_id", membership.organization_id).eq("work_date", workDate).in("user_id", scopeIds).order("position"),
    admin.from("team_delegated_tasks").select("id,assignee_id,assigned_by,title,expected_outcome,instructions,priority,due_time,status,status_note,source_type,source_label,created_at").eq("organization_id", membership.organization_id).eq("work_date", workDate).in("assignee_id", scopeIds).order("created_at", {ascending: true}),
  ]);
  const loadError = profilesError || plansError || personalError || delegatedError;
  if (loadError) throw new Error(loadError.message);

  const profiles = (profilesData ?? []) as Profile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const plans = (plansData ?? []) as Plan[];
  const personalTasks = (personalData ?? []) as PersonalTask[];
  const delegatedTasks = (delegatedData ?? []) as DelegatedTask[];
  const filteredIds = selectedMember && scopeIds.includes(selectedMember) ? [selectedMember] : scopeIds;
  const displayProfiles = filteredIds.map((id) => profileById.get(id)).filter(Boolean) as Profile[];
  const managerTaskCompleted = delegatedTasks.filter((task) => task.status === "completed").length;
  const blocked = [...personalTasks.filter((task) => task.progress_status === "blocked"), ...delegatedTasks.filter((task) => task.status === "blocked")].length;

  const query = new URLSearchParams({date: workDate});
  if (selectedMember) query.set("member", selectedMember);
  const returnTo = `/dashboard/team-tasks?${query.toString()}`;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">SUPER LEADER · TEAM EXECUTION</p>
          <h1 className="mt-2 text-4xl font-black">{fr ? "Tâches d’équipe & délégation" : "Team tasks & delegation"}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{fr ? "Affecte des tâches à ton équipe, vois les priorités que chacun a définies pour la journée et suis les blocages sans attendre le rapport du soir." : "Assign tasks to your team, see each member's self-defined daily priorities and track blockers before the end-of-day report."}</p>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900">{success}</div> : null}
        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900">{error}</div> : null}

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={fr ? "Collaborateurs visibles" : "Visible members"} value={scopeIds.length} detail={fr ? "Selon ton périmètre officiel" : "Based on your official scope"} tone="indigo"/>
          <Metric label={fr ? "Priorités personnelles" : "Personal priorities"} value={personalTasks.length} detail={`${plans.length} ${fr ? "plan(s) soumis" : "submitted plan(s)"}`} tone="violet"/>
          <Metric label={fr ? "Tâches affectées" : "Assigned tasks"} value={delegatedTasks.length} detail={`${managerTaskCompleted} ${fr ? "terminée(s)" : "completed"}`} tone="emerald"/>
          <Metric label={fr ? "Bloquées" : "Blocked"} value={blocked} detail={fr ? "À traiter par le manager" : "Needs manager attention"} tone="rose"/>
        </section>

        <section className="mt-5 rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "Délégation" : "Delegation"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Affecter une tâche" : "Assign a task"}</h2></div>
            <p className="text-sm font-bold text-violet-800">{fr ? "Le collaborateur reçoit immédiatement une notification et voit la tâche dans Ma journée." : "The employee is notified immediately and sees the task in My Day."}</p>
          </div>
          <form action={assignTeamTaskAction} className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <input type="hidden" name="returnTo" value={returnTo}/>
            <label className="text-sm font-black">{fr ? "Collaborateur" : "Member"}<select required name="assigneeId" defaultValue={selectedMember || ""} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"><option value="">{fr ? "Choisir…" : "Choose…"}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{personName(profile, profile.id)}</option>)}</select></label>
            <label className="text-sm font-black">{fr ? "Date" : "Date"}<input required type="date" name="workDate" defaultValue={workDate} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"/></label>
            <label className="text-sm font-black">{fr ? "Priorité" : "Priority"}<select name="priority" defaultValue="normal" className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label className="text-sm font-black">{fr ? "Échéance" : "Due time"}<input type="time" name="dueTime" className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"/></label>
            <label className="text-sm font-black xl:col-span-2">{fr ? "Tâche" : "Task"}<input required minLength={3} name="title" placeholder={fr ? "Ex. Préparer le rapport marketing" : "E.g. Prepare marketing report"} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"/></label>
            <label className="text-sm font-black xl:col-span-2">{fr ? "Résultat attendu" : "Expected outcome"}<input required minLength={3} name="expectedOutcome" placeholder={fr ? "Ex. Rapport final validable avant 14h" : "E.g. Final review-ready report before 2pm"} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"/></label>
            <label className="text-sm font-black lg:col-span-2 xl:col-span-3">{fr ? "Instructions / contexte" : "Instructions / context"}<textarea name="instructions" rows={2} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-3"/></label>
            <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white hover:bg-violet-800">{fr ? "Affecter la tâche" : "Assign task"}</button>
          </form>
        </section>

        <form action="/dashboard/team-tasks" className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[180px_1fr_auto]">
          <label className="text-sm font-black">{fr ? "Journée" : "Day"}<input type="date" name="date" defaultValue={workDate} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"/></label>
          <label className="text-sm font-black">{fr ? "Collaborateur" : "Member"}<select name="member" defaultValue={selectedMember} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="">{fr ? "Toute mon équipe" : "My whole team"}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{personName(profile, profile.id)}</option>)}</select></label>
          <button className="self-end rounded-xl bg-slate-950 px-5 py-2.5 font-black text-white">{fr ? "Afficher" : "Show"}</button>
        </form>

        <section className="mt-5 space-y-5">
          {displayProfiles.map((profile) => {
            const memberPersonal = personalTasks.filter((task) => task.user_id === profile.id);
            const memberDelegated = delegatedTasks.filter((task) => task.assignee_id === profile.id);
            const memberPlan = plans.find((plan) => plan.user_id === profile.id);
            return <article key={profile.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div><h2 className="text-xl font-black">{personName(profile, profile.id)}</h2><p className="mt-1 text-sm text-slate-500">{profile.email || ""}</p></div>
                <div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${memberPlan ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{memberPlan ? (fr ? "Plan soumis" : "Plan submitted") : (fr ? "Plan non soumis" : "Plan missing")}</span><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">{memberPersonal.length} {fr ? "personnelle(s)" : "personal"}</span><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{memberDelegated.length} {fr ? "manager" : "manager"}</span></div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black text-indigo-800">{fr ? "Priorités définies par le collaborateur" : "Employee-defined priorities"}</h3>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase text-indigo-700">{fr ? "Contrôle manager audité" : "Audited manager control"}</span>
                  </div>
                  <div className="mt-3 space-y-3">{memberPersonal.map((task) => {
                    const editable = !["completed", "cancelled"].includes(task.progress_status) && !task.manager_removed_at;
                    return <div key={task.id} className={`rounded-2xl border p-4 ${taskTone(task.progress_status)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-indigo-700 px-2 py-1 text-[10px] font-black uppercase text-white">{fr ? "Personnel" : "Personal"}</span>
                            {task.manager_controlled ? <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black uppercase text-violet-800">{fr ? "Ajustée par manager" : "Manager adjusted"}</span> : null}
                          </div>
                          <p className="mt-2 font-black">{task.title}</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black">{statusLabel(task.progress_status, fr)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{task.expected_outcome}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs font-black text-slate-500">
                        <span>{fr ? "Priorité" : "Priority"}: {task.priority}</span>
                        {task.due_time ? <span>{fr ? "Échéance" : "Due"}: {task.due_time.slice(0, 5)}</span> : null}
                        {task.category ? <span>{fr ? "Catégorie" : "Category"}: {task.category}</span> : null}
                      </div>
                      {task.manager_change_reason ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-bold text-violet-900">{fr ? "Dernier motif manager" : "Latest manager reason"}: {task.manager_change_reason}</p> : null}
                      {task.manager_removed_at ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-black text-rose-800">{fr ? "Retirée de la journée" : "Removed from day"}{task.manager_removed_reason ? ` · ${task.manager_removed_reason}` : ""}</p> : null}

                      {editable ? <details className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
                        <summary className="cursor-pointer list-none text-sm font-black text-indigo-800">{fr ? "Modifier / reprioriser" : "Edit / reprioritize"}</summary>
                        <form action={updatePersonalPriorityByManagerAction} className="mt-3 grid gap-3 md:grid-cols-2">
                          <input type="hidden" name="taskId" value={task.id}/>
                          <input type="hidden" name="returnTo" value={returnTo}/>
                          <label className="text-xs font-black text-slate-600">{fr ? "Titre" : "Title"}<input required minLength={3} name="title" defaultValue={task.title} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/></label>
                          <label className="text-xs font-black text-slate-600">{fr ? "Résultat attendu" : "Expected outcome"}<input required minLength={3} name="expectedOutcome" defaultValue={task.expected_outcome} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/></label>
                          <label className="text-xs font-black text-slate-600">{fr ? "Priorité" : "Priority"}<select name="priority" defaultValue={task.priority} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                          <label className="text-xs font-black text-slate-600">{fr ? "Échéance" : "Due time"}<input type="time" name="dueTime" defaultValue={task.due_time?.slice(0, 5) ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/></label>
                          <label className="text-xs font-black text-slate-600 md:col-span-2">{fr ? "Catégorie" : "Category"}<input name="category" defaultValue={task.category ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/></label>
                          <label className="text-xs font-black text-slate-600 md:col-span-2">{fr ? "Motif obligatoire de la modification" : "Required reason for change"}<textarea required minLength={5} name="reason" rows={2} placeholder={fr ? "Ex. Priorité commerciale de la journée, échéance avancée…" : "E.g. Daily commercial priority, earlier deadline…"} className="mt-1 w-full rounded-xl border border-violet-300 px-3 py-2 text-sm"/></label>
                          <button className="rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white md:col-span-2">{fr ? "Enregistrer la modification" : "Save manager change"}</button>
                        </form>
                        <form action={removePersonalPriorityByManagerAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_auto]">
                          <input type="hidden" name="taskId" value={task.id}/>
                          <input type="hidden" name="returnTo" value={returnTo}/>
                          <input required minLength={5} name="reason" placeholder={fr ? "Motif pour retirer cette priorité du jour" : "Reason to remove this priority from the day"} className="rounded-xl border border-rose-300 px-3 py-2 text-sm"/>
                          <button className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-black text-rose-800">{fr ? "Retirer du jour" : "Remove from day"}</button>
                        </form>
                      </details> : null}
                    </div>;
                  })}{!memberPersonal.length ? <p className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">{fr ? "Aucune priorité personnelle pour cette journée." : "No personal priorities for this day."}</p> : null}</div>
                </div>
                <div><h3 className="font-black text-violet-800">{fr ? "Tâches affectées par le management" : "Management-assigned tasks"}</h3><div className="mt-3 space-y-3">{memberDelegated.map((task) => <div key={task.id} className={`rounded-2xl border p-4 ${taskTone(task.status)}`}><div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-violet-700 px-2 py-1 text-[10px] font-black uppercase text-white">Manager</span><p className="mt-2 font-black">{task.title}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black">{statusLabel(task.status, fr)}</span></div><p className="mt-2 text-sm text-slate-600">{task.expected_outcome}</p>{task.status_note ? <p className="mt-2 rounded-xl bg-white/80 p-2 text-sm text-slate-600">{task.status_note}</p> : null}{task.status !== "completed" && task.status !== "cancelled" ? <form action={cancelDelegatedTaskAction} className="mt-3 flex gap-2"><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="returnTo" value={returnTo}/><input name="reason" placeholder={fr ? "Motif d’annulation" : "Cancellation reason"} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><button className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700">{fr ? "Annuler" : "Cancel"}</button></form> : null}</div>)}{!memberDelegated.length ? <p className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">{fr ? "Aucune tâche affectée par le management." : "No management-assigned tasks."}</p> : null}</div></div>
              </div>
            </article>;
          })}
          {!displayProfiles.length ? <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">{fr ? "Aucun collaborateur dans ce périmètre." : "No member in this scope."}</div> : null}
        </section>
      </div>
    </main>
  );
}
