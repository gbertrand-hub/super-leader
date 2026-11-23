"use client";

import {useEffect, useRef, useState} from "react";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";

type Props = {
  today: string;
  labels: Record<
    | "section"
    | "help"
    | "settlementMode"
    | "full"
    | "installments"
    | "amount"
    | "date"
    | "method"
    | "reference"
    | "nextDate"
    | "nextAmount"
    | "proof"
    | "externalLink"
    | "chooseFile"
    | "uploading"
    | "uploaded"
    | "remove"
    | "invalidFile"
    | "attachmentHelp"
    | "noPayment"
    | "noPaymentHelp",
    string
  >;
  paymentMethods: Array<{value: string; label: string}>;
};

export function PaymentDetailsFields({today, labels, paymentMethods}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [settlementMode, setSettlementMode] = useState<"full" | "installments">("full");
  const [noInitialPayment, setNoInitialPayment] = useState(false);
  const isInstallment = settlementMode === "installments";

  function toggleNoInitialPayment(checked: boolean) {
    setNoInitialPayment(checked);
    if (checked) setSettlementMode("installments");
  }

  // SaleDraftForm restores normal controls from sessionStorage after a server-side
  // validation error. These two controls are React-controlled, so we also mirror
  // their restored DOM state back into React. Without this bridge, the browser
  // could restore the checkbox/select visually for an instant and React would then
  // reset the payment section, losing the due date and amount entered by the user.
  useEffect(() => {
    const root = rootRef.current;
    const form = root?.closest("form");
    if (!form) return;

    const syncControlledState = () => {
      const noPaymentControl = form.elements.namedItem("noInitialPayment");
      const settlementControl = form.elements.namedItem("settlementMode");

      const restoredNoPayment = noPaymentControl instanceof HTMLInputElement
        ? noPaymentControl.checked
        : false;
      const restoredMode = settlementControl instanceof HTMLSelectElement && settlementControl.value === "installments"
        ? "installments"
        : "full";

      setNoInitialPayment(restoredNoPayment);
      setSettlementMode(restoredNoPayment ? "installments" : restoredMode);
    };

    form.addEventListener("input", syncControlledState);
    form.addEventListener("change", syncControlledState);

    // Covers the first hydration/restoration pass as well as browser back/forward.
    const frame = requestAnimationFrame(syncControlledState);

    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("input", syncControlledState);
      form.removeEventListener("change", syncControlledState);
    };
  }, []);

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-black text-amber-950">{labels.section}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-amber-800">{labels.help}</p>

        <label className="mt-4 block">
          <span className="text-sm font-bold">{labels.settlementMode}</span>
          <select
            name="settlementMode"
            value={settlementMode}
            onChange={(event) => setSettlementMode(event.target.value as "full" | "installments")}
            className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3"
          >
            <option value="full" disabled={noInitialPayment}>{labels.full}</option>
            <option value="installments">{labels.installments}</option>
          </select>
        </label>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300 bg-white p-3">
          <input
            type="checkbox"
            name="noInitialPayment"
            checked={noInitialPayment}
            onChange={(event) => toggleNoInitialPayment(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-black text-amber-950">{labels.noPayment}</span>
            <span className="mt-1 block text-xs font-semibold leading-5 text-amber-800">{labels.noPaymentHelp}</span>
          </span>
        </label>

        {noInitialPayment ? (
          <>
            <input type="hidden" name="initialPaymentAmount" value="0" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold">{labels.amount}</span>
                <input type="text" value="0.00" disabled className="mt-2 w-full rounded-xl border border-amber-200 bg-slate-100 px-4 py-3 text-slate-500" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{labels.date}</span>
                <input type="text" value="-" disabled className="mt-2 w-full rounded-xl border border-amber-200 bg-slate-100 px-4 py-3 text-slate-500" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{labels.method}</span>
                <input type="text" value="-" disabled className="mt-2 w-full rounded-xl border border-amber-200 bg-slate-100 px-4 py-3 text-slate-500" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{labels.reference}</span>
                <input type="text" value="-" disabled className="mt-2 w-full rounded-xl border border-amber-200 bg-slate-100 px-4 py-3 text-slate-500" />
              </label>
            </div>
          </>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-bold">{labels.amount}</span>
              <input type="number" name="initialPaymentAmount" required min="0.01" step="0.01" className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-bold">{labels.date}</span>
              <input type="date" name="initialPaymentDate" required defaultValue={today} className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-bold">{labels.method}</span>
              <select name="paymentMethod" defaultValue="bank_transfer" className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3">
                {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-bold">{labels.reference}</span>
              <input name="initialPaymentReference" maxLength={160} className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3" />
            </label>
          </div>
        )}

        <div className="mt-4">
          <SecureAttachmentUpload
            purpose="sale"
            prefix="proof"
            label={labels.proof}
            help={labels.attachmentHelp}
            chooseLabel={labels.chooseFile}
            uploadingLabel={labels.uploading}
            uploadedLabel={labels.uploaded}
            removeLabel={labels.remove}
            errorLabel={labels.invalidFile}
          />
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-bold">{labels.externalLink}</span>
          <input type="url" name="proofUrl" maxLength={1000} placeholder="https://..." className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3" />
        </label>
      </div>

      {isInstallment ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold">{labels.nextDate}</span>
            <input type="date" name="nextPaymentDueDate" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
          </label>
          <label className="block">
            <span className="text-sm font-bold">{labels.nextAmount}</span>
            <input type="number" name="nextPaymentAmount" required min="0.01" step="0.01" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
          </label>
        </div>
      ) : null}
    </div>
  );
}
