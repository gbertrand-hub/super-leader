"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from "react";
import {saveDailyWorkPlanAction, updateDailyWorkTaskStatusAction} from "@/app/actions/daily-execution";
import {clockInAction} from "@/app/actions/performance";
import {dailyExecutionCopy} from "@/i18n/daily-execution";

export type DailyWorkPlanView = {
  id: string;
  status: string;
  revision_count: number;
  submitted_at: string | null;
  completed_at: string | null;
};

export type DailyWorkTaskView = {
  id: string;
  position: number;
  title: string;
  expected_outcome: string;
  priority: string;
  due_time: string | null;
  category: string | null;
  progress_status: string;
  actual_outcome: string | null;
  outcome_reason: string | null;
  next_action: string | null;
  next_action_date: string | null;
  manager_controlled?: boolean;
  manager_modified_at?: string | null;
  manager_change_reason?: string | null;
  manager_removed_at?: string | null;
  manager_removed_reason?: string | null;
};

type DraftPayload = {
  version: 1;
  updatedAt: string;
  values: Record<string, string>;
  autoSubmitAfterClockIn?: boolean;
};

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function tone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (["blocked", "cancelled"].includes(status)) return "border-red-200 bg-red-50 text-red-900";
  if (["in_progress", "partial", "deferred"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-white text-slate-900";
}

function formatSavedAt(value: string | null, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function readFormValues(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  const data = new FormData(form);
  for (const [name, value] of data.entries()) {
    if (!name.startsWith("$ACTION_") && typeof value === "string") values[name] = value;
  }
  return values;
}

function applyFormValues(form: HTMLFormElement, values: Record<string, string>) {
  const controls = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]");
  controls.forEach((control) => {
    if (control.type === "hidden" || control.dataset.managerControlled === "true") return;
    const value = values[control.name];
    if (typeof value === "string") control.value = value;
  });
}

export function DailyWorkPlanPanel({
  locale,
  workDate,
  attendanceStarted,
  attendanceClosed,
  migrationReady,
  enabled,
  minimumTasks,
  maximumTasks,
  plan,
  tasks,
  highlight,
  reportSubmitted,
  draftScope,
  planSaved,
}: {
  locale: string;
  workDate: string;
  attendanceStarted: boolean;
  attendanceClosed: boolean;
  migrationReady: boolean;
  enabled: boolean;
  minimumTasks: number;
  maximumTasks: number;
  plan: DailyWorkPlanView | null;
  tasks: DailyWorkTaskView[];
  highlight?: boolean;
  reportSubmitted?: boolean;
  draftScope: string;
  planSaved?: boolean;
}) {
  const c = dailyExecutionCopy(locale);
  const byPosition = new Map(tasks.map((task) => [task.position, task]));
  const taskSlots = Math.min(12, Math.max(minimumTasks, Math.min(maximumTasks, minimumTasks + 2)));
  const completedCount = tasks.filter((task) => task.progress_status === "completed").length;
  const planComplete = Boolean(plan && tasks.length >= minimumTasks);
  const formRef = useRef<HTMLFormElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showStartPrompt, setShowStartPrompt] = useState(false);
  const draftKey = useMemo(() => `super-leader:daily-priorities:v1:${draftScope}:${workDate}`, [draftScope, workDate]);

  const persistDraft = useCallback((autoSubmitAfterClockIn = false) => {
    const form = formRef.current;
    if (!form || typeof window === "undefined") return;
    const now = new Date().toISOString();
    const payload: DraftPayload = {
      version: 1,
      updatedAt: now,
      values: readFormValues(form),
      autoSubmitAfterClockIn,
    };
    window.localStorage.setItem(draftKey, JSON.stringify(payload));
    setSavedAt(now);
  }, [draftKey]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => persistDraft(false), 350);
  }, [persistDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (planSaved) {
      window.localStorage.removeItem(draftKey);
      // Reset the local draft indicators after the persisted plan is confirmed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedAt(null);
      setDraftRestored(false);
      return;
    }

    const raw = window.localStorage.getItem(draftKey);
    if (!raw || !formRef.current) return;
    try {
      const draft = JSON.parse(raw) as DraftPayload;
      if (draft.version !== 1 || !draft.values) return;
      const serverSubmittedAt = plan?.submitted_at ? new Date(plan.submitted_at).getTime() : 0;
      const draftUpdatedAt = new Date(draft.updatedAt).getTime();
      if (!draft.autoSubmitAfterClockIn && serverSubmittedAt && draftUpdatedAt <= serverSubmittedAt) {
        window.localStorage.removeItem(draftKey);
        return;
      }

      applyFormValues(formRef.current, draft.values);
      setSavedAt(draft.updatedAt);
      setDraftRestored(true);

      if (attendanceStarted && draft.autoSubmitAfterClockIn && !attendanceClosed && !reportSubmitted) {
        const nextDraft = {...draft, autoSubmitAfterClockIn: false};
        window.localStorage.setItem(draftKey, JSON.stringify(nextDraft));
        window.setTimeout(() => formRef.current?.requestSubmit(), 150);
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [attendanceClosed, attendanceStarted, draftKey, plan?.submitted_at, planSaved, reportSubmitted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleBeforeUnload = () => persistDraft(false);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [persistDraft]);

  function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    if (submitter?.dataset.startAndSave === "true") {
      persistDraft(true);
      return;
    }
    if (!attendanceStarted) {
      event.preventDefault();
      persistDraft(false);
      setShowStartPrompt(true);
    }
  }

  if (!migrationReady) {
    return (
      <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.16em] text-red-700">{c.migrationRequired}</p>
        <h2 className="mt-2 text-2xl font-black text-red-950">{c.title}</h2>
        <p className="mt-2 text-sm leading-6 text-red-800">{c.migrationHelp}</p>
      </section>
    );
  }

  if (!enabled) return null;

  return (
    <section id="daily-priorities" className={`mt-6 rounded-3xl border p-6 shadow-sm ${highlight ? "border-amber-400 bg-amber-50 ring-4 ring-amber-100" : "border-indigo-200 bg-white"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{c.eyebrow}</p>
          <h2 className="mt-1 text-3xl font-black text-slate-950">{c.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{c.subtitle}</p>
          {highlight && attendanceStarted && !planComplete ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-white p-4 text-amber-950">
              <p className="font-black">{c.triggerTitle}</p>
              <p className="mt-1 text-sm">{c.triggerHelp}</p>
            </div>
          ) : null}
          {!attendanceStarted ? (
            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
              <p className="font-black">{c.prepareBeforeClockInTitle}</p>
              <p className="mt-1 text-sm">{c.prepareBeforeClockInHelp}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${plan?.status === "completed" ? "bg-emerald-100 text-emerald-800" : planComplete ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-900"}`}>
            {plan?.status === "completed" ? c.completed : planComplete ? c.submitted : c.incomplete}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{c.taskCount(tasks.length, minimumTasks)}</span>
        </div>
      </div>

      {tasks.length ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">{c.progressTitle}</h3>
              <p className="mt-1 text-sm text-slate-500">{c.progressHelp}</p>
            </div>
            <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800">{completedCount}/{tasks.length}</p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {tasks.map((task) => (
              <article key={task.id} className={`rounded-2xl border p-4 ${tone(task.progress_status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider opacity-60">#{task.position}{task.category ? ` · ${task.category}` : ""}</p>
                    <h4 className="mt-1 font-black">{task.title}</h4>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {task.manager_controlled ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase text-violet-800">{locale === "fr" ? "Ajustée par le responsable" : "Manager adjusted"}</span> : null}
                    <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">{c.priorities[task.priority as keyof typeof c.priorities] ?? task.priority}</span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6"><strong>{c.expectedOutcome}:</strong> {task.expected_outcome}</p>
                {task.due_time ? <p className="mt-2 text-xs font-bold opacity-70">{c.dueTime}: {task.due_time.slice(0, 5)}</p> : null}
                {task.manager_change_reason ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-bold text-violet-900">{locale === "fr" ? "Motif du responsable" : "Manager reason"}: {task.manager_change_reason}</p> : null}
                {task.manager_removed_at ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-800">{locale === "fr" ? "Retirée de la journée par le responsable" : "Removed from the day by the manager"}{task.manager_removed_reason ? ` · ${task.manager_removed_reason}` : ""}</p> : null}
                {!reportSubmitted && plan?.status !== "completed" && !task.manager_removed_at ? (
                  <form action={updateDailyWorkTaskStatusAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="taskId" value={task.id} />
                    <select name="status" defaultValue={task.progress_status} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-800">
                      {Object.entries(c.progressStatuses).filter(([value]) => !(task.manager_controlled && value === "cancelled")).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{c.saveStatus}</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
          <Link href="/dashboard/performance?view=reports" className="mt-5 inline-flex rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{c.openReport}</Link>
        </div>
      ) : null}

      {!reportSubmitted && !attendanceClosed ? (
        <details open={!planComplete || highlight || !attendanceStarted} className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <summary className="cursor-pointer list-none font-black text-indigo-950">{planComplete ? c.editPlan : c.createPlan}</summary>
          <p className="mt-2 text-sm text-indigo-800">{c.planHelp}</p>
          <form
            ref={formRef}
            action={saveDailyWorkPlanAction}
            onSubmit={handlePlanSubmit}
            onInput={scheduleAutosave}
            onChange={scheduleAutosave}
            className="mt-5 space-y-4"
          >
            <input type="hidden" name="workDate" value={workDate} />
            <input type="hidden" name="returnTo" value="/dashboard/my-day?resumeDailyDraft=1" />
            {Array.from({length: taskSlots}, (_, index) => index + 1).map((position) => {
              const task = byPosition.get(position);
              const required = position <= minimumTasks;
              const managerControlled = Boolean(task?.manager_controlled);
              return (
                <fieldset key={position} className={`rounded-2xl border bg-white p-4 ${managerControlled ? "border-violet-300 ring-2 ring-violet-50" : "border-slate-200"}`}>
                  <legend className="px-2 text-sm font-black text-slate-950">{c.task(position)}{required ? " *" : ` · ${c.optional}`}</legend>
                  {managerControlled ? (
                    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                      <p className="font-black">{locale === "fr" ? "Priorité ajustée par ton responsable" : "Priority adjusted by your manager"}</p>
                      <p className="mt-1 text-xs leading-5">{locale === "fr" ? "Les champs ci-dessous sont verrouillés pour préserver la décision du responsable. Tu peux toujours mettre à jour l’état d’avancement." : "The fields below are locked to preserve the manager decision. You can still update execution status."}</p>
                      {task?.manager_change_reason ? <p className="mt-2 text-xs font-bold">{locale === "fr" ? "Motif" : "Reason"}: {task.manager_change_reason}</p> : null}
                    </div>
                  ) : null}
                  {managerControlled ? <>
                    <input type="hidden" name={`taskTitle${position}`} value={task?.title ?? ""}/>
                    <input type="hidden" name={`taskExpected${position}`} value={task?.expected_outcome ?? ""}/>
                    <input type="hidden" name={`taskPriority${position}`} value={task?.priority ?? "normal"}/>
                    <input type="hidden" name={`taskDue${position}`} value={task?.due_time?.slice(0, 5) ?? ""}/>
                    <input type="hidden" name={`taskCategory${position}`} value={task?.category ?? ""}/>
                  </> : null}
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="text-sm font-black text-slate-700">{c.taskTitle}
                      <input data-manager-controlled={managerControlled ? "true" : undefined} name={managerControlled ? undefined : `taskTitle${position}`} readOnly={managerControlled} required={!managerControlled && required} minLength={!managerControlled && required ? 3 : undefined} defaultValue={task?.title ?? ""} placeholder={c.taskTitlePlaceholder} className={`${fieldClass()} ${managerControlled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`} />
                    </label>
                    <label className="text-sm font-black text-slate-700">{c.expectedOutcome}
                      <input data-manager-controlled={managerControlled ? "true" : undefined} name={managerControlled ? undefined : `taskExpected${position}`} readOnly={managerControlled} required={!managerControlled && required} minLength={!managerControlled && required ? 3 : undefined} defaultValue={task?.expected_outcome ?? ""} placeholder={c.expectedOutcomePlaceholder} className={`${fieldClass()} ${managerControlled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`} />
                    </label>
                    <label className="text-sm font-black text-slate-700">{c.priority}
                      <select data-manager-controlled={managerControlled ? "true" : undefined} name={managerControlled ? undefined : `taskPriority${position}`} disabled={managerControlled} defaultValue={task?.priority ?? "normal"} className={`${fieldClass()} ${managerControlled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}>
                        {Object.entries(c.priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-black text-slate-700">{c.dueTime}
                      <input data-manager-controlled={managerControlled ? "true" : undefined} name={managerControlled ? undefined : `taskDue${position}`} readOnly={managerControlled} type="time" defaultValue={task?.due_time?.slice(0, 5) ?? ""} className={`${fieldClass()} ${managerControlled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`} />
                    </label>
                    <label className="text-sm font-black text-slate-700 lg:col-span-2">{c.category}
                      <input data-manager-controlled={managerControlled ? "true" : undefined} name={managerControlled ? undefined : `taskCategory${position}`} readOnly={managerControlled} defaultValue={task?.category ?? ""} placeholder={c.categoryPlaceholder} className={`${fieldClass()} ${managerControlled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`} />
                    </label>
                  </div>
                </fieldset>
              );
            })}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black text-slate-900">{draftRestored ? c.draftRestored : c.autosaveTitle}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {savedAt ? c.autosavedAt(formatSavedAt(savedAt, locale)) : c.autosaveHelp}
                  </p>
                </div>
                <button type="button" onClick={() => persistDraft(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">
                  {c.saveDraft}
                </button>
              </div>
            </div>

            {showStartPrompt && !attendanceStarted ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
                <p className="text-lg font-black">{c.startRequiredTitle}</p>
                <p className="mt-2 text-sm leading-6">{c.startRequiredHelp}</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="submit"
                    formAction={clockInAction}
                    data-start-and-save="true"
                    className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800"
                  >
                    {c.startAndSave}
                  </button>
                  <button type="button" onClick={() => {persistDraft(false); setShowStartPrompt(false);}} className="rounded-xl border border-amber-300 bg-white px-5 py-3 font-black text-amber-950 hover:bg-amber-100">
                    {c.keepDraft}
                  </button>
                </div>
              </div>
            ) : null}

            <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
              {attendanceStarted ? c.savePlan : c.savePlanBeforeClockIn}
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}

export function DailyTaskOutcomeFields({locale, tasks}: {locale: string; tasks: DailyWorkTaskView[]}) {
  const c = dailyExecutionCopy(locale);
  const finalStatuses = ["completed", "partial", "blocked", "deferred", "cancelled"];
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <h3 className="text-xl font-black text-indigo-950">{c.reportSectionTitle}</h3>
      <p className="mt-2 text-sm leading-6 text-indigo-800">{c.reportSectionHelp}</p>
      <div className="mt-4 space-y-4">
        {tasks.map((task) => {
          const currentFinal = finalStatuses.includes(task.progress_status) ? task.progress_status : "";
          return (
            <fieldset key={task.id} className="rounded-2xl border border-indigo-200 bg-white p-4">
              <input type="hidden" name="dailyTaskId" value={task.id} />
              <legend className="px-2 font-black text-slate-950">#{task.position} · {task.title}</legend>
              <p className="mb-4 text-sm text-slate-600"><strong>{c.expectedOutcome}:</strong> {task.expected_outcome}</p>
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="text-sm font-black text-slate-700">{c.finalStatus}
                  <select name={`dailyTaskStatus:${task.id}`} required defaultValue={currentFinal} className={fieldClass()}>
                    <option value="">{c.chooseStatus}</option>
                    {finalStatuses.map((value) => <option key={value} value={value}>{c.progressStatuses[value as keyof typeof c.progressStatuses]}</option>)}
                  </select>
                </label>
                <label className="text-sm font-black text-slate-700">{c.nextAction}
                  <select name={`dailyTaskNextAction:${task.id}`} defaultValue={task.next_action || (currentFinal === "completed" ? "none" : "")} className={fieldClass()}>
                    <option value="">{c.chooseStatus}</option>
                    {Object.entries(c.nextActions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-sm font-black text-slate-700 lg:col-span-2">{c.actualOutcome}
                  <textarea name={`dailyTaskOutcome:${task.id}`} minLength={3} rows={3} required defaultValue={task.actual_outcome ?? ""} placeholder={c.actualOutcomePlaceholder} className={fieldClass()} />
                </label>
                <label className="text-sm font-black text-slate-700">{c.reason}
                  <textarea name={`dailyTaskReason:${task.id}`} rows={2} defaultValue={task.outcome_reason ?? ""} placeholder={c.reasonPlaceholder} className={fieldClass()} />
                </label>
                <label className="text-sm font-black text-slate-700">{c.nextActionDate}
                  <input name={`dailyTaskNextDate:${task.id}`} type="date" defaultValue={task.next_action_date ?? ""} className={fieldClass()} />
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
