import Image from "next/image";
import Link from "next/link";
import {notFound, redirect} from "next/navigation";
import {PrintBadgeButton} from "@/components/badges/print-badge-button";
import {getI18n} from "@/i18n/server";
import {EMPLOYEE_BADGE_ADMIN_ROLES} from "@/lib/badges/snapshot";
import {createProfileAvatarSignedUrl} from "@/lib/profile/avatar";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {params: Promise<{badgeId: string}>};
type Badge = {
  id: string;
  organization_id: string;
  user_id: string;
  badge_number: string;
  issue_number: number;
  verification_token: string;
  status: string;
  valid_from: string;
  valid_until: string;
  needs_reissue: boolean;
  full_name_snapshot: string;
  email_snapshot: string | null;
  country_snapshot: string | null;
  city_snapshot: string | null;
  avatar_storage_path_snapshot: string | null;
  role_label_snapshot: string;
  position_title_snapshot: string | null;
  department_snapshot: string | null;
  team_name_snapshot: string | null;
  organization_name_snapshot: string;
  suspension_reason: string | null;
  revocation_reason: string | null;
};

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "IL";
}

export default async function EmployeeBadgeCardPage({params}: Props) {
  const {badgeId} = await params;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: badge} = await admin
    .from("employee_badges")
    .select("id,organization_id,user_id,badge_number,issue_number,verification_token,status,valid_from,valid_until,needs_reissue,full_name_snapshot,email_snapshot,country_snapshot,city_snapshot,avatar_storage_path_snapshot,role_label_snapshot,position_title_snapshot,department_snapshot,team_name_snapshot,organization_name_snapshot,suspension_reason,revocation_reason")
    .eq("id", badgeId)
    .maybeSingle<Badge>();
  if (!badge) notFound();

  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("organization_id", badge.organization_id)
    .eq("user_id", auth.user.id)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();
  const canView = badge.user_id === auth.user.id || Boolean(membership?.is_active && EMPLOYEE_BADGE_ADMIN_ROLES.has(membership.role));
  if (!canView) redirect("/dashboard/my-day");

  const {data: subjectMembership} = await admin
    .from("organization_members")
    .select("is_active")
    .eq("organization_id", badge.organization_id)
    .eq("user_id", badge.user_id)
    .maybeSingle<{is_active: boolean}>();

  const avatarUrl = await createProfileAvatarSignedUrl(admin, badge.avatar_storage_path_snapshot, 1800);
  const today = new Date().toISOString().slice(0, 10);
  const effectiveStatus = !subjectMembership?.is_active
    ? "revoked"
    : badge.status === "active" && badge.valid_until < today
      ? "expired"
      : badge.status;
  const printable = effectiveStatus === "active";
  const formatDate = (value: string) => new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
  const location = [badge.city_snapshot, badge.country_snapshot].filter(Boolean).join(", ");

  return (
    <main className="min-h-screen bg-slate-100 px-5 py-8 text-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={badge.user_id === auth.user.id ? "/dashboard/profile/badge" : "/dashboard/badges/manage"} className="font-black text-cyan-800">← {fr ? "Badges" : "Badges"}</Link>
          {printable ? <PrintBadgeButton label={fr ? "Imprimer / Enregistrer en PDF" : "Print / Save as PDF"} /> : null}
        </div>

        {!printable ? <p className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800 print:hidden">{fr ? "Ce badge n’est pas valide et ne peut pas être imprimé." : "This badge is not valid and cannot be printed."}</p> : null}
        {badge.needs_reissue ? <p className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-900 print:hidden">{fr ? "Une nouvelle édition est requise parce que les informations du collaborateur ont changé." : "A new edition is required because the employee details changed."}</p> : null}

        <article className="relative mx-auto aspect-[1.586/1] w-full max-w-4xl overflow-hidden rounded-[2.2rem] bg-slate-950 p-7 text-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none sm:p-10">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/35 blur-3xl" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-red-500/25 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between">
            <header className="relative flex items-start justify-between gap-5">
              <Image src="/branding/ilead-global-logo.png" alt="iLEAD Global" width={260} height={180} preload className="h-auto w-36 rounded-xl bg-white p-2 object-contain sm:w-52" />
              <div className="pointer-events-none absolute left-1/2 top-1 hidden w-[36%] -translate-x-1/2 text-center sm:block">
                <p className="text-[10px] font-black uppercase leading-relaxed tracking-[0.16em] text-amber-200 lg:text-xs">
                  {fr ? "iLEAD Global — ajouter la valeur aux autres" : "iLEAD Global — adding value to others"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-200 sm:text-xs">{fr ? "Badge officiel du collaborateur" : "Official employee badge"}</p>
                <p className={`mt-3 inline-flex rounded-full px-3 py-2 text-[9px] font-black uppercase tracking-wider sm:text-xs ${printable ? "bg-emerald-400/20 text-emerald-200" : effectiveStatus === "suspended" ? "bg-amber-400/20 text-amber-200" : "bg-red-400/20 text-red-200"}`}>
                  {fr ? `Badge ${effectiveStatus}` : `${effectiveStatus} badge`}
                </p>
              </div>
            </header>

            <section className="grid items-center gap-5 sm:grid-cols-[auto_1fr_auto]">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-3xl border border-white/20 bg-white/10 text-3xl font-black sm:h-36 sm:w-36 sm:text-4xl">
                {avatarUrl ? <Image src={avatarUrl} alt={badge.full_name_snapshot} width={144} height={144} unoptimized className="h-full w-full object-cover" /> : initials(badge.full_name_snapshot)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">{badge.role_label_snapshot}</p>
                <h1 className="mt-2 text-3xl font-black leading-tight sm:text-5xl">{badge.full_name_snapshot}</h1>
                <p className="mt-2 text-sm text-slate-300 sm:text-base">{[badge.department_snapshot, badge.team_name_snapshot].filter(Boolean).join(" · ") || badge.organization_name_snapshot}</p>
                {location ? <p className="mt-1 text-sm text-slate-400">{location}</p> : null}
                <p className="mt-4 font-mono text-sm font-black text-amber-200">{badge.badge_number}</p>
              </div>
              <div className="w-32 rounded-2xl bg-white p-2 text-center sm:w-40">
                <Image src={`/api/badges/qr/${badge.verification_token}`} alt={fr ? "QR de vérification" : "Verification QR"} width={160} height={160} unoptimized className="mx-auto h-28 w-28 sm:h-36 sm:w-36" />
                <p className="mt-1 text-[9px] font-black uppercase tracking-wide text-slate-700">{fr ? "Scanner pour vérifier" : "Scan to verify"}</p>
              </div>
            </section>

            <footer className="border-t border-white/15 pt-4">
              <div className="grid gap-3 text-xs sm:grid-cols-4 sm:text-sm">
                <div><p className="text-slate-400">{fr ? "Émis le" : "Issued"}</p><p className="font-black">{formatDate(badge.valid_from)}</p></div>
                <div><p className="text-slate-400">{fr ? "Expire le" : "Expires"}</p><p className="font-black">{formatDate(badge.valid_until)}</p></div>
                <div><p className="text-slate-400">{fr ? "Édition" : "Issue"}</p><p className="font-black">#{badge.issue_number}</p></div>
                <div className="text-right"><p className="text-slate-400">{badge.organization_name_snapshot}</p><p className="font-black">{fr ? "Toujours vérifier le QR" : "Always verify the QR"}</p></div>
              </div>
              <p className="mt-3 text-center text-[8px] font-semibold leading-relaxed text-slate-300 sm:text-[9px] lg:text-[10px]">
                {fr
                  ? "Ce badge demeure la propriété de l’organisation. Il doit être restitué ou détruit en cas de fin de collaboration."
                  : "This badge remains the property of the organization. It must be returned or destroyed when the working relationship ends."}
              </p>
            </footer>
          </div>
        </article>

        <p className="mx-auto mt-4 max-w-4xl text-center text-xs font-bold text-slate-500 print:hidden">{fr ? "La validité du badge doit toujours être confirmée en scannant le QR code." : "The badge validity must always be confirmed by scanning the QR code."}</p>
      </div>
    </main>
  );
}
