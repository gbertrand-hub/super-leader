"use client";

export function ReportExportButtons({
  csvHref,
  csvLabel,
  pdfLabel,
}: {
  csvHref: string;
  csvLabel: string;
  pdfLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-3 print:hidden">
      <a
        href={csvHref}
        className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950 shadow-sm hover:bg-slate-100"
      >
        ↓ {csvLabel}
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-black text-white hover:bg-white/20"
      >
        ⎙ {pdfLabel}
      </button>
    </div>
  );
}
