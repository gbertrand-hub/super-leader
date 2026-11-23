"use client";

import {useEffect,useRef,useState} from "react";
import {usePathname,useSearchParams} from "next/navigation";

const PREFIX="superleader:draft:v1:";
const PENDING_KEY="superleader:draft:pending:v1";
const MAX_AGE=7*24*60*60*1000;
const sensitive=/password|passcode|secret|token|card.?number|cvv|cvc|ssn|social.?security|bank.?account|routing|iban/i;
type Entry=[string,string];
type Draft={version:1;updatedAt:number;entries:Entry[]};
type Pending={key:string;updatedAt:number};

function editable(element:Element):element is HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement{
 if(element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement)return Boolean(element.name)&&!element.disabled;
 if(!(element instanceof HTMLInputElement)||!element.name||element.disabled)return false;
 return !["hidden","file","password","submit","button","reset","image"].includes(element.type);
}

function protectedForm(form:HTMLFormElement){
 const explicitMethod=form.getAttribute("method")?.toLowerCase();
 if(form.dataset.draft==="off"||explicitMethod==="get"||form.querySelector('input[type="password"]'))return false;
 const fields=Array.from(form.elements).filter(editable).filter(field=>!sensitive.test(field.name));
 return fields.some(field=>field instanceof HTMLTextAreaElement)||fields.length>=2;
}

function hash(value:string){let result=2166136261;for(let index=0;index<value.length;index++){result^=value.charCodeAt(index);result=Math.imul(result,16777619)}return(result>>>0).toString(36)}

function keyFor(form:HTMLFormElement,pathname:string){
 if(form.dataset.draftKey)return `${PREFIX}${pathname}:${form.dataset.draftKey}`;
 const names=Array.from(form.elements).filter(editable).map(field=>field.name).sort().join("|");
 const identities=Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name$="_id"],input[type="hidden"][name="id"]')).map(field=>`${field.name}=${field.value}`).sort().join("|");
 const similar=Array.from(document.forms).filter(candidate=>Array.from(candidate.elements).filter(editable).map(field=>field.name).sort().join("|")===names),position=Math.max(0,similar.indexOf(form));
 return `${PREFIX}${pathname}:${hash(`${names}|${identities}|${position}`)}`;
}

function collect(form:HTMLFormElement):Entry[]{
 const entries:Entry[]=[];
 Array.from(form.elements).filter(editable).forEach(field=>{
  if(sensitive.test(field.name))return;
  if(field instanceof HTMLInputElement&&(field.type==="checkbox"||field.type==="radio")){entries.push([field.name,field.checked?`checked:${field.value}`:`unchecked:${field.value}`]);return}
  entries.push([field.name,field.value]);
 });
 return entries;
}

function restore(form:HTMLFormElement,draft:Draft){
 const values=new Map<string,string[]>();
 draft.entries.forEach(([name,value])=>values.set(name,[...(values.get(name)??[]),value]));
 Array.from(form.elements).filter(editable).forEach(field=>{
  if(sensitive.test(field.name))return;
  const saved=values.get(field.name);if(!saved)return;
  if(field instanceof HTMLInputElement&&(field.type==="checkbox"||field.type==="radio"))field.checked=saved.includes(`checked:${field.value}`);
  else field.value=saved[0]??"";
 });
}

export function DashboardFormDraftProtector(){
 const pathname=usePathname(),searchParams=useSearchParams(),querySignature=searchParams.toString(),timer=useRef<ReturnType<typeof setTimeout>|null>(null),[message,setMessage]=useState("");
 useEffect(()=>{
  const now=Date.now();
  for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(!key?.startsWith(PREFIX))continue;try{const draft=JSON.parse(sessionStorage.getItem(key)??"") as Draft;if(draft.version!==1||now-draft.updatedAt>MAX_AGE)sessionStorage.removeItem(key)}catch{sessionStorage.removeItem(key)}}
  const query=new URLSearchParams(window.location.search),pendingRaw=sessionStorage.getItem(PENDING_KEY);
  if(query.has("success")&&pendingRaw){try{const pending=JSON.parse(pendingRaw) as Pending;if(now-pending.updatedAt<10*60*1000)sessionStorage.removeItem(pending.key)}catch{}sessionStorage.removeItem(PENDING_KEY)}
  const forms=Array.from(document.forms).filter(protectedForm);let restored=0;
  forms.forEach(form=>{const raw=sessionStorage.getItem(keyFor(form,pathname));if(!raw)return;try{const draft=JSON.parse(raw) as Draft;if(draft.version===1){restore(form,draft);restored++}}catch{sessionStorage.removeItem(keyFor(form,pathname))}});
  if(restored)setMessage(`${restored} brouillon(s) restauré(s)`);
  const save=(form:HTMLFormElement)=>{if(!protectedForm(form))return;const key=keyFor(form,pathname),draft:Draft={version:1,updatedAt:Date.now(),entries:collect(form)};sessionStorage.setItem(key,JSON.stringify(draft));setMessage("Brouillon sauvegardé automatiquement")};
  const onInput=(event:Event)=>{const form=(event.target as Element|null)?.closest("form");if(!(form instanceof HTMLFormElement)||!protectedForm(form))return;if(timer.current)clearTimeout(timer.current);setMessage("Sauvegarde du brouillon…");timer.current=setTimeout(()=>save(form),500)};
  const onFocus=(event:Event)=>{const form=(event.target as Element|null)?.closest("form");if(form instanceof HTMLFormElement&&protectedForm(form))setMessage("Protection automatique active pour ce formulaire")};
  const onSubmit=(event:Event)=>{const form=event.target;if(!(form instanceof HTMLFormElement)||!protectedForm(form))return;save(form);sessionStorage.setItem(PENDING_KEY,JSON.stringify({key:keyFor(form,pathname),updatedAt:Date.now()} satisfies Pending))};
  const onReset=(event:Event)=>{const form=event.target;if(!(form instanceof HTMLFormElement))return;sessionStorage.removeItem(keyFor(form,pathname));setMessage("Brouillon effacé")};
  document.addEventListener("focusin",onFocus,true);document.addEventListener("input",onInput,true);document.addEventListener("change",onInput,true);document.addEventListener("submit",onSubmit,true);document.addEventListener("reset",onReset,true);
  return()=>{document.removeEventListener("focusin",onFocus,true);document.removeEventListener("input",onInput,true);document.removeEventListener("change",onInput,true);document.removeEventListener("submit",onSubmit,true);document.removeEventListener("reset",onReset,true);if(timer.current)clearTimeout(timer.current)};
 },[pathname,querySignature]);
 useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(""),3000);return()=>clearTimeout(id)},[message]);
 return message?<div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[100] max-w-sm rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-2xl">{message}</div>:null;
}
