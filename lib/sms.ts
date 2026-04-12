import { loadConfig } from "./config";
import { getMode } from "./mode";

export async function sendSMS(
  phone: string,
  message: string,
  contactId?: string
): Promise<void> {
  const cfg = loadConfig();
  const mode = await getMode();
  const testContactId = process.env.SMS_TEST_ROUTE_CONTACT_ID;

  // TEST mode = nothing sends. Full dry-run. Safest state.
  if (mode === "test" || cfg.ghl?.dryRun) {
    console.log(`[TEST — NOT SENT] phone=${phone} contactId=${contactId}: ${message}`);
    return;
  }

  // LIVE mode: if test route contactId is configured, all sends redirect there.
  // Remove SMS_TEST_ROUTE_CONTACT_ID from the environment to release to real clients.
  const effectiveContactId = testContactId || contactId;

  if (!cfg.ghl?.apiKey) throw new Error("GHL_API_KEY missing");
  if (!effectiveContactId) throw new Error("No contactId available for LIVE send");

  if (testContactId) {
    console.log(`[LIVE — routed to test contact] real contactId=${contactId} phone=${phone} → test contactId=${testContactId}`);
  } else {
    console.log(`[LIVE — real client] contactId=${contactId} phone=${phone}`);
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
