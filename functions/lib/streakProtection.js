const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runTimeWindowPass } = require("./timeWindowPass");
const { hasCheckedInToday } = require("./eligibility");
const { buildNotification } = require("./messageGenerator");

const PROTECT_THRESHOLD = 7; // "7+, 14+, 30+, 60+, 90+" — any streak >= 7 qualifies, message names the real number

exports.streakProtectionReminder = onSchedule("every 15 minutes", async () => {
  await runTimeWindowPass({
    type: "streakProtection",
    getTargetMinutes: () => 21 * 60, // fixed 9:00 PM local — ahead of the 10:30 PM generic missed reminder
    shouldSend: (user) => (user.currentStreak || 0) >= PROTECT_THRESHOLD && !hasCheckedInToday(user),
    buildNotif: (user) => buildNotification("streakProtection", user.tone, { days: user.currentStreak }),
  });
});
