import Link from "next/link";
import {notFound, redirect} from "next/navigation";
import {PrintCertificateButton} from "@/components/academy/print-certificate-button";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {params: Promise<{certificateId: string}>};
type Membership = {organization_id: string; role: string};
type Certificate = {
  id: string;
  organization_id: string;
  course_id: string;
  user_id: string;
  certificate_number: string;
  verification_token: string;
  final_score: number | string | null;
  issued_at: string;
  status: string;
};

export default async function AcademyCertificatePage({params}: Props) {
  const {certificateId} = await params;
  const {t, locale} = await getI18n();
  const supabase = await createClient();
  const {data: auth, error} = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id, role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const {data: certificate} = await admin.from("academy_certificates").select("id, organization_id, course_id, user_id, certificate_number, verification_token, final_score, issued_at, status").eq("id", certificateId).eq("organization_id", membership.organization_id).maybeSingle<Certificate>();
  if (!certificate) notFound();
  const visibleUserIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: auth.user.id, role: membership.role});
  if (!visibleUserIds.includes(certificate.user_id)) redirect("/dashboard/academy?error=access-denied");

  const [{data: course}, {data: profile}, {data: organization}] = await Promise.all([
    admin.from("academy_courses").select("title, duration_minutes").eq("id", certificate.course_id).maybeSingle<{title: string; duration_minutes: number}>(),
    admin.from("profiles").select("full_name, email").eq("id", certificate.user_id).maybeSingle<{full_name: string | null; email: string | null}>(),
    admin.from("organizations").select("name").eq("id", certificate.organization_id).maybeSingle<{name: string}>(),
  ]);
  if (!course || !profile || !organization) notFound();
  const issued = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "long"}).format(new Date(certificate.issued_at));
  const verifyUrl = `/academy/verify/${certificate.verification_token}`;

  return (
    <main className="min-h-screen bg-slate-100 px-5 py-8 text-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between gap-3 print:hidden">
          <Link href="/dashboard/academy" className="font-black text-indigo-700">← Super Leader Academy</Link>
          <PrintCertificateButton label={t("academy.actions.printCertificate")} />
        </div>
        <article className="relative overflow-hidden rounded-[2.5rem] border-[10px] border-slate-950 bg-white px-10 py-14 shadow-2xl print:min-h-[190mm] print:rounded-none print:shadow-none">
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber-300/30" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-indigo-300/20" />
          <div className="relative text-center">
            <p className="text-sm font-black uppercase tracking-[0.35em] text-amber-600">SUPER LEADER ACADEMY</p>
            <h1 className="mt-7 text-5xl font-black uppercase tracking-tight">{t("academy.certificate.title")}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">{t("academy.certificate.certifies")}</p>
            <p className="mt-8 text-4xl font-black text-indigo-800">{profile.full_name || profile.email}</p>
            <p className="mt-7 text-lg text-slate-600">{t("academy.certificate.completed")}</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-black">{course.title}</h2>
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("academy.certificate.date")}</p><p className="mt-1 font-black">{issued}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("academy.certificate.duration")}</p><p className="mt-1 font-black">{course.duration_minutes} min</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("academy.certificate.score")}</p><p className="mt-1 font-black">{certificate.final_score == null ? "—" : `${Number(certificate.final_score)} %`}</p></div>
            </div>
            <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center justify-between gap-6 border-t border-slate-200 pt-8 sm:flex-row">
              <div className="text-left"><p className="text-sm text-slate-500">{t("academy.certificate.issuedBy")}</p><p className="font-black">{organization.name}</p></div>
              <div className="text-right"><p className="text-sm text-slate-500">{t("academy.certificate.number")}</p><p className="font-mono font-black">{certificate.certificate_number}</p><Link href={verifyUrl} className="mt-2 inline-block text-xs font-bold text-indigo-700 print:text-slate-700">{t("academy.certificate.verify")}</Link></div>
            </div>
            {certificate.status !== "active" ? <p className="mt-8 rounded-xl bg-red-100 p-4 font-black text-red-800">{t("academy.certificate.revoked")}</p> : null}
          </div>
        </article>
      </div>
    </main>
  );
}
