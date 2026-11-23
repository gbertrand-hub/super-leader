import Link from "next/link";

const items = [
  ["Vue d’ensemble", "/dashboard/customer-service"],
  ["Portefeuille clients", "/dashboard/customer-service/clients"],
  ["Mensualités", "/dashboard/customer-service/installments"],
  ["Suivi", "/dashboard/customer-service/follow-up"],
  ["Tickets", "/dashboard/customer-service/tickets"],
] as const;

export function CustomerServiceModuleNav({current}: {current: string}) {
  return <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Service Client">
    {items.map(([label, href]) => <Link key={href} href={href} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${current === href ? "bg-white text-sky-900 shadow" : "bg-white/10 text-white hover:bg-white/20"}`}>{label}</Link>)}
  </nav>;
}

export function CustomerServiceHeader({title, subtitle, current}: {title: string; subtitle: string; current: string}) {
  return <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-sky-950 to-cyan-800 p-7 text-white shadow-xl">
    <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-300">Super Leader · Département Service Client</p>
    <h1 className="mt-2 text-3xl font-black sm:text-4xl">{title}</h1>
    <p className="mt-2 max-w-3xl text-sky-100">{subtitle}</p>
    <CustomerServiceModuleNav current={current} />
  </header>;
}
