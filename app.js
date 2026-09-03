/* Habit Tracker — front end (vanilla JS + Supabase). */

const cfg = window.HABIT_CONFIG;
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// A habit's "type" sets which tab it lands in and how its trend is scored:
//   build — doing it more / sooner is the win (shorter gaps are good)
//   break — going longer without it is the win (longer gaps are good)
//   track — no direction, just keeping tabs
//   bonds — staying in touch with people (shorter gaps are good)
//   buys  — an owned item you amortize; each log is one "wear" (cost-per-wear)
//   bites — meals; like "track" (log each meal), no reminders by default
const TYPES = [
  { key: "build", label: "Build", color: "var(--good)" },
  { key: "break", label: "Break", color: "var(--bad)" },
  { key: "track", label: "Track", color: "var(--neutral)" },
  { key: "bonds", label: "Bonds", color: "var(--people)" },
  { key: "buys",  label: "Buys",  color: "var(--buys)" },
  { key: "bites", label: "Bites", color: "var(--bites)" },
];

// Type descriptions for the "What are you adding?" picker (step 1 of the add flow).
const TYPE_DESC = {
  build: "Do it more or sooner",
  break: "Go longer without it",
  track: "Just keep tabs",
  bonds: "Stay in touch",
  buys:  "Track an item's cost per wear",
  bites: "Log meals",
};

// Legacy → new type values, applied on load so the app keeps working during the
// window between deploying this build and running the phase7.sql migration.
const LEGACY_TYPE = { good: "build", bad: "break", neutral: "track", people_hangcall: "bonds", people_text: "bonds" };

// Tabs you can toggle between. `types: null` on "due" means "due, any type".
// Otherwise a tab filters to the listed types; within a tab, habits are grouped
// by the user's custom sections (not by type).
const VIEWS = [
  { key: "due", label: "Due", types: null },
  { key: "build", label: "Build & Track", types: ["build", "track"] },
  { key: "break", label: "Break", types: ["break"] },
  { key: "bonds", label: "Bonds", types: ["bonds"] },
  { key: "buys", label: "Buys", types: ["buys"] },
  { key: "bites", label: "Bites", types: ["bites"] },
];
let currentView = localStorage.getItem("habitView") || "due";
if (!VIEWS.some((v) => v.key === currentView)) currentView = "due"; // heal a stale saved tab

// Time ranges for the Bites meal calendar (per-habit screen + Bites tab). The
// selected range is shared across both places and persisted.
const CAL_RANGES = [
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
  { key: "3mo", label: "3 Months", days: 90 },
];
let bitesCalRange = localStorage.getItem("bitesCalRange") || "week";
if (!CAL_RANGES.some((r) => r.key === bitesCalRange)) bitesCalRange = "week";

// Curated starter habits. `days` (when present) pre-fills a reminder threshold;
// bad/neutral habits omit it since a "days since" nudge doesn't fit them.
const SUGGESTIONS = [
  { emoji: "🏋️", name: "Workout", type: "build", days: 2 },
  { emoji: "🧘", name: "Meditate", type: "build", days: 2 },
  { emoji: "🦷", name: "Floss", type: "build", days: 1 },
  { emoji: "📖", name: "Read", type: "build", days: 3 },
  { emoji: "🚶", name: "Walk", type: "build", days: 2 },
  { emoji: "✍️", name: "Journal", type: "build", days: 3 },
  { emoji: "💧", name: "Drink water", type: "build", days: 1 },
  { emoji: "🚬", name: "Smoke", type: "break" },
  { emoji: "🍺", name: "Alcohol", type: "break" },
  { emoji: "🍭", name: "Junk food", type: "break" },
  { emoji: "📱", name: "Doomscroll", type: "break" },
  { emoji: "🛒", name: "Impulse buy", type: "break" },
  { emoji: "☕", name: "Coffee", type: "track" },
  { emoji: "🎮", name: "Gaming", type: "track" },
  { emoji: "📺", name: "Watch a show", type: "track" },
  { emoji: "💤", name: "Nap", type: "track" },
  { emoji: "🤙", name: "Call parents", type: "bonds", days: 7 },
  { emoji: "👵", name: "Call grandparents", type: "bonds", days: 14 },
  { emoji: "🍽️", name: "Dinner with friends", type: "bonds", days: 14 },
  { emoji: "🧑‍🤝‍🧑", name: "See friends", type: "bonds", days: 10 },
  { emoji: "💬", name: "Text a friend", type: "bonds", days: 7 },
  { emoji: "👋", name: "Reconnect with someone", type: "bonds", days: 30 },
  { emoji: "📨", name: "Check in with sibling", type: "bonds", days: 14 },
  { emoji: "🍳", name: "Breakfast", type: "bites" },
  { emoji: "🥗", name: "Lunch", type: "bites" },
  { emoji: "🍽️", name: "Dinner", type: "bites" },
  { emoji: "🍎", name: "Snack", type: "bites" },
  { emoji: "🍰", name: "Dessert", type: "bites" },
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
const APP_BUILD = "45";

// Optional per-habit accent colors. null = fall back to the habit's type color.
const COLORS = ["#37b26b", "#e5533c", "#f0b429", "#4f8cf5", "#a06cd5", "#26c6da", "#ec6ea6", "#7f8b98"];

let habits = [];
let entriesByHabit = {}; // habit_id -> [{id, at, note}, ...]
let sections = [];       // user-defined home-screen groups: [{id, name, sort_order, collapsed}, ...]
let renderedSections = []; // real sections shown in the current tab, in order (for reorder arrows)

// UI state (sort_mode + dayStartHour are synced via user_prefs; the rest are
// session-local).
let sortMode = "manual";   // manual | activity | created | alpha
let dayStartHour = 0;      // 0-11; when a new "day" begins for calendar-day counts
let tabOrder = null;       // saved order of the reorderable tabs (keys, "due" excluded); null = default
let searchTerm = "";
let searchAllTabs = localStorage.getItem("searchAllTabs") === "1"; // search across all tabs
let showHidden = false;
let reorderMode = false;
let newHabitColor = null;  // color chosen in the add-habit form
let newHabitType = "build"; // type chosen in step 1 of the add flow
let newHabitSection = null;  // section to pre-fill when adding via a section "+"
let newHabitPhotoBlob = null; // cropped photo staged in the add form, uploaded after insert
let hsPhotoBlob = null;       // cropped photo staged on the habit screen, uploaded on Save

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
$("empty-suggest").addEventListener("click", () => openSuggestions());

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
    db.from("entries").select("id, habit_id, logged_at, note, tag"),
  ]);
  if (he || ee) { alert((he || ee).message); return; }
  habits = h || [];
  habits.forEach((x) => { if (LEGACY_TYPE[x.type]) x.type = LEGACY_TYPE[x.type]; }); // pre-migration safety
  habits.forEach((x) => { if (!Array.isArray(x.tags)) x.tags = []; });                // pre-phase15 safety
  entriesByHabit = {};
  (en || []).forEach((row) => {
    (entriesByHabit[row.habit_id] ||= []).push({ id: row.id, at: new Date(row.logged_at), note: row.note || "", tag: row.tag || "" });
  });
  // Sections may not exist yet (before phase7.sql) — treat a query error as "no sections".
  const { data: s, error: se } = await db.from("sections").select("*").order("sort_order");
  sections = se ? [] : (s || []);
  await loadPrefs();
  render();
}

// Cross-device UI preferences (currently just the sort mode).
async function loadPrefs() {
  try {
    const { data } = await db.from("user_prefs").select("sort_mode, day_start_hour, tab_order").maybeSingle();
    if (data?.sort_mode) sortMode = data.sort_mode;
    if (data && data.day_start_hour != null) dayStartHour = data.day_start_hour;
    if (Array.isArray(data?.tab_order)) tabOrder = data.tab_order;
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

async function saveTabOrder(keys) {
  tabOrder = keys;
  try {
    const { data: u } = await db.auth.getUser();
    await db.from("user_prefs").upsert(
      { user_id: u.user.id, tab_order: keys, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });
  } catch (err) { console.warn("Couldn't save tab order:", err.message); }
}

// The reorderable tab keys ("due" excluded, it's always pinned first), honoring the
// saved order and appending any tab types added since it was saved.
function reorderableKeys() {
  const base = VIEWS.filter((v) => v.key !== "due").map((v) => v.key);
  if (!tabOrder) return base;
  const known = new Set(base);
  const ordered = tabOrder.filter((k) => known.has(k));
  for (const k of base) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}

// VIEWS in display order: "Due" first, then the user's tab order.
function orderedViews() {
  const due = VIEWS.find((v) => v.key === "due");
  const rest = reorderableKeys().map((k) => VIEWS.find((v) => v.key === k)).filter(Boolean);
  return due ? [due, ...rest] : rest;
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
  build: "#37b26b", break: "#e5533c", track: "#7f8b98", bonds: "#4f8cf5", buys: "#a06cd5", bites: "#e0803a",
};
function trendColor(h) { return h.color || TYPE_HEX[h.type] || "#7f8b98"; }

// Type-specific framing: what "longer gaps" means differs for a vice vs a habit.
function trendConfig(type) {
  if (type === "break") return { title: "Trend — days between", longestLabel: "Longest clean stretch", caption: "Higher is better — longer gaps mean progress." };
  if (type === "bonds") return { title: "Trend — days between", longestLabel: "Longest gap", caption: "Lower means you're staying in touch." };
  if (type === "build") return { title: "Trend — days between logs", longestLabel: "Longest gap", caption: "Lower means you're doing it more often." };
  return { title: "Trend — days between logs", longestLabel: "Longest gap", caption: "" }; // track
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
  return trendCard(trendConfig(h.type), entriesByHabit[h.id] || [], trendColor(h));
}

// The trend card body for an arbitrary list of entries — the whole habit, or a
// single tag's subset. Same math either way.
function trendCard(cfg, entryList, color) {
  const list = entryList.map((e) => dayIndex(e.at.getTime())).sort((a, b) => a - b);
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
      ${trendSvg(gaps, color)}
      <div class="trend-stats">
        <span>Avg <b>${Math.round(avg)}d</b></span>
        <span>${cfg.longestLabel} <b>${Math.round(longest)}d</b></span>
      </div>
      ${cfg.caption ? `<p class="hint" style="margin:0">${cfg.caption}</p>` : ""}`;
  }
  return `<section class="card-section"><h3>${cfg.title}</h3>${body}</section>`;
}

// "By tag" card: per-tag count + days-since (tap a row for that subset's trend),
// plus rename/delete and "+ Add tag". Shown on every habit so tags can be added;
// when none exist yet it's just a hint + the add button.
function buildTagBreakdown(h) {
  const tags = h.tags || [];
  const all = entriesByHabit[h.id] || [];
  const rows = tags.map((t) => {
    const list = all.filter((e) => (e.tag || "") === t);
    const ds = list.length ? dayIndex(Date.now()) - dayIndex(Math.max(...list.map((e) => e.at.getTime()))) : null;
    return `<div class="tag-line" data-tagdetail="${escapeAttr(t)}">
      <span class="tag-line-name">${escapeHtml(t)}</span>
      <span class="tag-line-stat">${list.length} log${list.length === 1 ? "" : "s"}${ds === null ? "" : ` · ${ds}d`}</span>
      <button class="tag-line-btn" data-tagrename="${escapeAttr(t)}" title="Rename">✎</button>
      <button class="tag-line-btn" data-tagdel="${escapeAttr(t)}" title="Delete">✕</button>
    </div>`;
  }).join("");
  const untagged = all.filter((e) => !e.tag).length;
  const untaggedRow = (tags.length && untagged)
    ? `<div class="tag-line muted"><span class="tag-line-name">Untagged</span><span class="tag-line-stat">${untagged} log${untagged === 1 ? "" : "s"}</span></div>`
    : "";
  const hint = tags.length ? ""
    : `<p class="hint" style="margin:0 0 8px">Add tags to track subsets of this habit — e.g. which restaurant. Tapping the habit to log then lets you pick one.</p>`;
  return `<section class="card-section">
    <h3>By tag</h3>
    ${hint}
    <div class="tag-list">${rows}${untaggedRow}</div>
    <button class="wide secondary" data-act="addtag">＋ Add tag</button>
  </section>`;
}

// Persist a habit's tag list. Returns true on success.
async function saveHabitTags(h, tags) {
  const { error } = await db.from("habits").update({ tags }).eq("id", h.id);
  if (error) { alert(error.message); return false; }
  h.tags = tags;
  return true;
}

async function addHabitTag(h) {
  const name = (prompt("New tag:") || "").trim();
  if (!name) return;
  if ((h.tags || []).some((t) => t.toLowerCase() === name.toLowerCase())) return alert("That tag already exists.");
  if (await saveHabitTags(h, [...(h.tags || []), name])) renderHabitScreen();
}

async function renameHabitTag(h, old) {
  const name = (prompt("Rename tag:", old) || "").trim();
  if (!name || name === old) return;
  if ((h.tags || []).some((t) => t !== old && t.toLowerCase() === name.toLowerCase())) return alert("You already have a tag with that name.");
  // Cascade to past logs so their history stays grouped under the new name.
  const { error } = await db.from("entries").update({ tag: name }).eq("habit_id", h.id).eq("tag", old);
  if (error) return alert(error.message);
  (entriesByHabit[h.id] || []).forEach((e) => { if (e.tag === old) e.tag = name; });
  if (await saveHabitTags(h, (h.tags || []).map((t) => (t === old ? name : t)))) { renderHabitScreen(); render(); }
}

async function deleteHabitTag(h, tag) {
  if (!confirm(`Delete the tag "${tag}"?\n\nPast logs keep it in their history, but it won't be offered when logging anymore.`)) return;
  if (await saveHabitTags(h, (h.tags || []).filter((t) => t !== tag))) { renderHabitScreen(); render(); }
}

// A tag's subset view: count, days-since, and the trend chart for just that tag.
function openTagDetail(h, tag) {
  const list = (entriesByHabit[h.id] || []).filter((e) => (e.tag || "") === tag);
  const count = list.length;
  const daysSince = count ? dayIndex(Date.now()) - dayIndex(Math.max(...list.map((e) => e.at.getTime()))) : null;
  const overlay = document.createElement("div");
  overlay.id = "tag-detail";
  overlay.className = "popover show";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">${h.emoji} ${escapeHtml(h.name)} — ${escapeHtml(tag)}</div>
      <div class="stat-row">
        <div class="stat-box"><div class="big">${count}</div><div class="lbl">${count === 1 ? "log" : "logs"}</div></div>
        <div class="stat-box"><div class="big">${daysSince === null ? "–" : daysSince}</div><div class="lbl">${daysSince === 1 ? "day since" : "days since"}</div></div>
      </div>
      ${trendCard(trendConfig(h.type), list, trendColor(h))}
      <button data-act="close">Close</button>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener("click", close);
  document.body.appendChild(overlay);
}

// Set/change the tag on a single past log (fixes a mis-tap). Picking saves and closes.
function openEntryTagPicker(h, entryId) {
  const entry = (entriesByHabit[h.id] || []).find((e) => e.id === entryId);
  if (!entry) return;
  const tags = h.tags || [];
  const overlay = document.createElement("div");
  overlay.id = "entry-tag";
  overlay.className = "popover show";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">Tag this log</div>
      <div class="tag-chips">
        <button type="button" class="tag-chip${entry.tag ? "" : " active"}" data-tag="">No tag</button>
        ${tags.map((t) => `<button type="button" class="tag-chip${entry.tag === t ? " active" : ""}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", close);
  overlay.querySelectorAll(".tag-chip").forEach((b) =>
    b.addEventListener("click", async () => {
      const tag = b.dataset.tag;
      const { error } = await db.from("entries").update({ tag: tag || null }).eq("id", entryId);
      if (error) return alert(error.message);
      entry.tag = tag;
      close();
      renderHabitScreen();
    }));
  document.body.appendChild(overlay);
}

/* ---------- "Bites" meal calendar (used instead of the trend chart) ---------- */

// Fraction (0..1) of the way through the day a timestamp falls, honoring the
// user's day-start hour so the top of a column is "day start", bottom is "day end".
function timeOfDayFrac(at) {
  const localMs = ((at.getHours() * 60 + at.getMinutes()) * 60 + at.getSeconds()) * 1000;
  return ((((localMs - dayStartHour * 3600000) % DAY) + DAY) % DAY) / DAY;
}

// A calendar strip of what was logged per day over the selected range. Each day is
// a column; each log is an emoji placed vertically by time of day (top = earlier,
// bottom = later) — no clock times shown. `items` is [{at:Date, emoji, name?}].
// Used for a single habit (per-habit screen) and for all meals combined (Bites tab).
function buildBitesCalendar(items, opts = {}) {
  const range = CAL_RANGES.find((r) => r.key === bitesCalRange) || CAL_RANGES[0];
  const todayIdx = dayIndex(Date.now());
  const startIdx = todayIdx - (range.days - 1);
  const showWd = range.days <= 7; // weekday label only fits on the wide (week) view

  const buckets = new Map(); // dayIndex -> [items]
  let total = 0;
  for (const it of items) {
    const di = dayIndex(it.at.getTime());
    if (di < startIdx || di > todayIdx) continue;
    if (!buckets.has(di)) buckets.set(di, []);
    buckets.get(di).push(it);
    total++;
  }

  const toggle = CAL_RANGES.map((r) =>
    `<button class="cal-range-btn${r.key === bitesCalRange ? " active" : ""}" data-cal-range="${r.key}">${r.label}</button>`
  ).join("");

  const now = Date.now();
  let cols = "";
  for (let di = startIdx; di <= todayIdx; di++) {
    const list = (buckets.get(di) || []).slice().sort((a, b) => a.at - b.at); // earliest first (top)
    const date = new Date(now - (todayIdx - di) * DAY);
    const dnum = date.getDate();
    const dots = list.map((it) => {
      const top = (timeOfDayFrac(it.at) * 100).toFixed(1);
      const title = fmtDateTime(it.at) + (it.name ? " · " + it.name : "");
      return `<span class="cal-dot" style="top:${top}%" title="${escapeAttr(title)}">${it.emoji}</span>`;
    }).join("");
    const topLabel = showWd
      ? date.toLocaleDateString(undefined, { weekday: "short" })
      : (dnum === 1 ? date.toLocaleDateString(undefined, { month: "short" }) : "");
    cols += `<div class="cal-col${di === todayIdx ? " today" : ""}">
      <div class="cal-track">${dots}</div>
      <div class="cal-daylabel"><span class="cal-wd">${topLabel}</span><span class="cal-dnum">${dnum}</span></div>
    </div>`;
  }

  const body = total
    ? `<div class="cal-strip cal-${range.key}">${cols}</div>
       <p class="hint cal-hint">Top = earlier in the day · bottom = later · ${total} log${total === 1 ? "" : "s"}</p>`
    : `<p class="msg" style="margin:0">No meals logged in this range yet.</p>`;

  return `<section class="card-section bites-cal">
    <div class="cal-head">
      <h3>${opts.title || "Meal calendar"}</h3>
      <div class="cal-range">${toggle}</div>
    </div>
    ${body}
  </section>`;
}

// Wire the range toggle inside `root`; `rerender` redraws whichever screen hosts it.
function wireBitesCalendar(root, rerender) {
  root.querySelectorAll("[data-cal-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      bitesCalRange = btn.dataset.calRange;
      localStorage.setItem("bitesCalRange", bitesCalRange);
      rerender();
    }));
}

/* ---------- "Buys" cost-per-wear card + item photos ---------- */

function fmtMoney(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Rough human duration for a day count: days → weeks → months → years.
function humanizeDuration(days) {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) { const w = Math.round(days / 7); return `${w} week${w === 1 ? "" : "s"}`; }
  if (days < 730) { const m = Math.round(days / 30); return `${m} month${m === 1 ? "" : "s"}`; }
  const y = (days / 365).toFixed(1).replace(/\.0$/, "");
  return `${y} year${y === "1" ? "" : "s"}`;
}

// The card that replaces the Trend chart on a "buys" item's screen. Each log is a
// "wear", so cost-per-wear = price / number of logs. The <img> is filled in async
// by loadHabitPhoto() once its signed URL comes back.
function buildBuysCard(h) {
  const { count } = stats(h.id);
  const hasPrice = h.price != null;
  const ppw = hasPrice && count > 0 ? h.price / count : null;

  const headline = ppw != null ? fmtMoney(ppw) : hasPrice ? fmtMoney(h.price) : "—";
  const sublabel = ppw != null ? "per wear"
    : hasPrice ? "wear it to start"
    : "add a price to see cost per wear";

  const meta = [];
  if (hasPrice) meta.push(`Paid ${fmtMoney(h.price)}`);
  meta.push(`${count} wear${count === 1 ? "" : "s"}`);
  if (h.date_purchased) meta.push(`bought ${fmtDate(new Date(h.date_purchased + "T00:00:00"))}`);

  // Wears-since-purchase pace, e.g. "Worn 12× over 3 months".
  let pace = "";
  if (h.date_purchased && count > 0) {
    const days = Math.floor((Date.now() - new Date(h.date_purchased + "T00:00:00").getTime()) / DAY);
    if (days >= 1) pace = `Worn ${count}× over ${humanizeDuration(days)}`;
  }

  const photo = h.photo_path
    ? `<img class="buys-photo" data-photo="${h.id}" alt="${escapeAttr(h.name)}" />`
    : "";

  return `<section class="card-section buys-card">
    ${photo}
    <div class="ppw-big">${headline}</div>
    <div class="ppw-lbl">${sublabel}</div>
    <div class="buys-meta">${meta.join(" · ")}</div>
    ${pace ? `<div class="buys-pace">${pace}</div>` : ""}
    ${h.description ? `<p class="buys-desc">${escapeHtml(h.description)}</p>` : ""}
  </section>`;
}

// Fetch a short-lived signed URL for a private photo and drop it into every <img>
// that references it (home tile, card, edit-form preview). URLs are cached by path
// so re-renders (which re-run this per visible tile) don't refetch each time.
const photoUrlCache = new Map(); // path -> { url, exp }
async function loadHabitPhoto(habitId, path) {
  if (!path) return;
  const imgs = document.querySelectorAll(`img[data-photo="${habitId}"]`);
  if (!imgs.length) return;
  let entry = photoUrlCache.get(path);
  if (!entry || entry.exp < Date.now() + 60000) { // refresh if missing or within 1 min of expiry
    const { data, error } = await db.storage.from("habit-photos").createSignedUrl(path, 3600);
    if (error || !data) return;
    entry = { url: data.signedUrl, exp: Date.now() + 3600 * 1000 };
    photoUrlCache.set(path, entry);
  }
  imgs.forEach((img) => (img.src = entry.url));
}

// The price/date/description/photo inputs for a "buys" item — shared by the add
// form (prefix "h", no existing values) and the habit screen (prefix "hs").
function buysFieldsHtml(prefix, h) {
  const price = h && h.price != null ? h.price : "";
  const date = h && h.date_purchased ? h.date_purchased : "";
  const desc = h && h.description ? h.description : "";
  const current = h && h.photo_path
    ? `<img class="buys-photo edit" data-photo="${h.id}" alt="current photo" />
       <button type="button" id="${prefix}-recrop" class="secondary">Crop photo</button>`
    : "";
  return `
    <label>Price <input id="${prefix}-price" type="number" min="0" step="0.01" inputmode="decimal" value="${price}" placeholder="0.00" /></label>
    <label>Date purchased <input id="${prefix}-purchased" type="date" value="${date}" /></label>
    <label>Description <textarea id="${prefix}-desc" rows="2" placeholder="e.g. navy wool coat">${escapeHtml(desc)}</textarea></label>
    <label>Photo <input id="${prefix}-photo" type="file" accept="image/*" /></label>
    ${current}`;
}

function readBuysFields(prefix) {
  const price = $(`${prefix}-price`).value.trim();
  return {
    price: price === "" ? null : Number(price),
    date_purchased: $(`${prefix}-purchased`).value || null,
    description: $(`${prefix}-desc`).value.trim() || null,
  };
}

// Picking a photo opens the square cropper; the cropped blob is handed to onBlob
// (staged for upload). Cancelling the crop clears the file selection.
function wireBuysPhotoInput(prefix, onBlob) {
  const input = $(`${prefix}-photo`);
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const cropped = await openCropper(file);
    if (cropped) onBlob(cropped);
    else { input.value = ""; onBlob(null); }
  });
}

// Shrink a photo in the browser before upload: cap the longest side at ~1000px and
// re-encode as JPEG. A multi-MB phone photo becomes a couple hundred KB. Returns a Blob.
function shrinkImage(file, maxSide = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

// Shrink + upload an item photo to the user's private folder, returning its path.
async function uploadHabitPhoto(habitId, file) {
  const blob = await shrinkImage(file);
  const { data: u } = await db.auth.getUser();
  const path = `${u.user.id}/${habitId}.jpg`;
  const { error } = await db.storage.from("habit-photos")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  photoUrlCache.delete(path); // stored bytes changed at this path — force a fresh signed URL
  return path;
}

// Download an existing private photo as a Blob (for re-cropping). Fetching the signed
// URL into a same-origin blob avoids canvas cross-origin tainting.
async function fetchPhotoBlob(path) {
  const { data, error } = await db.storage.from("habit-photos").createSignedUrl(path, 3600);
  if (error || !data) return null;
  try {
    const res = await fetch(data.signedUrl);
    return res.ok ? await res.blob() : null;
  } catch (_) { return null; }
}

// Square pan-and-zoom cropper. Shows `blob` in a fixed square frame; drag to pan,
// slider to zoom. Resolves with a cropped square JPEG Blob, or null if cancelled.
function openCropper(blob, out = 1000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      const V = 288; // on-screen frame size
      let zoom = 1, offX = 0, offY = 0;
      const coverScale = V / Math.min(img.width, img.height); // fills the square at zoom 1

      const overlay = document.createElement("div");
      overlay.id = "cropper";
      overlay.className = "popover show";
      overlay.innerHTML = `
        <div class="popover-card cropper-card">
          <div class="popover-title">Crop photo</div>
          <canvas class="crop-canvas" width="${V}" height="${V}"></canvas>
          <label class="crop-zoom">Zoom
            <input type="range" min="1" max="3" step="0.01" value="1" />
          </label>
          <div class="row">
            <button data-act="cancel" class="ghost">Cancel</button>
            <button data-act="use">Use photo</button>
          </div>
        </div>`;
      const canvas = overlay.querySelector(".crop-canvas");
      const ctx = canvas.getContext("2d");
      const range = overlay.querySelector('input[type="range"]');

      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const draw = () => {
        const scale = coverScale * zoom;
        const dw = img.width * scale, dh = img.height * scale;
        offX = clamp(offX, V - dw, 0);
        offY = clamp(offY, V - dh, 0);
        ctx.clearRect(0, 0, V, V);
        ctx.drawImage(img, offX, offY, dw, dh);
      };
      // center initially
      offX = (V - img.width * coverScale) / 2;
      offY = (V - img.height * coverScale) / 2;
      draw();

      range.addEventListener("input", () => {
        const oldScale = coverScale * zoom;
        zoom = Number(range.value);
        const newScale = coverScale * zoom;
        // keep the frame's center anchored while zooming
        const cx = (V / 2 - offX) / oldScale, cy = (V / 2 - offY) / oldScale;
        offX = V / 2 - cx * newScale;
        offY = V / 2 - cy * newScale;
        draw();
      });

      let panning = false, lastX = 0, lastY = 0;
      canvas.addEventListener("pointerdown", (e) => {
        panning = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!panning) return;
        offX += e.clientX - lastX; offY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        draw();
      });
      const endPan = () => { panning = false; };
      canvas.addEventListener("pointerup", endPan);
      canvas.addEventListener("pointercancel", endPan);

      const close = (result) => { URL.revokeObjectURL(url); overlay.remove(); resolve(result); };
      overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => close(null));
      overlay.querySelector('[data-act="use"]').addEventListener("click", () => {
        const scale = coverScale * zoom, k = out / V;
        const oc = document.createElement("canvas");
        oc.width = out; oc.height = out;
        oc.getContext("2d").drawImage(img, offX * k, offY * k, img.width * scale * k, img.height * scale * k);
        oc.toBlob((b) => close(b || null), "image/jpeg", 0.85);
      });
      document.body.appendChild(overlay);
    };
    img.src = url;
  });
}

function sinceText(daysSince) {
  return daysSince === null ? "never logged"
    : daysSince === 0 ? "today"
    : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
}

// 'none' | 'soon' | 'overdue'. The DUE marker ("overdue" here) fires ON the due
// day itself — i.e. once days-since REACHES the interval, not the day after.
// "soon" = within the habit's lead-time window before that. Lead 0 → soon never
// fires. MUST mirror dueStatus() in the Edge Function.
function dueStatus(h, daysSince) {
  if (h.paused) return "none";
  const lead = h.reminder_lead_days || 0;
  if (h.due_mode === "recurrence") {
    if (!h.recurrence_days) return "none";
    if (daysSince === null || daysSince >= h.recurrence_days) return "overdue";
    if (daysSince >= h.recurrence_days - lead) return "soon";
    return "none";
  }
  if (h.due_mode === "interval") {
    const { avg, learning } = predictInterval(h.id);
    if (learning || daysSince === null) return "none"; // still learning / no data
    const threshold = avg * PRED_GRACE;
    if (daysSince >= threshold) return "overdue";
    if (daysSince >= threshold - lead) return "soon";
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
  // Reorder only makes sense on a grouped (non-Due) view.
  if (reorderMode && currentView === "due") reorderMode = false;

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

  // "All tabs" search: while searching with the scope toggle on, show one flat list
  // of matches across every type, ignoring the current tab.
  if (q && searchAllTabs) {
    const results = habits.filter((h) => matches(h) && (showHidden || !h.hidden));
    if (results.length) renderGroup(grid, "Results — all tabs", sortForGroup(results));
    else grid.appendChild(msgEl("No matching habits in any tab."));
    return;
  }

  if (reorderMode) {
    grid.appendChild(hintEl("Use ↑ ↓ to reorder sections · drag tiles to reorder · tap a section name to rename or delete · Done when finished."));
  }

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

  // Bites tab: a combined meal calendar (all meal habits) sits above the tiles.
  if (view.key === "bites") {
    const bhabits = habits.filter((h) => h.type === "bites" && (showHidden || !h.hidden));
    if (bhabits.length) {
      const items = [];
      for (const h of bhabits)
        for (const e of entriesByHabit[h.id] || []) items.push({ at: e.at, emoji: h.emoji, name: h.name });
      grid.insertAdjacentHTML("beforeend", buildBitesCalendar(items, { title: "Meal calendar", combined: true }));
      wireBitesCalendar(grid, render);
    }
  }

  // Grouped view: filter to this tab's types, then group by the user's sections.
  const inView = habits.filter((h) => view.types.includes(h.type) && matches(h) && (showHidden || !h.hidden));
  const bySection = {};
  for (const h of inView) (bySection[h.section_id || "__none__"] ||= []).push(h);

  const ordered = sections.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  // The real sections actually shown in this tab, in order — reorder arrows move within this list.
  renderedSections = ordered.filter((s) => bySection[s.id] && bySection[s.id].length);
  let any = renderedSections.length > 0;
  renderedSections.forEach((s, idx) =>
    renderSectionGroup(grid, s, sortForGroup(bySection[s.id]), idx, renderedSections.length));
  const ungrouped = bySection["__none__"];
  if (ungrouped && ungrouped.length) {
    // Only label leftovers "Ungrouped" when there are real sections to contrast with;
    // otherwise (no sections yet) just show a plain, header-less list.
    renderSectionGroup(grid, any ? { id: null, name: "Ungrouped" } : null, sortForGroup(ungrouped));
    any = true;
  }

  const hiddenInView = habits.filter((h) => view.types.includes(h.type) && matches(h) && h.hidden).length;
  if (!any && !hiddenInView) grid.appendChild(q ? msgEl("No matching habits.") : emptyTabEl(view));
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
  reorderBtn.classList.toggle("hidden", onDue); // sections are reorderable in any sort mode
  reorderBtn.classList.toggle("active", reorderMode);
  reorderBtn.textContent = reorderMode ? "Done" : "Reorder";
  // Scope toggle only matters while a search is active.
  const scope = $("search-scope");
  scope.classList.toggle("hidden", !searchTerm.trim());
  scope.textContent = searchAllTabs ? "All tabs" : "This tab";
  scope.classList.toggle("active", searchAllTabs);
}

// Tab bar across the top; the "Due" tab carries a live count badge.
function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  const dueCount = habits.filter((h) => isActive(h, stats(h.id).daysSince)).length;
  for (const v of orderedViews()) {
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

// A home-screen section group. `section` is a real row {id, name, collapsed} — or
// {id: null, name: "Ungrouped"} for the leftovers, or null for a header-less list
// (when no sections exist yet). Real sections collapse (tap header) and, in reorder
// mode, move with ↑/↓ arrows and rename/delete (tap the name). `idx`/`total` place
// this section within the tab's visible list (for arrow enable/disable).
function renderSectionGroup(grid, section, list, idx, total) {
  const group = document.createElement("div");
  group.className = "group";
  const isReal = !!(section && section.id); // a persisted section (not Ungrouped/flat)
  const collapsed = isReal && !!section.collapsed;
  if (isReal) { group.classList.add("section-group"); group.dataset.sectionId = section.id; }
  if (collapsed) group.classList.add("collapsed");

  if (section) {
    const head = document.createElement("div");
    head.className = "section-head";
    const arrows = reorderMode && isReal
      ? `<span class="section-arrows">
           <button class="sec-up"${idx === 0 ? " disabled" : ""} aria-label="Move up">↑</button>
           <button class="sec-down"${idx === total - 1 ? " disabled" : ""} aria-label="Move down">↓</button>
         </span>`
      : "";
    head.innerHTML =
      (isReal ? `<span class="section-toggle">${collapsed ? "▶" : "▼"}</span>` : "") +
      `<h2>${escapeHtml(section.name)}</h2>` +
      `<span class="section-count">${list.length}</span>` +
      (!reorderMode ? `<button class="section-add" title="Add a habit here" aria-label="Add a habit here">＋</button>` : "") +
      arrows;
    group.appendChild(head);
    const addBtn = head.querySelector(".section-add");
    if (addBtn) addBtn.addEventListener("click", (e) => { e.stopPropagation(); addHabitToSection(section.id || null); });
    if (reorderMode && isReal) {
      head.querySelector(".section-toggle").style.visibility = "hidden"; // no collapsing mid-reorder
      const name = head.querySelector("h2");
      name.style.cursor = "pointer";
      name.addEventListener("click", () => openSectionMenu(section));
      head.querySelector(".sec-up").addEventListener("click", (e) => { e.stopPropagation(); moveSection(section, -1); });
      head.querySelector(".sec-down").addEventListener("click", (e) => { e.stopPropagation(); moveSection(section, 1); });
    } else if (isReal) {
      head.style.cursor = "pointer";
      head.addEventListener("click", () => toggleSectionCollapse(section));
    }
  }

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  if (!collapsed) list.forEach((h) => tiles.appendChild(buildTile(h)));
  group.appendChild(tiles);
  grid.appendChild(group);
}

// Move a section up/down among the tab's currently-visible sections by swapping its
// sort_order with its visible neighbor's, then persist. Renders optimistically.
async function moveSection(section, dir) {
  const arr = renderedSections;
  const i = arr.findIndex((s) => s.id === section.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const a = arr[i], b = arr[j];
  const tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
  render();
  const r1 = await db.from("sections").update({ sort_order: a.sort_order }).eq("id", a.id);
  const r2 = await db.from("sections").update({ sort_order: b.sort_order }).eq("id", b.id);
  if (r1.error || r2.error) alert((r1.error || r2.error).message);
}

async function toggleSectionCollapse(section) {
  section.collapsed = !section.collapsed;
  render(); // optimistic; persist in the background
  const { error } = await db.from("sections").update({ collapsed: section.collapsed }).eq("id", section.id);
  if (error) console.warn("Couldn't save collapse state:", error.message);
}

// Rename / delete popover for a section (opened by tapping its name in reorder mode).
function openSectionMenu(section) {
  closeTileMenu();
  const overlay = document.createElement("div");
  overlay.id = "tile-menu";
  overlay.className = "popover show";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">${escapeHtml(section.name)}</div>
      <button data-act="rename" class="secondary">✎ Rename</button>
      <button data-act="delete" class="wide danger">Delete section</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-act="rename"]').addEventListener("click", () => {
    overlay.remove();
    const name = (prompt("Rename section:", section.name) || "").trim();
    if (name) renameSection(section, name);
  });
  overlay.querySelector('[data-act="delete"]').addEventListener("click", () => {
    overlay.remove();
    if (confirm(`Delete section “${section.name}”? Its habits stay — they just become Ungrouped.`)) deleteSection(section);
  });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

async function renameSection(section, name) {
  const { error } = await db.from("sections").update({ name }).eq("id", section.id);
  if (error) return alert(error.message);
  section.name = name;
  render();
}

async function deleteSection(section) {
  const { error } = await db.from("sections").delete().eq("id", section.id);
  if (error) return alert(error.message);
  sections = sections.filter((s) => s.id !== section.id);
  habits.forEach((h) => { if (h.section_id === section.id) h.section_id = null; }); // mirror ON DELETE SET NULL
  render();
}

// Insert a new section, append it locally, return the row (or null on error).
async function createSection(name) {
  const { data: u } = await db.auth.getUser();
  const { data, error } = await db.from("sections").insert({
    user_id: u.user.id, name, sort_order: sections.length,
  }).select().single();
  if (error) { alert(error.message); return null; }
  sections.push(data);
  return data;
}

// A <select> of sections for the add/edit forms. `prefix` namespaces the id
// ('h' add form, 'hs' habit screen). Includes "Ungrouped" and a "＋ New section" option.
function sectionSelectHtml(prefix, selectedId) {
  const opts = sections.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
    .map((s) => `<option value="${s.id}"${s.id === selectedId ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  return `<label>Section
    <select id="${prefix}-section">
      <option value=""${!selectedId ? " selected" : ""}>Ungrouped</option>
      ${opts}
      <option value="__new__">＋ New section…</option>
    </select>
  </label>`;
}

function wireSectionSelect(prefix) {
  const sel = $(`${prefix}-section`);
  if (!sel) return;
  let prev = sel.value;
  sel.addEventListener("change", async () => {
    if (sel.value !== "__new__") { prev = sel.value; return; }
    const name = (prompt("New section name:") || "").trim();
    if (!name) { sel.value = prev; return; }
    const s = await createSection(name);
    if (!s) { sel.value = prev; return; }
    const opt = document.createElement("option");
    opt.value = s.id; opt.textContent = s.name;
    sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
    sel.value = s.id;
    prev = sel.value;
  });
}

function readSectionSelect(prefix) {
  const sel = $(`${prefix}-section`);
  const v = sel ? sel.value : "";
  return v && v !== "__new__" ? v : null;
}

// Longest clean stretch for a "break" habit, in days — the max of the gaps between
// consecutive logs AND the current ongoing stretch (days since the last log).
function longestBreakStretch(habitId) {
  const list = entriesByHabit[habitId] || [];
  if (!list.length) return null;
  const days = list.map((e) => dayIndex(e.at.getTime())).sort((a, b) => a - b);
  let max = dayIndex(Date.now()) - days[days.length - 1]; // ongoing stretch since last log
  for (let i = 1; i < days.length; i++) max = Math.max(max, days[i] - days[i - 1]);
  return max;
}

// The bottom-right metric on a tile. Most types show total logs ("12×"); "buys"
// shows cost-per-wear, "break" shows the longest clean stretch.
function tileMetric(h, count) {
  if (h.type === "buys") {
    if (h.price != null && count > 0) return fmtMoney(h.price / count) + "/wr";
    if (h.price != null) return fmtMoney(h.price);
    return count + "×";
  }
  if (h.type === "break") {
    const s = longestBreakStretch(h.id);
    return s == null ? "—" : "best " + s + "d";
  }
  return count + "×";
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
  // Buys items with a photo show a square thumbnail in place of the emoji.
  const icon = (h.type === "buys" && h.photo_path)
    ? `<img class="tile-thumb" data-photo="${h.id}" alt="" />`
    : h.emoji;
  // A "⋯" affordance hints at the options menu (long-press isn't discoverable). Only
  // shown on normal tiles (no due-badge to clash with) outside reorder mode.
  const showMore = !reorderMode && status === "none";
  tile.innerHTML = `
    <span class="due-badge">${status === "soon" ? "SOON" : "DUE"}</span>
    ${flags ? `<span class="tile-flags">${flags}</span>` : ""}
    ${showMore ? `<button class="tile-more" aria-label="Options">⋯</button>` : ""}
    <div class="emoji">${icon}</div>
    <div class="name">${escapeHtml(h.name)}</div>
    <div class="stat">${sinceText(daysSince)}</div>
    <div class="count">${tileMetric(h, count)}</div>`;
  // The <img> is in place now but not yet in the DOM; load its signed URL once the
  // tile has been appended (after this synchronous render pass).
  if (h.type === "buys" && h.photo_path) queueMicrotask(() => loadHabitPhoto(h.id, h.photo_path));
  // In reorder mode, tiles are only drag-sortable under manual sort (otherwise the
  // visible order is computed, so dragging couldn't stick). Sections still reorder.
  if (reorderMode && sortMode === "manual") attachReorderGestures(tile);
  else if (!reorderMode) {
    attachTileGestures(tile, h);
    const more = tile.querySelector(".tile-more");
    if (more) {
      // Stop the tap/long-press gestures on the tile from firing when using "⋯".
      more.addEventListener("pointerdown", (e) => e.stopPropagation());
      more.addEventListener("click", (e) => { e.stopPropagation(); openTileMenu(h, tile); });
    }
  }
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

// Tap = open the date/time sheet (defaults to now). Press-and-hold (or
// right-click) = options popup.
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
    openLogSheet(h, tile);
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
      <button data-act="details" class="secondary">📋 Habit Details</button>
      <button data-act="pin" class="secondary">${h.pinned ? "📌 Unpin" : "📌 Pin to top"}</button>
      <button data-act="pausehide" class="secondary">${(h.paused && h.hidden) ? "▶️ Resume & show" : "⏸ Pause & hide"}</button>
      <button data-act="category" class="secondary">🗂 Move to section…</button>
      <button data-act="delete" class="secondary danger">🗑 Delete</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTileMenu(); });
  overlay.querySelector('[data-act="details"]').addEventListener("click", () => { closeTileMenu(); openHabitScreen(h.id); });
  overlay.querySelector('[data-act="pin"]').addEventListener("click", () => { closeTileMenu(); togglePin(h); });
  overlay.querySelector('[data-act="pausehide"]').addEventListener("click", () => { closeTileMenu(); togglePauseHide(h); });
  overlay.querySelector('[data-act="category"]').addEventListener("click", () => { closeTileMenu(); openSectionPicker(h); });
  overlay.querySelector('[data-act="delete"]').addEventListener("click", () => { closeTileMenu(); deleteHabit(h); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", closeTileMenu);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
}

function closeTileMenu() {
  const m = $("tile-menu");
  if (m) m.remove();
}

// Quick "move to section" picker (from the long-press menu). Lists Ungrouped + every
// section + a "New section…" option; sets the habit's section_id.
function openSectionPicker(h) {
  const overlay = document.createElement("div");
  overlay.id = "section-picker";
  overlay.className = "popover show";
  const ordered = sections.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  const current = h.section_id || "";
  const row = (id, label) =>
    `<button data-sec="${id}" class="secondary${id === current ? " active" : ""}">${escapeHtml(label)}</button>`;
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">Move “${escapeHtml(h.name)}” to…</div>
      ${row("", "Ungrouped")}
      ${ordered.map((s) => row(s.id, s.name)).join("")}
      <button data-sec="__new__" class="secondary">＋ New section…</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", close);
  overlay.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", async () => {
    let sectionId = b.dataset.sec;
    if (sectionId === "__new__") {
      const name = (prompt("New section name:") || "").trim();
      if (!name) return;
      const s = await createSection(name);
      if (!s) return;
      sectionId = s.id;
    }
    close();
    await setHabitSection(h, sectionId || null);
  }));
  document.body.appendChild(overlay);
}

async function setHabitSection(h, sectionId) {
  const { error } = await db.from("habits").update({ section_id: sectionId }).eq("id", h.id);
  if (error) return alert(error.message);
  h.section_id = sectionId;
  render();
  showToast(sectionId ? `Moved ${h.emoji} ${h.name}` : `Moved ${h.emoji} ${h.name} to Ungrouped`);
}

// Three-way "unsaved changes" dialog for leaving the habit screen mid-edit.
function confirmUnsaved(onSave, onDiscard) {
  const overlay = document.createElement("div");
  overlay.id = "confirm-unsaved";
  overlay.className = "popover show";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">Unsaved changes</div>
      <p class="msg" style="margin:0">You've made changes that aren't saved yet.</p>
      <button data-act="save">Save &amp; exit</button>
      <button data-act="discard" class="secondary danger">Discard changes</button>
      <button data-act="stay" class="ghost">Keep editing</button>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="save"]').addEventListener("click", () => { close(); onSave(); });
  overlay.querySelector('[data-act="discard"]').addEventListener("click", () => { close(); onDiscard(); });
  overlay.querySelector('[data-act="stay"]').addEventListener("click", close);
  document.body.appendChild(overlay);
}

// Deleting a habit is deferred ~5s behind an Undo toast (no confirm dialog). The tile
// disappears immediately; the actual DB delete only fires once the window passes, so
// Undo is instant. Used by the long-press menu and the habit screen.
let pendingDelete = null; // { habit, entries, timer }

function deleteHabit(h) {
  commitPendingDelete(); // flush any earlier pending delete first
  pendingDelete = { habit: h, entries: entriesByHabit[h.id] || [], timer: null };
  habits = habits.filter((x) => x.id !== h.id);
  delete entriesByHabit[h.id];
  if (screenHabitId === h.id) closeHabitScreen();
  render();
  showToast(`Deleted ${h.emoji} ${h.name}`, undoDelete);
  pendingDelete.timer = setTimeout(commitPendingDelete, 5000);
}

function undoDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  const { habit, entries } = pendingDelete;
  pendingDelete = null;
  habits.push(habit);
  entriesByHabit[habit.id] = entries;
  render();
  hideToast();
}

// Commit the pending delete to the DB (called when the undo window lapses, before a
// new delete, or when the app is backgrounded so a refresh can't resurrect it).
async function commitPendingDelete() {
  if (!pendingDelete) return;
  const { habit, entries, timer } = pendingDelete;
  clearTimeout(timer);
  pendingDelete = null;
  const { error } = await db.from("habits").delete().eq("id", habit.id);
  if (error) { // restore on failure
    habits.push(habit);
    entriesByHabit[habit.id] = entries;
    render();
    alert(error.message);
  }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) commitPendingDelete(); });

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
  const hasTags = (h.tags || []).length > 0;

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
    // Swipe a row left to reveal a Delete button; tap 📝 to add/edit a note, 🏷 to tag.
    historyHtml = entries.map((e) => `
      <div class="swipe" data-id="${e.id}">
        <button class="swipe-del" data-id="${e.id}">Delete</button>
        <div class="swipe-content">
          <div class="hist-main">
            <span>${fmtDateTime(e.at)}</span>
            ${e.tag ? `<span class="hist-tag">${escapeHtml(e.tag)}</span>` : ""}
            ${e.note ? `<span class="hist-note">${escapeHtml(e.note)}</span>` : ""}
          </div>
          ${hasTags ? `<button class="note-btn${e.tag ? " has-note" : ""}" data-tagedit="${e.id}">🏷</button>` : ""}
          <button class="note-btn${e.note ? " has-note" : ""}" data-note="${e.id}">📝</button>
        </div>
      </div>`).join("");
  } else {
    // Check rows, then Delete selected; 📝 to add/edit a note, 🏷 to tag.
    historyHtml = `
      <div class="bulk-bar">
        <button data-act="del-selected" disabled>Delete selected</button>
        <span class="sel-count"></span>
      </div>` +
      entries.map((e) => `
        <div class="hist-row select">
          <div class="hist-main">
            <span>${fmtDateTime(e.at)}</span>
            ${e.tag ? `<span class="hist-tag">${escapeHtml(e.tag)}</span>` : ""}
            ${e.note ? `<span class="hist-note">${escapeHtml(e.note)}</span>` : ""}
          </div>
          ${hasTags ? `<button class="note-btn${e.tag ? " has-note" : ""}" data-tagedit="${e.id}">🏷</button>` : ""}
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

      <button class="wide" data-act="lognow">${h.type === "buys" ? "Log a wear now" : "Log a new entry now"}</button>

      ${h.type === "buys" ? buildBuysCard(h)
        : h.type === "bites" ? buildBitesCalendar(
            (entriesByHabit[h.id] || []).map((e) => ({ at: e.at, emoji: h.emoji, name: h.name })))
        : buildTrend(h)}

      ${buildTagBreakdown(h)}

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
        <label>Emoji <input id="hs-emoji" maxlength="16" value="${escapeAttr(h.emoji)}" /></label>
        <label>Name <input id="hs-name" value="${escapeAttr(h.name)}" /></label>
        <label>Type
          <select id="hs-type">
            ${TYPES.map((tt) => `<option value="${tt.key}"${tt.key === h.type ? " selected" : ""}>${tt.label}</option>`).join("")}
          </select>
        </label>
        <label>Color <div id="hs-color" class="swatches"></div></label>
        ${sectionSelectHtml("hs", h.section_id || "")}
        ${h.type === "buys"
          ? buysFieldsHtml("hs", h)
          : dueControlHtml("hs", h.due_mode, h.recurrence_days, h.reminder_lead_days)}
        <label class="row"><input id="hs-pinned" type="checkbox"${h.pinned ? " checked" : ""} /> Pin to top</label>
        ${h.type === "buys" ? "" : `<label class="row"><input id="hs-paused" type="checkbox"${h.paused ? " checked" : ""} /> Paused (no reminders)</label>`}
        <label class="row"><input id="hs-hidden" type="checkbox"${h.hidden ? " checked" : ""} /> Hide from main view</label>
      </section>

      <button class="wide danger" data-act="delete">Delete habit</button>
    </div>`;

  const getColor = renderSwatches(panel.querySelector("#hs-color"), h.color, null);

  // Read the edit form into a patch (no photo upload) — used for both saving and
  // dirty-detection. Type-specific fields only exist for the matching type.
  const readEdits = () => {
    const type = $("hs-type").value;
    const patch = {
      name: $("hs-name").value.trim(),
      emoji: $("hs-emoji").value.trim() || "✅",
      type,
      color: getColor(),
      section_id: readSectionSelect("hs"),
      pinned: $("hs-pinned").checked,
      hidden: $("hs-hidden").checked,
      paused: $("hs-paused") ? $("hs-paused").checked : (h.paused || false),
    };
    if (type === "buys") {
      Object.assign(patch, { due_mode: "none", recurrence_days: null, reminder_lead_days: 0 });
      if ($("hs-price")) Object.assign(patch, readBuysFields("hs"));
    } else if ($("hs-recur")) {
      const due = readDueControl("hs");
      Object.assign(patch, { due_mode: due.due_mode, recurrence_days: due.recurrence_days, reminder_lead_days: due.reminder_lead_days });
    }
    return patch;
  };
  const isDirty = () => {
    if (hsPhotoBlob) return true;
    const p = readEdits();
    // Loose (!=) on purpose: a numeric column can come back as a string ("30.00"),
    // and null/undefined should read as unchanged — avoids false "unsaved" warnings.
    return Object.keys(p).some((k) => (h[k] == null ? null : h[k]) != (p[k] == null ? null : p[k]));
  };
  const commit = async () => {
    const patch = readEdits();
    if (!patch.name) { alert("Name can't be empty."); return false; }
    if (patch.type === "buys" && hsPhotoBlob) {
      try { patch.photo_path = await uploadHabitPhoto(h.id, hsPhotoBlob); hsPhotoBlob = null; }
      catch (e) { alert(e.message || "Couldn't upload that photo."); return false; }
    }
    const { error } = await db.from("habits").update(patch).eq("id", h.id);
    if (error) { alert(error.message); return false; }
    Object.assign(h, patch);
    return true;
  };

  panel.querySelector('[data-act="back"]').addEventListener("click", () => {
    if (!isDirty()) return closeHabitScreen();
    confirmUnsaved(
      async () => { if (await commit()) { render(); closeHabitScreen(); } },
      () => closeHabitScreen()
    );
  });
  if (h.type === "buys") {
    loadHabitPhoto(h.id, h.photo_path);
    hsPhotoBlob = null;
    wireBuysPhotoInput("hs", (b) => { hsPhotoBlob = b; });
    // "Crop photo" re-crops the existing stored photo and uploads immediately.
    const recrop = $("hs-recrop");
    if (recrop) recrop.addEventListener("click", async () => {
      const blob = await fetchPhotoBlob(h.photo_path);
      if (!blob) return alert("Couldn't load the photo to crop.");
      const cropped = await openCropper(blob);
      if (!cropped) return;
      try {
        h.photo_path = await uploadHabitPhoto(h.id, cropped);
        await db.from("habits").update({ photo_path: h.photo_path }).eq("id", h.id);
        renderHabitScreen(); render(); flashSuccess();
      } catch (err) { alert(err.message || "Couldn't save the cropped photo."); }
    });
  } else {
    wireDueControl("hs"); // buys has no due control to wire
  }
  wireSectionSelect("hs");
  wireEmojiInput(panel.querySelector("#hs-emoji"));
  wireBitesCalendar(panel, renderHabitScreen); // bites screens carry a meal calendar
  panel.querySelectorAll("[data-note]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openNoteEditor(h.id, b.dataset.note); }));

  // Tag controls: edit a log's tag, open a tag's subset detail, and manage the list.
  panel.querySelectorAll("[data-tagedit]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openEntryTagPicker(h, b.dataset.tagedit); }));
  panel.querySelectorAll("[data-tagdetail]").forEach((row) =>
    row.addEventListener("click", () => openTagDetail(h, row.dataset.tagdetail)));
  panel.querySelectorAll("[data-tagrename]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); renameHabitTag(h, b.dataset.tagrename); }));
  panel.querySelectorAll("[data-tagdel]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); deleteHabitTag(h, b.dataset.tagdel); }));
  panel.querySelector('[data-act="addtag"]').addEventListener("click", () => addHabitTag(h));

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
    if (await commit()) { renderHabitScreen(); render(); flashSuccess(); }
  });

  panel.querySelector('[data-act="delete"]').addEventListener("click", () => deleteHabit(h));
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

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

// Friendly empty state for a tab with no habits, with a one-tap add for this tab's type.
function emptyTabEl(view) {
  const div = document.createElement("div");
  div.className = "empty-welcome";
  const emoji = TYPE_EMOJI[view.types[0]] || "✨";
  div.innerHTML = `
    <div class="ew-emoji">${emoji}</div>
    <p class="msg">Nothing in ${escapeHtml(view.label)} yet.</p>
    <button class="wide" data-act="add">＋ Add a habit here</button>`;
  div.querySelector('[data-act="add"]').addEventListener("click", () => addHabitToSection(null));
  return div;
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

// Mini-menu shortcut: pause AND hide together. If both are already on, it turns
// both off (resume & show). The habit screen still exposes the two as separate
// checkboxes, so either can be toggled on its own there.
async function togglePauseHide(h) {
  const on = !(h.paused && h.hidden);
  const { error } = await db.from("habits").update({ paused: on, hidden: on }).eq("id", h.id);
  if (error) return alert(error.message);
  h.paused = on; h.hidden = on; render();
  showToast(on ? `Paused & hid ${h.emoji} ${h.name}` : `Resumed & showed ${h.emoji} ${h.name}`);
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

// A Date → the value string a datetime-local input expects (local wall-clock).
function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Tapping a habit opens this sheet: adjust the date/time (defaults to now), then
// confirm to log. Same picker the habit screen uses for backdating.
function openLogSheet(h, tile) {
  const overlay = document.createElement("div");
  overlay.id = "log-sheet";
  overlay.className = "popover show";
  // When the habit has tags, offer a chip row to pick which subset this log is (e.g.
  // which restaurant). "No tag" is selected by default so it's always skippable.
  const tags = h.tags || [];
  const tagRow = tags.length ? `
      <div class="log-tags">
        <span class="log-tags-lbl">Which one?</span>
        <div class="tag-chips">
          <button type="button" class="tag-chip active" data-tag="">No tag</button>
          ${tags.map((t) => `<button type="button" class="tag-chip" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join("")}
        </div>
      </div>` : "";
  overlay.innerHTML = `
    <div class="popover-card">
      <div class="popover-title">${h.emoji} ${escapeHtml(h.name)}</div>
      <button data-act="screen" class="secondary">📋 Habit Details</button>
      <label>When?
        <input type="datetime-local" id="log-when" value="${toLocalInputValue(new Date())}" />
      </label>
      ${tagRow}
      <button data-act="confirm">Log it</button>
      <button data-act="cancel" class="ghost">Cancel</button>
    </div>`;
  const close = () => overlay.remove();
  let chosenTag = "";
  overlay.querySelectorAll(".tag-chip").forEach((b) =>
    b.addEventListener("click", () => {
      overlay.querySelectorAll(".tag-chip").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      chosenTag = b.dataset.tag;
    }));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="screen"]').addEventListener("click", () => { close(); openHabitScreen(h.id); });
  overlay.querySelector('[data-act="cancel"]').addEventListener("click", close);
  overlay.querySelector('[data-act="confirm"]').addEventListener("click", () => {
    const v = $("log-when").value;
    if (!v) return;
    const when = new Date(v);
    if (isNaN(when)) return alert("Couldn't read that date.");
    close();
    logEntry(h.id, when, tile, chosenTag);
  });
  document.body.appendChild(overlay);
}

// Insert an entry at `when` with the full tap feedback: pop, toast + undo, and a
// Due-tab refresh so a now-satisfied habit drops off.
async function logEntry(habitId, when, tile, tag) {
  buzz();
  popTile(tile);
  const row = await insertEntry(habitId, when, tag);
  if (!row) return;
  updateTile(habitId);
  const h = habits.find((x) => x.id === habitId);
  showToast(`Logged ${h.emoji} ${h.name}`, () => undoLog(habitId, row.id));
  // On the Due tab a logged habit is no longer due — let the pop play, then re-render so it drops off.
  if (currentView === "due") setTimeout(() => { if (currentView === "due") render(); }, 850);
}

// Insert an entry; returns the new row ({id}) or null on error. `tag` is optional
// (the chosen subset, e.g. which restaurant) — null/"" means logged without a tag.
async function insertEntry(habitId, when, tag) {
  const { data: u } = await db.auth.getUser();
  const { data, error } = await db.from("entries").insert({
    habit_id: habitId, user_id: u.user.id, logged_at: when.toISOString(), tag: tag || null,
  }).select("id").single();
  if (error) { alert(error.message); return null; }
  (entriesByHabit[habitId] ||= []).push({ id: data.id, at: when, tag: tag || "" });
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
  tile.querySelector(".count").textContent = tileMetric(h, count);
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

/* ---------- Emoji picker ---------- */

// Web apps can't force the OS emoji keyboard open (iOS Safari ignores every hint),
// so we bring our own: tapping an emoji field opens this curated grid. The "type
// your own" box inside covers anything not listed.
const EMOJI_PICKER = {
  "Smileys": ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "😘", "😋", "😛", "🤪", "😎", "🤩", "🥳", "😏", "😔", "😴", "🤒", "🤕", "🤢", "🥶", "🥵", "😱", "😭", "😡", "🤔", "🤨", "😐", "🙄", "😬", "🤯", "😳", "🥺"],
  "Activity": ["🏋️", "🧘", "🚶", "🏃", "🚴", "🏊", "🧗", "🤸", "🥊", "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏓", "🏸", "🥏", "🎯", "🎳", "🎮", "🕹️", "🎲", "♟️", "🎨", "🎭", "🎸", "🎹", "🥁", "🎺", "🎻", "🎤", "🎧", "📖", "✍️", "🧠", "💻", "🧹", "🛁", "🦷", "💊", "💤", "🏕️", "🎣", "🏄", "🛹", "⛷️", "🏂"],
  "Food & drink": ["💧", "☕", "🍵", "🧃", "🥤", "🧋", "🍺", "🍷", "🥂", "🍸", "🍹", "🍳", "🥞", "🧇", "🥓", "🥐", "🥯", "🍞", "🧀", "🥗", "🌮", "🌯", "🥙", "🥪", "🍔", "🍟", "🍕", "🌭", "🍝", "🍜", "🍲", "🍣", "🍱", "🍛", "🍚", "🥟", "🍤", "🍗", "🥩", "🍎", "🍌", "🍓", "🫐", "🍇", "🍉", "🍊", "🥭", "🍑", "🍒", "🥑", "🥦", "🥕", "🌽", "🍫", "🍭", "🍩", "🍪", "🎂", "🍰", "🧁", "🍦"],
  "People": ["🤙", "📞", "💬", "📨", "👋", "🧑‍🤝‍🧑", "👶", "🧑", "👩", "👨", "👵", "👴", "❤️", "🎉", "🍽️", "🎂", "💌", "🤝", "💍", "👪", "🫂"],
  "Animals & nature": ["🐶", "🐱", "🐰", "🐹", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐔", "🐧", "🐦", "🦉", "🐢", "🐠", "🐬", "🐝", "🦋", "🐞", "🌲", "🌳", "🌴", "🌵", "🌿", "🍀", "🌸", "🌻", "🌷", "🌹", "🍁", "🍄", "🌊", "🌈", "⚡", "❄️", "🌞", "🌙"],
  "Travel & places": ["🚗", "🚕", "🚌", "🚆", "🚄", "🚲", "🛴", "🛵", "🏍️", "✈️", "🚁", "🚀", "⛵", "🚢", "🗺️", "🧭", "🏠", "🏡", "🏢", "🏨", "🏰", "⛺", "🏖️", "🏝️", "⛰️", "🌉", "🎡", "🎢"],
  "Objects": ["📱", "💻", "⌨️", "🖥️", "📷", "📸", "🎥", "📺", "☎️", "🔋", "🔌", "💡", "🔦", "🕯️", "🧰", "🔧", "🔨", "🧲", "🧪", "🔬", "🔭", "📡", "💉", "🩹", "🛏️", "🚪", "🪑", "🚿", "🧴", "🧵", "🧶", "🔑", "🧺", "🪥", "📚", "🎧", "📷"],
  "Symbols": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💖", "✨", "⭐", "🌟", "💫", "🔥", "💥", "✅", "❌", "❓", "❗", "➕", "➖", "☑️", "🔒", "🔔", "♻️", "⚠️", "🚫", "💯", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪"],
  "Life": ["💰", "💵", "💳", "🛒", "📱", "📵", "⏰", "⏳", "📅", "🗓️", "🌱", "✅", "⭐", "🔥", "🏆", "🥇", "🎁", "🎈", "🧾", "🎧", "📷", "📚", "🔑", "💡", "🚬"],
  "Wardrobe": ["👕", "👔", "👖", "👗", "👚", "🧥", "🧦", "🧣", "🧤", "🧢", "🎩", "👒", "🩳", "🩱", "👙", "👘", "🥻", "👞", "👟", "👠", "👡", "👢", "🥾", "👜", "👛", "👝", "🎒", "🕶️", "👓", "💍", "⌚", "📿", "💄", "👑"],
};

// Turn an emoji <input> into a picker trigger: read-only (so the text keyboard
// doesn't open) and clicking it opens the grid. Guarded so it wires only once.
function wireEmojiInput(input) {
  if (!input || input.dataset.emojiWired) return;
  input.dataset.emojiWired = "1";
  input.readOnly = true;
  input.classList.add("emoji-input");
  // Open the picker from anywhere in the "Emoji [box]" label — a bigger tap target than
  // the small readonly box. preventDefault stops iOS from dropping a no-op text caret in
  // the readonly input (a blinking cursor with no keyboard), which made off-centre taps
  // feel like they did nothing.
  const target = input.closest("label") || input;
  target.addEventListener("click", (e) => { e.preventDefault(); openEmojiPicker(input); });
}

// Split a string into grapheme clusters, so a single flag/ZWJ emoji counts as one.
function graphemes(str) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter().segment(str), (s) => s.segment);
  }
  return Array.from(str); // fallback: split by code point
}
// Keep at most `n` emoji clusters.
function clampEmojis(str, n = 2) {
  return graphemes((str || "").trim()).slice(0, n).join("");
}

// Habits can hold up to 2 emojis. Tap grid emojis to build a 1–2 combo (a 3rd tap
// starts over), or type/paste your own. Live preview; the field updates as you go.
function openEmojiPicker(input) {
  const overlay = document.createElement("div");
  overlay.id = "emoji-picker";
  overlay.className = "popover show";
  const cats = Object.entries(EMOJI_PICKER).map(([name, list]) =>
    `<div class="emoji-cat">${escapeHtml(name)}</div>
     <div class="emoji-grid">${list.map((e) => `<button type="button" class="emoji-opt">${e}</button>`).join("")}</div>`).join("");
  overlay.innerHTML = `
    <div class="popover-card emoji-card">
      <div class="emoji-view" data-view="type">
        <div class="popover-title">Pick up to 2 emojis</div>
        <div class="emoji-preview"><span id="emoji-preview"></span>
          <button data-act="clear" type="button" class="ghost">Clear</button></div>
        <label class="emoji-custom">Type or paste your own
          <input type="text" id="emoji-custom-in" maxlength="20" value="${escapeAttr(input.value)}" placeholder="e.g. 🧣" />
        </label>
        <button data-act="suggest" type="button" class="secondary">✨ Suggested emojis ›</button>
        <button data-act="done">Done</button>
      </div>
      <div class="emoji-view hidden" data-view="grid">
        <div class="emoji-gridhead">
          <button data-act="back" type="button" class="ghost">‹ Back</button>
          <div class="popover-title">Suggested emojis</div>
          <span class="emoji-gridhead-spacer"></span>
        </div>
        <div class="emoji-scroll">${cats}</div>
        <button data-act="done">Done</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  const preview = overlay.querySelector("#emoji-preview");
  const custom = overlay.querySelector("#emoji-custom-in");
  const typeView = overlay.querySelector('[data-view="type"]');
  const gridView = overlay.querySelector('[data-view="grid"]');
  const setSel = (v) => {
    const val = clampEmojis(v, 2);
    input.value = val;
    preview.textContent = val || "—";
    if (custom.value !== val) custom.value = val;
  };
  setSel(input.value);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll(".emoji-opt").forEach((b) =>
    b.addEventListener("click", () => {
      // A 3rd tap starts a fresh single emoji; otherwise append.
      setSel(graphemes(input.value).length >= 2 ? b.textContent : input.value + b.textContent);
    }));
  custom.addEventListener("input", () => setSel(custom.value));
  overlay.querySelector('[data-act="clear"]').addEventListener("click", () => setSel(""));
  // Suggestions live behind a button so the keyboard/type field stays primary; the
  // button swaps to a full grid, and Back returns to typing.
  overlay.querySelector('[data-act="suggest"]').addEventListener("click", () => {
    typeView.classList.add("hidden"); gridView.classList.remove("hidden");
  });
  overlay.querySelector('[data-act="back"]').addEventListener("click", () => {
    gridView.classList.add("hidden"); typeView.classList.remove("hidden");
  });
  overlay.querySelectorAll('[data-act="done"]').forEach((b) => b.addEventListener("click", close));
  document.body.appendChild(overlay);
  // Keyboard-first: drop the cursor straight into the type field. iOS doesn't always
  // honour programmatic focus, so a tap may still be needed — but when it works the
  // keyboard is up immediately.
  custom.focus();
  custom.setSelectionRange(custom.value.length, custom.value.length);
}

/* ---------- Add habit modal ---------- */

// Big emoji for each type on the step-1 "What are you adding?" picker.
const TYPE_EMOJI = { build: "🌱", break: "🚫", track: "📋", bonds: "🤝", buys: "🛍️", bites: "🍽️" };

// Step 1: "+ Habit" opens a type picker; choosing a type opens the step-2 form.
$("add-habit").addEventListener("click", () => { newHabitSection = null; openTypePicker(); });
$("type-cancel").addEventListener("click", () => $("type-modal").classList.add("hidden"));
$("type-suggest").addEventListener("click", () => openSuggestions()); // all types
$("h-back").addEventListener("click", () => { $("modal").classList.add("hidden"); $("habit-form").reset(); openTypePicker(); });

// `limitKeys` (optional) restricts the choices — used by a section "+" on a tab that
// spans multiple types (Build & Track). Hides "Browse suggestions" in that case.
function openTypePicker(limitKeys) {
  const wrap = $("type-picker");
  const types = limitKeys ? TYPES.filter((t) => limitKeys.includes(t.key)) : TYPES;
  wrap.innerHTML = types.map((t) => `
    <button type="button" class="type-choice" data-type="${t.key}" style="--type:${t.color}">
      <span class="tc-emoji">${TYPE_EMOJI[t.key]}</span>
      <span class="tc-text"><b>${t.label}</b><small>${TYPE_DESC[t.key]}</small></span>
    </button>`).join("");
  wrap.querySelectorAll(".type-choice").forEach((b) =>
    b.addEventListener("click", () => openHabitForm(b.dataset.type)));
  $("type-suggest").style.display = limitKeys ? "none" : "";
  $("type-modal").classList.remove("hidden");
}

// A section "+" adds a habit of the tab's type into that section. Multi-type tabs
// (Build & Track) ask which type first; single-type tabs skip to the form.
function addHabitToSection(sectionId) {
  const view = VIEWS.find((v) => v.key === currentView);
  if (!view || !view.types || !view.types.length) return;
  newHabitSection = sectionId || null;
  if (view.types.length === 1) openHabitForm(view.types[0]);
  else openTypePicker(view.types);
}

// Step 2: the type-specific New-habit form.
function openHabitForm(type) {
  newHabitType = type;
  newHabitColor = null;
  const label = (TYPES.find((t) => t.key === type) || {}).label || "habit";
  $("type-modal").classList.add("hidden");
  $("habit-form").reset();
  $("h-emoji").value = (type === "buys" || type === "bites") ? TYPE_EMOJI[type] : "✅";
  $("h-title").textContent = `New ${label}`;
  wireEmojiInput($("h-emoji"));
  renderSwatches($("h-color"), null, (c) => { newHabitColor = c; });
  $("h-section-wrap").innerHTML = sectionSelectHtml("h", newHabitSection || "");
  wireSectionSelect("h");
  // Buys → price/photo/etc.; every other type → the reminders control.
  if (type === "buys") {
    $("h-extra").innerHTML = buysFieldsHtml("h", null);
    newHabitPhotoBlob = null;
    wireBuysPhotoInput("h", (b) => { newHabitPhotoBlob = b; });
  } else {
    $("h-extra").innerHTML = dueControlHtml("h", "none", 7, 0);
    wireDueControl("h");
  }
  // Step-2 suggestions button only shows for types that have starter suggestions.
  $("open-suggestions").style.display = SUGGESTIONS.some((s) => s.type === type) ? "" : "none";
  $("modal").classList.remove("hidden");
}

/* ---------- Search / sort / reorder controls ---------- */
$("search").addEventListener("input", (e) => { searchTerm = e.target.value; render(); });
$("search-scope").addEventListener("click", () => {
  searchAllTabs = !searchAllTabs;
  localStorage.setItem("searchAllTabs", searchAllTabs ? "1" : "0");
  render();
});
$("sort").addEventListener("change", (e) => { saveSortMode(e.target.value); render(); });
$("reorder").addEventListener("click", () => { reorderMode = !reorderMode; render(); });

/* ---------- Suggested habits ---------- */

// Step-2 form's suggestions button: filtered to the chosen type.
$("open-suggestions").addEventListener("click", () => openSuggestions(newHabitType));

// `filterType` limits the list to one type (step-2 button); null shows all (step-1 button).
function openSuggestions(filterType) {
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
    if (filterType && t.key !== filterType) continue;
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

// Open the step-2 form for a suggestion's type, then prefill its name/emoji/cadence.
function prefillHabitForm(s) {
  openHabitForm(s.type);
  $("h-emoji").value = s.emoji;
  $("h-name").value = s.name;
  if (s.type !== "buys") {
    $("h-extra").innerHTML = dueControlHtml("h", s.days ? "recurrence" : "none", s.days || 7, 0);
    wireDueControl("h");
  }
}

$("habit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data: u } = await db.auth.getUser();
  const row = {
    user_id: u.user.id,
    name: $("h-name").value.trim(),
    type: newHabitType,
    emoji: $("h-emoji").value.trim() || "✅",
    color: newHabitColor,
    section_id: readSectionSelect("h"),
    sort_order: habits.length,
  };
  if (newHabitType === "buys") {
    Object.assign(row, { due_mode: "none", recurrence_days: null, reminder_lead_days: 0 }, readBuysFields("h"));
  } else {
    const due = readDueControl("h");
    Object.assign(row, { due_mode: due.due_mode, recurrence_days: due.recurrence_days, reminder_lead_days: due.reminder_lead_days });
  }
  const { data, error } = await db.from("habits").insert(row).select().single();
  if (error) return alert(error.message);

  // Photo upload waits until the row exists (its id is part of the storage path).
  if (newHabitType === "buys" && newHabitPhotoBlob) {
    try {
      const path = await uploadHabitPhoto(data.id, newHabitPhotoBlob);
      const { error: pe } = await db.from("habits").update({ photo_path: path }).eq("id", data.id);
      if (!pe) data.photo_path = path;
    } catch (err) { alert(err.message || "Item saved, but the photo didn't upload — add it from the item's screen."); }
  }

  habits.push(data);
  newHabitPhotoBlob = null;
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
        <h3>Tab order</h3>
        <p class="hint" style="margin:0">Use the arrows to reorder your tabs. “Due” always stays first.</p>
        <div id="tab-reorder" class="tab-reorder">
          ${reorderableKeys().map((k, i, arr) => {
            const v = VIEWS.find((x) => x.key === k);
            return `<div class="tab-row" data-key="${k}">
              <span class="tab-label">${escapeHtml(v.label)}</span>
              <span class="tab-arrows">
                <button type="button" class="tab-up" data-key="${k}"${i === 0 ? " disabled" : ""} aria-label="Move up">↑</button>
                <button type="button" class="tab-down" data-key="${k}"${i === arr.length - 1 ? " disabled" : ""} aria-label="Move down">↓</button>
              </span>
            </div>`;
          }).join("")}
        </div>
      </section>
      <section class="card-section">
        <h3>Your data</h3>
        <p class="hint" style="margin:0">${habitCount} habit${habitCount === 1 ? "" : "s"} · ${logCount} log${logCount === 1 ? "" : "s"}. Export a copy anytime — it's yours.</p>
        <button class="wide" data-act="json">⬇︎ Export JSON (full backup)</button>
        <button class="wide secondary" data-act="csv">⬇︎ Export CSV (logs for spreadsheets)</button>
      </section>
      <section class="card-section">
        <h3>Account</h3>
        <p class="hint" style="margin:0">Signed in as <span id="acct-email">…</span></p>
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
  panel.querySelectorAll(".tab-up").forEach((b) => b.addEventListener("click", () => moveTab(b.dataset.key, -1)));
  panel.querySelectorAll(".tab-down").forEach((b) => b.addEventListener("click", () => moveTab(b.dataset.key, 1)));
  // Show the login email with only its first 5 characters, the rest masked.
  db.auth.getUser().then(({ data }) => {
    const el = $("acct-email");
    if (el) el.textContent = redactEmail(data?.user?.email) || "—";
  });
}

// First 5 characters of the email shown, the rest masked by a fixed run of "*"
// (fixed length so it doesn't leak how long the address is).
function redactEmail(email) {
  if (!email) return "";
  return email.slice(0, 5) + "*****";
}

// Move a tab one slot up (dir -1) or down (dir +1), persist, and refresh both the
// tab bar and this settings list.
function moveTab(key, dir) {
  const keys = reorderableKeys();
  const i = keys.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  saveTabOrder(keys);
  renderTabs();
  renderSettingsScreen();
}

// All logs as flat rows, joined to their habit later.
function allEntriesFlat() {
  const out = [];
  for (const [habitId, list] of Object.entries(entriesByHabit)) {
    for (const e of list) out.push({ id: e.id, habit_id: habitId, logged_at: e.at.toISOString(), note: e.note || "", tag: e.tag || "" });
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
  const header = ["logged_at", "habit", "type", "emoji", "color", "tag", "note"];
  const lines = [header.join(",")];
  for (const e of rows) {
    const h = byId[e.habit_id] || {};
    lines.push([e.logged_at, h.name || "", h.type || "", h.emoji || "", h.color || "", e.tag, e.note].map(csvCell).join(","));
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
  if ($("cropper")) $("cropper").remove();
  else if ($("confirm-unsaved")) $("confirm-unsaved").remove();
  else if ($("section-picker")) $("section-picker").remove();
  else if ($("emoji-picker")) $("emoji-picker").remove();
  else if ($("log-sheet")) $("log-sheet").remove();
  else if ($("note-editor")) $("note-editor").remove();
  else if ($("tile-menu")) closeTileMenu();
  else if ($("settings-screen")) closeSettingsScreen();
  else if ($("notif-screen")) closeNotifScreen();
  else if ($("suggest-screen")) closeSuggestions();
  else if (screenHabitId) closeHabitScreen();
  else if (!$("modal").classList.contains("hidden")) { $("modal").classList.add("hidden"); $("habit-form").reset(); }
  else if (!$("type-modal").classList.contains("hidden")) $("type-modal").classList.add("hidden");
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
