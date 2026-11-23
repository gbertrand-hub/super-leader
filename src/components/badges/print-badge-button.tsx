"use client";

export function PrintBadgeButton({label}: {label: string}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white print:hidden"
    >
      {label}
    </button>
  );
}
