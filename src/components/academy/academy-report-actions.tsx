"use client";

type ExportRow={school:string;students:number;graduated:number;progress:number;attendance:number;success:number;agreed:number;paid:number;balance:number;overdue:number;certificates:number};

export function AcademyReportActions({rows,filename}:{rows:ExportRow[];filename:string}){
  function exportCsv(){
    const header=["École","Étudiants","Diplômés","Progression %","Présence %","Réussite %","Frais convenus USD","Payé USD","Solde USD","Dossiers en retard","Certificats"];
    const body=rows.map(r=>[r.school,r.students,r.graduated,r.progress,r.attendance,r.success,r.agreed,r.paid,r.balance,r.overdue,r.certificates]);
    const csv=[header,...body].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  }
  return <div className="flex flex-wrap gap-3 print:hidden"><button type="button" onClick={()=>window.print()} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Imprimer / PDF</button><button type="button" onClick={exportCsv} className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">Exporter CSV</button></div>;
}
