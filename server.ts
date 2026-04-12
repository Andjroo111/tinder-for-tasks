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
import type { CardCreatePayload } from "./lib/types";

const app = new Hono();

app.post("/api/cards", async (c) => {
  const payload = (await c.req.json()) as CardCreatePayload;
  if (!payload.contactId || !payload.phone || !payload.draftResponse) {
    return c.json({ error: "missing required fields" }, 400);
  }

  if (payload.tier === 1 || payload.tier === 2) {
    try {
      await sendSMS(payload.phone, payload.draftResponse);
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
    await sendSMS(card.phone, card.draftResponse);
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
    await sendSMS(card.phone, body.editedDraft);
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

app.post("/api/cards/:id/snooze", async (c) => {
  const body = (await c.req.json()) as { duration: "1h" | "3h" | "tomorrow" };
  const now = new Date();
  let until: Date;
  switch (body.duration) {
    case "1h":
      until = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    case "3h":
      until = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      break;
    case "tomorrow":
      until = new Date(now);
      until.setDate(until.getDate() + 1);
      until.setHours(8, 0, 0, 0);
      break;
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

app.get("/api/health", (c) => c.json({ ok: true }));

app.use("/*", serveStatic({ root: "./public" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

const cfg = loadConfig();
console.log(`Tinder for Tasks listening on :${cfg.port} (dryRun=${cfg.ghl?.dryRun})`);

export default {
  port: cfg.port,
  fetch: app.fetch,
};
