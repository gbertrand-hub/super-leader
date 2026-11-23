"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules, type OrganizationRole} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type ImportLead = Record<string, string | number | null | undefined>;
const statuses = new Set(["new","uncontacted","contact_attempt","contacted","qualified","appointment","follow_up","unqualified","converted","lost"]);
const priorities = new Set(["low","normal","high","urgent"]);
const currencies = new Set(["USD","EUR","GBP","XAF","CAD"]);

function value(formData: FormData, key: string, max = 5000) {
  const result = String(formData.get(key) ?? "").trim();
  return result ? result.slice(0, max) : null;
}
function phone(input: unknown) { const result = String(input ?? "").trim().replace(/[^\d+]/g, ""); return result || null; }
function email(input: unknown) { const result = String(input ?? "").trim().toLowerCase(); return result || null; }
function reference() { return `LEAD-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`; }
function opportunityReference() { return `OPP-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`; }
function go(message: string, kind: "success" | "error" = "success"): never { redirect(`/dashboard/crm/prospects?${kind}=${encodeURIComponent(message)}`); }

async function context() {
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error} = await admin.from("organization_members").select("organization_id,role")
    .eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "crm_sales");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance?error=access-denied");
  const visibleUserIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});
  return {admin, user: authData.user, membership, visibleUserIds};
}

async function validOwner(admin: ReturnType<typeof createAdminClient>, organizationId: string, ownerId: string | null, visible: string[]) {
  if (!ownerId || !visible.includes(ownerId)) return false;
  const {data} = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("user_id", ownerId).eq("is_active", true).maybeSingle();
  return Boolean(data);
}

async function validSector(admin: ReturnType<typeof createAdminClient>, organizationId: string, sector: string) {
  if (!sector) return false;
  const {data} = await admin.from("crm_sectors").select("code").eq("organization_id", organizationId).eq("code", sector).eq("is_active", true).maybeSingle();
  return Boolean(data);
}

async function accessibleProspect(admin: ReturnType<typeof createAdminClient>, organizationId: string, prospectId: string, actorId: string, role: string, visible: string[]) {
  const {data} = await admin.from("crm_clients").select("id,owner_id,follow_up_owner_id").eq("organization_id", organizationId).eq("id", prospectId).eq("status", "prospect").maybeSingle<{id:string;owner_id:string|null;follow_up_owner_id:string|null}>();
  if (!data) return null;
  if (role === "owner" || role === "admin") return data;
  if (role === "manager") return (data.owner_id && visible.includes(data.owner_id)) || (data.follow_up_owner_id && visible.includes(data.follow_up_owner_id)) || (!data.owner_id && !data.follow_up_owner_id) ? data : null;
  return data.owner_id === actorId || data.follow_up_owner_id === actorId ? data : null;
}

export async function createProspectAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds} = await context();
  const fullName = value(formData, "fullName", 200);
  const normalizedEmail = email(formData.get("email"));
  const normalizedPhone = phone(formData.get("phone"));
  const requestedOwnerId = value(formData, "ownerId", 50);
  const ownerId = requestedOwnerId || (COMMERCIAL_MANAGER_ROLES.has(membership.role as OrganizationRole) ? null : user.id);
  const ambassadorId = value(formData, "ambassadorId", 50);
  const sourceDetail = value(formData, "sourceDetail", 120) || "manual";
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const budgetRaw = String(formData.get("budget") ?? "").replace(",", ".");
  const budget = budgetRaw ? Number(budgetRaw) : null;
  if (!fullName || fullName.length < 2 || (!normalizedEmail && !normalizedPhone) || !priorities.has(String(formData.get("priority") ?? "normal")) || !currencies.has(currency) || (budget !== null && (!Number.isFinite(budget) || budget < 0))) {
    go("Nom et téléphone ou e-mail sont obligatoires. Vérifie aussi le budget.", "error");
  }
  if (ownerId && !(await validOwner(admin, membership.organization_id, ownerId, visibleUserIds))) go("Le commercial choisi n'est pas accessible.", "error");
  let ambassadorName: string | null = null;
  if (ambassadorId) {
    const {data: ambassador} = await admin.from("crm_ambassadors").select("id,full_name,status").eq("organization_id", membership.organization_id).eq("id", ambassadorId).eq("status", "active").maybeSingle<{id:string;full_name:string;status:string}>();
    if (!ambassador) go("L'ambassadeur choisi n'est pas actif ou n'appartient pas à cette organisation.", "error");
    ambassadorName = ambassador.full_name;
  }
  if (sourceDetail === "ambassador" && !ambassadorId) go("Choisis un ambassadeur préenregistré pour cette source.", "error");
  let duplicateQuery = admin.from("crm_clients").select("id,full_name,reference").eq("organization_id", membership.organization_id);
  const duplicateParts: string[] = [];
  if (normalizedEmail) duplicateParts.push(`email.eq.${normalizedEmail}`);
  if (normalizedPhone) duplicateParts.push(`phone.eq.${normalizedPhone}`);
  if (duplicateParts.length) duplicateQuery = duplicateQuery.or(duplicateParts.join(","));
  const {data: duplicate} = await duplicateQuery.limit(1).maybeSingle<{id: string; full_name: string; reference: string}>();
  if (duplicate) go(`Doublon détecté : ${duplicate.full_name} (${duplicate.reference}).`, "error");
  const leadStatus = String(formData.get("leadStatus") ?? "new");
  const {data, error} = await admin.from("crm_clients").insert({
    organization_id: membership.organization_id, reference: reference(), full_name: fullName,
    email: normalizedEmail, phone: normalizedPhone, whatsapp_phone: phone(formData.get("whatsapp")),
    country: value(formData, "country", 100), city: value(formData, "city", 100), source: "manual",
    source_detail: sourceDetail, campaign_name: value(formData, "campaignName", 200),
    ambassador_id: ambassadorId, ambassador_name: ambassadorName, product_interest: value(formData, "productInterest", 240),
    estimated_budget: budget, budget_currency: currency, lead_priority: String(formData.get("priority") ?? "normal"),
    lead_status: statuses.has(leadStatus) ? leadStatus : "new", next_action: value(formData, "nextAction", 500),
    next_action_at: value(formData, "nextActionAt", 50), notes: value(formData, "notes"), status: "prospect",
    owner_id: ownerId, follow_up_owner_id: ownerId, created_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !data) go(error?.message || "Impossible d'enregistrer le prospect.", "error");
  await admin.from("crm_audit_log").insert({organization_id: membership.organization_id, actor_id: user.id, entity_type: "crm_lead", entity_id: data.id, action: "lead_created", details: {source: sourceDetail, ambassadorId}});
  revalidatePath("/dashboard/crm/prospects");
  go("Prospect enregistré et prêt à être suivi.");
}

export async function updateProspectAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds} = await context();
  const prospectId = value(formData, "prospectId", 50);
  const leadStatus = String(formData.get("leadStatus") ?? "new");
  const ownerId = value(formData, "ownerId", 50);
  const fullName = value(formData, "fullName", 200);
  const normalizedEmail = email(formData.get("email"));
  const normalizedPhone = phone(formData.get("phone"));
  const priority = String(formData.get("priority") ?? "normal");
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const budgetRaw = String(formData.get("budget") ?? "").replace(",", ".");
  const budget = budgetRaw ? Number(budgetRaw) : null;
  const sourceDetail = value(formData, "sourceDetail", 120) || "manual";
  const ambassadorId = value(formData, "ambassadorId", 50);
  if (!prospectId || !fullName || fullName.length < 2 || (!normalizedEmail && !normalizedPhone) || !statuses.has(leadStatus) || !priorities.has(priority) || !currencies.has(currency) || (budget !== null && (!Number.isFinite(budget) || budget < 0))) {
    go("Nom et téléphone ou e-mail sont obligatoires. Vérifie aussi le budget, le statut, la priorité et la devise.", "error");
  }
  if (!(await accessibleProspect(admin, membership.organization_id, prospectId, user.id, membership.role, visibleUserIds))) go("Tu n'as pas accès à ce prospect.", "error");
  if (ownerId && !(await validOwner(admin, membership.organization_id, ownerId, visibleUserIds))) go("Le commercial choisi n'est pas accessible.", "error");
  let ambassadorName: string | null = null;
  if (ambassadorId) {
    const {data: ambassador} = await admin.from("crm_ambassadors").select("id,full_name,status").eq("organization_id", membership.organization_id).eq("id", ambassadorId).eq("status", "active").maybeSingle<{id:string;full_name:string;status:string}>();
    if (!ambassador) go("L'ambassadeur choisi n'est pas actif ou n'appartient pas à cette organisation.", "error");
    ambassadorName = ambassador.full_name;
  }
  if (sourceDetail === "ambassador" && !ambassadorId) go("Choisis un ambassadeur préenregistré pour cette source.", "error");
  const duplicateParts: string[] = [];
  if (normalizedEmail) duplicateParts.push(`email.eq.${normalizedEmail}`);
  if (normalizedPhone) duplicateParts.push(`phone.eq.${normalizedPhone}`);
  if (duplicateParts.length) {
    const {data: duplicate} = await admin.from("crm_clients").select("id,full_name,reference").eq("organization_id", membership.organization_id).neq("id", prospectId).or(duplicateParts.join(",")).limit(1).maybeSingle<{id:string;full_name:string;reference:string}>();
    if (duplicate) go(`Doublon détecté : ${duplicate.full_name} (${duplicate.reference}).`, "error");
  }
  const changes = {
    full_name: fullName, email: normalizedEmail, phone: normalizedPhone, whatsapp_phone: phone(formData.get("whatsapp")),
    country: value(formData, "country", 100), city: value(formData, "city", 100), source_detail: sourceDetail,
    campaign_name: value(formData, "campaignName", 200), ambassador_id: ambassadorId, ambassador_name: ambassadorName,
    product_interest: value(formData, "productInterest", 240), estimated_budget: budget, budget_currency: currency,
    lead_status: leadStatus, lead_priority: priority, owner_id: ownerId, follow_up_owner_id: ownerId,
    next_action: value(formData, "nextAction", 500), next_action_at: value(formData, "nextActionAt", 50), notes: value(formData, "notes"),
  };
  const {error} = await admin.from("crm_clients").update(changes).eq("organization_id", membership.organization_id).eq("id", prospectId).eq("status", "prospect");
  if (error) go(error.message, "error");
  await admin.from("crm_audit_log").insert({organization_id: membership.organization_id, actor_id: user.id, entity_type: "crm_lead", entity_id: prospectId, action: "lead_updated", details: {fields: Object.keys(changes), leadStatus, ownerId, ambassadorId}});
  revalidatePath("/dashboard/crm/prospects");
  go("Prospect mis à jour.");
}

export async function importProspectsAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds} = await context();
  if (!COMMERCIAL_MANAGER_ROLES.has(membership.role as OrganizationRole)) go("Seuls les responsables commerciaux peuvent importer des prospects.", "error");
  let rows: ImportLead[] = [];
  try { rows = JSON.parse(String(formData.get("rows") ?? "[]")); } catch { go("Le fichier importé est illisible.", "error"); }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) go("L'import doit contenir entre 1 et 1 000 lignes.", "error");
  const defaultOwner = value(formData, "ownerId", 50);
  const defaultAmbassadorId = value(formData, "ambassadorId", 50);
  if (defaultOwner && !(await validOwner(admin, membership.organization_id, defaultOwner, visibleUserIds))) go("Le commercial choisi n'est pas accessible.", "error");
  const {data: ambassadors} = await admin.from("crm_ambassadors").select("id,code,full_name").eq("organization_id", membership.organization_id).eq("status", "active");
  const ambassadorByKey = new Map<string,{id:string;full_name:string}>();
  for (const ambassador of ambassadors ?? []) {
    ambassadorByKey.set(String(ambassador.id), ambassador);
    ambassadorByKey.set(String(ambassador.code).trim().toLowerCase(), ambassador);
    ambassadorByKey.set(String(ambassador.full_name).trim().toLowerCase(), ambassador);
  }
  if (defaultAmbassadorId && !ambassadorByKey.has(defaultAmbassadorId)) go("L'ambassadeur par défaut n'est pas actif.", "error");
  const {data: existing} = await admin.from("crm_clients").select("email,phone").eq("organization_id", membership.organization_id);
  const emails = new Set((existing ?? []).map((item) => String(item.email ?? "").toLowerCase()).filter(Boolean));
  const phones = new Set((existing ?? []).map((item) => phone(item.phone)).filter(Boolean));
  const {data: batch, error: batchError} = await admin.from("crm_lead_import_batches").insert({organization_id: membership.organization_id, file_name: value(formData, "fileName", 240) || "import", source: value(formData, "sourceDetail", 120) || "import", campaign_name: value(formData, "campaignName", 200), ambassador_name: value(formData, "ambassadorName", 200), total_rows: rows.length, created_by: user.id}).select("id").single<{id: string}>();
  if (batchError || !batch) go(batchError?.message || "Impossible de démarrer l'import.", "error");
  const inserts: Record<string, unknown>[] = [];
  let duplicates = 0; let rejected = 0;
  for (const row of rows) {
    const fullName = String(row.full_name ?? row.name ?? row.nom ?? "").trim().slice(0, 200);
    const rowEmail = email(row.email); const rowPhone = phone(row.phone ?? row.telephone);
    if (fullName.length < 2 || (!rowEmail && !rowPhone)) { rejected++; continue; }
    if ((rowEmail && emails.has(rowEmail)) || (rowPhone && phones.has(rowPhone))) { duplicates++; continue; }
    if (rowEmail) emails.add(rowEmail); if (rowPhone) phones.add(rowPhone);
    const budget = Number(row.budget ?? row.estimated_budget ?? 0);
    const ambassadorKey = String(row.ambassador_code ?? row.ambassador ?? row.ambassadeur ?? defaultAmbassadorId ?? "").trim().toLowerCase();
    const ambassador = ambassadorByKey.get(ambassadorKey) ?? null;
    inserts.push({organization_id: membership.organization_id, reference: reference(), full_name: fullName, email: rowEmail, phone: rowPhone, whatsapp_phone: phone(row.whatsapp), country: String(row.country ?? row.pays ?? "").trim() || null, city: String(row.city ?? row.ville ?? "").trim() || null, source: "sale_import", source_detail: String(row.source ?? formData.get("sourceDetail") ?? "import").trim(), campaign_name: String(row.campaign ?? formData.get("campaignName") ?? "").trim() || null, ambassador_id: ambassador?.id ?? null, ambassador_name: ambassador?.full_name ?? null, product_interest: String(row.product ?? row.produit ?? "").trim() || null, estimated_budget: Number.isFinite(budget) && budget >= 0 ? budget : null, budget_currency: currencies.has(String(row.currency ?? "USD").toUpperCase()) ? String(row.currency ?? "USD").toUpperCase() : "USD", lead_priority: priorities.has(String(row.priority ?? "normal")) ? String(row.priority) : "normal", lead_status: "new", status: "prospect", owner_id: defaultOwner, follow_up_owner_id: defaultOwner, imported_batch_id: batch.id, created_by: user.id, notes: String(row.notes ?? "").trim().slice(0, 5000) || null});
  }
  const {error} = inserts.length ? await admin.from("crm_clients").insert(inserts) : {error: null};
  if (error) go(error.message, "error");
  await admin.from("crm_lead_import_batches").update({imported_rows: inserts.length, duplicate_rows: duplicates, rejected_rows: rejected}).eq("id", batch.id);
  revalidatePath("/dashboard/crm/prospects");
  go(`Import terminé : ${inserts.length} ajouté(s), ${duplicates} doublon(s), ${rejected} rejeté(s).`);
}

export async function convertProspectAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds} = await context();
  const prospectId = value(formData, "prospectId", 50); const sector = String(formData.get("sector") ?? "");
  const ownerId = value(formData, "ownerId", 50); const title = value(formData, "title", 220);
  const nextAction = value(formData, "nextAction", 500); const nextActionAt = value(formData, "nextActionAt", 50);
  if (!prospectId || !(await validSector(admin, membership.organization_id, sector)) || !ownerId || !title || !nextAction || !nextActionAt || !(await validOwner(admin, membership.organization_id, ownerId, visibleUserIds))) go("Complète le secteur, le responsable, le titre et la prochaine action.", "error");
  if (!(await accessibleProspect(admin, membership.organization_id, prospectId, user.id, membership.role, visibleUserIds))) go("Tu n'as pas accès à ce prospect.", "error");
  const {data: prospect} = await admin.from("crm_clients").select("id,full_name,product_interest,estimated_budget,budget_currency,source_detail,ambassador_id").eq("organization_id", membership.organization_id).eq("id", prospectId).eq("status", "prospect").maybeSingle<{id:string;full_name:string;product_interest:string|null;estimated_budget:number|null;budget_currency:string;source_detail:string|null;ambassador_id:string|null}>();
  if (!prospect) go("Prospect introuvable.", "error");
  const {data: stage} = await admin.from("crm_pipeline_stages").select("id,probability").eq("organization_id", membership.organization_id).eq("sector", sector).eq("stage_key", "new_lead").eq("is_active", true).maybeSingle<{id:string;probability:number}>();
  if (!stage) go("Les étapes du pipeline ne sont pas configurées pour ce secteur.", "error");
  const {data: opportunity, error} = await admin.from("crm_opportunities").insert({organization_id: membership.organization_id, reference: opportunityReference(), client_id: prospect.id, ambassador_id: prospect.ambassador_id, sector, title, owner_id: ownerId, stage_id: stage.id, status: "open", source: prospect.source_detail === "ambassador" ? "partner" : prospect.source_detail === "facebook_ads" ? "campaign" : "other", value_amount: prospect.estimated_budget ?? 0, budget_amount: prospect.estimated_budget, currency: prospect.budget_currency, probability: stage.probability, need_summary: prospect.product_interest, next_action: nextAction, next_action_at: nextActionAt, created_by: user.id, updated_by: user.id}).select("id").single<{id:string}>();
  if (error || !opportunity) go(error?.message || "Conversion impossible.", "error");
  await admin.from("crm_clients").update({lead_status: "converted", converted_at: new Date().toISOString(), owner_id: ownerId, follow_up_owner_id: ownerId}).eq("id", prospect.id);
  await admin.from("crm_audit_log").insert({organization_id: membership.organization_id, actor_id: user.id, entity_type: "crm_lead", entity_id: prospect.id, action: "lead_converted", details: {opportunityId: opportunity.id, sector}});
  revalidatePath("/dashboard/crm/prospects"); revalidatePath("/dashboard/crm/pipeline");
  redirect(`/dashboard/crm/opportunities/${opportunity.id}?success=${encodeURIComponent("Prospect converti en opportunité.")}`);
}
