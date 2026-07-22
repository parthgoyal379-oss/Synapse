const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildNotification, buildMonthlySummaryBody } = require("./messageGenerator");
const { isEligible, todayInTimezone } = require("./eligibility");

// Runs every 15 minutes; only sends once a user's local date is the 1st of
// the month AND local time has crossed into evening (18:00) — same
// per-user-timezone pattern as weeklySummary, just gated on day-of-month
// instead of day-of-week.
exports.monthlyReportNotifier = onSchedule({ schedule: "every 15 minutes", timeZone: "UTC" }, async () => {
  const db = admin.firestore();
  const now = new Date();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();

  const jobs = snap.docs.map(async (doc) => {
    const user = doc.data();
    if (!isEligible(user, "monthly")) return;

    const tz = user.notifications?.timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
    const day = Number(parts.find((p) => p.type === "day").value);
    const hour = Number(parts.find((p) => p.type === "hour").value);
    if (day !== 1 || hour < 18 || hour >= 19) return;

    await sendMonthlyReport(db, doc.id, user, todayInTimezone(tz));
  });

  await Promise.allSettled(jobs);
});

async function sendMonthlyReport(db, uid, user, dateKey) {
  const monthAgo = new Date(Date.now() - 30 * 864e5);

  const checkinsSnap = await db.collection("checkins").where("uid", "==", uid).where("timestamp", ">=", monthAgo).get();
  const checkins = checkinsSnap.docs.map((d) => d.data());
  const wins = checkins.filter((c) => c.status === "win").length;

  const stats = { checkins: checkins.length, wins, currentStreak: user.currentStreak ?? null };

  try {
    const urgeSnap = await db.collection("users").doc(uid).collection("urgeSessions").where("date", ">=", monthAgo.toISOString()).get();
    if (!urgeSnap.empty) {
      const survived = urgeSnap.docs.filter((d) => d.data().survived).length;
      stats.urgeResistancePct = Math.round((survived / urgeSnap.size) * 100);
    }
  } catch { /* no urge sessions synced this month — omit, never fabricate */ }

  const body = buildMonthlySummaryBody(user.tone, stats);
  const notif = buildNotification("monthly", user.tone, { body });
  await sendPush(uid, notif, { type: "monthly", dateKey });
}
