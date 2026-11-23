"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type {Locale} from "@/i18n/config";
import {translate, type MessageTree} from "@/i18n/messages";

type I18nContextValue = {
  locale: Locale;
  messages: MessageTree;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: MessageTree;
  children: ReactNode;
}) {
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(messages, key, values),
    [messages],
  );

  const value = useMemo(
    () => ({locale, messages, t}),
    [locale, messages, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
