"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "@/app/actions/auth";
import { useI18n } from "@/i18n/client";

const initialState: AuthState = {};

type Field = {
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
};

export function AuthForm({
  action,
  fields,
  submitLabel,
  footer,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  footer?: { text: string; href: string; linkLabel: string };
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const { t } = useI18n();

  return (
    <form action={formAction} className="space-y-5">
      {fields.map((field) => (
        <label key={field.name} className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">{field.label}</span>
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            placeholder={field.placeholder}
            required
          />
        </label>
      ))}

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{state.success}</p>
      ) : null}

      <button
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? t("common.processing") : submitLabel}
      </button>

      {footer ? (
        <p className="text-center text-sm text-slate-600">
          {footer.text}{" "}
          <Link className="font-bold text-indigo-700 hover:underline" href={footer.href}>
            {footer.linkLabel}
          </Link>
        </p>
      ) : null}
    </form>
  );
}
