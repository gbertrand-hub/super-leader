import type {SupabaseClient} from "@supabase/supabase-js";
import {normalizeTimeZone} from "@/lib/timezone";
import {sendNotificationEmail} from "@/lib/notifications/email";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";

type FinanceSettings = {
  organization_id: string;
  reminders_enabled: boolean;
  reminder_days_before_due: number;
  reminder_days_after_due: number[] | null;
  email_reminders_enabled: boolean;
  in_app_reminders_enabled: boolean;
  controller_user_id: string | null;
};

type SaleRow = {
  id: string;
  organization_id: string;
  customer_name: string;
  customer_email: string | null;
  product_name: string;
  currency: string;
  balance_amount: number | string;
  next_payment_due_date: string | null;
  collection_owner_id: string | null;
  collection_promise_date: string | null;
  collection_status: string;
  workflow_status: string;
};

type MembershipRow = {
  organization_id: string;
  user_id: string;
  role: string;
};

type ContractRow = {sale_id: string | null; client_id: string};
type ClientRow = {
  id: string;
  full_name: string;
  email: string | null;
  preferred_language: "fr" | "en";
  do_not_contact: boolean;
};

type ReminderRule = {
  kind: "before_due" | "after_due" | "broken_promise";
  days: number;
  key: string;
};

type RunCounters = {
  organizationsScanned: number;
  salesScanned: number;
  remindersCreated: number;
  internalNotificationsCreated: number;
  customerEmailsSent: number;
  skipped: number;
  failed: number;
};

const n = (value: unknown) => Number(value) || 0;

function localDate(timeZone: string | null | undefined) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone || "UTC"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dayDiff(later: string, earlier: string) {
  return Math.max(
    0,
    Math.floor(
      (new Date(`${later}T00:00:00Z`).getTime() - new Date(`${earlier}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );
}

function money(amount: number, currency: string, locale: "fr" | "en" = "fr") {
  try {
    return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "XAF" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function rulesForSale(sale: SaleRow, settings: FinanceSettings, today: string): ReminderRule[] {
  const rules: ReminderRule[] = [];
  const dueDate = sale.next_payment_due_date;
  const promiseDate = sale.collection_promise_date;

  if (dueDate) {
    const beforeDays = Math.max(0, Number(settings.reminder_days_before_due) || 0);
    if (today === addDays(dueDate, -beforeDays)) {
      rules.push({kind: "before_due", days: beforeDays, key: `before:${dueDate}:${beforeDays}`});
    }

    if (dueDate < today) {
      const late = dayDiff(today, dueDate);
      const afterDays = [...new Set((settings.reminder_days_after_due ?? []).map(Number))]
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 3650);
      if (afterDays.includes(late)) {
        rules.push({kind: "after_due", days: late, key: `after:${dueDate}:${late}`});
      }
    }
  }

  if (promiseDate && promiseDate < today && n(sale.balance_amount) > 0) {
    rules.push({kind: "broken_promise", days: dayDiff(today, promiseDate), key: `promise:${promiseDate}`});
  }

  return rules;
}

function internalCopy(rule: ReminderRule, sale: SaleRow, amount: number) {
  const amountFr = money(amount, sale.currency, "fr");
  const amountEn = money(amount, sale.currency, "en");
  const due = sale.next_payment_due_date ?? "—";

  if (rule.kind === "before_due") {
    return {
      priority: "info" as const,
      titleFr: `Échéance dans ${rule.days} jour(s) — ${sale.customer_name}`,
      titleEn: `Payment due in ${rule.days} day(s) — ${sale.customer_name}`,
      bodyFr: `${sale.product_name} : ${amountFr} restent à recouvrer. Échéance prévue le ${due}.`,
      bodyEn: `${sale.product_name}: ${amountEn} remains outstanding. Due date: ${due}.`,
    };
  }

  if (rule.kind === "after_due") {
    return {
      priority: rule.days >= 15 ? "urgent" as const : "warning" as const,
      titleFr: `Créance en retard de ${rule.days} jour(s) — ${sale.customer_name}`,
      titleEn: `Receivable overdue by ${rule.days} day(s) — ${sale.customer_name}`,
      bodyFr: `${sale.product_name} : ${amountFr} restent impayés depuis l’échéance du ${due}.`,
      bodyEn: `${sale.product_name}: ${amountEn} remains unpaid since the ${due} due date.`,
    };
  }

  return {
    priority: "urgent" as const,
    titleFr: `Promesse de paiement non tenue — ${sale.customer_name}`,
    titleEn: `Broken payment promise — ${sale.customer_name}`,
    bodyFr: `${sale.product_name} : la promesse du ${sale.collection_promise_date ?? "—"} est dépassée et ${amountFr} restent à recouvrer. Une intervention humaine est requise.`,
    bodyEn: `${sale.product_name}: the ${sale.collection_promise_date ?? "—"} promise date has passed and ${amountEn} remains outstanding. Human follow-up is required.`,
  };
}

function customerCopy(rule: ReminderRule, sale: SaleRow, amount: number, locale: "fr" | "en") {
  const amountText = money(amount, sale.currency, locale);
  const due = sale.next_payment_due_date ?? "—";
  const customer = sale.customer_name || (locale === "fr" ? "Client" : "Customer");

  if (locale === "fr") {
    if (rule.kind === "before_due") {
      return {
        title: `Rappel d’échéance — ${sale.product_name}`,
        body: `Bonjour ${customer}, nous vous rappelons que le solde de ${amountText} relatif à ${sale.product_name} arrive à échéance le ${due}. Si le paiement a déjà été effectué, merci d’ignorer ce rappel et de transmettre la référence à votre interlocuteur habituel.`,
      };
    }
    return {
      title: `Rappel de paiement — ${sale.product_name}`,
      body: `Bonjour ${customer}, notre suivi indique un solde de ${amountText} arrivé à échéance le ${due}. Si le règlement a déjà été effectué, merci de transmettre la référence de paiement à votre interlocuteur habituel afin que l’équipe Finance puisse effectuer le contrôle bancaire.`,
    };
  }

  if (rule.kind === "before_due") {
    return {
      title: `Payment due reminder — ${sale.product_name}`,
      body: `Hello ${customer}, this is a reminder that the ${amountText} outstanding balance for ${sale.product_name} is due on ${due}. If payment has already been made, please ignore this reminder and share the payment reference with your usual contact.`,
    };
  }
  return {
    title: `Payment reminder — ${sale.product_name}`,
    body: `Hello ${customer}, our records show an outstanding balance of ${amountText} that was due on ${due}. If payment has already been made, please share the payment reference with your usual contact so Finance can complete bank verification.`,
  };
}

async function reserveReminder(
  admin: SupabaseClient,
  sale: SaleRow,
  rule: ReminderRule,
  recipientId: string | null,
  settings: FinanceSettings,
) {
  const {data, error} = await admin
    .from("finance_collection_reminders")
    .upsert({
      organization_id: sale.organization_id,
      sale_id: sale.id,
      reminder_key: rule.key,
      rule_kind: rule.kind,
      rule_days: rule.days,
      due_date: sale.next_payment_due_date,
      promise_date: sale.collection_promise_date,
      outstanding_amount: n(sale.balance_amount),
      currency: sale.currency || "USD",
      internal_recipient_id: recipientId,
      in_app_requested: settings.in_app_reminders_enabled,
      email_requested: settings.email_reminders_enabled && rule.kind !== "broken_promise",
      status: "processing",
    }, {onConflict: "organization_id,sale_id,reminder_key", ignoreDuplicates: true})
    .select("id")
    .maybeSingle<{id: string}>();

  if (error) throw error;
  return data?.id ?? null;
}

async function processOrganization(
  admin: SupabaseClient,
  settings: FinanceSettings,
  organizationName: string,
  timezone: string,
  members: MembershipRow[],
  counters: RunCounters,
) {
  const today = localDate(timezone);
  counters.organizationsScanned += 1;

  const {data: salesData, error: salesError} = await admin
    .from("sales_records")
    .select("id,organization_id,customer_name,customer_email,product_name,currency,balance_amount,next_payment_due_date,collection_owner_id,collection_promise_date,collection_status,workflow_status")
    .eq("organization_id", settings.organization_id)
    .gt("balance_amount", 0)
    .not("workflow_status", "in", "(rejected,cancelled,refunded)")
    .limit(1000);
  if (salesError) throw salesError;

  const sales = (salesData ?? []) as SaleRow[];
  counters.salesScanned += sales.length;
  if (!sales.length) return;

  const saleIds = sales.map((sale) => sale.id);
  const {data: contractRows} = await admin
    .from("crm_contracts")
    .select("sale_id,client_id")
    .eq("organization_id", settings.organization_id)
    .in("sale_id", saleIds);
  const contracts = (contractRows ?? []) as ContractRow[];
  const clientIds = [...new Set(contracts.map((row) => row.client_id).filter(Boolean))];
  const {data: clientRows} = clientIds.length
    ? await admin
      .from("crm_clients")
      .select("id,full_name,email,preferred_language,do_not_contact")
      .eq("organization_id", settings.organization_id)
      .in("id", clientIds)
    : {data: []};
  const clients = (clientRows ?? []) as ClientRow[];
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const clientBySale = new Map<string, ClientRow>();
  contracts.forEach((contract) => {
    const client = clientById.get(contract.client_id);
    if (contract.sale_id && client && !clientBySale.has(contract.sale_id)) clientBySale.set(contract.sale_id, client);
  });

  const activeMemberIds = new Set(members.map((member) => member.user_id));
  const fallbackMember = members.find((member) => member.role === "owner")
    ?? members.find((member) => member.role === "admin")
    ?? members[0];

  for (const sale of sales) {
    const rules = rulesForSale(sale, settings, today);
    if (!rules.length) continue;

    const internalRecipient = sale.collection_owner_id && activeMemberIds.has(sale.collection_owner_id)
      ? sale.collection_owner_id
      : settings.controller_user_id && activeMemberIds.has(settings.controller_user_id)
        ? settings.controller_user_id
        : fallbackMember?.user_id ?? null;
    const client = clientBySale.get(sale.id);

    for (const rule of rules) {
      let reminderId: string | null = null;
      try {
        reminderId = await reserveReminder(admin, sale, rule, internalRecipient, settings);
        if (!reminderId) continue;
        counters.remindersCreated += 1;

        const errors: string[] = [];
        let inAppCreated = false;
        let emailSent = false;
        let customerSuppressed = false;
        let notificationId: string | null = null;
        let emailProviderMessageId: string | null = null;

        if (settings.in_app_reminders_enabled) {
          if (!internalRecipient) {
            errors.push("Aucun responsable interne actif n'est disponible pour la notification.");
          } else {
            const copy = internalCopy(rule, sale, n(sale.balance_amount));
            notificationId = await createNotification({
              organizationId: settings.organization_id,
              userId: internalRecipient,
              category: "collections",
              eventType: `finance_collection_${rule.kind}`,
              titleFr: copy.titleFr,
              titleEn: copy.titleEn,
              bodyFr: copy.bodyFr,
              bodyEn: copy.bodyEn,
              actionUrl: `/dashboard/collections?sale=${sale.id}`,
              priority: copy.priority,
              requiresAction: rule.kind !== "before_due",
              dedupeKey: `finance-collection:${sale.id}:${rule.key}`,
              metadata: {saleId: sale.id, ruleKind: rule.kind, ruleDays: rule.days, dueDate: sale.next_payment_due_date},
              emailRequested: false,
            });
            inAppCreated = Boolean(notificationId);
            if (inAppCreated) counters.internalNotificationsCreated += 1;
            else errors.push("La notification interne n'a pas pu être créée.");
          }
        }

        const promiseActive = Boolean(sale.collection_promise_date && sale.collection_promise_date >= today);
        const customerEmail = String(client?.email || sale.customer_email || "").trim();
        const doNotContact = Boolean(client?.do_not_contact);
        const externalEnabled = settings.email_reminders_enabled && rule.kind !== "broken_promise";

        if (externalEnabled) {
          if (doNotContact) {
            customerSuppressed = true;
          } else if (promiseActive) {
            customerSuppressed = true;
          } else if (!customerEmail) {
            customerSuppressed = true;
          } else {
            const locale = client?.preferred_language === "en" ? "en" : "fr";
            const copy = customerCopy(rule, sale, n(sale.balance_amount), locale);
            const result = await sendNotificationEmail({
              to: customerEmail,
              locale,
              titleFr: copy.title,
              titleEn: copy.title,
              bodyFr: copy.body,
              bodyEn: copy.body,
              priority: rule.kind === "after_due" && rule.days >= 15 ? "urgent" : rule.kind === "after_due" ? "warning" : "info",
              organizationName,
            });
            emailSent = result.sent;
            emailProviderMessageId = result.providerMessageId ?? null;
            if (emailSent) counters.customerEmailsSent += 1;
            else errors.push(result.configurationMissing
              ? "E-mail client non envoyé : fournisseur e-mail non configuré."
              : `E-mail client non envoyé : ${result.error || "erreur fournisseur"}`);
          }
        }

        const requestedCount = Number(settings.in_app_reminders_enabled) + Number(externalEnabled);
        const deliveredCount = Number(inAppCreated) + Number(emailSent);
        const status = requestedCount === 0 || (deliveredCount === 0 && customerSuppressed && !errors.length)
          ? "skipped"
          : deliveredCount === 0 && errors.length
            ? "failed"
            : errors.length
              ? "partial"
              : "sent";

        if (status === "skipped") counters.skipped += 1;
        if (status === "failed") counters.failed += 1;

        await admin.from("finance_collection_reminders").update({
          internal_notification_id: notificationId,
          in_app_created: inAppCreated,
          email_sent: emailSent,
          email_provider_message_id: emailProviderMessageId,
          customer_contact_suppressed: customerSuppressed,
          status,
          last_error: errors.length ? errors.join(" ").slice(0, 1200) : null,
          processed_at: new Date().toISOString(),
        }).eq("id", reminderId);
      } catch (error) {
        counters.failed += 1;
        const message = error instanceof Error ? error.message : "Erreur inconnue de relance Finance.";
        if (reminderId) {
          await admin.from("finance_collection_reminders").update({
            status: "failed",
            last_error: message.slice(0, 1200),
            processed_at: new Date().toISOString(),
          }).eq("id", reminderId);
        }
        console.error("Finance collection reminder failed", {saleId: sale.id, rule: rule.key, error: message});
      }
    }
  }
}

export async function processFinanceCollectionAutomation() {
  const admin = createAdminClient();
  const counters: RunCounters = {
    organizationsScanned: 0,
    salesScanned: 0,
    remindersCreated: 0,
    internalNotificationsCreated: 0,
    customerEmailsSent: 0,
    skipped: 0,
    failed: 0,
  };

  const {data: run, error: runError} = await admin
    .from("finance_collection_automation_runs")
    .insert({status: "running"})
    .select("id")
    .single<{id: string}>();
  if (runError) throw runError;

  try {
    const [{data: settingsRows, error: settingsError}, {data: orgRows}, {data: memberRows}, {data: timezoneRows}] = await Promise.all([
      admin
        .from("finance_settings")
        .select("organization_id,reminders_enabled,reminder_days_before_due,reminder_days_after_due,email_reminders_enabled,in_app_reminders_enabled,controller_user_id")
        .eq("reminders_enabled", true),
      admin.from("organizations").select("id,name"),
      admin.from("organization_members").select("organization_id,user_id,role").eq("is_active", true),
      admin.from("performance_settings").select("organization_id,timezone"),
    ]);
    if (settingsError) throw settingsError;

    const organizations = new Map((orgRows ?? []).map((row) => [String(row.id), String(row.name || "Super Leader")]));
    const timezones = new Map((timezoneRows ?? []).map((row) => [String(row.organization_id), String(row.timezone || "UTC")]));
    const memberships = (memberRows ?? []) as MembershipRow[];

    for (const settings of (settingsRows ?? []) as FinanceSettings[]) {
      const members = memberships.filter((member) => member.organization_id === settings.organization_id);
      await processOrganization(
        admin,
        settings,
        organizations.get(settings.organization_id) ?? "Super Leader",
        timezones.get(settings.organization_id) ?? "UTC",
        members,
        counters,
      );
    }

    const status = counters.failed > 0 ? "partial" : "success";
    await admin.from("finance_collection_automation_runs").update({
      completed_at: new Date().toISOString(),
      status,
      organizations_scanned: counters.organizationsScanned,
      sales_scanned: counters.salesScanned,
      reminders_created: counters.remindersCreated,
      internal_notifications_created: counters.internalNotificationsCreated,
      customer_emails_sent: counters.customerEmailsSent,
      skipped: counters.skipped,
      failed: counters.failed,
    }).eq("id", run.id);

    return counters;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finance collection automation failed.";
    await admin.from("finance_collection_automation_runs").update({
      completed_at: new Date().toISOString(),
      status: "failed",
      organizations_scanned: counters.organizationsScanned,
      sales_scanned: counters.salesScanned,
      reminders_created: counters.remindersCreated,
      internal_notifications_created: counters.internalNotificationsCreated,
      customer_emails_sent: counters.customerEmailsSent,
      skipped: counters.skipped,
      failed: counters.failed + 1,
      last_error: message.slice(0, 1200),
    }).eq("id", run.id);
    throw error;
  }
}
