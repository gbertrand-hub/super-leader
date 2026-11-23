import Image from "next/image";
import Link from "next/link";
import {redirect} from "next/navigation";
import {cancelMyEmployeeBadgeRequestAction, requestMyEmployeeBadgeAction} from "@/app/actions/badges";
import {getI18n} from "@/i18n/server";
import {createProfileAvatarSignedUrl} from "@/lib/profile/avatar";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams: Promise<Record<string, string | string[] | undefined>>};
type Badge = {
  id: string;
  badge_number: string;
  issue_number: number;
  status: string;
  valid_from: string;
  valid_until: string;
  needs_reissue: boolean;
  full_name_snapshot: string;
  role_label_snapshot: string;
  organization_name_snapshot: string;
};
type Request = {id: string; request_type: string; status: string; requested_at: string; reason: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "IL";
}

export default async function MyEmployeeBadgePage({searchParams}: Props) {
  const query = await searchParams;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();
  if (!membership) redirect("/dashboard/company");

  const [profileResult, badgeResult, requestResult] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name,email,country,city,avatar_storage_path")
      .eq("id", auth.user.id)
      .maybeSingle<{full_name: string | null; email: string | null; country: string | null; city: string | null; avatar_storage_path: string | null}>(),
    admin
      .from("employee_badges")
      .select("id,badge_number,issue_number,status,valid_from,valid_until,needs_reissue,full_name_snapshot,role_label_snapshot,organization_name_snapshot")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", auth.user.id)
      .order("issue_number", {ascending: false})
      .limit(1)
      .maybeSingle<Badge>(),
    admin
      .from("employee_badge_requests")
      .select("id,request_type,status,requested_at,reason")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", auth.user.id)
      .eq("status", "pending")
      .maybeSingle<Request>(),
  ]);

  const migrationMissing = [badgeResult.error, requestResult.error].some((error) => ["42P01", "PGRST205"].includes(String(error?.code ?? "")));
  if (migrationMissing) return <MigrationRequired fr={fr} />;
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (badgeResult.error) throw new Error(badgeResult.error.message);
  if (requestResult.error) throw new Error(requestResult.error.message);

  const profile = profileResult.data;
  if (!profile) redirect("/login");
  const badge = badgeResult.data;
  const pendingRequest = requestResult.data;
  const avatarUrl = await createProfileAvatarSignedUrl(admin, profile.avatar_storage_path, 3600);
  const today = new Date().toISOString().slice(0, 10);
  const effectiveStatus = badge?.status === "active" && badge.valid_until < today ? "expired" : badge?.status ?? "none";
  const activeAndPrintable = effectiveStatus === "active";
  // Server-render timestamp used to calculate the badge status for this response.
  // eslint-disable-next-line react-hooks/purity
  const expiryDays = badge ? Math.ceil((new Date(`${badge.valid_until}T00:00:00Z`).getTime() - Date.now()) / 86400000) : null;
  const canRenew = badge && ["active", "expired"].includes(effectiveStatus) && (expiryDays ?? 9999) <= 120;
  const fullName = profile.full_name?.trim() || (fr ? "Collaborateur" : "Employee");
  const formatDate = (value: string) => new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
  const success = first(query.success);
  const error = first(query.error);

  const statusLabels: Record<string, string> = fr
    ? {none: "Aucun badge", active: "Actif", suspended: "Suspendu", revoked: "Révoqué", expired: "Expiré", replaced: "Remplacé"}
    : {none: "No badge", active: "Active", suspended: "Suspended", revoked: "Revoked", expired: "Expired", replaced: "Replaced"};

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Super Leader · V3.3.0</p>
              <h1 className="mt-2 text-3xl font-black">{fr ? "Mon badge officiel" : "My official badge"}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{fr ? "Ton badge iLEAD Global devient visible et imprimable uniquement après validation par Owner, Admin ou RH." : "Your iLEAD Global badge becomes visible and printable only after approval by an Owner, Admin or HR."}</p>
            </div>
            <Link href="/dashboard/profile" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black hover:bg-white/10">← {fr ? "Mon profil" : "My profile"}</Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{fr ? "État du badge" : "Badge status"}</p>
                <h2 className="mt-2 text-2xl font-black">{statusLabels[effectiveStatus] ?? effectiveStatus}</h2>
              </div>
              <span className={`rounded-full px-4 py-2 text-xs font-black uppercase ${activeAndPrintable ? "bg-emerald-100 text-emerald-800" : effectiveStatus === "suspended" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{statusLabels[effectiveStatus] ?? effectiveStatus}</span>
            </div>

            {badge ? (
              <div className="mt-6 rounded-3xl bg-slate-950 p-6 text-white">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-3xl border border-white/20 bg-white/10 text-3xl font-black">
                    {avatarUrl ? <Image src={avatarUrl} alt={fullName} width={112} height={112} unoptimized className="h-full w-full object-cover" /> : initials(fullName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">{badge.organization_name_snapshot}</p>
                    <h3 className="mt-2 text-3xl font-black">{badge.full_name_snapshot}</h3>
                    <p className="mt-1 text-slate-300">{badge.role_label_snapshot}</p>
                    <p className="mt-4 font-mono text-sm font-black text-amber-300">{badge.badge_number}</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 border-t border-white/15 pt-5 text-sm sm:grid-cols-2">
                  <div><p className="text-slate-400">{fr ? "Valide du" : "Valid from"}</p><p className="font-black">{formatDate(badge.valid_from)}</p></div>
                  <div><p className="text-slate-400">{fr ? "Expire le" : "Expires"}</p><p className="font-black">{formatDate(badge.valid_until)}</p></div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="text-lg font-black">{fr ? "Aucun badge officiel n’a encore été émis." : "No official badge has been issued yet."}</p>
                <p className="mt-2 text-sm text-slate-500">{fr ? "Complète ton profil et envoie une demande de validation." : "Complete your profile and submit an approval request."}</p>
              </div>
            )}

            {badge?.needs_reissue ? <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">{fr ? "Certaines informations ont changé depuis l’émission. Ton badge actuel reste vérifiable, mais une nouvelle édition doit être approuvée." : "Some details changed after issuance. Your current badge remains verifiable, but a new edition must be approved."}</p> : null}
            {effectiveStatus === "suspended" ? <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-900">{fr ? "Ce badge est suspendu et ne peut pas être imprimé." : "This badge is suspended and cannot be printed."}</p> : null}
            {["revoked", "expired", "replaced"].includes(effectiveStatus) ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{fr ? "Ce badge n’est plus valide. Le QR public l’indique immédiatement, même si une copie a déjà été imprimée." : "This badge is no longer valid. Public QR verification shows this immediately, even if a copy was already printed."}</p> : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {activeAndPrintable && badge ? <Link href={`/dashboard/badges/card/${badge.id}`} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{fr ? "Voir et imprimer mon badge" : "View and print my badge"}</Link> : null}
              {!pendingRequest && (!badge || ["revoked", "replaced"].includes(effectiveStatus)) ? (
                <form action={requestMyEmployeeBadgeAction}><input type="hidden" name="requestType" value="initial" /><button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{badge ? (fr ? "Demander une nouvelle émission" : "Request a new issue") : (fr ? "Demander mon badge" : "Request my badge")}</button></form>
              ) : null}
              {!pendingRequest && badge?.needs_reissue ? (
                <form action={requestMyEmployeeBadgeAction}><input type="hidden" name="requestType" value="update" /><button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr ? "Demander la mise à jour" : "Request an update"}</button></form>
              ) : null}
              {!pendingRequest && canRenew ? (
                <form action={requestMyEmployeeBadgeAction}><input type="hidden" name="requestType" value="renewal" /><button className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{fr ? "Demander le renouvellement" : "Request renewal"}</button></form>
              ) : null}
            </div>

            {badge && !pendingRequest && activeAndPrintable ? (
              <form action={requestMyEmployeeBadgeAction} className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <input type="hidden" name="requestType" value="replacement" />
                <h3 className="font-black">{fr ? "Badge perdu ou endommagé" : "Lost or damaged badge"}</h3>
                <textarea name="reason" required minLength={3} maxLength={1200} rows={3} placeholder={fr ? "Explique brièvement la raison du remplacement." : "Briefly explain why a replacement is needed."} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
                <button className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black">{fr ? "Demander un remplacement" : "Request replacement"}</button>
              </form>
            ) : null}
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{fr ? "Conditions avant validation" : "Requirements before approval"}</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                <li className="rounded-xl bg-slate-50 p-3">✓ {fr ? "Nom complet renseigné" : "Full name completed"}</li>
                <li className={`rounded-xl p-3 ${profile.avatar_storage_path ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{profile.avatar_storage_path ? "✓" : "!"} {fr ? "Photo de profil officielle" : "Official profile photo"}</li>
                <li className="rounded-xl bg-slate-50 p-3">✓ {fr ? "Compte collaborateur actif" : "Active employee account"}</li>
                <li className="rounded-xl bg-slate-50 p-3">✓ {fr ? "Validation Owner, Admin ou RH" : "Owner, Admin or HR approval"}</li>
              </ul>
              {!profile.avatar_storage_path ? <Link href="/dashboard/profile?section=identity" className="mt-4 inline-flex rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white">{fr ? "Ajouter ma photo" : "Add my photo"}</Link> : null}
            </section>

            {pendingRequest ? (
              <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">{fr ? "Validation en cours" : "Approval in progress"}</p>
                <h2 className="mt-2 text-xl font-black text-indigo-950">{fr ? "Demande transmise" : "Request submitted"}</h2>
                <p className="mt-2 text-sm text-indigo-800">{fr ? "Le badge restera invisible et non imprimable jusqu’à la décision administrative." : "The badge remains hidden and non-printable until an administrative decision is made."}</p>
                <form action={cancelMyEmployeeBadgeRequestAction} className="mt-5"><input type="hidden" name="requestId" value={pendingRequest.id} /><button className="rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-black text-indigo-800">{fr ? "Annuler ma demande" : "Cancel my request"}</button></form>
              </section>
            ) : null}

            <section className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6 text-cyan-950">
              <h2 className="text-lg font-black">{fr ? "Sécurité du badge imprimé" : "Printed badge security"}</h2>
              <p className="mt-3 text-sm leading-6">{fr ? "Une copie physique n’est jamais une preuve suffisante. Toute personne doit scanner le QR : si ton compte est désactivé, le badge devient immédiatement Révoqué dans la vérification publique." : "A physical copy is never sufficient proof. The QR must be scanned: if your account is disabled, public verification immediately marks the badge as Revoked."}</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-10"><div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-2xl font-black text-amber-950">{fr ? "Migration Badges requise" : "Badge migration required"}</h1><p className="mt-3 text-amber-900">{fr ? "Exécute la migration Supabase suivante avant d’ouvrir cette page :" : "Run the following Supabase migration before opening this page:"}</p><code className="mt-4 block rounded-xl bg-slate-950 p-4 text-sm font-bold text-white">050_employee_badges_identity_v3_3_0.sql</code></div></main>;
}
