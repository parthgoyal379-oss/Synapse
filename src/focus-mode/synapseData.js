/* ─────────────────────────────────────────────────────────────────────────
   FOCUS MODE — SYNAPSE DATA LAYER
   ─────────────────────────────────────────────────────────────────────────
   App.jsx is not modified or refactored, so this file cannot import from
   it. Instead it reads the exact same localStorage keys App.jsx already
   writes (syn_streak, syn_history, syn_confess, syn_urge_log, syn_last)
   and reproduces the small set of *pure* helpers (LEVELS table, quote
   rotation) verbatim, so numbers shown in Focus Mode always match Command
   Mode exactly. If App.jsx's LEVELS/quotes ever change, mirror the change
   here too — this is intentionally a read-only reflection, not a fork of
   app logic (nothing here writes to storage or Firestore).
──────────────────────────────────────────────────────────────────────── */

const ls = {
  get: (key, fallback = null) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
};

const safeParse = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

// Mirrors App.jsx's LEVELS table exactly (same minDays thresholds/titles).
export const LEVELS = [
  { level: 1, title: "COMPROMISED", minDays: 0 },
  { level: 2, title: "AWAKENING", minDays: 3 },
  { level: 3, title: "STABILIZING", minDays: 7 },
  { level: 4, title: "REWIRING", minDays: 14 },
  { level: 5, title: "RECALIBRATED", minDays: 30 },
  { level: 6, title: "OPTIMIZED", minDays: 60 },
  { level: 7, title: "SYNAPSED", minDays: 90 },
];

export const getLevel = (s) => [...LEVELS].reverse().find((l) => s >= l.minDays) || LEVELS[0];
export const getNextLevel = (s) => LEVELS.find((l) => s < l.minDays) || null;

// Mirrors App.jsx's DAILY_QUOTES + getDailyQuote() exactly (same rotation
// formula) so "today's insight" matches Command Mode on the same day.
const DAILY_QUOTES = [
  { q: "The brain is plastic. Every clean day reshapes it.", a: "SYNAPSE" },
  { q: "Your dopamine system is healing right now. Trust the process.", a: "SYNAPSE" },
  { q: "Discipline now. Freedom forever.", a: "SYNAPSE" },
  { q: "Every urge you outlast is a neural pathway you starve.", a: "SYNAPSE" },
  { q: "The soldier who shows up every day wins the war.", a: "SYNAPSE" },
];

export function getDailyQuote() {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5
  );
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}

// Mirrors App.jsx's Checkin component MOODS array exactly (same ids, same
// order) — the mood picker must stay a superset match so `mood` state
// stays valid input to the real onCheckin() flow.
export const MOODS = [
  { id: "strong", label: "💪 Strong", desc: "Felt in control" },
  { id: "held", label: "😤 Held firm", desc: "Tough but managed" },
  { id: "struggled", label: "😔 Struggled", desc: "Close calls today" },
  { id: "rough", label: "💀 Rough day", desc: "Really hard" },
];

// Mirrors App.jsx's TRIGGERS exactly.
export const TRIGGERS = [
  { id: "bored", label: "😑 Bored" },
  { id: "stressed", label: "😰 Stressed" },
  { id: "lonely", label: "🫤 Lonely" },
  { id: "alone_room", label: "🚪 Alone in room" },
  { id: "phone_bed", label: "📱 Phone in bed" },
  { id: "after_argument", label: "💢 After argument" },
  { id: "tired", label: "😴 Tired / late night" },
  { id: "social_media", label: "📲 Saw it on social media" },
  { id: "friends_around", label: "👥 Around certain friends" },
  { id: "failure", label: "📉 Felt like a failure" },
  { id: "free_time", label: "⏳ Too much free time" },
  { id: "habit_cue", label: "🔁 Just a habit / autopilot" },
];

// Mirrors App.jsx's TIME_SLOTS exactly.
export const TIME_SLOTS = [
  { id: "morning", label: "🌅 Morning" },
  { id: "afternoon", label: "☀️ Afternoon" },
  { id: "evening", label: "🌆 Evening" },
  { id: "late_night", label: "🌙 Late Night" },
];

// Mirrors App.jsx's CheckinCountdown (midnight-diff) logic exactly.
export function getCheckinCountdownLabel() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = Math.max(0, midnight - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Mirrors App.jsx's Checkin.computeStatus() exactly: any "slip" -> SLIP,
// else any "partial" -> MID, else WIN. Read-only, used for the live
// verdict readout only — the actual submit still calls onCheckin() with
// this same computed value, same as Command Mode.
export function computeVerdict(addictions, adStatus) {
  if (addictions.length === 0) return "WIN";
  const statuses = addictions.map((a) => adStatus[a.id]);
  if (statuses.some((s) => s === "slip")) return "SLIP";
  if (statuses.some((s) => s === "partial")) return "MID";
  return "WIN";
}

// Mirrors App.jsx's ARCHETYPES metadata (id/title/sub/desc/symbol/accent)
// used for the "Your Archetype" mission card. Kept minimal — only the
// fields Focus Mode actually displays, not the full base64 background art.
export const ARCHETYPES = [
  { id: "sovereign", title: "SOVEREIGN", sub: "Self-Mastery", desc: "You rule yourself before you rule anything else. Iron will. Unshakeable standards. The king who conquered his own mind.", symbol: "♛" },
  { id: "arbiter", title: "ARBITER", sub: "Rational Control", desc: "Cold logic over cheap emotion. You see through the illusion of instant pleasure. Every decision is deliberate, calculated, sovereign.", symbol: "⚖" },
  { id: "stoic", title: "STOIC", sub: "Discipline", desc: "Unmoved by pleasure. Unbroken by pain. You train in the dark so you shine in the light. Roots run deeper than any craving.", symbol: "🌳" },
  { id: "ascendant", title: "ASCENDANT", sub: "Growth", desc: "You don't recover — you evolve. Every day clean is a higher peak. You're not going back to the valley. Only upward from here.", symbol: "▲" },
];

export function readArchetype() {
  try {
    const raw = JSON.parse(ls.get("syn_archetype", "null"));
    if (!raw) return null;
    return ARCHETYPES.find((a) => a.id === raw.id) || raw;
  } catch {
    return null;
  }
}

/**
 * Derives "protocol" rows from the real AI-generated savedPlan text instead
 * of inventing a structured protocol system that doesn't exist in the app.
 * The AI plan is written with **Bold Header** sections (see App.jsx's plan
 * prompts) — this splits on that pattern and returns
 * [{ label, description }], trimmed and de-markdowned. Returns [] if the
 * plan has no such structure (caller should show an empty/adapt state).
 */
export function extractPlanSections(savedPlan, max = 4) {
  if (!savedPlan) return [];
  const parts = savedPlan.split(/\*\*(.+?)\*\*/g).filter((s) => s.trim());
  const rows = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const label = parts[i].trim();
    const description = parts[i + 1]
      .replace(/\n+/g, " ")
      .replace(/[-*]\s?/g, "")
      .trim()
      .slice(0, 110);
    if (label && description) rows.push({ label, description: description + (description.length >= 110 ? "…" : "") });
  }
  return rows.slice(0, max);
}

export function longestStreak(history, currentStreak) {
  const max = history.reduce((m, h) => Math.max(m, h.streak || 0), 0);
  return Math.max(max, currentStreak);
}

export function readTriggerLog() {
  return safeParse(ls.get("syn_trigger_log", "[]"), []); // [{date, mood, addictions:[{id,label,status,...}]}]
}

export function monthlyCheckinsCount(history) {
  const now = new Date();
  return history.filter((h) => {
    const d = new Date(h.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
}

// Buckets check-in history into week rows (oldest-first) for a heatmap.
// Each cell's "level" is the verdict for that day, or null if no check-in.
export function weeklyHeatmapData(history, weeksBack = 4) {
  const byDate = new Map(history.map((h) => [new Date(h.date).toDateString(), h.status]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align to the most recent Monday so weeks read left-to-right, M..S.
  const dow = (today.getDay() + 6) % 7; // 0 = Monday
  const thisWeekMonday = new Date(today);
  thisWeekMonday.setDate(today.getDate() - dow);

  const weeks = [];
  for (let w = weeksBack; w >= 0; w--) {
    const weekStart = new Date(thisWeekMonday);
    weekStart.setDate(thisWeekMonday.getDate() - w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      if (day > today) {
        days.push({ level: null, tooltip: "" });
        continue;
      }
      const status = byDate.get(day.toDateString());
      days.push({ level: status || "missed", tooltip: day.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) });
    }
    weeks.push({ label: w === 0 ? "This Week" : `Week ${weeksBack - w + 1}`, days });
  }
  return weeks;
}

export function verdictDistribution(history) {
  const win = history.filter((h) => h.status === "win").length;
  const mid = history.filter((h) => h.status === "mid").length;
  const slip = history.filter((h) => h.status === "slip").length;
  return { win, mid, slip, total: win + mid + slip };
}

export function urgeResistancePct(urgeLog) {
  if (!urgeLog || urgeLog.length === 0) return 0;
  const survived = urgeLog.filter((u) => u.survived).length;
  return Math.round((survived / urgeLog.length) * 100);
}

// Cumulative urge-resistance rate over time, one point per logged urge, so
// it reads as a real trend instead of a single flat percentage.
export function urgeResistanceTrend(urgeLog) {
  if (!urgeLog || urgeLog.length === 0) return [0];
  const chronological = [...urgeLog].reverse(); // urgeLog is stored newest-first
  let survived = 0;
  return chronological.map((u, i) => {
    if (u.survived) survived++;
    return Math.round((survived / (i + 1)) * 100);
  });
}

// Derives per-addiction Clean/Partial/Slipped counts. syn_trigger_log only
// records days an addiction was partial/slipped (see Checkin's
// logTriggerData) — so "clean" days are inferred as total check-in days
// minus any logged partial/slip day for that addiction. This is a real
// derivation from stored data, not an invented stat.
export function missionPerformance(addictions, history, triggerLog) {
  const totalCheckins = history.length;
  return addictions.map((a) => {
    let partial = 0;
    let slip = 0;
    triggerLog.forEach((entry) => {
      const rec = (entry.addictions || []).find((x) => x.id === a.id);
      if (rec?.status === "partial") partial++;
      if (rec?.status === "slip") slip++;
    });
    const clean = Math.max(0, totalCheckins - partial - slip);
    return { id: a.id, label: a.label, emoji: a.emoji, clean, partial, slip };
  });
}

// Simple, rule-based read of real numbers — no fabricated claims. Every
// bullet is gated behind an actual threshold in the user's own data.
export function inferStrengthsAndGrowth(history, missionPerf, urgePct, streak) {
  const { win, mid, slip, total } = verdictDistribution(history);
  const strengths = [];
  const growth = [];

  if (total > 0 && win >= mid + slip) strengths.push("More wins than slip-ups this stretch");
  if (streak >= 7) strengths.push(`${streak}-day streak — consistency is holding`);
  if (urgePct >= 60) strengths.push(`Resisting ${urgePct}% of logged urges`);
  const bestMission = [...missionPerf].sort((a, b) => b.clean - (b.partial + b.slip) - (a.clean - (a.partial + a.slip)))[0];
  if (bestMission && bestMission.clean > bestMission.partial + bestMission.slip) strengths.push(`Strongest on "${bestMission.label}"`);

  if (total > 0 && slip > 0) growth.push(`${slip} slip${slip === 1 ? "" : "s"} logged — worth reviewing the trigger tags`);
  if (urgePct > 0 && urgePct < 60) growth.push(`Urge resistance sits at ${urgePct}% — room to build here`);
  const weakestMission = [...missionPerf].sort((a, b) => b.partial + b.slip - (a.partial + a.slip))[0];
  if (weakestMission && weakestMission.partial + weakestMission.slip > 0) growth.push(`"${weakestMission.label}" has the most slip-ups`);
  if (mid > win) growth.push("More 'mid' days than 'win' days recently");

  return {
    strengths: strengths.length ? strengths.slice(0, 4) : ["Log a few more check-ins to surface your strengths"],
    growth: growth.length ? growth.slice(0, 4) : ["No clear struggle pattern yet — keep checking in"],
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   JOURNAL — persistence + derived data
   ─────────────────────────────────────────────────────────────────────────
   New feature, so unlike Home/CheckIn/Plan/Progress/Coach there is no
   existing App.jsx logic to mirror. Follows the same conventions as the
   rest of the app: a `syn_*` localStorage key, soft-delete (never a hard
   remove unless the user explicitly confirms), and an id/createdAt/
   updatedAt shape consistent with syn_history/syn_trigger_log entries.

   Persistence: localStorage is the guaranteed, always-available layer
   (same as every other syn_* key SYNAPSE already relies on — it survives
   closing the browser and returning weeks later on the same device/
   profile). To make entries follow the *account* across devices the way
   checkins do, call syncJournalEntryToCloud(uid, entry) after each save —
   this extends the same Firebase project App.jsx already uses (imported
   fresh here, not duplicated) rather than inventing a separate backend.
   It's best-effort/non-blocking: if Firestore is unreachable, the local
   copy is already saved and nothing is lost.
──────────────────────────────────────────────────────────────────────── */
const JOURNAL_KEY = "syn_journal";

const uid4 = () => (crypto?.randomUUID ? crypto.randomUUID() : `j_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

export function computeWordStats(content = "") {
  const words = content.trim().length ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.round(words / 200));
  return { wordCount: words, readingTime };
}

export function readJournalEntries({ includeDeleted = false } = {}) {
  const all = safeParse(ls.get(JOURNAL_KEY, "[]"), []);
  const list = includeDeleted ? all : all.filter((e) => !e.deleted);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function writeAllEntries(list) {
  ls.set(JOURNAL_KEY, JSON.stringify(list));
}

/** Creates a full entry object with a stable id + stats, ready to save. */
export function makeJournalEntry({ title = "", content = "", mood = null, tags = [] }) {
  const now = new Date().toISOString();
  const { wordCount, readingTime } = computeWordStats(content);
  return {
    id: uid4(),
    title,
    content,
    createdAt: now,
    updatedAt: now,
    wordCount,
    readingTime,
    mood,
    tags,
    favorite: false,
    deleted: false,
  };
}

/** Upserts by id. Existing entries keep their createdAt; updatedAt + stats refresh. */
export function saveJournalEntry(entry) {
  const all = safeParse(ls.get(JOURNAL_KEY, "[]"), []);
  const { wordCount, readingTime } = computeWordStats(entry.content);
  const idx = all.findIndex((e) => e.id === entry.id);
  const now = new Date().toISOString();
  const next = { ...entry, wordCount, readingTime, updatedAt: now };
  if (idx === -1) {
    all.push({ createdAt: now, favorite: false, deleted: false, tags: [], mood: null, ...next });
  } else {
    all[idx] = { ...all[idx], ...next };
  }
  writeAllEntries(all);
  return next;
}

/** Soft-deletes by default (recoverable); pass hard:true only after explicit user confirmation. */
export function deleteJournalEntry(id, { hard = false } = {}) {
  const all = safeParse(ls.get(JOURNAL_KEY, "[]"), []);
  const next = hard ? all.filter((e) => e.id !== id) : all.map((e) => (e.id === id ? { ...e, deleted: true, updatedAt: new Date().toISOString() } : e));
  writeAllEntries(next);
  return next;
}

/** Best-effort cross-device mirror. Never blocks or throws into the caller. */
export async function syncJournalEntryToCloud(uid, entry) {
  if (!uid) return;
  try {
    const { db } = await import("../firebase");
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "users", uid, "journalEntries", entry.id), entry, { merge: true });
  } catch {
    // Offline / firestore unavailable — local copy already saved, nothing lost.
  }
}

// Separate from the recovery streak — consecutive days (ending today or
// yesterday, so a not-yet-written today doesn't zero it out) with at least
// one journal entry.
export function journalWritingStreak(entries) {
  if (entries.length === 0) return 0;
  const days = new Set(entries.map((e) => new Date(e.createdAt).toDateString()));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function journalMoodDistribution(entries) {
  const counts = {};
  entries.forEach((e) => {
    if (!e.mood) return;
    counts[e.mood] = (counts[e.mood] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([mood, count]) => ({ mood, count }))
    .sort((a, b) => b.count - a.count);
}

// Last N days, oldest -> newest; each day is either a real entry's
// {date, title, mood} or null if nothing was written that day.
export function journalMoodTimeline(entries, days = 14) {
  const byDate = new Map(entries.map((e) => [new Date(e.createdAt).toDateString(), e]));
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const entry = byDate.get(d.toDateString());
    out.push({
      date: d,
      isToday: i === 0,
      entry: entry ? { title: entry.title, mood: entry.mood, preview: entry.content.slice(0, 80) } : null,
    });
  }
  return out;
}

// Word-count depth buckets for the calendar's shading — a real derivation
// from the entry's own stats, not an invented "quality" score.
function depthBucket(wordCount) {
  if (!wordCount) return "none";
  if (wordCount < 60) return "short";
  if (wordCount < 200) return "deep";
  return "breakthrough";
}

/** Returns a full month grid (leading/trailing blanks included) for a calendar UI. */
export function journalCalendarMonth(entries, year, month) {
  const byDate = new Map(entries.map((e) => [new Date(e.createdAt).toDateString(), e]));
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const entry = byDate.get(date.toDateString());
    cells.push({
      day: d,
      date,
      isToday: date.toDateString() === new Date().toDateString(),
      entry: entry ? { title: entry.title, preview: entry.content.slice(0, 100), wordCount: entry.wordCount } : null,
      depth: entry ? depthBucket(entry.wordCount) : "none",
    });
  }
  return cells;
}

// Extracts real short first-person declarative lines from the user's own
// entries (patterns like "I survived...", "I chose...") as memory cards.
// Nothing here is generated — every quote is a verbatim substring of
// something the user actually wrote.
const MEMORY_PATTERNS = /\bI (survived|chose|resisted|kept|finally|stayed|held|refused|beat|overcame|proved|showed up)[^.!\n]{0,90}[.!]?/gi;

export function extractMemoryCards(entries, max = 6) {
  const cards = [];
  for (const e of entries) {
    const matches = e.content.match(MEMORY_PATTERNS);
    if (matches) {
      matches.forEach((m) => cards.push({ text: m.trim(), date: e.createdAt, entryId: e.id }));
    }
    if (cards.length >= max * 2) break;
  }
  return cards.slice(0, max);
}

// Every bullet is gated behind a real, checkable condition on the stored
// entries — no templated claim fires without the data to back it.
const INSIGHT_WATCHLIST = ["discipline", "urge", "craving", "streak", "proud", "tired", "stress", "grateful", "focus"];

export function generateGrowthInsights(entries) {
  const insights = [];
  const now = Date.now();
  const DAY = 864e5;
  const last7 = entries.filter((e) => now - new Date(e.createdAt).getTime() <= 7 * DAY);
  const prev7 = entries.filter((e) => {
    const age = now - new Date(e.createdAt).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  });

  if (last7.length >= 4) insights.push("You wrote consistently this week.");

  if (last7.length >= 3) {
    const avgRecent = last7.slice(0, 3).reduce((s, e) => s + e.wordCount, 0) / 3;
    const compare = entries.slice(3, 6);
    if (compare.length === 3) {
      const avgPrior = compare.reduce((s, e) => s + e.wordCount, 0) / 3;
      if (avgRecent > avgPrior * 1.15) insights.push("Your entries are becoming longer.");
    }
  }

  const hourCounts = entries.reduce((acc, e) => {
    const h = new Date(e.createdAt).getHours();
    acc[h >= 21 || h < 4 ? "late" : "other"] = (acc[h >= 21 || h < 4 ? "late" : "other"] || 0) + 1;
    return acc;
  }, {});
  if (entries.length >= 5 && (hourCounts.late || 0) > (hourCounts.other || 0)) {
    insights.push("Most of your reflections happen after 9 PM.");
  }

  if (last7.length >= 2 && prev7.length >= 2) {
    let bestWord = null;
    let bestDelta = 0;
    INSIGHT_WATCHLIST.forEach((word) => {
      const countIn = (list) => list.reduce((s, e) => s + (e.content.toLowerCase().split(word).length - 1), 0);
      const delta = countIn(last7) - countIn(prev7);
      if (delta > bestDelta) {
        bestDelta = delta;
        bestWord = word;
      }
    });
    if (bestWord && bestDelta >= 2) insights.push(`You mention "${bestWord}" more frequently than last week.`);
  }

  return insights.slice(0, 4);
}

// Aggregates real trigger tags across syn_trigger_log entries (the same
// log Check-In writes to). Urge sessions themselves don't record a
// trigger, so this reflects trigger patterns from check-ins rather than
// urge sessions specifically — an honest adaptation, not fabricated data.
export function triggerFrequency(triggerLog, max = 6) {
  const counts = {};
  triggerLog.forEach((entry) => {
    (entry.addictions || []).forEach((a) => {
      (a.triggers || []).forEach((t) => {
        const label = TRIGGERS.find((tr) => tr.id === t)?.label.replace(/^\S+\s/, "") || t;
        counts[label] = (counts[label] || 0) + 1;
      });
    });
  });
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

// Buckets real urge_log timestamps into 3-hour windows across the day.
export function peakUrgeHours(urgeLog) {
  const buckets = [
    { label: "12–4 AM", from: 0, to: 4, count: 0 },
    { label: "4–8 AM", from: 4, to: 8, count: 0 },
    { label: "8–12 PM", from: 8, to: 12, count: 0 },
    { label: "12–4 PM", from: 12, to: 16, count: 0 },
    { label: "4–8 PM", from: 16, to: 20, count: 0 },
    { label: "8–12 AM", from: 20, to: 24, count: 0 },
  ];
  urgeLog.forEach((u) => {
    const h = new Date(u.date).getHours();
    const b = buckets.find((x) => h >= x.from && h < x.to);
    if (b) b.count++;
  });
  const peak = [...buckets].sort((a, b) => b.count - a.count)[0];
  return { buckets, peak: peak?.count > 0 ? peak : null };
}

export function avgUrgeDuration(urgeLog) {
  if (!urgeLog || urgeLog.length === 0) return null;
  const avgSec = Math.round(urgeLog.reduce((s, u) => s + (u.duration || 0), 0) / urgeLog.length);
  const now = Date.now();
  const DAY = 864e5;
  const thisWeek = urgeLog.filter((u) => now - new Date(u.date).getTime() <= 7 * DAY);
  const lastWeek = urgeLog.filter((u) => {
    const age = now - new Date(u.date).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  });
  let deltaSec = null;
  if (thisWeek.length >= 2 && lastWeek.length >= 2) {
    const avgThis = thisWeek.reduce((s, u) => s + (u.duration || 0), 0) / thisWeek.length;
    const avgLast = lastWeek.reduce((s, u) => s + (u.duration || 0), 0) / lastWeek.length;
    deltaSec = Math.round(avgThis - avgLast);
  }
  return { avgSec, deltaSec };
}

// % of this week's logged urges that were survived — only returned once
// there's at least one this week, otherwise null (no fabricated 0%/—).
export function urgeDelaySuccessThisWeek(urgeLog) {
  const now = Date.now();
  const DAY = 864e5;
  const thisWeek = urgeLog.filter((u) => now - new Date(u.date).getTime() <= 7 * DAY);
  if (thisWeek.length === 0) return null;
  const survived = thisWeek.filter((u) => u.survived).length;
  return Math.round((survived / thisWeek.length) * 100);
}

// % of days since the user's first check-in that actually have a check-in.
// Real, bounded 0-100 — not a fabricated "consistency score".
export function reportConsistencyPct(history) {
  if (!history || history.length === 0) return 0;
  const oldest = new Date(history[history.length - 1].date);
  const daysSince = Math.max(1, Math.round((Date.now() - oldest.getTime()) / 864e5) + 1);
  return Math.min(100, Math.round((history.length / daysSince) * 100));
}

export function checkinSuccessRateThisWeek(history) {
  const now = Date.now();
  const thisWeek = history.filter((h) => now - new Date(h.date).getTime() <= 7 * 864e5);
  if (thisWeek.length === 0) return null;
  const win = thisWeek.filter((h) => h.status === "win").length;
  return Math.round((win / thisWeek.length) * 100);
}

// Real per-day status (1 clean / 0.5 partial / 0 slip) for one addiction,
// derived from check-in dates + syn_trigger_log (the same source
// missionPerformance() uses) — a genuine daily series, not smoothed/faked.
export function missionDailySeries(addictionId, history, triggerLog, days = 14) {
  const byDate = new Map();
  triggerLog.forEach((entry) => {
    const rec = (entry.addictions || []).find((a) => a.id === addictionId);
    if (rec) byDate.set(entry.date, rec.status);
  });
  const chronological = [...history].reverse().slice(-days);
  return chronological.map((h) => {
    const status = byDate.get(h.date);
    if (status === "slip") return 0;
    if (status === "partial") return 0.5;
    return 1; // no trigger_log entry that day for this mission = clean
  });
}

export function missionTrendLabel(series) {
  if (series.length < 4) return "New";
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const second = series.slice(mid).reduce((s, v) => s + v, 0) / (series.length - mid);
  if (second > first + 0.08) return "Improving";
  if (second < first - 0.08) return "Needs Work";
  return "Stable";
}

// Compares this month's check-in consistency to last month's — only
// returned once both months have at least one check-in to compare.
export function consistencyMonthOverMonth(history) {
  const now = new Date();
  const thisMonth = history.filter((h) => {
    const d = new Date(h.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = history.filter((h) => {
    const d = new Date(h.date);
    return d.getMonth() === lastMonthDate.getMonth() && d.getFullYear() === lastMonthDate.getFullYear();
  });
  if (thisMonth.length === 0 || lastMonth.length === 0) return null;
  const daysThis = now.getDate();
  const daysLast = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0).getDate();
  const pctThis = Math.round((thisMonth.length / daysThis) * 100);
  const pctLast = Math.round((lastMonth.length / daysLast) * 100);
  return { delta: pctThis - pctLast, pctThis, pctLast };
}

export function journalWeekOverWeekDelta(journalEntries) {
  const now = Date.now();
  const DAY = 864e5;
  const thisWeek = journalEntries.filter((e) => now - new Date(e.createdAt).getTime() <= 7 * DAY).length;
  const lastWeek = journalEntries.filter((e) => {
    const age = now - new Date(e.createdAt).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  }).length;
  if (thisWeek === 0 && lastWeek === 0) return null;
  return { thisWeek, lastWeek, delta: thisWeek - lastWeek };
}

// Merges real events from check-ins, urge log, and journal into one
// reverse-chronological feed — every line is a real logged event, quoted
// or summarized from the actual stored record, nothing generated.
export function recentVictories(history, urgeLog, journalEntries, max = 5) {
  const events = [];
  history
    .filter((h) => h.status === "win")
    .forEach((h) => events.push({ type: "checkin", date: h.date, title: "Clean Day", detail: h.msg ? h.msg.slice(0, 70) : "Stayed strong and followed the plan." }));
  urgeLog
    .filter((u) => u.survived)
    .forEach((u) => events.push({ type: "urge", date: u.date, title: "Urge Defeated", detail: u.intensity ? `${u.intensity.charAt(0)}${u.intensity.slice(1).toLowerCase()} urge, held the line.` : "Held the line." }));
  journalEntries.forEach((e) => events.push({ type: "journal", date: e.createdAt, title: "Journal Entry", detail: e.title || e.content.slice(0, 60) }));
  return events.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, max);
}

/* ─────────────────────────────────────────────────────────────────────────
   SETTINGS — tone, notifications, UI mode, privacy, export/reset
   ─────────────────────────────────────────────────────────────────────────
   Tone reuses App.jsx's exact syn_mode key/values — same tone Command
   Mode's Chat reads via getMode(). Notification toggles and the Focus/
   Command UI-mode preference are genuinely new (no equivalent exists
   anywhere in App.jsx), so they get their own syn_* keys, same convention
   as everything else. No notification *engine* is implemented — these are
   persistence only, per spec.
──────────────────────────────────────────────────────────────────────── */

// Mirrors App.jsx's MODES table exactly (id/label/icon/desc/accent) so the
// tone cards shown here are the literal same tones Chat uses — selecting
// one writes the same "syn_mode" key getMode() reads.
export const MODES = {
  operator: { id: "operator", label: "OPERATOR", icon: "🛡", desc: "Supportive & steady", accent: "#4ade80" },
  commander: { id: "commander", label: "COMMANDER", icon: "⚡", desc: "Balanced & battle-ready", accent: "#ff8c00" },
  warlord: { id: "warlord", label: "WARLORD", icon: "🔥", desc: "Brutal & unfiltered", accent: "#ef4444" },
};

export function getTone() {
  return MODES[ls.get("syn_mode", "commander")] || MODES.commander;
}

// Writes the exact same key App.jsx's switchMode() writes — the next AI
// Coach message (Command Mode or Focus Mode) picks this up immediately,
// since both read from the same getMode()/syn_mode source.
export function setTone(toneId) {
  if (!MODES[toneId]) return getTone();
  ls.set("syn_mode", toneId);
  return MODES[toneId];
}

const NOTIF_KEYS = {
  dailyMaster: "syn_notif_daily_master",
  morning: "syn_notif_morning",
  checkin: "syn_notif_checkin",
  journal: "syn_notif_journal",
  urge: "syn_notif_urge",
  weekly: "syn_notif_weekly",
  monthly: "syn_notif_monthly",
  milestones: "syn_notif_milestones",
  highRisk: "syn_notif_high_risk",
  silentMode: "syn_notif_silent",
  sound: "syn_notif_sound",
  vibration: "syn_notif_vibration",
  reminderTime: "syn_reminder_time",
  morningReminderTime: "syn_morning_reminder_time",
  timezone: "syn_timezone",
};

// Local cache read — instant, works offline. Firestore (below) is the
// cross-device source of truth per this feature's requirement; this stays
// as the fast local fallback shown before the cloud read resolves.
export function readNotificationPrefs() {
  return {
    dailyMaster: ls.get(NOTIF_KEYS.dailyMaster, "true") === "true",
    morning: ls.get(NOTIF_KEYS.morning, "true") === "true",
    checkin: ls.get(NOTIF_KEYS.checkin, "true") === "true",
    journal: ls.get(NOTIF_KEYS.journal, "true") === "true",
    urge: ls.get(NOTIF_KEYS.urge, "true") === "true",
    weekly: ls.get(NOTIF_KEYS.weekly, "true") === "true",
    monthly: ls.get(NOTIF_KEYS.monthly, "true") === "true",
    milestones: ls.get(NOTIF_KEYS.milestones, "true") === "true",
    highRisk: ls.get(NOTIF_KEYS.highRisk, "true") === "true",
    silentMode: ls.get(NOTIF_KEYS.silentMode, "false") === "true",
    sound: ls.get(NOTIF_KEYS.sound, "true") === "true",
    vibration: ls.get(NOTIF_KEYS.vibration, "true") === "true",
    reminderTime: ls.get(NOTIF_KEYS.reminderTime, "20:00"),
    morningReminderTime: ls.get(NOTIF_KEYS.morningReminderTime, "08:00"),
    timezone: ls.get(NOTIF_KEYS.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
  };
}

function writeLocalNotifCache(prefs) {
  ls.set(NOTIF_KEYS.dailyMaster, String(prefs.dailyMaster));
  ls.set(NOTIF_KEYS.morning, String(prefs.morning));
  ls.set(NOTIF_KEYS.checkin, String(prefs.checkin));
  ls.set(NOTIF_KEYS.journal, String(prefs.journal));
  ls.set(NOTIF_KEYS.urge, String(prefs.urge));
  ls.set(NOTIF_KEYS.weekly, String(prefs.weekly));
  ls.set(NOTIF_KEYS.monthly, String(prefs.monthly));
  ls.set(NOTIF_KEYS.milestones, String(prefs.milestones));
  ls.set(NOTIF_KEYS.highRisk, String(prefs.highRisk));
  ls.set(NOTIF_KEYS.silentMode, String(prefs.silentMode));
  ls.set(NOTIF_KEYS.sound, String(prefs.sound));
  ls.set(NOTIF_KEYS.vibration, String(prefs.vibration));
  ls.set(NOTIF_KEYS.reminderTime, prefs.reminderTime);
  ls.set(NOTIF_KEYS.morningReminderTime, prefs.morningReminderTime);
  ls.set(NOTIF_KEYS.timezone, prefs.timezone);
}

// Maps this app's local pref shape <-> the `notifications` map Cloud
// Functions read from users/{uid}.notifications (see functions/lib/eligibility.js).
// Sound/vibration are client-only presentation prefs — Cloud Functions
// never need them (FCM webpush notifications don't carry a sound/vibrate
// payload the browser Notifications API honors), so they're deliberately
// left out of the cloud shape rather than synced pointlessly.
function toCloudShape(prefs) {
  return {
    enabled: prefs.dailyMaster,
    morningReminder: prefs.morning,
    dailyCheckin: prefs.checkin,
    journalReminder: prefs.journal,
    urgeRescue: prefs.urge,
    weeklyReport: prefs.weekly,
    monthlyReport: prefs.monthly,
    streakMilestones: prefs.milestones,
    highRiskAlerts: prefs.highRisk,
    silentMode: prefs.silentMode,
    reminderTime: prefs.reminderTime,
    morningReminderTime: prefs.morningReminderTime,
    timezone: prefs.timezone,
  };
}
function fromCloudShape(notif) {
  return {
    dailyMaster: notif.enabled ?? true,
    morning: notif.morningReminder ?? true,
    checkin: notif.dailyCheckin ?? true,
    journal: notif.journalReminder ?? true,
    urge: notif.urgeRescue ?? true,
    weekly: notif.weeklyReport ?? true,
    monthly: notif.monthlyReport ?? true,
    milestones: notif.streakMilestones ?? true,
    highRisk: notif.highRiskAlerts ?? true,
    silentMode: notif.silentMode ?? false,
    sound: readNotificationPrefs().sound, // client-only — not part of cloud shape
    vibration: readNotificationPrefs().vibration, // client-only — not part of cloud shape
    reminderTime: notif.reminderTime || "20:00",
    morningReminderTime: notif.morningReminderTime || "08:00",
    timezone: notif.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

/**
 * Writes one changed preference to Firestore users/{uid}.notifications
 * (merged, not overwritten) and updates the local cache immediately.
 * Same users/{uid} document App.jsx's durableWrite() already writes
 * fcmToken/currentStreak to — no duplicate storage.
 */
export async function setNotificationPrefCloud(uid, key, value) {
  const current = readNotificationPrefs();
  const next = { ...current, [key]: value };
  writeLocalNotifCache(next);
  if (!uid) return { prefs: next, synced: true }; // no account — local is the only source of truth
  try {
    const { db } = await import("../firebase");
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "users", uid), { notifications: toCloudShape(next) }, { merge: true });
    return { prefs: next, synced: true };
  } catch {
    // Offline / write failed — local cache already updated (so the toggle
    // itself doesn't visually revert), but the caller should show a
    // "couldn't save" state and retry.
    return { prefs: next, synced: false };
  }
}

const SILENT_SNAPSHOT_KEY = "syn_notif_silent_snapshot";
const SILENCEABLE_KEYS = ["morning", "checkin", "journal", "urge", "weekly", "monthly", "milestones", "highRisk"];

/**
 * Turning Silent Mode ON snapshots the current per-type toggle states and
 * forces them all off (so no reminder fires while silenced). Turning it
 * OFF restores exactly the snapshot taken — never guesses or defaults
 * toggles back on that were already off before silencing.
 */
export async function toggleSilentMode(uid, enabling) {
  const current = readNotificationPrefs();
  if (enabling) {
    const snapshot = Object.fromEntries(SILENCEABLE_KEYS.map((k) => [k, current[k]]));
    ls.set(SILENT_SNAPSHOT_KEY, JSON.stringify(snapshot));
    const next = { ...current, silentMode: true, ...Object.fromEntries(SILENCEABLE_KEYS.map((k) => [k, false])) };
    writeLocalNotifCache(next);
    if (uid) {
      try {
        const { db } = await import("../firebase");
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(doc(db, "users", uid), { notifications: toCloudShape(next) }, { merge: true });
      } catch {}
    }
    return next;
  }
  // Disabling — restore exactly what was snapshotted, or leave as-is if
  // there's no snapshot (e.g. silent mode was toggled on another device).
  let snapshot = {};
  try {
    snapshot = JSON.parse(ls.get(SILENT_SNAPSHOT_KEY, "{}"));
  } catch {}
  const next = { ...current, silentMode: false, ...snapshot };
  writeLocalNotifCache(next);
  ls.remove(SILENT_SNAPSHOT_KEY);
  if (uid) {
    try {
      const { db } = await import("../firebase");
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "users", uid), { notifications: toCloudShape(next) }, { merge: true });
    } catch {}
  }
  return next;
}

/**
 * Subscribes to users/{uid}.notifications in real time, so a change made
 * on another device (or by a Cloud Function's idempotency stamps) shows
 * up here without a manual refresh. Returns an unsubscribe function.
 */
export function subscribeNotificationPrefs(uid, onChange) {
  if (!uid) {
    onChange(readNotificationPrefs());
    return () => {};
  }
  let unsub = () => {};
  (async () => {
    try {
      const { db } = await import("../firebase");
      const { doc, onSnapshot } = await import("firebase/firestore");
      unsub = onSnapshot(doc(db, "users", uid), (snap) => {
        const notif = snap.data()?.notifications;
        if (notif) {
          const prefs = fromCloudShape(notif);
          writeLocalNotifCache(prefs);
          onChange(prefs);
        } else {
          onChange(readNotificationPrefs());
        }
      });
    } catch {
      onChange(readNotificationPrefs());
    }
  })();
  return () => unsub();
}

// Focus Mode vs Command Mode UI preference. Distinct from App.jsx's real
// "syn_theme" (dark/light within Command Mode) — no existing key covers
// "which UI shell to show," so this is a new, narrowly-scoped one.
export function readUIMode() {
  return ls.get("syn_ui_mode", "focus");
}
export function setUIMode(mode) {
  ls.set("syn_ui_mode", mode === "command" ? "command" : "focus");
}

export function readPrivacyCounts() {
  let chatCount = 0;
  try {
    chatCount = safeParse(ls.get("syn_chat_history", "[]"), []).length;
  } catch {}
  const journalCount = readJournalEntries().length;
  const history = safeParse(ls.get("syn_history", "[]"), []);
  const urgeLog = safeParse(ls.get("syn_urge_log", "[]"), []);
  return {
    chatCount,
    journalCount,
    recoveryLogCount: history.length + urgeLog.length,
  };
}

// Real connection status per feature — "connected" only if real data
// exists for it, never a hardcoded true.
export function readConnectedFeatures() {
  const history = safeParse(ls.get("syn_history", "[]"), []);
  const urgeLog = safeParse(ls.get("syn_urge_log", "[]"), []);
  const chat = safeParse(ls.get("syn_chat_history", "[]"), []);
  const journal = readJournalEntries();
  const plan = ls.get("syn_plan", "");
  return {
    coach: chat.length > 0,
    journal: journal.length > 0,
    urge: urgeLog.length > 0,
    reports: history.length > 0,
    plan: !!plan,
  };
}

const RECOVERY_ONLY_KEYS = ["syn_streak", "syn_last", "syn_history", "syn_urge_log", "syn_trigger_log", "syn_plan", "syn_plan_history", "syn_milestones"];
// Deliberately NOT cleared: syn_user, syn_confess, syn_archetype,
// syn_journal, syn_chat_history, syn_mode, syn_theme, syn_ui_mode,
// syn_notif_*, syn_reminder_time, syn_timezone — account/profile,
// journal, chat, and preferences survive a recovery reset.
export function resetRecoveryProgress() {
  RECOVERY_ONLY_KEYS.forEach((k) => ls.remove(k));
}

// Bundles every real Synapse key (profile, journal, chat, check-ins,
// urges, missions, plan, settings) into one JSON file and triggers a
// browser download. No existing export utility exists in App.jsx to
// reuse, so this is new — but it's a data dump, not new business logic.
export function exportAllSynapseData() {
  const keys = [
    "syn_user", "syn_confess", "syn_archetype", "syn_streak", "syn_last", "syn_history",
    "syn_urge_log", "syn_trigger_log", "syn_plan", "syn_plan_history", "syn_milestones",
    "syn_chat_history", "syn_journal", "syn_mode", "syn_theme", "syn_ui_mode",
    NOTIF_KEYS.dailyMaster, NOTIF_KEYS.checkin, NOTIF_KEYS.journal, NOTIF_KEYS.urge, NOTIF_KEYS.weekly,
    NOTIF_KEYS.reminderTime, NOTIF_KEYS.timezone,
  ];
  const dump = {};
  keys.forEach((k) => {
    const raw = ls.get(k, null);
    if (raw === null) return;
    try {
      dump[k] = JSON.parse(raw);
    } catch {
      dump[k] = raw;
    }
  });
  dump._exportedAt = new Date().toISOString();

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Synapse-Recovery-Data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Composite 0-100 score blending three real, already-computed signals:
// check-in consistency, urge resistance, and phase progress. Documented as
// a derived composite (not a claimed "AI score") — weights are fixed and
// simple (equal thirds) so it stays honestly explainable.
export function recoveryScore(consistencyPct, urgePct, xpPct) {
  const parts = [consistencyPct, urgePct, xpPct].filter((v) => v != null);
  if (parts.length === 0) return 0;
  return Math.round(parts.reduce((s, v) => s + v, 0) / parts.length);
}

// Mission "discipline" — the aggregate clean-day rate across all tracked
// missions (real, from missionPerformance's own clean/partial/slip counts).
export function disciplineScore(missionPerf) {
  if (!missionPerf || missionPerf.length === 0) return null;
  const totalClean = missionPerf.reduce((s, m) => s + m.clean, 0);
  const totalAll = missionPerf.reduce((s, m) => s + m.clean + m.partial + m.slip, 0);
  if (totalAll === 0) return null;
  return Math.round((totalClean / totalAll) * 100);
}

// Splits real check-in history into calendar weeks (most recent last),
// each with real counts — no fabricated week data.
export function weeklySummaryBreakdown(history, weeksBack = 4) {
  const now = new Date();
  const weeks = [];
  for (let w = weeksBack - 1; w >= 0; w--) {
    const start = new Date(now);
    start.setDate(now.getDate() - w * 7 - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(now.getDate() - w * 7);
    end.setHours(23, 59, 59, 999);
    const entries = history.filter((h) => {
      const d = new Date(h.date);
      return d >= start && d <= end;
    });
    const wins = entries.filter((h) => h.status === "win").length;
    const slips = entries.filter((h) => h.status === "slip").length;
    const streakEnd = entries.length > 0 ? entries[0].streak ?? null : null;
    weeks.push({
      label: `Week ${weeksBack - w}`,
      checkins: entries.length,
      wins,
      slips,
      streak: streakEnd,
    });
  }
  return weeks;
}

// Average streak "run" length across the real history, and how many days
// since the first check-in had no check-in at all — both derived purely
// from stored dates/streak values.
export function streakRunStats(history, currentStreak) {
  if (history.length === 0) return { average: currentStreak || 0, missedDays: 0 };
  const runs = [];
  let run = 0;
  [...history].reverse().forEach((h) => {
    if (h.status === "slip") {
      if (run > 0) runs.push(run);
      run = 0;
    } else {
      run++;
    }
  });
  if (run > 0) runs.push(run);
  const average = runs.length > 0 ? Math.round(runs.reduce((s, r) => s + r, 0) / runs.length) : currentStreak || 0;

  const oldest = new Date(history[history.length - 1].date);
  const daysSince = Math.max(1, Math.round((Date.now() - oldest.getTime()) / 864e5) + 1);
  const missedDays = Math.max(0, daysSince - history.length);
  return { average, missedDays };
}

// Longest and current consecutive-clean-day run for one mission, derived
// from the same real daily series missionDailySeries() already builds.
export function missionRunStats(series) {
  let longest = 0;
  let run = 0;
  series.forEach((v) => {
    if (v === 1) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  });
  let current = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] === 1) current++;
    else break;
  }
  return { longest, current };
}

// Real weekday breakdown of logged urges (0=Sun..6=Sat), plus which single
// day has the most — returns null if there's nothing logged.
export function urgePeakWeekday(urgeLog) {
  if (!urgeLog || urgeLog.length === 0) return null;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const counts = new Array(7).fill(0);
  urgeLog.forEach((u) => counts[new Date(u.date).getDay()]++);
  const max = Math.max(...counts);
  if (max === 0) return null;
  return names[counts.indexOf(max)];
}

// Achievement unlock state — every condition is a real, checkable
// threshold against the user's own stored data. Never unlocked by default.
export function computeAchievements({ history, streak, longest, urgeLog, consistencyPct }) {
  const anyWin = history.some((h) => h.status === "win");
  return [
    { id: "first_win", icon: "🔥", label: "First Win", desc: "Log your first WIN check-in", unlocked: anyWin },
    { id: "week_defender", icon: "🛡️", label: "Week Defender", desc: "Reach a 7-day streak", unlocked: streak >= 7 || longest >= 7 },
    { id: "consistency", icon: "⚡", label: "Consistency", desc: "70%+ check-in consistency", unlocked: consistencyPct >= 70 },
    { id: "urge_slayer", icon: "🛡️", label: "Urge Slayer", desc: "Survive 10 urges", unlocked: (urgeLog?.filter((u) => u.survived).length || 0) >= 10 },
    { id: "thirty_day_king", icon: "👑", label: "30 Day King", desc: "Reach a 30-day streak", unlocked: streak >= 30 || longest >= 30 },
  ];
}

/**
 * Reads every piece of state Focus Mode's Home screen needs, straight from
 * the same localStorage keys App.jsx maintains. No new fields are invented;
 * anything not tracked by the app today (e.g. "focus time") is simply not
 * returned here.
 */
export function readSynapseSnapshot() {
  const streak = parseInt(ls.get("syn_streak", "0"), 10) || 0;
  const lastCheckin = ls.get("syn_last", null);
  const history = safeParse(ls.get("syn_history", "[]"), []); // [{date,msg,streak,status}]
  const urgeLog = safeParse(ls.get("syn_urge_log", "[]"), []); // [{date,intensity,survived,duration}]
  const confess = safeParse(ls.get("syn_confess", "null"), null);
  const addictions = confess?.addictions || []; // [{id,label,emoji,color,value,isFreq}]
  const user = safeParse(ls.get("syn_user", "{}"), {});
  const savedPlan = ls.get("syn_plan", "");

  const level = getLevel(streak);
  const nextLevel = getNextLevel(streak);
  const xpPct = nextLevel
    ? Math.min(100, ((streak - level.minDays) / (nextLevel.minDays - level.minDays)) * 100)
    : 100;
  const daysToNext = nextLevel ? Math.max(0, nextLevel.minDays - streak) : 0;

  const today = new Date().toDateString();
  const checkedInToday = lastCheckin === today;
  const todayEntry = history.find((h) => h.date === today) || null;

  const urgesManaged = urgeLog.filter((u) => u.survived).length;
  const checkinsCount = history.length;

  // Last 7 check-in days, oldest first, for a weekly trend line.
  const weekly = [...history].slice(0, 7).reverse();

  const recentCheckin = history[0] || null;

  return {
    name: user?.name || "",
    streak,
    lastCheckin,
    checkedInToday,
    history,
    weekly,
    recentCheckin,
    todayEntry,
    urgeLog,
    addictions,
    savedPlan,
    level,
    nextLevel,
    xpPct,
    daysToNext,
    quote: getDailyQuote(),
    stats: {
      urgesManaged,
      checkinsCount,
      activeMissions: addictions.length,
    },
  };
} 