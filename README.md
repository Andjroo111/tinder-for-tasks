# Tinder for Tasks

Mobile-first PWA that replaces Telegram as the human-in-the-loop approval surface for AI-drafted messages. Swipe right to approve, left to skip, down to snooze, hold to edit. Cards carry smart context (calendar availability, conversation thread) so decisions are one-glance.

Built initially to approve SMS drafts from the Good Dogz KC Hermes agent. Designed to be extracted into a generic framework for any AI agent needing human approval on proposed actions.

## Quick start

```bash
bun install
bun run seed      # seed two demo cards
bun run dev       # starts http://localhost:3100
```

Open `http://localhost:3100` on your phone over Tailscale. Add to home screen for PWA install.

## Environment

```bash
PORT=3100
GHL_API_KEY=...            # omit → dry-run mode (logs instead of sending)
GHL_LOCATION_ID=...
GHL_DRY_RUN=true           # force dry-run even with key set
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/cards` | Hermes creates/updates a card. Tier 1/2 auto-send, Tier 3/4 enter the stack. Dedup by `contactId`. |
| GET | `/api/cards` | Visible card stack, sorted by tier desc then age. |
| POST | `/api/cards/:id/approve` | Swipe right — sends SMS via GHL. |
| POST | `/api/cards/:id/skip` | Swipe left — mark skipped. |
| POST | `/api/cards/:id/edit` | Hold-edit — sends edited draft + logs feedback tags. |
| POST | `/api/cards/:id/snooze` | Swipe down — `{"duration":"1h"\|"3h"\|"tomorrow"}`. |
| GET | `/api/auto-sends` | Tier 1/2 auto-send log. |
| GET | `/api/dashboard` | "All Caught Up" data. |

## Hermes integration

Replace `pending-drafts.json` writes in the Mac Mini Hermes webhook route with a POST to `/api/cards`. Payload shape is in `lib/types.ts` (`CardCreatePayload`).

## Architecture

- Bun + Hono backend, flat JSON store (`data/cards.json`)
- Vanilla JS PWA, service worker for installability
- Pointer-event gestures (right/left/down swipe, press-hold edit)
- GHL SMS adapter in `lib/sms.ts` is thin — swap for Twilio/etc. when GHL is sunset
