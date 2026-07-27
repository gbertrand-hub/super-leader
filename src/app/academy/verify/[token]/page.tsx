import {notFound} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";

type Props = {params: Promise<{token: string}>};

export default async function VerifyAcademyCertificatePage({params}: Props) {
  const {token} = await params;
  const admin = createAdminClient();
  const {data: certificate} = await admin.from("academy_certificates").select("id, organization_id, course_id, enrollment_id, user_id, certificate_number, final_score, issued_at, status").eq("verification_token", token).maybeSingle<{
    organization_id: string; course_id: string; enrollment_id: string; user_id: string; certificate_number: string; final_score: number | string | null; issued_at: string; status: string;
  }>();
  if (!certificate) notFound();
  const [{data: course}, {data: enrollment}, {data: profile}, {data: organization}] = await Promise.all([
    admin.from("academy_courses").select("title").eq("id", certificate.course_id).maybeSingle<{title: string}>(),
    admin.from("academy_enrollments").select("attendance_percent, sessions_attended, sessions_expected").eq("id", certificate.enrollment_id).maybeSingle<{attendance_percent: number | string; sessions_attended: number; sessions_expected: number}>(),
    admin.from("profiles").select("full_name").eq("id", certificate.user_id).maybeSingle<{full_name: string | null}>(),
    admin.from("organizations").select("name").eq("id", certificate.organization_id).maybeSingle<{name: string}>(),
  ]);
  if (!course || !profile || !organization) notFound();
  const active = certificate.status === "active";
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-14 text-slate-950">
      <article className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-2xl">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-amber-600">Super Leader Academy</p>
        <h1 className="mt-3 text-3xl font-black">Certificate verification</h1>
        <div className={`mt-6 rounded-2xl p-5 ${active ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}><p className="text-xl font-black">{active ? "✓ Certificate valid" : "Certificate revoked"}</p></div>
        <dl className="mt-6 space-y-4 text-sm"><div><dt className="font-bold text-slate-500">Recipient</dt><dd className="text-lg font-black">{profile.full_name || "Super Leader member"}</dd></div><div><dt className="font-bold text-slate-500">Training</dt><dd className="font-black">{course.title}</dd></div><div><dt className="font-bold text-slate-500">Organisation</dt><dd className="font-black">{organization.name}</dd></div><div><dt className="font-bold text-slate-500">Certificate number</dt><dd className="font-mono font-black">{certificate.certificate_number}</dd></div><div><dt className="font-bold text-slate-500">Issued</dt><dd>{new Intl.DateTimeFormat("en-GB", {dateStyle: "long"}).format(new Date(certificate.issued_at))}</dd></div>{certificate.final_score != null ? <div><dt className="font-bold text-slate-500">Final score</dt><dd>{Number(certificate.final_score)}%</dd></div> : null}{enrollment ? <div><dt className="font-bold text-slate-500">Attendance</dt><dd>{Number(enrollment.attendance_percent)}% ({enrollment.sessions_attended}/{enrollment.sessions_expected})</dd></div> : null}</dl>
      </article>
    </main>
  );
}
