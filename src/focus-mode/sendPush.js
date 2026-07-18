const admin = require("firebase-admin");

/**
 * sendPush(uid, notif) — sends one FCM message to a user's stored token and
 * removes the token from Firestore if it's dead (uninstalled app, revoked
 * permission, expired token), so we never keep retrying a dead endpoint.
 * The ONLY place that calls admin.messaging().send() in this codebase.
 */
async function sendPush(uid, notif) {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { sent: false, reason: "no-user" };

  const user = userSnap.data();
  const token = user.fcmToken;
  if (!token) return { sent: false, reason: "no-token" };

  const message = {
    token,
    notification: { title: notif.title, body: notif.body },
    webpush: {
      notification: {
        title: notif.title,
        body: notif.body,
        icon: notif.icon,
        badge: notif.badge,
      },
      fcmOptions: { link: notif.deepLink || "/" },
    },
    data: {
      deepLink: notif.deepLink || "/",
      type: notif.type || "generic",
    },
  };

  try {
    await admin.messaging().send(message);
    return { sent: true };
  } catch (err) {
    // messaging/registration-token-not-registered = token is dead (app
    // uninstalled, permission revoked, cache cleared). Clean it up so we
    // stop trying to reach it.
    if (err.code === "messaging/registration-token-not-registered" || err.code === "messaging/invalid-registration-token") {
      await userRef.update({ fcmToken: admin.firestore.FieldValue.delete() }).catch(() => {});
      return { sent: false, reason: "token-invalid-cleaned" };
    }
    console.error(`sendPush failed for ${uid}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendPush };
