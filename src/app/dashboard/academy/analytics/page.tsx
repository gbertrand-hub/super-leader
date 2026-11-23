import Link from "next/link";
import { redirect } from "next/navigation";
import { academyGlobalRoles, canViewAnalytics, getAcademyAssignments } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const num = (v: unknown) => Number(v ?? 0);
const money = (v: number, c: string) => { try { return new Intl.NumberFormat("fr-CA", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(v); } catch { return `${v.toFixed(0)} ${c}`; } };

export default async function AcademyAnalyticsPage({ searchParams }: Props) {
  const q = (await searchParams) ?? {};
  const requestedSchool = first(q.school);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) redirect("/dashboard/company");
  const assignments = await getAcademyAssignments(admin, membership.organization_id, auth.user.id);
  const global = academyGlobalRoles.has(membership.role);
  const { data: allSchools } = await admin.from("academy_schools").select("id,name").eq("organization_id", membership.organization_id).eq("is_active", true).order("name");
  const schools = (allSchools ?? []).filter((s) => global || canViewAnalytics(membership.role, assignments, String(s.id)));
  if (!schools.length) redirect("/dashboard/academy");
  const schoolId = schools.some((s) => String(s.id) === requestedSchool) ? requestedSchool : String(schools[0].id);
  const school = schools.find((s) => String(s.id) === schoolId)!;

  const [{ data: enrollments }, { data: programs }, { data: cohorts }, { data: sessions }] = await Promise.all([
    admin.from("academy_school_enrollments").select("id,program_id,cohort_id,user_id,crm_client_id,academic_status,enrolled_on").eq("organization_id", membership.organization_id).eq("school_id", schoolId),
    admin.from("academy_programs").select("id,name,status").eq("organization_id", membership.organization_id).eq("school_id", schoolId).neq("status", "archived"),
    admin.from("academy_cohorts").select("id,name,status").eq("organization_id", membership.organization_id).eq("school_id", schoolId).neq("status", "archived"),
    admin.from("academy_attendance_sessions").select("id,session_date,status").eq("organization_id", membership.organization_id).eq("school_id", schoolId).order("session_date", { ascending: false }).limit(100),
  ]);
  const enrollmentIds = (enrollments ?? []).map((e) => String(e.id));
  const [{ data: finance }, { data: payments }, { data: progress }, { data: attendance }] = enrollmentIds.length ? await Promise.all([
    admin.from("academy_student_finance").select("enrollment_id,agreed_amount,currency,payment_status,list_price,discount_amount").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_payments").select("enrollment_id,amount,currency").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_progress").select("enrollment_id,progress_percent,training_status,risk_level").in("enrollment_id", enrollmentIds),
    admin.from("academy_attendance_records").select("enrollment_id,attendance_status").in("enrollment_id", enrollmentIds),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }] as any;

  const financeBy = new Map((finance ?? []).map((x: { enrollment_id: string | number }) => [String(x.enrollment_id), x]));
  const paidByCurrency = new Map<string, number>();
  for (const p of payments ?? []) paidByCurrency.set(String(p.currency), (paidByCurrency.get(String(p.currency)) ?? 0) + num(p.amount));
  const agreedByCurrency = new Map<string, number>();
  const discountsByCurrency = new Map<string, number>();
  for (const f of finance ?? []) {
    const c = String(f.currency ?? "USD");
    agreedByCurrency.set(c, (agreedByCurrency.get(c) ?? 0) + num(f.agreed_amount));
    discountsByCurrency.set(c, (discountsByCurrency.get(c) ?? 0) + Math.max(0, num(f.list_price) - num(f.agreed_amount)));
  }
  const incomplete = (enrollments ?? []).filter((e) => !e.program_id || !e.cohort_id).length;
  const external = (enrollments ?? []).filter((e) => Boolean(e.crm_client_id)).length;
  const internal = (enrollments ?? []).filter((e) => Boolean(e.user_id)).length;
  const atRisk = (progress ?? []).filter((p: { risk_level?: string | null }) => ["high", "critical"].includes(String(p.risk_level))).length;
  const completed = (progress ?? []).filter((p: { training_status?: string | null }) => String(p.training_status) === "completed").length;
  const avgProgress = (progress ?? []).length ? Math.round((progress ?? []).reduce((s: number, p: { progress_percent?: number | null }) => s + num(p.progress_percent), 0) / (progress ?? []).length) : 0;
  const markedAttendance = (attendance ?? []).filter((a: { attendance_status?: string | null }) => String(a.attendance_status) !== "unmarked");
  const presentAttendance = markedAttendance.filter((a: { attendance_status?: string | null }) => ["present", "late"].includes(String(a.attendance_status))).length;
  const attendanceRate = markedAttendance.length ? Math.round((presentAttendance / markedAttendance.length) * 100) : 0;
  const currencies = [...new Set([...agreedByCurrency.keys(), ...paidByCurrency.keys()])];

  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/dashboard/academy" className="font-black text-violet-700">← Super Leader Academy</Link><Link href="/dashboard/academy/trainers" className="rounded-xl border bg-white px-4 py-2 text-sm font-black">Affectations Academy</Link></div>
    <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white"><p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">Analyse & décisions</p><h1 className="mt-2 text-4xl font-black">{String(school.name)}</h1><p className="mt-3 max-w-4xl text-slate-300">Vue consolidée en lecture seule pour aider la direction de l’école à décider : étudiants, progression, présence, finances et qualité des inscriptions.</p></header>
    <form className="rounded-2xl border bg-white p-4"><label className="text-sm font-black">Grande École<select name="school" defaultValue={schoolId} className="ml-3 rounded-xl border px-3 py-2">{schools.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label><button className="ml-3 rounded-xl bg-violet-700 px-4 py-2 font-black text-white">Afficher</button></form>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Kpi label="Étudiants" value={(enrollments ?? []).length}/><Kpi label="Internes" value={internal}/><Kpi label="Externes" value={external}/><Kpi label="Inscriptions incomplètes" value={incomplete}/><Kpi label="À risque" value={atRisk}/><Kpi label="Progression moyenne" value={`${avgProgress}%`}/></section>
    <section className="grid gap-4 lg:grid-cols-3"><Panel title="Pilotage académique"><Line label="Programmes" value={(programs ?? []).length}/><Line label="Cohortes" value={(cohorts ?? []).length}/><Line label="Sessions récentes" value={(sessions ?? []).length}/><Line label="Complétions" value={completed}/><Line label="Assiduité" value={`${attendanceRate}%`}/></Panel><Panel title="Qualité des données"><Line label="Sans programme / cohorte" value={incomplete}/><Line label="Dossiers avec finance" value={financeBy.size}/><Line label="Dossiers à risque" value={atRisk}/><Link href="/dashboard/academy/students?incomplete=1" className="mt-4 inline-flex rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-950">Régulariser les inscriptions →</Link></Panel><Panel title="Finances consolidées">{currencies.length ? currencies.map((c) => <div key={c} className="mb-3 rounded-xl bg-slate-50 p-3"><p className="font-black">{c}</p><p className="text-sm text-slate-600">Convenu {money(agreedByCurrency.get(c) ?? 0, c)}</p><p className="text-sm text-emerald-700">Payé {money(paidByCurrency.get(c) ?? 0, c)}</p><p className="text-sm text-amber-700">Remises {money(discountsByCurrency.get(c) ?? 0, c)}</p><p className="text-sm font-black text-rose-700">Solde {money(Math.max(0, (agreedByCurrency.get(c) ?? 0) - (paidByCurrency.get(c) ?? 0)), c)}</p></div>) : <p className="text-sm text-slate-500">Aucune donnée financière.</p>}</Panel></section>
    <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">Rôle Analyste de données : lecture et consolidation uniquement. Il n’accorde aucun droit automatique de modifier les tarifs, paiements, RH ou Administration.</p>
  </div></main>;
}
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border bg-white p-5"><p className="text-3xl font-black">{value}</p><p className="mt-1 text-xs font-black uppercase tracking-wide text-slate-500">{label}</p></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-3xl border bg-white p-6"><h2 className="text-xl font-black">{title}</h2><div className="mt-4 space-y-2">{children}</div></section>; }
function Line({ label, value }: { label: string; value: string | number }) { return <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><span className="text-sm font-bold text-slate-600">{label}</span><span className="font-black">{value}</span></div>; }
