const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { isEligible, todayInTimezone } = require("./eligibility");

exports.journalReminder = onSchedule("every 15 minutes", async () => {
  const db = admin.firestore();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();
  const jobs = [];

  snap.forEach((doc) => {
    const user = doc.data();
    if (!isEligible(user, "journal")) return;

    const tz = user.notifications?.timezone || "UTC";
    const reminderTime = user.notifications?.journalReminderTime || user.notifications?.reminderTime || "20:00";
    const [rh, rm] = reminderTime.split(":").map(Number);

    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const localTotalMin = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
    const targetTotalMin = rh * 60 + rm;
    if (Math.abs(localTotalMin - targetTotalMin) >= 15) return;

    const today = todayInTimezone(tz);
    if (user.notifications?.lastJournalReminderDate === today) return;

    const notif = buildNotification("journal", user.tone, {});
    jobs.push(
      sendPush(doc.id, { ...notif, type: "journal" }).then((result) => {
        if (result.sent) return doc.ref.update({ "notifications.lastJournalReminderDate": today });
      })
    );
  });

  return Promise.allSettled(jobs);
});
