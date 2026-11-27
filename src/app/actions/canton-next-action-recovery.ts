"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCantonLive } from "@/lib/canton/feature-gate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DASHBOARD = "/dashboard/canton-visitors?view=commercial";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENIOR = new Set(["owner", "admin"]);

const value = (form: FormData, key: string, max = 800) =>
  String(form.get(key) ?? "").trim().slice(0, max);

function validDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(day + "T12:00:00Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
}

function dayInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function safeReturn(form: FormData) {
  const requested = value(form, "returnTo", 500);
  return /^\/dashboard\/canton-visitors\?view=commercial(?:&site=(?:all|[0-9a-f-]{36}))?$/i.test(requested)
    ? requested
    : DASHBOARD;
}

function errorRedirect(message: string, returnTo: string): never {
  redirect(returnTo + "&error=" + encodeURIComponent(message) + "#canton-commercial-actions");
}

/** QA and explicitly approved live only. Re-schedule an OPEN action without
 * closing its lead or resetting the historical SLA clock.
 */
export async function recoverCantonNextAction(form: FormData) {
  assertCantonLive();
  const returnTo = safeReturn(form);
  const actionId = value(form, "actionId", 50);
  const proposedDate = value(form, "dueDate", 20);
  const proposedText = value(form, "actionText", 801);
  if (!UUID.test(actionId)) errorRedirect("Action commerciale introuvable.", returnTo);
  if (!validDate(proposedDate)) errorRedirect("Date de relance invalide.", returnTo);
  if (proposedText.length < 5 || proposedText.length > 800)
    errorRedirect("Veuillez decrire la nouvelle action (5 a 800 caracteres).", returnTo);

  const session = await createClient();
  const { data: { user }, error: authError } = await session.auth.getUser();
  if (authError || !user) redirect("/login?next=/dashboard/canton-visitors");
  const db = createAdminClient();
  const { data: memberships, error: memberError } = await db.from("organization_members")
    .select("organization_id,role")
    .eq("user_id", user.id).eq("is_active", true);
  if (memberError || !memberships?.length) errorRedirect("Acces non autorise.", returnTo);

  // Check each active membership, instead of assuming the first organization.
  const organizationIds = memberships!.map((m) => m.organization_id);
  const { data: action, error: actionError } = await db.from("canton_next_actions")
    .select("id,organization_id,appointment_id,assigned_to,action_text,due_date,status")
    .eq("id", actionId).in("organization_id", organizationIds).maybeSingle();
  if (actionError || !action || action.status !== "open")
    errorRedirect("Cette action n'est plus ouverte. Actualisez la page.", returnTo);

  const role = memberships!.find((m) => m.organization_id === action!.organization_id)?.role ?? "";
  const senior = SENIOR.has(role);
  const manager = role === "manager";
  if (!senior && !manager && action.assigned_to !== user.id)
    errorRedirect("Seul le responsable ou un superviseur peut reprogrammer cette action.", returnTo);

  const { data: visit, error: visitError } = await db.from("canton_appointments")
    .select("id,organization_id,site_id,department,status")
    .eq("id", action.appointment_id)
    .eq("organization_id", action.organization_id).maybeSingle();
  if (visitError || !visit || visit.status !== "completed" || !["DIG", "TCF"].includes(visit.department))
    errorRedirect("Cette action ne correspond pas a une visite commerciale terminee.", returnTo);

  // A multi-site manager may manage only sites assigned to them. A legacy
  // manager without site assignments can still manage their home HQ site.
  if (manager && !senior) {
    const [{ data: siteStaff }, { data: anyStaff }] = await Promise.all([
      db.from("visitor_site_staff").select("user_id").eq("site_id", visit.site_id)
        .eq("user_id", user.id).eq("is_active", true).limit(1).maybeSingle(),
      db.from("visitor_site_staff").select("site_id").eq("user_id", user.id)
        .eq("is_active", true).limit(1).maybeSingle(),
    ]);
    if (!siteStaff) {
      const { data: site } = visit.site_id
        ? await db.from("visitor_sites").select("is_hq").eq("id", visit.site_id)
          .eq("organization_id", action.organization_id).maybeSingle()
        : { data: null };
      if (anyStaff || !site?.is_hq)
        errorRedirect("Vous ne pouvez pas modifier une action d'un autre bureau.", returnTo);
    }
  }

  const { data: site } = visit.site_id
    ? await db.from("visitor_sites").select("timezone")
      .eq("id", visit.site_id).eq("organization_id", action.organization_id).maybeSingle()
    : { data: null };
  const timeZone = site?.timezone || "America/Chicago";
  let currentDay: string;
  try { currentDay = dayInZone(timeZone); }
  catch { errorRedirect("Fuseau horaire du bureau invalide.", returnTo); }
  if (proposedDate < currentDay!) errorRedirect("Choisissez aujourd'hui ou une date future.", returnTo);
  if (proposedDate === action.due_date && proposedText === action.action_text)
    errorRedirect("Modifiez la date ou l'action pour enregistrer une relance.", returnTo);

  // Optimistic concurrency: do not overwrite a coworker's newer reschedule.
  const { data: changed, error: updateError } = await db.from("canton_next_actions")
    .update({ due_date: proposedDate, action_text: proposedText })
    .eq("id", action.id).eq("organization_id", action.organization_id)
    .eq("status", "open").eq("assigned_to", action.assigned_to)
    .eq("due_date", action.due_date).eq("action_text", action.action_text)
    .select("id");
  if (updateError || changed?.length !== 1)
    errorRedirect("L'action a change entre-temps. Actualisez avant de reprogrammer.", returnTo);

  // Historical SLA remains anchored to the original visit; this only changes
  // the planned next action. No outbound message is sent.
  revalidatePath("/dashboard/canton-visitors");
  redirect(returnTo + "&success=" + encodeURIComponent("Relance commerciale reprogrammee. Le delai SLA initial reste visible.") + "#canton-commercial-actions");
}
