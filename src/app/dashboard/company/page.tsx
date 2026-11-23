"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  inviteMemberAction,
  type CompanyState,
} from "@/app/actions/company";
import { useI18n } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";

const initialState: CompanyState = {};

type Organization = { id: string; name: string; sector: string | null };
type MemberRow = {
  id: string;
  user_id: string;
  role: string;
};
type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};
type Member = MemberRow & {
  profiles: Omit<ProfileRow, "id"> | null;
};

export default function CompanyPage() {
  const { t } = useI18n();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [currentRole, setCurrentRole] = useState("employee");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteMemberAction,
    initialState,
  );

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return setLoading(false);

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id, role, organizations(id,name,sector)")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      setCurrentRole(String(membership?.role ?? "employee"));
      const rawOrg = membership?.organizations;
      const org = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg;

      if (org) {
        setOrganization(org as Organization);
        const { data: memberRows, error: memberError } = await supabase
          .from("organization_members")
          .select("id,user_id,role")
          .eq("organization_id", org.id)
          .order("created_at");

        if (memberError) {
          console.error("Unable to load organization members", memberError);
          setMembers([]);
        } else {
          const rows = (memberRows ?? []) as MemberRow[];
          const userIds = rows.map((member) => member.user_id);
          const { data: profileRows, error: profileError } = userIds.length
            ? await supabase
                .from("profiles")
                .select("id,full_name,email")
                .in("id", userIds)
            : { data: [] as ProfileRow[], error: null };

          if (profileError) {
            console.error("Unable to load member profiles", profileError);
          }

          const profilesById = new Map(
            ((profileRows ?? []) as ProfileRow[]).map((profile) => [
              profile.id,
              { full_name: profile.full_name, email: profile.email },
            ]),
          );

          setMembers(
            rows.map((member): Member => ({
              ...member,
              profiles: profilesById.get(member.user_id) ?? null,
            })),
          );
        }
      }

      setLoading(false);
    };

    void load();
  }, [inviteState.success]);

  if (loading) return <main className="p-8">{t("common.loading")}</main>;

  const canReviewIleadAccessRequests =
    Boolean(organization) &&
    organization?.name.trim().toLowerCase() === "ilead global" &&
    ["owner", "admin", "hr"].includes(currentRole);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <Link className="font-bold text-indigo-700" href="/dashboard">
          ← {t("common.backToDashboard")}
        </Link>

        {!organization ? (
          <section className="mt-5 rounded-3xl border border-indigo-200 bg-indigo-50 p-7 shadow-sm">
            <h1 className="text-3xl font-black">Activation contrôlée</h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-700">
              Un espace organisationnel n’est plus créé librement depuis cette page. Les organisations externes passent par la demande de démonstration, puis l’équipe Super Leader active leur espace. Les collaborateurs iLEAD utilisent la demande d’accès interne.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/" className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">Retour au site</Link>
              <Link href="/ilead-access" className="rounded-xl border border-indigo-300 bg-white px-5 py-3 font-bold text-indigo-800">Demander l’accès iLEAD</Link>
            </div>
          </section>
        ) : (
          <>
            <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
              <p className="text-sm font-bold uppercase text-amber-400">
                {t("company.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">{organization.name}</h1>
              <p className="mt-1 text-slate-300">
                {organization.sector || t("company.noSector")}
              </p>
            </header>

            {canReviewIleadAccessRequests ? (
              <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Accès iLEAD</p>
                    <h2 className="mt-1 text-xl font-black">Demandes d’accès reçues</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                      Consulte les collaborateurs qui ont demandé l’accès à Super Leader pour iLEAD Global, puis vérifie, approuve ou refuse leur demande et attribue leur rôle.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/acquisition?view=internal&organization=${encodeURIComponent(organization.id)}`}
                      className="rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white hover:bg-indigo-800"
                    >
                      Voir les demandes d’accès iLEAD →
                    </Link>
                    <Link
                      href="/ilead-access"
                      target="_blank"
                      className="rounded-xl border border-indigo-300 bg-white px-5 py-3 text-sm font-black text-indigo-800 hover:bg-indigo-100"
                    >
                      Ouvrir le formulaire public
                    </Link>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
              <form action={inviteAction} className="rounded-3xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">{t("company.inviteColleague")}</h2>
                {canReviewIleadAccessRequests ? (
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Ici tu invites directement un collègue. Pour les demandes initiées par les collaborateurs via le formulaire d’accès, utilise le bouton « Voir les demandes d’accès iLEAD » ci-dessus.
                  </p>
                ) : null}
                <input type="hidden" name="organizationId" value={organization.id} />
                <label className="mt-4 grid gap-2 font-semibold">
                  {t("common.email")}
                  <input
                    name="email"
                    type="email"
                    required
                    className="rounded-xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="mt-4 grid gap-2 font-semibold">
                  {t("common.role")}
                  <select
                    name="role"
                    className="rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="employee">{t("roles.employee")}</option>
                    <option value="manager">{t("roles.manager")}</option>
                    {currentRole !== "hr" ? <option value="executive">{t("roles.executive")}</option> : null}
                    {currentRole !== "hr" ? <option value="hr">{t("roles.hr")}</option> : null}
                    {currentRole !== "hr" ? <option value="admin">{t("roles.admin")}</option> : null}
                  </select>
                </label>
                {inviteState.error && (
                  <p className="mt-3 text-sm text-red-600">{inviteState.error}</p>
                )}
                {inviteState.success && (
                  <p className="mt-3 text-sm text-green-700">{inviteState.success}</p>
                )}
                <button
                  disabled={invitePending}
                  className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 font-bold text-white"
                >
                  {invitePending ? t("company.sending") : t("company.sendInvitation")}
                </button>
              </form>

              <section className="rounded-3xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">
                  {t("company.members", { count: members.length })}
                </h2>
                <div className="mt-4 divide-y divide-slate-200">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-4 py-4"
                    >
                      <div>
                        <p className="font-bold">
                          {member.profiles?.full_name || t("common.user")}
                        </p>
                        <p className="text-sm text-slate-500">
                          {member.profiles?.email}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase">
                        {t(`roles.${member.role}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
