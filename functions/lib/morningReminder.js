const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runTimeWindowPass } = require("./timeWindowPass");
const { hasCheckedInToday } = require("./eligibility");
const { buildNotification } = require("./messageGenerator");

// Default 8:00 AM local, user-configurable via notifications.morningReminderTime.
exports.morningReminder = onSchedule("every 15 minutes", async () => {
  await runTimeWindowPass({
    type: "morning",
    getTargetMinutes: (user) => {
      const t = user.notifications?.morningReminderTime || "08:00";
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    },
    shouldSend: (user) => !hasCheckedInToday(user), // don't nudge someone who's already checked in
    buildNotif: (user) => buildNotification("morning", user.tone),
  });
});
