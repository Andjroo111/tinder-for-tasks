import { upsertCard } from "../lib/cards";

const now = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const tue = new Date(now); tue.setDate(tue.getDate() + ((2 - tue.getDay() + 7) % 7 || 7));
const wed = new Date(tue); wed.setDate(wed.getDate() + 1);

await upsertCard({
  contactId: "seed-rachel-1",
  contactName: "Rachel Morgan",
  dogName: "Rocky",
  phone: "+19135551234",
  triggerEvent: "inbound_sms",
  clientMessage: "Can we do Tuesday or Wednesday this week?",
  conversationHistory: [
    { from: "client", text: "Can we do Tuesday or Wednesday this week?", timestamp: new Date(now.getTime() - 15 * 60000).toISOString() },
  ],
  draftResponse: "Tuesday at 1pm works great! I'll see you and Rocky then.",
  reasoning: "Client asked about scheduling — Tuesday 1pm is the cleanest block.",
  tier: 3,
  calendarContext: {
    fetchedAt: new Date().toISOString(),
    requestedDays: [iso(tue), iso(wed)],
    slots: [
      {
        date: iso(tue),
        blocks: [
          { start: "09:00", end: "11:00", status: "open" },
          { start: "11:00", end: "12:30", status: "blocked", label: "Blair In-Home" },
          { start: "13:00", end: "15:30", status: "open" },
          { start: "15:30", end: "17:00", status: "blocked", label: "P&D pickup" },
        ],
      },
      {
        date: iso(wed),
        note: "kid week",
        blocks: [
          { start: "09:00", end: "14:00", status: "open" },
          { start: "14:00", end: "16:00", status: "blocked", label: "B&T walk" },
          { start: "16:30", end: "17:30", status: "blocked", label: "Gymnastics" },
        ],
      },
    ],
  },
  suggestedSlots: [new Date(tue.setHours(13, 0, 0, 0)).toISOString(), new Date(wed.setHours(9, 0, 0, 0)).toISOString()],
});

await upsertCard({
  contactId: "seed-stef-1",
  contactName: "Stef Patel",
  phone: "+19135559876",
  triggerEvent: "inbound_sms",
  clientMessage: "How much is the board and train program?",
  conversationHistory: [
    { from: "client", text: "How much is the board and train program?", timestamp: new Date().toISOString() },
  ],
  draftResponse: "Great question! The 3-Week Foundation Board & Train is $3,400 and is our most popular. Want me to send over the full proposal?",
  reasoning: "Pricing question — Tier 4, never auto-send.",
  tier: 4,
});

console.log("Seeded 2 cards.");
