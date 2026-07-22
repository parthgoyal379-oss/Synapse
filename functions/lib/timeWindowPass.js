const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { isEligible, todayInTimezone } = require("./eligibility");

/**
 * runTimeWindowPass({type, getTargetMinutes, shouldSend, buildNotif})
 *
 * Runs every 15 minutes (caller owns the onSchedule wrapper). For each
 * user with a token: computes their current local time, and only proceeds
 * if it falls within the same 15-minute window as getTargetMinutes(user)
 * — so this scales to any number of users without per-user scheduled
 * functions, and each user still gets their reminder at (approximately)
 * their own chosen local time.
 *
 * shouldSend(user, tz, todayKey) does the category-specific gating (e.g.
 * "only if not checked in yet", "only if streak >= 7") on top of the
 * universal isEligible() check this helper already applies.
 *
 * Duplicate-send protection is NOT re-implemented here — sendPush() itself
 * already refuses to send twice for the same (uid, type, dateKey), via
 * notificationHistory. This helper only decides WHETHER to attempt a send
 * this pass, not whether one already happened.
 */
async function runTimeWindowPass({ type, getTargetMinutes, shouldSend, buildNotif }) {
  const db = admin.firestore();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();

  const jobs = [];
  snap.forEach((doc) => {
    const user = doc.data();
    if (!isEligible(user, type)) return;

    const tz = user.notifications?.timezone || "UTC";
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const localTotalMin = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);

    const targetTotalMin = getTargetMinutes(user);
    if (targetTotalMin == null || Math.abs(localTotalMin - targetTotalMin) >= 15) return;

    const todayKey = todayInTimezone(tz);
    if (!shouldSend(user, tz, todayKey)) return;

    const notif = buildNotif(user, todayKey);
    if (!notif) return;

    jobs.push(sendPush(doc.id, notif, { type, dateKey: todayKey }));
  });

  await Promise.allSettled(jobs);
}

module.exports = { runTimeWindowPass };
