/**
 * messageGenerator.js
 * ────────────────────────────────────────────────────────────────────────
 * The ONE place every notification's copy comes from. Cloud Functions run
 * in Node, a separate runtime from the React bundle, so App.jsx's actual
 * tone prompt strings (SYSTEM_CHAT + toneAddon, used for AI chat) can't be
 * imported directly — but the *tone identity* is not redefined here, only
 * mirrored: this reads the same three ids ("operator" | "commander" |
 * "warlord") the client already stores, and maps each to a short
 * notification-appropriate voice. This is not a duplicate AI prompt
 * system — it's a small, single, reusable template function, matching
 * the "reusable notification message generator" requirement instead of
 * hardcoding dozens of strings inline in each function.
 */

const VOICE = {
  operator: {
    checkin: "You've made it this far. Let's protect today's progress.",
    missed: "It's not too late. One honest check-in keeps the streak alive.",
    journal: "Small reflections create big changes.",
    urge: "Open Rescue Mode before acting. You don't have to do this alone.",
    rescueDone: "Your rescue session is complete. That took real strength.",
    milestone: (d) => `${d} days. You've made it this far — let's protect it.`,
    weekly: "Here's your week. Look how far you've come.",
  },
  commander: {
    checkin: "Today's mission isn't complete. Finish your check-in.",
    missed: "Mission incomplete. Close it out before the day ends.",
    journal: "Capture today's thoughts. Small reflections create big changes.",
    urge: "Strong urge? Open Rescue Mode before acting.",
    rescueDone: "Your rescue session is complete. Mission held.",
    milestone: (d) => `Day ${d}. Mission accomplished — the next objective starts now.`,
    weekly: "Your weekly recovery report is ready. Review it.",
  },
  warlord: {
    checkin: "Discipline isn't optional. Open SYNAPSE.",
    missed: "You still haven't checked in. No excuses — do it now.",
    journal: "Write it down. Weakness hides in silence.",
    urge: "Strong urge? Prove it doesn't own you. Open Rescue Mode.",
    rescueDone: "Rescue complete. You didn't break.",
    milestone: (d) => `${d} days. Most people quit. You didn't.`,
    weekly: "Your week, unfiltered. See what you actually did.",
  },
};

const TITLES = {
  checkin: "Your brain rewires one day at a time.",
  missed: "Still time to show up today.",
  journal: "Capture today's thoughts.",
  urge: "Strong urge?",
  rescueDone: "Rescue session complete.",
  milestone: (d) => `${d}-Day Milestone 🔥`,
  weekly: "Your weekly recovery report is ready.",
};

const DEEP_LINKS = {
  checkin: "/checkin",
  missed: "/checkin",
  journal: "/journal",
  urge: "/urgelog",
  rescueDone: "/urgelog",
  milestone: "/progress",
  weekly: "/report",
};

function safeTone(tone) {
  return VOICE[tone] ? tone : "commander";
}

/**
 * buildNotification(type, tone, data?) -> { title, body, deepLink, icon, badge, clickAction }
 * type: "checkin" | "missed" | "journal" | "urge" | "rescueDone" | "milestone" | "weekly"
 */
function buildNotification(type, tone, data = {}) {
  const t = safeTone(tone);
  const voice = VOICE[t];
  const titleSrc = TITLES[type];
  const title = typeof titleSrc === "function" ? titleSrc(data.days) : titleSrc;
  const bodySrc = voice[type];
  const body = typeof bodySrc === "function" ? bodySrc(data.days) : bodySrc;

  return {
    title,
    body,
    deepLink: DEEP_LINKS[type] || "/",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
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

module.exports = { buildNotification, buildWeeklySummaryBody, safeTone };