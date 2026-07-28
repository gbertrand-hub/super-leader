import { requireFeatureForCurrentOrganization } from "@/lib/billing/entitlements";

export default async function FeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeatureForCurrentOrganization("crm_sales");
  return children;
}
