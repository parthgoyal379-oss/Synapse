// /api/cron/daily-reminder.js
//
// Vercel Cron job — runs once a day (see vercel.json for schedule) and sends
// a "Did you check in today?" push notification to every user who has an
// FCM token saved but hasn't checked in yet today.
//
// SETUP REQUIRED (do this before deploying):
// 1. npm install firebase-admin
// 2. In Firebase Console -> Project Settings -> Service Accounts ->
//    "Generate new private key". This downloads a JSON file. DO NOT commit
//    it to git. Instead, set these as Vercel env vars (Project Settings ->
//    Environment Variables):
//      FIREBASE_PROJECT_ID    = (from the JSON: project_id)
//      FIREBASE_CLIENT_EMAIL  = (from the JSON: client_email)
//      FIREBASE_PRIVATE_KEY   = (from the JSON: private_key — paste as-is,
//                                 the \n escaping is handled below)
// 3. Set CRON_SECRET to any random string (e.g. `openssl rand -hex 32`) as
//    a Vercel env var too. This stops randoms from hitting your cron URL
//    and spamming every user — Vercel automatically sends this as a Bearer
//    token when it triggers the cron (see vercel.json + Vercel's cron docs).
//
// IMPORTANT CAVEAT — timezone assumption:
// The app stores `lastCheckin` as `new Date().toDateString()` computed in
// the USER's browser timezone (e.g. "Wed Jul 01 2026"). This server function
// runs in UTC. To match what the client would have written, this code
// assumes all users are in Asia/Kolkata (IST) — true for your current
// audience, but NOT a real per-user timezone match. If you ever get users
// outside India, this will misfire near midnight IST for them. Documented
// here so future-you doesn't get confused; not fixed because building real
// per-user timezone tracking is a separate, bigger feature.

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
function getAdminApp() {
  if (getApps().length) return getApps()[0];

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

// Builds today's date string in IST, in the exact format JS's
// `Date.prototype.toDateString()` produces (e.g. "Wed Jul 01 2026"), so it
// matches what's actually stored in Firestore's `lastCheckin` field.
function todayISTDateString() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", month: "short", day: "2-digit", year: "numeric",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  // toDateString() format: "Www Mmm dd yyyy"
  return `${parts.weekday} ${parts.month} ${parts.day} ${parts.year}`;
}

export default async function handler(req, res) {
  // Only Vercel's own cron trigger (or you, manually, with the secret)
  // should be able to hit this endpoint.
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const app = getAdminApp();
const db = getFirestore(app);
const messaging = getMessaging(app);

    const today = todayISTDateString();

    // Pull every user that has a saved FCM token. (If your user base grows
    // past a few thousand, switch this to paginated queries with .limit()
    // + startAfter() — fine as-is for current scale.)
    const snap = await db.collection("users").where("fcmToken", "!=", null).get();

    const eligible = [];
    snap.forEach(doc => {
      const u = doc.data();
      if (!u.fcmToken) return;
      if (u.lastCheckin === today) return; // already checked in today, skip
      eligible.push({ uid: doc.id, token: u.fcmToken, streak: u.currentStreak || 0 });
    });

    if (eligible.length === 0) {
      return res.status(200).json({ ok: true, today, totalWithToken: snap.size, eligible: 0, sent: 0, failed: 0 });
    }

    // FCM multicast caps at 500 tokens per call — chunk it.
    const CHUNK = 500;
    let sent = 0, failed = 0;
    // This same endpoint is triggered by TWO schedules — 8 PM and 10:30 PM
    // IST (see vercel.json). Vercel sends the exact cron expression that
    // fired in this header, so we can tell them apart and use a more
    // urgent "last chance" message for the later one, instead of sending
    // identical copy twice in one evening.
    const triggeredSchedule = req.headers["x-vercel-cron-schedule"] || "";
    const isLateNight = triggeredSchedule.trim() === "0 17 * * *"; // 10:30 PM IST
    const notifCopy = isLateNight
      ? { title: "Last call — streak resets at midnight", body: "A few hours left. Don't let a good streak end on a day you forgot." }
      : { title: "Did you check in today?", body: "Your streak is waiting. Takes 30 seconds — don't let today slip." };

    const tokensToRemove = [];

    for (let i = 0; i < eligible.length; i += CHUNK) {
      const batch = eligible.slice(i, i + CHUNK);
      const message = {
        notification: {
          title: notifCopy.title,
          body: notifCopy.body,
        },
        webpush: {
          fcmOptions: { link: "/" }, // adjust if your deployed URL needs a specific check-in path
          notification: { icon: "/icon-192.png" }, // adjust path if your PWA icon lives elsewhere
        },
        tokens: batch.map(b => b.token),
      };

      const result = await messaging.sendEachForMulticast(message);
      sent += result.successCount;
      failed += result.failureCount;

      result.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code || "";
          // Token is dead — clean it up so future runs don't keep retrying it.
          if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            tokensToRemove.push(batch[idx].uid);
          }
        }
      });
    }

    // Clean up dead tokens (fire-and-forget-ish, but awaited so the cron
    // log reflects the real outcome).
    if (tokensToRemove.length) {
      const writeBatch = db.batch();
      tokensToRemove.forEach(uid => {
        writeBatch.update(db.collection("users").doc(uid), { fcmToken: FieldValue.delete() });
      });
      await writeBatch.commit();
    }

    return res.status(200).json({
      ok: true,
      run: isLateNight ? "10:30pm-last-call" : "8pm-reminder",
      today,
      totalWithToken: snap.size,
      eligible: eligible.length,
      sent,
      failed,
      deadTokensRemoved: tokensToRemove.length,
    });
  } catch (e) {
    console.error("daily-reminder cron failed:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}