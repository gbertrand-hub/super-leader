"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const badges = [
  "leadership",
  "teamwork",
  "service",
  "innovation",
  "reliability",
  "communication",
  "courage",
  "excellence",
] as const;

const visibilities = ["private", "team"] as const;

type Badge = (typeof badges)[number];
type Visibility = (typeof visibilities)[number];

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/recognition?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    go(`Impossible de charger ton organisation : ${membershipError.message}`, "error");
  }

  if (!membership) {
    redirect("/dashboard/company");
  }

  return { user: authData.user, membership, admin };
}

export async function sendRecognitionAction(formData: FormData) {
  const { user, membership, admin } = await getContext();

  const recipientId = String(formData.get("recipientId") ?? "");
  const badge = String(formData.get("badge") ?? "") as Badge;
  const message = String(formData.get("message") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "private") as Visibility;

  if (!recipientId || recipientId === user.id) {
    go("Choisis un autre collègue.", "error");
  }

  if (!badges.includes(badge)) {
    go("Badge invalide.", "error");
  }

  if (!visibilities.includes(visibility)) {
    go("Visibilité invalide.", "error");
  }

  if (message.length < 3 || message.length > 600) {
    go("Le message doit contenir entre 3 et 600 caractères.", "error");
  }

  const { data: recipientMembership } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", recipientId)
    .eq("is_active", true)
    .maybeSingle();

  if (!recipientMembership) {
    go("Ce collègue n’appartient pas à ton organisation.", "error");
  }

  const { error } = await admin.from("recognitions").insert({
    organization_id: membership.organization_id,
    sender_id: user.id,
    recipient_id: recipientId,
    badge,
    message,
    visibility,
  });

  if (error) {
    go(`Envoi impossible : ${error.message}`, "error");
  }

  revalidatePath("/dashboard/recognition");
  revalidatePath("/dashboard");
  go("Reconnaissance envoyée avec succès.");
}
