/**
 * messageGenerator.js — the ONE place every notification's copy comes from.
 * Reads the same three tone ids ("operator" | "commander" | "warlord") the
 * client already stores on users/{uid}.tone and maps each to a short,
 * notification-appropriate voice. Not a duplicate AI prompt system — a
 * small reusable template function.
 */

const VOICE = {
  operator: {
    morning: "Today's battle starts now. One disciplined decision changes everything.",
    checkin: "You've made it this far. Let's protect today's progress.",
    missed: "It's not too late. One honest check-in keeps the streak alive.",
    journal: "Small reflections create big changes.",
    urge: "Open Rescue Mode before acting. You don't have to do this alone.",
    rescueDone: "Your rescue session is complete. That took real strength.",
    milestone: (d) => `${d} days. You've made it this far — let's protect it.`,
    streakProtection: (d) => `Protect your ${d}-day streak. One check-in keeps it alive.`,
    weekly: "Here's your week. Look how far you've come.",
    monthly: "A full month of data. See the shape of your progress.",
    highRisk: "Rough moment? You've survived every one so far. Open Rescue Mode.",
  },
  commander: {
    morning: "Today's mission starts now. First objective: one disciplined decision.",
    checkin: "Today's mission isn't complete. Finish your check-in.",
    missed: "Mission incomplete. Close it out before the day ends.",
    journal: "Capture today's thoughts. Small reflections create big changes.",
    urge: "Strong urge? Open Rescue Mode before acting.",
    rescueDone: "Your rescue session is complete. Mission held.",
    milestone: (d) => `Day ${d}. Mission accomplished — the next objective starts now.`,
    streakProtection: (d) => `${d}-day streak on the line. Check in and hold the position.`,
    weekly: "Your weekly recovery report is ready. Review it.",
    monthly: "Your monthly recovery report is ready. Full debrief inside.",
    highRisk: "Conditions are hard right now. Execute the rescue protocol.",
  },
  warlord: {
    morning: "Discipline isn't optional. The day starts now.",
    checkin: "Discipline isn't optional. Open SYNAPSE.",
    missed: "You still haven't checked in. No excuses — do it now.",
    journal: "Write it down. Weakness hides in silence.",
    urge: "Strong urge? Prove it doesn't own you. Open Rescue Mode.",
    rescueDone: "Rescue complete. You didn't break.",
    milestone: (d) => `${d} days. Most people quit. You didn't.`,
    streakProtection: (d) => `${d} days built. Don't let one skipped day erase it.`,
    weekly: "Your week, unfiltered. See what you actually did.",
    monthly: "Your month, unfiltered. No excuses in the data.",
    highRisk: "This is the moment that decides the streak. Don't break now.",
  },
};

const TITLES = {
  morning: "Your brain rewires one day at a time.",
  checkin: "Your brain rewires one day at a time.",
  missed: "Still time to show up today.",
  journal: "Capture today's thoughts.",
  urge: "Strong urge?",
  rescueDone: "Rescue session complete.",
  milestone: (d) => `${d}-Day Milestone 🔥`,
  streakProtection: (d) => `Protect your ${d}-day streak`,
  weekly: "Your weekly recovery report is ready.",
  monthly: "Your monthly recovery report is ready.",
  highRisk: "SYNAPSE noticed something.",
};

const DEEP_LINKS = {
  morning: "/checkin",
  checkin: "/checkin",
  missed: "/checkin",
  journal: "/journal",
  urge: "/urgelog",
  rescueDone: "/urgelog",
  milestone: "/progress",
  streakProtection: "/checkin",
  weekly: "/report",
  monthly: "/report",
  highRisk: "/urgelog",
};

// Only files that actually exist in public/ — do not reference /icons/*.
const ICON = "/icon-192.png";
const BADGE = "/icon-192.png";

function safeTone(tone) {
  return VOICE[tone] ? tone : "commander";
}

/**
 * buildNotification(type, tone, data?) -> { title, body, deepLink, icon, badge, clickAction }
 * type: "morning" | "checkin" | "missed" | "journal" | "urge" | "rescueDone" |
 *       "milestone" | "streakProtection" | "weekly" | "monthly" | "highRisk"
 * For "highRisk", `data.body` (AI-generated, pre-fetched by the caller) is
 * used verbatim if provided — this function only supplies the fallback.
 */
function buildNotification(type, tone, data = {}) {
  const t = safeTone(tone);
  const voice = VOICE[t];
  const titleSrc = TITLES[type];
  const title = typeof titleSrc === "function" ? titleSrc(data.days) : titleSrc;
  const bodySrc = voice[type];
  const fallbackBody = typeof bodySrc === "function" ? bodySrc(data.days) : bodySrc;
  const body = data.body || fallbackBody;

  return {
    title,
    body,
    deepLink: DEEP_LINKS[type] || "/",
    icon: ICON,
    badge: BADGE,
    clickAction: DEEP_LINKS[type] || "/",
  };
}

function buildWeeklySummaryBody(tone, stats) {
  const t = safeTone(tone);
  const base = VOICE[t].weekly;
  const parts = [];
  if (stats.checkins != null) parts.push(`${stats.checkins} check-ins`);
  if (stats.currentStreak != null) parts.push(`${stats.currentStreak}-day streak`);
  if (stats.urgeResistancePct != null) parts.push(`${stats.urgeResistancePct}% urge resistance`);
  if (stats.journalEntries != null) parts.push(`${stats.journalEntries} journal entries`);
  return `${base} ${parts.join(" · ")}`.trim();
}

function buildMonthlySummaryBody(tone, stats) {
  const t = safeTone(tone);
  const base = VOICE[t].monthly;
  const parts = [];
  if (stats.checkins != null) parts.push(`${stats.checkins} check-ins`);
  if (stats.wins != null) parts.push(`${stats.wins} wins`);
  if (stats.currentStreak != null) parts.push(`${stats.currentStreak}-day streak`);
  if (stats.urgeResistancePct != null) parts.push(`${stats.urgeResistancePct}% urge resistance`);
  return `${base} ${parts.join(" · ")}`.trim();
}

// Fallback-only text for highRisk, used if the AI call fails/times out.
function highRiskFallback(tone) {
  return VOICE[safeTone(tone)].highRisk;
}

module.exports = { buildNotification, buildWeeklySummaryBody, buildMonthlySummaryBody, highRiskFallback, safeTone };
