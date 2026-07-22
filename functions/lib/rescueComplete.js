const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { isEligible, todayInTimezone } = require("./eligibility");
const admin = require("firebase-admin");

/**
 * Fires when the client writes a completed rescue session to
 * users/{uid}/urgeSessions/{sessionId}. Firestore auto-generates a unique
 * ID per session document, so this trigger fires exactly once per real
 * session by construction — no additional dedupe needed beyond sendPush's
 * own (uid, type, dateKey) guard.
 *
 * "If app is open, show in-app notification; if closed, push notification"
 * is enforced by a `backgrounded: boolean` flag the client sets. If
 * backgrounded is false, the app's own in-app completion screen already
 * told the user; this function skips the push entirely.
 */
exports.rescueSessionComplete = onDocumentCreated("users/{uid}/urgeSessions/{sessionId}", async (event) => {
  const session = event.data.data();
  if (!session?.backgrounded) return;

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(event.params.uid).get();
  const user = userSnap.data();
  if (!isEligible(user, "rescueDone")) return;

  const tz = user.notifications?.timezone || "UTC";
  const notif = buildNotification("rescueDone", user.tone);
  await sendPush(event.params.uid, notif, { type: `rescueDone_${event.params.sessionId}`, dateKey: todayInTimezone(tz) });
});
