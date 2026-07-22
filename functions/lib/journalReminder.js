const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runTimeWindowPass } = require("./timeWindowPass");
const { buildNotification } = require("./messageGenerator");

exports.journalReminder = onSchedule("every 15 minutes", async () => {
  await runTimeWindowPass({
    type: "journal",
    getTargetMinutes: (user) => {
      const t = user.notifications?.journalReminderTime || user.notifications?.reminderTime || "20:00";
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    },
    shouldSend: () => true, // no "already journaled" signal is synced server-side — client owns that history
    buildNotif: (user) => buildNotification("journal", user.tone),
  });
});
