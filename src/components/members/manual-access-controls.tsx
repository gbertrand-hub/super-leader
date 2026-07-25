"use client";

import { useActionState, useState } from "react";
import {
  activateInvitationManuallyAction,
  type ManualMemberAccessState,
} from "@/app/actions/members";

const initialManualMemberAccessState: ManualMemberAccessState = {
  status: "idle",
};

type Props = {
  invitationId: string;
  email: string;
  status: string;
  canManage: boolean;
};

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ManualAccessControls({
  invitationId,
  email,
  status,
  canManage,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    activateInvitationManuallyAction,
    initialManualMemberAccessState,
  );
  const [copied, setCopied] = useState<"setup" | "login" | null>(null);

  if (!canManage || status === "cancelled") return null;

  const isAccepted = status === "accepted" || state.activated;
  const buttonLabel = isAccepted
    ? "Générer un nouveau lien d’accès"
    : "Activer manuellement";

  async function handleCopy(kind: "setup" | "login", value: string) {
    const succeeded = await copyText(value);
    if (!succeeded) return;

    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="mt-3 min-w-[300px] rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
        Activation de secours
      </p>
      <p className="mt-1 text-xs leading-5 text-amber-800">
        {isAccepted
          ? "Le compte est actif. Tu peux générer un nouveau lien pour choisir le mot de passe."
          : "Crée et confirme le compte, puis affiche un lien unique pour choisir le mot de passe."}
      </p>

      <form action={formAction} className="mt-3 grid gap-2">
        <input type="hidden" name="invitationId" value={invitationId} />
        {!isAccepted && (
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Nom complet
            <input
              name="fullName"
              autoComplete="name"
              placeholder={`Nom de ${email}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60"
        >
          {isPending ? "Traitement…" : buttonLabel}
        </button>
      </form>

      {state.message && (
        <p
          className={`mt-3 rounded-lg p-2 text-xs font-semibold ${
            state.status === "success"
              ? "bg-emerald-100 text-emerald-800"
              : state.status === "warning"
                ? "bg-orange-100 text-orange-800"
                : "bg-red-100 text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      {state.setupLink && (
        <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 shadow-sm">
          <p className="text-xs font-black text-slate-900">
            Lien unique pour choisir le mot de passe
          </p>
          <input
            readOnly
            value={state.setupLink}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleCopy("setup", state.setupLink ?? "")}
              className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white"
            >
              {copied === "setup" ? "Copié ✓" : "Copier le lien d’accès"}
            </button>
            <a
              href={state.setupLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700"
            >
              Tester le lien
            </a>
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            Transmets ce lien uniquement au collaborateur concerné. Il est temporaire et personnel.
          </p>
        </div>
      )}

      {state.loginUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-950 p-3 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase text-amber-300">
              Connexion permanente
            </p>
            <p className="truncate text-xs">{state.loginUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => handleCopy("login", state.loginUrl ?? "")}
            className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-950"
          >
            {copied === "login" ? "Copié ✓" : "Copier"}
          </button>
        </div>
      )}
    </div>
  );
}
