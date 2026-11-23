import type {SupabaseClient} from "@supabase/supabase-js";
import {canManageSensitiveFinanceData} from "@/lib/auth/sensitive-finance-access";

export async function canManageAmbassadors(admin: SupabaseClient, organizationId: string, userId: string, role: string) {
  return canManageSensitiveFinanceData(admin, organizationId, userId, role);
}
