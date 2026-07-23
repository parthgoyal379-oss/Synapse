import { useEffect, useState } from "react";
import { callAI } from "./aiClient";

/* ─── SMART STREAK RECOVERY — SHARED ENGINE ──────────────────────────────
   Replaces "streak = 0 on slip, everything lost" with a non-binary model:
   Recovery Integrity (persistent, decays gradually), Recovery Momentum
   (categorical state), Recovery Memory (lifetime totals that never
   shrink), an Emergency Recovery Mission on slip, and an AI relapse
   analysis — all computed from `syn_history` / `syn_urge_log`, the SAME
   fields every other feature (Command Mode's Checkin, the Notification
   Engine, Recovery Score) already reads and writes. There is exactly ONE
   copy of every formula and every AI prompt in this file — Command Mode
   and Focus Mode both call the same exported functions/hook below and
   only differ in how they render the returned data. ─────────────────── */

const ls = {
  get: (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, val) => { try { localStorage.setItem(key, val); } catch { /* storage unavailable — non-fatal */ } },
};

// Recovery Integrity: an exponential moving average of a per-day "how
// clean was this day" score, walked chronologically over the FULL history
// (which is never deleted). A single slip after a long clean run pulls the
// average down by only a fraction (alpha) of the gap — not to zero — and
// pulls further with each additional slip. This is what makes it "slowly
// increases, slips reduce it, repeated slips reduce it more, never resets
// instantly" — it's just an EMA, not a special-cased streak counter.
const INTEGRITY_ALPHA = 0.12;
const INTEGRITY_DAY_SCORE = { win: 100, mid: 65, slip: 15 };
const INTEGRITY_SLIP_SCORE_MISSION_COMPLETE = 40; // reduced penalty if the Emergency Mission was completed for that slip day

export function computeRecoveryIntegrity(history, emergencyMissions) {
  const chronological = [...history].reverse(); // history is stored newest-first
  let integrity = 50; // neutral seed for a brand-new account
  const trace = [];
  for (const entry of chronological) {
    let dayScore = INTEGRITY_DAY_SCORE[entry.status] ?? INTEGRITY_DAY_SCORE.mid;
    if (entry.status === "slip" && emergencyMissions?.[entry.date]?.completed) {
      dayScore = INTEGRITY_SLIP_SCORE_MISSION_COMPLETE; // mission done → penalty reduced, not erased
    }
    integrity = integrity + INTEGRITY_ALPHA * (dayScore - integrity);
    trace.push({ date: entry.date, status: entry.status, integrity: Math.round(integrity) });
  }
  return { integrity: Math.max(0, Math.min(100, Math.round(integrity))), trace };
}

// Recovery Memory: totals that only ever grow. Both are pure reads of the
// existing history array — no separate counter to keep in sync.
export function computeLifetimeCleanDays(history) {
  return history.filter((h) => h.status !== "slip").length;
}
export function computePreviousBestStreak(history, currentStreak) {
  const best = history.reduce((max, h) => Math.max(max, h.streak || 0), 0);
  return Math.max(best, currentStreak || 0);
}

// Recovery Momentum: a categorical read of the same signals Recovery
// Score and the notification engine already use — streak, recent slips,
// urge activity, and integrity — collapsed into one word so the
// dashboard can say something a raw number can't. Identical thresholds
// regardless of which theme is asking.
export function computeRecoveryMomentum({ integrity, streak, history, urgeLog }) {
  const recent = history.slice(0, 5);
  const recentSlips = recent.filter((h) => h.status === "slip").length;
  const today = new Date().toDateString();
  const urgesToday = (urgeLog || []).filter((u) => { try { return new Date(u.date).toDateString() === today; } catch { return false; } }).length;

  if (recentSlips >= 1 && integrity < 45) return "Critical";
  if (recentSlips >= 1 && integrity >= 45) return "Recovering"; // slipped recently but the trend since is holding
  if (urgesToday >= 3 && streak <= 2) return "Critical";
  if (streak >= 30 && integrity >= 85) return "Strong";
  if (streak >= 7 && integrity >= 70) return "Stable";
  return "Building";
}

// Presentation hint only — Command Mode uses this as-is (tactical reds/
// oranges/blues); Focus Mode maps the SAME momentum word to its own calm
// palette in its own component. The underlying word is identical.
export const MOMENTUM_RGB = { Critical: "255,70,70", Recovering: "255,140,0", Building: "70,140,255", Stable: "0,210,220", Strong: "0,200,120" };

// Timeline: derives named milestones from data the app already has —
// nothing here is a separate write, all reconstructed from `history` (and
// its integrity trace) on every read.
export function buildRecoveryTimeline(history, trace, previousBest) {
  const chronological = [...history].reverse();
  const events = [];

  const firstVictory = chronological.find((h) => h.status !== "slip");
  if (firstVictory) events.push({ label: "First Victory", date: firstVictory.date });

  const firstWeek = chronological.find((h) => (h.streak || 0) >= 7);
  if (firstWeek) events.push({ label: "First Week", date: firstWeek.date });

  const relapses = chronological.filter((h) => h.status === "slip");
  const lastRelapse = relapses[relapses.length - 1];
  if (lastRelapse) events.push({ label: "Relapse", date: lastRelapse.date, marker: "slip" });

  if (lastRelapse) {
    const idx = chronological.indexOf(lastRelapse);
    const comeback = chronological[idx + 1];
    if (comeback) events.push({ label: "Comeback", date: comeback.date });
  }

  if (previousBest >= 30) {
    const day30 = chronological.find((h) => (h.streak || 0) >= 30);
    if (day30) events.push({ label: "Day 30", date: day30.date });
  }

  if (lastRelapse) {
    const lastRelapseTraceIdx = trace.findIndex((t) => t.date === lastRelapse.date);
    const restored = trace.slice(lastRelapseTraceIdx + 1).find((t) => t.integrity >= 85);
    if (restored) events.push({ label: "Integrity Restored", date: restored.date });
  }

  return events;
}

// ── Emergency Recovery Mission ───────────────────────────────────────────
// Generated once per slip day (cached, never regenerated), 3 short AI
// tasks. Completing all 3 within 24h reduces (not erases) that day's
// integrity penalty. Same storage key, same prompt, same cache regardless
// of theme — a mission generated while in Focus Mode is the SAME mission
// seen if the user switches to Command Mode that day, and vice versa.
export const SYSTEM_EMERGENCY_MISSION = `You are SYNAPSE — an AI recovery coach. The user just logged a slip in their addiction recovery. Generate exactly 3 short, concrete, physically-groundable actions they can do in the next 24 hours to regain stability — never shaming, never generic ("stay strong"), just practical resets (e.g. hydration, movement, leaving the environment, breathing, brief journaling). Respond as a JSON array of exactly 3 short strings, each under 8 words, nothing else — no markdown, no preamble.`;

function loadEmergencyMissions() { try { return JSON.parse(ls.get("syn_emergency_missions", "{}")); } catch { return {}; } }
function saveEmergencyMissions(m) { ls.set("syn_emergency_missions", JSON.stringify(m)); }

export async function generateEmergencyMission(dateKey, toneAddon = "") {
  const missions = loadEmergencyMissions();
  if (missions[dateKey]) return missions[dateKey]; // already generated for this slip day — never regenerate

  let tasks;
  try {
    const raw = await callAI(
      [{ role: "user", content: `Generate the 3-task emergency recovery mission now (date: ${dateKey}).` }],
      SYSTEM_EMERGENCY_MISSION + toneAddon,
      { timeoutMs: 10000, max_tokens: 120 },
    );
    const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || "null");
    if (Array.isArray(parsed) && parsed.length >= 3) tasks = parsed.slice(0, 3);
  } catch { tasks = null; }
  if (!tasks) tasks = ["Drink a full glass of water", "Leave the room you're in", "Take a 10-minute walk"]; // handcrafted fallback

  const mission = { tasks: tasks.map((t, i) => ({ id: String(i), text: t, done: false })), generatedAt: Date.now(), completed: false };
  missions[dateKey] = mission;
  saveEmergencyMissions(missions);
  return mission;
}

export function toggleEmergencyTask(dateKey, taskId) {
  const missions = loadEmergencyMissions();
  const mission = missions[dateKey];
  if (!mission) return null;
  mission.tasks = mission.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
  mission.completed = mission.tasks.every((t) => t.done);
  missions[dateKey] = mission;
  saveEmergencyMissions(missions);
  return mission;
}

// ── AI Recovery Analysis ─────────────────────────────────────────────────
// One short, non-generic analysis per relapse day — cached, never
// regenerated, same for both themes.
export const SYSTEM_RELAPSE_ANALYSIS = `You are SYNAPSE — an AI recovery coach analysing a user's slip using their real recent history. Write 3 short parts, plainly labeled: "What happened:", "Pattern:", "Next step:" — each 1 sentence, factual, supportive, professional, scientific. Never say "it's okay" or "don't worry." Never shame. Plain text, no markdown.`;

function loadRelapseAnalyses() { try { return JSON.parse(ls.get("syn_relapse_analysis", "{}")); } catch { return {}; } }
function saveRelapseAnalyses(a) { ls.set("syn_relapse_analysis", JSON.stringify(a)); }

export async function generateRelapseAnalysis(dateKey, context, toneAddon = "") {
  const cache = loadRelapseAnalyses();
  if (cache[dateKey]) return cache[dateKey];

  const { recentSlips, streakBeforeSlip, lifetimeCleanDays } = context;
  const prompt = `Recent slips (last 5 check-ins): ${recentSlips}\nStreak before this slip: ${streakBeforeSlip} days\nLifetime clean days: ${lifetimeCleanDays}\n\nWrite the analysis now.`;
  let text;
  try {
    const raw = await callAI([{ role: "user", content: prompt }], SYSTEM_RELAPSE_ANALYSIS + toneAddon, { timeoutMs: 10000, max_tokens: 180 });
    if (raw && raw.trim()) text = raw.trim();
  } catch { text = null; }
  if (!text) text = `What happened: A slip was logged after ${streakBeforeSlip} days.\nPattern: ${recentSlips > 1 ? "Multiple recent slips suggest the current routine needs adjustment." : "This is an isolated event against a longer clean history."}\nNext step: Complete today's Emergency Recovery Mission and check in again tomorrow.`;

  cache[dateKey] = text;
  saveRelapseAnalyses(cache);
  return text;
}

/**
 * useSmartStreakRecovery({streak, toneAddon}) — computes everything above
 * from the existing syn_history/syn_urge_log, and (only when today's
 * entry is an unhandled slip) triggers the one-time Emergency Mission + AI
 * analysis generation for that day.
 *
 * `toneAddon` is the ONLY theme-specific input this hook accepts, and it
 * only changes AI phrasing tone (e.g. Command Mode's tactical tone vs
 * Focus Mode's calmer tone) — never the math, never which fields are read
 * or written. Pass "" for a neutral default. Both themes call this exact
 * hook; neither re-implements any of the calculations above.
 */
export function useSmartStreakRecovery({ streak, toneAddon = "" }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      let history, urgeLog;
      try { history = JSON.parse(ls.get("syn_history", "[]")); } catch { history = []; }
      try { urgeLog = JSON.parse(ls.get("syn_urge_log", "[]")); } catch { urgeLog = []; }

      const missions = loadEmergencyMissions();
      const { integrity, trace } = computeRecoveryIntegrity(history, missions);
      const lifetimeCleanDays = computeLifetimeCleanDays(history);
      const previousBest = computePreviousBestStreak(history, streak);
      const momentum = computeRecoveryMomentum({ integrity, streak, history, urgeLog });
      const timeline = buildRecoveryTimeline(history, trace, previousBest);

      const todayEntry = history[0]?.date === new Date().toDateString() ? history[0] : null;
      const isSlipToday = todayEntry?.status === "slip";

      let mission = isSlipToday ? missions[todayEntry.date] : null;
      let analysis = null;
      if (isSlipToday) {
        if (!mission) mission = await generateEmergencyMission(todayEntry.date, toneAddon);
        const recentSlips = history.slice(0, 5).filter((h) => h.status === "slip").length;
        analysis = await generateRelapseAnalysis(todayEntry.date, {
          recentSlips, streakBeforeSlip: previousBest, lifetimeCleanDays,
        }, toneAddon);
      }

      if (cancelled) return;
      setData({
        integrity, momentum, lifetimeCleanDays, previousBest, timeline,
        isSlipToday, mission, analysis, todayDate: todayEntry?.date || null,
      });
    });
    return () => { cancelled = true; };
  }, [streak, toneAddon]);
  return data;
}
