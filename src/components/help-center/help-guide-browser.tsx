"use client";

import Link from "next/link";
import {useDeferredValue, useState} from "react";
import {submitHelpGuideFeedbackAction, updateHelpGuideProgressAction} from "@/app/actions/help-center";
import type {HelpGuide} from "@/lib/help-center/guides";

export type HelpProgress = {guide_id: string; status: "in_progress" | "completed"};
export type HelpFeedback = {guide_id: string; helpful: boolean; comment: string | null};
type Props = {guides: HelpGuide[]; locale: "fr" | "en"; progress: HelpProgress[]; feedback: HelpFeedback[]};
const categories = ["all", "getting_started", "daily_work", "sales", "management", "administration"] as const;

const copy = {
  fr: {search: "Rechercher une aide, une tâche ou un module", all: "Tous", getting_started: "Démarrage", daily_work: "Travail quotidien", sales: "Ventes", management: "Management", administration: "Administration", minutes: "min", steps: "étapes", open: "Ouvrir le module", none: "Aucun tutoriel ne correspond à cette recherche.", result: "tutoriel disponible", results: "tutoriels disponibles", start: "Commencer", resume: "Reprendre", complete: "Marquer comme terminé", completed: "Terminé", useful: "Ce guide t’a-t-il aidé ?", yes: "Oui", no: "Non", comment: "Comment améliorer ce tutoriel ? (facultatif)", send: "Envoyer l’avis"},
  en: {search: "Search help, a task or a module", all: "All", getting_started: "Getting started", daily_work: "Daily work", sales: "Sales", management: "Management", administration: "Administration", minutes: "min", steps: "steps", open: "Open module", none: "No tutorial matches this search.", result: "tutorial available", results: "tutorials available", start: "Start", resume: "Resume", complete: "Mark as complete", completed: "Completed", useful: "Did this guide help you?", yes: "Yes", no: "No", comment: "How could this tutorial improve? (optional)", send: "Send feedback"},
};

export function HelpGuideBrowser({guides, locale, progress, feedback}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const c = copy[locale];
  const progressByGuide = new Map(progress.map(row => [row.guide_id, row]));
  const feedbackByGuide = new Map(feedback.map(row => [row.guide_id, row]));
  const visible = guides.filter((guide) => {
    if (category !== "all" && guide.category !== category) return false;
    if (!deferredQuery) return true;
    const text = [guide.title[locale], guide.summary[locale], ...guide.steps.map(step => step[locale])].join(" ").toLocaleLowerCase(locale);
    return text.includes(deferredQuery);
  });

  return <>
    <section className="mt-7 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label={c.search}>
      <label className="block"><span className="sr-only">{c.search}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={c.search} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-5 py-3.5 text-sm font-semibold outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100" /></label>
      <div className="mt-4 flex flex-wrap gap-2" aria-label={locale === "fr" ? "Filtrer par catégorie" : "Filter by category"}>{categories.map(value => <button key={value} type="button" onClick={() => setCategory(value)} aria-pressed={category === value} className={`rounded-full border px-3.5 py-2 text-xs font-black transition ${category === value ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700"}`}>{c[value]}</button>)}</div>
    </section>

    <p className="mt-6 text-sm font-bold text-slate-500" aria-live="polite">{visible.length} {visible.length === 1 ? c.result : c.results}</p>
    {visible.length ? <div className="mt-4 grid gap-5 xl:grid-cols-2">{visible.map((guide, index) => {const guideProgress = progressByGuide.get(guide.id); const guideFeedback = feedbackByGuide.get(guide.id); return <article key={guide.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">{c[guide.category]}</p><h2 className="mt-2 text-xl font-black text-slate-950">{guide.title[locale]}</h2></div><span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">{guide.duration} {c.minutes}</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{guide.summary[locale]}</p></div>
      <div className="p-6"><ol className="space-y-4">{guide.steps.map((step, stepIndex) => <li key={`${guide.id}-${stepIndex}`} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-black text-indigo-700">{stepIndex + 1}</span><p className="pt-0.5 text-sm leading-6 text-slate-700">{step[locale]}</p></li>)}</ol><div className="mt-6 flex flex-wrap gap-2"><form action={updateHelpGuideProgressAction}><input type="hidden" name="guideId" value={guide.id}/><input type="hidden" name="status" value="in_progress"/><button className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-700">{guideProgress ? c.resume : c.start}</button></form><Link href={guide.href} className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700">{c.open} →</Link>{guideProgress?.status === "completed" ? <span className="rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-black text-emerald-800">✓ {c.completed}</span> : <form action={updateHelpGuideProgressAction}><input type="hidden" name="guideId" value={guide.id}/><input type="hidden" name="status" value="completed"/><button className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white">{c.complete}</button></form>}</div>
      <form action={submitHelpGuideFeedbackAction} className="mt-6 rounded-2xl bg-slate-50 p-4"><input type="hidden" name="guideId" value={guide.id}/><p className="text-sm font-black text-slate-800">{c.useful}</p><div className="mt-3 flex gap-2"><label className="cursor-pointer"><input className="peer sr-only" type="radio" name="helpful" value="true" required defaultChecked={guideFeedback?.helpful === true}/><span className="block rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-checked:text-white">👍 {c.yes}</span></label><label className="cursor-pointer"><input className="peer sr-only" type="radio" name="helpful" value="false" required defaultChecked={guideFeedback?.helpful === false}/><span className="block rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black peer-checked:border-rose-600 peer-checked:bg-rose-600 peer-checked:text-white">👎 {c.no}</span></label></div><textarea name="comment" maxLength={1000} rows={2} defaultValue={guideFeedback?.comment ?? ""} placeholder={c.comment} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><button className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-black text-white">{c.send}</button></form></div>
      <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold text-slate-500">{index + 1} · {guide.steps.length} {c.steps}</div>
    </article>})}</div> : <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">{c.none}</div>}
  </>;
}
