import type {Metadata} from "next";
import Image from "next/image";
import {notFound} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getVipProgramSettings, getVipRecognitionCategories} from "@/lib/vip/settings";

export const metadata: Metadata = {
  title: "VIP card verification - Super Leader",
  robots: {index: false, follow: false},
};

type Props = {params: Promise<{token: string}>};
type VipCard = {
  organization_id: string;
  member_id: string;
  card_number: string;
  status: string;
  valid_from: string;
  valid_until: string;
};
type VipMember = {
  full_name: string;
  member_number: string;
  country: string | null;
  recognition_category: string;
  status: string;
};



export default async function VerifyVipCardPage({params}: Props) {
  const {token} = await params;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const admin = createAdminClient();
  const {data: card} = await admin
    .from("vip_cards")
    .select("organization_id,member_id,card_number,status,valid_from,valid_until")
    .eq("verification_token", token)
    .maybeSingle<VipCard>();
  if (!card) notFound();

  const [{data: member}, {data: organization}, settings, recognitionCategories] = await Promise.all([
    admin
      .from("vip_members")
      .select("full_name,member_number,country,recognition_category,status")
      .eq("id", card.member_id)
      .maybeSingle<VipMember>(),
    admin
      .from("organizations")
      .select("name")
      .eq("id", card.organization_id)
      .maybeSingle<{name: string}>(),
    getVipProgramSettings(admin, card.organization_id),
    getVipRecognitionCategories(admin, card.organization_id),
  ]);
  if (!member || !organization || !settings.public_card_verification_enabled) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const membershipValid = ["active", "honorary", "pending_renewal"].includes(member.status);
  const cardValid = card.status === "active" && card.valid_from <= today && card.valid_until >= today;
  const valid = membershipValid && cardValid;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const formatDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "long"}).format(new Date(`${value}T00:00:00Z`));
  const categoryMap = new Map(recognitionCategories.map((item) => [item.code, fr ? item.name_fr : item.name_en]));
  const category = categoryMap.get(member.recognition_category) ?? member.recognition_category;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-950 sm:py-14">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <header className="flex flex-col items-center justify-between gap-5 border-b border-slate-200 px-7 py-7 sm:flex-row sm:px-10">
          <Image
            src="/branding/ilead-global-logo.png"
            alt="iLEAD Global"
            width={230}
            height={144}
            preload
            className="h-auto w-48 object-contain sm:w-56"
          />
          <div className="text-center sm:text-right">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-rose-700">{settings.program_name.toUpperCase()}</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">{fr ? "Vérification de la carte" : "Card verification"}</h1>
          </div>
        </header>

        <div className="px-7 py-8 sm:px-10">
          <div className={`rounded-2xl p-5 ${valid ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <p className="text-2xl font-black">{valid ? `✓ ${fr ? "Carte VIP valide" : "Valid VIP card"}` : fr ? "Carte VIP non valide" : "VIP card not valid"}</p>
            <p className="mt-2 text-sm font-semibold opacity-80">
              {valid
                ? fr ? "L’identité et le statut annuel ont été vérifiés dans le registre officiel Super Leader VIP." : "Identity and annual status were verified in the official Super Leader VIP registry."
                : fr ? "Cette carte est expirée, remplacée, révoquée ou liée à une adhésion suspendue." : "This card is expired, replaced, revoked or linked to a suspended membership."}
            </p>
          </div>

          <dl className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-5 sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Membre reconnu" : "Recognised member"}</dt>
              <dd className="mt-1 text-2xl font-black">{member.full_name}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Organisation émettrice" : "Issuing organisation"}</dt>
              <dd className="mt-1 font-black">{organization.name}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Distinction" : "Recognition"}</dt>
              <dd className="mt-1 font-black">{category}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Numéro de membre" : "Member number"}</dt>
              <dd className="mt-1 break-all font-mono font-black">{member.member_number}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Numéro de carte" : "Card number"}</dt>
              <dd className="mt-1 break-all font-mono font-black">{card.card_number}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Pays" : "Country"}</dt>
              <dd className="mt-1 font-black">{member.country || "—"}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{fr ? "Validité" : "Validity"}</dt>
              <dd className="mt-1 font-black">{formatDate(card.valid_from)} — {formatDate(card.valid_until)}</dd>
            </div>
          </dl>

          <div className="mt-7 rounded-2xl border border-slate-200 p-5 text-center">
            <p className="text-sm font-black">{fr ? "Vérification publique limitée — aucune coordonnée privée n’est affichée." : "Limited public verification — no private contact information is displayed."}</p>
            <p className="mt-1 text-sm text-slate-500">{fr ? "Vérifié le" : "Verified on"} {new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short"}).format(new Date())}</p>
          </div>
        </div>
      </article>
    </main>
  );
}
