import type {Metadata} from "next";
import {I18nProvider} from "@/i18n/client";
import {getI18n} from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();

  return {
    title: "Super Leader",
    description: t("brand.description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  const {locale, messages} = await getI18n();

  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
