import Image from "next/image";
import {notFound} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Props = {params: Promise<{token: string}>};
type Badge = {
  id: string;
  organization_id: string;
  user_id: string;
  badge_number: string;
  issue_number: number;
  status: string;
  valid_from: string;
  valid_until: string;
  needs_reissue: boolean;
  full_name_snapshot: string;
  role_label_snapshot: string;
  position_title_snapshot: string | null;
  department_snapshot: string | null;
  team_name_snapshot: string | null;
  organization_name_snapshot: string;
  suspension_reason: string | null;
  revocation_reason: string | null;
};

export default async function EmployeeBadgeVerificationPage({params}: Props) {
  const {token} = await params;
  const admin = createAdminClient();
  const {data: badge, error} = await admin
    .from("employee_badges")
    .select("id,organization_id,user_id,badge_number,issue_number,status,valid_from,valid_until,needs_reissue,full_name_snapshot,role_label_snapshot,position_title_snapshot,department_snapshot,team_name_snapshot,organization_name_snapshot,suspension_reason,revocation_reason")
    .eq("verification_token", token)
    .maybeSingle<Badge>();
  if (error || !badge) notFound();

  const {data: membership} = await admin
    .from("organization_members")
    .select("is_active")
    .eq("organization_id", badge.organization_id)
    .eq("user_id", badge.user_id)
    .maybeSingle<{is_active: boolean}>();

  const today = new Date().toISOString().slice(0, 10);
  const effectiveStatus = !membership?.is_active
    ? "revoked"
    : badge.status === "active" && badge.valid_until < today
      ? "expired"
      : badge.status;
  const valid = effectiveStatus === "active";
  const formatDate = (value: string) => new Intl.DateTimeFormat("fr-FR", {dateStyle: "long"}).format(new Date(`${value}T00:00:00Z`));
  const statusCopy: Record<string, {title: string; help: string}> = {
    active: {title: "Badge actif et vérifié", help: "Le collaborateur possède actuellement une appartenance active à l’organisation."},
    suspended: {title: "Badge suspendu", help: "Ce badge ne doit pas être accepté jusqu’à sa réactivation officielle."},
    revoked: {title: "Badge révoqué", help: "Ce badge n’est plus valable, même si une copie physique existe encore."},
    expired: {title: "Badge expiré", help: "La date de validité est dépassée. Un renouvellement est nécessaire."},
    replaced: {title: "Badge remplacé", help: "Une édition plus récente a été émise. Cette copie ne doit plus être utilisée."},
  };
  const copy = statusCopy[effectiveStatus] ?? {title: "Badge non valide", help: "Ce badge ne peut pas être confirmé."};

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <section className="overflow-hidden rounded-[2rem] bg-white shadow-2xl">
          <header className={`p-7 text-white ${valid ? "bg-emerald-700" : effectiveStatus === "suspended" ? "bg-amber-600" : "bg-red-700"}`}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <Image src="/branding/ilead-global-logo.png" alt="iLEAD Global" width={230} height={150} preload className="h-auto w-44 rounded-xl bg-white p-2 object-contain" />
              <div className="text-left sm:text-right">
                <p className="text-xs font-black uppercase tracking-[0.18em]">Vérification officielle</p>
                <h1 className="mt-2 text-3xl font-black">{copy.title}</h1>
              </div>
            </div>
          </header>

          <div className="p-7 sm:p-9">
            <p className={`inline-flex rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${valid ? "bg-emerald-100 text-emerald-800" : effectiveStatus === "suspended" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{effectiveStatus}</p>
            <h2 className="mt-5 text-4xl font-black">{badge.full_name_snapshot}</h2>
            <p className="mt-2 text-lg font-bold text-slate-600">{badge.position_title_snapshot || badge.role_label_snapshot}</p>
            <p className="mt-1 text-slate-500">{[badge.department_snapshot, badge.team_name_snapshot].filter(Boolean).join(" · ") || badge.organization_name_snapshot}</p>

            <dl className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">Numéro du badge</dt><dd className="mt-2 font-mono text-lg font-black">{badge.badge_number}</dd></div>
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">Organisation</dt><dd className="mt-2 text-lg font-black">{badge.organization_name_snapshot}</dd></div>
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">Valide depuis</dt><dd className="mt-2 font-black">{formatDate(badge.valid_from)}</dd></div>
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">Expiration</dt><dd className="mt-2 font-black">{formatDate(badge.valid_until)}</dd></div>
            </dl>

            <p className={`mt-7 rounded-2xl p-5 font-bold leading-7 ${valid ? "bg-emerald-50 text-emerald-900" : effectiveStatus === "suspended" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900"}`}>{copy.help}</p>
            {badge.needs_reissue && valid ? <p className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm font-bold text-cyan-900">Les informations internes ont changé depuis l’impression de cette édition. Le badge reste actif, mais une réédition administrative est attendue.</p> : null}

            <p className="mt-8 border-t border-slate-200 pt-5 text-center text-xs font-bold leading-5 text-slate-500">Cette page est la seule source de validité. Une carte imprimée ou une capture d’écran ne remplace jamais la vérification du QR code.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
