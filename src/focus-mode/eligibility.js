/**
 * isEligible(user, type) — true only if this user should receive this
 * notification type right now. Every scheduled/triggered function calls
 * this before sendPush() so the "never notify if..." rules live in one
 * place.
 */
function isEligible(user, type) {
  if (!user) return false; // account deleted / doesn't exist
  if (!user.fcmToken) return false; // no device to reach — effectively signed out everywhere
  const notif = user.notifications || {};
  if (notif.enabled === false) return false; // master toggle off
  if (notif.silentMode === true) return false; // silent mode active

  const toggleKey = {
    checkin: "dailyCheckin",
    missed: "dailyCheckin",
    journal: "journalReminder",
    urge: "urgeRescue",
    rescueDone: "urgeRescue",
    milestone: "streakMilestones",
    weekly: "weeklyReport",
  }[type];

  if (toggleKey && notif[toggleKey] === false) return false;
  return true;
}

/** Today's date string in the user's own timezone, matching how App.jsx
 *  stores `lastCheckin` (a human-readable toDateString()-style value is
 *  compared by exact string equality client-side, but for a server-side
 *  timezone-aware comparison we normalize both sides to YYYY-MM-DD). */
function todayInTimezone(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }
}

function hasCheckedInToday(user) {
  if (!user.lastCheckin) return false;
  const tz = user.notifications?.timezone || "UTC";
  const today = todayInTimezone(tz);
  // lastCheckin is stored as a JS Date.toDateString() string by App.jsx —
  // normalize both to a comparable date to avoid timezone string mismatches.
  const lastCheckinDate = new Date(user.lastCheckin);
  const lastCheckinNormalized = isNaN(lastCheckinDate) ? user.lastCheckin : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(lastCheckinDate);
  return lastCheckinNormalized === today;
}

module.exports = { isEligible, todayInTimezone, hasCheckedInToday };