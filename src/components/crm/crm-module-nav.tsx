import Link from "next/link";
import {getCrmPipelineText} from "@/i18n/crm-pipeline";

export function CrmModuleNav({locale, active, canManage = false, canManageAmbassadors = false}: {
  locale: string;
  active: "prospects" | "scoring" | "ambassadors" | "pipeline" | "catalogue" | "day" | "analytics" | "clients";
  canManage?: boolean;
  canManageAmbassadors?: boolean;
}) {
  const copy = getCrmPipelineText(locale);
  const links = [
    {id: "prospects", label: locale === "fr" ? "Prospects" : "Prospects", href: "/dashboard/crm/prospects"},
    {id: "scoring", label: locale === "fr" ? "Score intelligent" : "Lead scoring", href: "/dashboard/crm/scoring"},
    {id: "ambassadors", label: locale === "fr" ? "Ambassadeurs" : "Ambassadors", href: "/dashboard/crm/ambassadors"},
    {id: "pipeline", label: copy.pipeline, href: "/dashboard/crm/pipeline"},
    {id: "day", label: copy.myDay, href: "/dashboard/crm/my-sales-day"},
    {id: "catalogue", label: copy.catalogue, href: "/dashboard/crm/catalog"},
    {id: "analytics", label: copy.analytics, href: "/dashboard/crm/analytics"},
    {id: "clients", label: copy.legacyCrm, href: "/dashboard/crm"},
  ] as const;
  const visibleLinks = links.filter((link) => (link.id !== "analytics" || canManage) && (link.id !== "ambassadors" || canManageAmbassadors));
  return (
    <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {visibleLinks.map((link) => (
        <Link key={link.id} href={link.href} className={`rounded-xl px-4 py-3 text-sm font-black ${active === link.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
