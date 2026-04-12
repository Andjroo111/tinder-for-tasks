export type Tier = 1 | 2 | 3 | 4;

export type CardStatus = "pending" | "snoozed" | "sent" | "skipped";

export type TriggerEvent =
  | "inbound_sms"
  | "new_lead"
  | "scheduling"
  | "follow_up"
  | "payment"
  | "briefing"
  | "escalation";

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
}

export interface CardCreatePayload {
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
