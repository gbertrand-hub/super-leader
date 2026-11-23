import Link from "next/link";
import {redirect} from "next/navigation";
import {
  inviteProviderPortalAccessAction,
  resendProviderPortalAccessLinkAction,
  revokeProviderPortalAccessAction,
} from "@/app/actions/service-provider-portal";
import {requireAccessContext} from "@/lib/auth/access-control";

type ProviderRow = {
  id: string;
  legal_name: string;
  trading_name: string | null;
  service_category: string;
  contact_name: string | null;
  contact_email: string | null;
  status: string;
};
type ContractRow = {id: string; provider_id: string; title: string; contract_number: string; status: string; internal_owner_user_id: string};
type PortalUserRow = {id: string; provider_id: string; user_id: string; email: string; display_name: string | null; status: string; invited_at: string; last_login_at: string | null; password_setup_required: boolean; password_set_at: string | null};
type AttachmentRow = {id: string; provider_id: string; contract_id: string; resource_type: string; resource_id: string; file_name: string; created_at: string};

const LEADER_ROLES = new Set(["owner", "admin", "executive", "hr", "manager"]);
const PORTAL_ADMINS = new Set(["owner", "admin"]);

function feedback(params: {success?: string; error?: string}) {
  if (params.error) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{params.error}</div>;
  if (params.success) return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{params.success}</div>;
  return null;
}

export default async function ProviderPortalManagementPage({searchParams}: {searchParams?: Promise<{success?: string; error?: string}>}) {
  const params = await (searchParams ?? Promise.resolve<{success?: string; error?: string}>({}));
  const context = await requireAccessContext();
  if (!LEADER_ROLES.has(context.role)) redirect("/dashboard/my-day");

  let contractsQuery = context.admin
    .from("service_contracts")
    .select("id,provider_id,title,contract_number,status,internal_owner_user_id")
    .eq("organization_id", context.organizationId)
    .order("created_at", {ascending: false});
  if (context.role === "manager") contractsQuery = contractsQuery.eq("internal_owner_user_id", context.user.id);
  const {data: contractData, error: contractError} = await contractsQuery;
  if (contractError) throw new Error(contractError.message);
  const contracts = (contractData ?? []) as ContractRow[];
  const providerIds = Array.from(new Set(contracts.map((contract) => contract.provider_id)));

  let providers: ProviderRow[] = [];
  let portalUsers: PortalUserRow[] = [];
  let attachments: AttachmentRow[] = [];
  if (providerIds.length) {
    const [providerResult, portalResult, attachmentResult] = await Promise.all([
      context.admin
        .from("service_providers")
        .select("id,legal_name,trading_name,service_category,contact_name,contact_email,status")
        .eq("organization_id", context.organizationId)
        .in("id", providerIds)
        .order("legal_name", {ascending: true}),
      context.admin
        .from("service_provider_portal_users")
        .select("id,provider_id,user_id,email,display_name,status,invited_at,last_login_at,password_setup_required,password_set_at")
        .eq("organization_id", context.organizationId)
        .in("provider_id", providerIds)
        .order("updated_at", {ascending: false}),
      context.admin
        .from("service_provider_portal_attachments")
        .select("id,provider_id,contract_id,resource_type,resource_id,file_name,created_at")
        .eq("organization_id", context.organizationId)
        .in("provider_id", providerIds)
        .order("created_at", {ascending: false})
        .limit(50),
    ]);
    if (providerResult.error) throw new Error(providerResult.error.message);
    if (portalResult.error) throw new Error(`Migration portail prestataire requise : ${portalResult.error.message}`);
    providers = (providerResult.data ?? []) as ProviderRow[];
    portalUsers = (portalResult.data ?? []) as PortalUserRow[];
    attachments = (attachmentResult.data ?? []) as AttachmentRow[];
  }

  const contractsByProvider = new Map<string, ContractRow[]>();
  for (const contract of contracts) {
    const rows = contractsByProvider.get(contract.provider_id) ?? [];
    rows.push(contract);
    contractsByProvider.set(contract.provider_id, rows);
  }
  const usersByProvider = new Map<string, PortalUserRow[]>();
  for (const portalUser of portalUsers) {
    const rows = usersByProvider.get(portalUser.provider_id) ?? [];
    rows.push(portalUser);
    usersByProvider.set(portalUser.provider_id, rows);
  }
  const attachmentsByProvider = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    const rows = attachmentsByProvider.get(attachment.provider_id) ?? [];
    rows.push(attachment);
    attachmentsByProvider.set(attachment.provider_id, rows);
  }

  const activeAccess = portalUsers.filter((row) => row.status === "active").length;
  const providersConnected = new Set(portalUsers.filter((row) => row.status === "active").map((row) => row.provider_id)).size;
  const canManageAccess = PORTAL_ADMINS.has(context.role);

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm font-black text-indigo-700">
          <Link href="/dashboard/contracts/finance">← Finance & paiements</Link>
          <Link href="/dashboard/contracts">Contrats & passeports →</Link>
        </div>
        <Link href="/dashboard/module-status" className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-black uppercase">Feuille de route</Link>
      </div>

      <header className="rounded-[28px] bg-slate-950 p-7 text-white shadow-lg">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">Super Leader Operations · v4.10.17</p>
        <h1 className="mt-3 text-3xl font-black">Portail prestataire</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
          Gère les accès externes et contrôle les preuves déposées par les prestataires sans leur donner accès aux données internes de Super Leader.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/provider-login" className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950">Ouvrir la page de connexion prestataire</Link>
          <Link href="/provider-portal" className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-black text-white">Tester mon accès externe</Link>
        </div>
      </header>

      {feedback(params)}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Prestataires suivis</p><p className="mt-2 text-3xl font-black">{providers.length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Prestataires connectés</p><p className="mt-2 text-3xl font-black text-emerald-700">{providersConnected}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Accès actifs</p><p className="mt-2 text-3xl font-black">{activeAccess}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Preuves récentes</p><p className="mt-2 text-3xl font-black">{attachments.length}</p></div>
      </section>

      {!canManageAccess ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">
          Vue de suivi uniquement. Pour des raisons de sécurité, seuls Owner et Admin peuvent créer ou révoquer les comptes externes.
        </div>
      ) : null}

      <section className="space-y-4">
        {providers.length === 0 ? <div className="rounded-2xl bg-white p-6">Aucun prestataire dans ton périmètre.</div> : providers.map((provider) => {
          const providerContracts = contractsByProvider.get(provider.id) ?? [];
          const accessRows = usersByProvider.get(provider.id) ?? [];
          const recentFiles = (attachmentsByProvider.get(provider.id) ?? []).slice(0, 5);
          return (
            <article key={provider.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-indigo-600">{provider.service_category}</p>
                  <h2 className="mt-1 text-xl font-black">{provider.legal_name}</h2>
                  <p className="mt-1 text-sm text-slate-500">{provider.contact_name ?? "Contact non renseigné"} · {provider.contact_email ?? "E-mail non renseigné"}</p>
                  <p className="mt-2 text-xs font-bold text-slate-500">{providerContracts.length} contrat(s) visible(s) dans ce périmètre</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-700">{provider.status}</span>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <h3 className="font-black">Accès externe</h3>
                  {accessRows.length === 0 ? <p className="mt-2 text-sm text-slate-500">Aucun compte prestataire relié.</p> : <div className="mt-3 space-y-2">{accessRows.map((row) => <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black">{row.display_name || row.email}</p><p className="text-xs text-slate-500">{row.email}</p><p className="mt-1 text-[11px] text-slate-400">Dernière connexion : {row.last_login_at ? new Date(row.last_login_at).toLocaleString("fr-FR") : "jamais"}</p><p className={`mt-1 text-[11px] font-bold ${row.password_setup_required ? "text-amber-700" : "text-emerald-700"}`}>Mot de passe : {row.password_setup_required ? "à créer" : "configuré"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${row.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{row.status}</span></div>{canManageAccess && row.status === "active" ? (
  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
    <form action={resendProviderPortalAccessLinkAction}>
      <input type="hidden" name="portalUserId" value={row.id} />
      <button className="text-xs font-black text-indigo-700 underline">
        {row.last_login_at ? "Renvoyer un lien d’accès" : "Renvoyer l’invitation / lien d’accès"}
      </button>
    </form>
    <form action={revokeProviderPortalAccessAction}>
      <input type="hidden" name="portalUserId" value={row.id} />
      <button className="text-xs font-black text-red-700 underline">Révoquer cet accès</button>
    </form>
  </div>
) : null}</div>)}</div>}

                  {canManageAccess ? (
                    <details className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3" open={accessRows.every((row) => row.status !== "active")}>
                      <summary className="cursor-pointer text-sm font-black text-indigo-900">Autoriser un compte prestataire</summary>
                      <form action={inviteProviderPortalAccessAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="providerId" value={provider.id} />
                        <input name="displayName" defaultValue={provider.contact_name ?? ""} placeholder="Nom du contact" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                        <input name="email" type="email" required defaultValue={provider.contact_email ?? ""} placeholder="E-mail du prestataire" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                        <button className="sm:col-span-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">Activer / inviter au portail</button>
                      </form>
                    </details>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <h3 className="font-black">Activité et preuves</h3>
                  {recentFiles.length === 0 ? <p className="mt-2 text-sm text-slate-500">Aucune preuve déposée depuis le portail.</p> : <div className="mt-3 space-y-2">{recentFiles.map((file) => {
                    const contract = providerContracts.find((row) => row.id === file.contract_id);
                    return <div key={file.id} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-sm font-black">{file.file_name}</p><p className="mt-1 text-xs text-slate-500">{contract?.title ?? file.contract_id} · {file.resource_type}</p><Link href={`/api/provider-portal/attachments/${file.id}`} className="mt-2 inline-block text-xs font-black text-indigo-700 underline">Ouvrir la preuve</Link></div>;
                  })}</div>}
                  <div className="mt-4 space-y-2">{providerContracts.map((contract) => <Link key={contract.id} href={`/dashboard/contracts/${contract.id}`} className="block rounded-xl border border-slate-200 bg-white p-3"><p className="text-sm font-black">{contract.title}</p><p className="mt-1 text-xs text-slate-500">{contract.contract_number} · {contract.status}</p></Link>)}</div>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
