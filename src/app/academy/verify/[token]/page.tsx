import type {Metadata} from "next";
import Image from "next/image";
import {notFound} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Certificate verification - Super Leader Academy",
  robots: {index: false, follow: false},
};

type Props = {params: Promise<{token: string}>};
type Certificate = {
  organization_id: string;
  course_id: string;
  enrollment_id: string;
  user_id: string;
  certificate_number: string;
  final_score: number | string | null;
  issued_at: string;
  status: string;
  revocation_reason: string | null;
};

export default async function VerifyAcademyCertificatePage({params}: Props) {
  const {token} = await params;
  const {t, locale} = await getI18n();
  const admin = createAdminClient();
  const {data: certificate} = await admin
    .from("academy_certificates")
    .select("organization_id, course_id, enrollment_id, user_id, certificate_number, final_score, issued_at, status, revocation_reason")
    .eq("verification_token", token)
    .maybeSingle<Certificate>();
  if (!certificate) notFound();

  const [{data: course}, {data: enrollment}, {data: profile}, {data: organization}] = await Promise.all([
    admin.from("academy_courses").select("title").eq("id", certificate.course_id).maybeSingle<{title: string}>(),
    admin
      .from("academy_enrollments")
      .select("attendance_percent, sessions_attended, sessions_expected")
      .eq("id", certificate.enrollment_id)
      .maybeSingle<{attendance_percent: number | string; sessions_attended: number; sessions_expected: number}>(),
    admin.from("profiles").select("full_name").eq("id", certificate.user_id).maybeSingle<{full_name: string | null}>(),
    admin.from("organizations").select("name").eq("id", certificate.organization_id).maybeSingle<{name: string}>(),
  ]);
  if (!course || !profile || !organization) notFound();

  const active = certificate.status === "active";
  const formatter = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "long"});
  const issued = formatter.format(new Date(certificate.issued_at));
  const verifiedAt = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-950 sm:py-14">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <header className="flex flex-col items-center justify-between gap-5 border-b border-slate-200 px-7 py-7 sm:flex-row sm:px-10">
          <Image
            src="/branding/ilead-global-logo.png"
            alt="iLEAD Global"
            width={230}
            height={144}
            priority
            className="h-auto w-48 object-contain sm:w-56"
          />
          <div className="text-center sm:text-right">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-600">SUPER LEADER ACADEMY</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">{t("academy.certificate.verificationTitle")}</h1>
          </div>
        </header>

        <div className="px-7 py-8 sm:px-10">
          <div className={`rounded-2xl p-5 ${active ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <p className="text-2xl font-black">{active ? `✓ ${t("academy.certificate.valid")}` : t("academy.certificate.revokedStatus")}</p>
            <p className="mt-2 text-sm font-semibold opacity-80">{t("academy.certificate.verificationIntro")}</p>
            {!active && certificate.revocation_reason ? <p className="mt-3 font-bold">{certificate.revocation_reason}</p> : null}
          </div>

          <dl className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-5 sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.recipient")}</dt>
              <dd className="mt-1 text-2xl font-black">{profile.full_name || t("academy.certificate.memberFallback")}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5 sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.training")}</dt>
              <dd className="mt-1 text-xl font-black">{course.title}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.organization")}</dt>
              <dd className="mt-1 font-black">{organization.name}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.number")}</dt>
              <dd className="mt-1 break-all font-mono font-black">{certificate.certificate_number}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.date")}</dt>
              <dd className="mt-1 font-black">{issued}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.score")}</dt>
              <dd className="mt-1 font-black">{certificate.final_score == null ? "—" : `${Number(certificate.final_score)} %`}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5 sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{t("academy.certificate.attendance")}</dt>
              <dd className="mt-1 font-black">
                {enrollment ? `${Number(enrollment.attendance_percent)} % (${enrollment.sessions_attended}/${enrollment.sessions_expected})` : "—"}
              </dd>
            </div>
          </dl>

          <div className="mt-7 rounded-2xl border border-slate-200 p-5 text-center">
            <p className="text-sm font-black">{t("academy.certificate.officialIssuer")}</p>
            <p className="mt-1 text-sm text-slate-500">{t("academy.certificate.verifiedAt", {date: verifiedAt})}</p>
          </div>
        </div>
      </article>
    </main>
  );
}
