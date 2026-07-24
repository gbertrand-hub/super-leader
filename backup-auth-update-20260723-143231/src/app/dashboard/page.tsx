import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const fullName = data.user.user_metadata?.full_name ?? "Leader";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-amber-400">★ SUPER LEADER</p>
            <h1 className="mt-2 text-3xl font-extrabold">Bonjour, {fullName}</h1>
            <p className="mt-1 text-slate-300">Ton espace sécurisé est maintenant actif.</p>
          </div>
          <form action={signOutAction}>
            <button className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 hover:bg-slate-100" type="submit">
              Se déconnecter
            </button>
          </form>
        </header>

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
