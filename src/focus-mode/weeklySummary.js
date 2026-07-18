const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildWeeklySummaryBody } = require("./messageGenerator");
const { isEligible } = require("./eligibility");

// Runs every 15 minutes on Sundays; only actually sends to a user once
// their local time crosses into evening (18:00) that Sunday, so it still
// respects each user's own timezone without needing per-user schedules.
exports.weeklySummaryNotifier = onSchedule({ schedule: "every 15 minutes", timeZone: "UTC" }, async () => {
  const db = admin.firestore();
  const now = new Date();

  const snap = await db.collection("users").where("fcmToken", "!=", null).get();
  const jobs = [];

  snap.forEach((doc) => {
    const user = doc.data();
    if (!isEligible(user, "weekly")) return;

    const tz = user.notifications?.timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday").value;
    const hour = Number(parts.find((p) => p.type === "hour").value);
    if (weekday !== "Sun" || hour < 18 || hour >= 19) return; // 18:00–19:00 local Sunday window

    const weekKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // YYYY-MM-DD, unique per day
    if (user.notifications?.lastWeeklySummaryDate === weekKey) return;

    jobs.push(sendWeeklySummary(doc.id, user, weekKey));
  });

  await Promise.allSettled(jobs);
});

async function sendWeeklySummary(uid, user, weekKey) {
  const db = admin.firestore();
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  // Real check-ins this week — always available (App.jsx already writes
  // every check-in to the `checkins` collection).
  const checkinsSnap = await db.collection("checkins").where("uid", "==", uid).where("timestamp", ">=", weekAgo).get();
  const checkins = checkinsSnap.docs.map((d) => d.data());
  const wins = checkins.filter((c) => c.status === "win").length;

  const stats = {
    checkins: checkins.length,
    currentStreak: user.currentStreak ?? null,
  };

  // Journal entries this week — only real if the client has synced them
  // (Focus Mode's syncJournalEntryToCloud, opt-in via the `uid` prop).
  try {
    const journalSnap = await db.collection("users").doc(uid).collection("journalEntries").where("createdAt", ">=", weekAgo.toISOString()).get();
    if (!journalSnap.empty || (await db.collection("users").doc(uid).collection("journalEntries").limit(1).get()).size > 0) {
      stats.journalEntries = journalSnap.size;
    }
  } catch {
    // No journal subcollection synced yet — omit the stat, never fabricate it.
  }

  // Urge sessions this week — only real if synced (see rescueComplete.js,
  // which writes to this same collection when a rescue session finishes).
  try {
    const urgeSnap = await db.collection("users").doc(uid).collection("urgeSessions").where("date", ">=", weekAgo.toISOString()).get();
    if (!urgeSnap.empty) {
      const survived = urgeSnap.docs.filter((d) => d.data().survived).length;
      stats.urgeResistancePct = Math.round((survived / urgeSnap.size) * 100);
    }
  } catch {
    // No urge sessions synced this week — omit, never fabricate.
  }

  const body = buildWeeklySummaryBody(user.tone, stats);
  const result = await sendPush(uid, {
    title: "Your weekly recovery report is ready.",
    body,
    deepLink: "/report",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    type: "weekly",
  });

  if (result.sent) {
    await db.collection("users").doc(uid).update({ "notifications.lastWeeklySummaryDate": weekKey });
  }
}
