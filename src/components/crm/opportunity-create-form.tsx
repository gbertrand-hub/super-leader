"use client";

import {useMemo, useState} from "react";
import {createCrmOpportunityAction} from "@/app/actions/crm-pipeline";
import {getCrmPipelineText, sectorFieldLabels, sourceLabel} from "@/i18n/crm-pipeline";
import {CRM_SOURCES, sectorOptionLabel, type CrmSector, type CrmSectorOption} from "@/lib/crm/pipeline";

type Option = {id: string; name: string};
type ProductOption = Option & {sector: CrmSector; currency: string; basePrice: number};

export function OpportunityCreateForm({
  locale,
  clients,
  products,
  sectors,
  members,
  currentUserId,
  canManage,
  returnTo,
}: {
  locale: string;
  clients: Option[];
  products: ProductOption[];
  sectors: CrmSectorOption[];
  members: Option[];
  currentUserId: string;
  canManage: boolean;
  returnTo: string;
}) {
  const copy = getCrmPipelineText(locale);
  const [sector, setSector] = useState<CrmSector>(sectors[0]?.code ?? "house");
  const filteredProducts = useMemo(() => products.filter((product) => product.sector === sector), [products, sector]);
  const [currency, setCurrency] = useState("USD");
  const [value, setValue] = useState("");

  return (
    <form action={createCrmOpportunityAction} className="rounded-3xl border border-sky-200 bg-white p-6 shadow-sm">
      <input type="hidden" name="returnTo" value={returnTo} />
      <h2 className="text-xl font-black text-slate-950">{copy.createOpportunity}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">{copy.firstPaymentWarning}</p>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{copy.sector}
            <select name="sector" value={sector} onChange={(event) => setSector(event.target.value as CrmSector)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
              {sectors.map((item) => <option key={item.code} value={item.code}>{sectorOptionLabel(locale, item)}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">{copy.client}
            <select name="clientId" required defaultValue="" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
              <option value="">{copy.selectClient}</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        </div>
        <label className="text-sm font-bold">{copy.title}
          <input name="title" required maxLength={220} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{copy.product}
            <select name="productId" defaultValue="" onChange={(event) => {
              const product = products.find((item) => item.id === event.target.value);
              if (product) {
                setCurrency(product.currency);
                setValue(String(product.basePrice || ""));
              }
            }} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
              <option value="">{copy.productOptional}</option>
              {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">{copy.owner}
            {canManage ? (
              <select name="ownerId" defaultValue={currentUserId} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            ) : <><input type="hidden" name="ownerId" value={currentUserId} /><div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal">{members.find((member) => member.id === currentUserId)?.name || copy.owner}</div></>}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-bold">{copy.value}
            <input name="valueAmount" type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">{copy.currency}
            <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
              {["USD", "EUR", "GBP", "XAF", "CAD"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">{copy.source}
            <select name="source" defaultValue="manual" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">
              {CRM_SOURCES.map((item) => <option key={item} value={item}>{sourceLabel(locale, item)}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{copy.budget}
            <input name="budgetAmount" type="number" min="0" step="0.01" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">{copy.expectedClose}
            <input name="expectedCloseDate" type="date" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
        </div>
        <label className="text-sm font-bold">{copy.needSummary}
          <textarea name="needSummary" maxLength={3000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
        </label>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-black text-slate-900">{copy.details}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {sectorFieldLabels(locale, sector).map((label, index) => (
              <label key={`${sector}-${index}`} className="text-sm font-bold">{label}
                <input name={`detail${index}`} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" />
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{copy.firstPayment}
            <input name="firstPaymentExpected" type="number" min="0" step="0.01" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">{copy.firstPaymentDue}
            <input name="firstPaymentDueDate" type="date" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{copy.nextAction}
            <input name="nextAction" required maxLength={500} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">{copy.nextActionAt}
            <input name="nextActionAt" type="datetime-local" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
        </div>
        <button type="submit" className="rounded-xl bg-sky-700 px-5 py-3 font-black text-white hover:bg-sky-800">{copy.createOpportunity}</button>
      </div>
    </form>
  );
}
