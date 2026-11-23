import {updateDelegatedTaskStatusAction} from "@/app/actions/team-tasks";

export type TeamDelegatedTaskView = {
  id: string;
  title: string;
  expected_outcome: string;
  instructions: string | null;
  priority: string;
  due_time: string | null;
  status: string;
  status_note: string | null;
  source_type: string;
  source_label: string | null;
  assigned_by: string;
};

function statusLabel(status: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    todo: ["À faire", "To do"],
    in_progress: ["En cours", "In progress"],
    completed: ["Terminée", "Completed"],
    blocked: ["Bloquée", "Blocked"],
    deferred: ["Reportée", "Deferred"],
    cancelled: ["Annulée", "Cancelled"],
  };
  return labels[status]?.[fr ? 0 : 1] ?? status;
}

function taskTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50";
  if (status === "blocked") return "border-rose-200 bg-rose-50";
  if (status === "in_progress") return "border-amber-200 bg-amber-50";
  if (["cancelled", "deferred"].includes(status)) return "border-slate-200 bg-slate-50";
  return "border-violet-200 bg-violet-50/60";
}

export function TeamDelegatedTasksPanel({
  locale,
  tasks,
  assignerNames,
  locked = false,
}: {
  locale: string;
  tasks: TeamDelegatedTaskView[];
  assignerNames: Record<string, string>;
  locked?: boolean;
}) {
  if (!tasks.length) return null;
  const fr = locale === "fr";
  const completed = tasks.filter((task) => task.status === "completed").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;

  return (
    <section id="manager-tasks" className="mt-6 rounded-3xl border border-violet-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Délégation & équipe" : "Delegation & team"}</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">{fr ? "Tâches affectées par mon responsable" : "Tasks assigned by my manager"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {fr ? "Ces tâches sont séparées de tes priorités personnelles. Tu peux mettre à jour leur exécution, mais tu ne peux pas les supprimer." : "These tasks are separate from your personal priorities. You can update execution, but you cannot delete them."}
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{completed}/{tasks.length} {fr ? "terminées" : "completed"}</span>
          {blocked ? <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800">{blocked} {fr ? "bloquée(s)" : "blocked"}</span> : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {tasks.map((task) => (
          <article key={task.id} className={`rounded-2xl border p-4 ${taskTone(task.status)}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-violet-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">{fr ? "Manager" : "Manager"}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{task.priority}</span>
                </div>
                <h3 className="mt-2 font-black text-slate-950">{task.title}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{fr ? "Affectée par" : "Assigned by"}: {assignerNames[task.assigned_by] || task.source_label || "—"}</p>
              </div>
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-black text-slate-800">{statusLabel(task.status, fr)}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700"><strong>{fr ? "Résultat attendu" : "Expected outcome"}:</strong> {task.expected_outcome}</p>
            {task.instructions ? <p className="mt-2 text-sm leading-6 text-slate-600"><strong>{fr ? "Instructions" : "Instructions"}:</strong> {task.instructions}</p> : null}
            {task.due_time ? <p className="mt-2 text-xs font-black text-slate-500">{fr ? "Échéance" : "Due"}: {task.due_time.slice(0, 5)}</p> : null}
            {task.status_note ? <p className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-slate-700">{task.status_note}</p> : null}

            {!locked && task.status !== "cancelled" ? (
              <form action={updateDelegatedTaskStatusAction} className="mt-4 grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                <input type="hidden" name="taskId" value={task.id}/>
                <input type="hidden" name="returnTo" value="/dashboard/my-day#manager-tasks"/>
                <select name="status" defaultValue={task.status} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold">
                  <option value="todo">{fr ? "À faire" : "To do"}</option>
                  <option value="in_progress">{fr ? "En cours" : "In progress"}</option>
                  <option value="completed">{fr ? "Terminée" : "Completed"}</option>
                  <option value="blocked">{fr ? "Bloquée" : "Blocked"}</option>
                  <option value="deferred">{fr ? "Reportée" : "Deferred"}</option>
                </select>
                <input name="statusNote" defaultValue={task.status_note ?? ""} placeholder={fr ? "Note / raison du blocage" : "Note / blocking reason"} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>
                <button className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white">{fr ? "Mettre à jour" : "Update"}</button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
