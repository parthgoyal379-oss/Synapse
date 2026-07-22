const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { getHighRiskText } = require("./aiNotificationText");
const { isEligible, todayInTimezone } = require("./eligibility");

const LOW_STREAK_THRESHOLD = 1; // streak 0 or 1 = fresh/no cushion
const MULTI_URGE_THRESHOLD = 2; // 2+ urge sessions logged today

/**
 * Condition-triggered, not clock-triggered — runs every 30 minutes and
 * checks real recent data per user, rather than firing at one fixed local
 * time. Still fully bound by eligibility.js's quiet hours + 30-min global
 * cooldown, and by sendPush()'s own once-per-(uid,type,day) dedupe.
 */
exports.highRiskReminder = onSchedule("every 30 minutes", async () => {
  const db = admin.firestore();
  const snap = await db.collection("users").where("fcmToken", "!=", null).get();

  const jobs = snap.docs.map(async (doc) => {
    const user = doc.data();
    if (!isEligible(user, "highRisk")) return;

    const uid = doc.id;
    const tz = user.notifications?.timezone || "UTC";
    const todayKey = todayInTimezone(tz);

    const isHighRisk = await detectHighRisk(db, uid, user, todayKey);
    if (!isHighRisk) return;

    const body = await getHighRiskText(uid, user, todayKey, db);
    const notif = buildNotification("highRisk", user.tone, { body });
    await sendPush(uid, notif, { type: "highRisk", dateKey: todayKey });
  });

  await Promise.allSettled(jobs);
});

async function detectHighRisk(db, uid, user, todayKey) {
  if ((user.currentStreak || 0) <= LOW_STREAK_THRESHOLD) return true;

  const recentCheckins = await db.collection("checkins").where("uid", "==", uid).orderBy("timestamp", "desc").limit(2).get();
  const recentSlip = recentCheckins.docs.some((d) => d.data().status === "slip");
  if (recentSlip) return true;

  try {
    const dayStart = new Date(`${todayKey}T00:00:00`);
    const urgeSnap = await db.collection("users").doc(uid).collection("urgeSessions").where("date", ">=", dayStart.toISOString()).get();
    if (urgeSnap.size >= MULTI_URGE_THRESHOLD) return true;
  } catch {
    // No urge subcollection synced for this user yet — not a signal, not an error.
  }

  return false;
}
