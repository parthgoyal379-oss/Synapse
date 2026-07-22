const admin = require("firebase-admin");
const { wasAlreadySent, recordHistory } = require("./notificationHistory");

/**
 * sendPush(uid, notif, {type, dateKey}) — sends one FCM message to a
 * user's stored token. The ONLY place admin.messaging().send() is called
 * in this codebase.
 *
 * Idempotent + duplicate-safe: before sending, checks notificationHistory
 * for an existing "sent" record with this exact (uid, type, dateKey) — if
 * found, this is a no-op ({sent:false, reason:"already-sent"}). This means
 * a Cloud Scheduler retry, an overlapping execution, or a re-run of the
 * same logical pass can never double-send the same notification.
 *
 * On success, stamps users/{uid}.notifications.lastSentAt so the global
 * 30-minute cross-type cooldown (see eligibility.js) applies immediately
 * to every OTHER category too.
 */
async function sendPush(uid, notif, { type, dateKey }) {
  const db = admin.firestore();

  if (await wasAlreadySent(db, uid, type, dateKey)) {
    return { sent: false, reason: "already-sent" };
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    await recordHistory(db, { uid, type, dateKey, status: "skipped", deliveryResult: { reason: "no-user" } });
    return { sent: false, reason: "no-user" };
  }

  const user = userSnap.data();
  const token = user.fcmToken;
  if (!token) {
    await recordHistory(db, { uid, type, dateKey, status: "skipped", deliveryResult: { reason: "no-token" } });
    return { sent: false, reason: "no-token" };
  }

  const message = {
    token,
    notification: { title: notif.title, body: notif.body },
    webpush: {
      notification: { title: notif.title, body: notif.body, icon: notif.icon, badge: notif.badge },
      fcmOptions: { link: notif.deepLink || "/" },
    },
    data: { deepLink: notif.deepLink || "/", type: type || "generic" },
  };

  let result;
  try {
    await admin.messaging().send(message);
    result = { sent: true };
  } catch (err) {
    if (err.code === "messaging/registration-token-not-registered" || err.code === "messaging/invalid-registration-token") {
      await userRef.update({ fcmToken: admin.firestore.FieldValue.delete() }).catch(() => {});
      result = { sent: false, reason: "token-invalid-cleaned" };
    } else {
      console.error(`sendPush failed for ${uid}:`, err.message);
      result = { sent: false, reason: err.message };
    }
  }

  await recordHistory(db, {
    uid, type, dateKey,
    status: result.sent ? "sent" : "failed",
    deliveryResult: result,
    title: notif.title, body: notif.body,
  });

  if (result.sent) {
    await userRef.update({ "notifications.lastSentAt": Date.now() }).catch(() => {});
  }

  return result;
}

module.exports = { sendPush };
