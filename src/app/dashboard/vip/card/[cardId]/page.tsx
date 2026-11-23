import Image from "next/image";
import Link from "next/link";
import {notFound, redirect} from "next/navigation";
import {reissueVipCardAction, revokeVipCardAction} from "@/app/actions/vip";
import {PrintVipCardButton} from "@/components/vip/print-vip-card-button";
import {getI18n} from "@/i18n/server";
import {getVipCardVerificationUrl} from "@/lib/vip/card-links";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings, getVipRecognitionCategories} from "@/lib/vip/settings";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_REGISTRY_ROLES = ["owner", "admin", "hr"];

type Props = {
  params: Promise<{cardId: string}>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type Card = {
  id: string;
  organization_id: string;
  member_id: string;
  card_number: string;
  issue_number: number;
  verification_token: string;
  status: string;
  valid_from: string;
  valid_until: string;
  issued_at: string;
  revocation_reason: string | null;
};
type Member = {
  member_number: string;
  full_name: string;
  country: string | null;
  organization_name: string | null;
  job_title: string | null;
  recognition_category: string;
  status: string;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "VIP";
}

export default async function VipCardPage({params, searchParams}: Props) {
  const {cardId} = await params;
  const query = await searchParams;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const supabase = await createClient();
  const {data: auth, error} = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!VIP_ROLES.includes(membership.role)) redirect("/dashboard/my-day");

  const {data: card} = await admin
    .from("vip_cards")
    .select("id,organization_id,member_id,card_number,issue_number,verification_token,status,valid_from,valid_until,issued_at,revocation_reason")
    .eq("id", cardId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<Card>();
  if (!card) notFound();

  const [{data: member}, {data: organization}, settings, recognitionCategories] = await Promise.all([
    admin
      .from("vip_members")
      .select("member_number,full_name,country,organization_name,job_title,recognition_category,status")
      .eq("id", card.member_id)
      .maybeSingle<Member>(),
    admin.from("organizations").select("name").eq("id", card.organization_id).maybeSingle<{name: string}>(),
    getVipProgramSettings(admin, card.organization_id),
    getVipRecognitionCategories(admin, card.organization_id),
  ]);
  if (!member || !organization) notFound();
  const categoryMap = new Map(recognitionCategories.map((category) => [category.code, fr ? category.name_fr : category.name_en]));
  const today = new Date().toISOString().slice(0, 10);
  const effectiveStatus = card.status === "active" && card.valid_until < today ? "expired" : card.status;
  const valid = effectiveStatus === "active" && ["active", "honorary", "pending_renewal"].includes(member.status);
  const verificationUrl = getVipCardVerificationUrl(card.verification_token);
  const formatDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
  const success = first(query.success);
  const canManage = VIP_REGISTRY_ROLES.includes(membership.role);

  return (
    <main className="min-h-screen bg-slate-100 px-5 py-8 text-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/dashboard/vip?view=cards" className="font-black text-rose-800">← {fr ? "Cartes VIP" : "VIP cards"}</Link>
          <div className="flex flex-wrap gap-3">
            {canManage ? (
              <Link href={`/dashboard/vip?view=members&edit=${encodeURIComponent(card.member_id)}#vip-member-${card.member_id}`} className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-black text-rose-800 shadow-sm">
                {fr ? "Modifier le dossier" : "Edit member record"}
              </Link>
            ) : null}
            <PrintVipCardButton label={fr ? "Imprimer la carte" : "Print card"} />
          </div>
        </div>

        {success ? <p className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800 print:hidden">{success}</p> : null}

        <article className="relative mx-auto aspect-[1.586/1] w-full max-w-4xl overflow-hidden rounded-[2.2rem] bg-slate-950 p-7 text-white shadow-2xl print:aspect-[1.586/1] print:max-w-none print:rounded-none print:shadow-none sm:p-10">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-rose-600/45 blur-2xl" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-amber-400/20 blur-2xl" />
          <div className="relative flex h-full flex-col justify-between">
            <header className="grid grid-cols-[auto_1fr_auto] items-start gap-4 sm:gap-6">
              <Image
                src="/branding/ilead-global-logo.png"
                alt="iLEAD Global"
                width={230}
                height={144}
                preload
                className="h-auto w-32 rounded-xl bg-white/95 p-2 object-contain sm:w-48"
              />
              <div className="self-center px-1 text-center">
                <p className="text-[9px] font-black uppercase leading-tight tracking-[0.16em] text-amber-200 sm:text-sm sm:tracking-[0.2em]">
                  {fr ? settings.circle_title_fr : settings.circle_title_en}
                </p>
                <p className="mt-2 text-[8px] font-bold uppercase leading-tight tracking-[0.12em] text-slate-300 sm:text-xs sm:tracking-[0.16em]">
                  {fr ? settings.card_subtitle_fr : settings.card_subtitle_en}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-rose-200 sm:text-xs sm:tracking-[0.3em]">{settings.program_name.toUpperCase()}</p>
                <p className={`mt-3 inline-flex rounded-full px-3 py-2 text-[9px] font-black uppercase tracking-wider sm:px-4 sm:text-xs ${valid ? "bg-emerald-400/20 text-emerald-200" : "bg-red-400/20 text-red-200"}`}>
                  {valid ? fr ? "Carte active" : "Active card" : fr ? "Carte non valide" : "Card not valid"}
                </p>
              </div>
            </header>

            <section className="grid items-center gap-5 sm:grid-cols-[auto_1fr_auto]">
              <div className="grid h-24 w-24 place-items-center rounded-3xl border border-white/20 bg-white/10 text-3xl font-black sm:h-32 sm:w-32 sm:text-4xl">
                {initials(member.full_name)}
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-rose-200">{categoryMap.get(member.recognition_category) ?? member.recognition_category}</p>
                <h1 className="mt-2 text-3xl font-black leading-tight sm:text-5xl">{member.full_name}</h1>
                <p className="mt-2 text-sm text-slate-300 sm:text-base">{[member.job_title, member.organization_name, member.country].filter(Boolean).join(" · ") || "Super Leader VIP"}</p>
                <p className="mt-4 font-mono text-sm font-black text-amber-200">{member.member_number}</p>
              </div>
              {settings.public_card_verification_enabled ? (
                <div className="w-32 rounded-2xl bg-white p-2 text-center sm:w-40">
                  <Image
                    src={`/api/vip/card-qr/${card.verification_token}`}
                    alt={fr ? "QR de vérification de la carte VIP" : "VIP card verification QR"}
                    width={160}
                    height={160}
                    unoptimized
                    className="mx-auto h-28 w-28 sm:h-36 sm:w-36"
                  />
                  <p className="mt-1 text-[9px] font-black uppercase tracking-wide text-slate-700">{fr ? "Scanner pour vérifier" : "Scan to verify"}</p>
                </div>
              ) : (
                <div className="w-32 rounded-2xl border border-white/20 bg-white/10 p-4 text-center text-xs font-black text-slate-200 sm:w-40">
                  {fr ? "Vérification publique désactivée" : "Public verification disabled"}
                </div>
              )}
            </section>

            <footer className="flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-5 text-xs sm:text-sm">
              <div>
                <p className="text-slate-400">{fr ? "Carte" : "Card"}</p>
                <p className="font-mono font-black">{card.card_number}</p>
              </div>
              <div>
                <p className="text-slate-400">{fr ? "Valide du" : "Valid from"}</p>
                <p className="font-black">{formatDate(card.valid_from)}</p>
              </div>
              <div>
                <p className="text-slate-400">{fr ? "Expire le" : "Expires"}</p>
                <p className="font-black">{formatDate(card.valid_until)}</p>
              </div>
              <div className="max-w-xs text-right">
                <p className="text-slate-400">{organization.name}</p>
                <p className="font-black">{fr ? "Reconnaissance internationale" : "International recognition"}</p>
              </div>
            </footer>
          </div>
        </article>

        <section className="mx-auto mt-6 max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
          <h2 className="text-xl font-black">{fr ? "Vérification et gestion" : "Verification and management"}</h2>
          {settings.public_card_verification_enabled ? (
            <Link href={verificationUrl} target="_blank" className="mt-3 block break-all rounded-xl bg-slate-50 p-4 text-sm font-bold text-rose-800">
              {verificationUrl}
            </Link>
          ) : <p className="mt-3 rounded-xl bg-amber-50 p-4 font-bold text-amber-900">{fr ? "La vérification publique est désactivée dans les paramètres VIP." : "Public verification is disabled in VIP settings."}</p>}
          {card.revocation_reason ? <p className="mt-4 rounded-xl bg-red-50 p-4 font-bold text-red-800">{fr ? "Motif" : "Reason"}: {card.revocation_reason}</p> : null}

          {canManage && card.status === "active" && card.valid_until >= today ? (
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <form action={reissueVipCardAction} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <input type="hidden" name="cardId" value={card.id} />
                <h3 className="font-black text-amber-950">{fr ? "Réémettre la carte" : "Reissue card"}</h3>
                <p className="mt-2 text-sm text-amber-900">{fr ? "Pour une carte perdue, endommagée ou corrigée. La date d’expiration reste inchangée." : "For a lost, damaged or corrected card. The expiry date stays unchanged."}</p>
                <input name="reason" required maxLength={500} placeholder={fr ? "Motif de la réémission" : "Reason for reissue"} className="mt-4 w-full rounded-xl border border-amber-300 bg-white px-4 py-3" />
                <button type="submit" className="mt-3 rounded-xl bg-amber-500 px-4 py-3 font-black text-slate-950">{fr ? "Créer une nouvelle carte" : "Create new card"}</button>
              </form>

              <form action={revokeVipCardAction} className="rounded-2xl border border-red-200 bg-red-50 p-5">
                <input type="hidden" name="cardId" value={card.id} />
                <h3 className="font-black text-red-950">{fr ? "Révoquer la carte" : "Revoke card"}</h3>
                <p className="mt-2 text-sm text-red-900">{fr ? "Cette action rend la carte invalide et suspend l’adhésion du membre." : "This makes the card invalid and suspends the member’s VIP status."}</p>
                <input name="reason" required minLength={5} maxLength={500} placeholder={fr ? "Motif obligatoire" : "Required reason"} className="mt-4 w-full rounded-xl border border-red-300 bg-white px-4 py-3" />
                <button type="submit" className="mt-3 rounded-xl bg-red-700 px-4 py-3 font-black text-white">{fr ? "Révoquer et suspendre" : "Revoke and suspend"}</button>
              </form>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
