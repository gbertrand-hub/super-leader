import Link from "next/link";
import {redirect} from "next/navigation";
import {signInAction} from "@/app/actions/auth";
import {AuthCard} from "@/components/auth/auth-card";
import {AuthForm} from "@/components/auth/auth-form";
import {getI18n} from "@/i18n/server";
import {readTemporaryAccessState} from "@/lib/auth/temporary-access";
import {createClient} from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams?: Promise<{
    passwordChanged?: string;
    temporaryExpired?: string;
  }>;
};

export default async function LoginPage({searchParams}: LoginPageProps) {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (data.user) {
    const temporaryAccess = readTemporaryAccessState(
      data.user.user_metadata,
      new Date().getTime(),
    );
    redirect(
      temporaryAccess.mustChangePassword
        ? temporaryAccess.expired
          ? "/auth/temporary-access-expired"
          : "/change-password-required"
        : "/dashboard/my-day",
    );
  }

  const params = (await searchParams) ?? {};
  const {t} = await getI18n();

  return (
    <AuthCard title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
      {params.passwordChanged === "1" ? (
        <p className="mb-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {t("auth.temporary.changedSuccess")}
        </p>
      ) : null}
      {params.temporaryExpired === "1" ? (
        <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {t("auth.temporary.expired")}
        </p>
      ) : null}
      <AuthForm
        action={signInAction}
        fields={[
          {name: "email", label: t("auth.email"), type: "email", autoComplete: "email"},
          {
            name: "password",
            label: t("auth.password"),
            type: "password",
            autoComplete: "current-password",
          },
        ]}
        submitLabel={t("auth.login.submit")}
        footer={{
          text: t("auth.login.noAccount"),
          href: "/signup",
          linkLabel: t("auth.login.createAccount"),
        }}
      />
      <p className="mt-5 text-center text-sm">
        <Link
          className="font-semibold text-slate-600 hover:text-indigo-700"
          href="/forgot-password"
        >
          {t("auth.login.forgotPassword")}
        </Link>
      </p>
    </AuthCard>
  );
}
