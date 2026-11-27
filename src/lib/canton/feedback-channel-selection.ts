/**
 * Canton feedback channel selection.
 *
 * Pure business logic.
 * No database changes.
 * No external messages.
 */

export type FeedbackChannel = "whatsapp" | "email";

export type ChannelSelectionInput = {
  visitCompleted: boolean;
  feedbackAlreadyReceived: boolean;
  invitationAlreadyProcessed: boolean;

  whatsappEnabled: boolean;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  whatsappPhone: string | null;

  emailEnabled: boolean;
  emailOptIn: boolean;
  emailOptInAt: string | null;
  email: string | null;
};

export type ChannelSelectionResult = {
  channel: FeedbackChannel | null;
  reason: string;
};

export function selectCantonFeedbackChannel(
  input: ChannelSelectionInput
): ChannelSelectionResult {

  const none = (reason: string): ChannelSelectionResult => ({
    channel: null,
    reason,
  });

  if (!input.visitCompleted) {
    return none("visit_not_completed");
  }

  if (input.feedbackAlreadyReceived) {
    return none("feedback_already_received");
  }

  if (input.invitationAlreadyProcessed) {
    return none("invitation_already_processed");
  }

  const whatsappReady =
    input.whatsappEnabled &&
    input.whatsappOptIn &&
    Boolean(input.whatsappOptInAt) &&
    /^\+[1-9]\d{7,14}$/.test(
      (input.whatsappPhone || "").trim()
    );

  if (whatsappReady) {
    return {
      channel: "whatsapp",
      reason: "whatsapp_preferred",
    };
  }

  const emailReady =
    input.emailEnabled &&
    input.emailOptIn &&
    Boolean(input.emailOptInAt) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      (input.email || "").trim()
    );

  if (emailReady) {
    return {
      channel: "email",
      reason: "email_fallback",
    };
  }

  return none("no_authorized_channel");
}