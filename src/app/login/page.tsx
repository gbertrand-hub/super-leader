import Link from "next/link";
import {redirect} from "next/navigation";
import {signInAction} from "@/app/actions/auth";
import {AuthCard} from "@/components/auth/auth-card";
import {AuthForm} from "@/components/auth/auth-form";
import {getI18n} from "@/i18n/server";
import {createClient} from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard/my-day");

  const {t} = await getI18n();

  return (
    <AuthCard title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
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
