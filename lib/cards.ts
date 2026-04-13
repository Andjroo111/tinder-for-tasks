import { randomUUID } from "crypto";
import type { Card, CardCreatePayload, CardStatus, AutoSendEntry } from "./types";

const CARDS_PATH = `${import.meta.dir}/../data/cards.json`;
const AUTOSENDS_PATH = `${import.meta.dir}/../data/auto-sends.json`;

interface Store {
  cards: Card[];
}

async function readStore(): Promise<Store> {
  const file = Bun.file(CARDS_PATH);
  if (!(await file.exists())) return { cards: [] };
  try {
    return await file.json();
  } catch {
    return { cards: [] };
  }
}

let writeLock: Promise<void> = Promise.resolve();
async function writeStore(store: Store): Promise<void> {
  writeLock = writeLock.then(() =>
    Bun.write(CARDS_PATH, JSON.stringify(store, null, 2)).then(() => {})
  );
  return writeLock;
}

export async function listCards(includeSnoozed = false): Promise<Card[]> {
  const { cards } = await readStore();
  const now = new Date().toISOString();
  const visible = cards.filter((c) => {
    if (c.status === "sent" || c.status === "skipped") return false;
    if (c.status === "snoozed" && c.snoozedUntil && c.snoozedUntil > now) {
      return includeSnoozed;
    }
    return true;
  });
  return visible.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function getCard(cardId: string): Promise<Card | null> {
  const { cards } = await readStore();
  return cards.find((c) => c.cardId === cardId) ?? null;
}

export async function upsertCard(payload: CardCreatePayload): Promise<Card> {
  const store = await readStore();
  const now = new Date().toISOString();

  const existing = store.cards.find(
    (c) =>
      c.contactId === payload.contactId &&
      (c.status === "pending" || c.status === "snoozed")
  );

  if (existing) {
    const newMessages = payload.conversationHistory ?? [];
    const merged = [...existing.conversationHistory];
    for (const m of newMessages) {
      if (!merged.some((x) => x.timestamp === m.timestamp && x.text === m.text)) {
        merged.push(m);
      }
    }
    existing.conversationHistory = merged;
    existing.draftResponse = payload.draftResponse;
    existing.reasoning = payload.reasoning ?? existing.reasoning;
    existing.tier = payload.tier;
    existing.calendarContext = payload.calendarContext ?? existing.calendarContext;
    existing.suggestedSlots = payload.suggestedSlots ?? existing.suggestedSlots;
    existing.clientMessage = payload.clientMessage ?? existing.clientMessage;
    // Scheduling-override fields (only meaningful for scheduling_override cards)
    existing.overrideRequestId = payload.overrideRequestId ?? existing.overrideRequestId;
    existing.requestedSlot = payload.requestedSlot ?? existing.requestedSlot;
    existing.tierConflict = payload.tierConflict ?? existing.tierConflict;
    existing.driveTimeFromPrevMin = payload.driveTimeFromPrevMin ?? existing.driveTimeFromPrevMin;
    existing.alternativeSlots = payload.alternativeSlots ?? existing.alternativeSlots;
    existing.approveUrl = payload.approveUrl ?? existing.approveUrl;
    existing.rejectUrl = payload.rejectUrl ?? existing.rejectUrl;
    existing.status = "pending";
    existing.snoozedUntil = undefined;
    existing.updatedAt = now;
    await writeStore(store);
    return existing;
  }

  const snoozedInFuture = payload.snoozedUntil && payload.snoozedUntil > now;
  const card: Card = {
    cardId: randomUUID(),
    contactId: payload.contactId,
    contactName: payload.contactName,
    dogName: payload.dogName,
    phone: payload.phone,
    triggerEvent: payload.triggerEvent,
    clientMessage: payload.clientMessage,
    conversationHistory: payload.conversationHistory ?? [],
    draftResponse: payload.draftResponse,
    reasoning: payload.reasoning,
    tier: payload.tier,
    calendarContext: payload.calendarContext,
    suggestedSlots: payload.suggestedSlots,
    status: snoozedInFuture ? "snoozed" : "pending",
    snoozedUntil: snoozedInFuture ? payload.snoozedUntil : undefined,
    createdAt: now,
    updatedAt: now,
    overrideRequestId: payload.overrideRequestId,
    requestedSlot: payload.requestedSlot,
    tierConflict: payload.tierConflict,
    driveTimeFromPrevMin: payload.driveTimeFromPrevMin,
    alternativeSlots: payload.alternativeSlots,
    approveUrl: payload.approveUrl,
    rejectUrl: payload.rejectUrl,
  };
  store.cards.push(card);
  await writeStore(store);
  return card;
}

export async function updateStatus(
  cardId: string,
  status: CardStatus,
  extra?: Partial<Card>
): Promise<Card | null> {
  const store = await readStore();
  const card = store.cards.find((c) => c.cardId === cardId);
  if (!card) return null;
  card.status = status;
  card.updatedAt = new Date().toISOString();
  if (extra) Object.assign(card, extra);
  await writeStore(store);
  return card;
}

export async function snoozeCard(cardId: string, until: string): Promise<Card | null> {
  return updateStatus(cardId, "snoozed", { snoozedUntil: until });
}

export async function logAutoSend(entry: AutoSendEntry): Promise<void> {
  const file = Bun.file(AUTOSENDS_PATH);
  let entries: AutoSendEntry[] = [];
  if (await file.exists()) {
    try {
      entries = await file.json();
    } catch {}
  }
  entries.unshift(entry);
  entries = entries.slice(0, 500);
  await Bun.write(AUTOSENDS_PATH, JSON.stringify(entries, null, 2));
}

const ACTIVITY_PATH = `${import.meta.dir}/../data/activity.json`;

export type ActivityAction = "sent" | "thumbs_up" | "edited" | "skipped" | "snoozed";
export interface ActivityEntry {
  action: ActivityAction;
  contactName: string;
  contactId: string;
  preview?: string;
  at: string;
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  const file = Bun.file(ACTIVITY_PATH);
  let entries: ActivityEntry[] = [];
  if (await file.exists()) {
    try {
      entries = await file.json();
    } catch {}
  }
  entries.unshift(entry);
  entries = entries.slice(0, 200);
  await Bun.write(ACTIVITY_PATH, JSON.stringify(entries, null, 2));
}

export async function listActivity(limit = 20): Promise<ActivityEntry[]> {
  const file = Bun.file(ACTIVITY_PATH);
  if (!(await file.exists())) return [];
  try {
    const entries: ActivityEntry[] = await file.json();
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}

export async function listAutoSends(limit = 50): Promise<AutoSendEntry[]> {
  const file = Bun.file(AUTOSENDS_PATH);
  if (!(await file.exists())) return [];
  try {
    const entries: AutoSendEntry[] = await file.json();
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}
