import {cookies} from "next/headers";
import {localeCookieName, normalizeLocale} from "@/i18n/config";
import {messagesByLocale, translate} from "@/i18n/messages";

export async function getI18n() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(localeCookieName)?.value);
  const messages = messagesByLocale[locale];

  return {
    locale,
    messages,
    t: (key: string, values?: Record<string, string | number>) =>
      translate(messages, key, values),
  };
}
