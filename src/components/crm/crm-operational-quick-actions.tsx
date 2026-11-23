import { OperationalQuickActions } from "@/components/dashboard/operational-quick-actions";
import { getCrmServerContext } from "@/lib/crm/server";

/**
 * CRM analytics is a crossroads page. This server wrapper resolves the current
 * CRM role with the same authorization guard as the analytics page, then lets
 * the shared client component keep its existing tile-level role restrictions.
 */
export async function CrmOperationalQuickActions() {
  const { membership } = await getCrmServerContext({ leadersOnly: true });

  return (
    <OperationalQuickActions
      role={membership.role}
      enabledFeatures={["crm_sales"]}
      placement="inline"
    />
  );
}
