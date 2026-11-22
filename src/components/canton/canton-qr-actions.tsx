"use client";

type Props={
 locale:"fr"|"en";
 label:string;
 arrivalUrl:string;
 feedbackUrl:string;
 posterHref:string;
};

const qrImage=(url:string)=>"https://api.qrserver.com/v1/create-qr-code/?size=1200x1200&margin=24&data="+encodeURIComponent(url);

export function CantonQrActions({locale,label,arrivalUrl,feedbackUrl,posterHref}:Props){
 const fr=locale==="fr";
 const download=(url:string,suffix:string)=>{
  const a=document.createElement("a");
  a.href=qrImage(url);
  a.download=(label+"-"+suffix+".png").replace(/[^a-z0-9._-]+/gi,"-");
  a.target="_blank";
  a.rel="noreferrer";
  a.click();
 };
 const share=async()=>{
  const text=(fr?"QR d’arrivée et de feedback — ":"Arrival and feedback QR — ")+label+"\n"+arrivalUrl+"\n"+feedbackUrl;
  if(navigator.share){
   try{await navigator.share({title:label,text});return;}catch{}
  }
  await navigator.clipboard.writeText(text);
  alert(fr?"Liens copiés. Vous pouvez les coller dans WhatsApp ou un email.":"Links copied. Paste them into WhatsApp or email.");
 };
 return <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
  <button type="button" onClick={()=>download(arrivalUrl,"qr-arrivee")} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{fr?"Télécharger QR arrivée":"Download arrival QR"}</button>
  <button type="button" onClick={()=>download(feedbackUrl,"qr-feedback")} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{fr?"Télécharger QR feedback":"Download feedback QR"}</button>
  <a href={posterHref} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">{fr?"Imprimer l’affiche":"Print poster"}</a>
  <button type="button" onClick={share} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white">{fr?"Partager":"Share"}</button>
 </div>;
}
