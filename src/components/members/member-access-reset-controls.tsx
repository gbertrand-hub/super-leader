"use client";

import { useActionState, useState } from "react";
import {
  resetMemberWithTemporaryPasswordAction,
  sendMemberRecoveryLinkAction,
  type MemberRecoveryAccessState,
  type TemporaryPasswordAccessState,
} from "@/app/actions/members";
import { useI18n } from "@/i18n/client";

const initialRecoveryState: MemberRecoveryAccessState = { status: "idle" };
const initialTemporaryState: TemporaryPasswordAccessState = { status: "idle" };

type Props = {
  memberId: string;
  email: string;
  fullName: string;
  canReset: boolean;
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

export function MemberAccessResetControls({
  memberId,
  email,
  fullName,
  canReset,
}: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<
    "link" | "password" | "instructions" | null
  >(null);
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(
    sendMemberRecoveryLinkAction,
    initialRecoveryState,
  );
  const [temporaryState, temporaryAction, temporaryPending] = useActionState(
    resetMemberWithTemporaryPasswordAction,
    initialTemporaryState,
  );

  if (!canReset) return null;

  async function handleCopy(
    kind: "link" | "password" | "instructions",
    value: string,
  ) {
    const succeeded = await copyText(value);
    if (!succeeded) return;
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-800 transition hover:bg-indigo-100"
        aria-expanded={open}
      >
        {open
          ? t("members.accessReset.close")
          : t("members.accessReset.open")}
      </button>

      {open ? (
        <section className="mt-3 rounded-2xl border border-indigo-100 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-indigo-700">
                {t("members.accessReset.eyebrow")}
              </p>
              <h4 className="mt-1 text-lg font-black text-slate-950">
                {fullName}
              </h4>
              <p className="text-sm text-slate-500">{email}</p>
            </div>
            <p className="max-w-xl text-xs leading-5 text-slate-600">
              {t("members.accessReset.help")}
            </p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-indigo-200 bg-white p-4">
              <p className="text-xs font-black uppercase tracking-wide text-indigo-700">
                {t("members.accessReset.secureLinkTitle")}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {t("members.accessReset.secureLinkHelp")}
              </p>

              <form action={recoveryAction} className="mt-4 grid gap-3">
                <input type="hidden" name="memberId" value={memberId} />
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  {t("members.manual.emailLanguage")}
                  <select
                    name="locale"
                    defaultValue={locale === "en" ? "en" : "fr"}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500"
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-xs font-semibold text-slate-700">
                  <input
                    name="sendEmail"
                    type="checkbox"
                    defaultChecked
                    className="mt-0.5"
                  />
                  <span>{t("members.accessReset.sendLinkByEmail")}</span>
                </label>
                <button
                  type="submit"
                  disabled={recoveryPending}
                  className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-black text-white transition hover:bg-indigo-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {recoveryPending
                    ? t("common.processing")
                    : t("members.accessReset.generateLink")}
                </button>
              </form>

              {recoveryState.message ? (
                <p
                  className={`mt-3 rounded-lg p-3 text-xs font-semibold ${messageClass(recoveryState.status)}`}
                >
                  {recoveryState.message}
                </p>
              ) : null}

              {recoveryState.setupLink ? (
                <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3">
                  <input
                    readOnly
                    value={recoveryState.setupLink}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy("link", recoveryState.setupLink ?? "")
                    }
                    className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                  >
                    {copied === "link"
                      ? t("members.manual.copied")
                      : t("members.accessReset.copyLink")}
                  </button>
                  <p className="text-[11px] leading-4 text-red-700">
                    {t("members.accessReset.linkWarning")}
                  </p>
                </div>
              ) : null}
            </article>

            <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                {t("members.accessReset.temporaryTitle")}
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {t("members.accessReset.temporaryHelp")}
              </p>

              <form action={temporaryAction} className="mt-4 grid gap-3">
                <input type="hidden" name="memberId" value={memberId} />
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
                <label className="flex items-start gap-2 rounded-lg bg-white p-3 text-xs font-semibold text-slate-700">
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
                    : t("members.accessReset.generateTemporary")}
                </button>
              </form>

              <p className="mt-3 rounded-lg bg-red-50 p-3 text-[11px] font-bold leading-4 text-red-700">
                {t("members.accessReset.temporaryWarning")}
              </p>

              {temporaryState.message ? (
                <p
                  className={`mt-3 rounded-lg p-3 text-xs font-semibold ${messageClass(temporaryState.status)}`}
                >
                  {temporaryState.message}
                </p>
              ) : null}

              {temporaryState.temporaryPassword ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
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
                  <p className="mt-2 text-[11px] font-bold leading-4 text-red-700">
                    {t("members.manual.passwordVisibleOnce")}
                  </p>
                </div>
              ) : null}

              {temporaryState.instructions ? (
                <div className="mt-3 grid gap-2 rounded-xl bg-white p-3">
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
              ) : null}
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
