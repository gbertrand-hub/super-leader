#!/usr/bin/env node
/* V4.10.140 - read-only navigation integrity check.
 * Run: node scripts/audit-navigation.mjs
 * Never connects to Supabase, Vercel, or a production service.
 */
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const inventory=JSON.parse(fs.readFileSync(path.join(root,"src/lib/navigation/route-inventory.json"),"utf8"));
const appDir=path.join(root,"src/app/dashboard");
const menu=fs.readFileSync(path.join(root,"src/lib/navigation/dashboard-menu.ts"),"utf8");
const resolver=fs.readFileSync(path.join(root,"src/lib/navigation/resolve-dashboard-navigation.ts"),"utf8");

function walk(dir, accumulator=[]){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())walk(file,accumulator);
    else if(entry.isFile()&&entry.name==="page.tsx")
      accumulator.push("/dashboard"+path.relative(appDir,path.dirname(file)).split(path.sep).filter(Boolean).map(x=>"/"+x).join(""));
  }
  return accumulator;
}
const current=new Set(walk(appDir));
const registered=[...menu.matchAll(/\bhref:\s*["'](\/dashboard[^"']+)["']/g)].map(m=>m[1].split("?")[0]);
registered.push("/dashboard/admin","/dashboard/my-pages","/dashboard/canton-visitors");
const paths=[...new Set(registered)].sort();
function isMatched(href, route){
  const dynamicPattern="^"+route.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\\\[[^/]+\\\]/g,"[^/]+")+"$";
  return href===route || (route.includes("[")&&new RegExp(dynamicPattern).test(href));
}
const missingPreviouslyPresent=inventory.routes.filter(r=>!current.has(r.path)).map(r=>r.path);
const absent=paths.filter(p=>![...current].some(route=>isMatched(p,route)));
const knownGolden=new Set(inventory.routes.map(r=>r.path));
const newlyMissing=absent.filter(p=>knownGolden.has(p)||p==="/dashboard/my-pages");
const newRoutes=[...current].filter(r=>!knownGolden.has(r)).sort();
const prevNoNav=inventory.routes.filter(r=>r.kind==="static"&&!paths.some(p=>r.path===p||r.path.startsWith(p+"/"))).length;
const report={
  baseline:inventory.reference,
  baselineRouteCount:inventory.routes.length,
  currentRoutes:current.size,
  newRoutes,
  removedGoldenRoutes:missingPreviouslyPresent,
  registeredMenuPaths:paths.length,
  linksWithoutDirectPage:absent,
  note:"Some menu targets may use rewrites or shared routes. Review warnings manually; do not automatically expose orphan routes.",
  goldenUnlistedRoutes:prevNoNav,
};
console.log(JSON.stringify(report,null,2));
if(missingPreviouslyPresent.length||newlyMissing.length){
  console.error("FAIL: a previously available route or known sitemap target has disappeared.");
  process.exitCode=1;
}else{
  console.log("PASS: no Golden dashboard page was removed (this is not an auth or runtime test).");
}
