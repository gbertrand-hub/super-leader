import Link from "next/link";
import {acceptInvitationAction} from "@/app/actions/company";
import {getI18n} from "@/i18n/server";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{token?: string}>;
}) {
  const {token} = await searchParams;
  const {t} = await getI18n();

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-sm">
        <p className="font-bold text-amber-600">★ {t("brand.name")}</p>
        <h1 className="mt-3 text-3xl font-black">{t("invitation.title")}</h1>
        <p className="mt-3 text-slate-600">{t("invitation.subtitle")}</p>
        {token ? (
          <form action={acceptInvitationAction} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
              {t("invitation.accept")}
            </button>
          </form>
        ) : (
          <p className="mt-5 text-red-600">{t("invitation.incomplete")}</p>
        )}
        <Link href="/dashboard" className="mt-4 block text-center font-bold text-indigo-700">
          {t("common.backToDashboard")}
        </Link>
      </section>
    </main>
  );
}
