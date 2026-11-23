"use client";

import {useMemo, useState} from "react";
import {saveStaffTrainingModuleQuizAction} from "@/app/actions/academy-staff-training";

type QuestionDraft = {
  id: string;
  questionText: string;
  options: [string, string, string, string];
  correctOption: number;
};

type Props = {
  locale: string;
  courseId: string;
  courseTitle: string;
  month: string;
  moduleLabel: string;
  moduleTitle: string;
  quizId?: string;
  initialTitle: string;
  initialPassingScore: number;
  initialMaxAttempts: number;
  initialRequired: boolean;
  initialQuestions: QuestionDraft[];
  attemptCount: number;
};

function blankQuestion(index: number): QuestionDraft {
  return {
    id: `new-${Date.now()}-${index}`,
    questionText: "",
    options: ["", "", "", ""],
    correctOption: 0,
  };
}

export function StaffTrainingDayQuizBuilder(props: Props) {
  const fr = props.locale !== "en";
  const locked = Boolean(props.quizId && props.attemptCount > 0);
  const [questions, setQuestions] = useState<QuestionDraft[]>(props.initialQuestions.length ? props.initialQuestions : [blankQuestion(0)]);
  const questionCount = questions.length;
  const backHref = useMemo(() => {
    const base = props.month
      ? `/dashboard/academy/staff-training?month=${encodeURIComponent(props.month)}`
      : `/dashboard/academy/staff-training?course=${encodeURIComponent(props.courseId)}`;
    return `${base}&module=${encodeURIComponent(props.moduleLabel)}`;
  }, [props.courseId, props.moduleLabel, props.month]);

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((current) => current.map((question, i) => i === index ? {...question, ...patch} : question));
  }

  function updateOption(questionIndex: number, optionIndex: number, value: string) {
    setQuestions((current) => current.map((question, i) => {
      if (i !== questionIndex) return question;
      const options = [...question.options] as [string, string, string, string];
      options[optionIndex] = value;
      return {...question, options};
    }));
  }

  function addQuestion() {
    if (questions.length >= 30) return;
    setQuestions((current) => [...current, blankQuestion(current.length)]);
  }

  function removeQuestion(index: number) {
    if (questions.length <= 1) return;
    setQuestions((current) => current.filter((_, i) => i !== index));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <a href={backHref} className="inline-flex items-center gap-2 text-sm font-black text-violet-700 hover:underline">
          ← {fr ? "Retour au Centre Staff Training" : "Back to Staff Training Center"}
        </a>

        <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-violet-950 to-indigo-950 p-7 text-white shadow-xl lg:p-10">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">Super Leader Academy · Quiz Builder</p>
          <h1 className="mt-3 text-3xl font-black lg:text-4xl">{props.quizId ? (fr ? "Modifier le quiz du jour" : "Edit day quiz") : (fr ? "Créer le quiz du jour" : "Create day quiz")}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-200">{props.courseTitle}</p>
          <div className="mt-5 rounded-2xl border border-white/20 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-violet-200">{props.moduleLabel}</p>
            <p className="mt-1 text-lg font-black">{props.moduleTitle}</p>
            <p className="mt-2 text-xs text-slate-300">{fr ? "Le cours et le jour sont verrouillés pour éviter un classement dans le mauvais mois ou module." : "Course and day are locked to prevent saving the quiz under the wrong month or module."}</p>
          </div>
        </header>

        {locked ? (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
            <h2 className="text-xl font-black">{fr ? "Quiz protégé par l'historique" : "Quiz protected by attempt history"}</h2>
            <p className="mt-2 text-sm leading-6">{fr ? `Ce quiz compte déjà ${props.attemptCount} tentative(s). Pour préserver les résultats du staff, les questions ne peuvent plus être modifiées. Tu peux revenir au Centre Staff Training pour le prévisualiser, le verrouiller ou le rouvrir.` : `This quiz already has ${props.attemptCount} attempt(s). To preserve staff results, its questions can no longer be edited. Return to Staff Training Center to preview, lock, or reopen it.`}</p>
          </section>
        ) : (
          <form action={saveStaffTrainingModuleQuizAction} className="space-y-6">
            <input type="hidden" name="courseId" value={props.courseId} />
            <input type="hidden" name="month" value={props.month} />
            <input type="hidden" name="moduleLabel" value={props.moduleLabel} />
            <input type="hidden" name="quizId" value={props.quizId ?? ""} />
            <input type="hidden" name="questionCount" value={questionCount} />

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="text-sm font-black text-slate-900 md:col-span-2">
                  {fr ? "Titre du quiz" : "Quiz title"}
                  <input name="title" required maxLength={180} defaultValue={props.initialTitle} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
                <label className="text-sm font-black text-slate-900">
                  {fr ? "Note minimale (%)" : "Passing score (%)"}
                  <input name="passingScore" type="number" min="1" max="100" step="1" required defaultValue={props.initialPassingScore} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="text-sm font-black text-slate-900">
                  {fr ? "Tentatives maximales" : "Maximum attempts"}
                  <input name="maxAttempts" type="number" min="1" max="10" step="1" required defaultValue={props.initialMaxAttempts} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-black text-slate-900 md:col-span-2">
                  <input name="isRequired" type="checkbox" defaultChecked={props.initialRequired} className="h-4 w-4" />
                  {fr ? "Quiz obligatoire pour ce jour" : "Quiz required for this day"}
                </label>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-violet-700">{fr ? "Questions" : "Questions"}</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">{questionCount} {fr ? "question(s)" : "question(s)"}</h2>
                  <p className="mt-2 text-sm text-slate-600">{fr ? "Chaque question utilise quatre réponses et une seule bonne réponse." : "Each question uses four answers and exactly one correct answer."}</p>
                </div>
                <button type="button" onClick={addQuestion} disabled={questions.length >= 30} className="rounded-xl bg-violet-100 px-4 py-3 text-sm font-black text-violet-800 hover:bg-violet-200 disabled:opacity-50">+ {fr ? "Ajouter une question" : "Add question"}</button>
              </div>

              <div className="mt-6 space-y-5">
                {questions.map((question, questionIndex) => (
                  <article key={question.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-black text-slate-950">{fr ? "Question" : "Question"} {questionIndex + 1}</h3>
                      {questions.length > 1 ? <button type="button" onClick={() => removeQuestion(questionIndex)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700">{fr ? "Supprimer" : "Remove"}</button> : null}
                    </div>

                    <label className="mt-4 block text-sm font-black text-slate-900">
                      {fr ? "Énoncé" : "Question text"}
                      <textarea name={`question_${questionIndex}_text`} required maxLength={800} rows={3} value={question.questionText} onChange={(event) => updateQuestion(questionIndex, {questionText: event.target.value})} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                    </label>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {question.options.map((option, optionIndex) => (
                        <label key={optionIndex} className="text-sm font-bold text-slate-800">
                          {fr ? "Réponse" : "Answer"} {String.fromCharCode(65 + optionIndex)}
                          <input name={`question_${questionIndex}_option_${optionIndex}`} required maxLength={400} value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                        </label>
                      ))}
                    </div>

                    <label className="mt-4 block text-sm font-black text-slate-900">
                      {fr ? "Bonne réponse" : "Correct answer"}
                      <select name={`question_${questionIndex}_correct`} value={question.correctOption} onChange={(event) => updateQuestion(questionIndex, {correctOption: Number(event.target.value)})} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                        {[0, 1, 2, 3].map((optionIndex) => <option key={optionIndex} value={optionIndex}>{String.fromCharCode(65 + optionIndex)}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-violet-200 bg-violet-50 p-5">
              <p className="max-w-2xl text-sm leading-6 text-violet-900">{fr ? "Le quiz sera enregistré en brouillon et verrouillé. Tu pourras ensuite le prévisualiser dans le Centre Staff Training avant de l'ouvrir au staff." : "The quiz will be saved as a locked draft. You can preview it in Staff Training Center before opening it to staff."}</p>
              <button className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">{props.quizId ? (fr ? "Mettre à jour en brouillon" : "Update draft") : (fr ? "Enregistrer en brouillon" : "Save draft")}</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
