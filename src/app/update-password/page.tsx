"use client";

import {FormEvent, useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {AuthCard} from "@/components/auth/auth-card";
import {useI18n} from "@/i18n/client";
import {createClient} from "@/lib/supabase/client";

type PageState = "loading" | "ready" | "error" | "success";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const {t} = useI18n();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [message, setMessage] = useState(() => t("auth.update.checking"));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function establishRecoverySession() {
      try {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const authError = hashParams.get("error_description");

        if (authError) {
          throw new Error(decodeURIComponent(authError.replace(/\+/g, " ")));
        }

        if (accessToken && refreshToken) {
          const {error} = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) throw error;
          window.history.replaceState({}, document.title, "/update-password");
        } else {
          const {data, error} = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            throw new Error(t("auth.update.invalidLink"));
          }
        }

        if (active) {
          setPageState("ready");
          setMessage("");
        }
      } catch (error) {
        if (!active) return;
        setPageState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : t("auth.update.validationFailed"),
        );
      }
    }

    void establishRecoverySession();
    return () => {
      active = false;
    };
  }, [supabase, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setMessage(t("auth.update.minLength"));
      return;
    }

    if (password !== confirmPassword) {
      setMessage(t("auth.update.mismatch"));
      return;
    }

    setSubmitting(true);
    setMessage("");

    const {error} = await supabase.auth.updateUser({password});

    if (error) {
      setSubmitting(false);
      setPageState("error");
      setMessage(error.message || t("auth.update.updateFailed"));
      return;
    }

    await supabase.auth.signOut();
    setPageState("success");
    setMessage(t("auth.update.success"));

    window.setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1200);
  }

  return (
    <AuthCard title={t("auth.update.title")} subtitle={t("auth.update.subtitle")}>
      {pageState === "loading" ? (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
          {message}
        </p>
      ) : null}

      {pageState === "error" ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {message}
          </p>
          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="w-full rounded-xl bg-slate-950 px-4 py-3 font-bold text-white"
          >
            {t("auth.update.backToLogin")}
          </button>
        </div>
      ) : null}

      {pageState === "success" ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {message}
        </p>
      ) : null}

      {pageState === "ready" ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              {t("auth.update.newPassword")}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              {t("auth.update.confirmPassword")}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            />
          </label>

          {message ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? t("common.processing") : t("auth.update.submit")}
          </button>
        </form>
      ) : null}
    </AuthCard>
  );
}
