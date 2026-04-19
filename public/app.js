const $ = (sel) => document.querySelector(sel);
const stackEl = $("#stack");
const emptyEl = $("#empty-state");
const badgeEl = $("#pending-count");

let cards = [];
let currentIndex = 0;

// Session counter — tracks which card in the current traversal the user is on.
// sessionSeenIds: cards that have been the top card at some point this session.
// sessionAllIds: every card id ever seen in cards[] this session (survives approve/skip).
// Both reset when the stack empties (empty-state → new session).
let sessionSeenIds = new Set();
let sessionAllIds = new Set();

// Persistent back-order: cards Andrew pushed to the back stay at the back across
// the 30s auto-poll and across reloads. Keyed by cardId → push timestamp.
const BACK_KEY = "tft.backOrder";
const BACK_TTL_MS = 6 * 3600 * 1000;
function loadBackOrder() {
  try {
    const raw = localStorage.getItem(BACK_KEY);
    if (!raw) return {};
    const now = Date.now();
    const parsed = JSON.parse(raw) || {};
    const cleaned = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && now - ts < BACK_TTL_MS) cleaned[id] = ts;
    }
    return cleaned;
  } catch { return {}; }
}
function saveBackOrder() {
  try { localStorage.setItem(BACK_KEY, JSON.stringify(backOrder)); } catch {}
}
let backOrder = loadBackOrder();

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    location.href = "/login";
    return { error: "unauthorized" };
  }
  return res.json();
}

async function load() {
  const data = await api("/api/cards");
  const fetched = data.cards || [];
  const currentTopId = cards[0]?.cardId;

  // Drop backOrder entries whose card is no longer in the server list.
  const liveIds = new Set(fetched.map((c) => c.cardId));
  let changed = false;
  for (const id of Object.keys(backOrder)) {
    if (!liveIds.has(id)) { delete backOrder[id]; changed = true; }
  }
  if (changed) saveBackOrder();

  // Split: normal cards keep server order (tier desc, createdAt asc);
  // backed cards go to the end, oldest-pushed first so repeated "laters"
  // cycle predictably.
  const normal = fetched.filter((c) => !backOrder[c.cardId]);
  const backed = fetched
    .filter((c) => backOrder[c.cardId])
    .sort((a, b) => backOrder[a.cardId] - backOrder[b.cardId]);
  let ordered = [...normal, ...backed];

  // Preserve the user's current top card across the auto-poll so a refresh
  // does not yank him off the card he is actively reviewing.
  if (currentTopId) {
    const idx = ordered.findIndex((c) => c.cardId === currentTopId);
    if (idx > 0) {
      const [current] = ordered.splice(idx, 1);
      ordered.unshift(current);
    }
  }

  cards = ordered;
  currentIndex = 0;
  render();
  updateBadge();
  if (cards.length === 0) loadDashboard();
}

function updateBadge() {
  badgeEl.textContent = cards.length;
  badgeEl.classList.toggle("has", cards.length > 0);
  const nextBtn = $("#next-btn");
  if (nextBtn) nextBtn.hidden = cards.length < 2;
}

function formatAge(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}hr${h === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)}d`;
}

function render() {
  stackEl.innerHTML = "";
  if (cards.length === 0) {
    // Session resets at empty state — next load starts fresh at "1 of N".
    sessionSeenIds.clear();
    sessionAllIds.clear();
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Update session counters before building the card.
  cards.forEach((c) => sessionAllIds.add(c.cardId));
  const top = cards[0];
  sessionSeenIds.add(top.cardId);

  const cardEl = buildCard(top);
  stackEl.appendChild(cardEl);
  attachGestures(cardEl, top);
}

function buildCard(card) {
  const el = document.createElement("div");
  const isOverride = card.triggerEvent === "scheduling_override";
  el.className = `card tier-${card.tier}${isOverride ? " override-card" : ""}`;
  el.dataset.cardId = card.cardId;
  if (isOverride) el.dataset.kind = "override";

  const posNum = sessionSeenIds.size;
  const totalNum = sessionAllIds.size;
  const pos = totalNum > 1 ? `<span class="pos-indicator">${posNum} of ${totalNum}</span>` : "";
  const head = `
    <div class="card-head">
      <div class="card-name">${escape(card.contactName)}${card.dogName ? ` · ${escape(card.dogName)}` : ""}${pos}</div>
      <button class="card-info-btn" data-action="summary" data-contact-id="${card.contactId}" data-contact-name="${escape(card.contactName)}" aria-label="Summary">i</button>
      <div class="card-age">⏱ ${formatAge(card.createdAt)}</div>
    </div>
  `;

  let body = head;

  if (isOverride) {
    body += renderOverrideBody(card);
  } else {
    if (card.clientMessage) {
      body += `<div class="card-msg">"${escape(card.clientMessage)}"</div>`;
    }

    const hist = card.conversationHistory || [];
    if (hist.length >= 2) {
      body += `<div class="section">
        <div class="section-label">Thread</div>
        <div class="thread">${hist
          .slice(-5)
          .map((m) => `<div class="thread-entry"><span class="from">${escape(m.from)}:</span> ${escape(m.text)}</div>`)
          .join("")}</div>
      </div>`;
    }

    if (card.calendarContext && card.calendarContext.slots?.length) {
      body += `<div class="section">
        <div class="section-label">Availability</div>
        ${card.calendarContext.slots.map(renderCalDay).join("")}
        ${card.suggestedSlots?.length
          ? `<div class="suggest">Hermes suggests: <b>${card.suggestedSlots.map(fmtSlot).join(", ")}</b></div>`
          : ""}
      </div>`;
    }

    body += `<div class="section">
      <div class="section-label">Draft</div>
      <div class="draft">${escape(card.draftResponse)}</div>
    </div>`;
  }

  const actions = isOverride
    ? `
      <div class="actions override-actions">
        <button class="act skip" data-action="schedule-reject">← Offer alts</button>
        <button class="act send" data-action="schedule-approve">Confirm booking →</button>
      </div>
    `
    : `
      <div class="actions">
        <button class="act skip" data-action="skip">← Skip</button>
        <button class="act snooze" data-action="back">↓ Later</button>
        <button class="act send" data-action="approve">Send →</button>
      </div>
    `;

  el.innerHTML = `<div class="card-body">${body}</div><div class="card-footer">${actions}</div>`;
  return el;
}

function fmtSlotPretty(iso) {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(":00 ", " ");
  return `${weekday} ${day} · ${time}`;
}

function renderOverrideBody(card) {
  const slot = card.requestedSlot || {};
  const conflict = card.tierConflict || null;
  const slotLine = slot.start ? fmtSlotPretty(slot.start) : "(slot missing)";
  const reqSlot = `
    <div class="override-slot">
      <div class="override-slot-label">Client requested</div>
      <div class="override-slot-time">${escape(slotLine)}</div>
    </div>
  `;

  const conflictChip = conflict
    ? `<div class="override-chips">
        <span class="chip chip-${escape(conflict.tier || "soft")}">
          ${escape((conflict.tier || "soft").toUpperCase())} · ${escape(conflict.eventTitle || "soft block")}
        </span>
        ${typeof card.driveTimeFromPrevMin === "number"
          ? `<span class="chip chip-drive">🚗 ${Math.round(card.driveTimeFromPrevMin)}m drive</span>`
          : ""}
      </div>`
    : "";

  const alts = Array.isArray(card.alternativeSlots) ? card.alternativeSlots : [];
  const altsBlock = alts.length
    ? `<div class="section">
        <div class="section-label">Alternative slots (auto-offered on reject)</div>
        <div class="alt-pills">
          ${alts.map((iso) => `<span class="alt-pill">${escape(fmtSlotPretty(iso))}</span>`).join("")}
        </div>
      </div>`
    : `<div class="section">
        <div class="section-label">Alternatives</div>
        <div class="alt-pills empty">No alternatives queued — client will get a manual reply.</div>
      </div>`;

  const draft = `<div class="section">
    <div class="section-label">If approved, client gets:</div>
    <div class="draft">${escape(card.draftResponse)}</div>
  </div>`;

  const addr = card.clientAddress
    ? `<div class="override-meta">📍 ${escape(card.clientAddress)}</div>`
    : "";

  return reqSlot + conflictChip + addr + altsBlock + draft;
}

function renderCalDay(day) {
  const d = new Date(day.date + "T00:00:00");
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const pretty = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `<div class="cal-day">
    <div class="cal-day-head">
      <span><b>${weekday}</b> · ${pretty}</span>
      ${day.note ? `<span class="cal-day-note">${escape(day.note)}</span>` : ""}
    </div>
    ${day.blocks.map((b) => `
      <div class="cal-block ${b.status}" ${b.status === "open" ? `data-slot="${day.date}|${b.start}|${b.end}|${weekday}|${pretty}"` : ""}>
        <span class="time">${b.start}–${b.end}</span>
        <span class="status">${b.status === "open" ? "OPEN ›" : "BLOCKED" + (b.label ? " · " + escape(b.label) : "")}</span>
      </div>
    `).join("")}
  </div>`;
}

function formatTime12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

function buildSlotDraft(card, dayName, prettyDate, start, end) {
  const name = (card.contactName || "").split(" ")[0] || "";
  const startStr = formatTime12(start);
  const endStr = formatTime12(end);
  return `Hey${name ? " " + name : ""}! I've got an opening ${dayName} at ${startStr}—would that work?`;
}

function fmtSlot(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

function escape(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function attachGestures(el, card) {
  let startX = 0, startY = 0, dx = 0, dy = 0;
  let dragging = false, holdTimer = null, held = false;

  el.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const action = btn.dataset.action;
      if (action === "approve") approve(card);
      else if (action === "skip") skip(card);
      else if (action === "back") sendToBack(card);
      else if (action === "schedule-approve") scheduleApprove(card);
      else if (action === "schedule-reject") scheduleReject(card);
    });
  });

  // Tappable open slots — opens edit sheet with a draft referencing that time
  el.querySelectorAll(".cal-block.open[data-slot]").forEach((slot) => {
    slot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const [date, start, end, weekday, pretty] = slot.dataset.slot.split("|");
      const prefill = buildSlotDraft(card, weekday, pretty, start, end);
      openEdit(card, prefill);
    });
  });

  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-action]")) return;
    startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
    dragging = true; held = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add("swiping");
    holdTimer = setTimeout(() => {
      held = true;
      openEdit(card);
    }, 550);
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    }
    const rot = dx / 20;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    // Full-card color fill based on drag direction
    const threshold = 100;
    const intensity = Math.min(Math.max(Math.abs(dx), Math.abs(dy)) / threshold, 1);
    let color = null;
    if (dx > 40 && Math.abs(dy) < Math.abs(dx)) color = [34, 197, 94];
    else if (dx < -40 && Math.abs(dy) < Math.abs(dx)) color = [239, 68, 68];
    else if (dy > 40) color = [249, 115, 22];
    else if (dy < -40) color = [99, 179, 237];

    if (color) {
      const [r, g, b] = color;
      el.style.backgroundColor = `rgba(${r},${g},${b},${0.2 + intensity * 0.7})`;
      el.style.borderColor = `rgba(${r},${g},${b},1)`;
      el.style.boxShadow = `0 0 ${20 + intensity * 40}px rgba(${r},${g},${b},${intensity * 0.6})`;
    } else {
      el.style.backgroundColor = "";
      el.style.borderColor = "";
      el.style.boxShadow = "";
    }
  });

  el.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    el.classList.remove("swiping");

    if (held) { el.style.transform = ""; return; }

    const threshold = 100;
    const isOverride = card.triggerEvent === "scheduling_override";
    if (dx > threshold) {
      el.classList.add("out-right");
      setTimeout(() => (isOverride ? scheduleApprove(card) : approve(card)), 250);
    } else if (dx < -threshold) {
      el.classList.add("out-left");
      setTimeout(() => (isOverride ? scheduleReject(card) : skip(card)), 250);
    } else if (dy > threshold) {
      el.classList.add("out-down");
      setTimeout(() => (isOverride ? scheduleReject(card) : sendToBack(card)), 250);
    } else if (dy < -threshold) {
      el.classList.add("out-up");
      setTimeout(() => (isOverride ? scheduleApprove(card) : thumbsUp(card)), 250);
    } else {
      el.style.transform = "";
      el.style.boxShadow = "";
      el.style.backgroundColor = "";
      el.style.borderColor = "";
    }
  });

  el.addEventListener("pointercancel", () => {
    dragging = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    el.style.transform = "";
    el.style.boxShadow = "";
    el.style.backgroundColor = "";
    el.style.borderColor = "";
    el.classList.remove("swiping");
  });
}

const _approveInFlight = new Set();
async function approve(card) {
  if (_approveInFlight.has(card.cardId)) return;
  _approveInFlight.add(card.cardId);
  stamp(card, "green");
  try {
    const res = await api(`/api/cards/${card.cardId}/approve`, { method: "POST" });
    if (res.sent) { setTimeout(load, 300); }
    else { alert(res.error || "Failed to send"); load(); }
  } finally {
    setTimeout(() => _approveInFlight.delete(card.cardId), 2000);
  }
}

function sendToBack(card) {
  if (cards.length < 2) { render(); return; }
  const i = cards.findIndex((c) => c.cardId === card.cardId);
  if (i < 0) { render(); return; }
  const [moved] = cards.splice(i, 1);
  cards.push(moved);
  backOrder[card.cardId] = Date.now();
  saveBackOrder();
  render();
}

async function skip(card) {
  stamp(card, "red");
  await api(`/api/cards/${card.cardId}/skip`, { method: "POST" });
  setTimeout(load, 300);
}

async function thumbsUp(card) {
  stamp(card, "blue");
  const res = await api(`/api/cards/${card.cardId}/thumbs-up`, { method: "POST" });
  if (res.sent) setTimeout(load, 300);
  else { alert(res.error || "Failed to send 👍"); load(); }
}

async function scheduleApprove(card) {
  stamp(card, "green");
  const res = await api(`/api/cards/${card.cardId}/schedule-approve`, { method: "POST" });
  if (res.approved) setTimeout(load, 300);
  else { alert(res.error || "Failed to approve override"); load(); }
}

async function scheduleReject(card) {
  stamp(card, "red");
  const res = await api(`/api/cards/${card.cardId}/schedule-reject`, { method: "POST" });
  if (res.rejected) setTimeout(load, 300);
  else { alert(res.error || "Failed to reject override"); load(); }
}

function openEdit(card, prefill) {
  const sheet = $("#edit-sheet");
  const textEl = $("#edit-text");
  const tagsEl = $("#edit-tags");
  textEl.value = prefill || card.draftResponse;
  tagsEl.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  sheet.hidden = false;

  tagsEl.onclick = (e) => {
    const btn = e.target.closest("[data-tag]");
    if (btn) btn.classList.toggle("active");
  };

  $("#edit-cancel").onclick = () => {
    sheet.hidden = true;
    const topEl = stackEl.querySelector(".card");
    if (topEl) topEl.style.transform = "";
  };

  $("#edit-send").onclick = async () => {
    const tags = [...tagsEl.querySelectorAll("button.active")].map((b) => b.dataset.tag);
    const edited = textEl.value.trim();
    if (!edited) return;
    sheet.hidden = true;
    stamp(card, "green");
    const res = await api(`/api/cards/${card.cardId}/edit`, {
      method: "POST",
      body: JSON.stringify({ editedDraft: edited, tags }),
    });
    if (res.sent) setTimeout(load, 300);
    else { alert(res.error || "Failed"); load(); }
  };
}

const ACT_ICON = { sent: "✓", edited: "✎", thumbs_up: "👍", skipped: "↩", snoozed: "⏰" };
const ACT_VERB = { sent: "Sent to", edited: "Sent edited to", thumbs_up: "👍 to", skipped: "Skipped", snoozed: "Snoozed" };

async function loadDashboard() {
  const data = await api("/api/activity?limit=200");
  const entries = (data.entries || []);
  const todayStr = new Date().toDateString();
  const todayEntries = entries.filter((e) => new Date(e.at).toDateString() === todayStr);
  const list = $("#activity-list");
  const summary = $("#today-summary");

  if (entries.length === 0) {
    summary.textContent = "Nothing handled yet today";
    list.innerHTML = "";
    return;
  }
  summary.textContent = `${todayEntries.length} handled today`;

  // Group by contact — today only (resets at midnight)
  const groups = new Map();
  for (const e of todayEntries) {
    const key = e.contactId || e.contactName;
    if (!groups.has(key)) groups.set(key, { name: e.contactName, items: [] });
    groups.get(key).items.push(e);
  }
  // Sort groups by latest action
  const ordered = [...groups.values()].sort(
    (a, b) => new Date(b.items[0].at) - new Date(a.items[0].at)
  );

  list.innerHTML = `<div class="act-section-label">Recent activity · ${ordered.length} people</div>` +
    ordered.map((g, gi) => {
      const latest = g.items[0];
      return `
        <div class="act-group" data-group="${gi}">
          <button class="act-group-head" data-toggle="${gi}">
            <div class="act-icon ${latest.action}">${ACT_ICON[latest.action] || "·"}</div>
            <div class="act-body">
              <div class="act-head">
                <span class="act-name">${escape(g.name)}${latest.dogName ? ` · ${escape(latest.dogName)}` : ""}</span>
                <span class="act-time">${formatAge(latest.at)}</span>
              </div>
              <div class="act-sub">${ACT_VERB[latest.action] || latest.action} · ${g.items.length} action${g.items.length === 1 ? "" : "s"}</div>
            </div>
            <span class="card-info-btn act-info-btn" data-action="summary" data-contact-id="${latest.contactId}" data-contact-name="${escape(g.name)}" aria-label="Summary">i</span>
            <span class="act-chev">›</span>
          </button>
          <div class="act-group-body">
            <button class="act-send-btn" data-contact-id="${latest.contactId}" data-contact-name="${escape(g.name)}" data-dog-name="${escape(latest.dogName || "")}" data-phone="${escape(latest.phone || "")}">
              <span>📨</span> Send follow-up
            </button>
            <button class="act-prop-btn" data-contact-id="${latest.contactId}" data-contact-name="${escape(g.name)}" data-dog-name="${escape(latest.dogName || "")}" data-phone="${escape(latest.phone || "")}">
              <span>💸</span> Send proposal (3 texts)
            </button>
            ${g.items.map((e) => `
              <div class="act-item">
                <div class="act-icon ${e.action}">${ACT_ICON[e.action] || "·"}</div>
                <div class="act-body">
                  <div class="act-head">
                    <span class="act-name">${ACT_VERB[e.action] || e.action}</span>
                    <span class="act-time">${formatAge(e.at)}</span>
                  </div>
                  ${e.preview ? `<div class="act-preview">${escape(e.preview)}</div>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

  list.querySelectorAll(".act-group-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.parentElement.classList.toggle("open");
    });
  });
}

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let micBtnSelector = "#mic-btn";
let micTargetSelector = "#edit-text";

function setMicLabel(text) {
  const label = document.querySelector(`${micBtnSelector} .mic-label`);
  if (label) label.textContent = text;
}

async function ensureStream() {
  if (recordingStream && recordingStream.active) return recordingStream;
  recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return recordingStream;
}

function releaseStream() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
  }
}

async function startRecording() {
  const btn = $(micBtnSelector);
  if (!window.isSecureContext) {
    setMicLabel("Mic needs HTTPS");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMicLabel("Mic API unavailable in this browser");
    return;
  }
  try {
    const stream = await ensureStream();
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
               : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
               : "";
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.addEventListener("dataavailable", (e) => e.data.size > 0 && audioChunks.push(e.data));
    mediaRecorder.addEventListener("stop", onRecordingStopped);
    mediaRecorder.start();
    btn.classList.add("recording");
    if (navigator.vibrate) navigator.vibrate(15);
  } catch (err) {
    const msg = String(err).slice(0, 60);
    setMicLabel("Mic error: " + msg);
    setTimeout(() => setMicLabel("Hold to talk"), 3000);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  const btn = $(micBtnSelector);
  btn.classList.remove("recording");
}

async function onRecordingStopped() {
  const btn = $(micBtnSelector);
  const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
  audioChunks = [];
  if (blob.size < 1000) {
    return;
  }
  btn.classList.add("transcribing");
  try {
    const form = new FormData();
    const ext = (blob.type.includes("mp4") ? "m4a" : "webm");
    form.append("audio", blob, `dictation.${ext}`);
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (data.text) {
      const ta = $(micTargetSelector);
      const before = ta.value;
      const sep = before && !/\s$/.test(before) ? " " : "";
      ta.value = before + sep + data.text;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else {
      setMicLabel("Error — try again");
      setTimeout(() => setMicLabel("Hold to talk"), 2000);
    }
  } catch (err) {
    setMicLabel("Failed — try again");
    setTimeout(() => setMicLabel("Hold to talk"), 2000);
  } finally {
    btn.classList.remove("transcribing");
    setMicLabel("Hold to talk");
  }
}

function attachMicButton(sel) {
  const btn = $(sel || micBtnSelector);
  if (btn._attached) return;
  btn._attached = true;
  let active = false;
  const down = (e) => {
    if (active) return;
    active = true;
    e.preventDefault();
    startRecording();
  };
  const up = (e) => {
    if (!active) return;
    active = false;
    e.preventDefault();
    stopRecording();
  };
  // Touch events first (Safari iOS prefers these), pointer as fallback
  btn.addEventListener("touchstart", down, { passive: false });
  btn.addEventListener("touchend", up, { passive: false });
  btn.addEventListener("touchcancel", up, { passive: false });
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", (e) => { if (btn.classList.contains("recording")) up(e); });
  // Safety: if mouse leaves window while recording
  window.addEventListener("blur", () => { if (active) up({ preventDefault() {} }); });
}
attachMicButton("#mic-btn");
attachMicButton("#compose-mic");

// Compose (send follow-up) sheet
let composeCtx = null;
function openCompose({ contactId, contactName, dogName, phone }) {
  composeCtx = { contactId, contactName, dogName, phone };
  $("#compose-title").textContent = `To ${contactName}${dogName ? ` · ${dogName}` : ""}`;
  $("#compose-text").value = "";
  $("#compose-sheet").hidden = false;
  setTimeout(() => $("#compose-text").focus(), 100);
}
$("#compose-cancel").addEventListener("click", () => {
  $("#compose-sheet").hidden = true;
  composeCtx = null;
});
$("#compose-send").addEventListener("click", async () => {
  if (!composeCtx) return;
  const msg = $("#compose-text").value.trim();
  if (!msg) return;
  const btn = $("#compose-send");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res = await api("/api/send", {
      method: "POST",
      body: JSON.stringify({ ...composeCtx, message: msg }),
    });
    if (res.error) {
      btn.textContent = "Send";
      btn.disabled = false;
      alert(res.error);
      return;
    }
    $("#compose-sheet").hidden = true;
    composeCtx = null;
    await loadDashboard();
  } catch (e) {
    btn.textContent = "Send";
    btn.disabled = false;
    alert("Failed: " + e);
  } finally {
    btn.textContent = "Send";
    btn.disabled = false;
  }
});
// When compose sheet opens/closes, swap mic target
const composeSheet = $("#compose-sheet");
new MutationObserver(() => {
  if (!composeSheet.hidden) {
    micBtnSelector = "#compose-mic";
    micTargetSelector = "#compose-text";
  } else {
    micBtnSelector = "#mic-btn";
    micTargetSelector = "#edit-text";
  }
}).observe(composeSheet, { attributes: true, attributeFilter: ["hidden"] });

// Wire the "Send message" button added to each activity group body
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".act-send-btn");
  if (!btn) return;
  e.stopPropagation();
  openCompose({
    contactId: btn.dataset.contactId,
    contactName: btn.dataset.contactName,
    dogName: btn.dataset.dogName || undefined,
    phone: btn.dataset.phone || undefined,
  });
});

// Send proposal (3-text) sheet
const INSTAGRAM_TEXT = "Here is our Instagram too — I post pretty much every day about what I am doing with dogs: instagram.com/good.dogz.kc";
function pricingTemplate(dogName) {
  const dog = dogName ? ` for ${dogName}` : "";
  return `Here's how the in-home packages break down:

- 4 sessions — $600
- 6 sessions — $800 (recommended)
- 8 sessions — $1,000

Sessions are about an hour each week at your place with some light homework built into your daily routine (5-10 min, a couple times a week). The 6-session package is what I'd recommend${dog} — gives us enough time to build the skills and then spread sessions out for long-term troubleshooting. Let me know if you have any questions! 😊`;
}
let propCtx = null;
async function openProposal({ contactId, contactName, dogName, phone }) {
  propCtx = { contactId, contactName, dogName, phone };
  $("#proposal-title").textContent = `Proposal · ${contactName}${dogName ? ` · ${dogName}` : ""}`;
  const first = (contactName || "").split(" ")[0] || "";
  $("#prop-text-1").value = "⏳ Generating recap from consultation transcript…";
  $("#prop-text-1").disabled = true;
  $("#prop-text-2").value = pricingTemplate(dogName);
  $("#prop-text-3").value = INSTAGRAM_TEXT;
  $("#proposal-sheet").hidden = false;
  // Fetch consultation recap in background
  try {
    const params = new URLSearchParams({ name: contactName, dog: dogName || "" });
    const res = await fetch(`/api/contacts/${contactId}/recap?${params}`, { credentials: "same-origin" });
    const data = await res.json();
    if (res.ok && data.recap) {
      $("#prop-text-1").value = data.recap;
    } else {
      $("#prop-text-1").value = `Hey ${first}! Thanks for hopping on the call about ${dogName || "[Dog]"} today. `;
      const note = data.error === "no transcript on file"
        ? "(no transcript found — type recap manually)"
        : `(recap auto-fill failed: ${data.error || "unknown"})`;
      console.warn(note);
    }
  } catch (e) {
    $("#prop-text-1").value = `Hey ${first}! Thanks for hopping on the call about ${dogName || "[Dog]"} today. `;
  } finally {
    $("#prop-text-1").disabled = false;
    setTimeout(() => $("#prop-text-1").focus(), 50);
  }
}
$("#prop-cancel").addEventListener("click", () => {
  $("#proposal-sheet").hidden = true; propCtx = null;
});
$("#prop-send").addEventListener("click", async () => {
  if (!propCtx) return;
  const messages = [
    $("#prop-text-1").value.trim(),
    $("#prop-text-2").value.trim(),
    $("#prop-text-3").value.trim(),
  ];
  if (messages.some((m) => !m)) { alert("All 3 texts must have content"); return; }
  if (!confirm(`Send 3 texts to ${propCtx.contactName}? They'll arrive ~2.5s apart.`)) return;
  const btn = $("#prop-send");
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const res = await api("/api/send-multi", {
      method: "POST",
      body: JSON.stringify({ ...propCtx, messages, delayMs: 2500 }),
    });
    if (res.error) { alert(res.error); btn.disabled = false; btn.textContent = "Send all 3"; return; }
    if (res.sent !== res.total) {
      alert(`Sent ${res.sent} of ${res.total}. Check the activity feed.`);
    }
    $("#proposal-sheet").hidden = true; propCtx = null;
    await loadDashboard();
  } catch (e) {
    alert("Failed: " + e);
  } finally {
    btn.disabled = false; btn.textContent = "Send all 3";
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".act-prop-btn");
  if (!btn) return;
  e.stopPropagation();
  openProposal({
    contactId: btn.dataset.contactId,
    contactName: btn.dataset.contactName,
    dogName: btn.dataset.dogName || undefined,
    phone: btn.dataset.phone || undefined,
  });
});

async function loadMode() {
  const btn = $("#mode-toggle");
  const data = await api("/api/mode");
  btn.textContent = data.mode === "live" ? "LIVE" : "TEST";
  btn.classList.toggle("live", data.mode === "live");
  btn.dataset.mode = data.mode;
  btn.dataset.testAvailable = data.testContactSet ? "1" : "0";
}
$("#mode-toggle").addEventListener("click", async () => {
  const btn = $("#mode-toggle");
  const current = btn.dataset.mode;
  const target = current === "live" ? "test" : "live";
  const testRouteOn = btn.dataset.testAvailable === "1";
  const msg = target === "live"
    ? (testRouteOn
        ? "Switch to LIVE?\n\nSMS will actually send — currently routed to your phone (test contact)."
        : "Switch to LIVE?\n\n⚠ SMS will go to REAL CLIENTS. No test route is configured.")
    : "Switch to TEST mode?\n\nNo SMS will send at all — pure dry-run.";
  if (!confirm(msg)) return;
  const res = await api("/api/mode", { method: "POST", body: JSON.stringify({ mode: target }) });
  if (res.error) { alert(res.error); return; }
  loadMode();
});

// Summary sheet
async function openSummary(contactId, contactName) {
  const sheet = $("#summary-sheet");
  const body = $("#summary-body");
  const title = $("#summary-title");
  title.textContent = contactName;
  body.innerHTML = `<div class="summary-loading">Loading…</div>`;
  sheet.hidden = false;
  try {
    const res = await fetch(`/api/contacts/${contactId}/summary?name=${encodeURIComponent(contactName)}`, { credentials: "same-origin" });
    if (!res.ok) {
      body.innerHTML = `<div class="summary-empty">No vault notes yet for ${escape(contactName)}.</div>`;
      return;
    }
    const s = await res.json();
    const BUCKET_LABEL = { active: "Active client", prospect: "Prospect", alumni: "Alumni", dead: "Dead lead", unknown: "Unknown" };
    const bucketBadge = s.bucket ? `<div class="summary-badge ${s.bucket}">${BUCKET_LABEL[s.bucket] || s.bucket}</div>` : "";
    const dogLine = s.dog ? `<div class="summary-dog">Dog: <strong>${escape(s.dog)}</strong></div>` : "";
    const synopsis = s.synopsis
      ? `<div class="summary-challenges"><div class="summary-label">Synopsis</div><div class="summary-text">${escape(s.synopsis).replace(/\n/g, "<br>")}</div></div>`
      : `<div class="summary-empty">No notes yet for ${escape(contactName)}.</div>`;
    body.innerHTML = bucketBadge + dogLine + synopsis;
  } catch (e) {
    body.innerHTML = `<div class="summary-empty">Error loading.</div>`;
  }
}
$("#summary-close").addEventListener("click", () => { $("#summary-sheet").hidden = true; });

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".card-info-btn");
  if (!btn) return;
  e.stopPropagation();
  openSummary(btn.dataset.contactId, btn.dataset.contactName);
}, true);

// Live character + SMS count for textareas
function updateCharCount(textarea) {
  const wrap = document.querySelector(`.char-count[data-target="${textarea.id}"]`);
  if (!wrap) return;
  const len = textarea.value.length;
  // GSM-7 = 160 per segment, unicode = 70. Heuristic: if any non-ASCII, treat as unicode.
  const unicode = /[^\x00-\x7F]/.test(textarea.value);
  const seg = unicode ? 70 : 160;
  const segments = len === 0 ? 0 : Math.ceil(len / seg);
  wrap.classList.remove("warn", "bad");
  if (segments >= 3) wrap.classList.add("bad");
  else if (segments === 2) wrap.classList.add("warn");
  const segLabel = segments <= 1
    ? `${len}/${seg}`
    : `${len} chars · ${segments} SMS${segments >= 3 ? " — likely splits out of order" : ""}`;
  wrap.innerHTML = `<span class="pill">${segLabel}</span>`;
}
document.querySelectorAll(".char-count").forEach((el) => {
  const ta = document.getElementById(el.dataset.target);
  if (!ta) return;
  ta.addEventListener("input", () => updateCharCount(ta));
  // Also update when value is set programmatically (mic transcribe, prefill)
  const _setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  Object.defineProperty(ta, "value", {
    set(v) { _setVal.call(this, v); updateCharCount(ta); },
    get() { return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").get.call(this); },
    configurable: true,
  });
  updateCharCount(ta);
});

// Pull-to-refresh
(() => {
  const ptr = document.getElementById("ptr-indicator");
  if (!ptr) return;
  let startY = 0, pulling = false, pullDist = 0;
  const THRESHOLD = 70;

  const onStart = (e) => {
    if (window.scrollY > 0) return;
    if (e.target.closest(".card") || e.target.closest(".sheet") || e.target.closest(".act-group")) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    pulling = true;
    pullDist = 0;
  };
  const onMove = (e) => {
    if (!pulling) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    pullDist = Math.max(0, y - startY);
    if (pullDist > 5) {
      const pct = Math.min(1, pullDist / THRESHOLD);
      ptr.style.transform = `translateY(${Math.min(pullDist, THRESHOLD + 20)}px)`;
      ptr.style.opacity = pct;
      ptr.classList.toggle("ready", pullDist >= THRESHOLD);
    }
  };
  const onEnd = async () => {
    if (!pulling) return;
    pulling = false;
    if (pullDist >= THRESHOLD) {
      ptr.classList.add("loading");
      ptr.querySelector(".ptr-label").textContent = "Refreshing";
      try { await load(); await loadDashboard(); } catch {}
      ptr.classList.remove("loading", "ready");
    }
    ptr.style.transform = "";
    ptr.style.opacity = "";
    ptr.querySelector(".ptr-label").textContent = "Pull to refresh";
    pullDist = 0;
  };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd);
})();
$("#next-btn").addEventListener("click", () => {
  if (cards.length < 2) return;
  // Rotate: move top card to the back locally so you can peek ahead without acting.
  // Persist the rotation so the 30s auto-poll does not undo it.
  const top = cards.shift();
  cards.push(top);
  backOrder[top.cardId] = Date.now();
  saveBackOrder();
  render();
});

function stamp() { /* stamps removed */ }
function toast() {} // legacy no-op

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

load();
loadMode();
setInterval(load, 30000);
setInterval(loadMode, 60000);
