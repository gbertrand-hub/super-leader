import test from "node:test";
import assert from "node:assert/strict";

import {
  selectCantonFeedbackChannel,
} from "../src/lib/canton/feedback-channel-selection.ts";

const valid = {
  visitCompleted: true,
  feedbackAlreadyReceived: false,
  invitationAlreadyProcessed: false,

  whatsappEnabled: true,
  whatsappOptIn: true,
  whatsappOptInAt: "2026-11-27T09:00:00Z",
  whatsappPhone: "+17375004840",

  emailEnabled: true,
  emailOptIn: true,
  emailOptInAt: "2026-11-27T09:00:00Z",
  email: "visitor@example.com",
};

function expectChannel(changes, expected) {
  const result = selectCantonFeedbackChannel({
    ...valid,
    ...changes,
  });

  assert.equal(result.channel, expected);
}

test("WhatsApp takes priority", () => {
  expectChannel({}, "whatsapp");
});

test("Email fallback when WhatsApp disabled", () => {
  expectChannel({whatsappEnabled: false}, "email");
});

test("Email fallback without WhatsApp consent", () => {
  expectChannel({whatsappOptIn: false}, "email");
});

test("Email fallback with invalid WhatsApp phone", () => {
  expectChannel({whatsappPhone: "12345"}, "email");
});

test("No channel without consent", () => {
  expectChannel({
    whatsappOptIn: false,
    emailOptIn: false,
  }, null);
});

test("No channel when both automations disabled", () => {
  expectChannel({
    whatsappEnabled: false,
    emailEnabled: false,
  }, null);
});

test("No invitation before visit completion", () => {
  expectChannel({visitCompleted: false}, null);
});

test("No invitation after feedback received", () => {
  expectChannel({feedbackAlreadyReceived: true}, null);
});

test("No duplicate invitation", () => {
  expectChannel({invitationAlreadyProcessed: true}, null);
});

test("Missing WhatsApp consent timestamp uses email", () => {
  expectChannel({whatsappOptInAt: null}, "email");
});

test("Missing email consent timestamp blocks email", () => {
  expectChannel({
    whatsappEnabled: false,
    emailOptInAt: null,
  }, null);
});

test("Invalid email blocks fallback", () => {
  expectChannel({
    whatsappEnabled: false,
    email: "invalid-email",
  }, null);
});