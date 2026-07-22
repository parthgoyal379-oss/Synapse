const admin = require("firebase-admin");
admin.initializeApp();

const { morningReminder } = require("./lib/morningReminder");
const { dailyCheckinReminder, missedCheckinFinalReminder } = require("./lib/checkinReminders");
const { journalReminder } = require("./lib/journalReminder");
const { streakProtectionReminder } = require("./lib/streakProtection");
const { highRiskReminder } = require("./lib/highRiskReminder");
const { streakMilestoneNotifier } = require("./lib/streakMilestones");
const { weeklySummaryNotifier } = require("./lib/weeklySummary");
const { monthlyReportNotifier } = require("./lib/monthlyReport");
const { rescueSessionComplete } = require("./lib/rescueComplete");

exports.morningReminder = morningReminder;
exports.dailyCheckinReminder = dailyCheckinReminder;
exports.missedCheckinFinalReminder = missedCheckinFinalReminder;
exports.journalReminder = journalReminder;
exports.streakProtectionReminder = streakProtectionReminder;
exports.highRiskReminder = highRiskReminder;
exports.streakMilestoneNotifier = streakMilestoneNotifier;
exports.weeklySummaryNotifier = weeklySummaryNotifier;
exports.monthlyReportNotifier = monthlyReportNotifier;
exports.rescueSessionComplete = rescueSessionComplete;

// NOTE: Achievement Unlock notifications are intentionally NOT implemented
// here — the Achievements feature itself doesn't exist yet in the app.
// Add an `achievementUnlockNotifier` export here once that feature ships
// and has a real Firestore write to trigger off of.

// NOTE: notificationHistory 90-day retention is enforced via a Firestore
// TTL policy on the `expireAt` field (see notificationHistory.js), not a
// scheduled cleanup function — see deployment notes for the one-time
// console/CLI setup required.
