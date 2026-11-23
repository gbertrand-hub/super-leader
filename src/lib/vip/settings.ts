import {createAdminClient} from "@/lib/supabase/admin";

export const VIP_SERVICE_TYPES = [
  "airport_welcome",
  "local_transport",
  "accommodation_guidance",
  "office_visit",
  "leadership_meeting",
  "event_invitation",
  "local_assistance",
  "other",
] as const;

export const VIP_COMMUNICATION_CHANNELS = ["manual", "email", "whatsapp", "in_person"] as const;

export type VipProgramSettings = {
  organization_id: string;
  program_name: string;
  circle_title_fr: string;
  circle_title_en: string;
  card_subtitle_fr: string;
  card_subtitle_en: string;
  card_validity_months: number;
  renewal_notice_days: number[];
  renewal_grace_days: number;
  nomination_requires_evidence: boolean;
  nomination_requires_committee_approval: boolean;
  travel_min_notice_days: number;
  require_travel_consent: boolean;
  auto_assign_country_representative: boolean;
  enabled_travel_services: string[];
  annual_meeting_default_duration_days: number;
  benefit_default_approval_mode: "manual" | "automatic";
  communication_default_channels: string[];
  public_card_verification_enabled: boolean;
  member_portal_enabled: boolean;
};

export type VipRecognitionCategory = {
  id: string;
  code: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  is_honorary: boolean;
  is_active: boolean;
  sort_order: number;
};

export const DEFAULT_VIP_SETTINGS: Omit<VipProgramSettings, "organization_id"> = {
  program_name: "Super Leader VIP",
  circle_title_fr: "Cercle rapproché d’iLEAD Global",
  circle_title_en: "iLEAD Global Inner Circle",
  card_subtitle_fr: "Carte officielle de membre VIP",
  card_subtitle_en: "Official VIP membership card",
  card_validity_months: 12,
  renewal_notice_days: [90, 60, 30],
  renewal_grace_days: 0,
  nomination_requires_evidence: true,
  nomination_requires_committee_approval: true,
  travel_min_notice_days: 14,
  require_travel_consent: true,
  auto_assign_country_representative: true,
  enabled_travel_services: [...VIP_SERVICE_TYPES],
  annual_meeting_default_duration_days: 7,
  benefit_default_approval_mode: "manual",
  communication_default_channels: ["manual"],
  public_card_verification_enabled: true,
  member_portal_enabled: false,
};

export const DEFAULT_VIP_CATEGORIES: VipRecognitionCategory[] = [
  {id: "", code: "distinguished_contributor", name_fr: "Contributeur distinctif", name_en: "Distinctive contributor", description_fr: null, description_en: null, is_honorary: false, is_active: true, sort_order: 10},
  {id: "", code: "partner", name_fr: "Partenaire stratégique", name_en: "Strategic partner", description_fr: null, description_en: null, is_honorary: false, is_active: true, sort_order: 20},
  {id: "", code: "ambassador", name_fr: "Ambassadeur", name_en: "Ambassador", description_fr: null, description_en: null, is_honorary: false, is_active: true, sort_order: 30},
  {id: "", code: "investor", name_fr: "Investisseur", name_en: "Investor", description_fr: null, description_en: null, is_honorary: false, is_active: true, sort_order: 40},
  {id: "", code: "honorary", name_fr: "Membre honoraire", name_en: "Honorary member", description_fr: null, description_en: null, is_honorary: true, is_active: true, sort_order: 50},
  {id: "", code: "other", name_fr: "Autre distinction", name_en: "Other distinction", description_fr: null, description_en: null, is_honorary: false, is_active: true, sort_order: 60},
];

export async function getVipProgramSettings(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<VipProgramSettings> {
  const {data, error} = await admin
    .from("vip_program_settings")
    .select("organization_id,program_name,circle_title_fr,circle_title_en,card_subtitle_fr,card_subtitle_en,card_validity_months,renewal_notice_days,renewal_grace_days,nomination_requires_evidence,nomination_requires_committee_approval,travel_min_notice_days,require_travel_consent,auto_assign_country_representative,enabled_travel_services,annual_meeting_default_duration_days,benefit_default_approval_mode,communication_default_channels,public_card_verification_enabled,member_portal_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle<VipProgramSettings>();

  if (error && !["42P01", "PGRST205"].includes(String(error.code ?? ""))) {
    throw new Error(error.message);
  }

  return data ?? {organization_id: organizationId, ...DEFAULT_VIP_SETTINGS};
}

export async function getVipRecognitionCategories(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  activeOnly = false,
): Promise<VipRecognitionCategory[]> {
  let query = admin
    .from("vip_recognition_categories")
    .select("id,code,name_fr,name_en,description_fr,description_en,is_honorary,is_active,sort_order")
    .eq("organization_id", organizationId)
    .order("sort_order", {ascending: true})
    .order("name_fr", {ascending: true});
  if (activeOnly) query = query.eq("is_active", true);
  const {data, error} = await query;

  if (error) {
    if (["42P01", "PGRST205"].includes(String(error.code ?? ""))) return DEFAULT_VIP_CATEGORIES;
    throw new Error(error.message);
  }
  return (data ?? []) as VipRecognitionCategory[];
}

export async function getActiveVipCategory(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  code: string,
) {
  const categories = await getVipRecognitionCategories(admin, organizationId, true);
  return categories.find((category) => category.code === code) ?? null;
}

export async function isActiveVipCategory(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  code: string,
) {
  return Boolean(await getActiveVipCategory(admin, organizationId, code));
}

export function addMonthsToDate(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonthStart = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}
