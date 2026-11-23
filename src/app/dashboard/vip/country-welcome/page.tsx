import type {ReactNode} from "react";
import Link from "next/link";
import {CountrySelect} from "@/components/forms/country-select";
import {redirect} from "next/navigation";
import {
  createVipCountryRepresentativeAction,
  updateVipCountryRepresentativeAction,
  updateVipTravelServiceAction,
  updateVipTravelStatusAction,
} from "@/app/actions/vip-travel";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_SETTINGS_ROLES = ["owner", "admin"];
const VIP_DECISION_ROLES = ["owner", "admin", "executive"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Profile = {id: string; full_name: string | null; email: string | null};
type InternalMember = {user_id: string; role: string};
type VipMember = {id: string; full_name: string; member_number: string};
type CountryRepresentative = {
  id: string;
  country: string;
  city: string | null;
  user_id: string;
  role_title: string | null;
  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
};
type TravelRequest = {
  id: string;
  member_id: string;
  destination_country: string;
  destination_city: string;
  arrival_date: string;
  departure_date: string;
  status: string;
  assigned_representative_id: string | null;
  special_requirements: string | null;
  arrival_details: string | null;
};
type ServiceItem = {
  id: string;
  travel_request_id: string;
  service_type: string;
  status: string;
  assigned_to: string | null;
  provider_name: string | null;
  provider_contact: string | null;
  scheduled_at: string | null;
  notes: string | null;
};

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
  if (["approved", "assigned", "confirmed", "completed", "active"].includes(status)) return "green";
  if (["planned", "in_progress"].includes(status)) return "amber";
  if (status === "cancelled" || status === "inactive") return "red";
  return "slate";
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

export default async function VipCountryWelcomePage({searchParams}: {searchParams: SearchParams}) {
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
  if (!VIP_ROLES.includes(membership.role)) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_country_representatives").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const [profilesResult, internalMembersResult, membersResult, representativesResult, travelResult, servicesResult] = await Promise.all([
    admin.from("profiles").select("id,full_name,email"),
    admin
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
    admin
      .from("vip_members")
      .select("id,full_name,member_number")
      .eq("organization_id", membership.organization_id),
    admin
      .from("vip_country_representatives")
      .select("id,country,city,user_id,role_title,is_primary,is_active,notes")
      .eq("organization_id", membership.organization_id)
      .order("country")
      .order("is_primary", {ascending: false}),
    admin
      .from("vip_travel_requests")
      .select("id,member_id,destination_country,destination_city,arrival_date,departure_date,status,assigned_representative_id,special_requirements,arrival_details")
      .eq("organization_id", membership.organization_id)
      .in("status", ["approved", "assigned", "in_progress", "completed"])
      .order("arrival_date", {ascending: true})
      .limit(500),
    admin
      .from("vip_travel_service_items")
      .select("id,travel_request_id,service_type,status,assigned_to,provider_name,provider_contact,scheduled_at,notes")
      .eq("organization_id", membership.organization_id)
      .order("created_at")
      .limit(2000),
  ]);

  for (const result of [profilesResult, internalMembersResult, membersResult, representativesResult, travelResult, servicesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const profiles = (profilesResult.data ?? []) as Profile[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const internalMembers = ((internalMembersResult.data ?? []) as InternalMember[])
    .map((item) => ({...item, profile: profileMap.get(item.user_id)}))
    .sort((a, b) => (a.profile?.full_name ?? a.profile?.email ?? "").localeCompare(b.profile?.full_name ?? b.profile?.email ?? ""));
  const members = (membersResult.data ?? []) as VipMember[];
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const representatives = (representativesResult.data ?? []) as CountryRepresentative[];
  const representativeMap = new Map(representatives.map((representative) => [representative.id, representative]));
  const trips = (travelResult.data ?? []) as TravelRequest[];
  const services = (servicesResult.data ?? []) as ServiceItem[];
  const servicesByTrip = new Map<string, ServiceItem[]>();
  for (const service of services) servicesByTrip.set(service.travel_request_id, [...(servicesByTrip.get(service.travel_request_id) ?? []), service]);

  const activeRepresentatives = representatives.filter((item) => item.is_active);
  const openTrips = trips.filter((trip) => ["approved", "assigned", "in_progress"].includes(trip.status));
  const openServices = services.filter((service) => !["completed", "cancelled"].includes(service.status));
  const completedServices = services.filter((service) => service.status === "completed");
  const canManageRepresentatives = VIP_SETTINGS_ROLES.includes(membership.role);
  const canUpdateTrips = VIP_DECISION_ROLES.includes(membership.role);
  const personName = (id: string | null) => id ? (profileMap.get(id)?.full_name || profileMap.get(id)?.email || c.unknown) : c.unknown;
  const statusLabel = (status: string) => c.statuses[status as keyof typeof c.statuses] ?? status;
  const serviceLabel = (service: string) => c.services[service as keyof typeof c.services] ?? service;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 p-7 text-white shadow-2xl sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Super Leader VIP · V3.2.8</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight">{c.title}</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p>
            </div>
            <Link href="/dashboard/vip/travel" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">{c.openTravel}</Link>
          </div>
        </header>

        <VipNav fr={fr} active="welcome" />
        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          <Metric label={c.activeRepresentatives} value={activeRepresentatives.length} />
          <Metric label={c.openTrips} value={openTrips.length} />
          <Metric label={c.openServices} value={openServices.length} />
          <Metric label={c.completedServices} value={completedServices.length} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-6">
            {canManageRepresentatives ? (
              <form action={createVipCountryRepresentativeAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.addRepresentative}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.addRepresentativeHelp}</p>
                <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} required className={inputClass} /></Field>
                <Field label={c.city}><input name="city" maxLength={120} className={inputClass} /></Field>
                <Field label={c.internalPerson}>
                  <select name="userId" required defaultValue="" className={inputClass}>
                    <option value="">{c.selectPerson}</option>
                    {internalMembers.map((item) => <option key={item.user_id} value={item.user_id}>{item.profile?.full_name || item.profile?.email || c.unknown} · {item.role}</option>)}
                  </select>
                </Field>
                <Field label={c.roleTitle}><input name="roleTitle" maxLength={180} className={inputClass} /></Field>
                <Field label={c.notes}><textarea name="notes" maxLength={2000} rows={3} className={inputClass} /></Field>
                <label className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-950"><input type="checkbox" name="isPrimary" value="yes" />{c.primaryRepresentative}</label>
                <button type="submit" className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{c.saveRepresentative}</button>
              </form>
            ) : null}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.countryDirectory}</h2>
              <p className="mt-2 text-sm text-slate-600">{c.countryDirectoryHelp}</p>
              <div className="mt-5 space-y-4">
                {representatives.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">{c.noRepresentatives}</p> : representatives.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><p className="font-black">{personName(item.user_id)}</p><p className="mt-1 text-sm font-bold text-emerald-800">{item.city ? `${item.city}, ` : ""}{item.country}</p><p className="mt-1 text-sm text-slate-500">{item.role_title || c.localRepresentative}</p></div>
                      <div className="flex gap-2"><Badge tone={item.is_active ? "green" : "red"}>{item.is_active ? c.active : c.inactive}</Badge>{item.is_primary ? <Badge tone="violet">{c.primary}</Badge> : null}</div>
                    </div>
                    {item.notes ? <p className="mt-3 text-sm leading-6 text-slate-600">{item.notes}</p> : null}
                    {canManageRepresentatives ? (
                      <form action={updateVipCountryRepresentativeAction} className="mt-4">
                        <input type="hidden" name="representativeId" value={item.id} />
                        <input type="hidden" name="nextActive" value={item.is_active ? "false" : "true"} />
                        <button type="submit" className={`rounded-xl px-4 py-2 text-sm font-black ${item.is_active ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{item.is_active ? c.deactivate : c.activate}</button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{c.operationsBoard}</h2><p className="mt-1 text-sm text-slate-500">{c.operationsBoardHelp}</p></div><Badge tone="amber">{openTrips.length} {c.open.toLowerCase()}</Badge></div>
            <div className="mt-5 space-y-6">
              {trips.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noWelcomeCases}</p> : trips.map((trip) => {
                const member = memberMap.get(trip.member_id);
                const representative = trip.assigned_representative_id ? representativeMap.get(trip.assigned_representative_id) : null;
                const tripServices = servicesByTrip.get(trip.id) ?? [];
                return (
                  <article key={trip.id} className="rounded-3xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="text-xl font-black">{member?.full_name ?? c.unknown}</h3><p className="mt-1 font-bold text-emerald-800">{trip.destination_city}, {trip.destination_country}</p><p className="mt-1 text-sm text-slate-500">{new Date(`${trip.arrival_date}T00:00:00Z`).toLocaleDateString(dateLocale)} → {new Date(`${trip.departure_date}T00:00:00Z`).toLocaleDateString(dateLocale)}</p></div>
                      <Badge tone={tone(trip.status)}>{statusLabel(trip.status)}</Badge>
                    </div>
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm"><p><strong>{c.localRepresentative}:</strong> {representative ? personName(representative.user_id) : c.notAssigned}</p>{trip.arrival_details ? <p className="mt-2"><strong>{c.arrivalDetails}:</strong> {trip.arrival_details}</p> : null}{trip.special_requirements ? <p className="mt-2"><strong>{c.specialRequirements}:</strong> {trip.special_requirements}</p> : null}</div>

                    <div className="mt-5 space-y-4">
                      {tripServices.length === 0 ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.noServices}</p> : tripServices.map((service) => (
                        <form key={service.id} action={updateVipTravelServiceAction} className="rounded-2xl border border-slate-200 p-4">
                          <input type="hidden" name="serviceId" value={service.id} />
                          <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-black">{serviceLabel(service.service_type)}</h4><Badge tone={tone(service.status)}>{statusLabel(service.status)}</Badge></div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="font-bold">{c.serviceStatus}<select name="status" defaultValue={service.status} className={inputClass}><option value="planned">{c.statuses.planned}</option><option value="confirmed">{c.statuses.confirmed}</option><option value="in_progress">{c.statuses.in_progress}</option><option value="completed">{c.statuses.completed}</option><option value="cancelled">{c.statuses.cancelled}</option></select></label>
                            <label className="font-bold">{c.scheduledAt}<input name="scheduledAt" type="datetime-local" defaultValue={service.scheduled_at ? service.scheduled_at.slice(0, 16) : ""} className={inputClass} /></label>
                            <label className="font-bold">{c.providerName}<input name="providerName" defaultValue={service.provider_name ?? ""} maxLength={180} className={inputClass} /></label>
                            <label className="font-bold">{c.providerContact}<input name="providerContact" defaultValue={service.provider_contact ?? ""} maxLength={180} className={inputClass} /></label>
                          </div>
                          <label className="mt-3 block font-bold">{c.serviceNotes}<textarea name="notes" defaultValue={service.notes ?? ""} maxLength={3000} rows={2} className={inputClass} /></label>
                          <button type="submit" className="mt-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{c.updateService}</button>
                        </form>
                      ))}
                    </div>

                    {canUpdateTrips && ["assigned", "approved", "in_progress"].includes(trip.status) ? (
                      <form action={updateVipTravelStatusAction} className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
                        <input type="hidden" name="travelRequestId" value={trip.id} />
                        {trip.status !== "in_progress" ? <button type="submit" name="nextStatus" value="in_progress" className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">{c.startWelcome}</button> : null}
                        <button type="submit" name="nextStatus" value="completed" className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">{c.completeWelcome}</button>
                        <button type="submit" name="nextStatus" value="cancelled" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-800">{c.cancelWelcome}</button>
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
    return <Link key={href} href={href} className={`shrink-0 rounded-xl px-4 py-3 text-sm font-black ${selected ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-emerald-50"}`}>{label}</Link>;
  })}</nav>;
}

function Metric({label, value}: {label: string; value: number}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-4xl font-black">{value}</p><div className="mt-4 h-1.5 rounded-full bg-emerald-200" /></article>;
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-3xl font-black text-amber-950">{fr ? "Migration Supabase requise" : "Supabase migration required"}</h1><p className="mt-3 leading-7 text-amber-900">{fr ? "Exécute la migration V3.2.4 pour activer les déplacements internationaux et l’accueil par pays." : "Run the V3.2.4 migration to activate international travel and country welcome."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/044_super_leader_vip_travel_welcome_v3_2_4.sql</code></div></main>;
}

const copy = {
  fr: {
    title: "Accueil VIP par pays",
    subtitle: "Coordonne les représentants locaux, les prestataires et chaque service promis au membre, du premier contact jusqu’à la clôture de l’accueil.",
    openTravel: "Ouvrir les déplacements",
    activeRepresentatives: "Responsables actifs",
    openTrips: "Accueils ouverts",
    openServices: "Services à réaliser",
    completedServices: "Services terminés",
    addRepresentative: "Ajouter un responsable pays",
    addRepresentativeHelp: "Désigne un collaborateur iLEAD comme point de contact officiel pour un pays ou une ville.",
    country: "Pays",
    city: "Ville ou zone",
    internalPerson: "Collaborateur interne",
    selectPerson: "Sélectionner un collaborateur",
    roleTitle: "Titre dans le programme VIP",
    notes: "Instructions ou périmètre",
    primaryRepresentative: "Responsable principal pour ce pays",
    saveRepresentative: "Enregistrer le responsable",
    countryDirectory: "Répertoire des responsables pays",
    countryDirectoryHelp: "Ce répertoire sert à l’affectation automatique et manuelle des déplacements approuvés.",
    noRepresentatives: "Aucun responsable pays n’a encore été désigné.",
    localRepresentative: "Responsable local",
    active: "Actif",
    inactive: "Inactif",
    primary: "Principal",
    deactivate: "Désactiver",
    activate: "Réactiver",
    operationsBoard: "Centre opérationnel d’accueil",
    operationsBoardHelp: "Confirme les services, les prestataires, les horaires et la réalisation effective.",
    open: "Ouverts",
    noWelcomeCases: "Aucun accueil VIP approuvé ou en cours.",
    notAssigned: "Non affecté",
    arrivalDetails: "Arrivée",
    specialRequirements: "Besoins particuliers",
    noServices: "Aucun service opérationnel n’a été généré pour ce déplacement.",
    serviceStatus: "Statut du service",
    scheduledAt: "Date et heure prévues",
    providerName: "Prestataire ou personne responsable",
    providerContact: "Coordonnées du prestataire",
    serviceNotes: "Notes opérationnelles",
    updateService: "Mettre à jour le service",
    startWelcome: "Démarrer l’accueil",
    completeWelcome: "Clôturer l’accueil",
    cancelWelcome: "Annuler",
    unknown: "Utilisateur",
    statuses: {approved: "Approuvé", assigned: "Affecté", in_progress: "En cours", completed: "Terminé", planned: "Planifié", confirmed: "Confirmé", cancelled: "Annulé", active: "Actif", inactive: "Inactif"},
    services: {airport_welcome: "Accueil à l’aéroport ou à la gare", local_transport: "Transport local", accommodation_guidance: "Assistance hébergement", office_visit: "Visite d’un bureau iLEAD", leadership_meeting: "Rencontre avec les responsables", event_invitation: "Invitation à une activité", local_assistance: "Assistance locale", other: "Autre service"},
  },
  en: {
    title: "VIP country welcome",
    subtitle: "Coordinate local representatives, providers and every service promised to the member, from first contact through welcome closure.",
    openTravel: "Open travel",
    activeRepresentatives: "Active representatives",
    openTrips: "Open welcomes",
    openServices: "Services to deliver",
    completedServices: "Completed services",
    addRepresentative: "Add country representative",
    addRepresentativeHelp: "Appoint an iLEAD employee as the official contact for a country or city.",
    country: "Country",
    city: "City or area",
    internalPerson: "Internal employee",
    selectPerson: "Select an employee",
    roleTitle: "VIP programme title",
    notes: "Instructions or scope",
    primaryRepresentative: "Primary representative for this country",
    saveRepresentative: "Save representative",
    countryDirectory: "Country representative directory",
    countryDirectoryHelp: "This directory supports automatic and manual assignment of approved trips.",
    noRepresentatives: "No country representative has been appointed yet.",
    localRepresentative: "Local representative",
    active: "Active",
    inactive: "Inactive",
    primary: "Primary",
    deactivate: "Deactivate",
    activate: "Reactivate",
    operationsBoard: "Welcome operations centre",
    operationsBoardHelp: "Confirm services, providers, schedules and actual delivery.",
    open: "Open",
    noWelcomeCases: "No approved or active VIP welcome.",
    notAssigned: "Not assigned",
    arrivalDetails: "Arrival",
    specialRequirements: "Special requirements",
    noServices: "No operational service was generated for this trip.",
    serviceStatus: "Service status",
    scheduledAt: "Scheduled date and time",
    providerName: "Provider or responsible person",
    providerContact: "Provider contact",
    serviceNotes: "Operational notes",
    updateService: "Update service",
    startWelcome: "Start welcome",
    completeWelcome: "Close welcome",
    cancelWelcome: "Cancel",
    unknown: "User",
    statuses: {approved: "Approved", assigned: "Assigned", in_progress: "In progress", completed: "Completed", planned: "Planned", confirmed: "Confirmed", cancelled: "Cancelled", active: "Active", inactive: "Inactive"},
    services: {airport_welcome: "Airport or station welcome", local_transport: "Local transport", accommodation_guidance: "Accommodation assistance", office_visit: "iLEAD office visit", leadership_meeting: "Leadership meeting", event_invitation: "Event invitation", local_assistance: "Local assistance", other: "Other service"},
  },
} as const;
