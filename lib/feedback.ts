import type { EditFeedback } from "./types";

const FEEDBACK_PATH = `${import.meta.dir}/../data/edit-feedback.json`;

interface StoredFeedback extends EditFeedback {
  cardId: string;
  contactName: string;
  triggerEvent: string;
  timestamp: string;
}

export async function logEditFeedback(entry: StoredFeedback): Promise<void> {
  const file = Bun.file(FEEDBACK_PATH);
  let entries: StoredFeedback[] = [];
  if (await file.exists()) {
    try {
      entries = await file.json();
    } catch {}
  }
  entries.unshift(entry);
  entries = entries.slice(0, 1000);
  await Bun.write(FEEDBACK_PATH, JSON.stringify(entries, null, 2));
}
