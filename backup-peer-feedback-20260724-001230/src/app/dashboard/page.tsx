import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const fullName = data.user.user_metadata?.full_name ?? "Leader";
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, sector)")
    .eq("user_id", data.user.id);

  const membership = memberships?.[0];
  const rawOrganization = membership?.organizations;
  const organization = Array.isArray(rawOrganization) ? rawOrganization[0] : rawOrganization;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-amber-400">★ SUPER LEADER</p>
            <h1 className="mt-2 text-3xl font-extrabold">Bonjour, {fullName}</h1>
            <p className="mt-1 text-slate-300">
              {organization ? `${organization.name} · ${membership?.role}` : "Crée ton entreprise pour commencer."}
            </p>
          </div>
          <form action={signOutAction}>
            <button className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 hover:bg-slate-100" type="submit">
              Se déconnecter
            </button>
          </form>
        </header>

        {!organization ? (
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <p className="text-sm font-bold uppercase tracking-wide text-amber-700">Configuration initiale</p>
            <h2 className="mt-2 text-2xl font-black">Crée ton espace entreprise</h2>
            <p className="mt-2 max-w-2xl text-slate-600">Ajoute l’entreprise, puis invite les collègues et organise les équipes.</p>
            <Link className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-bold text-white" href="/dashboard/company">
              Configurer l’entreprise
            </Link>
          </section>
        ) : (
          <nav className="mt-6 grid gap-4 md:grid-cols-3">
            <Link href="/dashboard/company" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">Entreprise & membres</p>
              <p className="mt-2 text-sm text-slate-600">Profil, invitations, rôles et membres.</p>
            </Link>
            <Link href="/dashboard/team" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">Départements & équipes</p>
              <p className="mt-2 text-sm text-slate-600">Crée et consulte la structure organisationnelle.</p>
            </Link>
            <Link href="/dashboard/members" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">Membres & affectations</p>
              <p className="mt-2 text-sm text-slate-600">Rôles, statuts, invitations et affectations aux équipes.</p>
            </Link>
          </nav>
        )}

        <section className="mt-6 grid gap-5 md:grid-cols-3">
          {[
            ["Feedbacks reçus", "0", "Commence par inviter tes collègues."],
            ["Reconnaissances", "0", "Valorise les contributions positives."],
            ["Plans d’action", "0", "Transforme les retours en progrès."],
          ].map(([title, value, description]) => (
            <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">{title}</p>
              <p className="mt-3 text-4xl font-black">{value}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
