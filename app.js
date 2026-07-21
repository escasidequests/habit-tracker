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
    <button class="more" title="Backdate / delete">⋯</button>
    <div class="emoji" title="Change emoji">${h.emoji}</div>
    <div class="name">${escapeHtml(h.name)}</div>
    <div class="stat">${sinceText(daysSince)}</div>
    <div class="count">${count}×${overdue ? " · due" : ""}</div>`;
  tile.addEventListener("click", () => logNow(h.id, tile));
  tile.querySelector(".emoji").addEventListener("click", (e) => { e.stopPropagation(); changeEmoji(h); });
  tile.querySelector(".more").addEventListener("click", (e) => { e.stopPropagation(); moreMenu(h); });
  return tile;
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

// Backdated log — full re-render since it can change ordering.
async function addEntry(habitId, when) {
  const row = await insertEntry(habitId, when);
  if (row) render();
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
  $("toast-undo").onclick = onUndo;
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

async function changeEmoji(h) {
  const next = prompt(`Emoji for “${h.name}”`, h.emoji);
  if (!next || next === h.emoji) return;
  const { error } = await db.from("habits").update({ emoji: next }).eq("id", h.id);
  if (error) return alert(error.message);
  h.emoji = next; render();
}

async function moreMenu(h) {
  const choice = prompt(
    `“${h.name}” — type:\n  B = backdate a log (YYYY-MM-DD)\n  D = delete this habit\n(leave blank to cancel)`
  );
  if (!choice) return;
  const c = choice.trim().toUpperCase();
  if (c === "D") {
    if (!confirm(`Delete “${h.name}” and all its logs?`)) return;
    const { error } = await db.from("habits").delete().eq("id", h.id);
    if (error) return alert(error.message);
    habits = habits.filter((x) => x.id !== h.id);
    delete entriesByHabit[h.id];
    render();
  } else if (c === "B") {
    const d = prompt("Date to log (YYYY-MM-DD):");
    if (!d) return;
    const when = new Date(d + "T12:00:00");
    if (isNaN(when)) return alert("Couldn't read that date.");
    addEntry(h.id, when);
  }
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

/* ---------- Boot ---------- */

if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<p style="padding:24px;font-family:sans-serif;color:#e8ecf1;background:#111418">' +
    "Set your Supabase URL and anon key in <code>config.js</code> first.</p>";
} else {
  refreshSession();
}
