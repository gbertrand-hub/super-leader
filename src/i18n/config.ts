export const supportedLocales = ["fr", "en"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "fr";
export const localeCookieName = "super_leader_locale";

export function normalizeLocale(value: string | null | undefined): Locale {
  return supportedLocales.includes(value as Locale)
    ? (value as Locale)
    : defaultLocale;
}
