import Link from "next/link";
import { redirect } from "next/navigation";
import {updateJourneyCorrectionAction} from "@/app/actions/academy-journey-corrections";
import { canViewFinance, getAcademyAssignments } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Tone = "done" | "attention" | "missing" | "na";
type Step = {key:string; short:string; label:string; tone:Tone; detail:string};
type CorrectionTracking = {id:string;issue_key:string;status:"open"|"resolved";resolution_note:string|null;resolved_by:string|null;resolved_at:string|null;actorName?:string};
type Correction = {key:string; issueKey:string; enrollmentId:string; school:string; step:Step; owner:string; action:string; href:string;tracking?:CorrectionTracking};
type Journey = {
  enrollmentId:string; studentKey:string; clientId:string|null; name:string; email:string;
  school:string; program:string; cohort:string; saleId:string|null;
  steps:Step[]; done:number; issues:number;
};
type PersonJourney = {
  key:string; name:string; email:string; clientId:string|null; studentKey:string;
  enrollments:Journey[]; access:Step; issues:number; hasMissing:boolean;
};

const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]??"":value??"";
const n=(value:unknown)=>Number(value??0)||0;
const clean=(value:unknown)=>String(value??"").trim();
const visibleStatuses=new Set(["candidate","admitted","enrolled","active","suspended"]);
const excludedSales=new Set(["rejected","cancelled","refunded"]);
const money=(value:number,currency:string)=>{
  try{return new Intl.NumberFormat("fr-CA",{style:"currency",currency,maximumFractionDigits:2}).format(value)}
  catch{return `${value.toFixed(2)} ${currency}`}
};
const correctionMeta:Record<string,{owner:string;action:string}>={
  sale:{owner:"Responsable commercial / CRM",action:"Vérifier la vente, le produit vendu et son rattachement à cette école."},
  payment:{owner:"Finance · Contrôle des encaissements",action:"Contrôler puis confirmer le paiement rattaché à la vente."},
  receipt:{owner:"Finance · Comptabilité",action:"Générer le reçu du paiement confirmé et le rendre disponible."},
  finance:{owner:"Responsable Tarification & homologation",action:"Configurer ou homologuer les conditions financières de cette inscription."},
  schedule:{owner:"Responsable Recouvrement",action:"Créer ou corriger l’échéancier correspondant au solde restant."},
  enrollment:{owner:"Administration académique",action:"Compléter le programme et la cohorte de l’inscription."},
  followup:{owner:"Responsable académique",action:"Affecter un responsable de suivi à l’étudiant."},
  access:{owner:"Administrateur Super Leader",action:"Relier le dossier à un compte utilisateur et vérifier son accès à la classe."},
};

function correctionHref(stepKey:string,journey:Journey|undefined,person:PersonJourney,organizationId:string){
  const finance=`/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(person.studentKey)}`;
  const academy=`/dashboard/academy/students?organization=${organizationId}&q=${encodeURIComponent(person.name)}`;
  const crm=person.clientId?`/dashboard/crm/${person.clientId}`:academy;
  if(stepKey==="finance")return finance;
  if(["payment","receipt","schedule"].includes(stepKey))return journey?.saleId?`/dashboard/collections?sale=${journey.saleId}`:crm;
  if(["enrollment","followup"].includes(stepKey))return academy;
  if(stepKey==="access")return `/dashboard/crm/identity-sync?q=${encodeURIComponent(person.email||person.name)}`;
  return crm;
}

export default async function AcademyJourneyControlPage({searchParams}:Props){
  const query=(await searchParams)??{};
  const term=first(query.q).trim();
  const selectedSchool=first(query.school);
  const selectedState=first(query.state)||"issues";
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const admin=createAdminClient();
  const {data:memberships}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true);
  const requestedOrganization=first(query.organization);
  const membership=((memberships??[])as Array<{organization_id:string;role:string}>).find(x=>x.organization_id===requestedOrganization)??((memberships??[])[0] as {organization_id:string;role:string}|undefined);
  if(!membership)redirect("/dashboard/company");
  const organizationId=membership.organization_id;
  const assignments=await getAcademyAssignments(admin,organizationId,auth.user.id);
  const {data:schoolRows,error:schoolError}=await admin.from("academy_schools").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name");
  if(schoolError)throw new Error(schoolError.message);
  const schools=(schoolRows??[]).filter(s=>canViewFinance(membership.role,assignments,String(s.id)));
  const allowedSchoolIds=schools.map(s=>String(s.id));
  if(!allowedSchoolIds.length)redirect(`/dashboard/academy?organization=${organizationId}`);

  let matchingCrmIds:string[]=[];
  let matchingUserIds:string[]=[];
  if(term){
    const pattern=`%${term.replace(/[%_]/g,"\\$&")}%`;
    const [{data:crmMatches,error:crmMatchError},{data:profileMatches,error:profileMatchError}]=await Promise.all([
      admin.from("crm_clients").select("id").eq("organization_id",organizationId).or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`).limit(100),
      admin.from("profiles").select("id").or(`full_name.ilike.${pattern},email.ilike.${pattern}`).limit(100),
    ]);
    if(crmMatchError)throw new Error(crmMatchError.message);
    if(profileMatchError)throw new Error(profileMatchError.message);
    matchingCrmIds=(crmMatches??[]).map(x=>String(x.id));
    matchingUserIds=(profileMatches??[]).map(x=>String(x.id));
  }

  let enrollmentQuery=admin.from("academy_school_enrollments")
    .select("id,school_id,program_id,cohort_id,user_id,crm_client_id,academic_status,assigned_follow_up_user_id,source,source_reference,enrolled_on,created_at")
    .eq("organization_id",organizationId)
    .in("school_id",selectedSchool&&allowedSchoolIds.includes(selectedSchool)?[selectedSchool]:allowedSchoolIds)
    .in("academic_status",[...visibleStatuses])
    .order("created_at",{ascending:false})
    .limit(250);
  if(term){
    const clauses=[];
    if(matchingCrmIds.length)clauses.push(`crm_client_id.in.(${matchingCrmIds.join(",")})`);
    if(matchingUserIds.length)clauses.push(`user_id.in.(${matchingUserIds.join(",")})`);
    if(!clauses.length)return <EmptySearch organizationId={organizationId} schools={schools} term={term}/>;
    enrollmentQuery=enrollmentQuery.or(clauses.join(","));
  }
  const {data:enrollmentRows,error:enrollmentError}=await enrollmentQuery;
  if(enrollmentError)throw new Error(enrollmentError.message);
  const enrollments=(enrollmentRows??[]) as Array<Record<string,unknown>>;
  const crmIds=[...new Set(enrollments.map(x=>clean(x.crm_client_id)).filter(Boolean))];
  const userIds=[...new Set(enrollments.map(x=>clean(x.user_id)).filter(Boolean))];
  const enrollmentIds=enrollments.map(x=>clean(x.id));
  const programIds=[...new Set(enrollments.map(x=>clean(x.program_id)).filter(Boolean))];
  const cohortIds=[...new Set(enrollments.map(x=>clean(x.cohort_id)).filter(Boolean))];

  const [crmResult,profileResult,programResult,cohortResult,financeResult,agreementResult,allocationResult,mappingResult,salesResult]=await Promise.all([
    crmIds.length?admin.from("crm_clients").select("id,full_name,email,phone").eq("organization_id",organizationId).in("id",crmIds):Promise.resolve({data:[],error:null}),
    userIds.length?admin.from("profiles").select("id,full_name,email").in("id",userIds):Promise.resolve({data:[],error:null}),
    programIds.length?admin.from("academy_programs").select("id,name").in("id",programIds):Promise.resolve({data:[],error:null}),
    cohortIds.length?admin.from("academy_cohorts").select("id,name").in("id",cohortIds):Promise.resolve({data:[],error:null}),
    enrollmentIds.length?admin.from("academy_student_finance").select("enrollment_id,agreed_amount,currency,payment_status,current_agreement_id,is_internal_training").eq("organization_id",organizationId).in("enrollment_id",enrollmentIds):Promise.resolve({data:[],error:null}),
    enrollmentIds.length?admin.from("academy_student_financial_agreements").select("id,enrollment_id,status,agreed_amount,currency").eq("organization_id",organizationId).in("enrollment_id",enrollmentIds).in("status",["active","pending_approval"]):Promise.resolve({data:[],error:null}),
    enrollmentIds.length?admin.from("academy_student_confirmed_allocations").select("enrollment_id,amount,currency").eq("organization_id",organizationId).in("enrollment_id",enrollmentIds):Promise.resolve({data:[],error:null}),
    admin.from("academy_sales_product_mappings").select("product_id,school_id,program_id,cohort_id").eq("organization_id",organizationId).eq("is_active",true),
    crmIds.length?admin.from("sales_records").select("id,crm_client_id,product_id,product_name,total_amount,paid_amount,balance_amount,currency,workflow_status,payment_status,sale_date").eq("organization_id",organizationId).in("crm_client_id",crmIds).order("sale_date",{ascending:false}).limit(1000):Promise.resolve({data:[],error:null}),
  ]);
  for(const result of [crmResult,profileResult,programResult,cohortResult,financeResult,agreementResult,allocationResult,mappingResult,salesResult])if(result.error)throw new Error(result.error.message);

  const sales=(salesResult.data??[]) as Array<Record<string,unknown>>;
  const saleIds=sales.map(x=>clean(x.id));
  const [paymentResult,documentResult,scheduleResult]=await Promise.all([
    saleIds.length?admin.from("sales_payments").select("sale_id,amount,status").eq("organization_id",organizationId).in("sale_id",saleIds):Promise.resolve({data:[],error:null}),
    saleIds.length?admin.from("finance_documents").select("sale_id,document_type,status").eq("organization_id",organizationId).in("sale_id",saleIds).eq("document_type","receipt"):Promise.resolve({data:[],error:null}),
    saleIds.length?admin.from("sales_payment_schedule").select("sale_id,status,due_date,expected_amount,paid_amount").eq("organization_id",organizationId).in("sale_id",saleIds):Promise.resolve({data:[],error:null}),
  ]);
  for(const result of [paymentResult,documentResult,scheduleResult])if(result.error)throw new Error(result.error.message);

  const schoolBy=new Map(schools.map(x=>[String(x.id),String(x.name)]));
  const programBy=new Map((programResult.data??[]).map(x=>[String(x.id),String(x.name)]));
  const cohortBy=new Map((cohortResult.data??[]).map(x=>[String(x.id),String(x.name)]));
  const crmBy=new Map((crmResult.data??[]).map(x=>[String(x.id),x]));
  const profileBy=new Map((profileResult.data??[]).map(x=>[String(x.id),x]));
  const financeBy=new Map((financeResult.data??[]).map(x=>[String(x.enrollment_id),x]));
  const agreementsBy=new Map<string,Array<Record<string,unknown>>>();
  for(const row of agreementResult.data??[]){const id=String(row.enrollment_id);agreementsBy.set(id,[...(agreementsBy.get(id)??[]),row as Record<string,unknown>])}
  const paidByEnrollment=new Map<string,number>();
  for(const row of allocationResult.data??[]){const id=String(row.enrollment_id);paidByEnrollment.set(id,(paidByEnrollment.get(id)??0)+n(row.amount))}
  const mappingByProduct=new Map((mappingResult.data??[]).map(x=>[String(x.product_id),x]));
  const confirmedBySale=new Map<string,number>(),pendingBySale=new Set<string>(),receiptsBySale=new Set<string>(),schedulesBySale=new Set<string>();
  for(const row of paymentResult.data??[]){const id=String(row.sale_id);if(row.status==="confirmed")confirmedBySale.set(id,(confirmedBySale.get(id)??0)+n(row.amount));if(row.status==="pending")pendingBySale.add(id)}
  for(const row of documentResult.data??[])if(!["cancelled","archived"].includes(String(row.status)))receiptsBySale.add(String(row.sale_id));
  for(const row of scheduleResult.data??[])if(!["paid","cancelled"].includes(String(row.status)))schedulesBySale.add(String(row.sale_id));

  const saleFor=(enrollment:Record<string,unknown>)=>sales.find(sale=>{
    if(clean(sale.crm_client_id)!==clean(enrollment.crm_client_id)||excludedSales.has(clean(sale.workflow_status)))return false;
    const mapping=mappingByProduct.get(clean(sale.product_id));
    if(!mapping)return false;
    if(clean(mapping.school_id)!==clean(enrollment.school_id))return false;
    if(mapping.program_id&&clean(mapping.program_id)!==clean(enrollment.program_id))return false;
    if(mapping.cohort_id&&clean(mapping.cohort_id)!==clean(enrollment.cohort_id))return false;
    return true;
  })??null;

  const journeys:Journey[]=enrollments.map(enrollment=>{
    const id=clean(enrollment.id),clientId=clean(enrollment.crm_client_id)||null,userId=clean(enrollment.user_id)||null;
    const person=clientId?crmBy.get(clientId):userId?profileBy.get(userId):null;
    const finance=financeBy.get(id) as Record<string,unknown>|undefined;
    const agreements=agreementsBy.get(id)??[];
    const activeAgreement=agreements.find(x=>x.status==="active");
    const pendingAgreement=agreements.find(x=>x.status==="pending_approval");
    const agreed=n(finance?.agreed_amount),currency=clean(finance?.currency)||"USD";
    const academyPaid=paidByEnrollment.get(id)??0;
    const sale=saleFor(enrollment),saleId=sale?clean(sale.id):null;
    const confirmed=saleId?confirmedBySale.get(saleId)??0:academyPaid;
    const balance=Math.max(0,agreed-Math.max(academyPaid,confirmed));
    const isFree=Boolean(finance)&&(agreed===0)&&(Boolean(activeAgreement)||Boolean(finance?.is_internal_training));
    const hasScope=Boolean(enrollment.program_id&&enrollment.cohort_id);
    const steps:Step[]=[
      {key:"sale",short:"Vente",label:"Vente enregistrée",tone:sale?clean(sale.workflow_status)==="approved"?"done":"attention":isFree?"na":"missing",detail:sale?`${clean(sale.id).slice(0,8).toUpperCase()} · ${clean(sale.product_name)}`:isFree?"École offerte sans vente":"Aucune vente reliée à cette inscription"},
      {key:"payment",short:"Paiement",label:"Paiement contrôlé",tone:isFree?"na":confirmed>0?"done":saleId&&pendingBySale.has(saleId)?"attention":"missing",detail:isFree?"Gratuité autorisée":confirmed>0?`${money(confirmed,currency)} confirmé(s)`:saleId&&pendingBySale.has(saleId)?"En attente du contrôle Finance":"Aucun paiement confirmé"},
      {key:"receipt",short:"Reçu",label:"Reçu disponible",tone:isFree?"na":saleId&&receiptsBySale.has(saleId)?"done":confirmed>0?"attention":"missing",detail:isFree?"Sans encaissement":saleId&&receiptsBySale.has(saleId)?"Reçu financier généré":confirmed>0?"Paiement confirmé, reçu à produire":"En attente du paiement"},
      {key:"finance",short:"Conditions",label:"Conditions financières",tone:activeAgreement?"done":pendingAgreement?"attention":"missing",detail:activeAgreement?`${money(agreed,currency)} convenus · solde ${money(balance,currency)}`:pendingAgreement?"Accord en attente d’homologation":"Accord financier non configuré"},
      {key:"schedule",short:"Échéancier",label:"Échéancier du solde",tone:isFree||balance<=0?"na":saleId&&schedulesBySale.has(saleId)?"done":"missing",detail:isFree||balance<=0?"Aucun solde à planifier":saleId&&schedulesBySale.has(saleId)?`Solde suivi : ${money(balance,currency)}`:`Solde ${money(balance,currency)} sans échéancier`},
      {key:"enrollment",short:"Inscription",label:"Inscription académique",tone:hasScope?"done":"attention",detail:hasScope?"École, programme et cohorte définis":"Programme ou cohorte à régulariser"},
      {key:"followup",short:"Suivi",label:"Responsable de suivi",tone:enrollment.assigned_follow_up_user_id?"done":"missing",detail:enrollment.assigned_follow_up_user_id?"Responsable affecté":"Aucun responsable affecté"},
      {key:"access",short:"Accès",label:"Accès à la classe",tone:userId&&["enrolled","active"].includes(clean(enrollment.academic_status))?"done":userId?"attention":"missing",detail:userId?`Compte relié · statut ${clean(enrollment.academic_status)}`:"Aucun compte utilisateur relié"},
    ];
    return {enrollmentId:id,studentKey:clientId?`crm:${clientId}`:`user:${userId}`,clientId,name:clean(person?.full_name)||clean(person?.email)||"Étudiant",email:clean(person?.email),school:schoolBy.get(clean(enrollment.school_id))??"École",program:programBy.get(clean(enrollment.program_id))??"Programme non défini",cohort:cohortBy.get(clean(enrollment.cohort_id))??"Cohorte non définie",saleId,steps,done:steps.filter(x=>x.tone==="done"||x.tone==="na").length,issues:steps.filter(x=>x.tone==="missing"||x.tone==="attention").length};
  });
  const grouped=new Map<string,Journey[]>();
  for(const journey of journeys)grouped.set(journey.studentKey,[...(grouped.get(journey.studentKey)??[]),journey]);
  const people:PersonJourney[]=[...grouped.entries()].map(([key,studentEnrollments])=>{
    const firstEnrollment=studentEnrollments[0];
    const accessSteps=studentEnrollments.map(x=>x.steps.find(step=>step.key==="access")).filter((step):step is Step=>Boolean(step));
    const access=accessSteps.find(step=>step.tone==="done")??accessSteps.find(step=>step.tone==="attention")??accessSteps[0];
    const schoolSteps=studentEnrollments.flatMap(x=>x.steps.filter(step=>step.key!=="access"));
    const issues=schoolSteps.filter(step=>step.tone==="missing"||step.tone==="attention").length+(access.tone==="missing"||access.tone==="attention"?1:0);
    return {key,name:firstEnrollment.name,email:firstEnrollment.email,clientId:firstEnrollment.clientId,studentKey:firstEnrollment.studentKey,enrollments:studentEnrollments,access,issues,hasMissing:[...schoolSteps,access].some(step=>step.tone==="missing")};
  });
  const studentKeys=people.map(person=>person.studentKey);
  const {data:trackingRows,error:trackingError}=studentKeys.length?await admin.from("academy_journey_corrections").select("id,student_key,issue_key,status,resolution_note,resolved_by,resolved_at").eq("organization_id",organizationId).in("student_key",studentKeys):{data:[],error:null};
  if(trackingError)throw new Error(`Le suivi des corrections n’est pas disponible. Exécutez la migration V4.10.93 : ${trackingError.message}`);
  const actorIds=[...new Set((trackingRows??[]).map(row=>clean(row.resolved_by)).filter(Boolean))];
  const {data:actorRows,error:actorError}=actorIds.length?await admin.from("profiles").select("id,full_name,email").in("id",actorIds):{data:[],error:null};
  if(actorError)throw new Error(actorError.message);
  const actorBy=new Map((actorRows??[]).map(row=>[String(row.id),clean(row.full_name)||clean(row.email)||"Collaborateur"]));
  const trackingByStudent=new Map<string,CorrectionTracking[]>();
  for(const raw of trackingRows??[]){const row=raw as CorrectionTracking&{student_key:string};const tracking={...row,actorName:row.resolved_by?actorBy.get(row.resolved_by):undefined};trackingByStudent.set(row.student_key,[...(trackingByStudent.get(row.student_key)??[]),tracking]);}
  const filtered=people.filter(person=>selectedState==="complete"?person.issues===0:selectedState==="all"?true:person.issues>0);
  const complete=people.filter(x=>x.issues===0).length;
  const critical=people.filter(x=>x.hasMissing).length;
  const awaiting=people.filter(x=>!x.hasMissing&&x.issues>0).length;

  const returnParams=new URLSearchParams({organization:organizationId,state:selectedState});if(term)returnParams.set("q",term);if(selectedSchool)returnParams.set("school",selectedSchool);const returnTo=`/dashboard/academy/journey-control?${returnParams.toString()}`;
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/dashboard/academy/students?organization=${organizationId}`} className="font-black text-violet-700">← Étudiants</Link><span className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm">Lecture seule · données existantes préservées</span></div>
    <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 p-8 text-white shadow-xl"><p className="text-xs font-black uppercase tracking-[.22em] text-amber-400">Super Leader · Contrôle transversal</p><h1 className="mt-2 text-4xl font-black">Parcours étudiant de bout en bout</h1><p className="mt-3 max-w-4xl text-slate-300">Une seule vue pour détecter où un dossier est bloqué entre la vente, la Finance, le Recouvrement, l’Académie et l’accès à la classe.</p></header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="Étudiants contrôlés" value={people.length} tone="slate"/><Kpi label="Parcours complets" value={complete} tone="emerald"/><Kpi label="Actions requises" value={critical} tone="red"/><Kpi label="À vérifier" value={awaiting} tone="amber"/></section>
    <form className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm lg:grid-cols-[minmax(240px,1fr)_260px_220px_auto]"><input type="hidden" name="organization" value={organizationId}/><input name="q" defaultValue={term} placeholder="Nom, e-mail ou téléphone…" className="rounded-xl border border-slate-300 px-4 py-3"/><select name="school" defaultValue={selectedSchool} className="rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="">Toutes les écoles</option>{schools.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select><select name="state" defaultValue={selectedState} className="rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="issues">À corriger ou vérifier</option><option value="complete">Parcours complets</option><option value="all">Tous les dossiers</option></select><button className="rounded-xl bg-slate-950 px-6 py-3 font-black text-white">Filtrer</button></form>
    {first(query.success)?<p className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">{first(query.success)}</p>:null}{first(query.error)?<p className="rounded-xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">{first(query.error)}</p>:null}
    <section className="space-y-5">{filtered.length?filtered.map(person=><PersonJourneyCard key={person.key} person={person} organizationId={organizationId} tracking={trackingByStudent.get(person.studentKey)??[]} returnTo={returnTo}/>):<div className="rounded-3xl border border-dashed bg-white p-12 text-center"><h2 className="text-2xl font-black">Aucun dossier dans cette vue</h2><p className="mt-2 text-slate-500">Modifiez les filtres ou recherchez un autre étudiant.</p></div>}</section>
    {enrollments.length>=250?<p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">250 inscriptions ont été analysées. Utilisez la recherche par nom, e-mail ou téléphone pour cibler immédiatement un dossier au-delà de cette limite.</p>:null}
  </div></main>;
}

function Kpi({label,value,tone}:{label:string;value:number;tone:"slate"|"emerald"|"red"|"amber"}){const colors={slate:"border-slate-200 bg-white text-slate-950",emerald:"border-emerald-200 bg-emerald-50 text-emerald-950",red:"border-red-200 bg-red-50 text-red-950",amber:"border-amber-200 bg-amber-50 text-amber-950"};return <div className={`rounded-2xl border p-5 shadow-sm ${colors[tone]}`}><p className="text-4xl font-black">{value}</p><p className="mt-1 text-sm font-bold">{label}</p></div>}
function Status({step}:{step:Step}){const style={done:"border-emerald-200 bg-emerald-50 text-emerald-900",attention:"border-amber-300 bg-amber-50 text-amber-950",missing:"border-red-200 bg-red-50 text-red-950",na:"border-slate-200 bg-slate-100 text-slate-600"};const icon={done:"✓",attention:"!",missing:"×",na:"—"};return <div title={step.label} className={`min-w-0 rounded-xl border p-3 ${style[step.tone]}`}><div className="flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-black shadow-sm">{icon[step.tone]}</span><p className="truncate text-xs font-black uppercase tracking-wide">{step.short}</p></div><p className="mt-2 text-xs leading-5">{step.detail}</p></div>}
function PersonJourneyCard({person,organizationId,tracking,returnTo}:{person:PersonJourney;organizationId:string;tracking:CorrectionTracking[];returnTo:string}){
  const trackingByIssue=new Map(tracking.map(item=>[item.issue_key,item]));
  const corrections:Correction[]=[];
  for(const journey of person.enrollments)for(const step of journey.steps.filter(step=>step.key!=="access"&&["missing","attention"].includes(step.tone))){
    const meta=correctionMeta[step.key];
    const issueKey=`${journey.enrollmentId}:${step.key}`;
    corrections.push({key:issueKey,issueKey,enrollmentId:journey.enrollmentId,school:journey.school,step,owner:meta.owner,action:meta.action,href:correctionHref(step.key,journey,person,organizationId),tracking:trackingByIssue.get(issueKey)});
  }
  if(["missing","attention"].includes(person.access.tone)){
    const meta=correctionMeta.access;
    const issueKey="global:access";
    corrections.unshift({key:issueKey,issueKey,enrollmentId:"",school:"Accès global",step:person.access,owner:meta.owner,action:meta.action,href:correctionHref("access",undefined,person,organizationId),tracking:trackingByIssue.get(issueKey)});
  }
  return <article className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${person.issues?"border-amber-300":"border-emerald-300"}`}>
    <div className="bg-slate-950 p-5 text-white"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-black">{person.name}</h2><span className="rounded-full bg-violet-500 px-3 py-1 text-xs font-black">{person.enrollments.length} école(s)</span><span className={`rounded-full px-3 py-1 text-xs font-black ${person.issues?"bg-amber-300 text-amber-950":"bg-emerald-300 text-emerald-950"}`}>{person.issues?`${person.issues} action(s) au total`:"Parcours complet"}</span></div><p className="mt-1 text-sm text-slate-300">{person.email||"Sans e-mail"}</p></div><div className="flex flex-wrap gap-2"><Link href={`/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(person.studentKey)}`} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white">Compte financier consolidé</Link>{person.clientId?<Link href={`/dashboard/crm/${person.clientId}`} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">Dossier CRM</Link>:null}</div></div>
      <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${person.access.tone==="done"?"border-emerald-700 bg-emerald-950/60":person.access.tone==="attention"?"border-amber-500 bg-amber-950/50":"border-red-700 bg-red-950/50"}`}><span className="text-xs font-black uppercase tracking-wider">Accès global</span><span className="text-sm font-bold">{person.access.detail}</span></div>
    </div>
    <div className="space-y-4 p-5">
      {corrections.length?<details className="rounded-2xl border border-violet-200 bg-violet-50" open><summary className="cursor-pointer list-none p-4 font-black text-violet-950">Plan de correction guidé · {corrections.length} action(s)</summary><div className="grid gap-3 border-t border-violet-200 p-4 lg:grid-cols-2">{corrections.map(correction=>{const resolved=correction.tracking?.status==="resolved";return <div key={correction.key} className={`rounded-xl border bg-white p-4 shadow-sm ${resolved?"border-emerald-300":"border-white"}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-black uppercase tracking-wide text-violet-700">{correction.school} · {correction.step.short}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${resolved?"bg-emerald-100 text-emerald-900":correction.step.tone==="missing"?"bg-red-100 text-red-800":"bg-amber-100 text-amber-900"}`}>{resolved?"Déclarée traitée":correction.step.tone==="missing"?"Priorité haute":"À vérifier"}</span></div><p className="mt-3 text-sm font-black text-slate-950">Qui agit : {correction.owner}</p><p className="mt-1 text-sm leading-6 text-slate-600">{correction.action}</p><p className="mt-2 text-xs font-semibold text-slate-500">Constat automatique : {correction.step.detail}</p>{resolved?<div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-950"><p className="font-black">Traitée par {correction.tracking?.actorName??"un collaborateur"}{correction.tracking?.resolved_at?` · ${new Intl.DateTimeFormat("fr-CA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(correction.tracking.resolved_at))}`:""}</p><p className="mt-1">{correction.tracking?.resolution_note}</p><p className="mt-2 font-bold text-amber-800">L’anomalie reste affichée tant que la donnée source n’est pas réellement corrigée.</p></div>:null}<div className="mt-4 flex flex-wrap gap-2"><Link href={correction.href} className="inline-flex rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white">Ouvrir la page de traitement →</Link></div><form action={updateJourneyCorrectionAction} className="mt-3 space-y-2"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={person.studentKey}/><input type="hidden" name="enrollment_id" value={correction.enrollmentId}/><input type="hidden" name="issue_key" value={correction.issueKey}/><input type="hidden" name="step_key" value={correction.step.key}/><input type="hidden" name="school_name" value={correction.school}/><input type="hidden" name="return_to" value={returnTo}/><input type="hidden" name="next_status" value={resolved?"open":"resolved"}/>{!resolved?<textarea name="resolution_note" required minLength={3} maxLength={1000} placeholder="Note obligatoire : qu’avez-vous corrigé ?" className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>:null}<button className={`rounded-lg px-4 py-2 text-xs font-black ${resolved?"border border-slate-300 bg-white text-slate-800":"bg-emerald-600 text-white"}`}>{resolved?"Rouvrir cette correction":"Marquer comme traitée"}</button></form></div>})}</div></details>:null}
      {person.enrollments.map(journey=><section key={journey.enrollmentId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black text-slate-950">{journey.school}</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${journey.steps.filter(step=>step.key!=="access").some(step=>step.tone==="missing"||step.tone==="attention")?"bg-amber-100 text-amber-900":"bg-emerald-100 text-emerald-900"}`}>{journey.steps.filter(step=>step.key!=="access"&&["missing","attention"].includes(step.tone)).length} action(s)</span></div><p className="mt-1 text-xs font-semibold text-slate-500">{journey.program} · {journey.cohort}</p></div>{journey.saleId?<Link href={`/dashboard/collections?sale=${journey.saleId}`} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-950">Recouvrement de cette école</Link>:null}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{journey.steps.filter(step=>step.key!=="access").map(step=><Status key={step.key} step={step}/>)}</div></section>)}</div>
  </article>
}
function EmptySearch({organizationId,schools,term}:{organizationId:string;schools:Array<{id:unknown;name:unknown}>;term:string}){return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-7xl space-y-6"><Link href={`/dashboard/academy/students?organization=${organizationId}`} className="font-black text-violet-700">← Étudiants</Link><header className="rounded-3xl bg-slate-950 p-8 text-white"><h1 className="text-4xl font-black">Contrôle du parcours étudiant</h1></header><form className="grid gap-3 rounded-2xl border bg-white p-4 lg:grid-cols-[1fr_260px_auto]"><input type="hidden" name="organization" value={organizationId}/><input name="q" defaultValue={term} className="rounded-xl border px-4 py-3"/><select name="school" className="rounded-xl border bg-white px-4 py-3"><option value="">Toutes les écoles</option>{schools.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select><button className="rounded-xl bg-slate-950 px-6 py-3 font-black text-white">Rechercher</button></form><div className="rounded-3xl border border-dashed bg-white p-12 text-center"><h2 className="text-2xl font-black">Aucun étudiant trouvé</h2><p className="mt-2 text-slate-500">La recherche serveur n’a trouvé aucun nom, e-mail ou téléphone correspondant à « {term} ».</p></div></div></main>}
