import {createAdminClient} from "@/lib/supabase/admin";

export type VipReportFilters = {
  period?: string | null;
  country?: string | null;
};

type MemberRow = {
  id: string;
  member_number: string;
  full_name: string;
  status: string;
  country: string | null;
  recognition_category: string;
  member_type: string;
  admission_date: string;
  expires_on: string;
};
type StatusDateRow = {status: string; created_at?: string; requested_at?: string; submitted_at?: string; decided_at?: string | null};
type TravelRow = {status: string; destination_country: string; arrival_date: string; departure_date: string; created_at: string};
type MeetingRow = {status: string; event_year: number; start_date: string; end_date: string; host_country: string};
type InvitationRow = {status: string; invited_at: string};
type PartnerRow = {status: string; country: string; created_at: string};
type BenefitRow = {status: string; country: string | null; created_at: string};
type RedemptionRow = {status: string; requested_at: string; value_realized: number | null};
type CommunicationRow = {status: string; priority: string; created_at: string; published_at: string | null};
type DeliveryRow = {status: string; channel: string; created_at: string};

function normalizePeriod(value: string | null | undefined) {
  return ["30", "90", "180", "365", "all"].includes(value ?? "") ? (value as "30" | "90" | "180" | "365" | "all") : "90";
}

function dateFrom(period: string) {
  if (period === "all") return null;
  const result = new Date();
  result.setUTCDate(result.getUTCDate() - Number(period));
  return result.toISOString();
}

function dateInPeriod(value: string | null | undefined, from: string | null) {
  if (!from) return true;
  if (!value) return false;
  return value >= from;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const value = key(item) || "Non renseigné";
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({label, count}))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function loadVipReportAnalytics(input: {
  organizationId: string;
  filters?: VipReportFilters;
}) {
  const admin = createAdminClient();
  const period = normalizePeriod(input.filters?.period);
  const from = dateFrom(period);
  const country = String(input.filters?.country ?? "").trim();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const ninetyDays = new Date(today);
  ninetyDays.setUTCDate(ninetyDays.getUTCDate() + 90);
  const ninetyDaysIso = ninetyDays.toISOString().slice(0, 10);

  const [
    membersResult,
    nominationsResult,
    cardsResult,
    renewalsResult,
    travelResult,
    servicesResult,
    meetingsResult,
    invitationsResult,
    partnersResult,
    benefitsResult,
    redemptionsResult,
    communicationsResult,
    deliveriesResult,
  ] = await Promise.all([
    admin.from("vip_members").select("id,member_number,full_name,status,country,recognition_category,member_type,admission_date,expires_on").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_nominations").select("status,country,submitted_at,decided_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_cards").select("status,valid_until,issued_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_renewal_requests").select("status,requested_at,decided_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_travel_requests").select("status,destination_country,arrival_date,departure_date,created_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_travel_service_items").select("status,created_at").eq("organization_id", input.organizationId).limit(10000),
    admin.from("vip_annual_meetings").select("status,event_year,start_date,end_date,host_country").eq("organization_id", input.organizationId).limit(500),
    admin.from("vip_annual_meeting_invitations").select("status,invited_at").eq("organization_id", input.organizationId).limit(10000),
    admin.from("vip_partners").select("status,country,created_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_benefits").select("status,country,created_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_benefit_redemptions").select("status,requested_at,value_realized").eq("organization_id", input.organizationId).limit(10000),
    admin.from("vip_communications").select("status,priority,created_at,published_at").eq("organization_id", input.organizationId).limit(5000),
    admin.from("vip_communication_deliveries").select("status,channel,created_at").eq("organization_id", input.organizationId).limit(20000),
  ]);

  const results = [membersResult, nominationsResult, cardsResult, renewalsResult, travelResult, servicesResult, meetingsResult, invitationsResult, partnersResult, benefitsResult, redemptionsResult, communicationsResult, deliveriesResult];
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }

  const allMembers = (membersResult.data ?? []) as MemberRow[];
  const members = country ? allMembers.filter((item) => (item.country ?? "").toLocaleLowerCase() === country.toLocaleLowerCase()) : allMembers;
  const nominations = (nominationsResult.data ?? []) as Array<StatusDateRow & {country: string | null}>;
  const cards = (cardsResult.data ?? []) as Array<{status: string; valid_until: string; issued_at: string}>;
  const renewals = (renewalsResult.data ?? []) as StatusDateRow[];
  const travelAll = (travelResult.data ?? []) as TravelRow[];
  const travel = country ? travelAll.filter((item) => item.destination_country.toLocaleLowerCase() === country.toLocaleLowerCase()) : travelAll;
  const services = (servicesResult.data ?? []) as Array<{status: string; created_at: string}>;
  const meetingsAll = (meetingsResult.data ?? []) as MeetingRow[];
  const meetings = country ? meetingsAll.filter((item) => item.host_country.toLocaleLowerCase() === country.toLocaleLowerCase()) : meetingsAll;
  const invitations = (invitationsResult.data ?? []) as InvitationRow[];
  const partnersAll = (partnersResult.data ?? []) as PartnerRow[];
  const partners = country ? partnersAll.filter((item) => item.country.toLocaleLowerCase() === country.toLocaleLowerCase()) : partnersAll;
  const benefitsAll = (benefitsResult.data ?? []) as BenefitRow[];
  const benefits = country ? benefitsAll.filter((item) => !item.country || item.country.toLocaleLowerCase() === country.toLocaleLowerCase()) : benefitsAll;
  const redemptions = (redemptionsResult.data ?? []) as RedemptionRow[];
  const communications = (communicationsResult.data ?? []) as CommunicationRow[];
  const deliveries = (deliveriesResult.data ?? []) as DeliveryRow[];

  const activity = {
    nominations: nominations.filter((item) => dateInPeriod(item.submitted_at, from)),
    renewals: renewals.filter((item) => dateInPeriod(item.requested_at, from)),
    travel: travel.filter((item) => dateInPeriod(item.created_at, from)),
    redemptions: redemptions.filter((item) => dateInPeriod(item.requested_at, from)),
    communications: communications.filter((item) => dateInPeriod(item.created_at, from)),
    deliveries: deliveries.filter((item) => dateInPeriod(item.created_at, from)),
  };

  const activeStatuses = new Set(["active", "pending_renewal", "honorary"]);
  const activeMembers = members.filter((item) => activeStatuses.has(item.status));
  const expiringSoon = members.filter((item) => item.expires_on >= todayIso && item.expires_on <= ninetyDaysIso);
  const expiredMembers = members.filter((item) => item.expires_on < todayIso || item.status === "expired");
  const activeCards = cards.filter((item) => item.status === "active" && item.valid_until >= todayIso);
  const openTravel = travel.filter((item) => !["completed", "rejected", "cancelled"].includes(item.status));
  const openServices = services.filter((item) => !["completed", "cancelled"].includes(item.status));
  const activePartners = partners.filter((item) => item.status === "active");
  const activeBenefits = benefits.filter((item) => item.status === "active");
  const publishedCommunications = communications.filter((item) => item.status === "published");
  const deliverySuccessful = deliveries.filter((item) => ["sent", "delivered", "read", "acknowledged"].includes(item.status)).length;
  const deliveryActionable = deliveries.filter((item) => item.status !== "skipped").length;
  const deliveryRate = deliveryActionable ? Math.round((deliverySuccessful / deliveryActionable) * 100) : 0;
  const realizedValue = redemptions.reduce((sum, item) => sum + Number(item.value_realized ?? 0), 0);

  const countries = countBy(allMembers.filter((item) => item.country), (item) => item.country ?? "").map((item) => item.label);

  return {
    generatedAt: new Date().toISOString(),
    filters: {period, country, from},
    countryOptions: [...new Set([
      ...countries,
      ...travelAll.map((item) => item.destination_country),
      ...partnersAll.map((item) => item.country),
      ...meetingsAll.map((item) => item.host_country),
    ].filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    metrics: {
      memberCount: members.length,
      activeMemberCount: activeMembers.length,
      expiringSoonCount: expiringSoon.length,
      expiredMemberCount: expiredMembers.length,
      activeCardCount: activeCards.length,
      pendingNominationCount: nominations.filter((item) => ["submitted", "under_review", "needs_information"].includes(item.status)).length,
      pendingRenewalCount: renewals.filter((item) => ["submitted", "under_review", "needs_information"].includes(item.status)).length,
      openTravelCount: openTravel.length,
      openServiceCount: openServices.length,
      activePartnerCount: activePartners.length,
      activeBenefitCount: activeBenefits.length,
      publishedCommunicationCount: publishedCommunications.length,
      deliveryRate,
      realizedBenefitValue: realizedValue,
    },
    activity: {
      nominations: activity.nominations.length,
      renewals: activity.renewals.length,
      travelRequests: activity.travel.length,
      benefitRequests: activity.redemptions.length,
      communications: activity.communications.length,
      deliveries: activity.deliveries.length,
    },
    memberStatuses: countBy(members, (item) => item.status),
    memberTypes: countBy(members, (item) => item.member_type),
    recognitionCategories: countBy(members, (item) => item.recognition_category),
    memberCountries: countBy(members.filter((item) => item.country), (item) => item.country ?? "").slice(0, 12),
    nominationStatuses: countBy(nominations, (item) => item.status),
    renewalStatuses: countBy(renewals, (item) => item.status),
    travelStatuses: countBy(travel, (item) => item.status),
    serviceStatuses: countBy(services, (item) => item.status),
    meetingStatuses: countBy(meetings, (item) => item.status),
    invitationStatuses: countBy(invitations, (item) => item.status),
    redemptionStatuses: countBy(redemptions, (item) => item.status),
    communicationStatuses: countBy(communications, (item) => item.status),
    deliveryStatuses: countBy(deliveries, (item) => item.status),
    deliveryChannels: countBy(deliveries, (item) => item.channel),
    alerts: {
      expiringMembers: expiringSoon.sort((a, b) => a.expires_on.localeCompare(b.expires_on)).slice(0, 20),
      upcomingTravel: travel.filter((item) => item.arrival_date >= todayIso && !["completed", "rejected", "cancelled"].includes(item.status)).sort((a, b) => a.arrival_date.localeCompare(b.arrival_date)).slice(0, 20),
      upcomingMeetings: meetings.filter((item) => item.start_date >= todayIso && item.status !== "cancelled").sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 10),
    },
  };
}

export type VipReportAnalytics = Awaited<ReturnType<typeof loadVipReportAnalytics>>;
