import Link from "next/link";
import { redirect } from "next/navigation";
import {
  assignMemberToTeamAction,
  cancelInvitationAction,
  removeMemberFromTeamAction,
  resendInvitationAction,
  toggleMemberStatusAction,
  updateMemberRoleAction,
} from "@/app/actions/members";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ManualAccessControls } from "@/components/members/manual-access-controls";

type SearchParams = Promise<{ success?: string; error?: string }>;

type Profile = { full_name: string | null; email: string | null };
type Membership = {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  profiles: Profile | Profile[] | null;
};
type Team = { id: string; name: string; department: string | null };
type Assignment = { team_id: string; user_id: string; teams: Team | Team[] | null };
type Invitation = { id: string; email: string; role: string; status: string; expires_at: string; created_at: string };

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const roleLabels: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  hr: "Responsable RH",
  manager: "Manager",
  employee: "Employé",
};

export default async function MembersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

const admin = createAdminClient();

const { data: currentMembership, error: membershipError } = await admin
  .from("organization_members")
  .select("organization_id, role, is_active, organizations(name)")
  .eq("user_id", authData.user.id)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();

if (membershipError) {
  throw new Error(
    `Impossible de charger l’appartenance à l’organisation : ${membershipError.message}`,
  );
}

if (!currentMembership) {
  redirect("/dashboard/company");
}
  const organizationId = currentMembership.organization_id;
  const [membersResult, teamsResult, assignmentsResult, invitationsResult] = await Promise.all([
    admin
      .from("organization_members")
      .select("id,user_id,role,is_active,profiles(full_name,email)")
      .eq("organization_id", organizationId)
      .order("created_at"),
    admin.from("teams").select("id,name,department").eq("organization_id", organizationId).order("name"),
    admin
      .from("team_members")
      .select("team_id,user_id,teams(id,name,department)")
      .in("team_id", (await admin.from("teams").select("id").eq("organization_id", organizationId)).data?.map((t) => t.id) ?? []),
    admin
      .from("organization_invitations")
      .select("id,email,role,status,expires_at,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
  ]);

  const members = (membersResult.data ?? []) as unknown as Membership[];
  const teams = (teamsResult.data ?? []) as Team[];
  const assignments = (assignmentsResult.data ?? []) as unknown as Assignment[];
  const invitations = (invitationsResult.data ?? []) as Invitation[];
  const canManagePeople = ["owner", "admin", "hr"].includes(currentMembership.role);
  const canManageTeams = ["owner", "admin", "hr", "manager"].includes(currentMembership.role);
  const rawOrg = currentMembership.organizations as { name?: string } | { name?: string }[] | null;
  const organizationName = one(rawOrg)?.name ?? "Organisation";

  const assignmentsByUser = new Map<string, Team[]>();
  assignments.forEach((assignment) => {
    const team = one(assignment.teams);
    if (!team) return;
    const current = assignmentsByUser.get(assignment.user_id) ?? [];
    current.push(team);
    assignmentsByUser.set(assignment.user_id, current);
  });

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link className="font-bold text-indigo-700" href="/dashboard">← Tableau de bord</Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-bold text-amber-400">ÉQUIPE · {organizationName}</p>
          <h1 className="mt-2 text-3xl font-black">Membres & affectations</h1>
          <p className="mt-2 text-slate-300">Gère les rôles, les statuts et l’affectation des collaborateurs aux équipes.</p>
        </header>

        {params.success && <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">{params.success}</p>}
        {params.error && <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{params.error}</p>}

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-2xl font-black">Collaborateurs ({members.length})</h2><p className="text-sm text-slate-500">Les comptes désactivés restent dans l’historique.</p></div>
            <Link href="/dashboard/company" className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white">Inviter un collègue</Link>
          </div>

          <div className="mt-5 grid gap-4">
            {members.map((member) => {
              const profile = one(member.profiles);
              const memberTeams = assignmentsByUser.get(member.user_id) ?? [];
              return (
                <article key={member.id} className={`rounded-2xl border p-5 ${member.is_active ? "border-slate-200" : "border-red-200 bg-red-50/40"}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">{profile?.full_name || "Utilisateur"}</h3>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${member.is_active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{member.is_active ? "Actif" : "Désactivé"}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{profile?.email || "Email indisponible"}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {memberTeams.length ? memberTeams.map((team) => (
                          <form key={team.id} action={removeMemberFromTeamAction} className="inline-flex">
                            <input type="hidden" name="userId" value={member.user_id} />
                            <input type="hidden" name="teamId" value={team.id} />
                            <button disabled={!canManageTeams} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 disabled:cursor-not-allowed disabled:opacity-60" title="Cliquer pour retirer de l’équipe">{team.name} ×</button>
                          </form>
                        )) : <span className="text-sm text-slate-400">Aucune équipe</span>}
                      </div>
                    </div>

                    <div className="grid w-full gap-3 md:grid-cols-3 xl:max-w-3xl">
                      <form action={updateMemberRoleAction} className="flex gap-2">
                        <input type="hidden" name="memberId" value={member.id} />
                        <select name="role" defaultValue={member.role} disabled={!canManagePeople || member.role === "owner"} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100">
                          {member.role === "owner" && <option value="owner">Propriétaire</option>}
                          <option value="admin">Administrateur</option><option value="hr">Responsable RH</option><option value="manager">Manager</option><option value="employee">Employé</option>
                        </select>
                        <button disabled={!canManagePeople || member.role === "owner"} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">Modifier</button>
                      </form>

                      <form action={assignMemberToTeamAction} className="flex gap-2">
                        <input type="hidden" name="userId" value={member.user_id} />
                        <select name="teamId" required disabled={!canManageTeams || !member.is_active} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100">
                          <option value="">Choisir une équipe</option>
                          {teams.filter((team) => !memberTeams.some((assigned) => assigned.id === team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                        <button disabled={!canManageTeams || !member.is_active} className="rounded-xl bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">Affecter</button>
                      </form>

                      <form action={toggleMemberStatusAction}>
                        <input type="hidden" name="memberId" value={member.id} />
                        <input type="hidden" name="activate" value={String(!member.is_active)} />
                        <button disabled={!canManagePeople || member.role === "owner" || member.user_id === authData.user.id} className={`w-full rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-40 ${member.is_active ? "bg-red-600" : "bg-emerald-700"}`}>{member.is_active ? "Désactiver" : "Réactiver"}</button>
                      </form>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Rôle actuel : {roleLabels[member.role] ?? member.role}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Invitations</h2>
          <p className="mt-1 text-sm text-slate-500">Renvoyer génère un nouvel email. L’activation de secours crée le collaborateur et fournit un lien à transmettre directement.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b text-slate-500"><th className="p-3">Email</th><th className="p-3">Rôle</th><th className="p-3">Statut</th><th className="p-3">Expiration</th><th className="p-3">Action</th></tr></thead>
              <tbody>{invitations.length ? invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-slate-100">
                  <td className="p-3 font-semibold">{invitation.email}</td><td className="p-3">{roleLabels[invitation.role] ?? invitation.role}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase">{invitation.status}</span></td><td className="p-3">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(invitation.expires_at))}</td>
                  <td className="p-3 align-top">
                    {(["pending", "expired"].includes(invitation.status) && canManagePeople) ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <form action={resendInvitationAction}>
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <button className="font-bold text-indigo-700">Renvoyer</button>
                        </form>
                        {invitation.status === "pending" && (
                          <form action={cancelInvitationAction}>
                            <input type="hidden" name="invitationId" value={invitation.id} />
                            <button className="font-bold text-red-600">Annuler</button>
                          </form>
                        )}
                      </div>
                    ) : invitation.status === "accepted" ? (
                      <span className="text-xs font-semibold text-emerald-700">Compte activé</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}

                    <ManualAccessControls
                      invitationId={invitation.id}
                      email={invitation.email}
                      status={invitation.status}
                      canManage={canManagePeople}
                    />
                  </td>
                </tr>
              )) : <tr><td className="p-4 text-slate-500" colSpan={5}>Aucune invitation.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
