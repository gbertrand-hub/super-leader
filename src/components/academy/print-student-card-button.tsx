"use client";
export function PrintStudentCardButton(){return <button type="button" onClick={()=>window.print()} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white print:hidden">Imprimer la carte</button>}
