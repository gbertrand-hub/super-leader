"use client";

import {useEffect, useRef, type FormEvent, type ReactNode} from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  draftKey: string;
  errorField?: string;
  errorMessage?: string;
  clearDraft: boolean;
};

type Draft = Record<string, string | boolean>;

function snapshot(form: HTMLFormElement): Draft {
  const draft: Draft = {};
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (!control.name || control.disabled || control.name.startsWith("proof") || control instanceof HTMLInputElement && (control.type === "file" || control.type === "submit")) continue;
    draft[control.name] = control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")
      ? control.checked
      : control.value;
  }
  return draft;
}

function restore(form: HTMLFormElement, draft: Draft) {
  for (const [name, value] of Object.entries(draft)) {
    const control = form.elements.namedItem(name);
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
      control.checked = Boolean(value);
    } else {
      control.value = String(value);
    }
    control.dispatchEvent(new Event("input", {bubbles: true}));
    control.dispatchEvent(new Event("change", {bubbles: true}));
  }
}

export function SaleDraftForm({action, children, draftKey, errorField, errorMessage, clearDraft}: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (clearDraft) {
      sessionStorage.removeItem(draftKey);
      return;
    }
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved) as Draft;
        restore(form, draft);
        requestAnimationFrame(() => restore(form, draft));
      }
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  }, [clearDraft, draftKey]);

  useEffect(() => {
    if (!errorField) return;
    const frame = requestAnimationFrame(() => {
      const control = formRef.current?.elements.namedItem(errorField);
      if (!(control instanceof HTMLElement)) return;
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", "sale-form-error");
      control.scrollIntoView({behavior: "smooth", block: "center"});
      control.focus({preventScroll: true});
    });
    return () => cancelAnimationFrame(frame);
  }, [errorField]);

  function preserveDraft(event: FormEvent<HTMLFormElement>) {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(snapshot(event.currentTarget)));
    } catch {
      // Submission must remain available even if browser storage is disabled.
    }
  }

  return (
    <form ref={formRef} action={action} onInput={preserveDraft} onChange={preserveDraft} onSubmit={preserveDraft} className="mt-5 space-y-4">
      {errorMessage ? (
        <div id="sale-form-error" role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {errorMessage}
        </div>
      ) : null}
      {children}
    </form>
  );
}
