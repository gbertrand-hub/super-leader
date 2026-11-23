import Link from "next/link";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyCertainIdentityLinksAction,
  confirmPersonIdentityAssociationAction,
  decideIdentityReviewAction,
  resolveLegacyAcademyIdentityReviewAction,
  revokePersonIdentityAssociationAction,
} from "@/app/actions/person-identity-associations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Membership = { organization_id: string; role: string };
type Member = { user_id: string; role: string; is_active: boolean };
type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Client = { id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; linked_user_id: string | null };
type Enrollment = { id: string; school_id: string; user_id: string | null; crm_client_id: string | null; source: string; academic_status: string };
type School = { id: string; name: string; code: string; is_staff_default: boolean; is_active: boolean };
type Ambassador = { id: string; full_name: string; email: string | null; phone: string | null; status: string };
type IdentityAssociation = { id: string; primary_user_id: string; crm_client_id: string; related_user_id: string | null; status: string; confirmed_at: string };
type IdentityDecision = { crm_client_id: string; candidate_user_id: string; decision: string; reason: string; updated_at: string };
type LegacyAcademyReview = { id: string; enrollment_id: string; user_id: string; reason: string; candidate_client_ids: string[]; status: string; created_at: string };

type IdentityState = "confirmed" | "safe" | "no_account" | "review" | "conflict";
type IdentityRecord = {
  client: Client;
  profile: Profile | null;
  enrollments: Enrollment[];
  schools: string[];
  state: IdentityState;
  reason: string;
  candidateUserId: string | null;
};

const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const normalizeEmail = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
const normalizePhone = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
const normalizeName = (value: string | null | undefined) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const displayName = (profile: Profile | undefined, fallback: string) => profile?.full_name?.trim() || profile?.email?.trim() || fallback;
const hasUsableEmail = (value: string | null | undefined) => {
  const email = normalizeEmail(value);
  if (!email) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
};

function groupDuplicates(clients: Client[]) {
  const keys = new Map<string, Client[]>();
  for (const client of clients) {
    const email = normalizeEmail(client.email);
    const phone = normalizePhone(client.phone || client.whatsapp_phone);
    for (const key of [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean) as string[]) {
      keys.set(key, [...(keys.get(key) ?? []), client]);
    }
  }
  return [...keys.entries()].filter(([, rows]) => new Set(rows.map((row) => row.id)).size > 1);
}

async function readOrganizationRows<T>(admin: SupabaseClient, table: string, columns: string, organizationId: string) {
  const rows: T[] = [];
  const errors: string[] = [];
  const batchSize = 1000;
  for (let start = 0; ; start += batchSize) {
    const result = await admin.from(table).select(columns).eq("organization_id", organizationId).range(start, start + batchSize - 1);
    if (result.error) { errors.push(result.error.message); break; }
    const batch = (result.data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  return { rows, errors };
}

async function readProfiles(admin: SupabaseClient, userIds: string[]) {
  const rows: Profile[] = [];
  const errors: string[] = [];
  for (let start = 0; start < userIds.length; start += 500) {
    const result = await admin.from("profiles").select("id,full_name,email,phone").in("id", userIds.slice(start, start + 500));
    if (result.error) { errors.push(result.error.message); continue; }
    rows.push(...((result.data ?? []) as Profile[]));
  }
  return { rows, errors };
}

function identityBadge(state: IdentityState) {
  if (state === "confirmed") return "bg-emerald-100 text-emerald-800";
  if (state === "safe") return "bg-blue-100 text-blue-800";
  if (state === "no_account") return "bg-slate-100 text-slate-700";
  if (state === "review") return "bg-amber-100 text-amber-900";
  return "bg-rose-100 text-rose-800";
}

function identityLabel(state: IdentityState) {
  if (state === "confirmed") return "Identité confirmée";
  if (state === "safe") return "Lien certain à appliquer";
  if (state === "no_account") return "Compte utilisateur absent";
  if (state === "review") return "À vérifier";
  return "Conflit";
}

function legacyReviewReasonLabel(reason: string) {
  if (reason === "multiple_matches") return "Plusieurs dossiers CRM correspondent à cet apprenant.";
  if (reason === "client_already_linked") return "Un dossier CRM candidat est déjà relié à un autre compte.";
  if (reason === "missing_profile") return "Le profil utilisateur est incomplet ou introuvable.";
  return reason || "Vérification Academy/CRM requise.";
}

export default async function IdentityAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const requestedOrganizationId = one(params.organization).trim();
  let membershipQuery = admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true);
  if (requestedOrganizationId) membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  const { data: memberships } = await membershipQuery.limit(20);
  const membership = ((memberships ?? []) as Membership[]).find((row) => ["owner", "admin"].includes(row.role));
  if (!membership) redirect("/dashboard?error=access-denied");
  const organizationId = membership.organization_id;

  const [identitySchemaProbe, identityQueueSchemaProbe] = await Promise.all([
    admin.from("crm_clients").select("identity_uid", { head: true, count: "exact" }).eq("organization_id", organizationId).limit(1),
    admin.from("academy_crm_identity_review_queue").select("resolution_source", { head: true, count: "exact" }).eq("organization_id", organizationId).limit(1),
  ]);
  const identitySchemaReady = !identitySchemaProbe.error;
  const identityQueueSchemaReady = !identityQueueSchemaProbe.error;

  const [membersRead, clientsRead, enrollmentsRead, schoolsRead, ambassadorsRead, associationsRead, decisionsRead, salesCountResult, salesUnlinkedResult, crmReviewResult, academyLegacyReviewsRead] = await Promise.all([
    readOrganizationRows<Member>(admin, "organization_members", "user_id,role,is_active", organizationId),
    readOrganizationRows<Client>(admin, "crm_clients", "id,full_name,email,phone,whatsapp_phone,linked_user_id", organizationId),
    readOrganizationRows<Enrollment>(admin, "academy_school_enrollments", "id,school_id,user_id,crm_client_id,source,academic_status", organizationId),
    readOrganizationRows<School>(admin, "academy_schools", "id,name,code,is_staff_default,is_active", organizationId),
    readOrganizationRows<Ambassador>(admin, "crm_ambassadors", "id,full_name,email,phone,status", organizationId),
    readOrganizationRows<IdentityAssociation>(admin, "person_identity_associations", "id,primary_user_id,crm_client_id,related_user_id,status,confirmed_at", organizationId),
    identitySchemaReady ? readOrganizationRows<IdentityDecision>(admin, "person_identity_review_decisions", "crm_client_id,candidate_user_id,decision,reason,updated_at", organizationId) : Promise.resolve({ rows: [] as IdentityDecision[], errors: [] as string[] }),
    admin.from("sales_records").select("id", { head: true, count: "exact" }).eq("organization_id", organizationId),
    admin.from("sales_records").select("id", { head: true, count: "exact" }).eq("organization_id", organizationId).is("crm_client_id", null),
    admin.from("crm_identity_review_queue").select("id", { head: true, count: "exact" }).eq("organization_id", organizationId).eq("status", "open"),
    readOrganizationRows<LegacyAcademyReview>(admin, "academy_crm_identity_review_queue", "id,enrollment_id,user_id,reason,candidate_client_ids,status,created_at", organizationId),
  ]);

  const members = membersRead.rows.filter((row) => row.is_active && row.user_id && row.role);
  const clients = clientsRead.rows;
  const enrollments = enrollmentsRead.rows;
  const schools = schoolsRead.rows.filter((row) => row.is_active);
  const ambassadors = ambassadorsRead.rows;
  const associations = associationsRead.rows.filter((row) => row.status === "active");
  const academyLegacyReviews = academyLegacyReviewsRead.rows.filter((row) => row.status === "open");
  const relevantUserIds = [...new Set([
    ...members.map((row) => row.user_id),
    ...enrollments.map((row) => row.user_id).filter(Boolean) as string[],
    ...clients.map((row) => row.linked_user_id).filter(Boolean) as string[],
    ...associations.map((row) => row.primary_user_id),
    ...associations.map((row) => row.related_user_id).filter(Boolean) as string[],
    ...academyLegacyReviews.map((row) => row.user_id),
  ])];
  const profilesRead = await readProfiles(admin, relevantUserIds);
  const profiles = profilesRead.rows;
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const clientById = new Map(clients.map((row) => [row.id, row]));
  const schoolById = new Map(schools.map((row) => [row.id, row]));
  const memberById = new Map(members.map((row) => [row.user_id, row]));
  const clientsByLinkedUser = new Map<string, Client[]>();
  const clientsByName = new Map<string, Client[]>();
  const associationByClientId = new Map(associations.map((row) => [row.crm_client_id, row]));
  for (const client of clients) {
    if (client.linked_user_id) clientsByLinkedUser.set(client.linked_user_id, [...(clientsByLinkedUser.get(client.linked_user_id) ?? []), client]);
    const nameKey = normalizeName(client.full_name);
    if (nameKey) clientsByName.set(nameKey, [...(clientsByName.get(nameKey) ?? []), client]);
  }

  const identitySchools = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const key = enrollment.user_id ? `u:${enrollment.user_id}` : enrollment.crm_client_id ? `c:${enrollment.crm_client_id}` : "";
    if (!key) continue;
    const values = identitySchools.get(key) ?? new Set<string>();
    values.add(enrollment.school_id);
    identitySchools.set(key, values);
  }
  const multiSchool = [...identitySchools.entries()].filter(([, ids]) => ids.size > 1).sort((a, b) => b[1].size - a[1].size);
  const staffIds = new Set(members.map((row) => row.user_id));
  const learnerUserIds = new Set(enrollments.map((row) => row.user_id).filter(Boolean) as string[]);
  const staffLearners = [...staffIds].filter((id) => learnerUserIds.has(id));
  const coachSchoolIds = new Set(schools.filter((school) => school.is_staff_default || school.code === "school_coaches").map((school) => school.id));
  const staffWithCoachEnrollment = new Set(enrollments.filter((row) => row.user_id && coachSchoolIds.has(row.school_id)).map((row) => row.user_id as string));
  const staffMissingCoach = [...staffIds].filter((id) => !staffWithCoachEnrollment.has(id));
  const linkedClients = clients.filter((row) => row.linked_user_id);
  const duplicateGroups = groupDuplicates(clients);

  const contactToRoles = new Map<string, Set<string>>();
  const addContact = (email: string | null, phone: string | null, role: string) => {
    for (const key of [normalizeEmail(email) && `e:${normalizeEmail(email)}`, normalizePhone(phone) && `p:${normalizePhone(phone)}`].filter(Boolean) as string[]) {
      const roles = contactToRoles.get(key) ?? new Set<string>(); roles.add(role); contactToRoles.set(key, roles);
    }
  };
  for (const member of members) { const p = profileById.get(member.user_id); addContact(p?.email ?? null, p?.phone ?? null, "Employé"); }
  for (const client of clients) addContact(client.email, client.phone || client.whatsapp_phone, "Client CRM");
  for (const ambassador of ambassadors) addContact(ambassador.email, ambassador.phone, "Ambassadeur");
  const probableMultiRole = [...contactToRoles.entries()].filter(([, roles]) => roles.size > 1);

  // V4.10.112: Academy/CRM identity resolution center. It is intentionally scoped to
  // CRM dossiers that are already related to an Academy enrollment.
  const academyClientIds = new Set(enrollments.map((row) => row.crm_client_id).filter((id): id is string => Boolean(id)));
  const academyUserIds = new Set(enrollments.map((row) => row.user_id).filter((id): id is string => Boolean(id)));
  const academyClients = clients.filter((client) => academyClientIds.has(client.id) || Boolean(client.linked_user_id && academyUserIds.has(client.linked_user_id)));

  const clientsByEmail = new Map<string, Client[]>();
  const profilesByEmail = new Map<string, Profile[]>();
  const profilesByPhone = new Map<string, Profile[]>();
  const linkedClientByUser = new Map<string, Client>();
  const enrollmentsByClient = new Map<string, Enrollment[]>();
  const enrollmentClientsByUser = new Map<string, Set<string>>();
  const enrollmentUsersByClient = new Map<string, Set<string>>();
  for (const client of clients) {
    const email = normalizeEmail(client.email);
    if (email) clientsByEmail.set(email, [...(clientsByEmail.get(email) ?? []), client]);
    if (client.linked_user_id) linkedClientByUser.set(client.linked_user_id, client);
  }
  for (const profile of profiles) {
    const email = normalizeEmail(profile.email);
    const phone = normalizePhone(profile.phone);
    if (email) profilesByEmail.set(email, [...(profilesByEmail.get(email) ?? []), profile]);
    if (phone) profilesByPhone.set(phone, [...(profilesByPhone.get(phone) ?? []), profile]);
  }
  for (const enrollment of enrollments) {
    if (enrollment.crm_client_id) enrollmentsByClient.set(enrollment.crm_client_id, [...(enrollmentsByClient.get(enrollment.crm_client_id) ?? []), enrollment]);
    if (enrollment.user_id && enrollment.crm_client_id) {
      const clientIds = enrollmentClientsByUser.get(enrollment.user_id) ?? new Set<string>();
      clientIds.add(enrollment.crm_client_id);
      enrollmentClientsByUser.set(enrollment.user_id, clientIds);

      const userIdsForClient = enrollmentUsersByClient.get(enrollment.crm_client_id) ?? new Set<string>();
      userIdsForClient.add(enrollment.user_id);
      enrollmentUsersByClient.set(enrollment.crm_client_id, userIdsForClient);
    }
  }
  const decisionByPair = new Map(decisionsRead.rows.map((row) => [`${row.crm_client_id}:${row.candidate_user_id}`, row]));

  // V4.10.113 consolidates the historical Academy/CRM review queue into this same center.
  // Several queue rows can belong to the same real person, so the UI groups them by user_id.
  const enrollmentById = new Map(enrollments.map((row) => [row.id, row]));
  const legacyReviewsByUser = new Map<string, LegacyAcademyReview[]>();
  for (const review of academyLegacyReviews) {
    legacyReviewsByUser.set(review.user_id, [...(legacyReviewsByUser.get(review.user_id) ?? []), review]);
  }
  const legacyReviewCases = [...legacyReviewsByUser.entries()].map(([userId, reviews]) => {
    const candidateIds = [...new Set(reviews.flatMap((review) => review.candidate_client_ids ?? []))];
    const candidates = candidateIds.map((id) => clientById.get(id)).filter((client): client is Client => Boolean(client));
    const profile = profileById.get(userId) ?? null;
    const relatedEnrollments = reviews.map((review) => enrollmentById.get(review.enrollment_id)).filter((row): row is Enrollment => Boolean(row));
    const schoolNames = [...new Set(relatedEnrollments.map((row) => schoolById.get(row.school_id)?.name ?? "École inconnue"))];
    const reasons = [...new Set(reviews.map((review) => legacyReviewReasonLabel(review.reason)))];
    const coherentClient = clientsByLinkedUser.get(userId)?.[0] ?? null;
    const selectableClients = [...new Map([...(coherentClient ? [coherentClient] : []), ...candidates].map((client) => [client.id, client])).values()];
    return {
      userId,
      reviews,
      representativeReviewId: reviews[0].id,
      profile,
      candidates,
      selectableClients,
      candidateIds,
      schoolNames,
      reasons,
      coherentClient,
      createdAt: reviews.map((review) => review.created_at).sort()[0] ?? "",
    };
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const identityRecords: IdentityRecord[] = academyClients.map((client) => {
    const association = associationByClientId.get(client.id);
    const directEnrollments = enrollmentsByClient.get(client.id) ?? [];
    const userEnrollments = client.linked_user_id ? enrollments.filter((row) => row.user_id === client.linked_user_id) : [];
    const recordEnrollments = [...new Map([...directEnrollments, ...userEnrollments].map((row) => [row.id, row])).values()];
    const schoolNames = [...new Set(recordEnrollments.map((row) => schoolById.get(row.school_id)?.name ?? "École inconnue"))];

    if (association) {
      return {
        client,
        profile: profileById.get(association.primary_user_id) ?? (client.linked_user_id ? profileById.get(client.linked_user_id) ?? null : null),
        enrollments: recordEnrollments,
        schools: schoolNames,
        state: "confirmed" as const,
        reason: "Association administrative active entre le dossier CRM et le compte principal.",
        candidateUserId: association.primary_user_id,
      };
    }
    if (client.linked_user_id) {
      return {
        client,
        profile: profileById.get(client.linked_user_id) ?? null,
        enrollments: recordEnrollments,
        schools: schoolNames,
        state: "confirmed" as const,
        reason: "Le dossier CRM est déjà relié à un compte utilisateur.",
        candidateUserId: client.linked_user_id,
      };
    }

    const email = normalizeEmail(client.email);
    if (email) {
      const sameEmailClients = clientsByEmail.get(email) ?? [];
      const sameEmailProfiles = profilesByEmail.get(email) ?? [];
      if (sameEmailClients.length > 1) {
        return { client, profile: null, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: `L’e-mail ${email} existe sur ${sameEmailClients.length} dossiers CRM. Aucune liaison automatique.`, candidateUserId: null };
      }
      if (sameEmailProfiles.length > 1) {
        return { client, profile: null, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: `L’e-mail ${email} correspond à plusieurs comptes utilisateurs.`, candidateUserId: null };
      }
      if (sameEmailProfiles.length === 1) {
        const candidate = sameEmailProfiles[0];
        const decision = decisionByPair.get(`${client.id}:${candidate.id}`);
        const occupied = linkedClientByUser.get(candidate.id);
        if (occupied && occupied.id !== client.id) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Le compte correspondant est déjà relié à un autre dossier CRM.", candidateUserId: candidate.id };
        }
        const userEnrollmentClients = enrollmentClientsByUser.get(candidate.id) ?? new Set<string>();
        if ([...userEnrollmentClients].some((clientId) => clientId !== client.id)) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Le compte proposé possède déjà une inscription Academy rattachée à un autre dossier CRM.", candidateUserId: candidate.id };
        }
        const clientEnrollmentUsers = enrollmentUsersByClient.get(client.id) ?? new Set<string>();
        if ([...clientEnrollmentUsers].some((userId) => userId !== candidate.id)) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Ce dossier CRM possède déjà une inscription Academy rattachée à un autre compte utilisateur.", candidateUserId: candidate.id };
        }
        if (decision?.decision === "different_person") {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Cette correspondance a déjà été déclarée comme deux personnes différentes.", candidateUserId: candidate.id };
        }
        if (decision?.decision === "deferred") {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "review" as const, reason: "Décision reportée par l’administration. Vérification manuelle requise.", candidateUserId: candidate.id };
        }
        return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "safe" as const, reason: `Même e-mail exact et unique : ${email}. Aucun lien contradictoire détecté.`, candidateUserId: candidate.id };
      }
    }

    const phone = normalizePhone(client.phone || client.whatsapp_phone);
    if (phone) {
      const phoneProfiles = profilesByPhone.get(phone) ?? [];
      if (phoneProfiles.length > 1) {
        return { client, profile: null, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: `Le téléphone ${phone} correspond à plusieurs comptes. Vérification manuelle obligatoire.`, candidateUserId: null };
      }
      if (phoneProfiles.length === 1) {
        const candidate = phoneProfiles[0];
        const decision = decisionByPair.get(`${client.id}:${candidate.id}`);
        const occupied = linkedClientByUser.get(candidate.id);
        if (occupied && occupied.id !== client.id) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Le compte correspondant au téléphone est déjà relié à un autre dossier CRM.", candidateUserId: candidate.id };
        }
        const userEnrollmentClients = enrollmentClientsByUser.get(candidate.id) ?? new Set<string>();
        if ([...userEnrollmentClients].some((clientId) => clientId !== client.id)) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Le compte proposé possède déjà une inscription Academy rattachée à un autre dossier CRM.", candidateUserId: candidate.id };
        }
        const clientEnrollmentUsers = enrollmentUsersByClient.get(client.id) ?? new Set<string>();
        if ([...clientEnrollmentUsers].some((userId) => userId !== candidate.id)) {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "conflict" as const, reason: "Ce dossier CRM possède déjà une inscription Academy rattachée à un autre compte utilisateur.", candidateUserId: candidate.id };
        }
        if (decision?.decision === "different_person") {
          return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "no_account" as const, reason: "La correspondance téléphone a été rejetée : aucun compte n’est actuellement confirmé pour ce dossier.", candidateUserId: null };
        }
        return { client, profile: candidate, enrollments: recordEnrollments, schools: schoolNames, state: "review" as const, reason: decision?.decision === "deferred" ? "Correspondance téléphone reportée pour vérification ultérieure." : `Même téléphone (${phone}) : ce signal n’est jamais suffisant pour une liaison automatique.`, candidateUserId: candidate.id };
      }
    }

    return { client, profile: null, enrollments: recordEnrollments, schools: schoolNames, state: "no_account" as const, reason: "Aucun compte utilisateur correspondant n’a été trouvé. Le dossier CRM/Academy reste valide.", candidateUserId: null };
  }).sort((a, b) => {
    const order: Record<IdentityState, number> = { conflict: 0, review: 1, safe: 2, no_account: 3, confirmed: 4 };
    return order[a.state] - order[b.state] || a.client.full_name.localeCompare(b.client.full_name, "fr");
  });

  const stateCounts: Record<IdentityState, number> = { confirmed: 0, safe: 0, no_account: 0, review: 0, conflict: 0 };
  for (const record of identityRecords) stateCounts[record.state] += 1;

  // V4.10.114: account activation readiness. This is a preparation layer only;
  // it never creates an Auth account or sends an invitation.
  const noAccountRecords = identityRecords.filter((record) => record.state === "no_account");
  const activationReadyRecords = noAccountRecords.filter((record) => hasUsableEmail(record.client.email));
  const activationContactFixRecords = noAccountRecords.filter((record) => !hasUsableEmail(record.client.email));
  const activationMultiEnrollmentRecords = noAccountRecords.filter((record) => record.enrollments.length > 1);
  const activationMultiSchoolRecords = noAccountRecords.filter((record) => record.schools.length > 1);
  const activationSchoolCounts = [...noAccountRecords.reduce((acc, record) => {
    for (const school of record.schools) acc.set(school, (acc.get(school) ?? 0) + 1);
    return acc;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));

  const currentReviewKeys = new Set(identityRecords.filter((record) => record.state === "review").map((record) => record.candidateUserId ? `u:${record.candidateUserId}` : `c:${record.client.id}`));
  const globalReviewKeys = new Set(currentReviewKeys);
  for (const reviewCase of legacyReviewCases) globalReviewKeys.add(`u:${reviewCase.userId}`);
  const globalReviewCount = globalReviewKeys.size;

  const q = one(params.q).trim().toLowerCase();
  const identityStatus = one(params.identityStatus).trim() as IdentityState | "";
  const activation = one(params.activation).trim() as "" | "ready" | "contact_fix" | "multi_school";
  const filteredLegacyReviewCases = legacyReviewCases.filter((reviewCase) => {
    if (!q) return true;
    return [
      reviewCase.profile?.full_name,
      reviewCase.profile?.email,
      reviewCase.profile?.phone,
      ...reviewCase.schoolNames,
      ...reviewCase.reasons,
      ...reviewCase.candidates.flatMap((client) => [client.full_name, client.email, client.phone, client.whatsapp_phone]),
    ].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const filteredIdentityRecords = identityRecords.filter((record) => {
    if (identityStatus && record.state !== identityStatus) return false;
    if (activation) {
      if (record.state !== "no_account") return false;
      if (activation === "ready" && !hasUsableEmail(record.client.email)) return false;
      if (activation === "contact_fix" && hasUsableEmail(record.client.email)) return false;
      if (activation === "multi_school" && record.schools.length <= 1) return false;
    }
    if (!q) return true;
    return [record.client.full_name, record.client.email, record.client.phone, record.client.whatsapp_phone, record.profile?.full_name, record.profile?.email, record.profile?.phone, ...record.schools, record.reason]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const identityPageSize = 30;
  const requestedIdentityPage = Math.max(1, Number.parseInt(one(params.identityPage), 10) || 1);
  const identityTotalPages = Math.max(1, Math.ceil(filteredIdentityRecords.length / identityPageSize));
  const identityPage = Math.min(requestedIdentityPage, identityTotalPages);
  const visibleIdentityRecords = filteredIdentityRecords.slice((identityPage - 1) * identityPageSize, identityPage * identityPageSize);
  const identityHref = (targetPage: number, state = identityStatus, activationFilter = state === "no_account" ? activation : "") => `/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}&q=${encodeURIComponent(q)}&identityStatus=${encodeURIComponent(state)}&activation=${encodeURIComponent(activationFilter)}&identityPage=${targetPage}`;
  const activationHref = (activationFilter: "ready" | "contact_fix" | "multi_school" | "") => identityHref(1, "no_account", activationFilter);

  const associationSchemaMissing = associationsRead.errors.length > 0;
  const queryErrors = [...membersRead.errors, ...clientsRead.errors, ...enrollmentsRead.errors, ...schoolsRead.errors, ...ambassadorsRead.errors, ...profilesRead.errors, ...decisionsRead.errors, ...academyLegacyReviewsRead.errors];
  const cards = [
    ["Employés actifs", members.length], ["Clients CRM", clients.length], ["Ambassadeurs", ambassadors.length],
    ["Inscriptions Academy", enrollments.length], ["Ventes", salesCountResult.count ?? 0], ["Écoles actives", schools.length],
  ];

  const identityLabelForKey = (key: string) => {
    if (key.startsWith("u:")) return displayName(profileById.get(key.slice(2)), "Utilisateur sans nom");
    return clientById.get(key.slice(2))?.full_name ?? "Client sans nom";
  };

  const multiSchoolRecords = multiSchool.map(([key, ids]) => {
    const isUser = key.startsWith("u:");
    const id = key.slice(2);
    const profile = isUser ? profileById.get(id) : undefined;
    const primaryClient = !isUser ? clientById.get(id) : undefined;
    const association = primaryClient ? associationByClientId.get(primaryClient.id) : undefined;
    const associatedStaffProfile = association ? profileById.get(association.primary_user_id) : undefined;
    const exactClients = isUser ? clientsByLinkedUser.get(id) ?? [] : primaryClient ? [primaryClient] : [];
    const sameNameClients = isUser ? clientsByName.get(normalizeName(profile?.full_name)) ?? [] : [];
    const hasNameOnlyMatch = sameNameClients.some((client) => !exactClients.some((exact) => exact.id === client.id));
    const relatedClients = [...new Map([...exactClients, ...sameNameClients].map((client) => [client.id, client])).values()];
    const emails = [...new Set([profile?.email, associatedStaffProfile?.email, ...relatedClients.map((client) => client.email)].map(normalizeEmail).filter(Boolean))];
    const phones = [...new Set([profile?.phone, associatedStaffProfile?.phone, ...relatedClients.flatMap((client) => [client.phone, client.whatsapp_phone])].map(normalizePhone).filter(Boolean))];
    const roles = new Set<string>(["Apprenant"]);
    if ((isUser && memberById.has(id)) || association) roles.add("Employé");
    const contactKeys = new Set([...emails.map((email) => `e:${email}`), ...phones.map((phone) => `p:${phone}`)]);
    if (ambassadors.some((ambassador) => contactKeys.has(`e:${normalizeEmail(ambassador.email)}`) || contactKeys.has(`p:${normalizePhone(ambassador.phone)}`))) roles.add("Ambassadeur");
    const schoolNames = [...ids].map((schoolId) => schoolById.get(schoolId)?.name ?? "École inconnue");
    const staffCandidates = !isUser && primaryClient ? members.filter((member) => normalizeName(profileById.get(member.user_id)?.full_name) === normalizeName(primaryClient.full_name)).map((member) => ({ userId: member.user_id, name: displayName(profileById.get(member.user_id), "Employé"), email: profileById.get(member.user_id)?.email ?? "" })) : [];
    return { key, name: identityLabelForKey(key), emails, phones, roles: [...roles], schoolNames, status: association ? "Identité confirmée" : hasNameOnlyMatch || staffCandidates.length ? "Correspondance probable" : "Identité reliée", association, primaryClient, staffCandidates };
  });
  const filteredMultiSchool = q ? multiSchoolRecords.filter((record) => [record.name, ...record.emails, ...record.phones, ...record.roles, ...record.schoolNames].join(" ").toLowerCase().includes(q)) : multiSchoolRecords;
  const pageSize = 24;
  const requestedPage = Math.max(1, Number.parseInt(one(params.page), 10) || 1);
  const totalPages = Math.max(1, Math.ceil(filteredMultiSchool.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const visibleMultiSchool = filteredMultiSchool.slice((page - 1) * pageSize, page * pageSize);
  const auditHref = (targetPage: number) => `/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}&q=${encodeURIComponent(q)}&page=${targetPage}`;
  const currentReturnTo = identityHref(identityPage);
  const success = one(params.success);
  const error = one(params.error);

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-7xl">
    <Link href={`/dashboard/admin?organization=${encodeURIComponent(organizationId)}`} className="font-black text-indigo-700">← Administration</Link>
    <header className="mt-5 rounded-[2rem] bg-gradient-to-r from-slate-950 via-indigo-950 to-emerald-950 p-8 text-white shadow-xl">
      <p className="text-xs font-black uppercase tracking-[.24em] text-amber-300">AUDIT GLOBAL · IDENTITÉ 360°</p><h1 className="mt-2 text-4xl font-black">Personnes, rôles et identités</h1>
      <p className="mt-3 max-w-4xl text-slate-200">La lecture globale V4.10.111 est conservée. V4.10.117 donne désormais la priorité à la fiabilisation des paiements étudiants avant toute nouvelle invitation.</p>
      <p className="mt-5 inline-flex rounded-full bg-emerald-400/15 px-4 py-2 text-sm font-black text-emerald-200">✓ Aucun paiement, vente, dossier CRM ou inscription n’est supprimé</p>
    </header>
    {success ? <section className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">{success}</section> : null}
    {error ? <section className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-900">{error}</section> : null}
    {queryErrors.length ? <section className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-5"><h2 className="font-black text-rose-900">Lecture partielle</h2><ul className="mt-2 list-disc pl-5 text-sm text-rose-800">{queryErrors.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section> : null}
    {associationSchemaMissing ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-black text-amber-950">Schéma d’association requis</h2><p className="mt-2 text-sm text-amber-900">La table <code>person_identity_associations</code> n’est pas lisible. L’audit reste partiel jusqu’à activation de la migration correspondante.</p></section> : null}
    {!identitySchemaReady ? <section className="mt-5 rounded-2xl border border-blue-300 bg-blue-50 p-5"><h2 className="font-black text-blue-950">Activation V4.10.112 requise pour les actions</h2><p className="mt-2 text-sm text-blue-900">Exécutez la migration <code>20261114170000_unified_identity_360_v4_10_112.sql</code>. Le système peut prévisualiser les catégories, mais aucune réparation V4.10.112 n’est disponible avant cette étape.</p></section> : null}
    {identitySchemaReady && !identityQueueSchemaReady ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-black text-amber-950">Activation V4.10.113 requise pour la file historique</h2><p className="mt-2 text-sm text-amber-900">Exécutez la migration <code>20261115040000_identity_queue_consolidation_v4_10_113.sql</code>. Les cas historiques restent visibles, mais leur résolution depuis ce centre est désactivée jusque-là.</p></section> : null}

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{cards.map(([label, value]) => <article key={String(label)} className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}</section>

    <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.2em] text-indigo-600">V4.10.117 · Academy / CRM / Finance</p><h2 className="mt-1 text-3xl font-black">Centre de résolution des identités</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Une personne réelle, un dossier CRM pivot, un compte lorsqu’il existe et plusieurs inscriptions Academy possibles. Le nom seul et le téléphone seul ne déclenchent jamais une liaison automatique.</p></div><div className="flex flex-col gap-2"><Link href={`/dashboard/academy/students/finance-control?organization=${encodeURIComponent(organizationId)}`} className="rounded-xl bg-emerald-700 px-5 py-3 text-center font-black text-white shadow-sm">Ouvrir le Centre financier étudiant</Link>{identitySchemaReady && stateCounts.safe > 0 ? <form action={applyCertainIdentityLinksAction}><input type="hidden" name="returnTo" value={currentReturnTo}/><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white shadow-sm">Appliquer {stateCounts.safe} lien(s) certain(s)</button><p className="mt-2 max-w-xs text-xs text-slate-500">Uniquement e-mail exact + unique, sans lien contradictoire.</p></form> : null}</div></div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ["confirmed", "Identités confirmées", stateCounts.confirmed],
          ["safe", "Liens certains", stateCounts.safe],
          ["no_account", "Sans compte", stateCounts.no_account],
          ["review", "À vérifier", globalReviewCount],
          ["conflict", "Conflits", stateCounts.conflict],
        ] as [IdentityState, string, number][]).map(([state, title, count]) => <Link key={state} href={identityHref(1, state)} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow ${identityStatus === state ? "border-indigo-500 bg-indigo-50" : "bg-slate-50"}`}><p className="text-xs font-black uppercase text-slate-500">{title}</p><p className="mt-1 text-3xl font-black">{count}</p></Link>)}
      </div>
      {legacyReviewCases.length ? <p className="mt-3 text-xs font-bold text-amber-800">Le compteur « À vérifier » inclut {legacyReviewCases.length} personne(s) provenant de la file historique Academy/CRM ({academyLegacyReviews.length} ligne(s) techniques regroupée(s)).</p> : null}

      {stateCounts.no_account > 0 ? <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-sky-700">Préparation d’activation des comptes</p><h3 className="mt-1 text-xl font-black">Apprenants Academy sans compte</h3><p className="mt-2 max-w-3xl text-sm text-slate-600">Cette zone reste visible pour préparer les identités, mais les nouvelles invitations sont suspendues en V4.10.117 jusqu’à validation des soldes et paiements par Finance/Suivi.</p></div><span className="rounded-full bg-white px-4 py-2 text-sm font-black text-sky-900">{stateCounts.no_account} personne(s)</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href={activationHref("ready")} className={`rounded-xl border p-4 ${activation === "ready" ? "border-emerald-500 bg-emerald-100" : "border-emerald-200 bg-white"}`}><p className="text-xs font-black uppercase text-emerald-700">E-mail exploitable</p><p className="mt-1 text-2xl font-black">{activationReadyRecords.length}</p><p className="mt-1 text-xs text-slate-600">Identités techniquement prêtes, à inviter seulement après validation financière.</p></Link>
          <Link href={activationHref("contact_fix")} className={`rounded-xl border p-4 ${activation === "contact_fix" ? "border-rose-500 bg-rose-100" : "border-rose-200 bg-white"}`}><p className="text-xs font-black uppercase text-rose-700">Coordonnées à corriger</p><p className="mt-1 text-2xl font-black">{activationContactFixRecords.length}</p><p className="mt-1 text-xs text-slate-600">E-mail absent ou non exploitable avant activation.</p></Link>
          <Link href={activationHref("multi_school")} className={`rounded-xl border p-4 ${activation === "multi_school" ? "border-violet-500 bg-violet-100" : "border-violet-200 bg-white"}`}><p className="text-xs font-black uppercase text-violet-700">Multi-écoles</p><p className="mt-1 text-2xl font-black">{activationMultiSchoolRecords.length}</p><p className="mt-1 text-xs text-slate-600">Un seul futur compte devra conserver plusieurs inscriptions.</p></Link>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-600">Plusieurs inscriptions</p><p className="mt-1 text-2xl font-black">{activationMultiEnrollmentRecords.length}</p><p className="mt-1 text-xs text-slate-600">Ne jamais créer un compte par inscription.</p></div>
        </div>
        {activationSchoolCounts.length ? <div className="mt-4 flex flex-wrap gap-2">{activationSchoolCounts.map(([school, count]) => <span key={school} className="rounded-full border border-sky-200 bg-white px-3 py-2 text-xs font-black text-sky-900">{school} · {count}</span>)}</div> : null}
        <p className="mt-4 rounded-xl border border-indigo-200 bg-white p-3 text-xs font-bold text-indigo-900">V4.10.117 : invitations suspendues. Utilisez d’abord le Centre financier étudiant pour fiabiliser montants convenus, paiements, crédits et soldes.</p>
      </div> : null}

      <form method="get" className="mt-5 flex flex-wrap gap-2"><input type="hidden" name="organization" value={organizationId}/><input type="hidden" name="identityStatus" value={identityStatus}/><input type="hidden" name="activation" value={activation}/><input name="q" defaultValue={q} placeholder="Nom, e-mail, téléphone, école…" className="min-w-[280px] flex-1 rounded-xl border border-slate-300 px-4 py-3"/><button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Rechercher</button><Link href={`/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}`} className="rounded-xl bg-slate-100 px-5 py-3 font-black">Tout afficher</Link></form>

      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Personne / CRM</th><th className="p-3">Compte proposé</th><th className="p-3">Academy</th><th className="p-3">Statut</th><th className="p-3">Pourquoi</th><th className="p-3">Action</th></tr></thead><tbody>{visibleIdentityRecords.map((record) => <tr key={record.client.id} className="border-b align-top last:border-0"><td className="p-3"><p className="font-black">{record.client.full_name}</p><p className="mt-1 text-xs text-slate-500">{record.client.email || record.client.phone || record.client.whatsapp_phone || "Coordonnées non renseignées"}</p></td><td className="p-3"><p className="font-bold">{record.profile?.full_name || record.profile?.email || "—"}</p>{record.profile?.email ? <p className="mt-1 text-xs text-slate-500">{record.profile.email}</p> : null}</td><td className="p-3"><p className="font-bold">{record.enrollments.length} inscription(s)</p><p className="mt-1 max-w-[260px] text-xs text-slate-500">{record.schools.length ? record.schools.join(" · ") : "École non déterminée"}</p></td><td className="p-3"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${identityBadge(record.state)}`}>{identityLabel(record.state)}</span></td><td className="p-3"><p className="max-w-[330px] text-xs leading-5 text-slate-600">{record.reason}</p></td><td className="p-3"><div className="flex min-w-[190px] flex-col gap-2"><Link href={`/dashboard/admin/identity-audit/${record.client.id}?organization=${encodeURIComponent(organizationId)}`} className="rounded-lg border bg-white px-3 py-2 text-center text-xs font-black text-indigo-700">Ouvrir Dossier 360°</Link>{record.state === "no_account" ? <>{hasUsableEmail(record.client.email) ? <><p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-black text-emerald-800">✓ E-mail techniquement prêt</p><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-950">Invitation suspendue : valider d’abord le dossier financier étudiant.</div><Link href={`/dashboard/academy/students/finance-control?organization=${encodeURIComponent(organizationId)}&q=${encodeURIComponent(record.client.email || record.client.full_name)}`} className="rounded-lg bg-emerald-700 px-3 py-2 text-center text-xs font-black text-white">Vérifier les paiements</Link></> : <p className="rounded-lg bg-rose-50 px-3 py-2 text-center text-xs font-black text-rose-800">Coordonnées à corriger</p>}</> : null}{identitySchemaReady && record.state === "review" && record.candidateUserId ? <form action={decideIdentityReviewAction} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><input type="hidden" name="crmClientId" value={record.client.id}/><input type="hidden" name="candidateUserId" value={record.candidateUserId}/><input type="hidden" name="returnTo" value={currentReturnTo}/><input name="reason" required minLength={5} defaultValue="Identité vérifiée manuellement par l’administration." className="w-full rounded-lg border bg-white px-2 py-2 text-xs"/><div className="mt-2 grid gap-1"><button name="decision" value="same_person" className="rounded-lg bg-emerald-700 px-2 py-2 text-xs font-black text-white">Même personne</button><button name="decision" value="different_person" className="rounded-lg bg-rose-100 px-2 py-2 text-xs font-black text-rose-800">Personnes différentes</button><button name="decision" value="deferred" className="rounded-lg bg-white px-2 py-2 text-xs font-black text-slate-700">Décider plus tard</button></div></form> : null}</div></td></tr>)}{!visibleIdentityRecords.length ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">Aucune identité Academy/CRM ne correspond à ce filtre.</td></tr> : null}</tbody></table></div>
      {identityTotalPages > 1 ? <nav className="mt-5 flex items-center justify-between gap-3">{identityPage > 1 ? <Link href={identityHref(identityPage - 1)} className="rounded-xl border bg-white px-4 py-2 font-black">← Précédente</Link> : <span/>}<span className="text-sm font-bold text-slate-600">{(identityPage - 1) * identityPageSize + 1}–{Math.min(identityPage * identityPageSize, filteredIdentityRecords.length)} sur {filteredIdentityRecords.length}</span>{identityPage < identityTotalPages ? <Link href={identityHref(identityPage + 1)} className="rounded-xl border bg-white px-4 py-2 font-black">Suivante →</Link> : <span/>}</nav> : null}

      {(!identityStatus || identityStatus === "review") && filteredLegacyReviewCases.length ? <div className="mt-7 border-t border-amber-200 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-amber-700">File historique Academy / CRM intégrée</p><h3 className="mt-1 text-2xl font-black">Cas hérités à valider</h3><p className="mt-2 max-w-3xl text-sm text-slate-600">Ces cas existaient déjà avant V4.10.112. Ils sont regroupés par personne pour éviter de compter plusieurs inscriptions comme plusieurs identités.</p></div><span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-900">{filteredLegacyReviewCases.length} personne(s)</span></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">{filteredLegacyReviewCases.map((reviewCase) => {
          const preferredClientId = reviewCase.coherentClient?.id ?? (reviewCase.selectableClients.length === 1 ? reviewCase.selectableClients[0].id : "");
          const queryValue = reviewCase.profile?.email || reviewCase.profile?.full_name || reviewCase.profile?.phone || "";
          return <article key={reviewCase.userId} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-lg font-black">{reviewCase.profile?.full_name || reviewCase.profile?.email || "Profil utilisateur à compléter"}</h4><p className="mt-1 text-xs font-bold text-slate-600">{reviewCase.profile?.email || reviewCase.profile?.phone || `Utilisateur ${reviewCase.userId.slice(0, 8)}…`}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-900">{reviewCase.reviews.length} ligne(s) historique(s)</span></div>
            <div className="mt-3 space-y-1 text-sm text-amber-950">{reviewCase.reasons.map((reason) => <p key={reason}>• {reason}</p>)}</div>
            {reviewCase.schoolNames.length ? <p className="mt-3 text-xs font-bold text-violet-800">Academy : {reviewCase.schoolNames.join(" · ")}</p> : null}
            {reviewCase.coherentClient ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-900">Lien actuel détecté : {reviewCase.coherentClient.full_name}. La validation ci-dessous peut simplement fermer une ancienne file devenue obsolète.</p> : null}
            {reviewCase.selectableClients.length ? <div className="mt-4">
              {identityQueueSchemaReady ? <form action={resolveLegacyAcademyIdentityReviewAction} className="space-y-3">
                <input type="hidden" name="reviewId" value={reviewCase.representativeReviewId}/><input type="hidden" name="returnTo" value={currentReturnTo}/>
                <select name="clientId" required defaultValue={preferredClientId} className="w-full rounded-xl border bg-white p-3 text-sm"><option value="">Choisir le dossier CRM confirmé…</option>{reviewCase.selectableClients.map((client) => { const blocked = Boolean(client.linked_user_id && client.linked_user_id !== reviewCase.userId); return <option key={client.id} value={client.id} disabled={blocked}>{client.full_name} · {client.email || client.phone || client.whatsapp_phone || "sans contact"}{blocked ? " · déjà lié à un autre compte" : client.id === reviewCase.coherentClient?.id ? " · lien actuel" : ""}</option>; })}</select>
                <input name="reason" required minLength={5} defaultValue="Dossier CRM confirmé après vérification de la file historique Academy/CRM." className="w-full rounded-xl border bg-white px-3 py-2 text-xs"/>
                <button className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">Confirmer ce dossier et synchroniser Academy</button>
              </form> : <p className="rounded-xl bg-white p-3 text-xs font-bold text-amber-900">Migration V4.10.113 requise avant de résoudre ce cas depuis cette page.</p>}
              <div className="mt-3 flex flex-wrap gap-2">{reviewCase.selectableClients.map((client) => <Link key={client.id} href={`/dashboard/admin/identity-audit/${client.id}?organization=${encodeURIComponent(organizationId)}`} className="rounded-lg border bg-white px-3 py-2 text-xs font-black text-indigo-700">Dossier 360° · {client.full_name}</Link>)}</div>
            </div> : <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4"><p className="text-sm font-black text-amber-950">Aucun dossier CRM candidat n’est enregistré dans cette ancienne file.</p><p className="mt-1 text-xs text-slate-600">Complétez d’abord le profil utilisateur ou recherchez la personne dans le centre CRM avant toute liaison.</p><Link href={`/dashboard/crm/identity-sync?q=${encodeURIComponent(queryValue)}`} className="mt-3 inline-flex rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">Rechercher dans CRM</Link></div>}
          </article>;
        })}</div>
      </div> : null}
    </section>

    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Continuité des identités</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[["CRM reliés à un compte", linkedClients.length], ["Employés aussi apprenants", staffLearners.length], ["Personnes dans plusieurs écoles", multiSchool.length], ["Correspondances multi-rôles probables", probableMultiRole.length]].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-600">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>)}
      </div></article>
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Points à vérifier</h2><div className="mt-5 space-y-3">
        {[["Employés sans École des Coachs", staffMissingCoach.length], ["Doublons CRM possibles", duplicateGroups.length], ["Ventes sans dossier CRM", salesUnlinkedResult.count ?? 0], ["Ventes ambiguës", crmReviewResult.count ?? 0], ["Apprenants ambigus", globalReviewCount]].map(([label,value])=><div key={String(label)} className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"><span className="font-bold">{label}</span><span className="font-black text-amber-900">{value}</span></div>)}
      </div></article>
    </section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Inscriptions multi-écoles</h2><p className="mt-2 text-sm text-slate-600">Une personne reste unique tout en conservant plusieurs inscriptions indépendantes.</p></div><p className="text-sm font-black text-violet-800">{filteredMultiSchool.length} résultat(s) · page {page} sur {totalPages}</p></div>
      <form method="get" className="mt-5 flex flex-wrap gap-2"><input type="hidden" name="organization" value={organizationId}/><input name="q" defaultValue={q} placeholder="Nom, email, téléphone, rôle ou école…" className="min-w-[280px] flex-1 rounded-xl border border-slate-300 px-4 py-3"/><button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Rechercher</button>{q?<Link href={auditHref(1).replace(`q=${encodeURIComponent(q)}`,"q=")} className="rounded-xl bg-slate-100 px-5 py-3 font-black">Effacer</Link>:null}</form>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{visibleMultiSchool.map((record)=><article key={record.key} className="rounded-2xl border border-violet-100 bg-violet-50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-black">{record.name}</h3><span className={`rounded-full px-3 py-1 text-xs font-black ${record.status==="Identité confirmée"?"bg-emerald-200 text-emerald-950":record.status==="Identité reliée"?"bg-emerald-100 text-emerald-800":"bg-amber-100 text-amber-900"}`}>{record.status}</span></div><div className="mt-2 flex flex-wrap gap-2">{record.roles.map((role)=><span key={role} className="rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-800">{role}</span>)}</div><p className="mt-3 text-sm font-bold text-slate-700">Email(s) : {record.emails.length?record.emails.join(" · "):"Non renseigné"}</p><p className="mt-1 text-sm text-violet-900">{record.schoolNames.join(" · ")}</p>{record.association?<form action={revokePersonIdentityAssociationAction} className="mt-4 rounded-xl border border-emerald-200 bg-white p-3"><input type="hidden" name="associationId" value={record.association.id}/><input type="hidden" name="returnTo" value={auditHref(page)}/><input name="reason" required minLength={5} defaultValue="Association administrative annulée après vérification." className="w-full rounded-lg border px-3 py-2 text-sm"/><button className="mt-2 text-sm font-black text-rose-700">Annuler l’association administrative</button></form>:!associationSchemaMissing&&record.primaryClient&&record.staffCandidates.length?<div className="mt-4 space-y-2">{record.staffCandidates.map((candidate)=><form key={candidate.userId} action={confirmPersonIdentityAssociationAction} className="rounded-xl border border-amber-200 bg-white p-3"><input type="hidden" name="primaryUserId" value={candidate.userId}/><input type="hidden" name="crmClientId" value={record.primaryClient?.id}/><input type="hidden" name="returnTo" value={auditHref(page)}/><p className="text-sm font-bold">Compte staff proposé : {candidate.name} · {candidate.email}</p><input name="reason" required minLength={5} defaultValue="Même personne vérifiée à partir des dossiers staff et apprenant." className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"/><button className="mt-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-black">Confirmer qu’il s’agit de la même personne</button></form>)}</div>:null}</article>)}{!visibleMultiSchool.length?<p className="rounded-2xl bg-slate-50 p-4 text-slate-600">Aucune identité multi-écoles ne correspond à cette recherche.</p>:null}</div>
      {totalPages>1?<nav className="mt-5 flex items-center justify-between gap-3">{page>1?<Link href={auditHref(page-1)} className="rounded-xl border bg-white px-4 py-2 font-black">← Précédente</Link>:<span/>}<span className="text-sm font-bold text-slate-600">{(page-1)*pageSize+1}–{Math.min(page*pageSize,filteredMultiSchool.length)} sur {filteredMultiSchool.length}</span>{page<totalPages?<Link href={auditHref(page+1)} className="rounded-xl border bg-white px-4 py-2 font-black">Suivante →</Link>:<span/>}</nav>:null}
    </section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">Visibilité administrative et capacité</h2><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">Domaine</th><th className="p-3">Portée propriétaire/admin</th><th className="p-3">Risque identifié</th></tr></thead><tbody>{[
      ["CRM", "Organisation complète", clients.length >= 1000 ? "Certaines listes historiques sont plafonnées à 1 000" : "Aucun plafond atteint dans cet audit"],
      ["Academy", "Toutes les écoles", clients.length > 500 ? "Certains sélecteurs historiques sont plafonnés à 500 clients" : "Aucun plafond atteint dans cet audit"],
      ["Finance", "Organisation complète", "Les ventes sans lien CRM restent séparées"],
      ["Ambassadeurs", "Gestion complète", "Identité séparée; rapprochement seulement probable par contact"],
    ].map((row)=><tr key={row[0]} className="border-b last:border-0"><td className="p-3 font-black">{row[0]}</td><td className="p-3 text-emerald-800">{row[1]}</td><td className="p-3 text-amber-900">{row[2]}</td></tr>)}</tbody></table></div></section>
    <p className="mt-6 rounded-2xl bg-slate-900 p-5 text-sm font-bold text-white">V4.10.117 conserve la règle centrale : une personne, un dossier CRM pivot et plusieurs inscriptions possibles. La priorité opérationnelle est maintenant la fiabilisation des paiements et soldes; les nouvelles invitations restent suspendues jusqu’à validation financière.</p>
  </div></main>;
}
