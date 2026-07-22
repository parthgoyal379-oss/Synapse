const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runTimeWindowPass } = require("./timeWindowPass");
const { hasCheckedInToday } = require("./eligibility");
const { buildNotification } = require("./messageGenerator");

// Primary daily check-in reminder — default 8:00 PM, user-configurable.
exports.dailyCheckinReminder = onSchedule("every 15 minutes", async () => {
  await runTimeWindowPass({
    type: "checkin",
    getTargetMinutes: (user) => {
      const t = user.notifications?.reminderTime || "20:00";
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    },
    shouldSend: (user) => !hasCheckedInToday(user),
    buildNotif: (user) => buildNotification("checkin", user.tone),
  });
});

// One final "you still haven't checked in" reminder at 10:30 PM local —
// only fires if the primary reminder didn't already result in a check-in.
// "Only once, never repeat" is guaranteed by sendPush()'s own dedupe on
// (uid, type="missed", dateKey), independent of this window matching.
exports.missedCheckinFinalReminder = onSchedule("every 15 minutes", async () => {
  await runTimeWindowPass({
    type: "missed",
    getTargetMinutes: () => 22 * 60 + 30, // fixed 10:30 PM local, not user-configurable
    shouldSend: (user) => !hasCheckedInToday(user),
    buildNotif: (user) => buildNotification("missed", user.tone),
  });
});
