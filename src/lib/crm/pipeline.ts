export const CRM_SECTORS = ["house", "land", "training", "livestock", "vip"] as const;
export type CrmSector = string;

export type CrmSectorOption = {
  id?: string;
  code: string;
  nameFr: string;
  nameEn: string;
  fulfillmentDestination: "real_estate" | "academy" | "livestock_operations" | "collections" | "other";
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
};

export const CRM_SOURCES = [
  "manual",
  "website",
  "referral",
  "event",
  "campaign",
  "social_media",
  "partner",
  "walk_in",
  "other",
] as const;

export const CRM_LOSS_REASONS = [
  "price",
  "financing",
  "postponed",
  "no_response",
  "product_fit",
  "competitor",
  "trust",
  "timing",
  "unqualified",
  "other",
] as const;

export type CrmLossReason = (typeof CRM_LOSS_REASONS)[number];

export const SECTOR_HANDOFF: Record<string, "real_estate" | "academy" | "livestock_operations" | "collections" | "other"> = {
  house: "real_estate",
  land: "real_estate",
  training: "academy",
  livestock: "livestock_operations",
  vip: "other",
};

export const STAGE_TONE: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-800",
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
  violet: "border-violet-200 bg-violet-50 text-violet-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  orange: "border-orange-200 bg-orange-50 text-orange-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  red: "border-red-200 bg-red-50 text-red-900",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-900",
};

export function safeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: unknown, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

export function normalizeSector(value: string | null | undefined, availableSectors: readonly string[] = CRM_SECTORS): CrmSector {
  const candidate = String(value ?? "").trim();
  if (candidate && availableSectors.includes(candidate)) return candidate;
  return availableSectors[0] ?? "house";
}

export function sectorOptionLabel(locale: string, sector: Pick<CrmSectorOption, "code" | "nameFr" | "nameEn">) {
  return locale === "en" ? sector.nameEn || sector.nameFr || sector.code : sector.nameFr || sector.nameEn || sector.code;
}
