import { redirect } from "next/navigation";
import {
  createActionPlanAction,
  updateActionPlanAction,
} from "@/app/actions/action-plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ success?: string; error?: string }>;

type Member = {
  user_id: string;
  role: string;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ActionPlan = {
  id: string;
  created_by: string;
  owner_id: string;
  objective: string;
  action_title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "blocked" | "completed" | "cancelled";
  due_date: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
};

const roleLabels: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  hr: "Responsable RH",
  manager: "Manager",
  employee: "Employé",
};

const priorityLabels = {
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
};

const statusLabels = {
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloqué",
  completed: "Terminé",
  cancelled: "Annulé",
};

const priorityClasses = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-700",
};

const statusClasses = {
  todo: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-700",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-600",
};

function isLeader(role: string) {
  return ["owner", "admin", "hr", "manager"].includes(role);
}

function formatDate(value: string | null) {
  if (!value) return "Aucune échéance";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`),
  );
}

function isOverdue(plan: ActionPlan) {
  if (!plan.due_date || ["completed", "cancelled"].includes(plan.status)) return false;
  const due = new Date(`${plan.due_date}T23:59:59`);
  return due.getTime() < Date.now();
}

export default async function ActionPlansPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Impossible de charger l’organisation : ${membershipError.message}`);
  }
  if (!membership) redirect("/dashboard/company");

  const { data: memberRows } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .order("created_at");

  const members = (memberRows ?? []) as Member[];
  const memberIds = members.map((member) => member.user_id);
  const { data: profileRows } = memberIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", memberIds)
    : { data: [] as Profile[] };

  const profiles = (profileRows ?? []) as Profile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  let plansQuery = admin
    .from("action_plans")
    .select(
      "id,created_by,owner_id,objective,action_title,description,priority,status,due_date,progress,created_at,updated_at",
    )
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false });

  if (!isLeader(membership.role)) {
    plansQuery = plansQuery.or(
      `owner_id.eq.${authData.user.id},created_by.eq.${authData.user.id}`,
    );
  }

  const { data: planRows, error: plansError } = await plansQuery;
  if (plansError) throw new Error(`Impossible de charger les plans : ${plansError.message}`);

  const plans = (planRows ?? []) as ActionPlan[];
  const activePlans = plans.filter(
    (plan) => !["completed", "cancelled"].includes(plan.status),
  );
  const completedCount = plans.filter((plan) => plan.status === "completed").length;
  const overdueCount = plans.filter(isOverdue).length;
  const averageProgress = activePlans.length
    ? Math.round(
        activePlans.reduce((sum, plan) => sum + plan.progress, 0) / activePlans.length,
      )
    : 0;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-bold text-amber-400">PROGRESSION MESURABLE</p>
          <h1 className="mt-2 text-3xl font-black">Plans d’action</h1>
          <p className="mt-2 max-w-3xl text-slate-300">
            Transforme les feedbacks et les objectifs en actions concrètes, attribuées et suivies.
          </p>
        </header>

        {params.success && (
          <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">
            {params.success}
          </p>
        )}
        {params.error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">
            {params.error}
          </p>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Plans actifs</p>
            <p className="mt-2 text-3xl font-black">{activePlans.length}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Progression moyenne</p>
            <p className="mt-2 text-3xl font-black">{averageProgress}%</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Terminés</p>
            <p className="mt-2 text-3xl font-black text-emerald-700">{completedCount}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">En retard</p>
            <p className="mt-2 text-3xl font-black text-red-700">{overdueCount}</p>
          </article>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
          <section className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Nouveau plan</h2>
            <p className="mt-1 text-sm text-slate-500">
              Définis un objectif clair, une action, un responsable et une échéance.
            </p>

            <form action={createActionPlanAction} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-bold">Objectif</span>
                <input
                  name="objective"
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="Ex. Améliorer la communication de l’équipe"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>

              <label className="block">
                <span className="text-sm font-bold">Action principale</span>
                <input
                  name="actionTitle"
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="Ex. Organiser une réunion hebdomadaire"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>

              <label className="block">
                <span className="text-sm font-bold">Description</span>
                <textarea
                  name="description"
                  maxLength={2000}
                  rows={4}
                  placeholder="Étapes, ressources ou résultat attendu…"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>

              {isLeader(membership.role) ? (
                <label className="block">
                  <span className="text-sm font-bold">Responsable</span>
                  <select
                    name="ownerId"
                    defaultValue={authData.user.id}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    {members.map((member) => {
                      const profile = profileById.get(member.user_id);
                      return (
                        <option key={member.user_id} value={member.user_id}>
                          {profile?.full_name || profile?.email || "Utilisateur"} · {roleLabels[member.role] ?? member.role}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="ownerId" value={authData.user.id} />
              )}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block">
                  <span className="text-sm font-bold">Priorité</span>
                  <select
                    name="priority"
                    defaultValue="medium"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="low">Faible</option>
                    <option value="medium">Moyenne</option>
                    <option value="high">Haute</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-bold">Échéance</span>
                  <input
                    type="date"
                    name="dueDate"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  />
                </label>
              </div>

              <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800">
                Créer le plan d’action
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Suivi des plans ({plans.length})</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Mets à jour le statut, la progression et l’échéance.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {plans.length ? (
                plans.map((plan) => {
                  const owner = profileById.get(plan.owner_id);
                  const creator = profileById.get(plan.created_by);
                  const overdue = isOverdue(plan);

                  return (
                    <article
                      key={plan.id}
                      className={`rounded-2xl border p-5 ${
                        overdue ? "border-red-200 bg-red-50/40" : "border-slate-200"
                      }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityClasses[plan.priority]}`}>
                              Priorité {priorityLabels[plan.priority]}
                            </span>
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClasses[plan.status]}`}>
                              {statusLabels[plan.status]}
                            </span>
                            {overdue && (
                              <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
                                En retard
                              </span>
                            )}
                          </div>
                          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-indigo-700">
                            {plan.objective}
                          </p>
                          <h3 className="mt-1 text-xl font-black">{plan.action_title}</h3>
                          {plan.description && (
                            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
                              {plan.description}
                            </p>
                          )}
                          <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                            <p>
                              <span className="font-bold text-slate-900">Responsable :</span>{" "}
                              {owner?.full_name || owner?.email || "Utilisateur"}
                            </p>
                            <p>
                              <span className="font-bold text-slate-900">Échéance :</span>{" "}
                              {formatDate(plan.due_date)}
                            </p>
                            <p>
                              <span className="font-bold text-slate-900">Créé par :</span>{" "}
                              {creator?.full_name || creator?.email || "Utilisateur"}
                            </p>
                            <p>
                              <span className="font-bold text-slate-900">Progression :</span>{" "}
                              {plan.progress}%
                            </p>
                          </div>
                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-indigo-600"
                              style={{ width: `${plan.progress}%` }}
                            />
                          </div>
                        </div>

                        <form
                          action={updateActionPlanAction}
                          className="grid w-full gap-3 rounded-2xl bg-slate-50 p-4 lg:max-w-xs"
                        >
                          <input type="hidden" name="planId" value={plan.id} />
                          <label>
                            <span className="text-xs font-bold uppercase text-slate-500">Statut</span>
                            <select
                              name="status"
                              defaultValue={plan.status}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                            >
                              <option value="todo">À faire</option>
                              <option value="in_progress">En cours</option>
                              <option value="blocked">Bloqué</option>
                              <option value="completed">Terminé</option>
                              <option value="cancelled">Annulé</option>
                            </select>
                          </label>
                          <label>
                            <span className="text-xs font-bold uppercase text-slate-500">Progression</span>
                            <input
                              type="number"
                              name="progress"
                              min={0}
                              max={100}
                              step={5}
                              defaultValue={plan.progress}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>
                          <label>
                            <span className="text-xs font-bold uppercase text-slate-500">Échéance</span>
                            <input
                              type="date"
                              name="dueDate"
                              defaultValue={plan.due_date ?? ""}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>
                          <button className="rounded-xl bg-slate-950 px-4 py-2.5 font-bold text-white hover:bg-slate-800">
                            Mettre à jour
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500">
                  Aucun plan d’action pour le moment. Crée le premier plan à gauche.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
