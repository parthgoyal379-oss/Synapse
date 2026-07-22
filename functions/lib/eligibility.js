/**
 * eligibility.js — the ONE place every "should this user get notified right
 * now" rule lives. Every scheduled/triggered function calls isEligible()
 * before sendPush() so no individual function has to re-implement quiet
 * hours, cooldowns, or per-type toggles.
 */

const QUIET_HOURS_START = 22; // 10 PM local — never send at/after this
const QUIET_HOURS_END = 7;    // 7 AM local — never send before this
const GLOBAL_COOLDOWN_MS = 30 * 60 * 1000; // never two notifications within 30 min, any type

const TOGGLE_KEY = {
  morning: "morningReminder",
  checkin: "dailyCheckin",
  missed: "dailyCheckin",
  journal: "journalReminder",
  urge: "urgeRescue",
  rescueDone: "urgeRescue",
  milestone: "streakMilestones",
  streakProtection: "streakMilestones",
  highRisk: "highRiskAlerts",
  weekly: "weeklyReport",
  monthly: "monthlyReport",
};

/** Today's date string in the user's own timezone (YYYY-MM-DD). */
function todayInTimezone(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }
}

/** Current local hour (0-23) in the user's timezone. */
function localHour(timezone) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", hour: "2-digit", hour12: false }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

function hasCheckedInToday(user) {
  if (!user.lastCheckin) return false;
  const tz = user.notifications?.timezone || "UTC";
  const today = todayInTimezone(tz);
  const lastCheckinDate = new Date(user.lastCheckin);
  const lastCheckinNormalized = isNaN(lastCheckinDate) ? user.lastCheckin : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(lastCheckinDate);
  return lastCheckinNormalized === today;
}

/**
 * isEligible(user, type) — true only if this user should receive this
 * notification type right now. Applies, in order: has a device, master
 * toggle, silent mode, per-type toggle, quiet hours, global 30-min cooldown.
 */
function isEligible(user, type) {
  if (!user) return false; // account deleted / doesn't exist
  if (!user.fcmToken) return false; // no device to reach

  const notif = user.notifications || {};
  if (notif.enabled === false) return false; // master toggle off
  if (notif.silentMode === true) return false; // silent mode active

  const toggleKey = TOGGLE_KEY[type];
  if (toggleKey && notif[toggleKey] === false) return false;

  const tz = notif.timezone || "UTC";
  const hour = localHour(tz);
  if (hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END) return false; // quiet hours

  const lastSentAt = notif.lastSentAt || 0;
  if (Date.now() - lastSentAt < GLOBAL_COOLDOWN_MS) return false; // global cooldown, any type

  return true;
}

module.exports = { isEligible, todayInTimezone, localHour, hasCheckedInToday, QUIET_HOURS_START, QUIET_HOURS_END, GLOBAL_COOLDOWN_MS };
