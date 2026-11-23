import {
  createCrmProductAction,
  toggleCrmProductAction,
  updateCrmProductAction,
} from "@/app/actions/crm-pipeline";
import {createCrmSectorAction, toggleCrmSectorAction, updateCrmSectorAction} from "@/app/actions/crm-sectors";
import {CrmModuleNav} from "@/components/crm/crm-module-nav";
import {sectorLabel} from "@/i18n/crm-pipeline";
import {formatMoney, safeNumber, sectorOptionLabel, type CrmSector} from "@/lib/crm/pipeline";
import {getCrmServerContext} from "@/lib/crm/server";

type SearchParams = {sector?: string | string[]; success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type ProductRow = {
  id: string;
  code: string | null;
  name: string;
  name_en: string | null;
  sector: CrmSector | null;
  product_type: string;
  description: string | null;
  description_en: string | null;
  currency: string;
  default_price: number | string;
  minimum_first_payment_type: "percentage" | "fixed";
  minimum_first_payment_value: number | string;
  commission_type: "percentage" | "fixed";
  commission_value: number | string;
  fulfillment_destination: string;
  is_active: boolean;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CrmCatalogPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {admin, membership, locale, copy, canManage, canManageProducts, sectorOptions, activeSectorOptions, sectorSchemaReady} = await getCrmServerContext();
  const requestedSector = first(params.sector);
  const selectedSector = sectorOptions.some((sector) => sector.code === requestedSector) ? requestedSector : "";
  const sectorByCode = new Map(sectorOptions.map((sector) => [sector.code, sector]));

  const schema = await admin.from("sales_products").select("id, sector, minimum_first_payment_value, fulfillment_destination", {head: true, count: "exact"}).limit(1);
  if (schema.error) {
    return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-5xl"><header className="rounded-3xl bg-slate-950 p-7 text-white"><p className="text-sm font-black uppercase tracking-[0.18em] text-sky-300">{copy.eyebrow}</p><h1 className="mt-2 text-3xl font-black">{copy.catalogueTitle}</h1></header><section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{copy.migrationTitle}</h2><p className="mt-3 text-amber-900">{copy.migrationHelp}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/053_multisector_crm_pipeline_v3_5_0.sql</code></section></div></main>;
  }

  let query = admin.from("sales_products").select("id, code, name, name_en, sector, product_type, description, description_en, currency, default_price, minimum_first_payment_type, minimum_first_payment_value, commission_type, commission_value, fulfillment_destination, is_active").eq("organization_id", membership.organization_id).order("is_active", {ascending: false}).order("sector").order("name");
  if (selectedSector) query = query.eq("sector", selectedSector);
  const {data, error} = await query;
  if (error) throw new Error(error.message);
  const products = (data ?? []) as ProductRow[];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-gradient-to-br from-cyan-800 via-slate-950 to-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan-300">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black">{copy.catalogueTitle}</h1>
          <p className="mt-3 max-w-4xl leading-7 text-slate-300">{copy.catalogueSubtitle}</p>
        </header>
        <CrmModuleNav locale={locale} active="catalogue" canManage={canManage} />
        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form method="get" className="flex flex-wrap items-end gap-4">
            <label className="min-w-64 flex-1 text-sm font-bold">{copy.sector}<select name="sector" defaultValue={selectedSector} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{copy.all}</option>{sectorOptions.map((sector) => <option key={sector.code} value={sector.code}>{sectorOptionLabel(locale, sector)}{sector.isActive ? "" : (locale === "fr" ? " · inactif" : " · inactive")}</option>)}</select></label>
            <button className="rounded-xl bg-slate-950 px-6 py-3 font-black text-white">{copy.filters}</button>
          </form>
        </section>

        {canManageProducts ? (
          <section className="mt-6 rounded-3xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">{locale === "fr" ? "Configuration commerciale" : "Commercial configuration"}</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">{locale === "fr" ? "Gérer les secteurs" : "Manage sectors"}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{locale === "fr" ? "Ajoute de nouveaux secteurs sans modifier le code. Chaque nouveau secteur reçoit automatiquement un pipeline commercial standard." : "Add new sectors without changing code. Every new sector automatically receives a standard sales pipeline."}</p>
              </div>
              {!sectorSchemaReady ? <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">Migration 121 requise</span> : null}
            </div>

            {sectorSchemaReady ? (
              <>
                <form action={createCrmSectorAction} className="mt-5 grid gap-3 rounded-2xl border border-violet-200 bg-white p-4 lg:grid-cols-[1.1fr_1.1fr_0.8fr_1fr_auto]">
                  <label className="text-xs font-black">{locale === "fr" ? "Nom français" : "French name"}<input name="nameFr" required maxLength={120} placeholder="Super Leader VIP" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label>
                  <label className="text-xs font-black">{locale === "fr" ? "Nom anglais" : "English name"}<input name="nameEn" maxLength={120} placeholder="Super Leader VIP" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label>
                  <label className="text-xs font-black">Code<input name="code" maxLength={40} placeholder="vip" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label>
                  <label className="text-xs font-black">{locale === "fr" ? "Destination après vente" : "Post-sale destination"}<select name="fulfillmentDestination" defaultValue="other" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal"><option value="real_estate">Real estate</option><option value="academy">Academy</option><option value="livestock_operations">Livestock operations</option><option value="collections">Collections</option><option value="other">Other</option></select></label>
                  <button className="self-end rounded-xl bg-violet-800 px-4 py-2.5 font-black text-white">{locale === "fr" ? "Ajouter" : "Add"}</button>
                </form>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {sectorOptions.map((sector) => (
                    <article key={sector.code} className={`rounded-2xl border p-4 ${sector.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100 opacity-75"}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{sectorOptionLabel(locale, sector)}</p><p className="mt-1 text-xs font-bold text-slate-400">{sector.code}{sector.isSystem ? " · système" : ""}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${sector.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{sector.isActive ? (locale === "fr" ? "Actif" : "Active") : (locale === "fr" ? "Inactif" : "Inactive")}</span></div>
                      {sector.id ? <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-black">{locale === "fr" ? "Modifier" : "Edit"}</summary><form action={updateCrmSectorAction} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="sectorId" value={sector.id} /><label className="text-xs font-black">FR<input name="nameFr" defaultValue={sector.nameFr} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label><label className="text-xs font-black">EN<input name="nameEn" defaultValue={sector.nameEn} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label><label className="text-xs font-black sm:col-span-2">{locale === "fr" ? "Destination après vente" : "Post-sale destination"}<select name="fulfillmentDestination" defaultValue={sector.fulfillmentDestination} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="real_estate">Real estate</option><option value="academy">Academy</option><option value="livestock_operations">Livestock operations</option><option value="collections">Collections</option><option value="other">Other</option></select></label><button className="rounded-lg bg-slate-950 px-4 py-2 font-black text-white sm:col-span-2">{locale === "fr" ? "Enregistrer" : "Save"}</button></form><form action={toggleCrmSectorAction} className="mt-2"><input type="hidden" name="sectorId" value={sector.id} /><input type="hidden" name="isActive" value={String(!sector.isActive)} /><button className={`w-full rounded-lg px-4 py-2 text-sm font-black ${sector.isActive ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{sector.isActive ? (locale === "fr" ? "Désactiver" : "Deactivate") : (locale === "fr" ? "Activer" : "Activate")}</button></form></details> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">{locale === "fr" ? "Exécute la migration 121_dynamic_crm_sectors_v4_8_79.sql dans Supabase pour activer la gestion des secteurs." : "Run migration 121_dynamic_crm_sectors_v4_8_79.sql in Supabase to enable sector management."}</div>
            )}
          </section>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[410px_1fr]">
          {canManageProducts ? (
            <form action={createCrmProductAction} className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
              <input type="hidden" name="returnTo" value="/dashboard/crm/catalog" />
              <h2 className="text-xl font-black">{copy.createProduct}</h2>
              <div className="mt-5 grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.code}<input name="code" required maxLength={60} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{copy.sector}<select name="sector" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{activeSectorOptions.map((sector) => <option key={sector.code} value={sector.code}>{sectorOptionLabel(locale, sector)}</option>)}</select></label></div>
                <label className="text-sm font-bold">{copy.nameFr}<input name="nameFr" required maxLength={160} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{copy.nameEn}<input name="nameEn" maxLength={160} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{copy.type}<input name="productType" defaultValue="standard" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.basePrice}<input name="basePrice" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{copy.currency}<select name="currency" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["USD","EUR","GBP","XAF","CAD"].map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.minFirstPaymentType}<select name="minimumFirstPaymentType" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="percentage">{copy.percentage}</option><option value="fixed">{copy.fixed}</option></select></label><label className="text-sm font-bold">{copy.minFirstPayment}<input name="minimumFirstPaymentValue" type="number" min="0" step="0.01" defaultValue="10" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label></div>
                <label className="text-sm font-bold">{copy.fulfillment}<select name="fulfillmentDestination" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="real_estate">Real estate</option><option value="academy">Academy</option><option value="livestock_operations">Livestock operations</option><option value="collections">Collections</option><option value="other">Other</option></select></label>
                <label className="text-sm font-bold">{copy.description}<textarea name="descriptionFr" maxLength={1500} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{locale === "fr" ? "Description anglaise" : "English description"}<textarea name="descriptionEn" maxLength={3000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <button className="rounded-xl bg-cyan-800 px-5 py-3 font-black text-white">{copy.createProduct}</button>
              </div>
            </form>
          ) : <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{copy.catalogue}</h2><p className="mt-3 leading-7 text-slate-600">{locale === "fr" ? "Le catalogue est géré par Owner ou Admin. Tu peux utiliser les produits actifs dans le pipeline." : "The catalogue is managed by Owner or Admin. You can use active products in the pipeline."}</p></section>}

          <section className="space-y-4">
            {products.map((product) => (
              <article key={product.id} className={`rounded-3xl border bg-white p-6 shadow-sm ${product.is_active ? "border-slate-200" : "border-slate-300 opacity-75"}`}>
                <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-800">{product.sector ? sectorOptionLabel(locale, sectorByCode.get(product.sector) ?? {code: product.sector, nameFr: sectorLabel(locale, product.sector), nameEn: sectorLabel("en", product.sector)}) : (locale === "fr" ? "Non classé" : "Unclassified")}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{product.code}</span></div><h2 className="mt-3 text-xl font-black">{locale === "fr" ? product.name : product.name_en || product.name}</h2><p className="mt-1 text-sm text-slate-500">{product.product_type}</p></div><div className="text-right"><p className="text-2xl font-black">{formatMoney(product.default_price, product.currency, locale)}</p><p className="mt-1 text-xs font-bold text-slate-500">{product.is_active ? copy.activeProducts : copy.inactiveProducts}</p></div></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">{copy.minFirstPayment}</p><p className="mt-1 font-black">{product.minimum_first_payment_type === "percentage" ? `${safeNumber(product.minimum_first_payment_value)}%` : formatMoney(product.minimum_first_payment_value, product.currency, locale)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">{copy.fulfillment}</p><p className="mt-1 font-black">{product.fulfillment_destination}</p></div></div>
                {canManageProducts ? <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer font-black">{copy.update}</summary><form action={updateCrmProductAction} className="mt-4 grid gap-4"><input type="hidden" name="returnTo" value="/dashboard/crm/catalog" /><input type="hidden" name="productId" value={product.id} /><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.nameFr}<input name="nameFr" defaultValue={product.name} required maxLength={160} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{copy.nameEn}<input name="nameEn" defaultValue={product.name_en ?? ""} maxLength={160} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label></div><label className="text-sm font-bold">{copy.sector}<select name="sector" defaultValue={product.sector ?? ""} required className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="" disabled>{copy.selectSector}</option>{sectorOptions.map((sector) => <option key={sector.code} value={sector.code} disabled={!sector.isActive && sector.code !== product.sector}>{sectorOptionLabel(locale, sector)}{sector.isActive ? "" : (locale === "fr" ? " · inactif" : " · inactive")}</option>)}</select></label><label className="text-sm font-bold">{copy.type}<input name="productType" defaultValue={product.product_type} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.basePrice}<input name="basePrice" type="number" min="0" step="0.01" defaultValue={safeNumber(product.default_price)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{copy.currency}<select name="currency" defaultValue={product.currency} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal">{["USD","EUR","GBP","XAF","CAD"].map((currency) => <option key={currency}>{currency}</option>)}</select></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.minFirstPaymentType}<select name="minimumFirstPaymentType" defaultValue={product.minimum_first_payment_type} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="percentage">{copy.percentage}</option><option value="fixed">{copy.fixed}</option></select></label><label className="text-sm font-bold">{copy.minFirstPayment}<input name="minimumFirstPaymentValue" type="number" min="0" step="0.01" defaultValue={safeNumber(product.minimum_first_payment_value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{copy.commission}<select name="commissionType" defaultValue={product.commission_type} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="percentage">{copy.percentage}</option><option value="fixed">{copy.fixed}</option></select></label><label className="text-sm font-bold">{copy.value}<input name="commissionValue" type="number" min="0" step="0.01" defaultValue={safeNumber(product.commission_value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label></div><label className="text-sm font-bold">{copy.fulfillment}<select name="fulfillmentDestination" defaultValue={product.fulfillment_destination} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="real_estate">Real estate</option><option value="academy">Academy</option><option value="livestock_operations">Livestock operations</option><option value="collections">Collections</option><option value="other">Other</option></select></label><label className="text-sm font-bold">{copy.description}<textarea name="descriptionFr" defaultValue={product.description ?? ""} maxLength={1500} className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{locale === "fr" ? "Description anglaise" : "English description"}<textarea name="descriptionEn" defaultValue={product.description_en ?? ""} maxLength={3000} className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{copy.update}</button></form><form action={toggleCrmProductAction} className="mt-3"><input type="hidden" name="returnTo" value="/dashboard/crm/catalog" /><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="isActive" value={String(!product.is_active)} /><button className={`w-full rounded-xl px-5 py-3 font-black ${product.is_active ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{product.is_active ? copy.deactivate : copy.activate}</button></form></details> : null}
              </article>
            ))}
            {!products.length ? <p className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center font-bold text-slate-500">{copy.empty}</p> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
