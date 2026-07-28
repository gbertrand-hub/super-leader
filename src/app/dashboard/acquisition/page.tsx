import Link from "next/link";
import { redirect } from "next/navigation";
import {
  convertDemoRequestAction,
  updateDemoRequestAction,
  updateInternalAccessRequestAction,
} from "@/app/actions/acquisition";
import { InternalAccessApprovalForm } from "@/components/acquisition/internal-access-approval-form";
import { getI18n } from "@/i18n/server";
import { isPlatformOrganization } from "@/lib/acquisition/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type DemoRequest = {
  id: string;
  requester_user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  organization_name: string;
  country: string;
  sector: string | null;
  employee_count_range: string | null;
  needs: string;
  interested_modules: string[] | null;
  preferred_demo_date: string | null;
  status: string;
  assigned_to: string | null;
  scheduled_demo_at: string | null;
  sales_notes: string | null;
  converted_organization_id: string | null;
  created_at: string;
};

type InternalRequest = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  entity_name: string;
  department: string | null;
  position_title: string;
  supervisor_name: string | null;
  requested_team: string | null;
  employee_reference: string | null;
  reason: string;
  status: string;
  assigned_role: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const demoStatuses = [
  "new",
  "contact_pending",
  "demo_scheduled",
  "demo_completed",
  "trial_approved",
  "client_active",
  "rejected",
  "archived",
];

const demoLabelsFr: Record<string, string> = {
  new: "Nouvelle demande",
  contact_pending: "À contacter",
  demo_scheduled: "Démo programmée",
  demo_completed: "Démo effectuée",
  trial_approved: "Essai approuvé",
  client_active: "Client actif",
  rejected: "Refusée",
  archived: "Archivée",
};

const demoLabelsEn: Record<string, string> = {
  new: "New request",
  contact_pending: "To contact",
  demo_scheduled: "Demo scheduled",
  demo_completed: "Demo completed",
  trial_approved: "Trial approved",
  client_active: "Active client",
  rejected: "Rejected",
  archived: "Archived",
};

const internalLabelsFr: Record<string, string> = {
  pending: "En attente",
  reviewing: "En vérification",
  approved: "Approuvée",
  rejected: "Refusée",
  cancelled: "Annulée",
};

const internalLabelsEn: Record<string, string> = {
  pending: "Pending",
  reviewing: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

export default async function AcquisitionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale } = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active,organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const rawOrg = membership?.organizations as { name?: string | null } | { name?: string | null }[] | null | undefined;
  const org = Array.isArray(rawOrg) ? rawOrg[0] ?? null : rawOrg;
  const role = String(membership?.role ?? "");
  if (
    !membership ||
    !["owner", "admin", "hr"].includes(role) ||
    !isPlatformOrganization({ organizationId: String(membership.organization_id), organizationName: org?.name ?? null })
  ) {
    redirect("/dashboard");
  }

  const canManageDemo = ["owner", "admin"].includes(role);
  let view = one(params.view) === "internal" ? "internal" : "demo";
  if (!canManageDemo) view = "internal";
  const statusFilter = one(params.status);
  const success = one(params.success);
  const error = one(params.error);

  let demos: DemoRequest[] = [];
  if (canManageDemo) {
    let query = admin
      .from("demo_requests")
      .select("id,requester_user_id,full_name,email,phone,whatsapp,organization_name,country,sector,employee_count_range,needs,interested_modules,preferred_demo_date,status,assigned_to,scheduled_demo_at,sales_notes,converted_organization_id,created_at")
      .order("created_at", { ascending: false })
      .limit(150);
    if (view === "demo" && statusFilter && demoStatuses.includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }
    const { data, error: loadError } = await query;
    if (loadError) throw new Error(loadError.message);
    demos = (data ?? []) as DemoRequest[];
  }

  let internalQuery = admin
    .from("internal_access_requests")
    .select("id,full_name,email,phone,entity_name,department,position_title,supervisor_name,requested_team,employee_reference,reason,status,assigned_role,review_note,reviewed_at,created_at")
    .order("created_at", { ascending: false })
    .limit(150);
  if (view === "internal" && statusFilter && ["pending", "reviewing", "approved", "rejected", "cancelled"].includes(statusFilter)) {
    internalQuery = internalQuery.eq("status", statusFilter);
  }
  const { data: internalData, error: internalError } = await internalQuery;
  if (internalError) throw new Error(internalError.message);
  const internalRequests = (internalData ?? []) as InternalRequest[];

  const [{ data: memberRows }, { data: teams }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .in("role", ["owner", "admin", "hr", "manager"]),
    admin
      .from("teams")
      .select("id,name,department")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name"),
  ]);
  const memberIds = (memberRows ?? []).map((row) => String(row.user_id));
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", memberIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profilesById = new Map(
    (profiles ?? []).map((profile) => [String(profile.id), profile]),
  );
  const reviewers = (memberRows ?? []).map((member) => {
    const profile = profilesById.get(String(member.user_id));
    return {
      id: String(member.user_id),
      role: String(member.role),
      label: `${profile?.full_name || profile?.email || "Utilisateur"} · ${member.role}`,
    };
  });
  const teamOptions = (teams ?? []).map((team) => ({
    id: String(team.id),
    label: team.department ? `${team.name} · ${team.department}` : String(team.name),
  }));

  const demoLabels = fr ? demoLabelsFr : demoLabelsEn;
  const internalLabels = fr ? internalLabelsFr : internalLabelsEn;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard" className="font-bold text-indigo-700">← {fr ? "Retour au tableau de bord" : "Back to dashboard"}</Link>
        <header className="mt-5 rounded-[2rem] bg-slate-950 p-7 text-white">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-400">SUPER LEADER V2.4</p>
          <h1 className="mt-3 text-3xl font-black sm:text-5xl">{fr ? "Acquisition SaaS & demandes d’accès" : "SaaS acquisition & access requests"}</h1>
          <p className="mt-3 max-w-4xl text-slate-300">
            {fr
              ? "Gère séparément les organisations intéressées par Super Leader et les collaborateurs demandant l’accès à l’espace interne iLEAD Global."
              : "Manage organizations interested in Super Leader separately from staff requesting access to the internal iLEAD Global workspace."}
          </p>
        </header>

        {success ? <p className="mt-5 rounded-2xl bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</p> : null}
        {error ? <p className="mt-5 rounded-2xl bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p> : null}

        <nav className="mt-6 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {canManageDemo ? (
            <Link href="/dashboard/acquisition?view=demo" className={`rounded-xl px-5 py-3 font-black ${view === "demo" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              {fr ? "Prospects & démonstrations" : "Prospects & demos"} ({demos.length})
            </Link>
          ) : null}
          <Link href="/dashboard/acquisition?view=internal" className={`rounded-xl px-5 py-3 font-black ${view === "internal" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
            {fr ? "Demandes d’accès iLEAD" : "iLEAD access requests"} ({internalRequests.length})
          </Link>
        </nav>

        {view === "demo" && canManageDemo ? (
          <section className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-black">{fr ? "Pipeline des demandes de démonstration" : "Demo request pipeline"}</h2>
              <form className="flex gap-2">
                <input type="hidden" name="view" value="demo" />
                <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <option value="">{fr ? "Tous les statuts" : "All statuses"}</option>
                  {demoStatuses.map((status) => <option key={status} value={status}>{demoLabels[status]}</option>)}
                </select>
                <button className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">{fr ? "Filtrer" : "Filter"}</button>
              </form>
            </div>
            <div className="space-y-5">
              {demos.length ? demos.map((request) => (
                <article key={request.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-black">{request.organization_name}</h3>
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">{demoLabels[request.status]}</span>
                      </div>
                      <p className="mt-2 font-bold">{request.full_name} · {request.email}</p>
                      <p className="mt-1 text-sm text-slate-500">{request.country} · {request.sector || "—"} · {request.employee_count_range || "—"} {fr ? "employés" : "employees"}</p>
                      <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.needs}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(request.interested_modules ?? []).map((module) => <span key={module} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{module}</span>)}
                      </div>
                    </div>
                    <div className="text-sm text-slate-500 lg:text-right">
                      <p>{fr ? "Reçue" : "Received"}: {formatDate(request.created_at, locale)}</p>
                      <p>{fr ? "Date souhaitée" : "Preferred date"}: {formatDate(request.preferred_demo_date, locale)}</p>
                      <p>{fr ? "Téléphone" : "Phone"}: {request.phone || request.whatsapp || "—"}</p>
                    </div>
                  </div>

                  <form action={updateDemoRequestAction} className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 lg:grid-cols-4">
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="view" value="demo" />
                    <label className="grid gap-2 text-sm font-bold">
                      {fr ? "Statut" : "Status"}
                      <select name="status" defaultValue={request.status} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
                        {demoStatuses.map((status) => <option key={status} value={status}>{demoLabels[status]}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm font-bold">
                      {fr ? "Responsable commercial" : "Sales owner"}
                      <select name="assignedTo" defaultValue={request.assigned_to ?? ""} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
                        <option value="">{fr ? "Non affecté" : "Unassigned"}</option>
                        {reviewers.filter((reviewer) => ["owner", "admin"].includes(reviewer.role)).map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.label}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm font-bold">
                      {fr ? "Démonstration prévue" : "Scheduled demo"}
                      <input name="scheduledDemoAt" type="datetime-local" defaultValue={request.scheduled_demo_at?.slice(0, 16) ?? ""} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
                    </label>
                    <label className="grid gap-2 text-sm font-bold lg:col-span-4">
                      {fr ? "Notes commerciales" : "Sales notes"}
                      <textarea name="salesNotes" rows={3} defaultValue={request.sales_notes ?? ""} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
                    </label>
                    <button className="rounded-xl bg-indigo-600 px-4 py-3 font-black text-white lg:col-span-2">{fr ? "Enregistrer le suivi" : "Save follow-up"}</button>
                  </form>

                  {request.converted_organization_id ? (
                    <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{fr ? "Organisation cliente déjà activée." : "Client organization already activated."}</p>
                  ) : ["demo_completed", "trial_approved"].includes(request.status) ? (
                    <form action={convertDemoRequestAction} className="mt-4">
                      <input type="hidden" name="requestId" value={request.id} />
                      <button className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 font-black text-emerald-800">
                        {fr ? "Convertir en organisation cliente" : "Convert to client organization"}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-4 text-sm font-semibold text-slate-500">
                      {fr ? "La conversion sera disponible après la démonstration ou l’approbation de l’essai." : "Conversion becomes available after the demo or trial approval."}
                    </p>
                  )}
                </article>
              )) : <p className="rounded-3xl bg-white p-10 text-center text-slate-500">{fr ? "Aucune demande dans ce filtre." : "No requests in this filter."}</p>}
            </div>
          </section>
        ) : (
          <section className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-black">{fr ? "Demandes d’accès à iLEAD Global" : "iLEAD Global access requests"}</h2>
              <form className="flex gap-2">
                <input type="hidden" name="view" value="internal" />
                <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <option value="">{fr ? "Tous les statuts" : "All statuses"}</option>
                  {Object.entries(internalLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                </select>
                <button className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">{fr ? "Filtrer" : "Filter"}</button>
              </form>
            </div>
            <div className="space-y-5">
              {internalRequests.length ? internalRequests.map((request) => (
                <article key={request.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-black">{request.full_name}</h3>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">{internalLabels[request.status]}</span>
                      </div>
                      <p className="mt-2 font-bold">{request.position_title} · {request.entity_name}</p>
                      <p className="mt-1 text-sm text-slate-500">{request.email} · {request.phone || "—"}</p>
                      <p className="mt-1 text-sm text-slate-500">{fr ? "Département" : "Department"}: {request.department || "—"} · {fr ? "Équipe souhaitée" : "Requested team"}: {request.requested_team || "—"}</p>
                      <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.reason}</p>
                      {request.supervisor_name ? <p className="mt-3 text-sm"><strong>{fr ? "Responsable indiqué" : "Named supervisor"}:</strong> {request.supervisor_name}</p> : null}
                    </div>
                    <div className="text-sm text-slate-500 lg:text-right">
                      <p>{fr ? "Reçue" : "Received"}: {formatDate(request.created_at, locale)}</p>
                      <p>{fr ? "Matricule" : "Reference"}: {request.employee_reference || "—"}</p>
                      {request.assigned_role ? <p>{fr ? "Rôle attribué" : "Assigned role"}: {request.assigned_role}</p> : null}
                    </div>
                  </div>

                  {["pending", "reviewing"].includes(request.status) ? (
                    <>
                      <form action={updateInternalAccessRequestAction} className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-5 sm:grid-cols-[180px_1fr_auto]">
                        <input type="hidden" name="requestId" value={request.id} />
                        <select name="status" defaultValue={request.status === "rejected" ? "rejected" : "reviewing"} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
                          <option value="pending">{internalLabels.pending}</option>
                          <option value="reviewing">{internalLabels.reviewing}</option>
                          <option value="rejected">{internalLabels.rejected}</option>
                          <option value="cancelled">{internalLabels.cancelled}</option>
                        </select>
                        <input name="reviewNote" defaultValue={request.review_note ?? ""} placeholder={fr ? "Note ou motif de refus" : "Note or rejection reason"} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
                        <button className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white">{fr ? "Mettre à jour" : "Update"}</button>
                      </form>
                      <InternalAccessApprovalForm
                        requestId={request.id}
                        teams={teamOptions}
                        supervisors={reviewers.map((reviewer) => ({ id: reviewer.id, label: reviewer.label }))}
                        allowedRoles={role === "hr" ? ["employee", "manager"] : ["employee", "manager", "hr", "admin"]}
                      />
                    </>
                  ) : request.status === "approved" ? (
                    <p className="mt-5 rounded-2xl bg-emerald-50 px-5 py-4 font-bold text-emerald-800">
                      {fr ? "Accès approuvé et compte activé." : "Access approved and account activated."}
                    </p>
                  ) : (
                    <p className="mt-5 rounded-2xl bg-slate-100 px-5 py-4 font-bold text-slate-700">
                      {fr ? `Demande clôturée : ${internalLabels[request.status]}.` : `Request closed: ${internalLabels[request.status]}.`}
                    </p>
                  )}
                </article>
              )) : <p className="rounded-3xl bg-white p-10 text-center text-slate-500">{fr ? "Aucune demande dans ce filtre." : "No requests in this filter."}</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
