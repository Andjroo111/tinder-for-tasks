import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const VAULT_ROOT = process.env.GDKC_VAULT_PATH || "/Users/andjroo/gdkc/GDKC-Vault/Clients";

export interface VaultSummary {
  name: string;
  dog?: string;
  stage?: string;
  status?: string;
  service?: string;
  challenges?: string;
  contactId?: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (entry.endsWith(".md")) out.push(p);
    }
  } catch {}
  return out;
}

function parseFile(path: string): VaultSummary | null {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return null; }

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
      if (m) fm[m[1]] = m[2];
    }
  }

  const idMatch = text.match(/GHL Contact ID\s*\|\s*(\w+)/);
  const challengesMatch = text.match(/Challenges\s*\|\s*(.+?)\s*\|/);

  return {
    name: fm.client || path.split("/").pop()!.replace(".md", ""),
    dog: fm.dog && fm.dog !== "Unknown" ? fm.dog : undefined,
    stage: fm.stage || undefined,
    status: fm.status || undefined,
    service: fm.service || undefined,
    challenges: challengesMatch && challengesMatch[1] !== "—" ? challengesMatch[1].trim() : undefined,
    contactId: idMatch ? idMatch[1] : undefined,
  };
}

let cache: { byId: Map<string, VaultSummary>; byName: Map<string, VaultSummary>; built: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

function buildIndex() {
  const byId = new Map<string, VaultSummary>();
  const byName = new Map<string, VaultSummary>();
  for (const file of walk(VAULT_ROOT)) {
    const s = parseFile(file);
    if (!s) continue;
    if (s.contactId) byId.set(s.contactId, s);
    byName.set(s.name.toLowerCase(), s);
  }
  cache = { byId, byName, built: Date.now() };
}

export function getSummary(contactId: string, contactName?: string): VaultSummary | null {
  if (!cache || Date.now() - cache.built > CACHE_TTL_MS) buildIndex();
  const byId = cache!.byId.get(contactId);
  if (byId) return byId;
  if (contactName) {
    const byName = cache!.byName.get(contactName.toLowerCase());
    if (byName) return byName;
  }
  return null;
}
