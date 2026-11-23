import Link from "next/link";
import {redirect} from "next/navigation";
import {savePriorityRulesAction} from "@/app/actions/priority-rules";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Settings = {enabled: boolean; minimum_tasks: number; maximum_tasks: number; maximum_critical_tasks: number; required_from: string; plan_lock_time: string; allow_plan_revision: boolean; require_task_outcomes_for_report: boolean; require_due_time_for_high_priority: boolean; require_category_for_critical: boolean};
const allowedRoles = new Set(["owner", "admin", "hr"]);
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold text-slate-950";

function message(value: string | string[] | undefined) {return Array.isArray(value) ? value[0] ?? "" : value ?? "";}
function Toggle({name, checked, title, help}: {name: string; checked: boolean; title: string; help: string}) {return <label className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4"><input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-5 w-5 accent-indigo-700"/><span><span className="block font-black">{title}</span><span className="mt-1 block text-sm leading-6 text-slate-500">{help}</span></span></label>}

export default async function PriorityRulesPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (!membership || !allowedRoles.has(membership.role)) redirect("/dashboard?error=access-denied");
  await enforceOrganizationFeature(membership.organization_id, "performance");
  const {data, error} = await admin.from("daily_execution_settings").select("enabled,minimum_tasks,maximum_tasks,maximum_critical_tasks,required_from,plan_lock_time,allow_plan_revision,require_task_outcomes_for_report,require_due_time_for_high_priority,require_category_for_critical").eq("organization_id", membership.organization_id).maybeSingle<Settings>();
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);
  const settings: Settings = data ?? {enabled: true, minimum_tasks: 6, maximum_tasks: 12, maximum_critical_tasks: 2, required_from: today, plan_lock_time: "10:00", allow_plan_revision: true, require_task_outcomes_for_report: true, require_due_time_for_high_priority: false, require_category_for_critical: false};
  const success = message(params.success); const errorMessage = message(params.error);

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-6xl">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">{fr ? "Gouvernance de l’exécution" : "Execution governance"}</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">{fr ? "Règles avancées des priorités" : "Advanced priority rules"}</h1><p className="mt-3 max-w-3xl text-slate-300">{fr ? "Créez un cadre clair pour aider les équipes à se concentrer sur l’essentiel, sans transformer les priorités en sanctions automatiques." : "Create a clear framework that helps teams focus on what matters without turning priorities into automatic sanctions."}</p><Link href="/dashboard/hr/daily-priorities" className="mt-5 inline-block rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Voir les analyses" : "View analytics"}</Link></header>
    {success ? <p className="mt-5 rounded-2xl bg-emerald-100 p-4 font-bold text-emerald-900">{success}</p> : null}{errorMessage ? <p className="mt-5 rounded-2xl bg-rose-100 p-4 font-bold text-rose-900">{errorMessage}</p> : null}
    <form action={savePriorityRulesAction} className="mt-5 space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black">{fr ? "Cadre quotidien" : "Daily framework"}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-black">{fr ? "Minimum par jour" : "Daily minimum"}<input type="number" name="minimumTasks" min="1" max="12" required defaultValue={settings.minimum_tasks} className={field}/></label><label className="text-sm font-black">{fr ? "Maximum par jour" : "Daily maximum"}<input type="number" name="maximumTasks" min="1" max="12" required defaultValue={settings.maximum_tasks} className={field}/></label><label className="text-sm font-black">{fr ? "Maximum critiques" : "Maximum critical"}<input type="number" name="maximumCriticalTasks" min="1" max="12" required defaultValue={settings.maximum_critical_tasks} className={field}/></label><label className="text-sm font-black">{fr ? "Verrouillage du plan" : "Plan lock time"}<input type="time" name="planLockTime" required defaultValue={String(settings.plan_lock_time).slice(0, 5)} className={field}/></label><label className="text-sm font-black sm:col-span-2">{fr ? "Application à partir du" : "Apply from"}<input type="date" name="requiredFrom" required defaultValue={settings.required_from} className={field}/></label></div></section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black">{fr ? "Contrôles de qualité" : "Quality controls"}</h2><div className="mt-5 grid gap-3 lg:grid-cols-2"><Toggle name="enabled" checked={settings.enabled} title={fr ? "Activer les priorités quotidiennes" : "Enable daily priorities"} help={fr ? "Demande un plan de priorités aux collaborateurs concernés." : "Requires a priority plan from applicable employees."}/><Toggle name="allowPlanRevision" checked={settings.allow_plan_revision} title={fr ? "Autoriser les révisions avant verrouillage" : "Allow revisions before lock"} help={fr ? "Le collaborateur peut corriger son plan jusqu’à l’heure limite." : "Employees can revise their plan until the lock time."}/><Toggle name="requireTaskOutcomesForReport" checked={settings.require_task_outcomes_for_report} title={fr ? "Résultats obligatoires au rapport du soir" : "Require outcomes in the daily report"} help={fr ? "Le rapport ne peut être soumis sans résultat pour chaque priorité." : "The daily report cannot be submitted without an outcome for each priority."}/><Toggle name="requireDueTimeForHighPriority" checked={settings.require_due_time_for_high_priority} title={fr ? "Heure cible pour les importantes et critiques" : "Due time for high and critical priorities"} help={fr ? "Aide à distinguer une intention d’un engagement planifié." : "Helps distinguish an intention from a scheduled commitment."}/><Toggle name="requireCategoryForCritical" checked={settings.require_category_for_critical} title={fr ? "Catégorie obligatoire pour les critiques" : "Require category for critical priorities"} help={fr ? "Facilite l’analyse des domaines où l’urgence se concentre." : "Makes it easier to analyze where urgency is concentrated."}/></div></section>
      <div className="flex justify-end"><button className="rounded-xl bg-indigo-700 px-6 py-3 font-black text-white shadow-lg">{fr ? "Enregistrer les règles" : "Save rules"}</button></div>
    </form>
  </div></main>;
}
