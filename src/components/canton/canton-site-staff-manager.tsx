"use client";

import {useMemo,useState} from "react";
import {bulkManageVisitorSiteStaff,assignVisitorTeamToSite,manageVisitorSiteStaff} from "@/app/actions/canton-visitors";

type Member={userId:string;name:string;email?:string|null;orgRole:string;accessRole?:string|null};
type Team={id:string;name:string;department?:string|null;userIds:string[]};

export function CantonSiteStaffManager({siteId,members,teams,locale}:{siteId:string;members:Member[];teams:Team[];locale:"fr"|"en"}){
 const fr=locale==="fr";
 const [search,setSearch]=useState("");
 const [orgRole,setOrgRole]=useState("all");
 const [accessFilter,setAccessFilter]=useState("all");
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [bulkRole,setBulkRole]=useState("host");
 const [teamId,setTeamId]=useState("");
 const [teamRole,setTeamRole]=useState("host");

 const filtered=useMemo(()=>members.filter(m=>{
  const hay=(m.name+" "+(m.email||"")+" "+m.orgRole+" "+(m.accessRole||"")).toLowerCase();
  if(search&&!hay.includes(search.toLowerCase())) return false;
  if(orgRole!=="all"&&m.orgRole!==orgRole) return false;
  if(accessFilter==="assigned"&&!m.accessRole) return false;
  if(accessFilter==="unassigned"&&m.accessRole) return false;
  if(["reception","host","manager"].includes(accessFilter)&&m.accessRole!==accessFilter) return false;
  return true;
 }),[members,search,orgRole,accessFilter]);

 const assignedCount=members.filter(m=>!!m.accessRole).length;
 const receptionCount=members.filter(m=>m.accessRole==="reception").length;
 const managerCount=members.filter(m=>m.accessRole==="manager").length;
 const hostCount=members.filter(m=>m.accessRole==="host").length;
 const allVisibleSelected=filtered.length>0&&filtered.every(m=>selected.has(m.userId));

 function toggle(id:string){const next=new Set(selected);if(next.has(id))next.delete(id);else next.add(id);setSelected(next)}
 function toggleAll(){const next=new Set(selected);if(allVisibleSelected)filtered.forEach(m=>next.delete(m.userId));else filtered.forEach(m=>next.add(m.userId));setSelected(next)}

 return <div className="space-y-4 border-t p-4">
  <div className="grid gap-3 sm:grid-cols-4">
   <div className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">{fr?"Affectés":"Assigned"}</div><div className="text-2xl font-bold">{assignedCount}</div></div>
   <div className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">{fr?"Réception":"Reception"}</div><div className="text-2xl font-bold">{receptionCount}</div></div>
   <div className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">Hosts</div><div className="text-2xl font-bold">{hostCount}</div></div>
   <div className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">Managers</div><div className="text-2xl font-bold">{managerCount}</div></div>
  </div>

  <div className="grid gap-2 lg:grid-cols-[1.6fr_1fr_1fr]">
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={fr?"Rechercher nom ou email…":"Search name or email…"} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/>
   <select value={orgRole} onChange={e=>setOrgRole(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
    <option value="all">{fr?"Tous les rôles organisation":"All organization roles"}</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="hr">HR</option><option value="employee">Employee</option>
   </select>
   <select value={accessFilter} onChange={e=>setAccessFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
    <option value="all">{fr?"Tous les accès locaux":"All local access"}</option><option value="assigned">{fr?"Déjà affectés":"Assigned"}</option><option value="unassigned">{fr?"Sans accès local":"Unassigned"}</option><option value="reception">{fr?"Réception":"Reception"}</option><option value="host">Host</option><option value="manager">Manager</option>
   </select>
  </div>

  <div className="rounded-xl border bg-indigo-50 p-3">
   <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={toggleAll} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">{allVisibleSelected?(fr?"Désélectionner la vue":"Clear visible"):(fr?"Sélectionner la vue":"Select visible")}</button>
    <span className="text-sm font-semibold">{selected.size} {fr?"sélectionné(s)":"selected"}</span>
    <select value={bulkRole} onChange={e=>setBulkRole(e.target.value)} className="rounded-lg border bg-white px-3 py-2 text-sm"><option value="reception">{fr?"Réception":"Reception"}</option><option value="host">Host</option><option value="manager">Manager</option></select>
    <form action={bulkManageVisitorSiteStaff}>
     <input type="hidden" name="siteId" value={siteId}/><input type="hidden" name="accessRole" value={bulkRole}/>
     {[...selected].map(id=><input key={id} type="hidden" name="userIds" value={id}/>)}
     <button name="operation" value="grant" disabled={!selected.size} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{fr?"Attribuer en masse":"Bulk assign"}</button>
     <button name="operation" value="revoke" disabled={!selected.size} className="ml-2 rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-900 disabled:opacity-40">{fr?"Retirer en masse":"Bulk remove"}</button>
    </form>
   </div>
  </div>

  <div className="rounded-xl border bg-amber-50 p-3">
   <div className="mb-2 text-sm font-semibold text-amber-950">{fr?"Affecter une équipe existante":"Assign an existing team"}</div>
   <form action={assignVisitorTeamToSite} className="flex flex-wrap gap-2">
    <input type="hidden" name="siteId" value={siteId}/>
    <select name="teamId" value={teamId} onChange={e=>setTeamId(e.target.value)} className="min-w-56 rounded-lg border bg-white px-3 py-2 text-sm" required>
     <option value="">{fr?"Choisir une équipe…":"Choose a team…"}</option>
     {teams.map(t=><option key={t.id} value={t.id}>{t.name}{t.department?" · "+t.department:""} {"("+t.userIds.length+")"}</option>)}
    </select>
    <select name="accessRole" value={teamRole} onChange={e=>setTeamRole(e.target.value)} className="rounded-lg border bg-white px-3 py-2 text-sm"><option value="reception">{fr?"Réception":"Reception"}</option><option value="host">Host</option><option value="manager">Manager</option></select>
    <button disabled={!teamId} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{fr?"Affecter l’équipe":"Assign team"}</button>
   </form>
  </div>

  <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
   {filtered.map(m=><div key={m.userId} className="grid gap-2 rounded-lg border bg-white p-3 md:grid-cols-[auto_1.5fr_.8fr_1.2fr] md:items-center">
    <input type="checkbox" checked={selected.has(m.userId)} onChange={()=>toggle(m.userId)} aria-label={fr?"Sélectionner":"Select"}/>
    <div><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.email||""}{m.email?" · ":""}{m.orgRole}</div></div>
    <div>{m.accessRole?<span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">{m.accessRole}</span>:<span className="text-xs text-slate-400">{fr?"Aucun accès local":"No local access"}</span>}</div>
    <form action={manageVisitorSiteStaff} className="flex flex-wrap justify-end gap-2">
     <input type="hidden" name="siteId" value={siteId}/><input type="hidden" name="userId" value={m.userId}/>
     <select name="accessRole" defaultValue={m.accessRole||"host"} className="rounded border border-slate-300 bg-white px-2 py-2 text-xs"><option value="reception">{fr?"Réception":"Reception"}</option><option value="host">Host</option><option value="manager">Manager</option></select>
     <button name="operation" value="grant" className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white">{m.accessRole?(fr?"Modifier":"Update"):(fr?"Attribuer":"Assign")}</button>
     {m.accessRole&&<button name="operation" value="revoke" className="rounded bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-900">{fr?"Retirer":"Remove"}</button>}
    </form>
   </div>)}
   {!filtered.length&&<div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">{fr?"Aucun employé ne correspond aux filtres.":"No staff match the filters."}</div>}
  </div>
 </div>;
}
