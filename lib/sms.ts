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
  const useTestRoute = mode === "test" && !!testContactId;
  const effectiveContactId = useTestRoute ? testContactId : contactId;

  if (cfg.ghl?.dryRun) {
    console.log(`[DRY-RUN SMS] mode=${mode} phone=${phone} contactId=${effectiveContactId}: ${message}`);
    return;
  }
  if (!cfg.ghl?.apiKey) throw new Error("GHL_API_KEY missing");
  if (!effectiveContactId) throw new Error(`No contactId available (mode=${mode}, test route set=${!!testContactId})`);

  if (useTestRoute) {
    console.log(`[TEST MODE] Redirecting SMS intended for contactId=${contactId} (phone=${phone}) → test contactId=${testContactId}`);
  } else if (mode === "live") {
    console.log(`[LIVE] Sending SMS to real contactId=${contactId} (phone=${phone})`);
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
