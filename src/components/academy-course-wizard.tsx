"use client";

import {useMemo, useRef, useState} from "react";
import {createAcademyCourseWizardAction} from "@/app/actions/academy";

type Participant = {id: string; label: string};
type Team = {id: string; name: string; department: string; memberCount: number};
type Props = {
  locale: string;
  currentMonth: string;
  participants: Participant[];
  teams: Team[];
};

type QuestionDraft = {
  id: string;
  question: string;
  options: [string, string, string, string];
  correct: string;
  points: string;
};

const steps = ["details", "schedule", "quiz", "participants", "review"] as const;
type Step = (typeof steps)[number];

function freshQuestion(): QuestionDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    question: "",
    options: ["", "", "", ""],
    correct: "0",
    points: "1",
  };
}

function inputClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

export function AcademyCourseWizard({locale, currentMonth, participants, teams}: Props) {
  const fr = locale === "fr";
  const c = fr
    ? {
        title: "Assistant de création d’une formation",
        help: "Crée la formation, sa planification, son quiz et ses affectations dans un seul parcours clair.",
        steps: ["Informations", "Planification", "Quiz", "Participants", "Vérification"],
        back: "Précédent",
        next: "Continuer",
        detailsTitle: "1. Informations générales",
        courseTitle: "Titre",
        description: "Description",
        month: "Mois de formation",
        deadline: "Date limite",
        category: "Catégorie",
        duration: "Durée totale en minutes",
        passingScore: "Note minimale",
        maxAttempts: "Tentatives maximales",
        attendance: "Présence minimale requise",
        resource: "Lien vers la ressource",
        required: "Formation obligatoire",
        certificate: "Délivrer un certificat",
        scheduleTitle: "2. Planification des séances",
        scheduleHelp: "Choisis le rythme. Les séances seront générées automatiquement avec leurs dates, heures et liens Zoom.",
        scheduleType: "Type de formation",
        single: "Formation unique",
        weekly: "Hebdomadaire",
        intensive: "Intensive mensuelle",
        custom: "Dates personnalisées",
        scheduleLabel: "Nom de la série",
        startsOn: "Début de la période",
        endsOn: "Fin de la période",
        sessionDate: "Date de la séance",
        startTime: "Heure de début",
        sessionDuration: "Durée d’une séance",
        timezone: "Fuseau horaire",
        zoom: "Lien Zoom",
        weekdays: "Jours de la semaine",
        monthlyStartDay: "Premier jour du mois",
        consecutiveDays: "Nombre de jours consécutifs",
        customDates: "Dates des séances",
        addDate: "Ajouter une date",
        remove: "Retirer",
        quizTitle: "3. Quiz final",
        quizHelp: "Un quiz est obligatoire avant de publier une formation avec certificat. Un brouillon peut rester incomplet.",
        question: "Question",
        option: "Option",
        correct: "Bonne réponse",
        points: "Points",
        addQuestion: "Ajouter une question",
        noQuestion: "Aucune question ajoutée. Le brouillon pourra être créé, mais la publication restera bloquée si le certificat est activé.",
        participantsTitle: "4. Participants",
        participantsHelp: "Affecte toute l’organisation, une ou plusieurs équipes, ou des collaborateurs précis.",
        assignmentScope: "Mode d’affectation",
        none: "Aucun participant pour le moment",
        organization: "Toute l’organisation",
        teamScope: "Une ou plusieurs équipes",
        selectedScope: "Collaborateurs précis",
        teams: "Équipes",
        people: "Collaborateurs",
        reviewTitle: "5. Vérification et publication",
        reviewHelp: "Vérifie le résumé avant de créer la formation et de générer ses séances.",
        publication: "Mode de publication",
        draft: "Enregistrer comme brouillon",
        publish: "Publier immédiatement",
        createDraft: "Créer le brouillon complet",
        createPublish: "Créer, générer les séances et publier",
        summaryCourse: "Formation",
        summarySchedule: "Planification",
        summaryQuiz: "Quiz",
        summaryParticipants: "Participants",
        requiredYes: "Obligatoire",
        optional: "Facultative",
        certificateYes: "Certificat activé",
        certificateNo: "Sans certificat",
        questionCount: "question(s)",
        selectedCount: "sélection(s)",
        monday: "Lun",
        tuesday: "Mar",
        wednesday: "Mer",
        thursday: "Jeu",
        friday: "Ven",
        saturday: "Sam",
        sunday: "Dim",
      }
    : {
        title: "Course creation wizard",
        help: "Create the course, schedule, quiz and assignments in one clear workflow.",
        steps: ["Details", "Schedule", "Quiz", "Participants", "Review"],
        back: "Back",
        next: "Continue",
        detailsTitle: "1. General details",
        courseTitle: "Title",
        description: "Description",
        month: "Training month",
        deadline: "Deadline",
        category: "Category",
        duration: "Total duration in minutes",
        passingScore: "Passing score",
        maxAttempts: "Maximum attempts",
        attendance: "Minimum attendance required",
        resource: "Resource link",
        required: "Required training",
        certificate: "Issue a certificate",
        scheduleTitle: "2. Session schedule",
        scheduleHelp: "Choose the rhythm. Sessions will be generated automatically with dates, times and Zoom links.",
        scheduleType: "Training type",
        single: "Single course",
        weekly: "Weekly",
        intensive: "Monthly intensive",
        custom: "Custom dates",
        scheduleLabel: "Series name",
        startsOn: "Period start",
        endsOn: "Period end",
        sessionDate: "Session date",
        startTime: "Start time",
        sessionDuration: "Session duration",
        timezone: "Time zone",
        zoom: "Zoom link",
        weekdays: "Weekdays",
        monthlyStartDay: "First day of the month",
        consecutiveDays: "Consecutive days",
        customDates: "Session dates",
        addDate: "Add a date",
        remove: "Remove",
        quizTitle: "3. Final quiz",
        quizHelp: "A quiz is required before publishing a course with a certificate. A draft may remain incomplete.",
        question: "Question",
        option: "Option",
        correct: "Correct answer",
        points: "Points",
        addQuestion: "Add a question",
        noQuestion: "No question added. The draft can be created, but publication will remain blocked while certificates are enabled.",
        participantsTitle: "4. Participants",
        participantsHelp: "Assign the entire organisation, one or more teams, or selected colleagues.",
        assignmentScope: "Assignment mode",
        none: "No participant yet",
        organization: "Entire organisation",
        teamScope: "One or more teams",
        selectedScope: "Selected colleagues",
        teams: "Teams",
        people: "Colleagues",
        reviewTitle: "5. Review and publish",
        reviewHelp: "Review the summary before creating the course and generating its sessions.",
        publication: "Publication mode",
        draft: "Save as draft",
        publish: "Publish immediately",
        createDraft: "Create complete draft",
        createPublish: "Create, generate sessions and publish",
        summaryCourse: "Course",
        summarySchedule: "Schedule",
        summaryQuiz: "Quiz",
        summaryParticipants: "Participants",
        requiredYes: "Required",
        optional: "Optional",
        certificateYes: "Certificate enabled",
        certificateNo: "No certificate",
        questionCount: "question(s)",
        selectedCount: "selection(s)",
        monday: "Mon",
        tuesday: "Tue",
        wednesday: "Wed",
        thursday: "Thu",
        friday: "Fri",
        saturday: "Sat",
        sunday: "Sun",
      };

  const [step, setStep] = useState<Step>("details");
  const [scheduleType, setScheduleType] = useState("weekly");
  const [questions, setQuestions] = useState<QuestionDraft[]>([freshQuestion()]);
  const [customDates, setCustomDates] = useState<string[]>([`${currentMonth}-01`]);
  const [assignmentScope, setAssignmentScope] = useState("none");
  const [publishMode, setPublishMode] = useState("draft");
  const [isRequired, setIsRequired] = useState(true);
  const [certificateEnabled, setCertificateEnabled] = useState(true);
  const [title, setTitle] = useState("");
  const [scheduleLabel, setScheduleLabel] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const currentIndex = steps.indexOf(step);

  const scheduleSummary = useMemo(() => {
    if (scheduleType === "weekly") return fr ? "Chaque semaine selon les jours cochés" : "Every week on selected weekdays";
    if (scheduleType === "monthly_intensive") return fr ? "Session intensive répétée chaque mois" : "Intensive session repeated monthly";
    if (scheduleType === "custom") return `${customDates.filter(Boolean).length} ${fr ? "date(s) personnalisée(s)" : "custom date(s)"}`;
    return fr ? "Une seule séance" : "One session";
  }, [customDates, fr, scheduleType]);

  function nextStep() {
    setStep(steps[Math.min(currentIndex + 1, steps.length - 1)]);
    globalThis.scrollTo?.({top: 0, behavior: "smooth"});
  }

  function previousStep() {
    setStep(steps[Math.max(currentIndex - 1, 0)]);
    globalThis.scrollTo?.({top: 0, behavior: "smooth"});
  }

  function updateQuestion(id: string, updater: (question: QuestionDraft) => QuestionDraft) {
    setQuestions((current) => current.map((question) => (question.id === id ? updater(question) : question)));
  }

  return (
    <article className="rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">V2.2.4</p>
          <h2 className="mt-2 text-2xl font-black">{c.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{c.help}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {steps.map((item, index) => (
            <button
              key={item}
              type="button"
              onClick={() => setStep(item)}
              className={`rounded-full px-3 py-2 text-xs font-black ${item === step ? "bg-indigo-700 text-white" : index < currentIndex ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
            >
              {index + 1}. {c.steps[index]}
            </button>
          ))}
        </div>
      </div>

      <form ref={formRef} action={createAcademyCourseWizardAction} noValidate className="mt-6">
        <section className={step === "details" ? "space-y-5" : "hidden"}>
          <div><h3 className="text-xl font-black">{c.detailsTitle}</h3></div>
          <label className="block text-sm font-black">{c.courseTitle}<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} className={inputClass()} /></label>
          <label className="block text-sm font-black">{c.description}<textarea name="description" rows={4} className={inputClass()} /></label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm font-black">{c.month}<input name="trainingMonth" type="month" defaultValue={currentMonth} required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.deadline}<input name="deadline" type="date" defaultValue={`${currentMonth}-28`} required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.category}<input name="category" defaultValue="professional_development" className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.duration}<input name="durationMinutes" type="number" min="1" defaultValue="120" required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.passingScore}<input name="passingScore" type="number" min="0" max="100" defaultValue="70" required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.maxAttempts}<input name="maxAttempts" type="number" min="1" max="20" defaultValue="3" required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.attendance}<input name="attendanceRequiredPercent" type="number" min="0" max="100" defaultValue="80" required className={inputClass()} /></label>
          </div>
          <label className="block text-sm font-black">{c.resource}<input name="resourceUrl" type="url" placeholder="https://..." className={inputClass()} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="isRequired" type="checkbox" checked={isRequired} onChange={(event) => setIsRequired(event.target.checked)} />{c.required}</label>
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="certificateEnabled" type="checkbox" checked={certificateEnabled} onChange={(event) => setCertificateEnabled(event.target.checked)} />{c.certificate}</label>
          </div>
        </section>

        <section className={step === "schedule" ? "space-y-5" : "hidden"}>
          <div><h3 className="text-xl font-black">{c.scheduleTitle}</h3><p className="mt-1 text-sm text-slate-500">{c.scheduleHelp}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-black">{c.scheduleType}<select name="wizardScheduleType" value={scheduleType} onChange={(event) => setScheduleType(event.target.value)} className={inputClass()}><option value="single">{c.single}</option><option value="weekly">{c.weekly}</option><option value="monthly_intensive">{c.intensive}</option><option value="custom">{c.custom}</option></select></label>
            <label className="block text-sm font-black">{c.scheduleLabel}<input name="wizardScheduleLabel" value={scheduleLabel || title} onChange={(event) => setScheduleLabel(event.target.value)} required className={inputClass()} /></label>
            {scheduleType !== "custom" ? <label className="block text-sm font-black">{scheduleType === "single" ? c.sessionDate : c.startsOn}<input name="wizardStartsOn" type="date" defaultValue={`${currentMonth}-01`} required className={inputClass()} /></label> : null}
            {!["single", "custom"].includes(scheduleType) ? <label className="block text-sm font-black">{c.endsOn}<input name="wizardEndsOn" type="date" defaultValue={`${currentMonth}-28`} required className={inputClass()} /></label> : null}
            <label className="block text-sm font-black">{c.startTime}<input name="wizardStartTime" type="time" defaultValue="18:00" required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.sessionDuration}<input name="wizardSessionDurationMinutes" type="number" min="1" max="1440" defaultValue="120" required className={inputClass()} /></label>
            <label className="block text-sm font-black">{c.timezone}<select name="wizardTimezone" defaultValue="Europe/Dublin" className={inputClass()}><option>Europe/Dublin</option><option>Europe/London</option><option>Africa/Douala</option><option>Africa/Lagos</option><option>America/Chicago</option><option>America/New_York</option><option>UTC</option></select></label>
            <label className="block text-sm font-black">{c.zoom}<input name="wizardZoomJoinUrl" type="url" placeholder="https://zoom.us/j/..." className={inputClass()} /></label>
          </div>

          {scheduleType === "weekly" ? <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4"><p className="text-sm font-black text-indigo-950">{c.weekdays}</p><div className="mt-3 flex flex-wrap gap-3">{[c.monday,c.tuesday,c.wednesday,c.thursday,c.friday,c.saturday,c.sunday].map((label,index) => <label key={label} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold"><input type="checkbox" name="wizardWeekdays" value={index + 1} defaultChecked={[0,4].includes(index)} />{label}</label>)}</div></div> : null}

          {scheduleType === "monthly_intensive" ? <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-black">{c.monthlyStartDay}<input name="wizardMonthlyStartDay" type="number" min="1" max="28" defaultValue="1" className={inputClass()} /></label><label className="block text-sm font-black">{c.consecutiveDays}<input name="wizardConsecutiveDays" type="number" min="1" max="14" defaultValue="3" className={inputClass()} /></label></div> : null}

          {scheduleType === "custom" ? <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-black text-violet-950">{c.customDates}</p><button type="button" onClick={() => setCustomDates((current) => [...current, ""])} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white">{c.addDate}</button></div><div className="mt-4 space-y-3">{customDates.map((date,index) => <div key={`${index}-${date}`} className="flex gap-2"><input name="wizardCustomDates" type="date" value={date} onChange={(event) => setCustomDates((current) => current.map((item,itemIndex) => itemIndex === index ? event.target.value : item))} required className={`${inputClass()} mt-0`} /><button type="button" disabled={customDates.length === 1} onClick={() => setCustomDates((current) => current.filter((_,itemIndex) => itemIndex !== index))} className="rounded-xl border border-red-200 bg-white px-3 text-xs font-black text-red-700 disabled:opacity-40">{c.remove}</button></div>)}</div></div> : null}
        </section>

        <section className={step === "quiz" ? "space-y-5" : "hidden"}>
          <div><h3 className="text-xl font-black">{c.quizTitle}</h3><p className="mt-1 text-sm text-slate-500">{c.quizHelp}</p></div>
          <div className="space-y-4">
            {questions.map((question, questionIndex) => (
              <div key={question.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between gap-3"><p className="font-black">{c.question} {questionIndex + 1}</p><button type="button" disabled={questions.length === 1} onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-40">{c.remove}</button></div>
                <textarea name="wizardQuestionText" value={question.question} onChange={(event) => updateQuestion(question.id,(item) => ({...item, question: event.target.value}))} rows={3} required={certificateEnabled} className={inputClass()} />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">{question.options.map((option,optionIndex) => <label key={optionIndex} className="block text-sm font-black">{c.option} {optionIndex + 1}<input name={`wizardOption${optionIndex + 1}`} value={option} onChange={(event) => updateQuestion(question.id,(item) => {const options = [...item.options] as QuestionDraft["options"]; options[optionIndex] = event.target.value; return {...item, options};})} required={certificateEnabled && optionIndex < 2} className={inputClass()} /></label>)}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block text-sm font-black">{c.correct}<select name="wizardCorrectOption" value={question.correct} onChange={(event) => updateQuestion(question.id,(item) => ({...item, correct: event.target.value}))} className={inputClass()}>{[0,1,2,3].map((index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}</option>)}</select></label><label className="block text-sm font-black">{c.points}<input name="wizardPoints" type="number" min="0.1" step="0.1" value={question.points} onChange={(event) => updateQuestion(question.id,(item) => ({...item, points: event.target.value}))} className={inputClass()} /></label></div>
              </div>
            ))}
          </div>
          {!questions.length ? <p className="rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-800">{c.noQuestion}</p> : null}
          <button type="button" onClick={() => setQuestions((current) => [...current, freshQuestion()])} className="w-full rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-3 font-black text-indigo-800">{c.addQuestion}</button>
        </section>

        <section className={step === "participants" ? "space-y-5" : "hidden"}>
          <div><h3 className="text-xl font-black">{c.participantsTitle}</h3><p className="mt-1 text-sm text-slate-500">{c.participantsHelp}</p></div>
          <label className="block text-sm font-black">{c.assignmentScope}<select name="wizardAssignmentScope" value={assignmentScope} onChange={(event) => setAssignmentScope(event.target.value)} className={inputClass()}><option value="none">{c.none}</option><option value="organization">{c.organization}</option><option value="teams">{c.teamScope}</option><option value="selected">{c.selectedScope}</option></select></label>
          {assignmentScope === "teams" ? <div className="rounded-2xl border border-slate-200 p-4"><p className="font-black">{c.teams}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{teams.map((team) => <label key={team.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm"><input type="checkbox" name="wizardTeamIds" value={team.id} /><span><strong>{team.name}</strong><br /><span className="text-xs text-slate-500">{team.department} · {team.memberCount}</span></span></label>)}</div></div> : null}
          {assignmentScope === "selected" ? <div className="rounded-2xl border border-slate-200 p-4"><p className="font-black">{c.people}</p><div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{participants.map((participant) => <label key={participant.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold"><input type="checkbox" name="wizardUserIds" value={participant.id} />{participant.label}</label>)}</div></div> : null}
        </section>

        <section className={step === "review" ? "space-y-5" : "hidden"}>
          <div><h3 className="text-xl font-black">{c.reviewTitle}</h3><p className="mt-1 text-sm text-slate-500">{c.reviewHelp}</p></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-950 p-5 text-white"><p className="text-xs font-black uppercase tracking-wider text-amber-400">{c.summaryCourse}</p><p className="mt-2 text-xl font-black">{title || "—"}</p><p className="mt-2 text-sm text-slate-300">{isRequired ? c.requiredYes : c.optional} · {certificateEnabled ? c.certificateYes : c.certificateNo}</p></div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><p className="text-xs font-black uppercase tracking-wider text-violet-700">{c.summarySchedule}</p><p className="mt-2 font-black">{scheduleSummary}</p></div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-black uppercase tracking-wider text-emerald-700">{c.summaryQuiz}</p><p className="mt-2 font-black">{questions.filter((question) => question.question.trim()).length} {c.questionCount}</p></div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-black uppercase tracking-wider text-indigo-700">{c.summaryParticipants}</p><p className="mt-2 font-black">{assignmentScope === "organization" ? c.organization : assignmentScope === "teams" ? c.teamScope : assignmentScope === "selected" ? c.selectedScope : c.none}</p></div>
          </div>
          <label className="block text-sm font-black">{c.publication}<select name="wizardPublishMode" value={publishMode} onChange={(event) => setPublishMode(event.target.value)} className={inputClass()}><option value="draft">{c.draft}</option><option value="publish">{c.publish}</option></select></label>
          <button className="w-full rounded-xl bg-emerald-600 px-5 py-4 text-lg font-black text-white">{publishMode === "publish" ? c.createPublish : c.createDraft}</button>
        </section>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button type="button" onClick={previousStep} disabled={currentIndex === 0} className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-700 disabled:opacity-40">{c.back}</button>
          {currentIndex < steps.length - 1 ? <button type="button" onClick={nextStep} className="rounded-xl bg-indigo-700 px-6 py-3 font-black text-white">{c.next}</button> : null}
        </div>
      </form>
    </article>
  );
}
