import {ProviderPortalLoginForm} from "@/components/contracts/provider-portal-login-form";

export default async function ProviderLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{error?: string; success?: string; email?: string}>;
}) {
  const params = await (searchParams ?? Promise.resolve<{error?: string; success?: string; email?: string}>({}));
  const denied = params.error === "no-access" || params.error === "portal-access";
  const passwordCreated = params.success === "password-created";
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="rounded-[28px] bg-slate-950 p-7 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">Super Leader · Portail prestataire</p>
          <h1 className="mt-3 text-3xl font-black">Accès sécurisé prestataire</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Consulte tes contrats, obligations, livrables et échéances financières, puis transmets tes preuves et rapports à iLEAD Global.
          </p>
        </div>
        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          {denied ? (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
              Ce compte n’a pas d’accès prestataire actif. Contacte ton responsable iLEAD Global si l’accès doit être réactivé.
            </p>
          ) : null}
          {passwordCreated ? (
            <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              Ton mot de passe personnel est créé. Connecte-toi maintenant avec ton e-mail et ce mot de passe.
            </p>
          ) : null}
          <ProviderPortalLoginForm initialEmail={params.email ?? ""} />
          <p className="mt-5 text-xs leading-5 text-slate-500">
            Ton accès est personnel. Le lien sécurisé reste disponible comme solution de secours, mais les connexions habituelles utilisent ton e-mail et ton mot de passe.
          </p>
        </div>
      </div>
    </main>
  );
}
