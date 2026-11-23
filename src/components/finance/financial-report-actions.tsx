"use client";
export function FinancialReportActions({exportUrl}:{exportUrl:string}){return <div className="flex gap-3 print:hidden"><button type="button" onClick={()=>window.print()} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Imprimer / PDF</button><a href={exportUrl} className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">Exporter CSV</a></div>}
