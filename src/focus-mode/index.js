const admin = require("firebase-admin");
admin.initializeApp();

const { dailyCheckinReminder, missedCheckinFinalReminder } = require("./checkinReminders");
const { journalReminder } = require("./journalReminder");
const { streakMilestoneNotifier } = require("./streakMilestones");
const { weeklySummaryNotifier } = require("./weeklySummary");
const { rescueSessionComplete } = require("./rescueComplete");

exports.dailyCheckinReminder = dailyCheckinReminder;
exports.missedCheckinFinalReminder = missedCheckinFinalReminder;
exports.journalReminder = journalReminder;
exports.streakMilestoneNotifier = streakMilestoneNotifier;
exports.weeklySummaryNotifier = weeklySummaryNotifier;
exports.rescueSessionComplete = rescueSessionComplete;