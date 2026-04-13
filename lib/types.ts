export type Tier = 1 | 2 | 3 | 4;

export type CardStatus = "pending" | "snoozed" | "sent" | "skipped";

export type TriggerEvent =
  | "inbound_sms"
  | "new_lead"
  | "scheduling"
  | "scheduling_override"
  | "follow_up"
  | "payment"
  | "briefing"
  | "escalation";

// Shape of the tier conflict carried by a scheduling_override card. Mirrors
// calendar-pwa/lib/types.ts TierConflictInfo but intentionally loose so this
// repo doesn't take a dep on the other one.
export interface SchedulingTierConflict {
  tier: "hard" | "soft" | "flex";
  calendarId?: string;
  eventId?: string;
  eventTitle: string;
  overlapStart: string;
  overlapEnd: string;
}

export interface ConversationMessage {
  from: "client" | "andrew" | "system";
  text: string;
  timestamp: string;
}

export interface CalendarBlock {
  start: string;
  end: string;
  status: "open" | "blocked";
  label?: string;
}

export interface CalendarDay {
  date: string;
  note?: string;
  blocks: CalendarBlock[];
}

export interface CalendarContext {
  fetchedAt: string;
  requestedDays: string[];
  slots: CalendarDay[];
}

export interface Card {
  cardId: string;
  contactId: string;
  contactName: string;
  dogName?: string;
  phone: string;
  triggerEvent: TriggerEvent;
  clientMessage?: string;
  conversationHistory: ConversationMessage[];
  draftResponse: string;
  reasoning?: string;
  tier: Tier;
  calendarContext?: CalendarContext;
  suggestedSlots?: string[];
  status: CardStatus;
  createdAt: string;
  updatedAt: string;
  snoozedUntil?: string;
  // Scheduling-override extras (only set when triggerEvent === "scheduling_override")
  overrideRequestId?: string;
  requestedSlot?: { start: string; end: string };
  tierConflict?: SchedulingTierConflict;
  driveTimeFromPrevMin?: number;
  alternativeSlots?: string[];
  approveUrl?: string;
  rejectUrl?: string;
}

export interface CardCreatePayload {
  cardType?: "scheduling_override" | string;
  contactId: string;
  contactName: string;
  dogName?: string;
  phone: string;
  triggerEvent: TriggerEvent;
  clientMessage?: string;
  conversationHistory?: ConversationMessage[];
  draftResponse: string;
  reasoning?: string;
  tier: Tier;
  calendarContext?: CalendarContext;
  suggestedSlots?: string[];
  snoozedUntil?: string;
  // Scheduling-override extras
  overrideRequestId?: string;
  requestedSlot?: { start: string; end: string };
  tierConflict?: SchedulingTierConflict;
  driveTimeFromPrevMin?: number;
  alternativeSlots?: string[];
  approveUrl?: string;
  rejectUrl?: string;
}

export interface AutoSendEntry {
  contactId: string;
  contactName: string;
  phone: string;
  tier: 1 | 2;
  message: string;
  sentAt: string;
  triggerEvent: TriggerEvent;
}

export interface EditFeedback {
  originalDraft: string;
  editedDraft: string;
  tags: string[];
  voiceNoteUrl?: string;
}
