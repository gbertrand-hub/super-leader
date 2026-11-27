import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("Smart Sitemap route remains accessible to every signed-in staff role in the menu",()=>{
 const menu=read("../src/lib/navigation/dashboard-menu.ts");
 assert.equal((menu.match(/href: "\/dashboard\/my-pages"/g)||[]).length,1);
 assert.match(menu,/Mes pages · Plan du site/);
 assert.match(menu,/My pages · Site map/);
});

test("Smart Sitemap has bilingual search, links and admin diagnostics",()=>{
 const source=read("../src/app/dashboard/my-pages/page.tsx");
 assert.match(source,/Rechercher une page ou un module/);
 assert.match(source,/Search for a page or module/);
 assert.match(source,/href=\{item.resolvedHref\}/);
 assert.match(source,/isAdmin\?<div/);
 assert.match(source,/targetMembership/);
});

test("Smart Sitemap reuses sidebar rules and is not duplicated",()=>{
 const shared=read("../src/lib/navigation/resolve-dashboard-navigation.ts");
 assert.match(shared,/DASHBOARD_NAVIGATION_SECTIONS/);
 assert.doesNotMatch(shared,/\[adminDashboard, SITEMAP_LINK, /);
 assert.match(shared,/section.id==="administration"/);
});
