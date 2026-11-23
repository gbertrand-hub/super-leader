import type {ReactNode} from "react";
import Link from "next/link";
import {CountrySelect} from "@/components/forms/country-select";
import {redirect} from "next/navigation";
import {
  assignVipTravelRepresentativeAction,
  createVipTravelRequestAction,
  reviewVipTravelRequestAction,
} from "@/app/actions/vip-travel";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings} from "@/lib/vip/settings";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_OPERATIONS_ROLES = ["owner", "admin", "hr"];
const VIP_DECISION_ROLES = ["owner", "admin", "executive"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type VipMember = {id: string; member_number: string; full_name: string; status: string; country: string | null};
type Profile = {id: string; full_name: string | null; email: string | null};
type CountryRepresentative = {id: string; country: string; city: string | null; user_id: string; role_title: string | null; is_primary: boolean; is_active: boolean};
type TravelRequest = {
  id: string;
  member_id: string;
  destination_country: string;
  destination_city: string;
  arrival_date: string;
  departure_date: string;
  purpose: string;
  arrival_details: string | null;
  accommodation_details: string | null;
  requested_services: string[];
  special_requirements: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  consent_to_share: boolean;
  status: string;
  requested_by: string;
  requested_at: string;
  assigned_representative_id: string | null;
  review_notes: string | null;
};

type ServiceItem = {id: string; travel_request_id: string; service_type: string; status: string};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return <label className="mt-4 block font-bold text-slate-800">{label}{children}</label>;
}

function Badge({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function tone(status: string): "slate" | "blue" | "green" | "amber" | "red" | "violet" {
  if (["approved", "assigned", "completed"].includes(status)) return "green";
  if (["submitted", "under_review", "in_progress"].includes(status)) return "amber";
  if (status === "needs_information") return "blue";
  if (["rejected", "cancelled"].includes(status)) return "red";
  return "slate";
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

export default async function VipTravelPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const params = await searchParams;
  const success = first(params.success);
  const errorMessage = first(params.error);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  const {data: governanceSettings} = await admin.from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_events_travel_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_events_travel_assistant_user_id: string | null}>();
  const hasVipLeadershipRole = governanceSettings?.vip_manager_user_id === authData.user.id || governanceSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipEventsTravelAssistant = governanceSettings?.vip_events_travel_assistant_user_id === authData.user.id;
  const hasVipTravelRole = hasVipLeadershipRole || isVipEventsTravelAssistant;
  if (!VIP_ROLES.includes(membership.role) && !hasVipTravelRole) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_travel_requests").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const [membersResult, representativesResult, travelResult, profilesResult, servicesResult] = await Promise.all([
    admin
      .from("vip_members")
      .select("id,member_number,full_name,status,country")
      .eq("organization_id", membership.organization_id)
      .order("full_name"),
    admin
      .from("vip_country_representatives")
      .select("id,country,city,user_id,role_title,is_primary,is_active")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("country"),
    admin
      .from("vip_travel_requests")
      .select("id,member_id,destination_country,destination_city,arrival_date,departure_date,purpose,arrival_details,accommodation_details,requested_services,special_requirements,emergency_contact_name,emergency_contact_phone,consent_to_share,status,requested_by,requested_at,assigned_representative_id,review_notes")
      .eq("organization_id", membership.organization_id)
      .order("arrival_date", {ascending: true})
      .limit(500),
    admin.from("profiles").select("id,full_name,email"),
    admin
      .from("vip_travel_service_items")
      .select("id,travel_request_id,service_type,status")
      .eq("organization_id", membership.organization_id)
      .limit(2000),
  ]);

  for (const result of [membersResult, representativesResult, travelResult, profilesResult, servicesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const programSettings = await getVipProgramSettings(admin, membership.organization_id);
  const enabledServiceEntries = Object.entries(c.services).filter(([value]) => programSettings.enabled_travel_services.includes(value));
  const minimumArrival = new Date();
  minimumArrival.setUTCHours(0, 0, 0, 0);
  minimumArrival.setUTCDate(minimumArrival.getUTCDate() + programSettings.travel_min_notice_days);
  const minimumArrivalValue = minimumArrival.toISOString().slice(0, 10);

  const members = (membersResult.data ?? []) as VipMember[];
  const representatives = (representativesResult.data ?? []) as CountryRepresentative[];
  const trips = (travelResult.data ?? []) as TravelRequest[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const services = (servicesResult.data ?? []) as ServiceItem[];
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const representativeMap = new Map(representatives.map((representative) => [representative.id, representative]));
  const servicesByTrip = new Map<string, ServiceItem[]>();
  for (const service of services) servicesByTrip.set(service.travel_request_id, [...(servicesByTrip.get(service.travel_request_id) ?? []), service]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = trips.filter((trip) => trip.departure_date >= today && !["rejected", "cancelled", "completed"].includes(trip.status));
  const pending = trips.filter((trip) => ["submitted", "under_review", "needs_information"].includes(trip.status));
  const withoutRepresentative = trips.filter((trip) => ["approved"].includes(trip.status) && !trip.assigned_representative_id);
  const canCreate = VIP_OPERATIONS_ROLES.includes(membership.role) || hasVipTravelRole;
  const canDecide = VIP_DECISION_ROLES.includes(membership.role) || hasVipLeadershipRole;
  const personName = (id: string | null) => id ? (profileMap.get(id)?.full_name || profileMap.get(id)?.email || c.unknown) : c.unknown;
  const statusLabel = (status: string) => c.statuses[status as keyof typeof c.statuses] ?? status;
  const serviceLabel = (service: string) => c.services[service as keyof typeof c.services] ?? service;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 p-7 text-white shadow-2xl sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">Super Leader VIP · V3.2.8</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight">{c.title}</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p>
            </div>
            <Link href="/dashboard/vip/country-welcome" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">{c.openWelcome}</Link>
          </div>
        </header>

        <VipNav fr={fr} active="travel" />
        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Metric label={c.upcomingTrips} value={upcoming.length} />
          <Metric label={c.pendingReview} value={pending.length} />
          <Metric label={c.awaitingAssignment} value={withoutRepresentative.length} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          {canCreate ? (
            <form action={createVipTravelRequestAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.newTrip}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{c.newTripHelp}</p>
              <Field label={c.vipMember}>
                <select name="memberId" required defaultValue="" className={inputClass}>
                  <option value="">{c.selectMember}</option>
                  {members.filter((member) => !["suspended", "withdrawn", "expired"].includes(member.status)).map((member) => (
                    <option key={member.id} value={member.id}>{member.full_name} · {member.member_number}</option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={c.destinationCountry}><CountrySelect name="destinationCountry" locale={fr ? "fr" : "en"} required className={inputClass} /></Field>
                <Field label={c.destinationCity}><input name="destinationCity" required maxLength={120} className={inputClass} /></Field>
                <Field label={c.arrivalDate}><input name="arrivalDate" type="date" min={minimumArrivalValue} required className={inputClass} /><span className="mt-1 block text-xs text-slate-500">{fr ? `Préavis minimal : ${programSettings.travel_min_notice_days} jour(s).` : `Minimum notice: ${programSettings.travel_min_notice_days} day(s).`}</span></Field>
                <Field label={c.departureDate}><input name="departureDate" type="date" required className={inputClass} /></Field>
              </div>
              <Field label={c.purpose}><textarea name="purpose" required minLength={5} maxLength={2000} rows={4} className={inputClass} /></Field>
              <Field label={c.arrivalDetails}><textarea name="arrivalDetails" maxLength={2000} rows={3} className={inputClass} /></Field>
              <Field label={c.accommodation}><textarea name="accommodationDetails" maxLength={2000} rows={3} className={inputClass} /></Field>
              <fieldset className="mt-5 rounded-2xl border border-slate-200 p-4">
                <legend className="px-2 font-black">{c.requestedServices}</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {enabledServiceEntries.map(([value, label]) => (
                    <label key={value} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold">
                      <input type="checkbox" name="requestedServices" value={value} className="mt-1" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label={c.specialRequirements}><textarea name="specialRequirements" maxLength={3000} rows={3} className={inputClass} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={c.emergencyName}><input name="emergencyContactName" maxLength={180} className={inputClass} /></Field>
                <Field label={c.emergencyPhone}><input name="emergencyContactPhone" maxLength={60} className={inputClass} /></Field>
              </div>
              <label className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-950">
                <input type="checkbox" name="consentToShare" value="yes" required={programSettings.require_travel_consent} className="mt-1" />
                <span>{c.consent}{programSettings.require_travel_consent ? " *" : ""}</span>
              </label>
              <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800">{c.submitTrip}</button>
            </form>
          ) : (
            <article className="rounded-3xl border border-blue-200 bg-blue-50 p-6 text-blue-950"><h2 className="text-xl font-black">{c.readOnly}</h2><p className="mt-2 leading-7">{c.readOnlyHelp}</p></article>
          )}

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-2xl font-black">{c.travelRegister}</h2><p className="mt-1 text-sm text-slate-500">{trips.length} {c.records}</p></div>
              <Badge tone="amber">{pending.length} {c.pending.toLowerCase()}</Badge>
            </div>
            <div className="mt-5 space-y-5">
              {trips.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noTrips}</p> : trips.map((trip) => {
                const member = memberMap.get(trip.member_id);
                const representative = trip.assigned_representative_id ? representativeMap.get(trip.assigned_representative_id) : null;
                const tripServices = servicesByTrip.get(trip.id) ?? [];
                const matchingRepresentatives = representatives.filter((item) => item.country.trim().toLowerCase() === trip.destination_country.trim().toLowerCase());
                return (
                  <article key={trip.id} className="rounded-3xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black">{member?.full_name ?? c.unknown}</h3>
                        <p className="mt-1 font-bold text-rose-800">{trip.destination_city}, {trip.destination_country}</p>
                        <p className="mt-1 text-sm text-slate-500">{new Date(`${trip.arrival_date}T00:00:00Z`).toLocaleDateString(dateLocale)} → {new Date(`${trip.departure_date}T00:00:00Z`).toLocaleDateString(dateLocale)}</p>
                      </div>
                      <Badge tone={tone(trip.status)}>{statusLabel(trip.status)}</Badge>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6">{trip.purpose}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {trip.requested_services.length === 0 ? <span className="text-sm text-slate-500">{c.noServicesRequested}</span> : trip.requested_services.map((service) => <Badge key={service} tone="violet">{serviceLabel(service)}</Badge>)}
                    </div>
                    {trip.arrival_details ? <p className="mt-4 text-sm"><strong>{c.arrivalDetails}:</strong> {trip.arrival_details}</p> : null}
                    {trip.special_requirements ? <p className="mt-2 text-sm"><strong>{c.specialRequirements}:</strong> {trip.special_requirements}</p> : null}
                    <div className="mt-4 rounded-2xl border border-slate-200 p-4 text-sm">
                      <p><strong>{c.requestedBy}:</strong> {personName(trip.requested_by)}</p>
                      <p className="mt-1"><strong>{c.localRepresentative}:</strong> {representative ? `${personName(representative.user_id)} · ${representative.city || representative.country}` : c.notAssigned}</p>
                      {tripServices.length > 0 ? <p className="mt-1"><strong>{c.operationalServices}:</strong> {tripServices.filter((service) => service.status === "completed").length}/{tripServices.length} {c.completed.toLowerCase()}</p> : null}
                    </div>
                    {trip.review_notes ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><strong>{c.reviewNote}:</strong> {trip.review_notes}</p> : null}

                    {["submitted", "under_review", "needs_information"].includes(trip.status) ? (
                      <form action={reviewVipTravelRequestAction} className="mt-5">
                        <input type="hidden" name="travelRequestId" value={trip.id} />
                        <label className="block font-bold">{c.reviewNote}<textarea name="reviewNotes" defaultValue={trip.review_notes ?? ""} maxLength={5000} rows={3} className={inputClass} /></label>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button type="submit" name="decision" value="under_review" className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">{c.startReview}</button>
                          <button type="submit" name="decision" value="needs_information" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">{c.requestInfo}</button>
                          {canDecide ? <button type="submit" name="decision" value="approved" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">{c.approve}</button> : null}
                          {canDecide ? <button type="submit" name="decision" value="rejected" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white">{c.reject}</button> : null}
                        </div>
                      </form>
                    ) : null}

                    {canDecide && ["approved", "assigned"].includes(trip.status) ? (
                      <form action={assignVipTravelRepresentativeAction} className="mt-5 flex flex-col gap-3 rounded-2xl bg-emerald-50 p-4 sm:flex-row sm:items-end">
                        <input type="hidden" name="travelRequestId" value={trip.id} />
                        <label className="flex-1 font-bold text-emerald-950">{c.assignRepresentative}
                          <select name="representativeId" required defaultValue={trip.assigned_representative_id ?? ""} className={inputClass}>
                            <option value="">{c.selectRepresentative}</option>
                            {matchingRepresentatives.map((item) => <option key={item.id} value={item.id}>{personName(item.user_id)} · {item.city || item.country}{item.is_primary ? ` · ${c.primary}` : ""}</option>)}
                          </select>
                        </label>
                        <button type="submit" className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{c.assign}</button>
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function VipNav({fr, active}: {fr: boolean; active: "travel" | "welcome"}) {
  const items = fr ? [
    ["Vue VIP", "/dashboard/vip"], ["Membres", "/dashboard/vip?view=members"], ["Cartes", "/dashboard/vip?view=cards"], ["Déplacements", "/dashboard/vip/travel"], ["Accueil par pays", "/dashboard/vip/country-welcome"], ["Rencontre annuelle", "/dashboard/vip/annual-meeting"], ["Avantages", "/dashboard/vip/benefits"],
  ] : [
    ["VIP overview", "/dashboard/vip"], ["Members", "/dashboard/vip?view=members"], ["Cards", "/dashboard/vip?view=cards"], ["Travel", "/dashboard/vip/travel"], ["Country welcome", "/dashboard/vip/country-welcome"], ["Annual gathering", "/dashboard/vip/annual-meeting"], ["Benefits", "/dashboard/vip/benefits"],
  ];
  return <nav className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">{items.map(([label, href]) => {
    const selected = active === "travel" ? href.endsWith("/travel") : href.endsWith("country-welcome");
    return <Link key={href} href={href} className={`shrink-0 rounded-xl px-4 py-3 text-sm font-black ${selected ? "bg-rose-700 text-white" : "text-slate-600 hover:bg-rose-50"}`}>{label}</Link>;
  })}</nav>;
}

function Metric({label, value}: {label: string; value: number}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-4xl font-black">{value}</p><div className="mt-4 h-1.5 rounded-full bg-rose-200" /></article>;
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-3xl font-black text-amber-950">{fr ? "Migration Supabase requise" : "Supabase migration required"}</h1><p className="mt-3 leading-7 text-amber-900">{fr ? "Exécute la migration V3.2.4 pour activer les déplacements internationaux et l’accueil par pays." : "Run the V3.2.4 migration to activate international travel and country welcome."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/044_super_leader_vip_travel_welcome_v3_2_4.sql</code></div></main>;
}

const copy = {
  fr: {
    title: "Déplacements internationaux VIP",
    subtitle: "Prépare chaque déplacement, informe l’équipe locale et transforme les privilèges VIP en services concrets, coordonnés et traçables.",
    openWelcome: "Ouvrir le centre d’accueil",
    upcomingTrips: "Déplacements à venir",
    pendingReview: "En attente d’examen",
    awaitingAssignment: "Sans responsable local",
    newTrip: "Nouvel avis de déplacement",
    newTripHelp: "Enregistre le voyage suffisamment tôt pour permettre à l’équipe locale de préparer un accueil approprié.",
    vipMember: "Membre VIP",
    selectMember: "Sélectionner un membre",
    destinationCountry: "Pays de destination",
    destinationCity: "Ville de destination",
    arrivalDate: "Date d’arrivée",
    departureDate: "Date de départ",
    purpose: "Motif du déplacement",
    arrivalDetails: "Vol, train, heure et lieu d’arrivée",
    accommodation: "Hébergement prévu ou besoins d’orientation",
    requestedServices: "Services VIP souhaités",
    specialRequirements: "Besoins particuliers",
    emergencyName: "Contact d’urgence",
    emergencyPhone: "Téléphone d’urgence",
    consent: "Le membre autorise le partage de ces informations avec les responsables iLEAD du pays de destination, uniquement pour organiser son accueil.",
    submitTrip: "Transmettre l’avis de déplacement",
    readOnly: "Consultation des déplacements",
    readOnlyHelp: "La création est réservée aux Administrateurs et RH. Tu peux examiner et décider selon ton rôle.",
    travelRegister: "Registre des déplacements",
    records: "dossier(s)",
    pending: "En attente",
    noTrips: "Aucun déplacement VIP n’a encore été enregistré.",
    noServicesRequested: "Aucun service particulier demandé.",
    requestedBy: "Enregistré par",
    localRepresentative: "Responsable local",
    notAssigned: "Non affecté",
    operationalServices: "Services opérationnels",
    completed: "Terminés",
    reviewNote: "Note de traitement",
    startReview: "Mettre en étude",
    requestInfo: "Demander des informations",
    approve: "Approuver et préparer l’accueil",
    reject: "Refuser",
    assignRepresentative: "Affecter le responsable local",
    selectRepresentative: "Sélectionner un responsable du pays",
    primary: "Principal",
    assign: "Affecter",
    unknown: "Utilisateur",
    statuses: {draft: "Brouillon", submitted: "Soumis", under_review: "En étude", needs_information: "Informations requises", approved: "Approuvé", assigned: "Affecté", in_progress: "Accueil en cours", completed: "Terminé", rejected: "Refusé", cancelled: "Annulé"},
    services: {airport_welcome: "Accueil à l’aéroport ou à la gare", local_transport: "Transport local", accommodation_guidance: "Assistance hébergement", office_visit: "Visite d’un bureau iLEAD", leadership_meeting: "Rencontre avec les responsables", event_invitation: "Invitation à une activité", local_assistance: "Assistance locale", other: "Autre service"},
  },
  en: {
    title: "VIP international travel",
    subtitle: "Prepare every trip, inform the local team and turn VIP privileges into concrete, coordinated and traceable services.",
    openWelcome: "Open welcome centre",
    upcomingTrips: "Upcoming trips",
    pendingReview: "Pending review",
    awaitingAssignment: "Without local representative",
    newTrip: "New travel notice",
    newTripHelp: "Record the trip early enough for the local team to prepare the appropriate welcome.",
    vipMember: "VIP member",
    selectMember: "Select a member",
    destinationCountry: "Destination country",
    destinationCity: "Destination city",
    arrivalDate: "Arrival date",
    departureDate: "Departure date",
    purpose: "Purpose of travel",
    arrivalDetails: "Flight, train, arrival time and location",
    accommodation: "Planned accommodation or guidance needs",
    requestedServices: "Requested VIP services",
    specialRequirements: "Special requirements",
    emergencyName: "Emergency contact",
    emergencyPhone: "Emergency phone",
    consent: "The member authorises sharing this information with iLEAD representatives in the destination country solely to organise the welcome.",
    submitTrip: "Submit travel notice",
    readOnly: "Travel consultation",
    readOnlyHelp: "Creation is reserved for Administrators and HR. You may review and decide according to your role.",
    travelRegister: "Travel register",
    records: "record(s)",
    pending: "Pending",
    noTrips: "No VIP travel has been recorded yet.",
    noServicesRequested: "No specific service requested.",
    requestedBy: "Recorded by",
    localRepresentative: "Local representative",
    notAssigned: "Not assigned",
    operationalServices: "Operational services",
    completed: "Completed",
    reviewNote: "Processing note",
    startReview: "Start review",
    requestInfo: "Request information",
    approve: "Approve and prepare welcome",
    reject: "Reject",
    assignRepresentative: "Assign local representative",
    selectRepresentative: "Select a country representative",
    primary: "Primary",
    assign: "Assign",
    unknown: "User",
    statuses: {draft: "Draft", submitted: "Submitted", under_review: "Under review", needs_information: "Information required", approved: "Approved", assigned: "Assigned", in_progress: "Welcome in progress", completed: "Completed", rejected: "Rejected", cancelled: "Cancelled"},
    services: {airport_welcome: "Airport or station welcome", local_transport: "Local transport", accommodation_guidance: "Accommodation assistance", office_visit: "iLEAD office visit", leadership_meeting: "Leadership meeting", event_invitation: "Event invitation", local_assistance: "Local assistance", other: "Other service"},
  },
} as const;
