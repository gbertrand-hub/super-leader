import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {addQuizQuestionAction,archiveQuizQuestionAction,syncAssessmentStudentsAction,updateQuizQuestionAction} from "@/app/actions/academy-quiz";
import {PersistentForm} from "@/components/forms/persistent-form";
import {academyGlobalRoles,getAcademyAssignments,hasAssignmentRole} from "@/lib/academy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props={params:Promise<{assessmentId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>};
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]??"":v??"";
const input="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const types=[
 ["single_choice","Choix unique"],["multiple_choice","Choix multiples"],["true_false","Vrai ou faux"],["short_answer","Réponse courte"],["long_answer","Réponse longue"],
];
const typeLabel=(s:string)=>types.find(([value])=>value===s)?.[1]??s;

export default async function QuizBuilder({params,searchParams}:Props){
 const{assessmentId}=await params,q=(await searchParams)??{},success=first(q.success),error=first(q.error),s=await createClient(),{data:auth}=await s.auth.getUser();
 if(!auth.user)redirect("/login");
 const a=createAdminClient(),{data:m}=await a.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
 if(!m)notFound();
 const{data:item}=await a.from("academy_assessments").select("id,school_id,title,status,assessment_type,max_score,passing_score").eq("id",assessmentId).eq("organization_id",m.organization_id).maybeSingle<any>(),assignments=await getAcademyAssignments(a,m.organization_id,auth.user.id);
 if(!item||item.assessment_type!=="quiz"||!(academyGlobalRoles.has(m.role)||hasAssignmentRole(assignments,String(item.school_id),["director","academic_coordinator","instructor"])))notFound();
 const[{data:questions},{data:results},{count:attemptCount}]=await Promise.all([
  a.from("academy_assessment_quiz_questions").select("id,prompt,question_type,points,position,required,accepted_answers,explanation,is_active").eq("assessment_id",assessmentId).eq("organization_id",m.organization_id).order("position"),
  a.from("academy_assessment_results").select("id,enrollment_id,academy_school_enrollments(user_id)").eq("assessment_id",assessmentId),
  a.from("academy_assessment_quiz_attempts").select("id",{count:"exact",head:true}).eq("assessment_id",assessmentId),
 ]),questionIds=(questions??[]).map(x=>String(x.id)),{data:options}=questionIds.length?await a.from("academy_assessment_quiz_options").select("id,question_id,option_text,is_correct,position").in("question_id",questionIds).order("position"):{data:[]},active=(questions??[]).filter(x=>x.is_active),total=active.reduce((n,x)=>n+Number(x.points),0),linked=(results??[]).filter((x:any)=>{const e=Array.isArray(x.academy_school_enrollments)?x.academy_school_enrollments[0]:x.academy_school_enrollments;return Boolean(e?.user_id)}).length,locked=(attemptCount??0)>0;

 return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-6xl">
  <Link href="/dashboard/academy/assessments" className="font-black text-violet-700">← Évaluations</Link>
  <header className="mt-5 rounded-3xl bg-slate-950 p-8 text-white"><p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">Constructeur de quiz</p><h1 className="mt-2 text-3xl font-black">{String(item.title)}</h1><p className="mt-2 text-slate-300">{active.length} question(s) · {total} points configurés · seuil {String(item.passing_score)}/{String(item.max_score)}</p></header>
  {success?<p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">{success}</p>:null}
  {error?<p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">{error}</p>:null}
  {locked?<p className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 font-bold text-amber-900">La modification des questions est verrouillée, car au moins un étudiant a commencé le quiz. Cela protège les réponses et les notes déjà enregistrées.</p>:null}
  <section className="mt-6 grid gap-4 sm:grid-cols-3"><Card n={results?.length??0} label="Étudiants attribués"/><Card n={linked} label="Comptes prêts pour le quiz"/><Card n={total} label="Points du questionnaire"/></section>
  <form action={syncAssessmentStudentsAction} className="mt-5 rounded-2xl border bg-white p-5"><input type="hidden" name="assessment_id" value={assessmentId}/><input type="hidden" name="return_to" value={`/dashboard/academy/assessments/${assessmentId}/quiz-builder`}/><button className="rounded-xl bg-amber-400 px-5 py-3 font-black">Synchroniser les étudiants inscrits</button><p className="mt-2 text-xs text-slate-500">Ajoute uniquement les inscriptions absentes, sans créer de doublon.</p></form>
  {!locked?<details open className="mt-6 rounded-3xl border bg-white p-6"><summary className="cursor-pointer text-xl font-black">Ajouter une question</summary><PersistentForm action={addQuizQuestionAction} draftKey={`academy:quiz:${assessmentId}:new-question`} clearDraft={success==="Question ajoutée."} className="mt-5 grid gap-4 md:grid-cols-2"><input type="hidden" name="assessment_id" value={assessmentId}/><QuestionFields/><button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Ajouter la question</button></PersistentForm></details>:null}
  <section className="mt-7 space-y-4"><h2 className="text-2xl font-black">Questions du quiz</h2>{active.map((question,i)=>{
   const opts=(options??[]).filter(x=>String(x.question_id)===String(question.id)),accepted=Array.isArray(question.accepted_answers)?question.accepted_answers.map(String):[],optionLines=question.question_type==="short_answer"?accepted.join("\n"):opts.map(o=>`${o.is_correct?"*":""}${String(o.option_text)}`).join("\n"),trueAnswer=opts.find(o=>o.is_correct)?.option_text==="Faux"?"false":"true";
   return <article key={String(question.id)} className="rounded-3xl border bg-white p-6"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-black uppercase text-violet-700">Question {i+1} · {typeLabel(String(question.question_type))} · {String(question.points)} point(s)</p><h3 className="mt-2 text-lg font-black">{String(question.prompt)}</h3></div>{!locked?<form action={archiveQuizQuestionAction}><input type="hidden" name="assessment_id" value={assessmentId}/><input type="hidden" name="question_id" value={String(question.id)}/><button className="rounded-xl border px-3 py-2 text-sm font-black text-red-700">Archiver</button></form>:null}</div>
    {opts.length?<div className="mt-4 space-y-2">{opts.map(o=><p key={String(o.id)} className={`rounded-xl border p-3 text-sm ${o.is_correct?"border-emerald-300 bg-emerald-50 font-bold":"bg-slate-50"}`}>{o.is_correct?"✓ ":"○ "}{String(o.option_text)}</p>)}</div>:null}
    {question.question_type==="short_answer"?<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm"><b>Réponses acceptées :</b> {accepted.join(" · ")}</p>:null}
    {question.question_type==="long_answer"?<p className="mt-4 text-sm text-amber-700">Correction manuelle requise.</p>:null}
    {!locked?<details className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><summary className="cursor-pointer font-black text-violet-800">Modifier cette question</summary><PersistentForm action={updateQuizQuestionAction} draftKey={`academy:quiz:${assessmentId}:question:${String(question.id)}`} clearDraft={success==="Question modifiée."} className="mt-4 grid gap-4 md:grid-cols-2"><input type="hidden" name="assessment_id" value={assessmentId}/><input type="hidden" name="question_id" value={String(question.id)}/><QuestionFields question={question} optionLines={optionLines} trueAnswer={trueAnswer}/><button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Enregistrer les modifications</button></PersistentForm></details>:null}
   </article>
  })}{!active.length?<p className="rounded-2xl border border-dashed bg-white p-8 text-center text-slate-500">Ajoutez la première question du quiz.</p>:null}</section>
 </div></main>
}

function QuestionFields({question,optionLines="",trueAnswer="true"}:{question?:any;optionLines?:string;trueAnswer?:string}){return <>
 <Label t="Question"><textarea name="prompt" rows={3} required defaultValue={String(question?.prompt??"")} className={input}/></Label>
 <Label t="Type"><select name="question_type" defaultValue={String(question?.question_type??"single_choice")} className={input}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Label>
 <Label t="Points"><input name="points" type="number" min="0.1" step="0.1" defaultValue={String(question?.points??1)} required className={input}/></Label>
 <Label t="Réponse Vrai/Faux"><select name="true_false_answer" defaultValue={trueAnswer} className={input}><option value="true">Vrai</option><option value="false">Faux</option></select></Label>
 <Label t="Choix ou réponses acceptées, une ligne par réponse"><textarea name="options" rows={5} defaultValue={optionLines} placeholder={"Paris\n*Yaoundé\nDouala\n\nPlacez * devant chaque bonne réponse."} className={input}/></Label>
 <Label t="Explication affichable après correction"><textarea name="explanation" rows={5} defaultValue={String(question?.explanation??"")} className={input}/></Label>
 <label className="flex items-center gap-2 font-bold"><input type="checkbox" name="required" defaultChecked={question?Boolean(question.required):true}/> Question obligatoire</label>
 </>}
function Label({t,children}:{t:string;children:React.ReactNode}){return <label className="text-sm font-bold text-slate-700">{t}{children}</label>}
function Card({n,label}:{n:number;label:string}){return <div className="rounded-2xl border bg-white p-5"><p className="text-3xl font-black">{n}</p><p className="text-sm text-slate-500">{label}</p></div>}
