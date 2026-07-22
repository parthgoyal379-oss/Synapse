const admin = require("firebase-admin");

/**
 * notificationHistory.js
 * ────────────────────────────────────────────────────────────────────────
 * Every notification attempt (sent, skipped, or failed) is recorded in the
 * `notificationHistory` collection, one doc per attempt.
 *
 * Deterministic IDs: `${uid}_${type}_${dateKey}` — the SAME id every time
 * this exact user+type+day combination is considered, whether by a retried
 * Cloud Scheduler tick, an overlapping function execution, or a genuine
 * re-run. Writing with `.set(..., {merge:true})` on that id makes every
 * write idempotent: running the same logical send twice produces exactly
 * one history doc, not two — this doubles as both the audit log AND the
 * duplicate-send guard (see wasAlreadySent below).
 *
 * 90-day retention: every doc gets an `expireAt` timestamp 90 days out.
 * This relies on a Firestore TTL policy configured on the `expireAt` field
 * of this collection (one-time Firebase Console / CLI setup — see
 * deployment notes; NOT something this code can enable by itself, and
 * deliberately not a second cron job doing manual deletes).
 */

function historyId(uid, type, dateKey) {
  return `${uid}_${type}_${dateKey}`;
}

/** True if this exact user+type+day was already recorded as sent. */
async function wasAlreadySent(db, uid, type, dateKey) {
  const id = historyId(uid, type, dateKey);
  const snap = await db.collection("notificationHistory").doc(id).get();
  return snap.exists && snap.data()?.status === "sent";
}

/**
 * Records one notification attempt. `status` is one of:
 * "sent" | "failed" | "skipped". `deliveryResult` is whatever sendPush()
 * returned (e.g. {sent:true} or {sent:false, reason:"no-token"}).
 */
async function recordHistory(db, { uid, type, dateKey, status, deliveryResult, title, body }) {
  const id = historyId(uid, type, dateKey);
  const expireAt = admin.firestore.Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);
  await db.collection("notificationHistory").doc(id).set(
    {
      uid,
      type,
      date: dateKey,
      status,
      deliveryResult: deliveryResult || null,
      title: title || null,
      body: body || null,
      // Analytics fields — updated later by trackOpen()/trackClick() if the
      // client reports them (see App.jsx's SYNAPSE_NOTIFICATION_CLICK
      // handler / foreground onMessage listener).
      opened: false,
      clicked: false,
      dismissed: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expireAt,
    },
    { merge: true }
  );
}

module.exports = { historyId, wasAlreadySent, recordHistory };
