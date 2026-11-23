"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings, VIP_SERVICE_TYPES} from "@/lib/vip/settings";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const VIP_OPERATIONS_ROLES = new Set(["owner", "admin", "hr"]);
const VIP_DECISION_ROLES = new Set(["owner", "admin", "executive"]);
const VIP_SETTINGS_ROLES = new Set(["owner", "admin"]);
const TRAVEL_REVIEW_DECISIONS = new Set(["under_review", "needs_information", "approved", "rejected"]);
const TRAVEL_PROGRESS_STATUSES = new Set(["in_progress", "completed", "cancelled"]);

const SERVICE_STATUSES = new Set(["planned", "confirmed", "in_progress", "completed", "cancelled"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return "";
  return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? "" : result;
}

function dateTimeValue(value: FormDataEntryValue | null) {
  const result = text(value, 40);
  if (!result) return null;
  const parsed = new Date(result);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function go(message: string, kind: "success" | "error", route: "travel" | "country-welcome"): never {
  redirect(`/dashboard/vip/${route}?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const translate = (frText: string, enText: string) => fr ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (error || !membership) redirect("/dashboard/company");
  const {data: vipSettings} = await admin.from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_events_travel_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_events_travel_assistant_user_id: string | null}>();
  const hasVipLeadershipRole = vipSettings?.vip_manager_user_id === authData.user.id || vipSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipEventsTravelAssistant = vipSettings?.vip_events_travel_assistant_user_id === authData.user.id;
  const hasVipTravelRole = hasVipLeadershipRole || isVipEventsTravelAssistant;
  if (!VIP_ROLES.has(membership.role) && !hasVipTravelRole) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, translate, hasVipLeadershipRole, isVipEventsTravelAssistant, hasVipTravelRole};
}

async function audit(input: {
  organizationId: string;
  entityType: "travel" | "travel_service" | "country_representative";
  entityId: string;
  actorId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("vip_audit_log").insert({
    organization_id: input.organizationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("VIP travel audit failed", error);
}

export async function createVipTravelRequestAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipTravelRole} = await getContext();
  if (!VIP_OPERATIONS_ROLES.has(membership.role) && !hasVipTravelRole) {
    go(translate("Tu n’as pas l’autorisation de créer un déplacement VIP.", "You are not allowed to create a VIP trip."), "error", "travel");
  }
  const settings = await getVipProgramSettings(admin, membership.organization_id);
  const enabledServices = new Set(settings.enabled_travel_services.filter((value) => (VIP_SERVICE_TYPES as readonly string[]).includes(value)));

  const memberId = text(formData.get("memberId"), 80);
  const destinationCountry = text(formData.get("destinationCountry"), 120);
  const destinationCity = text(formData.get("destinationCity"), 120);
  const arrivalDate = dateValue(formData.get("arrivalDate"));
  const departureDate = dateValue(formData.get("departureDate"));
  const purpose = text(formData.get("purpose"), 2000);
  const consentToShare = formData.get("consentToShare") === "yes";
  const requestedServices = formData
    .getAll("requestedServices")
    .map((value) => text(value, 60))
    .filter((value) => enabledServices.has(value));

  if (!memberId || destinationCountry.length < 2 || destinationCity.length < 2 || !arrivalDate || !departureDate || departureDate < arrivalDate || purpose.length < 5) {
    go(translate("Complète correctement le membre, la destination, les dates et le motif.", "Complete the member, destination, dates and purpose correctly."), "error", "travel");
  }
  if (settings.require_travel_consent && !consentToShare) {
    go(translate("Le consentement au partage avec l’équipe locale est obligatoire.", "Consent to share with the local team is required."), "error", "travel");
  }
  const earliestArrival = new Date();
  earliestArrival.setUTCHours(0, 0, 0, 0);
  earliestArrival.setUTCDate(earliestArrival.getUTCDate() + settings.travel_min_notice_days);
  if (arrivalDate < earliestArrival.toISOString().slice(0, 10)) {
    go(
      translate(
        `Le déplacement doit être annoncé au moins ${settings.travel_min_notice_days} jour(s) à l’avance.`,
        `The trip must be submitted at least ${settings.travel_min_notice_days} day(s) in advance.`,
      ),
      "error",
      "travel",
    );
  }

  const {data: member} = await admin
    .from("vip_members")
    .select("id,status")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!member || ["suspended", "withdrawn", "expired"].includes(member.status)) {
    go(translate("Le membre VIP sélectionné n’est pas admissible à ce déplacement.", "The selected VIP member is not eligible for this trip."), "error", "travel");
  }

  const {data: created, error} = await admin
    .from("vip_travel_requests")
    .insert({
      organization_id: membership.organization_id,
      member_id: memberId,
      destination_country: destinationCountry,
      destination_city: destinationCity,
      arrival_date: arrivalDate,
      departure_date: departureDate,
      purpose,
      arrival_details: text(formData.get("arrivalDetails"), 2000) || null,
      accommodation_details: text(formData.get("accommodationDetails"), 2000) || null,
      requested_services: requestedServices,
      special_requirements: text(formData.get("specialRequirements"), 3000) || null,
      emergency_contact_name: text(formData.get("emergencyContactName"), 180) || null,
      emergency_contact_phone: text(formData.get("emergencyContactPhone"), 60) || null,
      consent_to_share: consentToShare,
      status: "submitted",
      requested_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !created) {
    go(translate("Le déplacement n’a pas pu être enregistré : ", "The trip could not be saved: ") + (error?.message ?? "unknown error"), "error", "travel");
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "travel",
    entityId: created.id,
    actorId: user.id,
    action: "travel_requested",
    newStatus: "submitted",
    details: {memberId, destinationCountry, destinationCity, arrivalDate, departureDate, requestedServices},
    admin,
  });

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Avis de déplacement transmis pour organisation.", "Travel notice submitted for organisation."), "success", "travel");
}

export async function reviewVipTravelRequestAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipLeadershipRole, hasVipTravelRole} = await getContext();
  const travelRequestId = text(formData.get("travelRequestId"), 80);
  const decision = text(formData.get("decision"), 40);
  const reviewNotes = text(formData.get("reviewNotes"), 5000) || null;

  if (!travelRequestId || !TRAVEL_REVIEW_DECISIONS.has(decision)) {
    go(translate("Décision de déplacement invalide.", "Invalid travel decision."), "error", "travel");
  }
  if (!["approved", "rejected"].includes(decision) && !VIP_OPERATIONS_ROLES.has(membership.role) && !VIP_DECISION_ROLES.has(membership.role) && !hasVipTravelRole) {
    go(translate("Tu n’as pas l’autorisation de traiter ce déplacement.", "You are not allowed to process this trip."), "error", "travel");
  }
  if (["approved", "rejected"].includes(decision) && !VIP_DECISION_ROLES.has(membership.role) && !hasVipLeadershipRole) {
    go(translate("Seuls la Direction, les Administrateurs et les Exécutifs peuvent décider.", "Only Leadership, Administrators and Executives can decide."), "error", "travel");
  }

  const {data: request} = await admin
    .from("vip_travel_requests")
    .select("id,status")
    .eq("id", travelRequestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!request) go(translate("Déplacement introuvable.", "Trip not found."), "error", "travel");

  if (decision === "approved") {
    const {error} = await admin.rpc("approve_vip_travel_request", {
      p_travel_request_id: travelRequestId,
      p_actor_id: user.id,
      p_review_notes: reviewNotes,
    });
    if (error) go(translate("L’approbation a échoué : ", "Approval failed: ") + error.message, "error", "travel");
  } else {
    const decided = decision === "rejected";
    const {error} = await admin
      .from("vip_travel_requests")
      .update({
        status: decision,
        reviewed_by: user.id,
        review_notes: reviewNotes,
        decided_at: decided ? new Date().toISOString() : null,
      })
      .eq("id", travelRequestId)
      .eq("organization_id", membership.organization_id);
    if (error) go(translate("La décision n’a pas pu être enregistrée : ", "The decision could not be saved: ") + error.message, "error", "travel");

    await audit({
      organizationId: membership.organization_id,
      entityType: "travel",
      entityId: travelRequestId,
      actorId: user.id,
      action: decision === "rejected" ? "travel_rejected" : "travel_status_changed",
      previousStatus: request.status,
      newStatus: decision,
      details: {reviewNotes},
      admin,
    });
  }

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Décision enregistrée.", "Decision saved."), "success", "travel");
}

export async function assignVipTravelRepresentativeAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipLeadershipRole} = await getContext();
  if (!VIP_DECISION_ROLES.has(membership.role) && !hasVipLeadershipRole) {
    go(translate("Tu n’as pas l’autorisation d’affecter un responsable.", "You are not allowed to assign a representative."), "error", "travel");
  }

  const travelRequestId = text(formData.get("travelRequestId"), 80);
  const representativeId = text(formData.get("representativeId"), 80);
  if (!travelRequestId || !representativeId) go(translate("Sélectionne un responsable local.", "Select a local representative."), "error", "travel");

  const [{data: request}, {data: representative}] = await Promise.all([
    admin
      .from("vip_travel_requests")
      .select("id,status,destination_country")
      .eq("id", travelRequestId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string; destination_country: string}>(),
    admin
      .from("vip_country_representatives")
      .select("id,country,user_id,is_active")
      .eq("id", representativeId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; country: string; user_id: string; is_active: boolean}>(),
  ]);

  if (!request || !representative || !representative.is_active) go(translate("Le déplacement ou le responsable est invalide.", "The trip or representative is invalid."), "error", "travel");
  if (request.destination_country.trim().toLowerCase() !== representative.country.trim().toLowerCase()) {
    go(translate("Le responsable doit appartenir au pays de destination.", "The representative must belong to the destination country."), "error", "travel");
  }

  const {error} = await admin
    .from("vip_travel_requests")
    .update({assigned_representative_id: representative.id, assigned_at: new Date().toISOString(), status: "assigned"})
    .eq("id", request.id)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("L’affectation a échoué : ", "Assignment failed: ") + error.message, "error", "travel");

  await admin
    .from("vip_travel_service_items")
    .update({assigned_to: representative.user_id, updated_by: user.id})
    .eq("travel_request_id", request.id)
    .eq("organization_id", membership.organization_id)
    .is("assigned_to", null);

  await audit({
    organizationId: membership.organization_id,
    entityType: "travel",
    entityId: request.id,
    actorId: user.id,
    action: "travel_assigned",
    previousStatus: request.status,
    newStatus: "assigned",
    details: {representativeId: representative.id, representativeUserId: representative.user_id},
    admin,
  });

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Responsable local affecté.", "Local representative assigned."), "success", "travel");
}

export async function updateVipTravelStatusAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipLeadershipRole} = await getContext();
  if (!VIP_DECISION_ROLES.has(membership.role) && !hasVipLeadershipRole) {
    go(translate("Tu n’as pas l’autorisation de modifier ce statut.", "You are not allowed to update this status."), "error", "country-welcome");
  }

  const travelRequestId = text(formData.get("travelRequestId"), 80);
  const nextStatus = text(formData.get("nextStatus"), 40);
  if (!travelRequestId || !TRAVEL_PROGRESS_STATUSES.has(nextStatus)) {
    go(translate("Statut de déplacement invalide.", "Invalid travel status."), "error", "country-welcome");
  }

  const {data: request} = await admin
    .from("vip_travel_requests")
    .select("id,status")
    .eq("id", travelRequestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!request) go(translate("Déplacement introuvable.", "Trip not found."), "error", "country-welcome");

  if (nextStatus === "completed") {
    const {count, error: serviceCountError} = await admin
      .from("vip_travel_service_items")
      .select("id", {head: true, count: "exact"})
      .eq("travel_request_id", request.id)
      .eq("organization_id", membership.organization_id)
      .not("status", "in", "(completed,cancelled)");
    if (serviceCountError) go(translate("Impossible de vérifier les services : ", "Unable to verify services: ") + serviceCountError.message, "error", "country-welcome");
    if ((count ?? 0) > 0) go(translate("Termine ou annule tous les services avant de clôturer l’accueil.", "Complete or cancel every service before closing the welcome."), "error", "country-welcome");
  }

  const {error} = await admin
    .from("vip_travel_requests")
    .update({status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null})
    .eq("id", request.id)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Le statut n’a pas pu être modifié : ", "The status could not be updated: ") + error.message, "error", "country-welcome");

  if (nextStatus === "cancelled") {
    await admin
      .from("vip_travel_service_items")
      .update({status: "cancelled", updated_by: user.id})
      .eq("travel_request_id", request.id)
      .eq("organization_id", membership.organization_id)
      .not("status", "in", "(completed,cancelled)");
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "travel",
    entityId: request.id,
    actorId: user.id,
    action: nextStatus === "completed" ? "travel_completed" : "travel_status_changed",
    previousStatus: request.status,
    newStatus: nextStatus,
    admin,
  });

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Statut du déplacement mis à jour.", "Trip status updated."), "success", "country-welcome");
}

export async function createVipCountryRepresentativeAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_SETTINGS_ROLES.has(membership.role)) {
    go(translate("Seuls les propriétaires et administrateurs peuvent nommer les responsables pays.", "Only owners and administrators can appoint country representatives."), "error", "country-welcome");
  }

  const country = text(formData.get("country"), 120);
  const city = text(formData.get("city"), 120) || null;
  const userId = text(formData.get("userId"), 80);
  const roleTitle = text(formData.get("roleTitle"), 180) || null;
  const isPrimary = formData.get("isPrimary") === "yes";
  if (country.length < 2 || !userId) go(translate("Sélectionne un pays et un collaborateur.", "Select a country and an employee."), "error", "country-welcome");

  const {data: internalMember} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  if (!internalMember) go(translate("Le collaborateur sélectionné n’est pas actif dans l’organisation.", "The selected employee is not active in the organisation."), "error", "country-welcome");

  if (isPrimary) {
    await admin
      .from("vip_country_representatives")
      .update({is_primary: false, updated_by: user.id})
      .eq("organization_id", membership.organization_id)
      .ilike("country", country)
      .eq("is_primary", true);
  }

  const {data: created, error} = await admin
    .from("vip_country_representatives")
    .insert({
      organization_id: membership.organization_id,
      country,
      city,
      user_id: userId,
      role_title: roleTitle,
      is_primary: isPrimary,
      is_active: true,
      notes: text(formData.get("notes"), 2000) || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  if (error || !created) go(translate("Le responsable pays n’a pas pu être enregistré : ", "The country representative could not be saved: ") + (error?.message ?? "unknown error"), "error", "country-welcome");

  await audit({
    organizationId: membership.organization_id,
    entityType: "country_representative",
    entityId: created.id,
    actorId: user.id,
    action: "country_representative_created",
    newStatus: "active",
    details: {country, city, userId, roleTitle, isPrimary},
    admin,
  });

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Responsable pays enregistré.", "Country representative saved."), "success", "country-welcome");
}

export async function updateVipCountryRepresentativeAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_SETTINGS_ROLES.has(membership.role)) {
    go(translate("Action réservée aux propriétaires et administrateurs.", "Action reserved for owners and administrators."), "error", "country-welcome");
  }

  const representativeId = text(formData.get("representativeId"), 80);
  const nextActive = text(formData.get("nextActive"), 10) === "true";
  const {data: representative} = await admin
    .from("vip_country_representatives")
    .select("id,is_active")
    .eq("id", representativeId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; is_active: boolean}>();
  if (!representative) go(translate("Responsable pays introuvable.", "Country representative not found."), "error", "country-welcome");

  const {error} = await admin
    .from("vip_country_representatives")
    .update({is_active: nextActive, updated_by: user.id})
    .eq("id", representative.id)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Le statut n’a pas pu être modifié : ", "The status could not be updated: ") + error.message, "error", "country-welcome");

  await audit({
    organizationId: membership.organization_id,
    entityType: "country_representative",
    entityId: representative.id,
    actorId: user.id,
    action: "country_representative_updated",
    previousStatus: representative.is_active ? "active" : "inactive",
    newStatus: nextActive ? "active" : "inactive",
    admin,
  });

  revalidatePath("/dashboard/vip/travel");
  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Statut du responsable pays mis à jour.", "Country representative status updated."), "success", "country-welcome");
}

export async function updateVipTravelServiceAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipTravelRole} = await getContext();
  if (!VIP_OPERATIONS_ROLES.has(membership.role) && !VIP_DECISION_ROLES.has(membership.role) && !hasVipTravelRole) {
    go(translate("Tu n’as pas l’autorisation de modifier ce service.", "You are not allowed to update this service."), "error", "country-welcome");
  }

  const serviceId = text(formData.get("serviceId"), 80);
  const nextStatus = text(formData.get("status"), 40);
  const scheduledAt = dateTimeValue(formData.get("scheduledAt"));
  if (!serviceId || !SERVICE_STATUSES.has(nextStatus) || scheduledAt === "") {
    go(translate("Informations de service invalides.", "Invalid service information."), "error", "country-welcome");
  }

  const {data: service} = await admin
    .from("vip_travel_service_items")
    .select("id,status,travel_request_id")
    .eq("id", serviceId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; travel_request_id: string}>();
  if (!service) go(translate("Service d’accueil introuvable.", "Welcome service not found."), "error", "country-welcome");

  const {error} = await admin
    .from("vip_travel_service_items")
    .update({
      status: nextStatus,
      provider_name: text(formData.get("providerName"), 180) || null,
      provider_contact: text(formData.get("providerContact"), 180) || null,
      scheduled_at: scheduledAt,
      notes: text(formData.get("notes"), 3000) || null,
      completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
      updated_by: user.id,
    })
    .eq("id", service.id)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Le service n’a pas pu être mis à jour : ", "The service could not be updated: ") + error.message, "error", "country-welcome");

  await audit({
    organizationId: membership.organization_id,
    entityType: "travel_service",
    entityId: service.id,
    actorId: user.id,
    action: nextStatus === "completed" ? "travel_service_completed" : "travel_service_updated",
    previousStatus: service.status,
    newStatus: nextStatus,
    details: {travelRequestId: service.travel_request_id},
    admin,
  });

  revalidatePath("/dashboard/vip/country-welcome");
  go(translate("Service d’accueil mis à jour.", "Welcome service updated."), "success", "country-welcome");
}
