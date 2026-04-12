import { loadConfig } from "./config";

export async function sendSMS(
  phone: string,
  message: string,
  contactId?: string
): Promise<void> {
  const cfg = loadConfig();
  const routeContactId = process.env.SMS_TEST_ROUTE_CONTACT_ID;
  const effectiveContactId = routeContactId || contactId;

  if (cfg.ghl?.dryRun) {
    console.log(`[DRY-RUN SMS] phone=${phone} contactId=${effectiveContactId}: ${message}`);
    return;
  }
  if (!cfg.ghl?.apiKey) throw new Error("GHL_API_KEY missing");
  if (!effectiveContactId) throw new Error("No contactId and no SMS_TEST_ROUTE_CONTACT_ID set — refusing to send without a target contact");

  if (routeContactId) {
    console.log(`[TEST ROUTE] Redirecting SMS intended for contactId=${contactId} (phone=${phone}) → test contactId=${routeContactId}`);
  }

  const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.ghl.apiKey}`,
      Version: "2021-04-15",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "SMS",
      contactId: effectiveContactId,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL SMS send failed: ${res.status} ${body}`);
  }
}
