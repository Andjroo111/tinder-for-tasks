const $ = (sel) => document.querySelector(sel);
const stackEl = $("#stack");
const emptyEl = $("#empty-state");
const badgeEl = $("#pending-count");

let cards = [];
let currentIndex = 0;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  return res.json();
}

async function load() {
  const data = await api("/api/cards");
  cards = data.cards || [];
  currentIndex = 0;
  render();
  updateBadge();
  if (cards.length === 0) loadDashboard();
}

function updateBadge() {
  badgeEl.textContent = cards.length;
  badgeEl.classList.toggle("has", cards.length > 0);
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
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const top = cards[0];
  const cardEl = buildCard(top);
  stackEl.appendChild(cardEl);
  attachGestures(cardEl, top);
}

function buildCard(card) {
  const el = document.createElement("div");
  el.className = `card tier-${card.tier}`;
  el.dataset.cardId = card.cardId;

  const head = `
    <div class="card-head">
      <div class="card-name">${escape(card.contactName)}${card.dogName ? ` · ${escape(card.dogName)}` : ""}</div>
      <div class="card-age">⏱ ${formatAge(card.createdAt)}</div>
    </div>
  `;

  let body = head;
  if (card.clientMessage) {
    body += `<div class="card-msg">"${escape(card.clientMessage)}"</div>`;
  }

  const threadHasMultiple = (card.conversationHistory || []).length > 1;
  if (threadHasMultiple) {
    body += `<div class="section">
      <div class="section-label">Thread</div>
      <div class="thread">${card.conversationHistory
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

  const actions = `
    <div class="actions">
      <button class="act skip" data-action="skip">← Skip</button>
      <button class="act snooze" data-action="snooze">↓ Snooze</button>
      <button class="act send" data-action="approve">Send →</button>
    </div>
  `;

  el.innerHTML = `<div class="card-body">${body}</div><div class="card-footer">${actions}</div>`;
  return el;
}

function renderCalDay(day) {
  return `<div class="cal-day">
    <div class="cal-day-head">
      <span>${day.date}</span>
      ${day.note ? `<span class="cal-day-note">${escape(day.note)}</span>` : ""}
    </div>
    ${day.blocks.map((b) => `
      <div class="cal-block ${b.status}">
        <span class="time">${b.start}–${b.end}</span>
        <span class="status">${b.status === "open" ? "OPEN" : "BLOCKED" + (b.label ? " · " + escape(b.label) : "")}</span>
      </div>
    `).join("")}
  </div>`;
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
      else if (action === "snooze") openSnooze(card);
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
  });

  el.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    el.classList.remove("swiping");

    if (held) { el.style.transform = ""; return; }

    const threshold = 100;
    if (dx > threshold) {
      el.classList.add("out-right");
      setTimeout(() => approve(card), 250);
    } else if (dx < -threshold) {
      el.classList.add("out-left");
      setTimeout(() => skip(card), 250);
    } else if (dy > threshold) {
      el.classList.add("out-down");
      setTimeout(() => openSnooze(card), 250);
    } else {
      el.style.transform = "";
    }
  });

  el.addEventListener("pointercancel", () => {
    dragging = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    el.style.transform = "";
    el.classList.remove("swiping");
  });
}

async function approve(card) {
  const res = await api(`/api/cards/${card.cardId}/approve`, { method: "POST" });
  if (res.sent) { toast("Sent"); load(); }
  else toast(res.error || "Failed");
}

async function skip(card) {
  await api(`/api/cards/${card.cardId}/skip`, { method: "POST" });
  toast("Skipped");
  load();
}

function openSnooze(card) {
  const sheet = $("#snooze-sheet");
  sheet.hidden = false;
  sheet.onclick = async (e) => {
    const btn = e.target.closest("[data-snooze]");
    if (!btn) return;
    sheet.hidden = true;
    if (btn.dataset.snooze === "cancel") {
      const topEl = stackEl.querySelector(".card");
      if (topEl) topEl.style.transform = "";
      return;
    }
    await api(`/api/cards/${card.cardId}/snooze`, {
      method: "POST",
      body: JSON.stringify({ duration: btn.dataset.snooze }),
    });
    toast("Snoozed");
    load();
  };
}

function openEdit(card) {
  const sheet = $("#edit-sheet");
  const textEl = $("#edit-text");
  const tagsEl = $("#edit-tags");
  textEl.value = card.draftResponse;
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
    const res = await api(`/api/cards/${card.cardId}/edit`, {
      method: "POST",
      body: JSON.stringify({ editedDraft: edited, tags }),
    });
    if (res.sent) { toast("Sent (edited)"); load(); }
    else toast(res.error || "Failed");
  };
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  $("#auto-send-summary").textContent = `${data.autoSendsToday} auto-sent today`;
  const pipe = $("#pipeline");
  pipe.textContent = `${data.pipeline.newLeads} new leads · ${data.pipeline.awaitingReply} awaiting reply`;
}

async function openAutos() {
  const sheet = $("#autos-sheet");
  const list = $("#autos-list");
  const data = await api("/api/auto-sends");
  list.innerHTML = (data.entries || []).map((e) => `
    <div class="auto-entry">
      <div class="who">${escape(e.contactName)} <small>(T${e.tier})</small></div>
      <div class="msg">${escape(e.message)}</div>
      <div class="time">${formatAge(e.sentAt)} ago</div>
    </div>
  `).join("") || '<div class="dash-row muted">No auto-sends yet.</div>';
  sheet.hidden = false;
}

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;

function setMicLabel(text) {
  const label = document.querySelector("#mic-btn .mic-label");
  if (label) label.textContent = text;
}

async function startRecording() {
  const btn = $("#mic-btn");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMicLabel("Mic needs HTTPS");
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
               : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
               : "";
    mediaRecorder = mime ? new MediaRecorder(recordingStream, { mimeType: mime }) : new MediaRecorder(recordingStream);
    audioChunks = [];
    mediaRecorder.addEventListener("dataavailable", (e) => e.data.size > 0 && audioChunks.push(e.data));
    mediaRecorder.addEventListener("stop", onRecordingStopped);
    mediaRecorder.start();
    btn.classList.add("recording");
    if (navigator.vibrate) navigator.vibrate(15);
  } catch (err) {
    setMicLabel("Mic permission needed");
    setTimeout(() => setMicLabel("Hold to talk"), 2000);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  const btn = $("#mic-btn");
  btn.classList.remove("recording");
}

async function onRecordingStopped() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
  }
  const btn = $("#mic-btn");
  const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
  audioChunks = [];
  if (blob.size < 1000) {
    return;
  }
  btn.classList.add("transcribing");
  setMicLabel("Transcribing…");
  try {
    const form = new FormData();
    const ext = (blob.type.includes("mp4") ? "m4a" : "webm");
    form.append("audio", blob, `dictation.${ext}`);
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (data.text) {
      const ta = $("#edit-text");
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

function attachMicButton() {
  const btn = $("#mic-btn");
  if (btn._attached) return;
  btn._attached = true;
  const down = (e) => { e.preventDefault(); startRecording(); };
  const up = (e) => { e.preventDefault(); stopRecording(); };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", (e) => { if (btn.classList.contains("recording")) up(e); });
}
attachMicButton();

$("#view-autos").addEventListener("click", openAutos);
$("#autos-close").addEventListener("click", () => { $("#autos-sheet").hidden = true; });
$("#refresh-btn").addEventListener("click", load);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 1800);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

load();
setInterval(load, 30000);
