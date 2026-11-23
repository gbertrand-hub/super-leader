"use client";

export function PrintPageButton({label}: {label: string}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
