import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ clientId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Membership = { organization_id: string; role: string };
type Client = { id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; linked_user_id: string | null; reference: string | null; status: string };
type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Enrollment = { id: string; school_id: string; user_id: string | null; crm_client_id: string | null; source: string; academic_status: string };
type School = { id: string; name: string; code: string };
type Finance = { enrollment_id: string; agreed_amount: number; currency: string; payment_status: string };
type Payment = { enrollment_id: string; amount: number; currency: string; paid_on: string };
type Progress = { enrollment_id: string; progress_percent: number; training_status: string; risk_level: string; next_action: string | null; next_action_on: string | null };
type Followup = { id: string; enrollment_id: string; channel: string; outcome: string; summary: string; next_action: string | null; next_action_on: string | null; occurred_at: string };
type Sale = { id: string; product_name: string; total_amount: number; currency: string; payment_status: string; workflow_status: string; sale_date: string };
type Task = { id: string; title: string; due_at: string | null; priority: string; status: string };
type Audit = { id: string; action: string; reason: string; details: Record<string, unknown>; created_at: string; user_id: string | null };

const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const money = (value: number, currency: string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "USD" }).format(Number(value || 0));
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) : "—";

export default async function Identity360Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { clientId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const requestedOrganizationId = one(query.organization).trim();
  let membershipQuery = admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true);
  if (requestedOrganizationId) membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  const { data: memberships } = await membershipQuery.limit(20);
  const membership = ((memberships ?? []) as Membership[]).find((row) => ["owner", "admin"].includes(row.role));
  if (!membership) redirect("/dashboard?error=access-denied");
  const organizationId = membership.organization_id;

  const schemaResult = await admin.from("crm_clients").select("identity_uid", { head: true }).eq("organization_id", organizationId).limit(1);
  const identitySchemaReady = !schemaResult.error;

  const { data: clientData, error: clientError } = await admin.from("crm_clients").select("id,full_name,email,phone,whatsapp_phone,linked_user_id,reference,status").eq("organization_id", organizationId).eq("id", clientId).maybeSingle<Client>();
  if (clientError || !clientData) notFound();
  const client = clientData;

  const identityResult = identitySchemaReady ? await admin.from("crm_clients").select("identity_uid").eq("organization_id", organizationId).eq("id", clientId).maybeSingle<{ identity_uid: string }>() : { data: null, error: null };
  const identityUid = identityResult.data?.identity_uid ?? null;

  let enrollmentQuery = admin.from("academy_school_enrollments").select("id,school_id,user_id,crm_client_id,source,academic_status").eq("organization_id", organizationId);
  enrollmentQuery = client.linked_user_id
    ? enrollmentQuery.or(`crm_client_id.eq.${clientId},user_id.eq.${client.linked_user_id}`)
    : enrollmentQuery.eq("crm_client_id", clientId);
  const enrollmentsResult = await enrollmentQuery.order("created_at", { ascending: true });
  const enrollments = [...new Map(((enrollmentsResult.data ?? []) as Enrollment[]).map((row) => [row.id, row])).values()];
  const enrollmentIds = enrollments.map((row) => row.id);
  const schoolIds = [...new Set(enrollments.map((row) => row.school_id))];

  const [profileResult, membershipResult, schoolsResult, financeResult, paymentsResult, progressResult, followupsResult, salesResult, tasksResult, auditResult] = await Promise.all([
    client.linked_user_id ? admin.from("profiles").select("id,full_name,email,phone").eq("id", client.linked_user_id).maybeSingle<Profile>() : Promise.resolve({ data: null, error: null }),
    client.linked_user_id ? admin.from("organization_members").select("role,is_active").eq("organization_id", organizationId).eq("user_id", client.linked_user_id).maybeSingle<{ role: string; is_active: boolean }>() : Promise.resolve({ data: null, error: null }),
    schoolIds.length ? admin.from("academy_schools").select("id,name,code").eq("organization_id", organizationId).in("id", schoolIds) : Promise.resolve({ data: [] as School[], error: null }),
    enrollmentIds.length ? admin.from("academy_student_finance").select("enrollment_id,agreed_amount,currency,payment_status").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds) : Promise.resolve({ data: [] as Finance[], error: null }),
    enrollmentIds.length ? admin.from("academy_student_payments").select("enrollment_id,amount,currency,paid_on").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] as Payment[], error: null }),
    enrollmentIds.length ? admin.from("academy_student_progress").select("enrollment_id,progress_percent,training_status,risk_level,next_action,next_action_on").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds) : Promise.resolve({ data: [] as Progress[], error: null }),
    enrollmentIds.length ? admin.from("academy_student_followups").select("id,enrollment_id,channel,outcome,summary,next_action,next_action_on,occurred_at").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds).order("occurred_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] as Followup[], error: null }),
    admin.from("sales_records").select("id,product_name,total_amount,currency,payment_status,workflow_status,sale_date").eq("organization_id", organizationId).eq("crm_client_id", clientId).order("sale_date", { ascending: false }).limit(20),
    admin.from("crm_follow_up_tasks").select("id,title,due_at,priority,status").eq("organization_id", organizationId).eq("client_id", clientId).order("due_at", { ascending: true }).limit(20),
    identitySchemaReady ? admin.from("person_identity_link_audit").select("id,action,reason,details,created_at,user_id").eq("organization_id", organizationId).eq("crm_client_id", clientId).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] as Audit[], error: null }),
  ]);

  const profile = profileResult.data as Profile | null;
  const member = membershipResult.data as { role: string; is_active: boolean } | null;
  const schools = new Map(((schoolsResult.data ?? []) as School[]).map((row) => [row.id, row]));
  const finances = (financeResult.data ?? []) as Finance[];
  const payments = (paymentsResult.data ?? []) as Payment[];
  const progress = (progressResult.data ?? []) as Progress[];
  const followups = (followupsResult.data ?? []) as Followup[];
  const sales = (salesResult.data ?? []) as Sale[];
  const tasks = (tasksResult.data ?? []) as Task[];
  const audits = (auditResult.data ?? []) as Audit[];
  const totalSales = sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const saleCurrency = sales[0]?.currency ?? "USD";
  const totalAcademyPaid = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const academyCurrency = payments[0]?.currency ?? finances[0]?.currency ?? "USD";
  const openTasks = tasks.filter((row) => !["completed", "cancelled"].includes(row.status));
  const errorMessages = [enrollmentsResult.error, profileResult.error, membershipResult.error, schoolsResult.error, financeResult.error, paymentsResult.error, progressResult.error, followupsResult.error, salesResult.error, tasksResult.error, auditResult.error].filter(Boolean).map((item) => item?.message ?? "Erreur de lecture");

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}`} className="font-black text-indigo-700">← Identités liées</Link><Link href={`/dashboard/crm/${client.id}`} className="rounded-xl border bg-white px-4 py-2 text-sm font-black">Ouvrir le dossier CRM</Link></div>

    <header className="mt-5 rounded-[2rem] bg-gradient-to-r from-slate-950 via-indigo-950 to-emerald-950 p-8 text-white shadow-xl">
      <p className="text-xs font-black uppercase tracking-[.24em] text-amber-300">DOSSIER 360° · IDENTITÉ UNIQUE</p>
      <h1 className="mt-2 text-4xl font-black">{client.full_name}</h1>
      <p className="mt-3 text-slate-200">{client.email || "Sans e-mail"}{client.phone || client.whatsapp_phone ? ` · ${client.phone || client.whatsapp_phone}` : ""}</p>
      <div className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-4 py-2 text-sm font-black">CRM {client.reference || client.id.slice(0, 8)}</span><span className="rounded-full bg-white/10 px-4 py-2 text-sm font-black">Identity UID : {identityUid || "migration V4.10.112 requise"}</span><span className="rounded-full bg-white/10 px-4 py-2 text-sm font-black">Statut CRM : {client.status}</span></div>
    </header>

    {errorMessages.length ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-black text-amber-950">Certaines données 360° ne sont pas disponibles</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-900">{errorMessages.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section> : null}

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {[['Compte utilisateur', client.linked_user_id ? 'Relié' : 'Absent'], ['Inscriptions Academy', String(enrollments.length)], ['Ventes CRM', String(sales.length)], ['Paiements Academy', money(totalAcademyPaid, academyCurrency)], ['Suivis ouverts', String(openTasks.length)]].map(([title, value]) => <article key={title} className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{title}</p><p className="mt-2 text-2xl font-black">{value}</p></article>)}
    </section>

    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">CRM & compte</h2><div className="mt-4 space-y-3 text-sm"><p><span className="font-black">Dossier CRM :</span> {client.reference || client.id}</p><p><span className="font-black">Compte :</span> {client.linked_user_id ? profile?.email || profile?.full_name || client.linked_user_id : "Aucun compte utilisateur — situation autorisée"}</p><p><span className="font-black">Téléphone :</span> {client.phone || client.whatsapp_phone || "Non renseigné"}</p><p><span className="font-black">Rôle RH :</span> {member ? `${member.role}${member.is_active ? " · actif" : " · inactif"}` : "Aucun rôle employé lié"}</p></div></article>
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Finance consolidée</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-500">Valeur des ventes affichées</p><p className="mt-1 text-2xl font-black">{money(totalSales, saleCurrency)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-500">Paiements Academy</p><p className="mt-1 text-2xl font-black">{money(totalAcademyPaid, academyCurrency)}</p></div></div><p className="mt-4 text-xs text-slate-500">Le dossier 360° rapproche les références existantes ; il ne modifie aucune écriture financière.</p></article>
    </section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Academy</h2><p className="mt-2 text-sm text-slate-600">Plusieurs inscriptions peuvent appartenir à la même identité.</p><div className="mt-5 grid gap-3 lg:grid-cols-2">{enrollments.map((enrollment) => { const finance = finances.find((row) => row.enrollment_id === enrollment.id); const p = progress.find((row) => row.enrollment_id === enrollment.id); const paid = payments.filter((row) => row.enrollment_id === enrollment.id).reduce((sum, row) => sum + Number(row.amount || 0), 0); return <article key={enrollment.id} className="rounded-2xl border border-violet-100 bg-violet-50 p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black">{schools.get(enrollment.school_id)?.name || "École"}</h3><p className="mt-1 text-sm text-violet-900">{enrollment.academic_status} · source {enrollment.source}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black">{p?.progress_percent ?? 0}%</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><p className="rounded-xl bg-white p-3 text-sm"><span className="font-black">Finance :</span> {finance ? `${finance.payment_status} · ${money(finance.agreed_amount, finance.currency)}` : "Non configurée"}</p><p className="rounded-xl bg-white p-3 text-sm"><span className="font-black">Payé :</span> {money(paid, finance?.currency || academyCurrency)}</p><p className="rounded-xl bg-white p-3 text-sm"><span className="font-black">Formation :</span> {p?.training_status || "Non démarrée"}</p><p className="rounded-xl bg-white p-3 text-sm"><span className="font-black">Risque :</span> {p?.risk_level || "Non renseigné"}</p></div>{p?.next_action ? <p className="mt-3 text-sm font-bold text-violet-950">Prochaine action : {p.next_action} · {date(p.next_action_on)}</p> : null}</article>; })}{!enrollments.length ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucune inscription Academy liée à ce dossier CRM.</p> : null}</div></section>

    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Finance / ventes</h2><div className="mt-4 space-y-3">{sales.map((sale) => <div key={sale.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{sale.product_name}</p><p className="mt-1 text-sm text-slate-600">{date(sale.sale_date)} · {sale.payment_status} · {sale.workflow_status}</p></div><p className="font-black">{money(sale.total_amount, sale.currency)}</p></div></div>)}{!sales.length ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucune vente CRM reliée.</p> : null}</div></article>
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Suivi CRM</h2><div className="mt-4 space-y-3">{tasks.map((task) => <div key={task.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{task.title}</p><p className="mt-1 text-sm text-slate-600">Échéance {date(task.due_at)} · priorité {task.priority}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black">{task.status}</span></div></div>)}{!tasks.length ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucune tâche de suivi CRM.</p> : null}</div></article>
    </section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Derniers suivis Academy</h2><div className="mt-4 space-y-3">{followups.map((item) => <article key={item.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-black">{item.channel} · {item.outcome}</p><p className="text-xs font-bold text-slate-500">{date(item.occurred_at)}</p></div><p className="mt-2 text-sm text-slate-700">{item.summary}</p>{item.next_action ? <p className="mt-2 text-sm font-bold">Prochaine action : {item.next_action} · {date(item.next_action_on)}</p> : null}</article>)}{!followups.length ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucun suivi Academy enregistré.</p> : null}</div></section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Journal d’identité</h2><p className="mt-2 text-sm text-slate-600">Traçabilité des rapprochements et décisions administratives.</p><div className="mt-4 space-y-3">{audits.map((entry) => <article key={entry.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-black">{entry.action}</p><p className="text-xs font-bold text-slate-500">{date(entry.created_at)}</p></div><p className="mt-2 text-sm text-slate-700">{entry.reason}</p></article>)}{!audits.length ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucune action d’identité V4.10.112 enregistrée pour le moment.</p> : null}</div></section>
  </div></main>;
}
