"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createTeamAction, type CompanyState } from "@/app/actions/company";
import { createClient } from "@/lib/supabase/client";

const initialState: CompanyState = {};
type Team = { id: string; name: string; department: string | null };

export default function TeamPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [state, action, pending] = useActionState(createTeamAction, initialState);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", userData.user.id).limit(1).maybeSingle();
      if (!membership?.organization_id) return;
      setOrganizationId(membership.organization_id);
      const { data } = await supabase.from("teams").select("id,name,department").eq("organization_id", membership.organization_id).order("name");
      setTeams(data ?? []);
    };
    void load();
  }, [state.success]);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <Link className="font-bold text-indigo-700" href="/dashboard">← Tableau de bord</Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white"><p className="text-sm font-bold text-amber-400">STRUCTURE</p><h1 className="mt-2 text-3xl font-black">Départements & équipes</h1></header>
        {!organizationId ? <p className="mt-6 rounded-2xl bg-amber-50 p-5">Crée d’abord ton entreprise.</p> : (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <form action={action} className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Nouvelle équipe</h2>
              <input type="hidden" name="organizationId" value={organizationId} />
              <label className="mt-4 grid gap-2 font-semibold">Nom<input name="name" required className="rounded-xl border border-slate-300 px-4 py-3" /></label>
              <label className="mt-4 grid gap-2 font-semibold">Département<input name="department" placeholder="Ex. Marketing" className="rounded-xl border border-slate-300 px-4 py-3" /></label>
              {state.error && <p className="mt-3 text-red-600">{state.error}</p>}
              {state.success && <p className="mt-3 text-green-700">{state.success}</p>}
              <button disabled={pending} className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 font-bold text-white">{pending ? "Création…" : "Créer l’équipe"}</button>
            </form>
            <section className="rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-black">Équipes ({teams.length})</h2><div className="mt-4 grid gap-3">{teams.map((team) => <article key={team.id} className="rounded-2xl border border-slate-200 p-4"><p className="font-black">{team.name}</p><p className="text-sm text-slate-500">{team.department || "Sans département"}</p></article>)}</div></section>
          </section>
        )}
      </div>
    </main>
  );
}
