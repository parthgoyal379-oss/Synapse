const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { isEligible, hasCheckedInToday, todayInTimezone } = require("./eligibility");

/**
 * Runs every 15 minutes. For each user, computes their CURRENT local time
 * (from their stored timezone) and only sends if it falls within the same
 * 15-minute window as their chosen reminder time — so this scales to any
 * number of users without per-user scheduled functions, and each user
 * still gets their reminder at (approximately) their own chosen time.
 *
 * Idempotency: a `notifications.lastReminderDate` field (per type) is
 * stamped after sending, so re-running this window never double-sends.
 */
async function processReminderPass({ toggleField, minutesPastMidnightDefault, type, lastSentField }) {
  const db = admin.firestore();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();

  const jobs = [];
  snap.forEach((doc) => {
    const user = doc.data();
    if (!isEligible(user, type)) return;
    if (type === "checkin" && hasCheckedInToday(user)) return; // already checked in — never send
    if (type === "missed" && hasCheckedInToday(user)) return;

    const tz = user.notifications?.timezone || "UTC";
    const reminderTime = user.notifications?.reminderTime || "20:00"; // HH:MM, 8:00 PM default
    const [rh, rm] = reminderTime.split(":").map(Number);

    const now = new Date();
    const localParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const localHour = Number(localParts.find((p) => p.type === "hour").value);
    const localMinute = Number(localParts.find((p) => p.type === "minute").value);
    const localTotalMin = localHour * 60 + localMinute;

    const targetTotalMin = type === "missed" ? 22 * 60 + 30 : rh * 60 + rm; // 10:30 PM fixed for the final reminder
    const withinWindow = Math.abs(localTotalMin - targetTotalMin) < 15;
    if (!withinWindow) return;

    const today = todayInTimezone(tz);
    if (user.notifications?.[lastSentField] === today) return; // already sent today

    const notif = buildNotification(type, user.tone, {});
    jobs.push(
      sendPush(doc.id, { ...notif, type }).then((result) => {
        if (result.sent) {
          return doc.ref.update({ [`notifications.${lastSentField}`]: today });
        }
      })
    );
  });

  await Promise.allSettled(jobs);
}

// Primary daily check-in reminder — default 8:00 PM, user-configurable.
exports.dailyCheckinReminder = onSchedule("every 15 minutes", async () => {
  await processReminderPass({ type: "checkin", lastSentField: "lastCheckinReminderDate" });
});

// One final reminder at 10:30 PM local time if still not checked in.
exports.missedCheckinFinalReminder = onSchedule("every 15 minutes", async () => {
  await processReminderPass({ type: "missed", lastSentField: "lastMissedReminderDate" });
});