/* Habit Tracker — front end (vanilla JS + Supabase). */

const cfg = window.HABIT_CONFIG;
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const TYPES = [
  { key: "good", label: "Good Habits", color: "var(--good)" },
  { key: "bad", label: "Bad Habits", color: "var(--bad)" },
  { key: "neutral", label: "Neutral", color: "var(--neutral)" },
  { key: "people_hangcall", label: "People — Hang/Call", color: "var(--people)" },
  { key: "people_text", label: "People — Text", color: "var(--people)" },
];

// Pages you can toggle between. `types: null` on "due" means "overdue only,
// any type"; otherwise a view shows the listed types, grouped.
const VIEWS = [
  { key: "due", label: "Due", types: null },
  { key: "positive", label: "Good & Neutral", types: ["good", "neutral"] },
  { key: "bad", label: "Bad", types: ["bad"] },
  { key: "people", label: "People", types: ["people_hangcall", "people_text"] },
];
let currentView = localStorage.getItem("habitView") || "due";

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
// Touch-primary devices (phones/tablets) get swipe-to-delete; mouse-primary gets checkboxes.
const isTouch = window.matchMedia("(pointer: coarse)").matches;

let habits = [];
let entriesByHabit = {}; // habit_id -> [logged_at Date, ...]

/* ---------- Auth ---------- */

async function refreshSession() {
  const { data } = await db.auth.getSession();
  showApp(!!data.session);
  if (data.session) await loadAndRender();
}

function showApp(loggedIn) {
  $("app").classList.toggle("hidden", !loggedIn);
  $("auth").classList.toggle("hidden", loggedIn);
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("auth-msg").textContent = error ? error.message : "";
  if (!error) refreshSession();
});

$("signup").addEventListener("click", async () => {
  const { data, error } = await db.auth.signUp({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (error) { $("auth-msg").textContent = error.message; return; }
  $("auth-msg").textContent = data.session
    ? "" : "Account created — check your email to confirm, then sign in.";
  if (data.session) refreshSession();
});

$("signout").addEventListener("click", async () => {
  await db.auth.signOut();
  showApp(false);
});

/* ---------- Data ---------- */

async function loadAndRender() {
  const [{ data: h, error: he }, { data: en, error: ee }] = await Promise.all([
    db.from("habits").select("*").order("sort_order"),
    db.from("entries").select("id, habit_id, logged_at"),
  ]);
  if (he || ee) { alert((he || ee).message); return; }
  habits = h || [];
  entriesByHabit = {};
  (en || []).forEach((row) => {
    (entriesByHabit[row.habit_id] ||= []).push({ id: row.id, at: new Date(row.logged_at) });
  });
  render();
}

function stats(habitId) {
  const list = entriesByHabit[habitId] || [];
  if (!list.length) return { count: 0, daysSince: null };
  const last = Math.max(...list.map((e) => e.at.getTime()));
  return { count: list.length, daysSince: Math.floor((Date.now() - last) / DAY) };
}

function sinceText(daysSince) {
  return daysSince === null ? "never logged"
    : daysSince === 0 ? "today"
    : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
}

function isOverdue(h, daysSince) {
  if (!h.reminder_enabled || !h.reminder_threshold_days) return false;
  return daysSince === null || daysSince > h.reminder_threshold_days;
}

/* ---------- Render ---------- */

function render() {
  renderTabs();
  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").classList.toggle("hidden", habits.length > 0);
  if (!habits.length) return;

  const view = VIEWS.find((v) => v.key === currentView) || VIEWS[0];

  if (view.key === "due") {
    const due = habits.filter((h) => isOverdue(h, stats(h.id).daysSince)).sort(dueSort);
    if (due.length) renderGroup(grid, "Due now", due);
    else grid.appendChild(msgEl("Nothing due right now — you're all caught up. 🎉"));
    return;
  }

  let any = false;
  for (const t of TYPES) {
    if (!view.types.includes(t.key)) continue;
    const inType = habits.filter((h) => h.type === t.key).sort(overdueFirstThenName);
    if (inType.length) { renderGroup(grid, t.label, inType); any = true; }
  }
  if (!any) grid.appendChild(msgEl("No habits here yet — add one with “+ Habit”."));
}

// Tab bar across the top; the "Due" tab carries a live count badge.
function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  const dueCount = habits.filter((h) => isOverdue(h, stats(h.id).daysSince)).length;
  for (const v of VIEWS) {
    const btn = document.createElement("button");
    btn.className = "tab" + (v.key === currentView ? " active" : "");
    btn.innerHTML = escapeHtml(v.label) +
      (v.key === "due" && dueCount ? ` <span class="badge">${dueCount}</span>` : "");
    btn.addEventListener("click", () => {
      currentView = v.key;
      localStorage.setItem("habitView", v.key);
      render();
    });
    nav.appendChild(btn);
  }
}

function renderGroup(grid, label, list) {
  const group = document.createElement("div");
  group.className = "group";
  group.innerHTML = `<h2>${escapeHtml(label)}</h2><div class="tiles"></div>`;
  const tiles = group.querySelector(".tiles");
  list.forEach((h) => tiles.appendChild(buildTile(h)));
  grid.appendChild(group);
}

function buildTile(h) {
  const t = TYPES.find((x) => x.key === h.type);
  const { count, daysSince } = stats(h.id);
  const overdue = isOverdue(h, daysSince);
  const tile = document.createElement("div");
  tile.className = "tile" + (overdue ? " overdue" : "");
  tile.dataset.habitId = h.id;
  tile.style.setProperty("--type", t ? t.color : "var(--neutral)");
  tile.innerHTML = `
    <div class="emoji">${h.emoji}</div>
    <div class="name">${escapeHtml(h.name)}</div>
    <div class="stat">${sinceText(daysSince)}</div>
    <div class="count">${count}×${overdue ? " · due" : ""}</div>`;
  attachTileGestures(tile, h);
  return tile;
}

// Tap = log instantly. Press-and-hold (or right-click) = options popup.
function attachTileGestures(tile, h) {
  let timer = null, longPressed = false, sx = 0, sy = 0;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

  tile.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return; // ignore non-primary buttons
    longPressed = false;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { longPressed = true; buzz(); openTileMenu(h, tile); }, 500);
  });
  tile.addEventListener("pointermove", (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) clear();
  });
  tile.addEventListener("pointerup", clear);
  tile.addEventListener("pointercancel", clear);
  tile.addEventListener("pointerleave", clear);

  tile.addEventListener("click", () => {
    if (longPressed) { longPressed = false; return; } // hold already handled it
    logNow(h.id, tile);
  });
  tile.addEventListener("contextmenu", (e) => { e.preventDefault(); openTileMenu(h, tile); });
}

/* ---------- Tile options popup ---------- */

function openTileMenu(h, tile) {
  closeTileMenu();
  const overlay = document.createElement("div");
  overlay.id = "tile-menu";
  overlay.className = "popover";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">${h.emoji} ${escapeHtml(h.name)}</div>
      <button data-act="log">Log a new entry now</button>
      <button data-act="open" class="secondary">Open habit screen</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTileMenu(); });
  overlay.querySelector('[data-act="log"]').addEventListener("click", () => { closeTileMenu(); logNow(h.id, tile); });
  overlay.querySelector('[data-act="open"]').addEventListener("click", () => { closeTileMenu(); openHabitScreen(h.id); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", closeTileMenu);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
}

function closeTileMenu() {
  const m = $("tile-menu");
  if (m) m.remove();
}

/* ---------- Habit screen ---------- */

let screenHabitId = null;

function openHabitScreen(habitId) {
  screenHabitId = habitId;
  let panel = $("habit-screen");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "habit-screen";
    panel.className = "screen";
    document.body.appendChild(panel);
  }
  renderHabitScreen();
  requestAnimationFrame(() => panel.classList.add("show"));
}

function closeHabitScreen() {
  screenHabitId = null;
  const panel = $("habit-screen");
  if (panel) panel.remove();
}

function renderHabitScreen() {
  const panel = $("habit-screen");
  if (!panel || !screenHabitId) return;
  const h = habits.find((x) => x.id === screenHabitId);
  if (!h) { closeHabitScreen(); return; }

  const { count, daysSince } = stats(h.id);
  const entries = (entriesByHabit[h.id] || []).slice().sort((a, b) => b.at - a.at);

  let historyHtml;
  if (!entries.length) {
    historyHtml = '<p class="msg">No logs yet.</p>';
  } else if (isTouch) {
    // Swipe a row left to reveal a Delete button.
    historyHtml = entries.map((e) => `
      <div class="swipe" data-id="${e.id}">
        <button class="swipe-del" data-id="${e.id}">Delete</button>
        <div class="swipe-content">${fmtDateTime(e.at)}</div>
      </div>`).join("");
  } else {
    // Check rows, then Delete selected.
    historyHtml = `
      <div class="bulk-bar">
        <button data-act="del-selected" disabled>Delete selected</button>
        <span class="sel-count"></span>
      </div>` +
      entries.map((e) => `
        <label class="hist-row select">
          <span>${fmtDateTime(e.at)}</span>
          <input type="checkbox" class="hist-check" data-id="${e.id}" />
        </label>`).join("");
  }

  panel.innerHTML = `
    <header class="screen-head">
      <button class="back" data-act="back">‹ Back</button>
      <div class="screen-title">${h.emoji} ${escapeHtml(h.name)}</div>
      <span class="spacer"></span>
    </header>
    <div class="screen-body">
      <div class="stat-row">
        <div class="stat-box"><div class="big">${count}</div><div class="lbl">total logs</div></div>
        <div class="stat-box"><div class="big">${daysSince === null ? "–" : daysSince}</div><div class="lbl">${daysSince === 1 ? "day since" : "days since"}</div></div>
      </div>

      <button class="wide" data-act="lognow">Log a new entry now</button>

      <section class="card-section">
        <h3>Backdate a log</h3>
        <div class="row">
          <input type="datetime-local" id="hs-date" />
          <button data-act="backdate">Add</button>
        </div>
      </section>

      <section class="card-section">
        <h3>History (${entries.length})</h3>
        <div class="history">${historyHtml}</div>
      </section>

      <section class="card-section">
        <h3>Edit habit</h3>
        <label>Emoji <input id="hs-emoji" maxlength="8" value="${escapeAttr(h.emoji)}" /></label>
        <label>Name <input id="hs-name" value="${escapeAttr(h.name)}" /></label>
        <label>Type
          <select id="hs-type">
            ${TYPES.map((tt) => `<option value="${tt.key}"${tt.key === h.type ? " selected" : ""}>${tt.label}</option>`).join("")}
          </select>
        </label>
        <label class="row">
          <input id="hs-remind" type="checkbox"${h.reminder_enabled ? " checked" : ""} /> Remind me if it's been over
          <input id="hs-threshold" type="number" min="1" class="num" value="${h.reminder_threshold_days || 7}" /> days
        </label>
        <button data-act="save">Save changes</button>
      </section>

      <button class="wide danger" data-act="delete">Delete habit</button>
    </div>`;

  panel.querySelector('[data-act="back"]').addEventListener("click", closeHabitScreen);

  panel.querySelector('[data-act="lognow"]').addEventListener("click", async () => {
    buzz();
    if (await insertEntry(h.id, new Date())) { renderHabitScreen(); render(); }
  });

  panel.querySelector('[data-act="backdate"]').addEventListener("click", async () => {
    const v = $("hs-date").value;
    if (!v) return;
    const when = new Date(v); // datetime-local → local date + time
    if (isNaN(when)) return alert("Couldn't read that date.");
    if (await insertEntry(h.id, when)) { renderHabitScreen(); render(); }
  });

  if (isTouch) {
    panel.querySelectorAll(".swipe").forEach(attachSwipe);
    panel.querySelectorAll(".swipe-del").forEach((b) =>
      b.addEventListener("click", () => deleteEntries(h.id, [b.dataset.id])));
  } else {
    const bar = panel.querySelector('[data-act="del-selected"]');
    const countEl = panel.querySelector(".sel-count");
    const checks = () => Array.from(panel.querySelectorAll(".hist-check"));
    const refresh = () => {
      const n = checks().filter((c) => c.checked).length;
      if (bar) bar.disabled = n === 0;
      if (countEl) countEl.textContent = n ? `${n} selected` : "";
    };
    checks().forEach((c) => c.addEventListener("change", refresh));
    if (bar) bar.addEventListener("click", () => {
      const ids = checks().filter((c) => c.checked).map((c) => c.dataset.id);
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} log${ids.length === 1 ? "" : "s"}?`)) return;
      deleteEntries(h.id, ids);
    });
  }

  panel.querySelector('[data-act="save"]').addEventListener("click", async () => {
    const remind = $("hs-remind").checked;
    const patch = {
      name: $("hs-name").value.trim(),
      emoji: $("hs-emoji").value.trim() || "✅",
      type: $("hs-type").value,
      reminder_enabled: remind,
      reminder_threshold_days: remind ? Number($("hs-threshold").value) : null,
    };
    if (!patch.name) return alert("Name can't be empty.");
    const { error } = await db.from("habits").update(patch).eq("id", h.id);
    if (error) return alert(error.message);
    Object.assign(h, patch);
    renderHabitScreen(); render();
    showToast("Saved changes");
  });

  panel.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (!confirm(`Delete “${h.name}” and all its logs?`)) return;
    const { error } = await db.from("habits").delete().eq("id", h.id);
    if (error) return alert(error.message);
    habits = habits.filter((x) => x.id !== h.id);
    delete entriesByHabit[h.id];
    closeHabitScreen(); render();
  });
}

// Delete one or many entries, then refresh screen + grid.
async function deleteEntries(habitId, ids) {
  const { error } = await db.from("entries").delete().in("id", ids);
  if (error) return alert(error.message);
  entriesByHabit[habitId] = (entriesByHabit[habitId] || []).filter((e) => !ids.includes(e.id));
  renderHabitScreen();
  render();
}

// Horizontal drag on a history row reveals its Delete button; only one row open at a time.
function attachSwipe(row) {
  const content = row.querySelector(".swipe-content");
  const REVEAL = 84;
  let startX = 0, base = 0, dragging = false, moved = false;

  content.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false; startX = e.clientX;
    base = row.classList.contains("open") ? -REVEAL : 0;
    content.style.transition = "none";
    content.setPointerCapture(e.pointerId);
  });
  content.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    let x = base + dx;
    if (x > 0) x = 0;                                        // don't drag past closed
    else if (x < -REVEAL) x = -REVEAL + (x + REVEAL) * 0.35; // rubber-band past the reveal point
    content.style.transform = `translateX(${x}px)`;
  });
  const settle = (e) => {
    if (!dragging) return;
    dragging = false;
    content.style.transition = "";
    content.style.transform = ""; // hand final position back to the .open CSS class
    const x = base + (e ? e.clientX - startX : 0);
    row.parentElement.querySelectorAll(".swipe.open").forEach((r) => { if (r !== row) r.classList.remove("open"); });
    row.classList.toggle("open", x < -REVEAL / 2);
  };
  content.addEventListener("pointerup", settle);
  content.addEventListener("pointercancel", () => { dragging = false; content.style.transition = ""; content.style.transform = ""; });
  content.addEventListener("click", (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); return; }
    if (row.classList.contains("open")) row.classList.remove("open"); // tap open row to close
  });
}

function fmtDateTime(d) {
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// overdue first, then alphabetical — used within a type group.
function overdueFirstThenName(a, b) {
  const oa = isOverdue(a, stats(a.id).daysSince), ob = isOverdue(b, stats(b.id).daysSince);
  if (oa !== ob) return oa ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// Due view: never-logged first, then longest-overdue first.
function dueSort(a, b) {
  const da = stats(a.id).daysSince, dbb = stats(b.id).daysSince;
  if (da === null && dbb === null) return a.name.localeCompare(b.name);
  if (da === null) return -1;
  if (dbb === null) return 1;
  return dbb - da;
}

function msgEl(text) {
  const p = document.createElement("p");
  p.className = "msg";
  p.style.marginTop = "40px";
  p.textContent = text;
  return p;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Actions ---------- */

async function logNow(habitId, tile) {
  buzz();
  popTile(tile);
  const row = await insertEntry(habitId, new Date());
  if (!row) return;
  updateTile(habitId);
  const h = habits.find((x) => x.id === habitId);
  showToast(`Logged ${h.emoji} ${h.name}`, () => undoLog(habitId, row.id));
  // On the Due page a logged habit is no longer due — let the pop play, then re-render so it drops off.
  if (currentView === "due") setTimeout(() => { if (currentView === "due") render(); }, 850);
}

// Insert an entry; returns the new row ({id}) or null on error.
async function insertEntry(habitId, when) {
  const { data: u } = await db.auth.getUser();
  const { data, error } = await db.from("entries").insert({
    habit_id: habitId, user_id: u.user.id, logged_at: when.toISOString(),
  }).select("id").single();
  if (error) { alert(error.message); return null; }
  (entriesByHabit[habitId] ||= []).push({ id: data.id, at: when });
  return data;
}

async function undoLog(habitId, entryId) {
  const { error } = await db.from("entries").delete().eq("id", entryId);
  if (error) return alert(error.message);
  entriesByHabit[habitId] = (entriesByHabit[habitId] || []).filter((e) => e.id !== entryId);
  if (currentView === "due") render(); else updateTile(habitId);
  hideToast();
}

/* ---------- Feedback helpers ---------- */

function buzz() { if (navigator.vibrate) navigator.vibrate(15); }

function popTile(tile) {
  if (!tile) return;
  tile.classList.remove("pop");
  void tile.offsetWidth;            // restart the animation if tapped again quickly
  tile.classList.add("pop");
  const plus = document.createElement("div");
  plus.className = "float-plus";
  plus.textContent = "+1";
  tile.appendChild(plus);
  setTimeout(() => { tile.classList.remove("pop"); plus.remove(); }, 800);
}

// Update one tile's stat/count/overdue in place, without rebuilding the grid.
function updateTile(habitId) {
  const tile = document.querySelector(`.tile[data-habit-id="${habitId}"]`);
  if (!tile) return;
  const h = habits.find((x) => x.id === habitId);
  const { count, daysSince } = stats(habitId);
  const overdue = isOverdue(h, daysSince);
  tile.classList.toggle("overdue", overdue);
  tile.querySelector(".stat").textContent = sinceText(daysSince);
  tile.querySelector(".count").textContent = `${count}×${overdue ? " · due" : ""}`;
}

let toastTimer = null;
function showToast(msg, onUndo) {
  const toast = $("toast");
  $("toast-msg").textContent = msg;
  const undo = $("toast-undo");
  undo.classList.toggle("hidden", !onUndo);
  undo.onclick = onUndo || null;
  toast.classList.remove("hidden");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  const toast = $("toast");
  toast.classList.remove("show");
  clearTimeout(toastTimer);
  setTimeout(() => toast.classList.add("hidden"), 200);
}

/* ---------- Add habit modal ---------- */

$("add-habit").addEventListener("click", () => $("modal").classList.remove("hidden"));
$("h-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));

$("habit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data: u } = await db.auth.getUser();
  const remind = $("h-remind").checked;
  const { data, error } = await db.from("habits").insert({
    user_id: u.user.id,
    name: $("h-name").value.trim(),
    type: $("h-type").value,
    emoji: $("h-emoji").value.trim() || "✅",
    reminder_enabled: remind,
    reminder_threshold_days: remind ? Number($("h-threshold").value) : null,
    sort_order: habits.length,
  }).select().single();
  if (error) return alert(error.message);
  habits.push(data);
  $("habit-form").reset();
  $("h-emoji").value = "✅";
  $("modal").classList.add("hidden");
  render();
});

// Escape closes the popup first, then the habit screen.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("tile-menu")) closeTileMenu();
  else if (screenHabitId) closeHabitScreen();
});

/* ---------- Boot ---------- */

if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<p style="padding:24px;font-family:sans-serif;color:#e8ecf1;background:#111418">' +
    "Set your Supabase URL and anon key in <code>config.js</code> first.</p>";
} else {
  refreshSession();
}
