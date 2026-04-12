import { upsertCard } from "../lib/cards";

const now = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const tue = new Date(now); tue.setDate(tue.getDate() + ((2 - tue.getDay() + 7) % 7 || 7));
const wed = new Date(tue); wed.setDate(wed.getDate() + 1);

// Card 1 — Tier 4 pricing (for edit + tags test)
await upsertCard({
  contactId: "test-1-stef",
  contactName: "Stef Patel",
  phone: "+19135559876",
  triggerEvent: "inbound_sms",
  clientMessage: "How much is the board and train program?",
  draftResponse: "Great question! The 3-Week Foundation Board & Train is $3,400 and is our most popular. Want me to send over the full proposal?",
  tier: 4,
});

// Card 2 — Tier 3 scheduling (for swipe right / calendar display)
await upsertCard({
  contactId: "test-2-rachel",
  contactName: "Rachel Morgan",
  dogName: "Rocky",
  phone: "+19135551234",
  triggerEvent: "inbound_sms",
  clientMessage: "Can we do Tuesday or Wednesday this week?",
  conversationHistory: [
    { from: "andrew", text: "Great session last week! Looking forward to Rocky's next one.", timestamp: new Date(now.getTime() - 7 * 86400000).toISOString() },
    { from: "client", text: "Thanks! He did really well with the place command today.", timestamp: new Date(now.getTime() - 7 * 86400000 + 2 * 3600000).toISOString() },
    { from: "client", text: "Can we do Tuesday or Wednesday this week?", timestamp: new Date(now.getTime() - 15 * 60000).toISOString() },
  ],
  draftResponse: "Tuesday at 1pm works great! I'll see you and Rocky then.",
  tier: 3,
  calendarContext: {
    fetchedAt: new Date().toISOString(),
    requestedDays: [iso(tue), iso(wed)],
    slots: [
      {
        date: iso(tue),
        blocks: [
          { start: "09:00", end: "11:00", status: "open" },
          { start: "11:00", end: "12:30", status: "blocked", label: "Blair" },
          { start: "13:00", end: "15:30", status: "open" },
        ],
      },
      {
        date: iso(wed),
        note: "kid week",
        blocks: [
          { start: "09:00", end: "14:00", status: "open" },
          { start: "16:30", end: "17:30", status: "blocked", label: "Gymnastics" },
        ],
      },
    ],
  },
  suggestedSlots: [new Date(tue.setHours(13, 0, 0, 0)).toISOString()],
});

// Card 3 — Tier 3 new lead from form submission (intro card pattern)
await upsertCard({
  contactId: "test-3-mike",
  contactName: "Mike Johnson",
  dogName: "Duke",
  phone: "+18165551111",
  triggerEvent: "new_lead",
  clientMessage: "Form submission — Duke (2yr Lab), goals: leash pulling, door greeting",
  conversationHistory: [
    { from: "system", text: "Form submission via gooddogzkc.com/contact — Duke (2yr Lab). Goals: leash pulling, door greeting for guests.", timestamp: new Date(now.getTime() - 8 * 60000).toISOString() },
  ],
  draftResponse: "Hey Mike, thanks for reaching out about Duke. Leash pulling and door greeting are two of the most common issues I work on. Want to jump on a quick 10-min call this week so I can ask a couple questions and walk you through how I'd approach it?",
  reasoning: "Form submission with dog name + specific goals — lead with empathy on the behaviors they listed, propose a consultation call.",
  tier: 3,
});

// Card 4 — Tier 3 aged card with thread (for snooze + thread display)
await upsertCard({
  contactId: "test-4-nicole",
  contactName: "Nicole Harnisch",
  dogName: "Bear",
  phone: "+19135552222",
  triggerEvent: "inbound_sms",
  clientMessage: "Hello? Just checking in",
  conversationHistory: [
    { from: "client", text: "Hi! Wondering about next session", timestamp: new Date(now.getTime() - 6 * 3600 * 1000).toISOString() },
    { from: "client", text: "Anyone there?", timestamp: new Date(now.getTime() - 4 * 3600 * 1000).toISOString() },
    { from: "client", text: "Hello? Just checking in", timestamp: new Date(now.getTime() - 10 * 60000).toISOString() },
  ],
  draftResponse: "Hey Nicole! Sorry for the delay — let's get Bear's next session on the books. Does Thursday 10am work?",
  tier: 3,
});

// Card 5 — Tier 3 follow-up with thread
await upsertCard({
  contactId: "test-5-ellie",
  contactName: "Ellie McCroskie",
  dogName: "Luna",
  phone: "+19135553333",
  triggerEvent: "follow_up",
  clientMessage: "Yes that time works!",
  conversationHistory: [
    { from: "andrew", text: "Hey Ellie, is Saturday 10am still good for Luna's next session?", timestamp: new Date(now.getTime() - 90 * 60000).toISOString() },
    { from: "client", text: "Yes that time works!", timestamp: new Date(now.getTime() - 5 * 60000).toISOString() },
  ],
  draftResponse: "Perfect — see you and Luna Saturday at 10am.",
  tier: 3,
});

console.log("Seeded 5 cards: Stef(T4), Rachel(T3+cal), Mike(T3), Nicole(T3+thread), Ellie(T3)");
