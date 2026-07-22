const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildNotification, buildWeeklySummaryBody } = require("./messageGenerator");
const { isEligible, todayInTimezone } = require("./eligibility");

// Runs every 15 minutes on Sundays; only actually sends once a user's
// local time crosses into evening (18:00) that Sunday — respects each
// user's own timezone without per-user schedules.
exports.weeklySummaryNotifier = onSchedule({ schedule: "every 15 minutes", timeZone: "UTC" }, async () => {
  const db = admin.firestore();
  const now = new Date();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();

  const jobs = snap.docs.map(async (doc) => {
    const user = doc.data();
    if (!isEligible(user, "weekly")) return;

    const tz = user.notifications?.timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday").value;
    const hour = Number(parts.find((p) => p.type === "hour").value);
    if (weekday !== "Sun" || hour < 18 || hour >= 19) return;

    await sendWeeklySummary(db, doc.id, user, todayInTimezone(tz));
  });

  await Promise.allSettled(jobs);
});

async function sendWeeklySummary(db, uid, user, dateKey) {
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const checkinsSnap = await db.collection("checkins").where("uid", "==", uid).where("timestamp", ">=", weekAgo).get();
  const checkins = checkinsSnap.docs.map((d) => d.data());

  const stats = { checkins: checkins.length, currentStreak: user.currentStreak ?? null };

  try {
    const journalSnap = await db.collection("users").doc(uid).collection("journalEntries").where("createdAt", ">=", weekAgo.toISOString()).get();
    stats.journalEntries = journalSnap.size;
  } catch { /* no journal subcollection synced yet — omit, never fabricate */ }

  try {
    const urgeSnap = await db.collection("users").doc(uid).collection("urgeSessions").where("date", ">=", weekAgo.toISOString()).get();
    if (!urgeSnap.empty) {
      const survived = urgeSnap.docs.filter((d) => d.data().survived).length;
      stats.urgeResistancePct = Math.round((survived / urgeSnap.size) * 100);
    }
  } catch { /* no urge sessions synced this week — omit, never fabricate */ }

  const body = buildWeeklySummaryBody(user.tone, stats);
  const notif = buildNotification("weekly", user.tone, { body });
  await sendPush(uid, notif, { type: "weekly", dateKey });
}
