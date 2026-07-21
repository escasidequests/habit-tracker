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

// Curated starter habits. `days` (when present) pre-fills a reminder threshold;
// bad/neutral habits omit it since a "days since" nudge doesn't fit them.
const SUGGESTIONS = [
  { emoji: "🏋️", name: "Workout", type: "good", days: 2 },
  { emoji: "🧘", name: "Meditate", type: "good", days: 2 },
  { emoji: "🦷", name: "Floss", type: "good", days: 1 },
  { emoji: "📖", name: "Read", type: "good", days: 3 },
  { emoji: "🚶", name: "Walk", type: "good", days: 2 },
  { emoji: "✍️", name: "Journal", type: "good", days: 3 },
  { emoji: "💧", name: "Drink water", type: "good", days: 1 },
  { emoji: "🚬", name: "Smoke", type: "bad" },
  { emoji: "🍺", name: "Alcohol", type: "bad" },
  { emoji: "🍭", name: "Junk food", type: "bad" },
  { emoji: "📱", name: "Doomscroll", type: "bad" },
  { emoji: "🛒", name: "Impulse buy", type: "bad" },
  { emoji: "☕", name: "Coffee", type: "neutral" },
  { emoji: "🎮", name: "Gaming", type: "neutral" },
  { emoji: "📺", name: "Watch a show", type: "neutral" },
  { emoji: "💤", name: "Nap", type: "neutral" },
  { emoji: "🤙", name: "Call parents", type: "people_hangcall", days: 7 },
  { emoji: "👵", name: "Call grandparents", type: "people_hangcall", days: 14 },
  { emoji: "🍽️", name: "Dinner with friends", type: "people_hangcall", days: 14 },
  { emoji: "🧑‍🤝‍🧑", name: "See friends", type: "people_hangcall", days: 10 },
  { emoji: "💬", name: "Text a friend", type: "people_text", days: 7 },
  { emoji: "👋", name: "Reconnect with someone", type: "people_text", days: 30 },
  { emoji: "📨", name: "Check in with sibling", type: "people_text", days: 14 },
];

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
// Touch-primary devices (phones/tablets) get swipe-to-delete; mouse-primary gets checkboxes.
const isTouch = window.matchMedia("(pointer: coarse)").matches;
// Build number — keep in lockstep with CACHE in sw.js. Shown on the Notifications
// screen so you can confirm a deploy actually landed after refreshing.
const APP_BUILD = "14";

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
  if (loggedIn) maybeShowInstallTip();
}

// iPhone users in Safari (not installed) miss out on reminders — nudge them once.
function maybeShowInstallTip() {
  const show = isIOS && !isStandalone() && !localStorage.getItem("installTipDismissed");
  $("install-tip").classList.toggle("hidden", !show);
}
$("install-dismiss").addEventListener("click", () => {
  localStorage.setItem("installTipDismissed", "1");
  $("install-tip").classList.add("hidden");
});

// Empty-state shortcut straight into the suggestions browser.
$("empty-suggest").addEventListener("click", () => {
  $("habit-form").reset();
  $("modal").classList.remove("hidden");
  openSuggestions();
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("auth-msg").textContent = error ? friendlyAuthError(error) : "";
  if (!error) refreshSession();
});

$("signup").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email || !$("password").value) {
    $("auth-msg").textContent = "Enter an email and password first.";
    return;
  }
  const { data, error } = await db.auth.signUp({
    email,
    password: $("password").value,
    options: { emailRedirectTo: appUrl() }, // land back on THIS app after confirming
  });
  if (error) { $("auth-msg").textContent = friendlyAuthError(error); return; }
  $("auth-msg").textContent = data.session
    ? "" : "Account created — check your email for a confirmation link, then sign in.";
  if (data.session) refreshSession();
});

$("forgot").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) { $("auth-msg").textContent = "Enter your email above first, then tap “Forgot password?”."; return; }
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  $("auth-msg").textContent = error
    ? friendlyAuthError(error)
    : "Check your email for a link to reset your password.";
});

$("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.updateUser({ password: $("new-password").value });
  if (error) { $("reset-msg").textContent = friendlyAuthError(error); return; }
  $("reset").classList.add("hidden");
  $("new-password").value = "";
  refreshSession();
});

$("signout").addEventListener("click", async () => {
  await db.auth.signOut();
  showApp(false);
});

// When the user arrives via a password-reset link, Supabase fires this event.
db.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    $("app").classList.add("hidden");
    $("auth").classList.add("hidden");
    $("reset").classList.remove("hidden");
  }
});

// This app's own URL (origin + path), used as the auth redirect target.
function appUrl() {
  return window.location.origin + window.location.pathname;
}

// Turn raw Supabase auth errors into friendly, human messages.
function friendlyAuthError(error) {
  const m = (error && error.message) || "Something went wrong.";
  const low = m.toLowerCase();
  if (low.includes("invalid login")) return "Wrong email or password.";
  if (low.includes("email not confirmed")) return "Please confirm your email first — check your inbox.";
  if (low.includes("already registered") || low.includes("already been registered")) return "That email already has an account — try signing in.";
  if (low.includes("password should be") || low.includes("at least")) return "Password is too short — use at least 6 characters.";
  if (low.includes("unable to validate email") || low.includes("invalid format")) return "That doesn't look like a valid email.";
  if (low.includes("rate limit") || low.includes("too many")) return "Too many attempts — wait a minute and try again.";
  return m;
}

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
    <span class="due-badge">DUE</span>
    <div class="emoji">${h.emoji}</div>
    <div class="name">${escapeHtml(h.name)}</div>
    <div class="stat">${sinceText(daysSince)}</div>
    <div class="count">${count}×</div>`;
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

// Vibration works on Android; iOS Safari has no Web Vibration API, so this is a
// no-op on iPhone (tap feedback there is visual — see popTile / .pop in styles.css).
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
  setTimeout(() => { tile.classList.remove("pop"); plus.remove(); }, 950);
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
  tile.querySelector(".count").textContent = `${count}×`;
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

$("add-habit").addEventListener("click", () => { $("habit-form").reset(); $("modal").classList.remove("hidden"); });
$("h-cancel").addEventListener("click", () => { $("modal").classList.add("hidden"); $("habit-form").reset(); });

/* ---------- Suggested habits ---------- */

$("open-suggestions").addEventListener("click", openSuggestions);

function openSuggestions() {
  let panel = $("suggest-screen");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "suggest-screen";
    panel.className = "screen";
    document.body.appendChild(panel);
  }
  const have = new Set(habits.map((h) => h.name.trim().toLowerCase()));

  let body = "";
  for (const t of TYPES) {
    const items = SUGGESTIONS
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.type === t.key && !have.has(s.name.toLowerCase()));
    if (!items.length) continue;
    body += `<section class="card-section"><h3>${t.label}</h3><div class="tiles">` +
      items.map(({ s, i }) => `
        <div class="tile suggest-tile" data-i="${i}" style="--type:${t.color}">
          <div class="emoji">${s.emoji}</div>
          <div class="name">${escapeHtml(s.name)}</div>
          ${s.days ? `<div class="count">remind ${s.days}d</div>` : ""}
        </div>`).join("") +
      `</div></section>`;
  }
  if (!body) body = '<p class="msg" style="margin-top:40px">You\'ve added all the suggestions! 🎉</p>';

  panel.innerHTML = `
    <header class="screen-head">
      <button class="back" data-act="back">‹ Back</button>
      <div class="screen-title">✨ Suggested habits</div>
      <span class="spacer"></span>
    </header>
    <div class="screen-body">${body}</div>`;

  panel.querySelector('[data-act="back"]').addEventListener("click", closeSuggestions);
  panel.querySelectorAll(".suggest-tile").forEach((el) => el.addEventListener("click", () => {
    closeSuggestions();
    prefillHabitForm(SUGGESTIONS[Number(el.dataset.i)]);
  }));
  requestAnimationFrame(() => panel.classList.add("show"));
}

function closeSuggestions() {
  const p = $("suggest-screen");
  if (p) p.remove();
}

// Drop a suggestion into the (already-open) New habit form for editing.
function prefillHabitForm(s) {
  $("modal").classList.remove("hidden");
  $("h-emoji").value = s.emoji;
  $("h-name").value = s.name;
  $("h-type").value = s.type;
  $("h-remind").checked = !!s.days;
  $("h-threshold").value = s.days || 7;
}

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

/* ---------- Push notifications ---------- */

const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

$("notif-btn").addEventListener("click", openNotifScreen);

function openNotifScreen() {
  let panel = $("notif-screen");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "notif-screen";
    panel.className = "screen";
    document.body.appendChild(panel);
  }
  renderNotifScreen();
  requestAnimationFrame(() => panel.classList.add("show"));
}

function closeNotifScreen() {
  const p = $("notif-screen");
  if (p) p.remove();
}

async function renderNotifScreen() {
  const panel = $("notif-screen");
  if (!panel) return;

  const perm = pushSupported ? Notification.permission : "unsupported";
  const standalone = isStandalone();
  let subscribed = false;
  if (pushSupported) {
    try {
      const reg = await navigator.serviceWorker.ready;
      subscribed = !!(await reg.pushManager.getSubscription());
    } catch (_) {}
  }

  // Current reminder settings (null if the table/row isn't there yet).
  let settings = null;
  try { settings = (await db.from("push_settings").select("send_hour, timezone").maybeSingle()).data; } catch (_) {}
  const tz = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  let guidance = "";
  if (!pushSupported) {
    guidance = `<div class="notice">This browser doesn't support web push notifications.</div>`;
  } else if (isIOS && !standalone) {
    guidance = `<div class="notice">On iPhone, notifications only work when this app is
      <b>added to your Home Screen</b>. In Safari tap the <b>Share</b> icon →
      <b>Add to Home Screen</b>, then open the app from that icon and come back here.</div>`;
  }

  const canEnable = pushSupported && (!isIOS || standalone) && perm !== "denied";
  const deniedNote = perm === "denied"
    ? `<p class="msg">Notifications are blocked. Turn them on for this app in your device settings, then reopen this screen.</p>`
    : "";

  panel.innerHTML = `
    <header class="screen-head">
      <button class="back" data-act="back">‹ Back</button>
      <div class="screen-title">🔔 Notifications</div>
      <span class="spacer"></span>
    </header>
    <div class="screen-body">
      ${guidance}
      <section class="card-section">
        <h3>Status</h3>
        <div class="kv"><span>Push supported</span><b>${pushSupported ? "Yes" : "No"}</b></div>
        <div class="kv"><span>Added to Home Screen</span><b>${standalone ? "Yes" : "No"}</b></div>
        <div class="kv"><span>Permission</span><b>${perm}</b></div>
        <div class="kv"><span>Subscribed on this device</span><b>${subscribed ? "Yes" : "No"}</b></div>
      </section>
      ${deniedNote}
      <button class="wide" data-act="enable"${canEnable ? "" : " disabled"}>
        ${subscribed ? "Re-subscribe this device" : "Enable notifications"}
      </button>
      <button class="wide secondary" data-act="test"${perm === "granted" ? "" : " disabled"}>Send a test notification</button>
      ${subscribed ? `
      <section class="card-section">
        <h3>Reminder schedule</h3>
        <label>Send time
          <select id="ns-hour">${hourOptions(settings?.send_hour ?? 8)}</select>
        </label>
        <div class="kv"><span>Time zone</span><b>${escapeHtml(tz)}</b></div>
        <p class="hint" style="margin:0">One daily digest of everything that's due.</p>
      </section>` : ""}
      <p class="hint">The test fires a notification straight from this device (no server needed) to
        confirm they show up. Scheduled "habit due" reminders arrive once the backend is set up.</p>
      <p class="hint" style="margin-top:0">Build ${APP_BUILD}</p>
    </div>`;

  panel.querySelector('[data-act="back"]').addEventListener("click", closeNotifScreen);
  panel.querySelector('[data-act="enable"]').addEventListener("click", enableNotifications);
  panel.querySelector('[data-act="test"]').addEventListener("click", testNotification);
  const hourSel = panel.querySelector("#ns-hour");
  if (hourSel) hourSel.addEventListener("change", async (e) => {
    try { await savePushSettings({ send_hour: Number(e.target.value) }); showToast("Reminder time saved"); }
    catch (err) { alert("Couldn't save: " + err.message); }
  });
}

function hourOptions(sel) {
  let o = "";
  for (let h = 0; h < 24; h++) {
    const label = `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;
    o += `<option value="${h}"${h === sel ? " selected" : ""}>${label}</option>`;
  }
  return o;
}

async function enableNotifications() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { renderNotifScreen(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.VAPID_PUBLIC_KEY),
      });
    }
    // Best-effort: persist to Supabase. If the tables aren't there yet, we still succeed locally.
    try {
      await savePushSubscription(sub);
      await savePushSettings({ enabled: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    } catch (err) { console.warn("Not saved to Supabase yet:", err.message); }
    renderNotifScreen();
    showToast("Notifications enabled");
  } catch (err) {
    alert("Couldn't enable notifications: " + err.message);
  }
}

async function testNotification() {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Habit Tracker", {
      body: "Test notification — it works! 🎉",
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: "habit-test",
    });
  } catch (err) {
    alert("Test failed: " + err.message);
  }
}

async function savePushSubscription(sub) {
  const { data: u } = await db.auth.getUser();
  const j = sub.toJSON();
  const { error } = await db.from("push_subscriptions").upsert({
    user_id: u.user.id,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

async function savePushSettings(patch) {
  const { data: u } = await db.auth.getUser();
  const { error } = await db.from("push_settings").upsert(
    { user_id: u.user.id, ...patch }, { onConflict: "user_id" });
  if (error) throw error;
}

// VAPID public key (base64url) → Uint8Array, as pushManager.subscribe requires.
function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Escape closes the popup first, then the habit screen.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("tile-menu")) closeTileMenu();
  else if ($("notif-screen")) closeNotifScreen();
  else if ($("suggest-screen")) closeSuggestions();
  else if (screenHabitId) closeHabitScreen();
  else if (!$("modal").classList.contains("hidden")) { $("modal").classList.add("hidden"); $("habit-form").reset(); }
});

/* ---------- Boot ---------- */

if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<p style="padding:24px;font-family:sans-serif;color:#e8ecf1;background:#111418">' +
    "Set your Supabase URL and anon key in <code>config.js</code> first.</p>";
} else {
  refreshSession();
}
