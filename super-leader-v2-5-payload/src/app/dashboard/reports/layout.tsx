import { requireFeatureForCurrentOrganization } from "@/lib/billing/entitlements";

export default async function FeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeatureForCurrentOrganization("reports_advanced");
  return children;
}
