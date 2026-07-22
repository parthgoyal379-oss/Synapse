const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { sendPush } = require("./sendPush");
const { buildNotification } = require("./messageGenerator");
const { isEligible, todayInTimezone } = require("./eligibility");

const MILESTONES = new Set([1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 365]);

// Fires automatically whenever the existing checkin flow's
// durableWrite(..., "users", uid, {currentStreak: finalStreak, ...}) runs.
// Nothing client-side needs to change for this to work. Firestore
// document-update triggers are inherently idempotent per revision — a
// retry of the same underlying write doesn't re-fire this for a streak
// value it already processed, since `before`/`after` would be identical.
exports.streakMilestoneNotifier = onDocumentUpdated("users/{uid}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after) return;

  const prevStreak = before?.currentStreak ?? 0;
  const newStreak = after.currentStreak ?? 0;
  if (newStreak === prevStreak) return;
  if (!MILESTONES.has(newStreak)) return;

  if (!isEligible(after, "milestone")) return;

  const tz = after.notifications?.timezone || "UTC";
  const todayKey = todayInTimezone(tz);
  const notif = buildNotification("milestone", after.tone, { days: newStreak });
  await sendPush(event.params.uid, notif, { type: `milestone_${newStreak}`, dateKey: todayKey });
});
