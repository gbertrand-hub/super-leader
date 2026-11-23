import {redirect} from "next/navigation";
import {setProviderPortalPasswordAction} from "@/app/actions/service-provider-portal";
import {getProviderPortalContext} from "@/lib/contracts/provider-portal-access";

function feedback(params: {error?: string; success?: string}) {
  if (params.error) {
    return <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{params.error}</p>;
  }
  if (params.success) {
    return <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{params.success}</p>;
  }
  return null;
}

export default async function ProviderSetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{error?: string; success?: string}>;
}) {
  const params = await (searchParams ?? Promise.resolve<{error?: string; success?: string}>({}));
  const context = await getProviderPortalContext();
  if (!context) return null;
  if (!context.links.some((link) => link.password_setup_required)) redirect("/provider-portal");

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950">
      <div className="mx-auto max-w-xl">
        <div className="rounded-[28px] bg-slate-950 p-7 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">Super Leader · Première connexion</p>
          <h1 className="mt-3 text-3xl font-black">Crée ton mot de passe personnel</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Ton invitation a été validée. Avant d’ouvrir le Portail prestataire, choisis un mot de passe que toi seul connais.
          </p>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          {feedback(params)}
          <div className="rounded-xl bg-indigo-50 p-3 text-sm font-bold text-indigo-900">
            Compte : {context.email}
          </div>

          <form action={setProviderPortalPasswordAction} className="mt-5 space-y-4">
            <div>
              <label htmlFor="provider-new-password" className="text-sm font-black">Nouveau mot de passe</label>
              <input
                id="provider-new-password"
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="provider-confirm-password" className="text-sm font-black">Confirmer le mot de passe</label>
              <input
                id="provider-confirm-password"
                name="confirmPassword"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              Au moins 10 caractères, avec une majuscule, une minuscule et un chiffre. Le mot de passe n’est jamais enregistré dans les tables Super Leader : il est géré par Supabase Auth.
            </div>
            <button className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
              Créer mon mot de passe
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
