import { loadConfig } from "./config";

export async function sendSMS(phone: string, message: string): Promise<void> {
  const cfg = loadConfig();
  if (cfg.ghl?.dryRun) {
    console.log(`[DRY-RUN SMS] ${phone}: ${message}`);
    return;
  }
  if (!cfg.ghl?.apiKey || !cfg.ghl?.locationId) {
    throw new Error("GHL config missing (apiKey, locationId)");
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
      contactId: phone,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL SMS send failed: ${res.status} ${body}`);
  }
}
