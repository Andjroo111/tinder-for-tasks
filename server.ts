import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { loadConfig } from "./lib/config";
import {
  listCards,
  getCard,
  upsertCard,
  updateStatus,
  snoozeCard,
  logAutoSend,
  listAutoSends,
} from "./lib/cards";
import { sendSMS } from "./lib/sms";
import { logEditFeedback } from "./lib/feedback";
import { transcribeAudio } from "./lib/transcribe";
import { isAuthEnabled, verifyPassword, makeToken, verifyToken, cookieHeader, parseCookie } from "./lib/auth";
import { getMode, setMode } from "./lib/mode";
import type { CardCreatePayload } from "./lib/types";

const app = new Hono();

app.use("*", async (c, next) => {
  if (!isAuthEnabled()) return next();
  const path = c.req.path;
  if (
    path === "/login" || path === "/api/login" ||
    path === "/login.html" || path === "/login.css" || path === "/login.js" ||
    path === "/api/health" || path === "/manifest.json" || path === "/icon.svg" ||
    path === "/sw.js" || path === "/reset"
  ) return next();

  // Hermes posts cards without a cookie — allow via shared secret header
  if (path === "/api/cards" && c.req.method === "POST") {
    const secret = c.req.header("X-Hermes-Secret");
    if (secret && process.env.HERMES_SECRET && secret === process.env.HERMES_SECRET) return next();
  }

  const token = parseCookie(c.req.header("Cookie") || null);
  if (verifyToken(token)) return next();

  if (path.startsWith("/api/")) return c.json({ error: "unauthorized" }, 401);
  return c.redirect("/login");
});

app.post("/api/login", async (c) => {
  const body = (await c.req.json()) as { password?: string };
  if (!verifyPassword(body.password || "")) return c.json({ error: "wrong password" }, 401);
  const token = makeToken();
  c.header("Set-Cookie", cookieHeader(token, c.req.url.startsWith("https://")));
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", `tft_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return c.json({ ok: true });
});

app.post("/api/cards", async (c) => {
  const payload = (await c.req.json()) as CardCreatePayload;
  if (!payload.contactId || !payload.phone || !payload.draftResponse) {
    return c.json({ error: "missing required fields" }, 400);
  }

  if (payload.tier === 1 || payload.tier === 2) {
    try {
      await sendSMS(payload.phone, payload.draftResponse, payload.contactId);
      await logAutoSend({
        contactId: payload.contactId,
        contactName: payload.contactName,
        phone: payload.phone,
        tier: payload.tier,
        message: payload.draftResponse,
        sentAt: new Date().toISOString(),
        triggerEvent: payload.triggerEvent,
      });
      return c.json({ autoSent: true, tier: payload.tier });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  }

  const card = await upsertCard(payload);
  return c.json({ card });
});

app.get("/api/cards", async (c) => {
  const cards = await listCards();
  return c.json({ cards });
});

app.post("/api/cards/:id/approve", async (c) => {
  const card = await getCard(c.req.param("id"));
  if (!card) return c.json({ error: "not found" }, 404);
  try {
    await sendSMS(card.phone, card.draftResponse, card.contactId);
    await updateStatus(card.cardId, "sent");
    return c.json({ sent: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post("/api/cards/:id/skip", async (c) => {
  const card = await updateStatus(c.req.param("id"), "skipped");
  if (!card) return c.json({ error: "not found" }, 404);
  return c.json({ skipped: true });
});

app.post("/api/cards/:id/edit", async (c) => {
  const card = await getCard(c.req.param("id"));
  if (!card) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json()) as {
    editedDraft: string;
    tags?: string[];
    voiceNoteUrl?: string;
  };
  if (!body.editedDraft) return c.json({ error: "editedDraft required" }, 400);

  try {
    await sendSMS(card.phone, body.editedDraft, card.contactId);
    await logEditFeedback({
      cardId: card.cardId,
      contactName: card.contactName,
      triggerEvent: card.triggerEvent,
      originalDraft: card.draftResponse,
      editedDraft: body.editedDraft,
      tags: body.tags ?? [],
      voiceNoteUrl: body.voiceNoteUrl,
      timestamp: new Date().toISOString(),
    });
    await updateStatus(card.cardId, "sent", { draftResponse: body.editedDraft });
    return c.json({ sent: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

function nextTime(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= Date.now() + 15 * 60000) d.setDate(d.getDate() + 1);
  return d;
}

app.post("/api/cards/:id/snooze", async (c) => {
  const body = (await c.req.json()) as { duration: string; hours?: number };
  const now = new Date();
  let until: Date;
  switch (body.duration) {
    case "later":
      until = new Date(now.getTime() + 90 * 60 * 1000);
      break;
    case "afternoon":
      until = nextTime(14, 0);
      break;
    case "evening":
      until = nextTime(18, 0);
      break;
    case "tomorrow":
      until = new Date(now);
      until.setDate(until.getDate() + 1);
      until.setHours(8, 0, 0, 0);
      break;
    case "custom":
      if (!body.hours || body.hours < 1 || body.hours > 168) return c.json({ error: "hours must be 1-168" }, 400);
      until = new Date(now.getTime() + body.hours * 60 * 60 * 1000);
      break;
    // legacy aliases
    case "1h": until = new Date(now.getTime() + 60 * 60 * 1000); break;
    case "3h": until = new Date(now.getTime() + 3 * 60 * 60 * 1000); break;
    case "tonight": until = nextTime(18, 0); break;
    default:
      return c.json({ error: "invalid duration" }, 400);
  }
  const card = await snoozeCard(c.req.param("id"), until.toISOString());
  if (!card) return c.json({ error: "not found" }, 404);
  return c.json({ snoozedUntil: until.toISOString() });
});

app.get("/api/auto-sends", async (c) => {
  const entries = await listAutoSends(50);
  return c.json({ entries });
});

app.get("/api/dashboard", async (c) => {
  const cards = await listCards();
  const autoSends = await listAutoSends(20);
  const today = new Date().toISOString().slice(0, 10);
  const autoSendsToday = autoSends.filter((e) => e.sentAt.startsWith(today));
  return c.json({
    pendingCount: cards.length,
    autoSendsToday: autoSendsToday.length,
    recentAutoSends: autoSends.slice(0, 5),
    nextAppointments: [],
    pipeline: { newLeads: 0, awaitingReply: 0 },
  });
});

app.post("/api/transcribe", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("audio") as File | null;
    if (!file) return c.json({ error: "audio file required" }, 400);
    const text = await transcribeAudio(file, file.name || "audio.webm");
    return c.json({ text });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get("/api/health", (c) => c.json({ ok: !!process.env.GROQ_API_KEY ? true : "ok-no-groq" }));

app.get("/api/mode", async (c) => {
  const mode = await getMode();
  const testContactSet = !!process.env.SMS_TEST_ROUTE_CONTACT_ID;
  return c.json({ mode, testContactSet });
});

app.post("/api/mode", async (c) => {
  const body = (await c.req.json()) as { mode: "live" | "test" };
  if (body.mode !== "live" && body.mode !== "test") return c.json({ error: "invalid mode" }, 400);
  await setMode(body.mode);
  return c.json({ mode: body.mode });
});


// Nuke-cache escape hatch — visit https://tasks.gooddogzkc.com/reset from any browser.
// Uses Clear-Site-Data HTTP header — browser clears everything even if SW is stuck.
app.get("/reset", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Clear-Site-Data", '"cache", "cookies", "storage", "executionContexts"');
  return c.html(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset</title></head>
<body style="background:#0f0f14;color:#f4f4f8;font-family:system-ui;padding:40px;text-align:center;margin:0;min-height:100vh">
<div style="max-width:320px;margin:60px auto">
  <div style="font-size:48px;margin-bottom:20px">🧹</div>
  <h2 style="margin:0 0 16px">Cache cleared</h2>
  <p id="status" style="color:#8b8ba0;margin:0 0 24px">Finishing up…</p>
  <a href="/login?fresh=1" style="display:inline-block;background:#22c55e;color:#0b2a1c;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700">Open app →</a>
</div>
<script>
(async () => {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    try { localStorage.clear(); sessionStorage.clear(); } catch(e){}
    document.getElementById("status").textContent = "All clear — tap below to sign in.";
  } catch (e) { document.getElementById("status").textContent = "Reset ok — tap below."; }
})();
</script></body></html>`);
});

// Prevent stale caches for HTML/JS/CSS so refresh pulls new versions
app.use("/*", async (c, next) => {
  await next();
  const p = c.req.path;
  if (p === "/" || p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css") || p === "/manifest.json") {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  }
});
app.get("/login", serveStatic({ path: "./public/login.html" }));
app.use("/*", serveStatic({ root: "./public" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

const cfg = loadConfig();
console.log(`Tinder for Tasks listening on :${cfg.port} (dryRun=${cfg.ghl?.dryRun})`);

export default {
  port: cfg.port,
  fetch: app.fetch,
};
