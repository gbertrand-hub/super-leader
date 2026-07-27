"use client";

import { useActionState, useState } from "react";
import {
  activateInvitationManuallyAction,
  activateInvitationWithTemporaryPasswordAction,
  type ManualMemberAccessState,
  type TemporaryPasswordAccessState,
} from "@/app/actions/members";
import { useI18n } from "@/i18n/client";

const initialManualMemberAccessState: ManualMemberAccessState = {
  status: "idle",
};

const initialTemporaryPasswordState: TemporaryPasswordAccessState = {
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

function messageClass(status: "idle" | "success" | "warning" | "error") {
  if (status === "success") return "bg-emerald-100 text-emerald-800";
  if (status === "warning") return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-700";
}

export function ManualAccessControls({
  invitationId,
  email,
  status,
  canManage,
}: Props) {
  const { t, locale } = useI18n();
  const [linkState, linkAction, linkPending] = useActionState(
    activateInvitationManuallyAction,
    initialManualMemberAccessState,
  );
  const [temporaryState, temporaryAction, temporaryPending] = useActionState(
    activateInvitationWithTemporaryPasswordAction,
    initialTemporaryPasswordState,
  );
  const [copied, setCopied] = useState<
    "setup" | "login" | "password" | "instructions" | null
  >(null);

  if (!canManage || status === "cancelled") return null;

  const isAccepted =
    status === "accepted" || linkState.activated || temporaryState.activated;
  const linkButtonLabel = isAccepted
    ? t("members.manual.generateLink")
    : t("members.manual.activate");

  async function handleCopy(
    kind: "setup" | "login" | "password" | "instructions",
    value: string,
  ) {
    const succeeded = await copyText(value);
    if (!succeeded) return;

    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="mt-3 min-w-[320px] rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
        {t("members.manual.eyebrow")}
      </p>
      <p className="mt-1 text-xs leading-5 text-amber-800">
        {isAccepted
          ? t("members.manual.activeHelp")
          : t("members.manual.inactiveHelp")}
      </p>

      <section className="mt-4 rounded-xl border border-amber-200 bg-white/80 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-700">
          {t("members.manual.linkOption")}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {t("members.manual.linkOptionHelp")}
        </p>

        <form action={linkAction} className="mt-3 grid gap-2">
          <input type="hidden" name="invitationId" value={invitationId} />
          {!isAccepted && (
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              {t("members.manual.fullName")}
              <input
                name="fullName"
                autoComplete="name"
                placeholder={t("members.manual.fullNamePlaceholder", { email })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={linkPending}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-800 transition hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
          >
            {linkPending ? t("common.processing") : linkButtonLabel}
          </button>
        </form>

        {linkState.message && (
          <p
            className={`mt-3 rounded-lg p-2 text-xs font-semibold ${messageClass(linkState.status)}`}
          >
            {linkState.message}
          </p>
        )}

        {linkState.setupLink && (
          <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 shadow-sm">
            <p className="text-xs font-black text-slate-900">
              {t("members.manual.setupTitle")}
            </p>
            <input
              readOnly
              value={linkState.setupLink}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCopy("setup", linkState.setupLink ?? "")
                }
                className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white"
              >
                {copied === "setup"
                  ? t("members.manual.copied")
                  : t("members.manual.copyAccessLink")}
              </button>
              <a
                href={linkState.setupLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700"
              >
                {t("members.manual.testLink")}
              </a>
            </div>
            <p className="text-[11px] leading-4 text-slate-500">
              {t("members.manual.setupWarning")}
            </p>
          </div>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-emerald-900">
          {t("members.manual.temporaryOption")}
        </p>
        <p className="mt-1 text-xs leading-5 text-emerald-800">
          {t("members.manual.temporaryOptionHelp")}
        </p>

        <form action={temporaryAction} className="mt-3 grid gap-2">
          <input type="hidden" name="invitationId" value={invitationId} />
          {!isAccepted && (
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              {t("members.manual.fullName")}
              <input
                name="fullName"
                autoComplete="name"
                placeholder={t("members.manual.fullNamePlaceholder", { email })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500"
              />
            </label>
          )}

          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            {t("members.manual.emailLanguage")}
            <select
              name="locale"
              defaultValue={locale === "en" ? "en" : "fr"}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>

          <label className="flex items-start gap-2 rounded-lg bg-white p-2 text-xs font-semibold text-slate-700">
            <input
              name="sendEmail"
              type="checkbox"
              defaultChecked
              className="mt-0.5"
            />
            <span>{t("members.manual.sendTemporaryByEmail")}</span>
          </label>

          <button
            type="submit"
            disabled={temporaryPending}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
          >
            {temporaryPending
              ? t("common.processing")
              : isAccepted
                ? t("members.manual.regenerateTemporary")
                : t("members.manual.activateTemporary")}
          </button>
        </form>

        <p className="mt-2 text-[11px] leading-4 text-emerald-800">
          {t("members.manual.temporaryResetWarning")}
        </p>

        {temporaryState.message && (
          <p
            className={`mt-3 rounded-lg p-2 text-xs font-semibold ${messageClass(temporaryState.status)}`}
          >
            {temporaryState.message}
          </p>
        )}

        {temporaryState.temporaryPassword && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
              {t("members.manual.temporaryPasswordTitle")}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-950 px-3 py-3 text-base font-black text-white">
                {temporaryState.temporaryPassword}
              </code>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    "password",
                    temporaryState.temporaryPassword ?? "",
                  )
                }
                className="rounded-lg bg-emerald-700 px-3 py-3 text-xs font-bold text-white"
              >
                {copied === "password"
                  ? t("members.manual.copied")
                  : t("members.manual.copy")}
              </button>
            </div>
            {temporaryState.expiresAt ? (
              <p className="mt-2 text-xs font-semibold text-slate-600">
                {t("members.manual.expires", {
                  date: new Intl.DateTimeFormat(
                    locale === "en" ? "en-GB" : "fr-FR",
                    { dateStyle: "medium", timeStyle: "short" },
                  ).format(new Date(temporaryState.expiresAt)),
                })}
              </p>
            ) : null}
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] font-bold leading-4 text-red-700">
              {t("members.manual.passwordVisibleOnce")}
            </p>
          </div>
        )}

        {temporaryState.instructions && (
          <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 shadow-sm">
            <p className="text-xs font-black text-slate-900">
              {t("members.manual.instructionsTitle")}
            </p>
            <textarea
              readOnly
              rows={9}
              value={temporaryState.instructions}
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700"
            />
            <button
              type="button"
              onClick={() =>
                handleCopy(
                  "instructions",
                  temporaryState.instructions ?? "",
                )
              }
              className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
            >
              {copied === "instructions"
                ? t("members.manual.copied")
                : t("members.manual.copyInstructions")}
            </button>
          </div>
        )}
      </section>

      {(linkState.loginUrl || temporaryState.loginUrl) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-950 p-3 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase text-amber-300">
              {t("members.manual.permanentLogin")}
            </p>
            <p className="truncate text-xs">
              {temporaryState.loginUrl ?? linkState.loginUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              handleCopy(
                "login",
                temporaryState.loginUrl ?? linkState.loginUrl ?? "",
              )
            }
            className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-950"
          >
            {copied === "login"
              ? t("members.manual.copied")
              : t("members.manual.copy")}
          </button>
        </div>
      )}
    </div>
  );
}
