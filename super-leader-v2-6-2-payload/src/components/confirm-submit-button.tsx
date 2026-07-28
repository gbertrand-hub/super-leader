"use client";

import {useRef, useState, type ButtonHTMLAttributes, type MouseEvent} from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmation: string;
  dialogTitle?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function ConfirmSubmitButton({
  confirmation,
  dialogTitle = "Confirmation",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onClick,
  disabled,
  children,
  ...props
}: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled || isSubmitting) return;

    // Always stop the first submission. The form is submitted only after the
    // user explicitly confirms in the modal below.
    event.preventDefault();
    setIsOpen(true);
  }

  function cancelSubmission() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  function confirmSubmission() {
    if (isSubmitting) return;

    const submitter = buttonRef.current;
    const form = submitter?.form;
    if (!submitter || !form) {
      setIsOpen(false);
      return;
    }

    setIsSubmitting(true);
    setIsOpen(false);
    form.requestSubmit(submitter);
  }

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        type={props.type ?? "submit"}
        disabled={disabled || isSubmitting}
        onClick={handleClick}
      >
        {children}
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelSubmission();
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-submit-title"
            aria-describedby="confirm-submit-description"
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-2xl" aria-hidden="true">
              ⚠️
            </div>
            <h2 id="confirm-submit-title" className="mt-4 text-2xl font-black text-slate-950">
              {dialogTitle}
            </h2>
            <p id="confirm-submit-description" className="mt-3 text-sm font-medium leading-6 text-slate-600">
              {confirmation}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={cancelSubmission}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-800 transition hover:bg-slate-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={confirmSubmission}
                className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white transition hover:bg-indigo-800"
              >
                {confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
