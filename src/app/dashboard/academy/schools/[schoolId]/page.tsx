import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { uploadAcademySchoolLogoAction } from "@/app/actions/academy-school-branding";
import {
  createAcademyCohortAction,
  createAcademyProgramAction,
  updateAcademyCohortAction,
  updateAcademyProgramAction,
} from "@/app/actions/academy-programs-cohorts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  enrollmentVisibleTo,
  canEnrollStudents,
  getAcademyAssignments,
  hasSchoolAccess,
} from "@/lib/academy/access";

type Props = {params:Promise<{schoolId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>};
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]??"":v??"";
const input="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
export default async function SchoolDashboard({ params,searchParams }: Props) {
  const { schoolId } = await params;
  const query=(await searchParams)??{};
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) redirect("/dashboard/company");
  const accessAssignments = await getAcademyAssignments(
    admin,
    membership.organization_id,
    auth.user.id,
  );
  if (!hasSchoolAccess(membership.role, accessAssignments, schoolId))
    notFound();
  const { data: school } = await admin
    .from("academy_schools")
    .select("id,name,description,logo_storage_path")
    .eq("id", schoolId)
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .maybeSingle<{
      id: string;
      name: string;
      description: string;
      logo_storage_path: string | null;
    }>();
  if (!school) notFound();
  const [programs, cohorts, enrollments, assignmentsResult] = await Promise.all(
    [
      admin
        .from("academy_programs")
        .select("id,code,name,description,duration_months,status")
        .eq("school_id", schoolId)
        .order("name"),
      admin
        .from("academy_cohorts")
        .select("id,program_id,name,status,starts_on,ends_on,capacity")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false }),
      admin
        .from("academy_school_enrollments")
        .select(
          "id,user_id,crm_client_id,program_id,cohort_id,academic_status,source,assigned_follow_up_user_id",
        )
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false }),
      admin
        .from("academy_staff_assignments")
        .select("id,user_id,assignment_role,is_active")
        .eq("school_id", schoolId)
        .eq("is_active", true),
    ],
  );
  const e = (enrollments.data ?? []).filter((x) =>
    enrollmentVisibleTo(
      auth.user.id,
      membership.role,
      accessAssignments,
      schoolId,
      x,
    ),
  );
  const userIds = [
    ...new Set(e.map((x) => x.user_id).filter(Boolean) as string[]),
  ];
  const crmIds = [
    ...new Set(e.map((x) => x.crm_client_id).filter(Boolean) as string[]),
  ];
  const [profiles, clients] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id,full_name,email").in("id", userIds)
      : { data: [] },
    crmIds.length
      ? admin
          .from("crm_clients")
          .select("id,full_name,email,status")
          .in("id", crmIds)
      : { data: [] },
  ]);
  const people = new Map<string, { name: string; detail: string }>();
  const canManageAcademics=canEnrollStudents(membership.role,accessAssignments,schoolId);
  (profiles.data ?? []).forEach((x) =>
    people.set(String(x.id), {
      name: String(x.full_name || x.email || "Membre du staff"),
      detail: "Staff",
    }),
  );
  (clients.data ?? []).forEach((x) =>
    people.set(String(x.id), {
      name: String(x.full_name),
      detail: String(x.status) === "prospect" ? "Prospect CRM" : "Client CRM",
    }),
  );
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/dashboard/academy/schools"
          className="font-bold text-violet-700"
        >
          ← Grandes Écoles
        </Link>
        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <div className="flex gap-6">
            {school.logo_storage_path ? (
              <Image
                src={`/api/academy/school-logo/${school.id}`}
                alt={`Logo ${school.name}`}
                width={160}
                height={160}
                unoptimized
                className="h-28 w-28 rounded-2xl bg-white object-contain p-2"
              />
            ) : null}
            <div>
              <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
                Dashboard de l’école
              </p>
              <h1 className="mt-2 text-4xl font-black">{school.name}</h1>
              <p className="mt-3 text-slate-300">{school.description}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={`/dashboard/academy/schools/${school.id}/students`}
                  className="inline-flex rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950"
                >
                  Ouvrir le centre de suivi des étudiants →
                </Link>
                {canManageAcademics ? (
                  <Link
                    href={`/dashboard/academy/structure/${school.id}?organization=${encodeURIComponent(membership.organization_id)}`}
                    className="inline-flex rounded-xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-black text-white"
                  >
                    Corriger la structure académique →
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        {first(query.success)?<p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">{first(query.success)}</p>:null}
        {first(query.error)?<p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">{first(query.error)}</p>:null}
        {["owner", "admin", "hr"].includes(membership.role) ? (
          <form
            action={uploadAcademySchoolLogoAction}
            className="mt-5 flex flex-wrap items-end gap-4 rounded-2xl border bg-white p-5"
          >
            <input type="hidden" name="school_id" value={school.id} />
            <label className="font-bold">
              Logo de l’école (PNG/JPG/WEBP, 2 Mo max)
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                required
                className="mt-2 block rounded-xl border p-3"
              />
            </label>
            <button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">
              Téléverser le logo
            </button>
          </form>
        ) : null}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card n={programs.data?.length ?? 0} label="Programmes" />
          <Card n={cohorts.data?.length ?? 0} label="Cohortes" />
          <Card n={e.length} label="Apprenants visibles" />
          <Card n={assignmentsResult.data?.length ?? 0} label="Staff assigné" />
        </section>
        {canManageAcademics?<section className="mt-6 grid gap-5 lg:grid-cols-2"><details className="rounded-3xl border bg-white p-6"><summary className="cursor-pointer text-xl font-black">Créer un programme</summary><form action={createAcademyProgramAction} className="mt-5 grid gap-4"><input type="hidden" name="school_id" value={schoolId}/><Label title="Nom du programme"><input name="name" required minLength={3} placeholder="Leadership des jeunes" className={input}/></Label><Label title="Code (facultatif)"><input name="code" placeholder="leadership_jeunes" className={input}/></Label><Label title="Durée en mois"><input name="duration_months" type="number" min="1" max="120" className={input}/></Label><Label title="Description"><textarea name="description" rows={3} className={input}/></Label><button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Créer le programme</button></form></details><details className="rounded-3xl border bg-white p-6"><summary className="cursor-pointer text-xl font-black">Créer une cohorte</summary><form action={createAcademyCohortAction} className="mt-5 grid gap-4"><input type="hidden" name="school_id" value={schoolId}/><Label title="Nom de la cohorte"><input name="name" required minLength={2} placeholder="Promotion 2026" className={input}/></Label><Label title="Programme"><select name="program_id" className={input}><option value="">À rattacher plus tard</option>{programs.data?.filter(x=>x.status==="active").map(x=><option key={x.id} value={String(x.id)}>{String(x.name)}</option>)}</select></Label><div className="grid grid-cols-2 gap-3"><Label title="Début"><input name="starts_on" type="date" className={input}/></Label><Label title="Fin"><input name="ends_on" type="date" className={input}/></Label></div><div className="grid grid-cols-2 gap-3"><Label title="Capacité"><input name="capacity" type="number" min="1" className={input}/></Label><Label title="Statut"><select name="status" className={input}><option value="planned">Planifiée</option><option value="open">Ouverte</option><option value="active">Active</option></select></Label></div><button className="rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950">Créer la cohorte</button></form></details></section>:null}
        <section className="mt-7 grid gap-6 lg:grid-cols-2">
          <Panel title="Programmes académiques">
            {programs.data?.length ? (
              programs.data.map((x) => {
                const enrolled = e.filter((item) => item.program_id === x.id).length;
                return canManageAcademics ? (
                  <details key={x.id} className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span>
                        <span className="font-bold">{String(x.name)}</span>
                        <span className="ml-2 text-xs font-bold text-violet-700">
                          {enrolled} étudiant(s)
                        </span>
                      </span>
                      <span className="text-sm font-bold text-violet-700">
                        Modifier · {String(x.status)}
                      </span>
                    </summary>
                    <form action={updateAcademyProgramAction} className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4">
                      <input type="hidden" name="school_id" value={schoolId}/>
                      <input type="hidden" name="program_id" value={String(x.id)}/>
                      <input type="hidden" name="return_to" value={`/dashboard/academy/schools/${schoolId}`}/>
                      <Label title="Nom"><input name="name" required minLength={3} defaultValue={String(x.name)} className={input}/></Label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Label title="Code"><input name="code" defaultValue={String(x.code ?? "")} className={input}/></Label>
                        <Label title="Durée en mois"><input name="duration_months" type="number" min="1" max="120" defaultValue={x.duration_months ? String(x.duration_months) : ""} className={input}/></Label>
                      </div>
                      <Label title="Description"><textarea name="description" rows={3} defaultValue={String(x.description ?? "")} className={input}/></Label>
                      <Label title="Statut"><select name="status" defaultValue={String(x.status)} className={input}><option value="draft">Brouillon</option><option value="active">Actif</option><option value="archived">Archivé</option></select></Label>
                      <p className="text-xs text-slate-500">Archiver masque le programme des nouvelles affectations sans effacer son historique.</p>
                      <button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Enregistrer les modifications</button>
                    </form>
                  </details>
                ) : <Row key={x.id} main={String(x.name)} side={String(x.status)} />;
              })
            ) : (
              <Empty />
            )}
          </Panel>
          <Panel title="Cohortes et promotions">
            {cohorts.data?.length ? (
              cohorts.data.map((x) => {
                const enrolled = e.filter((item) => item.cohort_id === x.id).length;
                return canManageAcademics ? (
                  <details key={x.id} className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span>
                        <span className="font-bold">{String(x.name)}</span>
                        <span className="ml-2 text-xs font-bold text-violet-700">
                          {enrolled}{x.capacity ? `/${x.capacity}` : ""} étudiant(s)
                        </span>
                      </span>
                      <span className="text-sm font-bold text-violet-700">
                        Modifier · {String(x.status)}
                      </span>
                    </summary>
                    <form action={updateAcademyCohortAction} className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4">
                      <input type="hidden" name="school_id" value={schoolId}/>
                      <input type="hidden" name="cohort_id" value={String(x.id)}/>
                      <input type="hidden" name="return_to" value={`/dashboard/academy/schools/${schoolId}`}/>
                      <Label title="Nom"><input name="name" required minLength={2} defaultValue={String(x.name)} className={input}/></Label>
                      <Label title="Programme"><select name="program_id" defaultValue={String(x.program_id ?? "")} className={input}><option value="">Sans programme</option>{programs.data?.filter((p)=>p.status === "active" || p.id === x.program_id).map((p)=><option key={p.id} value={String(p.id)}>{String(p.name)}</option>)}</select></Label>
                      <div className="grid gap-3 sm:grid-cols-2"><Label title="Début"><input name="starts_on" type="date" defaultValue={String(x.starts_on ?? "")} className={input}/></Label><Label title="Fin"><input name="ends_on" type="date" defaultValue={String(x.ends_on ?? "")} className={input}/></Label></div>
                      <div className="grid gap-3 sm:grid-cols-2"><Label title="Capacité"><input name="capacity" type="number" min="1" defaultValue={x.capacity ? String(x.capacity) : ""} className={input}/></Label><Label title="Statut"><select name="status" defaultValue={String(x.status)} className={input}><option value="planned">Planifiée</option><option value="open">Ouverte</option><option value="active">Active</option><option value="completed">Terminée</option><option value="archived">Archivée</option></select></Label></div>
                      <p className="text-xs text-slate-500">Les étudiants déjà inscrits restent liés lorsque la cohorte est archivée.</p>
                      <button className="rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950">Enregistrer les modifications</button>
                    </form>
                  </details>
                ) : <Row key={x.id} main={String(x.name)} side={String(x.status)} />;
              })
            ) : (
              <Empty />
            )}
          </Panel>
        </section>
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">Apprenants</h2>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">
              Identités liées, sans duplication
            </span>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {e.length ? (
              e.slice(0, 20).map((x) => {
                const p = people.get(String(x.user_id || x.crm_client_id));
                return (
                  <div
                    key={x.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="font-bold">{p?.name ?? "Identité liée"}</p>
                      <p className="text-sm text-slate-500">
                        {p?.detail} ·{" "}
                        {x.source === "staff_automatic"
                          ? "Inscription automatique"
                          : "Inscription académique"}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                      {x.academic_status}
                    </span>
                  </div>
                );
              })
            ) : (
              <Empty />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
function Card({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-3xl font-black">{n}</p>
      <p className="text-sm font-bold text-slate-500">{label}</p>
    </div>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-4 divide-y divide-slate-100">{children}</div>
    </div>
  );
}
function Row({ main, side }: { main: string; side: string }) {
  return (
    <div className="flex justify-between py-3">
      <span className="font-bold">{main}</span>
      <span className="text-sm text-slate-500">{side}</span>
    </div>
  );
}
function Label({title,children}:{title:string;children:React.ReactNode}){return <label className="text-sm font-bold text-slate-700">{title}{children}</label>}
function Empty() {
  return (
    <p className="py-5 text-sm text-slate-500">Aucune donnée pour le moment.</p>
  );
}
