import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createCrmContractAction,
  createCrmInteractionAction,
  createCrmTaskAction,
  createCustomerFeedbackRequestAction,
  resolveCustomerFeedbackAction,
  sendCustomerFeedbackRequestAction,
  updateCrmClientAction,
  updateCrmTaskStatusAction,
} from "@/app/actions/crm";
import {FeedbackShareLinks} from "@/components/crm/feedback-share-links";
import {addCrmLearnerFollowupAction,updateCrmLearnerProgressAction} from "@/app/actions/crm-academy";
import {canAddFollowup,canEditTraining,getAcademyAssignments} from "@/lib/academy/access";
import {getI18n} from "@/i18n/server";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules, type OrganizationRole} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {buildFeedbackMessage} from "@/lib/crm/feedback-delivery";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{clientId: string}>;
  searchParams?: Promise<{success?: string | string[]; error?: string | string[]}>;
};

type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type ClientRow = {
  id: string;
  reference: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  country: string | null;
  city: string | null;
  company_name: string | null;
  preferred_language: "fr" | "en";
  preferred_feedback_channel: string;
  feedback_opt_in: boolean;
  marketing_opt_in: boolean;
  do_not_contact: boolean;
  owner_id: string | null;
  follow_up_owner_id: string | null;
  source: string;
  status: string;
  notes: string | null;
  created_at: string;
  linked_user_id: string | null;
};
type EnrollmentRow = {id:string;school_id:string;program_id:string|null;cohort_id:string|null;academic_status:string;enrolled_on:string;completed_on:string|null;source:string};
type AcademyNameRow = {id:string;name:string};
type StudentFinanceRow = {enrollment_id:string;agreed_amount:number|string;currency:string;payment_status:string;first_payment_due_on:string|null;is_internal_training:boolean};
type StudentPaymentRow = {enrollment_id:string;amount:number|string;currency:string};
type StudentProgressRow = {enrollment_id:string;progress_percent:number|string;current_module:string|null;training_status:string;risk_level:string;last_activity_on:string|null;next_action:string|null;next_action_on:string|null};
type StudentFollowupRow = {id:string;enrollment_id:string;employee_id:string;channel:string;outcome:string;summary:string;next_action:string|null;next_action_on:string|null;occurred_at:string};
type ContractRow = {
  id: string;
  contract_number: string;
  title: string;
  product_name: string | null;
  total_amount: number | string;
  currency: string;
  status: string;
  signed_at: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  seller_id: string | null;
  collection_owner_id: string | null;
  document_url: string | null;
  notes: string | null;
  sale_id: string | null;
  created_by: string;
};
type SaleRow = {
  id:string;
  product_name:string;
  quantity:number;
  total_amount:number|string;
  currency:string;
  payment_status:string;
  workflow_status:string;
  sale_date:string;
  crm_contract_id:string|null;
};
type InteractionRow = {
  id: string;
  contract_id: string | null;
  employee_id: string;
  channel: string;
  direction: string;
  interaction_type: string;
  outcome: string;
  summary: string;
  occurred_at: string;
  next_follow_up_at: string | null;
  feedback_requested: boolean;
};
type TaskRow = {
  id: string;
  contract_id: string | null;
  assigned_to: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  created_by: string;
};
type RequestRow = {
  id: string;
  contract_id: string | null;
  interaction_id: string | null;
  employee_id: string;
  public_token: string;
  channel: string;
  locale: "fr" | "en";
  recipient: string | null;
  message: string;
  status: string;
  sent_at: string | null;
  expires_at: string;
  delivery_error: string | null;
  created_at: string;
};
type ResponseRow = {
  id: string;
  request_id: string;
  employee_id: string;
  rating: number;
  comment: string | null;
  resolution_status: string;
  resolution_assigned_to: string | null;
  resolution_notes: string | null;
  submitted_at: string;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function money(locale: string, currency: string, amount: number | string) {
  try {
    return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: currency === "XAF" ? 0 : 2}).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

const tone: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  prospect: "bg-blue-100 text-blue-800",
  inactive: "bg-slate-100 text-slate-700",
  closed: "bg-slate-200 text-slate-700",
  preparation: "bg-slate-100 text-slate-700",
  awaiting_signature: "bg-amber-100 text-amber-800",
  payment_in_progress: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-200 text-slate-700",
  terminated: "bg-red-100 text-red-800",
  ready: "bg-amber-100 text-amber-800",
  sent: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  open: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-emerald-100 text-emerald-800",
  not_required: "bg-slate-100 text-slate-700",
  todo: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

export default async function CrmClientPage({params, searchParams}: PageProps) {
  const {clientId} = await params;
  const query = (await searchParams) ?? {};
  const success = firstValue(query.success);
  const errorMessage = firstValue(query.error);
  const {t, locale} = await getI18n();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const returnTo = `/dashboard/crm/${clientId}`;

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id, role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance");
  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const isLeader = COMMERCIAL_MANAGER_ROLES.has(membership.role as OrganizationRole);
  const isEmployee = membership.role === "employee";

  const {data: client, error: clientError} = await admin
    .from("crm_clients")
    .select("id, reference, full_name, email, phone, whatsapp_phone, country, city, company_name, preferred_language, preferred_feedback_channel, feedback_opt_in, marketing_opt_in, do_not_contact, owner_id, follow_up_owner_id, source, status, notes, created_at, linked_user_id")
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<ClientRow>();
  if (clientError || !client) redirect("/dashboard/crm?error=client-not-found");
  const canAccessClient = ["owner", "admin"].includes(membership.role)
    || (membership.role === "manager" && Boolean(
      (client.owner_id && visibleUserIds.includes(client.owner_id))
      || (client.follow_up_owner_id && visibleUserIds.includes(client.follow_up_owner_id)),
    ))
    || client.owner_id === authData.user.id
    || client.follow_up_owner_id === authData.user.id;
  if (!canAccessClient) redirect("/dashboard/crm?error=access-denied");

  let contractsQuery = admin
    .from("crm_contracts")
    .select("id, contract_number, title, product_name, total_amount, currency, status, signed_at, start_date, expected_end_date, seller_id, collection_owner_id, document_url, notes, sale_id, created_by")
    .eq("organization_id", membership.organization_id)
    .eq("client_id", clientId)
    .order("created_at", {ascending: false});
  let salesQuery = admin
    .from("sales_records")
    .select("id,product_name,quantity,total_amount,currency,payment_status,workflow_status,sale_date,crm_contract_id")
    .eq("organization_id", membership.organization_id)
    .eq("crm_client_id", clientId)
    .order("sale_date", {ascending: false});
  let interactionsQuery = admin
    .from("crm_interactions")
    .select("id, contract_id, employee_id, channel, direction, interaction_type, outcome, summary, occurred_at, next_follow_up_at, feedback_requested")
    .eq("organization_id", membership.organization_id)
    .eq("client_id", clientId)
    .order("occurred_at", {ascending: false});
  let tasksQuery = admin
    .from("crm_follow_up_tasks")
    .select("id, contract_id, assigned_to, title, description, due_at, priority, status, created_by")
    .eq("organization_id", membership.organization_id)
    .eq("client_id", clientId)
    .order("due_at", {ascending: true, nullsFirst: false});
  let requestsQuery = admin
    .from("crm_feedback_requests")
    .select("id, contract_id, interaction_id, employee_id, public_token, channel, locale, recipient, message, status, sent_at, expires_at, delivery_error, created_at")
    .eq("organization_id", membership.organization_id)
    .eq("client_id", clientId)
    .order("created_at", {ascending: false});
  let enrollmentsQuery = admin
    .from("academy_school_enrollments")
    .select("id,school_id,program_id,cohort_id,academic_status,enrolled_on,completed_on,source")
    .eq("organization_id",membership.organization_id)
    .order("enrolled_on",{ascending:false});
  enrollmentsQuery = client.linked_user_id
    ? enrollmentsQuery.or(`crm_client_id.eq.${client.id},user_id.eq.${client.linked_user_id}`)
    : enrollmentsQuery.eq("crm_client_id",client.id);

  if (!["owner", "admin"].includes(membership.role)) {
    const scopedIds = visibleUserIds.join(",");
    contractsQuery = contractsQuery.or(
      `seller_id.in.(${scopedIds}),collection_owner_id.in.(${scopedIds}),created_by.in.(${scopedIds})`,
    );
    salesQuery = salesQuery.or(`seller_id.in.(${scopedIds}),collection_owner_id.in.(${scopedIds})`);
    interactionsQuery = interactionsQuery.in("employee_id", visibleUserIds);
    tasksQuery = tasksQuery.or(
      `assigned_to.in.(${scopedIds}),created_by.in.(${scopedIds})`,
    );
    requestsQuery = requestsQuery.in("employee_id", visibleUserIds);
  }

  const [membersResult, organizationResult, contractsResult, salesResult, interactionsResult, tasksResult, requestsResult, enrollmentsResult] = await Promise.all([
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleUserIds).order("created_at"),
    admin.from("organizations").select("name").eq("id", membership.organization_id).maybeSingle<{name: string}>(),
    contractsQuery,
    salesQuery,
    interactionsQuery,
    tasksQuery,
    requestsQuery,
    enrollmentsQuery,
  ]);
  const loadError = membersResult.error || contractsResult.error || salesResult.error || interactionsResult.error || tasksResult.error || requestsResult.error || enrollmentsResult.error;
  if (loadError) throw new Error(loadError.message);

  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((item) => item.user_id);
  const {data: profilesData} = memberIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds) : {data: [] as ProfileRow[]};
  const profiles = (profilesData ?? []) as ProfileRow[];
  const memberOptions = memberIds.map((id) => ({id, name: profiles.find((profile) => profile.id === id)?.full_name?.trim() || profiles.find((profile) => profile.id === id)?.email || t("common.member")})).sort((a, b) => a.name.localeCompare(b.name));
  const memberName = (id: string | null) => id ? memberOptions.find((item) => item.id === id)?.name || t("common.member") : t("crm.unassigned");
  const currentMemberName = memberName(authData.user.id);

  const contracts = (contractsResult.data ?? []) as ContractRow[];
  const sales = (salesResult.data ?? []) as SaleRow[];
  const interactions = (interactionsResult.data ?? []) as InteractionRow[];
  const tasks = (tasksResult.data ?? []) as TaskRow[];
  const requests = (requestsResult.data ?? []) as RequestRow[];
  const requestIds = requests.map((request) => request.id);
  const {data: responsesData} = requestIds.length ? await admin.from("crm_feedback_responses").select("id, request_id, employee_id, rating, comment, resolution_status, resolution_assigned_to, resolution_notes, submitted_at").in("request_id", requestIds).order("submitted_at", {ascending: false}) : {data: [] as ResponseRow[]};
  const responses = (responsesData ?? []) as ResponseRow[];
  const organizationName = organizationResult.data?.name || "Super Leader";
  const enrollments=(enrollmentsResult.data??[])as EnrollmentRow[];
  const enrollmentIds=enrollments.map(item=>item.id);
  const schoolIds=[...new Set(enrollments.map(item=>item.school_id))];
  const programIds=[...new Set(enrollments.map(item=>item.program_id).filter((id):id is string=>Boolean(id)))];
  const cohortIds=[...new Set(enrollments.map(item=>item.cohort_id).filter((id):id is string=>Boolean(id)))];
  const [schoolsResult,programsResult,cohortsResult,studentFinanceResult,studentPaymentsResult,studentProgressResult,studentFollowupsResult]=enrollmentIds.length?await Promise.all([
    schoolIds.length?admin.from("academy_schools").select("id,name").in("id",schoolIds):Promise.resolve({data:[]}),
    programIds.length?admin.from("academy_programs").select("id,name").in("id",programIds):Promise.resolve({data:[]}),
    cohortIds.length?admin.from("academy_cohorts").select("id,name").in("id",cohortIds):Promise.resolve({data:[]}),
    admin.from("academy_student_finance").select("enrollment_id,agreed_amount,currency,payment_status,first_payment_due_on,is_internal_training").in("enrollment_id",enrollmentIds),
    admin.from("academy_student_payments").select("enrollment_id,amount,currency").in("enrollment_id",enrollmentIds),
    admin.from("academy_student_progress").select("enrollment_id,progress_percent,current_module,training_status,risk_level,last_activity_on,next_action,next_action_on").in("enrollment_id",enrollmentIds),
    admin.from("academy_student_followups").select("id,enrollment_id,employee_id,channel,outcome,summary,next_action,next_action_on,occurred_at").in("enrollment_id",enrollmentIds).order("occurred_at",{ascending:false}).limit(100),
  ]):[{data:[]},{data:[]},{data:[]},{data:[]},{data:[]},{data:[]},{data:[]}];
  const schoolNames=new Map(((schoolsResult.data??[])as AcademyNameRow[]).map(item=>[item.id,item.name]));
  const programNames=new Map(((programsResult.data??[])as AcademyNameRow[]).map(item=>[item.id,item.name]));
  const cohortNames=new Map(((cohortsResult.data??[])as AcademyNameRow[]).map(item=>[item.id,item.name]));
  const financeByEnrollment=new Map(((studentFinanceResult.data??[])as StudentFinanceRow[]).map(item=>[item.enrollment_id,item]));
  const progressByEnrollment=new Map(((studentProgressResult.data??[])as StudentProgressRow[]).map(item=>[item.enrollment_id,item]));
  const paidByEnrollment=new Map<string,number>();
  ((studentPaymentsResult.data??[])as StudentPaymentRow[]).forEach(item=>paidByEnrollment.set(item.enrollment_id,(paidByEnrollment.get(item.enrollment_id)??0)+Number(item.amount)));
  const followupsByEnrollment=new Map<string,StudentFollowupRow[]>();
  ((studentFollowupsResult.data??[])as StudentFollowupRow[]).forEach(item=>followupsByEnrollment.set(item.enrollment_id,[...(followupsByEnrollment.get(item.enrollment_id)??[]),item]));
  const academyAssignments=await getAcademyAssignments(admin,membership.organization_id,authData.user.id);

  const currentTimestamp = new Date().getTime();

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-black text-indigo-700" href="/dashboard/crm">← {t("crm.clientDetail.back")}</Link>
        <header className="mt-4 rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{client.reference}</p><h1 className="mt-2 text-3xl font-black">{client.full_name}</h1><p className="mt-3 text-slate-300">{client.email || client.phone || t("crm.noContact")}</p></div>
            <span className={`rounded-full px-4 py-2 text-sm font-black ${tone[client.status] ?? "bg-slate-100 text-slate-700"}`}>{t(`crm.clientStatuses.${client.status}`)}</span>
          </div>
        </header>
        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-bold text-slate-500">{t("crm.clientDetail.contracts")}</p><p className="mt-2 text-3xl font-black">{contracts.length}</p></article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-bold text-slate-500">{t("crm.clientDetail.interactions")}</p><p className="mt-2 text-3xl font-black">{interactions.length}</p></article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-bold text-slate-500">{t("crm.clientDetail.openTasks")}</p><p className="mt-2 text-3xl font-black">{tasks.filter((task) => !["completed","cancelled"].includes(task.status)).length}</p></article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-bold text-slate-500">{t("crm.clientDetail.feedback")}</p><p className="mt-2 text-3xl font-black">{responses.length ? `${(responses.reduce((sum, item) => sum + item.rating, 0) / responses.length).toFixed(1)}/5` : "—"}</p></article>
        </section>

        <section className="mt-6 rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.2em] text-cyan-700">Achats du client</p><h2 className="mt-2 text-2xl font-black">Produits et ventes reliés</h2><p className="mt-2 text-sm text-slate-600">Cette section provient des ventes reliées au dossier; les contrats restent affichés séparément pour le suivi administratif.</p></div><span className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-900">{sales.length} achat(s)</span></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">{sales.map(sale=><article key={sale.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{sale.product_name}</h3><p className="mt-1 text-xs font-bold text-slate-400">{sale.id} · {new Date(sale.sale_date).toLocaleDateString(dateLocale)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${tone[sale.payment_status]??"bg-slate-100 text-slate-700"}`}>{sale.payment_status}</span></div><div className="mt-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase text-slate-400">Montant de la vente</p><p className="mt-1 text-2xl font-black">{money(dateLocale,sale.currency,sale.total_amount)}</p></div><p className="text-sm font-bold text-slate-600">Quantité : {sale.quantity}</p></div><p className="mt-4 text-xs font-bold text-slate-500">Validation : {sale.workflow_status} · Contrat CRM : {sale.crm_contract_id?"relié":"à régulariser"}</p></article>)}{!sales.length?<div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center"><p className="font-black text-amber-950">Aucune vente n’est actuellement reliée à ce dossier.</p><p className="mt-2 text-sm text-amber-900">Si un paiement existe, utilisez « Synchronisation des identités → Régulariser les dossiers ». Une identité ambiguë restera volontairement en vérification.</p></div>:null}</div>
        </section>

        {enrollments.length ? <section className="mt-6 rounded-3xl border border-violet-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.2em] text-violet-700">Parcours académique</p><h2 className="mt-2 text-2xl font-black">Écoles, progression et situation financière</h2><p className="mt-2 text-sm text-slate-600">Toutes les inscriptions de cet apprenant sont regroupées dans son dossier CRM.</p></div><span className="rounded-full bg-violet-100 px-4 py-2 text-sm font-black text-violet-800">{enrollments.length} inscription(s)</span></div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">{enrollments.map(enrollment=>{const finance=financeByEnrollment.get(enrollment.id);const progress=progressByEnrollment.get(enrollment.id);const paid=paidByEnrollment.get(enrollment.id)??0;const agreed=Number(finance?.agreed_amount??0);const balance=Math.max(0,agreed-paid);const currency=finance?.currency??"USD";const followups=followupsByEnrollment.get(enrollment.id)??[];const canTrain=canEditTraining(membership.role,academyAssignments,enrollment.school_id);const canFollow=canAddFollowup(membership.role,academyAssignments,enrollment.school_id);return <article id={`academy-enrollment-${enrollment.id}`} key={enrollment.id} className="scroll-mt-28 rounded-2xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{schoolNames.get(enrollment.school_id)??"École"}</h3><p className="mt-1 text-sm text-slate-600">{enrollment.program_id?programNames.get(enrollment.program_id)??"Programme":"Programme non précisé"} · {enrollment.cohort_id?cohortNames.get(enrollment.cohort_id)??"Cohorte":"Cohorte non précisée"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${["active","enrolled","graduated"].includes(enrollment.academic_status)?"bg-emerald-100 text-emerald-800":"bg-amber-100 text-amber-800"}`}>{enrollment.academic_status}</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Progression</p><p className="mt-1 font-black">{Number(progress?.progress_percent??0).toFixed(0)}%</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">Payé</p><p className="mt-1 font-black text-emerald-900">{money(dateLocale,currency,paid)}</p></div><div className="rounded-xl bg-rose-50 p-3"><p className="text-xs font-bold text-rose-700">Solde</p><p className="mt-1 font-black text-rose-900">{money(dateLocale,currency,balance)}</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">Formation : {progress?.training_status??"non démarrée"}</span><span className={`rounded-full px-3 py-1 ${progress?.risk_level==="high"||progress?.risk_level==="critical"?"bg-red-100 text-red-800":"bg-slate-100 text-slate-700"}`}>Risque : {progress?.risk_level??"faible"}</span><span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Paiement : {finance?.payment_status??"non configuré"}</span></div>
            {progress?.current_module?<p className="mt-4 text-sm"><strong>Module actuel :</strong> {progress.current_module}</p>:null}{progress?.next_action?<p className="mt-2 text-sm text-slate-600"><strong>Prochaine action :</strong> {progress.next_action}{progress.next_action_on?` · ${new Date(progress.next_action_on).toLocaleDateString(dateLocale)}`:""}</p>:null}
            {followups.length?<details className="mt-4 rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-black">Historique académique ({followups.length})</summary><div className="mt-3 space-y-3">{followups.slice(0,5).map(item=><div key={item.id} className="border-l-2 border-violet-300 pl-3 text-sm"><p className="font-bold">{item.channel} · {item.outcome} · {new Date(item.occurred_at).toLocaleString(dateLocale)}</p><p className="mt-1 text-slate-600">{item.summary}</p>{item.next_action?<p className="mt-1 text-xs font-bold text-amber-800">Suite : {item.next_action}</p>:null}</div>)}</div></details>:null}
            {canTrain?<details className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4"><summary className="cursor-pointer text-sm font-black text-violet-950">Mettre à jour la progression</summary><form action={updateCrmLearnerProgressAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="client_id" value={client.id}/><input type="hidden" name="enrollment_id" value={enrollment.id}/><input type="hidden" name="school_id" value={enrollment.school_id}/><label className="text-xs font-bold">Statut académique<select name="academic_status" defaultValue={enrollment.academic_status} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2">{["candidate","admitted","enrolled","active","suspended","graduated","withdrawn","inactive"].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold">Avancement<select name="training_status" defaultValue={progress?.training_status??"not_started"} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2">{["not_started","active","paused","at_risk","completed","withdrawn"].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold">Progression (%)<input name="progress_percent" type="number" min="0" max="100" step="1" defaultValue={Number(progress?.progress_percent??0)} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold">Niveau de risque<select name="risk_level" defaultValue={progress?.risk_level??"low"} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2">{["low","medium","high","critical"].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold sm:col-span-2">Module actuel<input name="current_module" defaultValue={progress?.current_module??""} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold">Dernière activité<input name="last_activity_on" type="date" defaultValue={progress?.last_activity_on??""} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold">Fin prévue<input name="expected_completion_on" type="date" className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold sm:col-span-2">Blocage<textarea name="blocker_notes" className="mt-1 min-h-16 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold">Prochaine action<input name="next_action" defaultValue={progress?.next_action??""} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><label className="text-xs font-bold">Date<input name="next_action_on" type="date" defaultValue={progress?.next_action_on??""} className="mt-1 w-full rounded-lg border border-violet-200 bg-white p-2"/></label><button className="rounded-lg bg-violet-800 px-4 py-3 text-sm font-black text-white sm:col-span-2">Enregistrer la progression</button></form></details>:null}
            {canFollow?<details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><summary className="cursor-pointer text-sm font-black text-amber-950">Ajouter un suivi académique</summary><form action={addCrmLearnerFollowupAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="client_id" value={client.id}/><input type="hidden" name="enrollment_id" value={enrollment.id}/><input type="hidden" name="school_id" value={enrollment.school_id}/><label className="text-xs font-bold">Canal<select name="channel" className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2">{["phone","whatsapp","email","sms","meeting","video","other"].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold">Résultat<select name="outcome" className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2">{["resolved","follow_up","no_answer","escalated","other"].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold sm:col-span-2">Résumé<textarea name="summary" required className="mt-1 min-h-20 w-full rounded-lg border border-amber-200 bg-white p-2"/></label><label className="text-xs font-bold">Prochaine action<input name="next_action" className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2"/></label><label className="text-xs font-bold">Date<input name="next_action_on" type="date" className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2"/></label><button className="rounded-lg bg-amber-500 px-4 py-3 text-sm font-black text-slate-950 sm:col-span-2">Ajouter à l’historique</button></form></details>:null}
          </article>})}</div>
        </section>:null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="space-y-6">
            <form action={updateCrmClientAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="clientId" value={client.id} />
              <h2 className="text-xl font-black">{t("crm.clientDetail.profile")}</h2>
              <div className="mt-5 grid gap-4">
                <label className="text-sm font-bold">{t("crm.fields.fullName")}<input name="fullName" defaultValue={client.full_name} required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{t("common.email")}<input name="email" type="email" defaultValue={client.email ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{t("crm.fields.phone")}<input name="phone" defaultValue={client.phone ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">WhatsApp<input name="whatsappPhone" defaultValue={client.whatsapp_phone ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{t("crm.fields.country")}<input name="country" defaultValue={client.country ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{t("crm.fields.city")}<input name="city" defaultValue={client.city ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label></div>
                <label className="text-sm font-bold">{t("crm.fields.companyName")}<input name="companyName" defaultValue={client.company_name ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{t("crm.fields.language")}<select name="preferredLanguage" defaultValue={client.preferred_language} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="fr">Français</option><option value="en">English</option></select></label><label className="text-sm font-bold">{t("crm.fields.feedbackChannel")}<select name="preferredFeedbackChannel" defaultValue={client.preferred_feedback_channel} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="web">Web</option></select></label></div>
                {isEmployee ? (
                  <>
                    <input type="hidden" name="ownerId" value={authData.user.id} />
                    <input type="hidden" name="followUpOwnerId" value={authData.user.id} />
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <p className="text-sm font-bold text-indigo-950">{t("crm.fields.salesOwner")}</p>
                      <p className="mt-1 font-black text-indigo-950">{currentMemberName}</p>
                      <p className="mt-1 text-xs font-semibold text-indigo-700">{t("crm.fields.assignedAutomatically")}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <p className="text-sm font-bold text-indigo-950">{t("crm.fields.followUpOwner")}</p>
                      <p className="mt-1 font-black text-indigo-950">{currentMemberName}</p>
                      <p className="mt-1 text-xs font-semibold text-indigo-700">{t("crm.fields.assignedAutomatically")}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-bold">{t("crm.fields.salesOwner")}<select name="ownerId" defaultValue={client.owner_id ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-sm font-bold">{t("crm.fields.followUpOwner")}<select name="followUpOwnerId" defaultValue={client.follow_up_owner_id ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  </>
                )}
                <label className="text-sm font-bold">{t("common.status")}<select name="status" defaultValue={client.status} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["prospect","active","inactive","closed"].map((item) => <option key={item} value={item}>{t(`crm.clientStatuses.${item}`)}</option>)}</select></label>
                <label className="flex items-center gap-3 text-sm"><input name="feedbackOptIn" type="checkbox" defaultChecked={client.feedback_opt_in} />{t("crm.fields.feedbackConsent")}</label>
                <label className="flex items-center gap-3 text-sm"><input name="marketingOptIn" type="checkbox" defaultChecked={client.marketing_opt_in} />{t("crm.fields.marketingConsent")}</label>
                <label className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><input name="doNotContact" type="checkbox" defaultChecked={client.do_not_contact} />{t("crm.fields.doNotContact")}</label>
                <label className="text-sm font-bold">{t("crm.fields.notes")}<textarea name="notes" defaultValue={client.notes ?? ""} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("crm.clientDetail.saveProfile")}</button>
              </div>
            </form>

            <form action={createCrmContractAction} className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6">
              <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="clientId" value={client.id} />
              <h2 className="text-xl font-black text-cyan-950">{t("crm.contracts.new")}</h2>
              <div className="mt-5 grid gap-4">
                <label className="text-sm font-bold text-cyan-950">{t("crm.fields.contractTitle")}<input name="title" required className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold text-cyan-950">{t("crm.fields.productName")}<input name="productName" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal" /></label>
                <div className="grid grid-cols-2 gap-4"><label className="text-sm font-bold text-cyan-950">{t("crm.fields.totalAmount")}<input name="totalAmount" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-cyan-950">{t("crm.fields.currency")}<select name="currency" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal">{["USD","EUR","GBP","XAF","CAD"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
                <label className="text-sm font-bold text-cyan-950">{t("common.status")}<select name="status" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal">{["preparation","awaiting_signature","active","payment_in_progress","paid","suspended","cancelled","terminated"].map((item) => <option key={item} value={item}>{t(`crm.contractStatuses.${item}`)}</option>)}</select></label>
                {isEmployee ? (
                  <>
                    <input type="hidden" name="sellerId" value={authData.user.id} />
                    <input type="hidden" name="collectionOwnerId" value="" />
                    <div className="rounded-xl border border-cyan-200 bg-white p-4">
                      <p className="text-sm font-bold text-cyan-950">{t("crm.fields.salesOwner")}</p>
                      <p className="mt-1 font-black text-cyan-950">{currentMemberName}</p>
                      <p className="mt-1 text-xs font-semibold text-cyan-700">{t("crm.fields.assignedAutomatically")}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-950">{t("crm.fields.followUpOwner")}</p>
                      <p className="mt-1 font-black text-amber-950">{t("crm.unassigned")}</p>
                      <p className="mt-1 text-xs font-semibold text-amber-800">{locale === "fr" ? "Le recouvrement sera affecté après le premier paiement confirmé." : "Collections will be assigned after the confirmed first payment."}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-bold text-cyan-950">{t("crm.fields.salesOwner")}<select name="sellerId" defaultValue={client.owner_id ?? ""} className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-sm font-bold text-cyan-950">{t("crm.fields.followUpOwner")}<select name="collectionOwnerId" defaultValue={client.follow_up_owner_id ?? ""} className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  </>
                )}
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-cyan-950">{t("crm.fields.startDate")}<input name="startDate" type="date" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-cyan-950">{t("crm.fields.expectedEndDate")}<input name="expectedEndDate" type="date" className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 font-normal" /></label></div>
                <button type="submit" className="rounded-xl bg-cyan-900 px-5 py-3 font-black text-white">{t("crm.contracts.create")}</button>
              </div>
            </form>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.contracts.title")}</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {contracts.map((contract) => <article key={contract.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{contract.title}</p><p className="mt-1 text-xs font-bold text-slate-400">{contract.contract_number}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${tone[contract.status] ?? "bg-slate-100"}`}>{t(`crm.contractStatuses.${contract.status}`)}</span></div><p className="mt-4 text-2xl font-black">{money(dateLocale, contract.currency, contract.total_amount)}</p><p className="mt-3 text-sm text-slate-500">{t("crm.contracts.seller", {name: memberName(contract.seller_id)})}<br />{t("crm.contracts.followUp", {name: memberName(contract.collection_owner_id)})}</p></article>)}
                {!contracts.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 md:col-span-2">{t("crm.contracts.empty")}</p> : null}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <form action={createCrmInteractionAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="clientId" value={client.id} />
                <h2 className="text-xl font-black">{t("crm.interactions.new")}</h2>
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-bold">{t("crm.fields.contract")}<select name="contractId" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.none")}</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.title}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.employee")}<select name="employeeId" defaultValue={authData.user.id} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  <div className="grid grid-cols-2 gap-4"><label className="text-sm font-bold">{t("crm.fields.channel")}<select name="channel" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["phone","whatsapp","email","sms","meeting","video","web_chat","other"].map((item) => <option key={item} value={item}>{t(`crm.channels.${item}`)}</option>)}</select></label><label className="text-sm font-bold">{t("crm.fields.outcome")}<select name="outcome" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["resolved","follow_up","payment_promise","no_answer","escalated","other"].map((item) => <option key={item} value={item}>{t(`crm.outcomes.${item}`)}</option>)}</select></label></div>
                  <label className="text-sm font-bold">{t("crm.fields.interactionType")}<select name="interactionType" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["sales","support","collection","training","complaint","information","other"].map((item) => <option key={item} value={item}>{t(`crm.interactionTypes.${item}`)}</option>)}</select></label>
                  <input type="hidden" name="direction" value="outbound" />
                  <label className="text-sm font-bold">{t("crm.fields.summary")}<textarea name="summary" required className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">{t("crm.fields.nextFollowUp")}<input name="nextFollowUpAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm"><input name="requestFeedback" type="checkbox" defaultChecked className="mt-1" />{t("crm.interactions.requestFeedback")}</label>
                  <button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white" type="submit">{t("crm.interactions.save")}</button>
                </div>
              </form>

              <form action={createCrmTaskAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="clientId" value={client.id} />
                <h2 className="text-xl font-black">{t("crm.tasks.new")}</h2>
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-bold">{t("crm.fields.taskTitle")}<input name="title" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">{t("crm.fields.assignedTo")}<select name="assignedTo" defaultValue={client.follow_up_owner_id ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.dueAt")}<input name="dueAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">{t("crm.fields.priority")}<select name="priority" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["low","normal","high","urgent"].map((item) => <option key={item} value={item}>{t(`crm.priorities.${item}`)}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.description")}<textarea name="description" className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white" type="submit">{t("crm.tasks.create")}</button>
                </div>
              </form>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.interactions.recent")}</h2>
              <div className="mt-5 space-y-4">{interactions.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{t(`crm.channels.${item.channel}`)} · {memberName(item.employee_id)}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.occurred_at).toLocaleString(dateLocale)}</p></div><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">{t(`crm.outcomes.${item.outcome}`)}</span></div><p className="mt-4 leading-7 text-slate-700">{item.summary}</p></article>)}{!interactions.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.interactions.empty")}</p> : null}</div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.tasks.list")}</h2>
              <div className="mt-5 space-y-4">{tasks.map((task) => { const overdue = task.due_at && !["completed","cancelled"].includes(task.status) && new Date(task.due_at).getTime() < currentTimestamp; return <article key={task.id} className={`rounded-2xl border p-5 ${overdue ? "border-red-200 bg-red-50" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-black">{task.title}</p><p className="mt-1 text-xs text-slate-500">{memberName(task.assigned_to)}{task.due_at ? ` · ${new Date(task.due_at).toLocaleString(dateLocale)}` : ""}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${tone[overdue ? "overdue" : task.status] ?? "bg-slate-100"}`}>{t(`crm.taskStatuses.${overdue ? "overdue" : task.status}`)}</span></div>{task.description ? <p className="mt-3 text-sm text-slate-600">{task.description}</p> : null}{!(["completed","cancelled"].includes(task.status)) ? <div className="mt-4 flex gap-2">{["in_progress","completed","cancelled"].map((status) => <form action={updateCrmTaskStatusAction} key={status}><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="status" value={status} /><button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black">{t(`crm.taskActions.${status}`)}</button></form>)}</div> : null}</article>; })}{!tasks.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.tasks.empty")}</p> : null}</div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-black">{t("crm.feedback.title")}</h2><p className="mt-1 text-sm text-slate-500">{t("crm.feedback.clientHelp")}</p></div><form action={createCustomerFeedbackRequestAction}><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="employeeId" value={authData.user.id} /><button type="submit" className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950">{t("crm.feedback.createRequest")}</button></form></div>
              <div className="mt-5 space-y-4">{requests.map((request) => { const content = buildFeedbackMessage({token: request.public_token, locale: request.locale, clientName: client.full_name, organizationName, employeeName: memberName(request.employee_id), message: request.message}); return <article key={request.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{t("crm.feedback.aboutEmployee", {name: memberName(request.employee_id)})}</p><p className="mt-1 text-xs text-slate-400">{new Date(request.created_at).toLocaleString(dateLocale)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${tone[request.status] ?? "bg-slate-100"}`}>{t(`crm.feedbackStatuses.${request.status}`)}</span></div><div className="mt-4"><FeedbackShareLinks url={content.url} message={content.text} subject={content.subject} email={client.email} phone={client.whatsapp_phone || client.phone} labels={{copy:t("crm.feedback.copyLink"),copied:t("crm.feedback.copied"),email:"Email",whatsapp:"WhatsApp",sms:"SMS",open:t("crm.feedback.openForm")}} /></div>{!(["completed","cancelled","expired"].includes(request.status)) ? <form action={sendCustomerFeedbackRequestAction} className="mt-4"><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="requestId" value={request.id} /><button className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white" type="submit">{request.channel === "email" ? t("crm.feedback.sendNow") : t("crm.feedback.markSent")}</button></form> : null}</article>; })}</div>
              <div className="mt-6 space-y-4">{responses.map((response) => <article key={response.id} className={`rounded-2xl border p-5 ${response.rating <= 2 ? "border-red-200 bg-red-50" : "border-slate-200"}`}><div className="flex items-start justify-between"><div><p className="font-black">{t("crm.feedback.responseFromClient")}</p><p className="mt-1 text-xs text-slate-400">{new Date(response.submitted_at).toLocaleString(dateLocale)}</p></div><p className="text-2xl font-black">{response.rating}/5</p></div>{response.comment ? <p className="mt-4 rounded-xl bg-white p-4 text-slate-700">{response.comment}</p> : null}{isLeader ? <form action={resolveCustomerFeedbackAction} className="mt-4 grid gap-3 sm:grid-cols-3"><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="responseId" value={response.id} /><select name="resolutionStatus" defaultValue={response.resolution_status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="open">{t("crm.resolutionStatuses.open")}</option><option value="in_progress">{t("crm.resolutionStatuses.in_progress")}</option><option value="resolved">{t("crm.resolutionStatuses.resolved")}</option><option value="not_required">{t("crm.resolutionStatuses.not_required")}</option></select><select name="assignedTo" defaultValue={response.resolution_assigned_to ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white" type="submit">{t("crm.feedback.updateResolution")}</button><textarea name="resolutionNotes" defaultValue={response.resolution_notes ?? ""} className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-3" /></form> : null}</article>)}</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
