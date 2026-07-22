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

// Interval-prediction tuning — MUST stay in sync with the same constants in
// supabase/functions/send-reminders/index.ts.
const PRED_WINDOW = 5;    // average the most recent N gaps
const PRED_MIN_GAPS = 2;  // need at least this many gaps before predicting/nudging
const PRED_GRACE = 1.2;   // "Automatic" habit is due once days-since exceeds avg gap * this
// Touch-primary devices (phones/tablets) get swipe-to-delete; mouse-primary gets checkboxes.
const isTouch = window.matchMedia("(pointer: coarse)").matches;
// Build number — keep in lockstep with CACHE in sw.js. Shown on the Notifications
// screen so you can confirm a deploy actually landed after refreshing.
const APP_BUILD = "29";

// Optional per-habit accent colors. null = fall back to the habit's type color.
const COLORS = ["#37b26b", "#e5533c", "#f0b429", "#4f8cf5", "#a06cd5", "#26c6da", "#ec6ea6", "#7f8b98"];

let habits = [];
let entriesByHabit = {}; // habit_id -> [{id, at, note}, ...]

// UI state (sort_mode + dayStartHour are synced via user_prefs; the rest are
// session-local).
let sortMode = "manual";   // manual | activity | created | alpha
let dayStartHour = 0;      // 0-11; when a new "day" begins for calendar-day counts
let searchTerm = "";
let showHidden = false;
let reorderMode = false;
let newHabitColor = null;  // color chosen in the add-habit form

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
  openAddHabit();
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
  let email = $("email").value.trim();
  if (!email) email = (prompt("Enter your account email to reset your password:") || "").trim();
  if (!email) return;
  $("auth-msg").textContent = "Sending reset email…"; // instant feedback, before any network call
  try {
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    $("auth-msg").textContent = error
      ? friendlyAuthError(error)
      : "Check your email for a link to reset your password.";
  } catch (err) {
    $("auth-msg").textContent = "Couldn't send reset email: " + (err && err.message ? err.message : err);
  }
});

$("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.updateUser({ password: $("new-password").value });
  if (error) { $("reset-msg").textContent = friendlyAuthError(error); return; }
  $("reset").classList.add("hidden");
  $("new-password").value = "";
  refreshSession();
});

async function signOut() {
  await db.auth.signOut();
  showApp(false);
}

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
    db.from("entries").select("id, habit_id, logged_at, note"),
  ]);
  if (he || ee) { alert((he || ee).message); return; }
  habits = h || [];
  entriesByHabit = {};
  (en || []).forEach((row) => {
    (entriesByHabit[row.habit_id] ||= []).push({ id: row.id, at: new Date(row.logged_at), note: row.note || "" });
  });
  await loadPrefs();
  render();
}

// Cross-device UI preferences (currently just the sort mode).
async function loadPrefs() {
  try {
    const { data } = await db.from("user_prefs").select("sort_mode, day_start_hour").maybeSingle();
    if (data?.sort_mode) sortMode = data.sort_mode;
    if (data && data.day_start_hour != null) dayStartHour = data.day_start_hour;
  } catch (_) { /* table/column may not exist yet — keep the defaults */ }
}

async function saveSortMode(mode) {
  sortMode = mode;
  try {
    const { data: u } = await db.auth.getUser();
    await db.from("user_prefs").upsert(
      { user_id: u.user.id, sort_mode: mode, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });
  } catch (err) { console.warn("Couldn't save sort preference:", err.message); }
}

async function saveDayStartHour(hour) {
  dayStartHour = hour;
  try {
    const { data: u } = await db.auth.getUser();
    await db.from("user_prefs").upsert(
      { user_id: u.user.id, day_start_hour: hour, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });
  } catch (err) { console.warn("Couldn't save day-start preference:", err.message); }
}

// Calendar-day number for a timestamp (ms), honoring the user's day-start hour.
// A "day" runs from dayStartHour:00 to the next day's dayStartHour:00 in local
// time, so with dayStartHour=4 a 1am log falls in the previous day's bucket.
// "Days since" and all gap math are differences of these integers, so they no
// longer drift with the time of day you logged. MUST mirror dayIndex() in the
// Edge Function. Bump APP_BUILD (and sw.js CACHE) when this logic changes.
function dayIndex(ts) {
  const shifted = ts - dayStartHour * 3600000;
  const local = shifted - new Date(shifted).getTimezoneOffset() * 60000; // to local wall-clock
  return Math.floor(local / DAY);
}

function stats(habitId) {
  const list = entriesByHabit[habitId] || [];
  if (!list.length) return { count: 0, daysSince: null };
  const last = Math.max(...list.map((e) => e.at.getTime()));
  return { count: list.length, daysSince: dayIndex(Date.now()) - dayIndex(last) };
}

// Average of a habit's most recent log gaps (in days). learning=true when there
// aren't enough gaps yet to trust a pattern.
function predictInterval(habitId) {
  const list = (entriesByHabit[habitId] || []).map((e) => e.at.getTime());
  if (list.length < PRED_MIN_GAPS + 1) return { avg: null, learning: true };
  const days = list.map(dayIndex).sort((a, b) => a - b); // calendar-day numbers
  const gaps = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  const recent = gaps.slice(-PRED_WINDOW);
  return { avg: recent.reduce((s, g) => s + g, 0) / recent.length, learning: false };
}

/* ---------- Trend chart (per-habit line of days-between-logs) ---------- */

// Hex equivalents of the type CSS vars — SVG stroke can't resolve var(--x).
const TYPE_HEX = {
  good: "#37b26b", bad: "#e5533c", neutral: "#7f8b98",
  people_hangcall: "#4f8cf5", people_text: "#4f8cf5",
};
function trendColor(h) { return h.color || TYPE_HEX[h.type] || "#7f8b98"; }

// Type-specific framing: what "longer gaps" means differs for a vice vs a habit.
function trendConfig(type) {
  if (type === "bad") return { title: "Trend — days between", longestLabel: "Longest clean stretch", caption: "Higher is better — longer gaps mean progress." };
  if (type === "people_hangcall" || type === "people_text") return { title: "Trend — days between", longestLabel: "Longest gap", caption: "Lower means you're staying in touch." };
  if (type === "good") return { title: "Trend — days between logs", longestLabel: "Longest gap", caption: "Lower means you're doing it more often." };
  return { title: "Trend — days between logs", longestLabel: "Longest gap", caption: "" }; // neutral
}

// A responsive SVG line chart of the given gaps (days), scaled to fit.
function trendSvg(gaps, color) {
  const W = 320, H = 120, padX = 10, padY = 14;
  const n = gaps.length;
  const maxG = Math.max(...gaps, 1);
  const x = (i) => padX + (n === 1 ? (W - 2 * padX) / 2 : (i * (W - 2 * padX)) / (n - 1));
  const y = (g) => H - padY - (g / maxG) * (H - 2 * padY);
  const pts = gaps.map((g, i) => `${x(i).toFixed(1)},${y(g).toFixed(1)}`).join(" ");
  const dots = gaps.map((g, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(g).toFixed(1)}" r="2.6" fill="${color}" />`).join("");
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Days between logs over time">
    <line class="trend-axis" x1="${padX}" y1="${H - padY}" x2="${W - padX}" y2="${H - padY}" />
    <polyline class="trend-line" fill="none" stroke="${color}" stroke-width="2.5" points="${pts}" />
    ${dots}
  </svg>`;
}

// Full "Trend" card for the habit screen. Needs >=3 logs (2 gaps) to draw a line.
function buildTrend(h) {
  const list = (entriesByHabit[h.id] || []).map((e) => dayIndex(e.at.getTime())).sort((a, b) => a - b);
  const cfg = trendConfig(h.type);
  let body;
  if (list.length < 3) {
    body = '<p class="msg" style="margin:0">Log a few more times to see your trend.</p>';
  } else {
    const allGaps = [];
    for (let i = 1; i < list.length; i++) allGaps.push(list[i] - list[i - 1]);
    const gaps = allGaps.slice(-20); // recent window, matches the prediction idea
    const avg = allGaps.reduce((s, g) => s + g, 0) / allGaps.length;
    const longest = Math.max(...allGaps);
    body = `
      ${trendSvg(gaps, trendColor(h))}
      <div class="trend-stats">
        <span>Avg <b>${Math.round(avg)}d</b></span>
        <span>${cfg.longestLabel} <b>${Math.round(longest)}d</b></span>
      </div>
      ${cfg.caption ? `<p class="hint" style="margin:0">${cfg.caption}</p>` : ""}`;
  }
  return `<section class="card-section"><h3>${cfg.title}</h3>${body}</section>`;
}

function sinceText(daysSince) {
  return daysSince === null ? "never logged"
    : daysSince === 0 ? "today"
    : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
}

// 'none' | 'soon' | 'overdue'. "soon" = within the habit's lead-time window
// before its due point; "overdue" = past it. Lead 0 → soon never fires (matches
// the old overdue-only behavior). MUST mirror dueStatus() in the Edge Function.
function dueStatus(h, daysSince) {
  if (h.paused) return "none";
  const lead = h.reminder_lead_days || 0;
  if (h.due_mode === "recurrence") {
    if (!h.recurrence_days) return "none";
    if (daysSince === null || daysSince > h.recurrence_days) return "overdue";
    if (daysSince > h.recurrence_days - lead) return "soon";
    return "none";
  }
  if (h.due_mode === "interval") {
    const { avg, learning } = predictInterval(h.id);
    if (learning || daysSince === null) return "none"; // still learning / no data
    const threshold = avg * PRED_GRACE;
    if (daysSince > threshold) return "overdue";
    if (daysSince > threshold - lead) return "soon";
    return "none";
  }
  return "none"; // 'none' — just tracking
}

function isActive(h, daysSince) { const s = dueStatus(h, daysSince); return s === "soon" || s === "overdue"; }

// Days until a habit's due point (negative = overdue). Infinity when it has no
// due point yet (no mode, never logged, or still learning). Used to sort "soon".
function daysUntilDue(h) {
  const d = stats(h.id).daysSince;
  if (d === null) return Infinity;
  if (h.due_mode === "recurrence" && h.recurrence_days) return h.recurrence_days - d;
  if (h.due_mode === "interval") {
    const { avg, learning } = predictInterval(h.id);
    if (!learning) return avg * PRED_GRACE - d;
  }
  return Infinity;
}

// The accent color a habit renders with: its custom color, or its type color.
function habitColor(h) {
  if (h.color) return h.color;
  const t = TYPES.find((x) => x.key === h.type);
  return t ? t.color : "var(--neutral)";
}

// Sort within a type group: pinned first, then by the chosen sort mode.
function sortForGroup(list) {
  const byMode = {
    manual: (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name),
    activity: (a, b) => {
      const da = stats(a.id).daysSince, dbb = stats(b.id).daysSince;
      if (da === null && dbb === null) return a.name.localeCompare(b.name);
      if (da === null) return 1;   // never-logged sinks to the bottom
      if (dbb === null) return -1;
      return da - dbb;             // most recent activity first
    },
    created: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    alpha: (a, b) => a.name.localeCompare(b.name),
  };
  const cmp = byMode[sortMode] || byMode.manual;
  return list.slice().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || cmp(a, b));
}

/* ---------- Render ---------- */

function render() {
  // Reorder only makes sense in manual order on a grouped (non-Due) view.
  if (reorderMode && (currentView === "due" || sortMode !== "manual")) reorderMode = false;

  renderTabs();
  renderControls();
  const grid = $("grid");
  grid.innerHTML = "";
  grid.classList.toggle("reordering", reorderMode);
  $("empty").classList.toggle("hidden", habits.length > 0);
  if (!habits.length) return;

  const view = VIEWS.find((v) => v.key === currentView) || VIEWS[0];
  const q = searchTerm.trim().toLowerCase();
  const matches = (h) => !q || h.name.toLowerCase().includes(q);

  if (reorderMode) grid.appendChild(hintEl("Drag tiles to reorder — tap Done when finished."));

  if (view.key === "due") {
    const inView = habits.filter((h) => matches(h));
    const soon = inView.filter((h) => dueStatus(h, stats(h.id).daysSince) === "soon").sort(soonSort);
    const over = inView.filter((h) => dueStatus(h, stats(h.id).daysSince) === "overdue").sort(dueSort);
    if (soon.length) renderGroup(grid, "Coming up", soon);
    if (over.length) renderGroup(grid, "Overdue", over);
    if (!soon.length && !over.length) {
      grid.appendChild(msgEl(q ? "No matches due." : "Nothing due right now — you're all caught up. 🎉"));
    }
    return;
  }

  let any = false;
  for (const t of TYPES) {
    if (!view.types.includes(t.key)) continue;
    const inType = habits.filter((h) => h.type === t.key && matches(h) && (showHidden || !h.hidden));
    if (inType.length) { renderGroup(grid, t.label, sortForGroup(inType)); any = true; }
  }
  const hiddenInView = habits.filter((h) => view.types.includes(h.type) && matches(h) && h.hidden).length;
  if (!any && !hiddenInView) grid.appendChild(msgEl(q ? "No matching habits." : "No habits here yet — add one with “+ Habit”."));
  if (hiddenInView) {
    const btn = document.createElement("button");
    btn.className = "show-hidden";
    btn.textContent = showHidden ? "Hide hidden habits" : `Show ${hiddenInView} hidden`;
    btn.addEventListener("click", () => { showHidden = !showHidden; render(); });
    grid.appendChild(btn);
  }
}

// Search box is always shown when habits exist; sort + reorder only on grouped views.
function renderControls() {
  const bar = $("controls");
  const has = habits.length > 0;
  bar.classList.toggle("hidden", !has);
  if (!has) return;
  const onDue = currentView === "due";
  const sortSel = $("sort");
  sortSel.classList.toggle("hidden", onDue);
  sortSel.value = sortMode;
  const reorderBtn = $("reorder");
  reorderBtn.classList.toggle("hidden", onDue || sortMode !== "manual");
  reorderBtn.classList.toggle("active", reorderMode);
  reorderBtn.textContent = reorderMode ? "Done" : "Reorder";
}

// Tab bar across the top; the "Due" tab carries a live count badge.
function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  const dueCount = habits.filter((h) => isActive(h, stats(h.id).daysSince)).length;
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
  const { count, daysSince } = stats(h.id);
  const status = dueStatus(h, daysSince);
  const tile = document.createElement("div");
  tile.className = "tile" + (status === "overdue" ? " overdue" : status === "soon" ? " soon" : "") +
    (h.paused ? " paused" : "") + (h.hidden ? " is-hidden" : "");
  tile.dataset.habitId = h.id;
  tile.style.setProperty("--type", habitColor(h));
  const flags = (h.pinned ? "📌" : "") + (h.paused ? "⏸" : "");
  tile.innerHTML = `
    <span class="due-badge">${status === "soon" ? "SOON" : "DUE"}</span>
    ${flags ? `<span class="tile-flags">${flags}</span>` : ""}
    <div class="emoji">${h.emoji}</div>
    <div class="name">${escapeHtml(h.name)}</div>
    <div class="stat">${sinceText(daysSince)}</div>
    <div class="count">${count}×</div>`;
  if (reorderMode) attachReorderGestures(tile);
  else attachTileGestures(tile, h);
  return tile;
}

// Drag-to-reorder (manual sort only). Reorders tiles within their group, then
// persists the new global sort_order. Pointer-based so it works on touch + mouse.
let dragEl = null;
function attachReorderGestures(tile) {
  tile.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    dragEl = tile;
    tile.classList.add("dragging");
    tile.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".tile");
      if (!over || over === dragEl || over.parentElement !== dragEl.parentElement) return;
      const r = over.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height / 2 || (ev.clientX - r.left) > r.width / 2;
      over.parentElement.insertBefore(dragEl, after ? over.nextSibling : over);
    };
    const up = (ev) => {
      tile.releasePointerCapture(ev.pointerId);
      tile.classList.remove("dragging");
      tile.removeEventListener("pointermove", move);
      tile.removeEventListener("pointerup", up);
      tile.removeEventListener("pointercancel", up);
      dragEl = null;
      persistOrder();
    };
    tile.addEventListener("pointermove", move);
    tile.addEventListener("pointerup", up);
    tile.addEventListener("pointercancel", up);
  });
}

// Reassign sort_order to match the tiles' current top-to-bottom visual order.
async function persistOrder() {
  const ids = Array.from(document.querySelectorAll("#grid .tile[data-habit-id]")).map((t) => t.dataset.habitId);
  for (let i = 0; i < ids.length; i++) {
    const h = habits.find((x) => x.id === ids[i]);
    if (h && h.sort_order !== i) {
      h.sort_order = i;
      const { error } = await db.from("habits").update({ sort_order: i }).eq("id", h.id);
      if (error) { alert(error.message); return; }
    }
  }
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
      <button data-act="pin" class="secondary">${h.pinned ? "📌 Unpin" : "📌 Pin to top"}</button>
      <button data-act="pause" class="secondary">${h.paused ? "▶️ Resume" : "⏸ Pause"}</button>
      <button data-act="open" class="secondary">Open habit screen</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTileMenu(); });
  overlay.querySelector('[data-act="log"]').addEventListener("click", () => { closeTileMenu(); logNow(h.id, tile); });
  overlay.querySelector('[data-act="pin"]').addEventListener("click", () => { closeTileMenu(); togglePin(h); });
  overlay.querySelector('[data-act="pause"]').addEventListener("click", () => { closeTileMenu(); togglePause(h); });
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

  let cadence = "";
  if (h.due_mode === "recurrence" && h.recurrence_days) {
    cadence = `⏰ Reminder: every ${h.recurrence_days} day${h.recurrence_days === 1 ? "" : "s"}`;
  } else if (h.due_mode === "interval") {
    const p = predictInterval(h.id);
    cadence = p.learning
      ? "🧠 Automatic — learning your pattern (log a few more times)"
      : `🧠 Automatic — usually every ~${Math.round(p.avg)} day${Math.round(p.avg) === 1 ? "" : "s"}`;
  }
  if (cadence && h.reminder_lead_days) {
    cadence += ` · ${h.reminder_lead_days} day${h.reminder_lead_days === 1 ? "" : "s"} early`;
  }

  let historyHtml;
  if (!entries.length) {
    historyHtml = '<p class="msg">No logs yet.</p>';
  } else if (isTouch) {
    // Swipe a row left to reveal a Delete button; tap 📝 to add/edit a note.
    historyHtml = entries.map((e) => `
      <div class="swipe" data-id="${e.id}">
        <button class="swipe-del" data-id="${e.id}">Delete</button>
        <div class="swipe-content">
          <div class="hist-main">
            <span>${fmtDateTime(e.at)}</span>
            ${e.note ? `<span class="hist-note">${escapeHtml(e.note)}</span>` : ""}
          </div>
          <button class="note-btn${e.note ? " has-note" : ""}" data-note="${e.id}">📝</button>
        </div>
      </div>`).join("");
  } else {
    // Check rows, then Delete selected; 📝 to add/edit a note.
    historyHtml = `
      <div class="bulk-bar">
        <button data-act="del-selected" disabled>Delete selected</button>
        <span class="sel-count"></span>
      </div>` +
      entries.map((e) => `
        <div class="hist-row select">
          <div class="hist-main">
            <span>${fmtDateTime(e.at)}</span>
            ${e.note ? `<span class="hist-note">${escapeHtml(e.note)}</span>` : ""}
          </div>
          <button class="note-btn${e.note ? " has-note" : ""}" data-note="${e.id}">📝</button>
          <input type="checkbox" class="hist-check" data-id="${e.id}" />
        </div>`).join("");
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
      ${cadence ? `<p class="cadence">${cadence}</p>` : ""}

      <button class="wide" data-act="lognow">Log a new entry now</button>

      ${buildTrend(h)}

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
        <button data-act="save">Save changes</button>
        <label>Emoji <input id="hs-emoji" maxlength="8" value="${escapeAttr(h.emoji)}" /></label>
        <label>Name <input id="hs-name" value="${escapeAttr(h.name)}" /></label>
        <label>Type
          <select id="hs-type">
            ${TYPES.map((tt) => `<option value="${tt.key}"${tt.key === h.type ? " selected" : ""}>${tt.label}</option>`).join("")}
          </select>
        </label>
        <label>Color <div id="hs-color" class="swatches"></div></label>
        ${dueControlHtml("hs", h.due_mode, h.recurrence_days, h.reminder_lead_days)}
        <label class="row"><input id="hs-pinned" type="checkbox"${h.pinned ? " checked" : ""} /> Pin to top</label>
        <label class="row"><input id="hs-paused" type="checkbox"${h.paused ? " checked" : ""} /> Paused (no reminders)</label>
        <label class="row"><input id="hs-hidden" type="checkbox"${h.hidden ? " checked" : ""} /> Hide from main view</label>
      </section>

      <button class="wide danger" data-act="delete">Delete habit</button>
    </div>`;

  panel.querySelector('[data-act="back"]').addEventListener("click", closeHabitScreen);

  const getColor = renderSwatches(panel.querySelector("#hs-color"), h.color, null);
  wireDueControl("hs");
  panel.querySelectorAll("[data-note]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openNoteEditor(h.id, b.dataset.note); }));

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
    const due = readDueControl("hs");
    const patch = {
      name: $("hs-name").value.trim(),
      emoji: $("hs-emoji").value.trim() || "✅",
      type: $("hs-type").value,
      color: getColor(),
      due_mode: due.due_mode,
      recurrence_days: due.recurrence_days,
      reminder_lead_days: due.reminder_lead_days,
      pinned: $("hs-pinned").checked,
      paused: $("hs-paused").checked,
      hidden: $("hs-hidden").checked,
    };
    if (!patch.name) return alert("Name can't be empty.");
    const { error } = await db.from("habits").update(patch).eq("id", h.id);
    if (error) return alert(error.message);
    Object.assign(h, patch);
    renderHabitScreen(); render();
    flashSuccess();
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

// Coming-up group: soonest-due first.
function soonSort(a, b) {
  return (daysUntilDue(a) - daysUntilDue(b)) || a.name.localeCompare(b.name);
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

function hintEl(text) {
  const p = document.createElement("p");
  p.className = "reorder-hint";
  p.textContent = text;
  return p;
}

// Renders a row of color swatches into `container`. Returns a getter for the
// currently-selected color (null = "no custom color, use type color").
function renderSwatches(container, selected, onChange) {
  let current = selected || null;
  container.innerHTML = "";
  const make = (c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (c ? "" : " none") + ((c || null) === current ? " selected" : "");
    if (c) b.style.setProperty("--sw", c);
    b.addEventListener("click", () => {
      current = c || null;
      container.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      b.classList.add("selected");
      if (onChange) onChange(current);
    });
    return b;
  };
  container.appendChild(make(null)); // "no custom color"
  COLORS.forEach((c) => container.appendChild(make(c)));
  return () => current;
}

/* ---------- Due-mode control (shared by the add form + habit screen) ---------- */

// Renders the three-way Reminders control. `prefix` namespaces the ids/radios
// ('h' for the add form, 'hs' for the habit screen).
function dueControlHtml(prefix, mode, days, lead) {
  mode = mode || "none";
  days = days || 7;
  lead = lead || 0;
  const r = (v) => (v === mode ? " checked" : "");
  const leadOpts = [0, 1, 2, 3].map((n) =>
    `<option value="${n}"${n === lead ? " selected" : ""}>${n === 0 ? "on the day it's due" : n + " day" + (n === 1 ? "" : "s") + " before"}</option>`).join("");
  return `
    <fieldset class="due-field">
      <legend>Reminders</legend>
      <label class="radio"><input type="radio" name="${prefix}-due" value="recurrence"${r("recurrence")} /> Every
        <input id="${prefix}-recur" type="number" min="1" value="${days}" class="num" /> days</label>
      <label class="radio"><input type="radio" name="${prefix}-due" value="interval"${r("interval")} /> Automatic — learn my pattern</label>
      <label class="radio"><input type="radio" name="${prefix}-due" value="none"${r("none")} /> Just track (no reminders)</label>
      <label class="lead-row">Nudge me <select id="${prefix}-lead">${leadOpts}</select></label>
    </fieldset>`;
}

function readDueControl(prefix) {
  const sel = document.querySelector(`input[name="${prefix}-due"]:checked`);
  const mode = sel ? sel.value : "none";
  const days = Number($(`${prefix}-recur`).value) || null;
  const lead = Number($(`${prefix}-lead`).value) || 0;
  return {
    due_mode: mode,
    recurrence_days: mode === "recurrence" ? days : null,
    reminder_lead_days: mode === "none" ? 0 : lead,
  };
}

// Grey out "every N days" unless recurrence is selected; hide the lead picker
// entirely for "just track" (which has no due point to lead into).
function wireDueControl(prefix) {
  const recur = $(`${prefix}-recur`);
  const leadRow = $(`${prefix}-lead`).closest(".lead-row");
  const sync = () => {
    const sel = document.querySelector(`input[name="${prefix}-due"]:checked`);
    const mode = sel ? sel.value : "none";
    recur.disabled = mode !== "recurrence";
    if (leadRow) leadRow.style.display = mode === "none" ? "none" : "";
  };
  document.querySelectorAll(`input[name="${prefix}-due"]`).forEach((el) => el.addEventListener("change", sync));
  sync();
}

async function togglePin(h) {
  const v = !h.pinned;
  const { error } = await db.from("habits").update({ pinned: v }).eq("id", h.id);
  if (error) return alert(error.message);
  h.pinned = v; render();
  showToast(v ? `Pinned ${h.emoji} ${h.name}` : "Unpinned");
}

async function togglePause(h) {
  const v = !h.paused;
  const { error } = await db.from("habits").update({ paused: v }).eq("id", h.id);
  if (error) return alert(error.message);
  h.paused = v; render();
  showToast(v ? `Paused ${h.emoji} ${h.name}` : `Resumed ${h.emoji} ${h.name}`);
}

// Edit or clear a single entry's note (opened from the habit screen's history).
function openNoteEditor(habitId, entryId) {
  const entry = (entriesByHabit[habitId] || []).find((x) => x.id === entryId);
  if (!entry) return;
  const overlay = document.createElement("div");
  overlay.id = "note-editor";
  overlay.className = "popover show";
  overlay.innerHTML = `
    <div class="popover-card note-editor">
      <div class="popover-title">📝 Note</div>
      <textarea id="note-text" placeholder="Add a note for this log…">${escapeHtml(entry.note || "")}</textarea>
      <div class="row">
        <button data-act="cancel" class="ghost">Cancel</button>
        <button data-act="save">Save</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", close);
  overlay.querySelector('[data-act="save"]').addEventListener("click", async () => {
    const note = $("note-text").value.trim();
    const { error } = await db.from("entries").update({ note: note || null }).eq("id", entryId);
    if (error) return alert(error.message);
    entry.note = note;
    close();
    renderHabitScreen();
  });
  document.body.appendChild(overlay);
  $("note-text").focus();
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
  const status = dueStatus(h, daysSince);
  tile.classList.toggle("overdue", status === "overdue");
  tile.classList.toggle("soon", status === "soon");
  const badge = tile.querySelector(".due-badge");
  if (badge) badge.textContent = status === "soon" ? "SOON" : "DUE";
  tile.querySelector(".stat").textContent = sinceText(daysSince);
  tile.querySelector(".count").textContent = `${count}×`;
}

// Big centered checkmark that pops in and fades — used to confirm a save.
// Rendered on <body> so it survives the screen re-render underneath it.
function flashSuccess() {
  const el = document.createElement("div");
  el.className = "save-flash";
  el.innerHTML = '<div class="check">✓</div>';
  document.body.appendChild(el);
  buzz();
  setTimeout(() => el.remove(), 900);
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

$("add-habit").addEventListener("click", openAddHabit);
$("h-cancel").addEventListener("click", () => { $("modal").classList.add("hidden"); $("habit-form").reset(); });

// Open the New-habit form with a fresh color picker.
function openAddHabit() {
  $("habit-form").reset();
  $("h-emoji").value = "✅";
  $("h-due-control").innerHTML = dueControlHtml("h", "none", 7, 0);
  wireDueControl("h");
  newHabitColor = null;
  renderSwatches($("h-color"), null, (c) => { newHabitColor = c; });
  $("modal").classList.remove("hidden");
}

/* ---------- Search / sort / reorder controls ---------- */
$("search").addEventListener("input", (e) => { searchTerm = e.target.value; render(); });
$("sort").addEventListener("change", (e) => { saveSortMode(e.target.value); render(); });
$("reorder").addEventListener("click", () => { reorderMode = !reorderMode; render(); });

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
  $("h-due-control").innerHTML = dueControlHtml("h", s.days ? "recurrence" : "none", s.days || 7, 0);
  wireDueControl("h");
  newHabitColor = null;
  renderSwatches($("h-color"), null, (c) => { newHabitColor = c; });
}

$("habit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data: u } = await db.auth.getUser();
  const due = readDueControl("h");
  const { data, error } = await db.from("habits").insert({
    user_id: u.user.id,
    name: $("h-name").value.trim(),
    type: $("h-type").value,
    emoji: $("h-emoji").value.trim() || "✅",
    color: newHabitColor,
    due_mode: due.due_mode,
    recurrence_days: due.recurrence_days,
    reminder_lead_days: due.reminder_lead_days,
    sort_order: habits.length,
  }).select().single();
  if (error) return alert(error.message);
  habits.push(data);
  $("habit-form").reset();
  $("h-emoji").value = "✅";
  $("modal").classList.add("hidden");
  render();
});

/* ---------- Settings screen + data export ---------- */

$("settings-btn").addEventListener("click", openSettingsScreen);

function openSettingsScreen() {
  let panel = $("settings-screen");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "settings-screen";
    panel.className = "screen";
    document.body.appendChild(panel);
  }
  renderSettingsScreen();
  requestAnimationFrame(() => panel.classList.add("show"));
}

function closeSettingsScreen() {
  const p = $("settings-screen");
  if (p) p.remove();
}

function renderSettingsScreen() {
  const panel = $("settings-screen");
  if (!panel) return;
  const habitCount = habits.length;
  const logCount = Object.values(entriesByHabit).reduce((s, l) => s + l.length, 0);
  const hourLabel = (h) => h === 0 ? "12:00 AM (midnight)" : `${h}:00 AM`;
  const dayStartOptions = Array.from({ length: 12 }, (_, h) =>
    `<option value="${h}"${h === dayStartHour ? " selected" : ""}>${hourLabel(h)}</option>`).join("");
  panel.innerHTML = `
    <header class="screen-head">
      <button class="back" data-act="back">‹ Back</button>
      <div class="screen-title">⚙️ Settings</div>
      <span class="spacer"></span>
    </header>
    <div class="screen-body">
      <section class="card-section">
        <h3>Day start</h3>
        <p class="hint" style="margin:0">When a new day begins for counting. Pick a later hour if you often log after midnight and want it to count toward the day before.</p>
        <label class="row">A new day starts at
          <select data-act="daystart" style="flex:1">${dayStartOptions}</select>
        </label>
      </section>
      <section class="card-section">
        <h3>Your data</h3>
        <p class="hint" style="margin:0">${habitCount} habit${habitCount === 1 ? "" : "s"} · ${logCount} log${logCount === 1 ? "" : "s"}. Export a copy anytime — it's yours.</p>
        <button class="wide" data-act="json">⬇︎ Export JSON (full backup)</button>
        <button class="wide secondary" data-act="csv">⬇︎ Export CSV (logs for spreadsheets)</button>
      </section>
      <section class="card-section">
        <h3>Account</h3>
        <button class="wide secondary" data-act="signout">Sign out</button>
      </section>
      <p class="hint" style="margin-top:0">Build ${APP_BUILD}</p>
    </div>`;
  panel.querySelector('[data-act="back"]').addEventListener("click", closeSettingsScreen);
  panel.querySelector('[data-act="signout"]').addEventListener("click", () => { closeSettingsScreen(); signOut(); });
  panel.querySelector('[data-act="daystart"]').addEventListener("change", async (e) => {
    await saveDayStartHour(parseInt(e.target.value, 10));
    render();
    if ($("habit-screen")) renderHabitScreen(); // keep an open habit's trend/nudge in sync
    showToast("Day start updated");
  });
  panel.querySelector('[data-act="json"]').addEventListener("click", exportJSON);
  panel.querySelector('[data-act="csv"]').addEventListener("click", exportCSV);
}

// All logs as flat rows, joined to their habit later.
function allEntriesFlat() {
  const out = [];
  for (const [habitId, list] of Object.entries(entriesByHabit)) {
    for (const e of list) out.push({ id: e.id, habit_id: habitId, logged_at: e.at.toISOString(), note: e.note || "" });
  }
  return out;
}

function todayStamp() { return new Date().toISOString().slice(0, 10); }

// Full-fidelity backup: every habit field + every log.
function exportJSON() {
  const data = {
    app: "habit-tracker",
    build: APP_BUILD,
    exported_at: new Date().toISOString(),
    habits,
    entries: allEntriesFlat(),
  };
  downloadFile(`habit-tracker-backup-${todayStamp()}.json`, JSON.stringify(data, null, 2), "application/json");
  showToast("Exported JSON backup");
}

// One row per log, denormalized with its habit's details — easy to pivot.
function exportCSV() {
  const byId = Object.fromEntries(habits.map((h) => [h.id, h]));
  const rows = allEntriesFlat().sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
  const header = ["logged_at", "habit", "type", "emoji", "color", "note"];
  const lines = [header.join(",")];
  for (const e of rows) {
    const h = byId[e.habit_id] || {};
    lines.push([e.logged_at, h.name || "", h.type || "", h.emoji || "", h.color || "", e.note].map(csvCell).join(","));
  }
  downloadFile(`habit-tracker-logs-${todayStamp()}.csv`, lines.join("\n"), "text/csv");
  showToast("Exported CSV");
}

// CSV cell: quote + escape if it contains a comma, quote, or newline.
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Trigger a client-side download of text content.
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  try { settings = (await db.from("push_settings").select("send_hour, timezone, quiet_mode").maybeSingle()).data; } catch (_) {}
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
        <label class="row"><input id="ns-quiet" type="checkbox"${settings?.quiet_mode ? " checked" : ""} /> Quiet mode — pause all reminders</label>
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
  const quietToggle = panel.querySelector("#ns-quiet");
  if (quietToggle) quietToggle.addEventListener("change", async (e) => {
    try { await savePushSettings({ quiet_mode: e.target.checked }); showToast(e.target.checked ? "Reminders paused" : "Reminders on"); }
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
  if ($("note-editor")) $("note-editor").remove();
  else if ($("tile-menu")) closeTileMenu();
  else if ($("settings-screen")) closeSettingsScreen();
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
  $("auth-build").textContent = "Build " + APP_BUILD;
  $("app-build").textContent = "Build " + APP_BUILD;
  refreshSession();
}
