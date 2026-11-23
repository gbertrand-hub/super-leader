import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  issueStudentCardAction,
  revokeStudentCardAction,
} from "@/app/actions/academy-student-cards";
import { PrintStudentCardButton } from "@/components/academy/print-student-card-button";
import { getStudentCardVerificationUrl } from "@/lib/academy/student-card-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {enrollmentVisibleTo,getAcademyAssignments,hasSchoolAccess} from "@/lib/academy/access";
type Props = {
  params: Promise<{ cardId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] || "" : v || "";
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export default async function CardPage({ params, searchParams }: Props) {
  const { cardId } = await params,
    q = (await searchParams) || {};
  const s = await createClient();
  const { data: auth } = await s.auth.getUser();
  if (!auth.user) redirect("/login");
  const a = createAdminClient();
  const { data: m } = await a
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) redirect("/dashboard/company");
  const { data: c } = await a
    .from("academy_student_cards")
    .select("*")
    .eq("id", cardId)
    .eq("organization_id", m.organization_id)
    .maybeSingle();
  if (!c) notFound();
  const { data: e } = await a
    .from("academy_school_enrollments")
    .select("school_id,program_id,cohort_id,assigned_follow_up_user_id")
    .eq("id", c.enrollment_id)
    .single<{school_id:string;program_id:string|null;cohort_id:string|null;assigned_follow_up_user_id:string|null}>();
  const assignments=await getAcademyAssignments(a,m.organization_id,auth.user.id);
  if(!e||!hasSchoolAccess(m.role,assignments,e.school_id)||!enrollmentVisibleTo(auth.user.id,m.role,assignments,e.school_id,e))notFound();
  const today = new Date().toISOString().slice(0, 10),
    valid =
      c.status === "active" && c.valid_from <= today && c.valid_until >= today,
    canManage = ["owner", "admin", "hr"].includes(m.role),
    verify = getStudentCardVerificationUrl(c.verification_token);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  return (
    <main className="min-h-screen bg-slate-100 px-5 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex justify-between gap-3 print:hidden">
          <Link
            href={`/dashboard/academy/schools/${e?.school_id}/students`}
            className="font-black text-violet-700"
          >
            ← Centre de suivi
          </Link>
          <PrintStudentCardButton />
        </div>
        {first(q.success) ? (
          <p className="mb-4 rounded-xl bg-emerald-100 p-4 font-bold">
            {first(q.success)}
          </p>
        ) : null}
        {first(q.error) ? (
          <p className="mb-4 rounded-xl bg-red-100 p-4 font-bold text-red-900">
            {first(q.error)}
          </p>
        ) : null}
        <article className="relative mx-auto aspect-[1.586/1] max-w-4xl overflow-hidden rounded-[2.2rem] bg-slate-950 p-8 text-white shadow-2xl print:max-w-none print:rounded-none">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-violet-600/50 blur-2xl" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-amber-400/25 blur-2xl" />
          <div className="relative flex h-full flex-col justify-between">
            <header className="flex items-start justify-between">
              <Image
                src={
                  c.school_logo_storage_path_snapshot
                    ? `/api/student/card-logo/${c.verification_token}`
                    : "/branding/ilead-global-logo.png"
                }
                alt={c.school_name_snapshot}
                width={230}
                height={144}
                unoptimized={Boolean(c.school_logo_storage_path_snapshot)}
                className="h-auto w-40 rounded-xl bg-white p-2 object-contain"
              />
              <div className="text-right">
                <p className="text-xs font-black uppercase tracking-[.25em] text-amber-300">
                  iLEAD GLOBAL INSTITUTE
                </p>
                <p className="mt-2 text-sm font-black uppercase">
                  Carte officielle d’étudiant
                </p>
                <span
                  className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${valid ? "bg-emerald-400/20 text-emerald-200" : "bg-red-400/20 text-red-200"}`}
                >
                  {valid ? "ACTIVE" : "NON VALIDE"}
                </span>
              </div>
            </header>
            <section className="grid grid-cols-[auto_1fr_auto] items-center gap-6">
              <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl border border-white/20 bg-white/10 text-4xl font-black">
                {c.photo_url_snapshot?<Image src={`/api/student/card-photo/${c.verification_token}`} alt={c.full_name_snapshot} width={160} height={160} unoptimized className="h-full w-full object-cover"/>:initials(c.full_name_snapshot)}
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[.15em] text-violet-200">
                  {c.school_name_snapshot}
                </p>
                <h1 className="mt-2 text-4xl font-black">
                  {c.full_name_snapshot}
                </h1>
                <p className="mt-2 text-sm text-slate-300">
                  {[c.program_name_snapshot, c.cohort_name_snapshot]
                    .filter(Boolean)
                    .join(" · ") || "Apprenant iLEAD"}
                </p>
                <p className="mt-4 font-mono font-black text-amber-200">
                  {c.card_number}
                </p>
                {c.internal_training_snapshot ? (
                  <span className="mt-3 inline-flex rounded-full bg-blue-400/20 px-3 py-1 text-xs font-black text-blue-200">
                    FORMATION INTERNE
                  </span>
                ) : null}
              </div>
              <div className="rounded-2xl bg-white p-2 text-center">
                <Image
                  src={`/api/student/card-qr/${c.verification_token}`}
                  alt="QR de vérification"
                  width={150}
                  height={150}
                  unoptimized
                  className="h-32 w-32"
                />
                <p className="text-[9px] font-black uppercase text-slate-700">
                  Scanner pour vérifier
                </p>
              </div>
            </section>
            <footer className="flex justify-between border-t border-white/15 pt-4 text-sm">
              <div>
                <p className="text-slate-400">Valide du</p>
                <p className="font-black">{c.valid_from}</p>
              </div>
              <div>
                <p className="text-slate-400">Expire le</p>
                <p className="font-black">{c.valid_until}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400">Statut académique</p>
                <p className="font-black">{c.academic_status_snapshot}</p>
              </div>
            </footer>
          </div>
        </article>
        <section className="mx-auto mt-6 max-w-4xl rounded-3xl bg-white p-6 shadow print:hidden">
          <Link
            href={verify}
            target="_blank"
            className="block break-all rounded-xl bg-slate-50 p-4 font-bold text-violet-700"
          >
            {verify}
          </Link>
          {canManage && c.status === "active" ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <form
                action={issueStudentCardAction}
                className="rounded-2xl bg-amber-50 p-5"
              >
                <input
                  type="hidden"
                  name="enrollment_id"
                  value={c.enrollment_id}
                />
                <input type="hidden" name="school_id" value={e?.school_id} />
                <h2 className="font-black">Réémettre ou renouveler</h2>
                <input
                  name="valid_from"
                  type="date"
                  defaultValue={today}
                  className="mt-3 w-full rounded-xl border p-3"
                />
                <input
                  name="valid_until"
                  type="date"
                  defaultValue={nextYear.toISOString().slice(0, 10)}
                  required
                  className="mt-3 w-full rounded-xl border p-3"
                />
                <input
                  name="reason"
                  required
                  placeholder="Motif"
                  className="mt-3 w-full rounded-xl border p-3"
                />
                <button className="mt-3 rounded-xl bg-amber-500 px-4 py-3 font-black">
                  Créer la nouvelle carte
                </button>
              </form>
              <form
                action={revokeStudentCardAction}
                className="rounded-2xl bg-red-50 p-5"
              >
                <input type="hidden" name="card_id" value={c.id} />
                <h2 className="font-black text-red-950">Révoquer la carte</h2>
                <input
                  name="reason"
                  required
                  minLength={5}
                  placeholder="Motif obligatoire"
                  className="mt-3 w-full rounded-xl border p-3"
                />
                <button className="mt-3 rounded-xl bg-red-700 px-4 py-3 font-black text-white">
                  Révoquer
                </button>
              </form>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
