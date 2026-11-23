"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type ClientRow = {
  id: string;
  reference: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  country: string | null;
  city: string | null;
  company_name: string | null;
  customer_service_status: string;
  agent_name: string;
};
type InstallmentRow = {
  id: string;
  client_id: string;
  due_date: string;
  expected_amount: number;
  currency: string;
  status: string;
  sequence_number: number;
};
const labels: Record<string, string> = {
  not_transferred: "Non transféré",
  active: "Actif",
  attention: "À surveiller",
  suspended: "Suspendu",
  completed: "Terminé",
  upcoming: "À venir",
  due_today: "À payer aujourd’hui",
  paid: "Payée",
  partial: "Partielle",
  overdue: "En retard",
  promised: "Promesse de paiement",
  deferred: "Reportée",
  waived: "Dispensée",
};
export function ClientQuickView({
  client,
  installments,
}: {
  client: ClientRow;
  installments: InstallmentRow[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const phone = client.phone || client.whatsapp_phone || "—";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group text-left"
        aria-label={`Ouvrir la fiche de ${client.full_name}`}
      >
        <span className="font-black text-slate-950 underline decoration-sky-300 decoration-2 underline-offset-4 transition group-hover:text-sky-700">
          {client.full_name}
        </span>
        <span className="mt-1 block text-xs text-sky-700">
          {client.reference}
          {client.company_name ? ` · ${client.company_name}` : ""}
        </span>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`client-${client.id}`}
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
          >
            <header className="sticky top-0 flex items-start justify-between gap-4 rounded-t-3xl bg-gradient-to-br from-slate-950 to-sky-900 p-6 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[.18em] text-cyan-300">
                  Fiche rapide client
                </p>
                <h2
                  id={`client-${client.id}`}
                  className="mt-1 text-2xl font-black"
                >
                  {client.full_name}
                </h2>
                <p className="mt-1 text-sm text-sky-100">
                  {client.reference}
                  {client.company_name ? ` · ${client.company_name}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/30 px-3 py-1.5 text-lg font-black"
                aria-label="Fermer"
              >
                ×
              </button>
            </header>
            <div className="p-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Téléphone", phone],
                  ["E-mail", client.email || "—"],
                  [
                    "Localisation",
                    [client.city, client.country].filter(Boolean).join(", ") ||
                      "—",
                  ],
                  ["Agent", client.agent_name],
                ].map(([title, value]) => (
                  <div key={title} className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase text-slate-500">
                      {title}
                    </p>
                    <p className="mt-1 break-words text-sm font-bold">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 p-4">
                <span className="font-black">Statut Service Client</span>
                <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-black text-sky-800">
                  {labels[client.customer_service_status] ||
                    client.customer_service_status}
                </span>
              </div>
              <div className="mt-6">
                <h3 className="text-lg font-black">Mensualités récentes</h3>
                {installments.length ? (
                  <div className="mt-3 space-y-2">
                    {installments.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4"
                      >
                        <div>
                          <p className="font-black">
                            Mensualité n° {row.sequence_number} ·{" "}
                            {Number(row.expected_amount).toLocaleString(
                              "fr-FR",
                              { style: "currency", currency: row.currency },
                            )}
                          </p>
                          <p className="text-sm text-slate-500">
                            Échéance : {row.due_date} ·{" "}
                            {labels[row.status] || row.status}
                          </p>
                        </div>
                        <Link
                          href={`/dashboard/customer-service/installments?client=${client.id}&pay=${row.id}`}
                          className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white"
                        >
                          Enregistrer / mettre à jour le paiement
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    Aucune mensualité n’est encore enregistrée pour ce client.
                  </p>
                )}
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link
                  href={`/dashboard/customer-service/installments?client=${client.id}`}
                  className="rounded-xl border border-emerald-700 px-4 py-3 text-center font-black text-emerald-800"
                >
                  Gérer les mensualités
                </Link>
                <Link
                  href={`/dashboard/customer-service?newTicket=1&client=${client.id}`}
                  className="rounded-xl bg-sky-700 px-4 py-3 text-center font-black text-white"
                >
                  Créer un ticket
                </Link>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
