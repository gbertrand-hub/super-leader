import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const fullName = data.user.user_metadata?.full_name ?? "Leader";
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, sector)")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const rawOrganization = membership?.organizations;
  const organization = Array.isArray(rawOrganization) ? rawOrganization[0] : rawOrganization;

  let receivedCount = 0;
  let averageScore = "0.0";
  let recognitionCount = 0;
  let actionPlanCount = 0;

  if (organization && membership?.organization_id) {
    const [{ data: received }, { count: recognitions }, { count: actionPlans }] = await Promise.all([
      admin
        .from("peer_feedback")
        .select("score")
        .eq("organization_id", membership.organization_id)
        .eq("recipient_id", data.user.id)
        .eq("status", "published"),
      admin
        .from("recognitions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .eq("recipient_id", data.user.id),
      admin
        .from("action_plans")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .eq("owner_id", data.user.id)
        .not("status", "in", "(completed,cancelled)"),
    ]);

    receivedCount = received?.length ?? 0;
    recognitionCount = recognitions ?? 0;
    actionPlanCount = actionPlans ?? 0;

    if (receivedCount) {
      averageScore = (
        received!.reduce((sum, item) => sum + item.score, 0) / receivedCount
      ).toFixed(1);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-amber-400">★ SUPER LEADER</p>
            <h1 className="mt-2 text-3xl font-extrabold">Bonjour, {fullName}</h1>
            <p className="mt-1 text-slate-300">
              {organization
                ? `${organization.name} · ${membership?.role}`
                : "Crée ton entreprise pour commencer."}
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
            <p className="mt-2 max-w-2xl text-slate-600">
              Ajoute l’entreprise, puis invite les collègues et organise les équipes.
            </p>
            <Link className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-bold text-white" href="/dashboard/company">
              Configurer l’entreprise
            </Link>
          </section>
        ) : (
          <nav className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              <p className="mt-2 text-sm text-slate-600">Rôles, statuts et affectations.</p>
            </Link>
            <Link href="/dashboard/feedback" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm hover:border-indigo-400">
              <p className="text-lg font-black text-indigo-950">Feedback entre collègues</p>
              <p className="mt-2 text-sm text-indigo-700">Donne et consulte des retours constructifs.</p>
            </Link>
            <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm hover:border-amber-400">
              <p className="text-lg font-black text-amber-950">Reconnaissance</p>
              <p className="mt-2 text-sm text-amber-800">Félicite et valorise les contributions positives.</p>
            </Link>
          </nav>
        )}

        <section className="mt-6 grid gap-5 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Feedbacks reçus</p>
            <p className="mt-3 text-4xl font-black">{receivedCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Note moyenne : {averageScore}/5</p>
          </article>
          <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm hover:bg-amber-50">
            <p className="text-sm font-semibold text-slate-500">Reconnaissances</p>
            <p className="mt-3 text-4xl font-black">{recognitionCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Valorise les contributions positives.</p>
          </Link>
          <Link href="/dashboard/actions" className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm hover:bg-indigo-50">
            <p className="text-sm font-semibold text-slate-500">Plans d’action</p>
            <p className="mt-3 text-4xl font-black">{actionPlanCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Transforme les retours en progrès.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
