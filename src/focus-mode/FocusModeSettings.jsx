import { useEffect, useState, useRef } from "react";
import { fm } from "./theme";
import {
  readSynapseSnapshot,
  readArchetype,
  getTone,
  setTone as setToneLS,
  setToneInSettings,
  MODES,
  readNotificationPrefs,
  setNotificationPrefInSettings,
  readUIMode,
  setUIMode as setUIModeLS,
  setUiModeInSettings,
  readPrivacyCounts,
  readConnectedFeatures,
  exportAllSynapseData,
  resetRecoveryProgress,
  longestStreak,
  ls,
  NOTIF_KEYS,
  writeLocalNotifCache,
} from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  Toggle,
  RadioCard,
  SettingsRow,
  DangerAction,
  ConfirmModal,
  MetricCard,
  NeuronArt,
} from "./components";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

// Simple toast implementation to avoid runtime errors
const showToast = (message) => {
  console.log("Toast:", message);
  // In a real implementation, this would show a UI toast notification
};

const NOTIF_ITEMS = [
  { key: "checkin", icon: "🔔", title: "Daily Check-In Reminder", desc: "Reminds you to complete your daily check-in." },
  { key: "journal", icon: "📖", title: "Journal Reminder", desc: "Gentle nudges to write your thoughts." },
  { key: "urge", icon: "⚡", title: "Urge Rescue Reminder", desc: "Get help when urges hit hard." },
  { key: "weekly", icon: "📊", title: "Weekly Report Reminder", desc: "Receive your weekly recovery insights." },
  { key: "milestones", icon: "🏆", title: "Streak Milestone Alerts", desc: "Celebrate 3, 7, 14, 30+ day milestones." },
  { key: "silentMode", icon: "🔕", title: "Silent Mode", desc: "Pause all reminders temporarily." },
];

const FEATURE_ITEMS = [
  { key: "coach", icon: "⚡", label: "AI Coach", caption: "Your personal strategist" },
  { key: "journal", icon: "📖", label: "Journal", caption: "Capture your thoughts" },
  { key: "urge", icon: "🛡️", label: "Urge Log", caption: "Track and overcome urges" },
  { key: "reports", icon: "📊", label: "Reports", caption: "Insights that drive change" },
  { key: "plan", icon: "🎯", label: "My Plan", caption: "Your recovery roadmap" },
];

function Section({ children, first = false }) {
  return <div style={{ padding: `${first ? 24 : 40}px 40px 0` }}>{children}</div>;
}

function SectionLabel({ n, title, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: fm.color.accentDeep, letterSpacing: 1, marginBottom: 4 }}>
        {n}. {title.toUpperCase()}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: fm.color.textTertiary }}>{sub}</div>}
    </div>
  );
}

/**
 * FocusModeSettings
 * Props:
 *   onDeleteAccount — the real App.jsx handleReset callback (full wipe +
 *                     sign-out + return to onboarding). Reused as-is for
 *                     "Delete Account Data" — nothing duplicated.
 *   onNavigate, onOpenProfile
 */
export default function FocusModeSettings({ uid, onDeleteAccount, onNavigate, onOpenProfile }) {
  const snapshot = readSynapseSnapshot();
  const archetype = readArchetype();
  const longest = longestStreak(snapshot.history, snapshot.streak);

  const [tone, setTone] = useState(() => getTone());
  const [notif, setNotif] = useState(() => readNotificationPrefs());
  const [uiMode, setUiMode] = useState(() => readUIMode());
  const [confirmAction, setConfirmAction] = useState(null); // 'resetProgress' | 'deleteRecovery' | 'deleteAccount'
  const [isSavingTone, setIsSavingTone] = useState(false);
  const [isSavingUiMode, setIsSavingUiMode] = useState(false);
  const [isSavingNotif, setIsSavingNotif] = useState(false);

  // Notification system state
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const activeTimersRef = useRef({}); // Store active timer IDs for cleanup

  // Single realtime listener for settings
  useEffect(() => {
    if (!uid) {
      // No user: rely on localStorage only; no listener needed
      return;
    }
    let unsubscribed = false;
    const unsubscribe = onSnapshot(doc(db, "users", uid), (snap) => {
      if (unsubscribed) return;
      const data = snap.data();
      const settings = data?.settings || {};

      // Update React state with Firestore values (fallback to localStorage if missing)
      const newTone = settings.tone ?? getTone();
      const newUiMode = settings.uiMode ?? readUIMode();
      const newNotif = {
        ...readNotificationPrefs(), // start with localStorage/defaults
        ...(settings.notifications || {}),
      };

      // Only update state if changed to avoid unnecessary re-renders
      if (tone?.id !== newTone.id) setTone(newTone);
      if (uiMode !== newUiMode) setUiMode(newUiMode);
      if (JSON.stringify(notif) !== JSON.stringify(newNotif)) setNotif(newNotif);

      // Update localStorage cache for other parts of the app
      ls.set("syn_mode", newTone.id);
      ls.set("syn_ui_mode", newUiMode);
      Object.entries(newNotif).forEach(([key, value]) => {
        if (NOTIF_KEYS[key]) {
          ls.set(NOTIF_KEYS[key], String(value));
        }
      });

      // Increment version to trigger re-render in children that depend on these values
      setSettingsVersion(v => v + 1);
    }, (error) => {
      console.error("Error fetching settings:", error);
      showToast("Failed to load settings. Using cached data.");
    });

    return () => {
      unsubscribed = true;
      unsubscribe();
    };
  }, [uid]);

  
  // Request notification permission when needed
  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    // Permission is 'default', ask the user
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  };

  // Show a browser notification
  const showNotification = (title, body) => {
    if (typeof Notification === 'undefined' || notificationPermission !== 'granted') {
      return false;
    }

    try {
      new Notification(title, { body });
      return true;
    } catch (error) {
      console.error('Error showing notification:', error);
      return false;
    }
  };

  // Calculate next trigger time for a notification
  const calculateNextTrigger = (notificationType, reminderTime, timezone) => {
    // Default to 20:00 if no time set or invalid
    let timeStr = reminderTime;
    if (!timeStr || typeof timeStr !== 'string') {
      timeStr = '20:00';
    }
    const [hours, minutes] = timeStr.split(':').map(Number);

    const now = new Date();
    let targetTime;

    // Handle timezone if provided
    if (timezone) {
      try {
        // Create time in specified timezone
        targetTime = new Date().toLocaleString('en-US', {
          timeZone: timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        // Parse back to Date object - simplified approach
        const [datePart, timePart] = targetTime.split(', ');
        const [timeOnly] = timePart.split(' ');
        const [targetHours, targetMinutes, targetSeconds] = timeOnly.split(':').map(Number);

        targetTime = new Date();
        targetTime.setHours(targetHours, targetMinutes, targetSeconds, 0);
      } catch (e) {
        console.warn('Invalid timezone, using local time:', e);
        targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);
      }
    } else {
      targetTime = new Date();
      targetTime.setHours(hours, minutes, 0, 0);
    }

    // If target time has already passed today, schedule for tomorrow
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    return targetTime.getTime();
  };

  // Check if current time is within quiet hours
  const isWithinQuietHours = (quietHoursStart, quietHoursEnd, timezone) => {
    if (!quietHoursStart || !quietHoursEnd) return false;

    try {
      const now = new Date();
      let nowTime;

      if (timezone) {
        // Simplified timezone handling for quiet hours
        nowTime = now.toLocaleTimeString('en-US', {
          timeZone: timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        });
      } else {
        nowTime = now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      const [nowHours, nowMinutes] = nowTime.split(':').map(Number);
      const nowTotalMinutes = nowHours * 60 + nowMinutes;

      const [startHours, startMinutes] = quietHoursStart.split(':').map(Number);
      const [endHours, endMinutes] = quietHoursEnd.split(':').map(Number);
      const startTotalMinutes = startHours * 60 + startMinutes;
      const endTotalMinutes = endHours * 60 + endMinutes;

      // Handle overnight quiet hours (e.g., 22:00 to 06:00)
      if (startTotalMinutes > endTotalMinutes) {
        return nowTotalMinutes >= startTotalMinutes || nowTotalMinutes <= endTotalMinutes;
      } else {
        return nowTotalMinutes >= startTotalMinutes && nowTotalMinutes <= endTotalMinutes;
      }
    } catch (e) {
      console.warn('Error checking quiet hours:', e);
      return false;
    }
  };

  // Schedule notifications for a specific type
  const scheduleNotification = (notificationType) => {
    // Clear any existing timer for this type
    if (activeTimersRef.current[notificationType]) {
      clearTimeout(activeTimersRef.current[notificationType]);
    }

    // Don't schedule if notification is disabled or silent mode is on
    if (!notif[notificationType] || notif.silentMode) {
      return;
    }

    // Don't schedule if we don't have permission
    if (notificationPermission !== 'granted') {
      return;
    }

    // Get reminder time (default to daily reminder time for most types)
    let reminderTime = notif.reminderTime;
    if (notificationType === 'weekly') {
      // Weekly notifications could have their own time, but we'll use the same for simplicity
      reminderTime = notif.weeklyTime || notif.reminderTime;
    }

    // Calculate next trigger time
    const triggerTime = calculateNextTrigger(notificationType, reminderTime, notif.timezone);
    const now = Date.now();
    const delay = triggerTime - now;

    // Only schedule if in the future
    if (delay > 0) {
      // Check quiet hours
      if (isWithinQuietHours(notif.quietHoursStart, notif.quietHoursEnd, notif.timezone)) {
        // If in quiet hours, schedule for after quiet hours end
        // Simplified: just add 1 hour to quiet hours end for demo
        const adjustedTime = new Date(triggerTime);
        adjustedTime.setHours(adjustedTime.getHours() + 1);
        const adjustedDelay = adjustedTime.getTime() - now;

        const timerId = setTimeout(() => {
          triggerNotification(notificationType);
          // Reschedule for next occurrence
          scheduleNotification(notificationType);
        }, adjustedDelay > 0 ? adjustedDelay : 0);

        activeTimersRef.current = {
          ...activeTimersRef.current,
          [notificationType]: timerId
        };
      } else {
        // Not in quiet hours, schedule normally
        const timerId = setTimeout(() => {
          triggerNotification(notificationType);
          // Reschedule for next occurrence
          scheduleNotification(notificationType);
        }, delay);

        activeTimersRef.current = {
          ...activeTimersRef.current,
          [notificationType]: timerId
        };
      }
    }
  };

  // Trigger a notification
  const triggerNotification = (notificationType) => {
    // Double-check conditions before showing
    if (!notif[notificationType] || notif.silentMode || notificationPermission !== 'granted') {
      return;
    }

    if (isWithinQuietHours(notif.quietHoursStart, notif.quietHoursEnd, notif.timezone)) {
      return; // Still in quiet hours
    }

    // Notification title and body based on type
    let title, body;

    switch (notificationType) {
      case 'checkin':
        title = 'Daily Check-in';
        body = 'Time for today\'s recovery check-in.';
        break;
      case 'journal':
        title = 'Recovery Plan Reminder';
        body = 'Continue your recovery journey.';
        break;
      case 'urge':
        title = 'Streak Protection Reminder';
        body = 'Don\'t lose today\'s streak.';
        break;
      case 'weekly':
        title = 'Weekly Progress Report';
        body = 'Your weekly recovery report is ready.';
        break;
      case 'milestones':
        title = 'Achievement Notifications';
        body = 'You\'re making real progress.';
        break;
      default:
        title = 'SYNAPSE Reminder';
        body = 'This is a reminder from SYNAPSE.';
    }

    showNotification(title, body);
  };

  // Set up all scheduled notifications
  useEffect(() => {
    // Clear existing timers
    Object.values(activeTimersRef.current).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    activeTimersRef.current = {};

    // Don't proceed if notifications are disabled globally or we don't have permission
    if (!notif.dailyMaster || notificationPermission !== 'granted') {
      return;
    }

    // Schedule each notification type
    const notificationTypes = ['checkin', 'journal', 'urge', 'weekly', 'milestones'];
    notificationTypes.forEach(type => {
      scheduleNotification(type);
    });

    // Cleanup on unmount
    return () => {
      Object.values(activeTimersRef.current).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
      activeTimersRef.current = {};
    };
  }, [notif, notificationPermission]);

  // Handle notification toggle with permission checking
  const handleNotifToggle = async (key, val) => {
    // Special handling for dailyMaster - if turning on and we don't have permission, request it
    if (key === 'dailyMaster' && val === true) {
      if (notificationPermission !== 'granted') {
        const permissionGranted = await requestNotificationPermission();
        if (!permissionGranted) {
          // User denied or didn't grant permission, don't enable the toggle
          setNotif(prev => ({ ...prev, [key]: false }));
          return;
        }
      }
    }

    setIsSavingNotif(true);
    try {
      // Update localStorage immediately
      const current = readNotificationPrefs();
      const next = { ...current, [key]: val };
      writeLocalNotifCache(next);
      // Update React state immediately
      setNotif(next);
      // Then sync to Firestore
      await setNotificationPrefInSettings(uid, key, val);

      // If we just enabled notifications globally, schedule them
      if (key === 'dailyMaster' && val === true && notificationPermission === 'granted') {
        // Reschedule all notifications
        Object.values(activeTimersRef.current).forEach(timer => {
          if (timer) clearTimeout(timer);
        });
        activeTimersRef.current = {};

        const notificationTypes = ['checkin', 'journal', 'urge', 'weekly', 'milestones'];
        notificationTypes.forEach(type => {
          if (notif[type]) {
            scheduleNotification(type);
          }
        });
      }

      // If we just disabled notifications globally, clear timers
      if (key === 'dailyMaster' && val === false) {
        Object.values(activeTimersRef.current).forEach(timer => {
          if (timer) clearTimeout(timer);
        });
        activeTimersRef.current = {};
      }
    } catch (error) {
      console.error("Failed to save notification preference:", error);
      // Optionally revert the optimistic update on error
    } finally {
      setIsSavingNotif(false);
    }
  };

  const privacy = readPrivacyCounts();
  const features = readConnectedFeatures();

  const handleToneSelect = async (id) => {
    setIsSavingTone(true);
    try {
      const toneObj = setToneLS(id); // update localStorage immediately
      setTone(toneObj);
      await setToneInSettings(uid, id);
    } catch (error) {
      console.error("Failed to save tone:", error);
      // TODO: show toast
    } finally {
      setIsSavingTone(false);
    }
  };

  const handleUiMode = async (mode) => {
    setIsSavingUiMode(true);
    try {
      setUIModeLS(mode);
      setUiMode(mode);
      await setUiModeInSettings(uid, mode);
    } catch (error) {
      console.error("Failed to save UI mode:", error);
      // TODO: show toast
    } finally {
      setIsSavingUiMode(false);
    }
  };

  const confirmMap = {
    resetProgress: {
      title: "Reset Progress?",
      description: "This clears your streak, check-in history, urge log, and plan progress. Your account, journal, and chat history are kept.",
      confirmLabel: "Reset Progress",
      onConfirm: () => {
        resetRecoveryProgress();
        setConfirmAction(null);
        onNavigate?.("home");
      },
    },
    deleteRecovery: {
      title: "Delete Recovery Data?",
      description: "This permanently deletes your streak, check-ins, urge log, triggers, and plan. Your journal and account stay intact. This cannot be undone.",
      confirmLabel: "Delete Recovery Data",
      onConfirm: () => {
        resetRecoveryProgress();
        setConfirmAction(null);
        onNavigate?.("home");
      },
    },
    deleteAccount: {
      title: "Delete Account Data?",
      description: "This permanently deletes everything — profile, journal, chats, history, plans, and settings. Equivalent to a full factory reset. This cannot be undone.",
      confirmLabel: "Delete Everything",
      onConfirm: () => {
        setConfirmAction(null);
        onDeleteAccount?.();
      },
    },
  };

  return (
    <FocusModeShell>
      <Sidebar active="settings" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <Section first>
          <Card padding={36}>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 20, alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 8 }}>Settings</div>
                <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.6 }}>Customize how SYNAPSE supports your recovery journey.</p>
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <NeuronArt size={130} color={fm.color.accent} />
              </div>
            </div>
          </Card>
        </Section>

        {/* ── 1. Recovery Preferences ────────────────────────────── */}
        <Section>
          <SectionLabel n={1} title="Recovery Preferences" />
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr 0.9fr", gap: 20, alignItems: "start" }}>
            <Card padding={24}>
              <Eyebrow style={{ marginBottom: 2 }}>Recovery Tone</Eyebrow>
              <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 14 }}>Choose how your AI Coach talks to you.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.values(MODES).map((m) => (
                  <RadioCard
                    key={m.id}
                    icon={m.icon}
                    title={m.label.charAt(0) + m.label.slice(1).toLowerCase()}
                    description={m.desc}
                    selected={tone.id === m.id}
                    onSelect={() => handleToneSelect(m.id)}
                    tint={m.accent}
                    disabled={isSavingTone}
                  />
                ))}
              </div>
            </Card>

            <Card padding={24}>
              <SettingsRow
                title="Daily Reminder"
                description="Get reminded to check in daily."
                control={<Toggle checked={notif.dailyMaster} onChange={(v) => handleNotifToggle("dailyMaster", v)} disabled={isSavingNotif} />}
              />
              <div style={{ height: 1, background: fm.color.border, margin: "8px 0 16px" }} />
              <Eyebrow style={{ marginBottom: 8 }}>Reminder Time</Eyebrow>
              <input
                type="time"
                value={notif.reminderTime}
                onChange={(e) => handleNotifToggle("reminderTime", e.target.value)}
                disabled={!notif.dailyMaster || isSavingNotif}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: fm.radius.sm,
                  border: `1px solid ${fm.color.border}`,
                  background: fm.color.surfaceMuted,
                  fontSize: 13,
                  color: fm.color.textPrimary,
                  marginBottom: 16,
                  opacity: (!notif.dailyMaster || isSavingNotif) ? 0.5 : 1,
                }}
              />
              <Eyebrow style={{ marginBottom: 8 }}>Time Zone</Eyebrow>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: fm.radius.sm,
                  border: `1px solid ${fm.color.border}`,
                  background: fm.color.surfaceMuted,
                  fontSize: 12.5,
                  color: fm.color.textSecondary,
                }}
                onClick={() => {
                  // For simplicity, we'll just prompt; in a real app, you'd use a timezone picker
                  const tz = prompt("Enter timezone (e.g., America/New_York):", notif.timezone);
                  if (tz) handleNotifToggle("timezone", tz);
                }}
                style={{ cursor: isSavingNotif ? "not-allowed" : "pointer" }}
              >
                {notif.timezone}
              </div>
            </Card>

            <Card padding={22} style={{ background: `${tone.accent}0f`, border: `1px solid ${tone.accent}40` }}>
              <Eyebrow style={{ marginBottom: 14 }}>Motivation Style</Eyebrow>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>{tone.icon}</span>
                <div style={{ fontFamily: fm.font.display, fontSize: 16, fontWeight: 700, color: fm.color.textPrimary }}>{tone.label.charAt(0) + tone.label.slice(1).toLowerCase()}</div>
              </div>
              <p style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.7 }}>
                {tone.id === "operator" && "You'll get calm guidance and encouragement. Perfect for building consistency."}
                {tone.id === "commander" && "You'll get firm, balanced direction with tactical advice and disciplined coaching."}
                {tone.id === "warlord" && "You'll get brutal honesty and maximum accountability. No sugarcoating."}
              </p>
            </Card>
          </div>
        </Section>

        {/* ── 2 & 3. Notifications + Recovery Overview ───────────── */}
        <Section>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, alignItems: "start" }}>
            <Card padding={26}>
              <SectionLabel n={2} title="Notifications" sub="Manage your recovery reminders and updates." />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
                {NOTIF_ITEMS.map((n) => (
                  <div
                    key={n.key}
                    style={{
                      padding: 16,
                      borderRadius: fm.radius.md,
                      border: `1px solid ${fm.color.border}`,
                      background: fm.color.surfaceMuted,
                    }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 8 }}>{n.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{n.title}</div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 12, lineHeight: 1.4 }}>{n.desc}</div>
                    <Toggle
                      checked={notif[n.key]}
                      onChange={(v) => handleNotifToggle(n.key, v)}
                      disabled={isSavingNotif}
                    />
                  </div>
                ))}
              </div>
            </Card>

            <Card padding={26}>
              <SectionLabel n={3} title="Recovery Overview" sub="Your current recovery status." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <MetricCard icon="🔥" value={snapshot.streak} label="Current Streak" tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
                <MetricCard icon="🏆" value={longest} label="Longest Streak" tint={fm.color.warning} tintSoft={fm.color.warningSoft} />
                <MetricCard icon="🌀" value={snapshot.level.title.charAt(0) + snapshot.level.title.slice(1).toLowerCase()} label="Current Phase" tint={fm.color.info} tintSoft={fm.color.infoSoft} />
                <MetricCard icon="◆" value={archetype ? archetype.title.charAt(0) + archetype.title.slice(1).toLowerCase() : "None"} label="Archetype" tint={fm.color.success} tintSoft={fm.color.successSoft} />
              </div>
            </Card>
          </div>
        </Section>

        {/* ── 4 & 5. Privacy + Appearance ─────────────────────────── */}
        <Section>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, alignItems: "start" }}>
            <Card padding={26}>
              <SectionLabel n={4} title="Privacy & Security" sub="Your data is yours. Always." />
              <SettingsRow icon="📍" title="Local Data Status" description="All your data is stored locally on this device." meta={<span style={{ color: fm.color.success, fontWeight: 700 }}>Secure</span>} />
              <SettingsRow icon="⚡" title="Chat History" description="AI conversations and coach interactions." meta={`${privacy.chatCount} items`} />
              <SettingsRow icon="📖" title="Journal Entries" description="Your thoughts, reflections and breakthroughs." meta={`${privacy.journalCount} entries`} />
              <SettingsRow icon="📊" title="Recovery Logs" description="Check-ins, urges, wins and slips." meta={`${privacy.recoveryLogCount} logs`} />
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <Button variant="ghost" size="sm" onClick={exportAllSynapseData} style={{ flex: 1, justifyContent: "center" }}>
                  ↓ Export Recovery Data
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmAction("deleteRecovery")}
                  style={{ flex: 1, justifyContent: "center", color: fm.color.danger, borderColor: fm.color.dangerBorder }}
                  disabled={false}
                >
                  🗑 Delete My Recovery Data
                </Button>
              </div>
            </Card>

            <Card padding={26}>
              <SectionLabel n={5} title="Appearance" sub="Choose your preferred experience." />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                <RadioCard
                  icon="☀️"
                  title="Focus Mode"
                  description="Clean, light and distraction-free."
                  selected={uiMode === "focus"}
                  onSelect={() => handleUiMode("focus")}
                  disabled={isSavingUiMode}
                />
                <RadioCard
                  icon="🌙"
                  title="Command Mode"
                  description="High contrast for deep focus."
                  selected={uiMode === "command"}
                  onSelect={() => handleUiMode("command")}
                  disabled={isSavingUiMode}
                />
              </div>
              <div style={{ fontSize: 10.5, color: fm.color.textTertiary }}>
                Current Theme: <strong style={{ color: fm.color.accent }}>{uiMode === "focus" ? "Focus Mode (Active)" : "Command Mode (Active)"}</strong>
              </div>
            </Card>
          </div>
        </Section>

        {/* ── 6. Connected Features ───────────────────────────────── */}
        <Section>
          <Card padding={26}>
            <SectionLabel n={6} title="Connected Features" sub="Core features that power your recovery." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
              {FEATURE_ITEMS.map((f) => (
                <div
                  key={f.key}
                  style={{
                    padding: 18,
                    borderRadius: fm.radius.md,
                    border: `1px solid ${fm.color.border}`,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 10 }}>{f.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 10 }}>{f.caption}</div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: features[f.key] ? fm.color.success : fm.color.textTertiary,
                    }}
                  >
                    {features[f.key] ? "● Connected" : "○ Ready"}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* ── 7. About SYNAPSE ─────────────────────────────────────── */}
        <Section>
          <Card padding={26}>
            <SectionLabel n={7} title="About SYNAPSE" sub="Built with purpose. Backed by science." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14 }}>
              <AboutTile icon="ℹ️" label="Version" value="v1.0" />
              <AboutTile icon="👤" label="Built By" value="Parth Goyal & Sandali Tiwari" />
              <AboutTile icon="{ }" label="Build" value="Focus Mode" />
              <AboutTile icon="🔒" label="Privacy Policy" value="Read Policy" link onClick={() => onNavigate?.("about")} />
              <AboutTile icon="📄" label="Terms of Use" value="Read Terms" link onClick={() => onNavigate?.("about")} />
              <AboutTile icon="💬" label="Feedback" value="Send Feedback" link onClick={() => window.open("mailto:parthgoyal379@gmail.com?subject=SYNAPSE Feedback", "_blank")} />
            </div>
          </Card>
        </Section>

        {/* ── 8. Danger Zone ───────────────────────────────────────── */}
        <Section>
          <Card padding={26} style={{ border: `1px solid ${fm.color.dangerBorder}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: fm.color.danger, letterSpacing: 1, marginBottom: 4 }}>DANGER ZONE</div>
            <div style={{ fontSize: 11.5, color: fm.color.textTertiary, marginBottom: 16 }}>These actions are permanent and cannot be undone.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <DangerAction
                icon="↺"
                title="Reset Progress"
                description="This will reset your streak and progress. Journal, account, and chats are kept."
                onClick={() => setConfirmAction("resetProgress")}
              />
              <DangerAction
                icon="🗑"
                title="Delete Account Data"
                description="This will delete everything forever."
                onClick={() => setConfirmAction("deleteAccount")}
              />
            </div>
          </Card>
        </Section>
      </main>

      {confirmAction && (
        <ConfirmModal
          title={confirmMap[confirmAction].title}
          description={confirmMap[confirmAction].description}
          confirmLabel={confirmMap[confirmAction].confirmLabel}
          onConfirm={confirmMap[confirmAction].onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </FocusModeShell>
  );
}

function AboutTile({ icon, label, value, link, onClick }) {
  const content = (
    <>
      <div style={{ fontSize: 15, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: link ? fm.color.accent : fm.color.textPrimary }}>{value}</div>
    </>
  );
  return link ? (
    <button onClick={onClick} style={{ textAlign: "center", padding: "16px 8px", borderRadius: fm.radius.md, border: `1px solid ${fm.color.border}`, background: "none" }}>
      {content}
    </button>
  ) : (
    <div style={{ textAlign: "center", padding: "16px 8px", borderRadius: fm.radius.md, border: `1px solid ${fm.color.border}` }}>{content}</div>
  );
}