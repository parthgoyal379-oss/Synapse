const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { isEligible } = require("./eligibility");
const admin = require("firebase-admin");

/**
 * Fires when the client writes a completed rescue session to
 * users/{uid}/urgeSessions/{sessionId}. This collection is also read by
 * weeklySummary.js for real urge-resistance stats — one write serves both
 * purposes.
 *
 * "If app is open, show in-app notification; if closed, push notification"
 * is enforced by a `backgrounded: boolean` flag the client sets (true only
 * if document.hidden was true when the timer completed) — see the
 * integration note in useRescue.js. If backgrounded is false, the app's
 * own in-app completion screen already told the user; this function
 * skips the push entirely rather than duplicating it.
 */
exports.rescueSessionComplete = onDocumentCreated("users/{uid}/urgeSessions/{sessionId}", async (event) => {
  const session = event.data.data();
  if (!session?.backgrounded) return; // app was open — in-app UI already covered this

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(event.params.uid).get();
  const user = userSnap.data();
  if (!isEligible(user, "rescueDone")) return;

  const notif = buildNotification("rescueDone", user.tone, {});
  await sendPush(event.params.uid, { ...notif, type: "rescueDone" });
});