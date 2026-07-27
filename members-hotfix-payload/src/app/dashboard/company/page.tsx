"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  createOrganizationAction,
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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [createState, createAction, createPending] = useActionState(
    createOrganizationAction,
    initialState,
  );
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
        .select("organization_id, organizations(id,name,sector)")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

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

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <Link className="font-bold text-indigo-700" href="/dashboard">
          ← {t("common.backToDashboard")}
        </Link>

        {!organization ? (
          <section className="mt-5 rounded-3xl bg-white p-7 shadow-sm">
            <h1 className="text-3xl font-black">{t("company.createTitle")}</h1>
            <form action={createAction} className="mt-6 grid gap-4">
              <label className="grid gap-2 font-semibold">
                {t("company.companyName")}
                <input
                  name="name"
                  required
                  className="rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>
              <label className="grid gap-2 font-semibold">
                {t("company.sector")}
                <input
                  name="sector"
                  className="rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>
              {createState.error && (
                <p className="text-red-600">{createState.error}</p>
              )}
              <button
                disabled={createPending}
                className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"
              >
                {createPending
                  ? t("company.creating")
                  : t("company.createWorkspace")}
              </button>
            </form>
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

            <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
              <form action={inviteAction} className="rounded-3xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black">{t("company.inviteColleague")}</h2>
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
                    <option value="hr">{t("roles.hr")}</option>
                    <option value="admin">{t("roles.admin")}</option>
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
