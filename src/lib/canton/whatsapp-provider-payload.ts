/**
 * WhatsApp Cloud API payload for the separately approved Canton visitor template.
 * No network requests or database access. The approved Meta template must use:
 * body {{1}} = visitor name, body {{2}} = site name;
 * button URL suffix {{1}} = Canton feedback UUID token.
 */
export type CantonMetaTemplateLanguage = "fr" | "en";

export function buildCantonMetaTemplatePayload(input: {
  recipient: string;
  visitorName: string;
  siteName: string;
  token: string;
  templateName: string;
  language: CantonMetaTemplateLanguage;
  frCode?: string;
  enCode?: string;
}) {
  const phone = input.recipient.trim();
  const name = input.visitorName.trim();
  const site = input.siteName.trim();
  const template = input.templateName.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Invalid WhatsApp recipient");
  if (!name || !site || !/^[a-z0-9_]{2,100}$/.test(template)) {
    throw new Error("Invalid Canton WhatsApp template configuration");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.token)) {
    throw new Error("Invalid Canton feedback token");
  }
  const code = input.language === "fr" ? input.frCode || "fr" : input.enCode || "en_US";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(code)) throw new Error("Invalid Meta template locale");
  return {
    messaging_product: "whatsapp" as const,
    to: phone.slice(1),
    type: "template" as const,
    template: {
      name: template,
      language: {code},
      components: [
        {type: "body" as const, parameters: [
          {type: "text" as const, text: name},
          {type: "text" as const, text: site},
        ]},
        {type: "button" as const, sub_type: "url" as const, index: "0", parameters: [
          {type: "text" as const, text: input.token},
        ]},
      ],
    },
  };
}
