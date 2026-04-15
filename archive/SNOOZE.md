# Snooze Feature — Archived 2026-04-14

The snooze feature was replaced by "send to back of stack" (swipe down rotates the
card to the end of the queue). Snooze went unused: Andrew preferred staying in the
flow rather than scheduling a card to return later.

## Why archived, not deleted

Cheap to bring back if a future use case appears (e.g. cards that genuinely need a
time-based delay, like "follow up Monday morning"). All code lives in git history.

## Recovery commit

`6a84cd7` — last commit where snooze was active. Run:

```bash
git show 6a84cd7:public/app.js   > /tmp/app-with-snooze.js
git show 6a84cd7:public/index.html > /tmp/index-with-snooze.html
git show 6a84cd7:public/style.css > /tmp/style-with-snooze.css
git show 6a84cd7:server.ts       > /tmp/server-with-snooze.ts
git show 6a84cd7:lib/cards.ts    > /tmp/cards-with-snooze.ts
```

## What was removed

### Backend
- `lib/cards.ts`: `snoozeCard(cardId, until)` helper (kept — harmless, used by no one)
- `server.ts`: `POST /api/cards/:id/snooze` endpoint and its `snoozeCard` import
- `lib/types.ts`: `snoozedUntil` field stays on `Card` (already in stored data)

### Frontend
- `public/index.html`: `<div id="snooze-sheet">` block (snooze picker UI)
- `public/app.js`:
  - `openSnooze(card)` — opens the sheet, handles slider + preset picks
  - `updateSnoozeLabels()` — recomputes "afternoon/evening/tomorrow" times based on now
  - `previewSnoozeTime(hour)` — formats the preview time string
  - `lerpColor(t)` — green→orange interpolation for slider button
  - data-action="snooze" branch in card-action click handler
- `public/style.css`: `.act.snooze`, `.snooze-time`, `.custom-snooze-slider`,
  `#snooze-custom-hours`, `.custom-snooze` rules

### Behavior
- Swipe down used to open the snooze sheet → user picked "later / afternoon /
  evening / tomorrow / custom hours" → POST `/api/cards/:id/snooze` with the
  duration → backend marked card status `snoozed` and set `snoozedUntil`.
- After the timestamp passed, `listCards()` would re-include the card in the
  pending list.

### Status type
`Card.status = "snoozed"` is still a valid type. Cards already in storage with
that status will still render (treated as pending after their `snoozedUntil`
expires). Future cleanup could migrate those to `pending` if needed.

## To restore

1. Copy back `openSnooze`, `updateSnoozeLabels`, `previewSnoozeTime`, `lerpColor`
   into `public/app.js`.
2. Restore the `<div id="snooze-sheet">` block in `public/index.html`.
3. Restore the snooze CSS rules in `public/style.css`.
4. Restore `app.post("/api/cards/:id/snooze")` in `server.ts` and re-import
   `snoozeCard` from `./lib/cards`.
5. In the swipe-down handler in `attachGestures()`, replace `sendToBack(card)`
   with `openSnooze(card)`.
6. In the card-action click handler, switch the `"back"` action back to
   `"snooze"` and call `openSnooze(card)`.
