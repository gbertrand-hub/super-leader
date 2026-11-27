/**
 * Canton visitor WhatsApp eligibility.
 *
 * Pure decision logic only.
 * No database access, provider calls or external messages.
 */

export type CantonWhatsAppEligibilityInput = {
  visitStatus: string;
  checkedOutAt: string | null;
  phone: string | null;
  whatsappOptIn: boolean;
  optedInAt: string | null;
  feedbackAlreadyReceived: boolean;
  invitationAlreadyProcessed: boolean;
  automationEnabled: boolean;
};

export type CantonWhatsAppEligibilityResult = {
  allowed: boolean;
  reason: string;
};

export function evaluateCantonWhatsAppEligibility(
  input: CantonWhatsAppEligibilityInput
): CantonWhatsAppEligibilityResult {
  const deny = (reason: string): CantonWhatsAppEligibilityResult => ({
    allowed: false,
    reason,
  });

  if (!input.automationEnabled) {
    return deny("automation_disabled");
  }

  if (input.visitStatus !== "completed" || !input.checkedOutAt) {
    return deny("visit_not_completed");
  }

  if (!input.whatsappOptIn || !input.optedInAt) {
    return deny("missing_whatsapp_consent");
  }

  const phone = (input.phone || "").trim();

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return deny("invalid_phone");
  }

  if (input.feedbackAlreadyReceived) {
    return deny("feedback_already_received");
  }

  if (input.invitationAlreadyProcessed) {
    return deny("invitation_already_processed");
  }

  return {
    allowed: true,
    reason: "eligible",
  };
}