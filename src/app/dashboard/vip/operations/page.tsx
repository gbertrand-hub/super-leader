import Link from "next/link";
import {redirect} from "next/navigation";
import {
  saveVipOperationalTaskAction,
  updateVipOperationalTaskStatusAction,
} from "@/app/actions/vip-operations";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {APP_VERSION} from "@/lib/app-version";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Profile = {id: string; full_name: string | null; email: string | null};
type OrgMember = {user_id: string; role: string};
type Task = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  owner_user_id: string | null;
  backup_user_id: string | null;
  due_at: string | null;
};
type Governance = {
  vip_manager_user_id: string | null;
  vip_assistant_manager_user_id: string | null;
  vip_growth_membership_manager_user_id: string | null;
  vip_communications_assistant_user_id: string | null;
  vip_events_travel_assistant_user_id: string | null;
  vip_benefits_partners_assistant_user_id: string | null;
  vip_membership_concierge_assistant_user_id: string | null;
  vip_operations_require_backup_for_critical: boolean | null;
  vip_operations_escalation_hours: number | null;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3";

export default async function VipOperationsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const tr = (frText: string, enText: string) => fr ? frText : enText;
  const params = await searchParams;
  const view = first(params.view) || "open";
  const success = first(params.success);
  const errorMessage = first(params.error);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const {data: settings, error: settingsError} = await admin
    .from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_communications_assistant_user_id,vip_events_travel_assistant_user_id,vip_benefits_partners_assistant_user_id,vip_membership_concierge_assistant_user_id,vip_operations_require_backup_for_critical,vip_operations_escalation_hours")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<Governance>();
  if (settingsError) throw new Error(settingsError.message);

  const privilegedIds = [
    settings?.vip_manager_user_id,
    settings?.vip_assistant_manager_user_id,
    settings?.vip_growth_membership_manager_user_id,
    settings?.vip_communications_assistant_user_id,
    settings?.vip_events_travel_assistant_user_id,
    settings?.vip_benefits_partners_assistant_user_id,
    settings?.vip_membership_concierge_assistant_user_id,
  ];
  const hasVipAssignment = privilegedIds.includes(authData.user.id);
  if (!["owner", "admin", "executive", "hr"].includes(membership.role) && !hasVipAssignment) {
    redirect("/dashboard/my-day");
  }

  const [tasksResult, membersResult, profilesResult] = await Promise.all([
    admin.from("vip_operational_tasks").select("id,title,description,category,priority,status,owner_user_id,backup_user_id,due_at").eq("organization_id", membership.organization_id).order("due_at", {ascending: true, nullsFirst: false}).limit(1000),
    admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("profiles").select("id,full_name,email"),
  ]);
  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (membersResult.error) throw new Error(membersResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const tasks = (tasksResult.data ?? []) as Task[];
  const orgMembers = (membersResult.data ?? []) as OrgMember[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const profileMap = new Map<string, Profile>(profiles.map((profile) => [profile.id, profile]));
  const candidates = orgMembers
    .map((member) => ({
      id: member.user_id,
      role: member.role,
      name: profileMap.get(member.user_id)?.full_name || profileMap.get(member.user_id)?.email || member.user_id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const overdueTasks = openTasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < now);
  const criticalTasks = openTasks.filter((task) => task.priority === "critical");
  const criticalWithoutBackup = criticalTasks.filter((task) => !task.backup_user_id);
  const escalationHours = settings?.vip_operations_escalation_hours ?? 24;
  const escalationRequired = overdueTasks.filter((task) => task.due_at && now >= new Date(task.due_at).getTime() + escalationHours * 60 * 60 * 1000);
  const visibleTasks = view === "completed"
    ? tasks.filter((task) => task.status === "completed")
    : view === "overdue"
      ? overdueTasks
      : view === "today"
        ? openTasks.filter((task) => task.due_at?.slice(0, 10) === today)
        : openTasks;

  const personName = (id: string | null) => {
    if (!id) return tr("Non attribué", "Unassigned");
    const profile = profileMap.get(id);
    return profile?.full_name || profile?.email || id;
  };
  const categoryLabels: Record<string, string> = {
    communications: tr("Communications", "Communications"),
    events_travel: tr("Events & Travel", "Events & Travel"),
    benefits_partners: tr("Benefits & Partners", "Benefits & Partners"),
    membership_concierge: tr("Membership & Concierge", "Membership & Concierge"),
    growth_membership: tr("Croissance & Adhésions", "Growth & Membership"),
    general: tr("Général", "General"),
  };
  const categoryLabel = (value: string) => categoryLabels[value] ?? value;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION} · VIP Operations</p>
              <h1 className="mt-2 text-4xl font-black">{tr("Centre opérationnel VIP", "VIP Operations Center")}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">{tr("Une tâche importante doit toujours avoir un responsable, une échéance et, si elle est critique, un backup.", "Every important task should have an owner, a due date and, when critical, a backup.")}</p>
            </div>
            <div className="flex gap-2">
              <Link href="/dashboard/vip" className="rounded-xl border border-white/20 px-4 py-2 font-black">VIP</Link>
              <Link href="/dashboard/vip/settings?view=program" className="rounded-xl bg-white px-4 py-2 font-black text-slate-950">{tr("Gouvernance", "Governance")}</Link>
            </div>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-xl bg-red-50 p-4 font-bold text-red-900">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            [tr("Ouvertes", "Open"), openTasks.length],
            [tr("En retard", "Overdue"), overdueTasks.length],
            [tr("Critiques", "Critical"), criticalTasks.length],
            [tr("Critiques sans backup", "Critical without backup"), criticalWithoutBackup.length],
            [tr("Escalades requises", "Escalations required"), escalationRequired.length],
          ].map(([label, value]) => (
            <article key={String(label)} className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-black uppercase text-slate-500">{label}</p>
              <p className="mt-2 text-4xl font-black">{value}</p>
            </article>
          ))}
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border bg-white p-3">
          {[
            ["open", tr("À traiter", "To handle")],
            ["today", tr("Aujourd’hui", "Today")],
            ["overdue", tr("En retard", "Overdue")],
            ["completed", tr("Terminées", "Completed")],
          ].map(([key, label]) => (
            <Link key={key} href={`/dashboard/vip/operations?view=${key}`} className={`rounded-xl px-4 py-2 font-black ${view === key ? "bg-rose-700 text-white" : "bg-slate-100"}`}>{label}</Link>
          ))}
        </nav>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <form action={saveVipOperationalTaskAction} className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{tr("Nouvelle tâche VIP", "New VIP task")}</h2>
            <label className="mt-4 block font-bold">{tr("Titre", "Title")}<input name="title" required minLength={3} className={inputClass} /></label>
            <label className="mt-4 block font-bold">{tr("Description", "Description")}<textarea name="description" rows={4} className={inputClass} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="mt-4 block font-bold">{tr("Pôle", "Category")}
                <select name="category" className={inputClass}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="mt-4 block font-bold">{tr("Priorité", "Priority")}
                <select name="priority" className={inputClass}><option value="normal">{tr("Normale", "Normal")}</option><option value="important">{tr("Importante", "Important")}</option><option value="critical">{tr("Critique", "Critical")}</option></select>
              </label>
              <label className="mt-4 block font-bold">{tr("Responsable", "Owner")}
                <select name="ownerUserId" className={inputClass}><option value="">{tr("Non attribué", "Unassigned")}</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role}</option>)}</select>
              </label>
              <label className="mt-4 block font-bold">Backup
                <select name="backupUserId" className={inputClass}><option value="">{tr("Aucun", "None")}</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role}</option>)}</select>
              </label>
              <label className="mt-4 block font-bold">{tr("Échéance", "Due date")}<input name="dueAt" type="datetime-local" className={inputClass} /></label>
            </div>
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{tr(`Règle : backup critique ${settings?.vip_operations_require_backup_for_critical === false ? "optionnel" : "obligatoire"} · remontée opérationnelle après ${settings?.vip_operations_escalation_hours ?? 24} h.`, `Rule: critical backup ${settings?.vip_operations_require_backup_for_critical === false ? "optional" : "required"} · operational escalation after ${settings?.vip_operations_escalation_hours ?? 24} h.`)}</p>
            <button className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{tr("Créer la tâche", "Create task")}</button>
          </form>

          <div className="space-y-4">
            {visibleTasks.map((task) => {
              const late = Boolean(task.due_at && new Date(task.due_at).getTime() < now && !["completed", "cancelled"].includes(task.status));
              const needsEscalation = Boolean(task.due_at && now >= new Date(task.due_at).getTime() + escalationHours * 60 * 60 * 1000 && !["completed", "cancelled"].includes(task.status));
              return (
                <article key={task.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${late ? "border-red-300" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black">{categoryLabel(task.category)}</span>
                        <span className={`rounded-full px-2 py-1 text-xs font-black ${task.priority === "critical" ? "bg-red-100 text-red-800" : task.priority === "important" ? "bg-amber-100 text-amber-900" : "bg-slate-100"}`}>{task.priority}</span>
                        {late ? <span className="rounded-full bg-red-700 px-2 py-1 text-xs font-black text-white">{tr("EN RETARD", "OVERDUE")}</span> : null}
                        {needsEscalation ? <span className="rounded-full bg-slate-950 px-2 py-1 text-xs font-black text-white">{tr("ESCALADE", "ESCALATE")}</span> : null}
                      </div>
                      <h3 className="mt-3 text-xl font-black">{task.title}</h3>
                      {task.description ? <p className="mt-2 text-sm text-slate-600">{task.description}</p> : null}
                    </div>
                    <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-800">{task.status}</span>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <p><b>{tr("Responsable", "Owner")}:</b> {personName(task.owner_user_id)}</p>
                    <p><b>Backup:</b> {personName(task.backup_user_id)}</p>
                    <p><b>{tr("Échéance", "Due")}:</b> {task.due_at ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(task.due_at)) : "—"}</p>
                  </div>
                  {!['completed', 'cancelled'].includes(task.status) ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        ["in_progress", tr("Démarrer", "Start")],
                        ["blocked", tr("Bloquée", "Blocked")],
                        ["completed", tr("Terminer", "Complete")],
                      ].map(([status, label]) => (
                        <form key={status} action={updateVipOperationalTaskStatusAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="nextStatus" value={status} />
                          <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">{label}</button>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {visibleTasks.length === 0 ? <p className="rounded-3xl border bg-white p-8 text-center text-slate-500">{tr("Aucune tâche dans cette vue.", "No tasks in this view.")}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
