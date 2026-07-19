import { useEffect, useState } from "react";
import { fm } from "./theme";
import {
  readSynapseSnapshot,
  readArchetype,
  MODES,
  readNotificationPrefs,
  setNotificationPrefCloud,
  subscribeNotificationPrefs,
  toggleSilentMode,
  readUIMode,
  setUIMode,
  readPrivacyCounts,
  readConnectedFeatures,
  exportAllSynapseData,
  resetRecoveryProgress,
  longestStreak,
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
  return <div style={{ padding: `clamp(14px,4vw,${first ? 24 : 40}px) clamp(14px,4vw,40px) 0` }}>{children}</div>;
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
export default function FocusModeSettings({ uid, coach, onDeleteAccount, onNavigate, onOpenProfile }) {
  const snapshot = readSynapseSnapshot();
  const archetype = readArchetype();
  const longest = longestStreak(snapshot.history, snapshot.streak);

  // Tone is the literal shared state from App.jsx's useCoachChat() — the
  // same object <FocusModeCoach/> and Command Mode's <Chat/> read. Selecting
  // a tone here calls the real coach.switchMode(), so every AI response
  // anywhere in the app picks it up instantly — no separate tone copy.
  const tone = coach?.mode || MODES.commander;
  const [notif, setNotif] = useState(readNotificationPrefs());
  const [notifLoaded, setNotifLoaded] = useState(!uid); // no account = local is already the full picture
  const [saveError, setSaveError] = useState(null); // { key, value } of the last failed toggle
  const [uiMode, setUiModeState] = useState(readUIMode());
  const [confirmAction, setConfirmAction] = useState(null); // 'resetProgress' | 'deleteRecovery' | 'deleteAccount'

  // Cross-device sync: any change made on another device (or a Cloud
  // Function's idempotency stamp) shows up here in real time.
  useEffect(() => {
    const unsub = subscribeNotificationPrefs(uid, (prefs) => {
      setNotif(prefs);
      setNotifLoaded(true);
    });
    return unsub;
  }, [uid]);

  const privacy = readPrivacyCounts();
  const features = readConnectedFeatures();

  const handleToneSelect = (m) => coach?.switchMode?.(m);

  const handleNotifToggle = async (key, val, { isRetry = false } = {}) => {
    if (!isRetry) setSaveError(null);
    if (key === "silentMode") {
      const next = await toggleSilentMode(uid, val);
      setNotif(next);
      return;
    }
    const { prefs, synced } = await setNotificationPrefCloud(uid, key, val);
    setNotif(prefs); // local cache already reflects the change even if the cloud write failed
    if (!synced) setSaveError({ key, value: val });
  };
  const handleUiMode = (mode) => {
    setUIMode(mode);
    setUiModeState(mode);
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
      requireTypedConfirm: "DELETE",
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
      requireTypedConfirm: "DELETE",
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
              <div style={{ flex: "1.3 1 220px", minWidth: 0 }}>
                <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 8 }}>Settings</div>
                <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.6 }}>Customize how SYNAPSE supports your recovery journey.</p>
              </div>
              <div style={{ display: "flex", justifyContent: "center", flex: "0.7 1 120px", minWidth: 0 }}>
                <NeuronArt size={130} color={fm.color.accent} />
              </div>
            </div>
          </Card>
        </Section>

        {/* ── 1. Recovery Preferences ────────────────────────────── */}
        <Section>
          <SectionLabel n={1} title="Recovery Preferences" />
          <div data-fm-grid="3" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr 0.9fr", gap: 20, alignItems: "start" }}>
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
                    onSelect={() => handleToneSelect(m)}
                    tint={m.accent}
                  />
                ))}
              </div>
            </Card>

            <Card padding={24}>
              <SettingsRow
                title="Daily Reminder"
                description="Get reminded to check in daily."
                control={<Toggle checked={notif.dailyMaster} onChange={(v) => handleNotifToggle("dailyMaster", v)} />}
              />
              <div style={{ height: 1, background: fm.color.border, margin: "8px 0 16px" }} />
              <Eyebrow style={{ marginBottom: 8 }}>Reminder Time</Eyebrow>
              <input
                type="time"
                value={notif.reminderTime}
                onChange={(e) => handleNotifToggle("reminderTime", e.target.value)}
                disabled={!notif.dailyMaster}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: fm.radius.sm,
                  border: `1px solid ${fm.color.border}`,
                  background: fm.color.surfaceMuted,
                  fontSize: 13,
                  color: fm.color.textPrimary,
                  marginBottom: 16,
                  opacity: notif.dailyMaster ? 1 : 0.5,
                }}
              />
              <Eyebrow style={{ marginBottom: 8 }}>Time Zone</Eyebrow>
              <div style={{ padding: "10px 14px", borderRadius: fm.radius.sm, border: `1px solid ${fm.color.border}`, background: fm.color.surfaceMuted, fontSize: 12.5, color: fm.color.textSecondary }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20, alignItems: "start" }}>
            <Card padding={26}>
              <SectionLabel n={2} title="Notifications" sub="Manage your recovery reminders and updates." />
              <div data-fm-grid="2" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
                {NOTIF_ITEMS.map((n) => (
                  <div key={n.key} style={{ padding: 16, borderRadius: fm.radius.md, border: `1px solid ${fm.color.border}`, background: fm.color.surfaceMuted }}>
                    <div style={{ fontSize: 18, marginBottom: 8 }}>{n.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{n.title}</div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 12, lineHeight: 1.4 }}>{n.desc}</div>
                    <Toggle checked={notif[n.key]} onChange={(v) => handleNotifToggle(n.key, v)} />
                  </div>
                ))}
              </div>
            </Card>

            <Card padding={26}>
              <SectionLabel n={3} title="Recovery Overview" sub="Your current recovery status." />
              <div data-fm-grid="2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20, alignItems: "start" }}>
            <Card padding={26}>
              <SectionLabel n={4} title="Privacy & Security" sub="Your data is yours. Always." />
              <SettingsRow icon="📍" title="Local Data Status" description="All your data is stored locally on this device." meta={<span style={{ color: fm.color.success, fontWeight: 700 }}>Secure</span>} />
              <SettingsRow icon="⚡" title="Chat History" description="AI conversations and coach interactions." meta={`${privacy.chatCount} items`} />
              <SettingsRow icon="📖" title="Journal Entries" description="Your thoughts, reflections and breakthroughs." meta={`${privacy.journalCount} entries`} />
              <SettingsRow icon="📊" title="Recovery Logs" description="Check-ins, urges, wins and slips." meta={`${privacy.recoveryLogCount} logs`} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                <Button variant="ghost" size="sm" onClick={exportAllSynapseData} style={{ flex: 1, justifyContent: "center" }}>
                  ↓ Export Recovery Data
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmAction("deleteRecovery")} style={{ flex: 1, justifyContent: "center", color: fm.color.danger, borderColor: fm.color.dangerBorder }}>
                  🗑 Delete My Recovery Data
                </Button>
              </div>
            </Card>

            <Card padding={26}>
              <SectionLabel n={5} title="Appearance" sub="Choose your preferred experience." />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                <RadioCard icon="☀️" title="Focus Mode" description="Clean, light and distraction-free." selected={uiMode === "focus"} onSelect={() => handleUiMode("focus")} />
                <RadioCard icon="🌙" title="Command Mode" description="High contrast for deep focus." selected={uiMode === "command"} onSelect={() => handleUiMode("command")} />
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
            <div data-fm-grid="5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
              {FEATURE_ITEMS.map((f) => (
                <div key={f.key} style={{ padding: 18, borderRadius: fm.radius.md, border: `1px solid ${fm.color.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 10 }}>{f.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 10 }}>{f.caption}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: features[f.key] ? fm.color.success : fm.color.textTertiary }}>
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
            <div data-fm-grid="6" style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px,100%), 1fr))", gap: 12 }}>
              <DangerAction icon="↺" title="Reset Progress" description="This will reset your streak and progress. Journal, account, and chats are kept." onClick={() => setConfirmAction("resetProgress")} />
              <DangerAction icon="🗑" title="Delete Account Data" description="This will delete everything forever." onClick={() => setConfirmAction("deleteAccount")} />
            </div>
          </Card>
        </Section>

        {saveError && (
          <Section>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 18px", borderRadius: fm.radius.sm, background: fm.color.dangerSoft, border: `1px solid ${fm.color.dangerBorder}` }}>
              <span style={{ fontSize: 12, color: fm.color.danger }}>Couldn't save changes. Trying again…</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleNotifToggle(saveError.key, saveError.value, { isRetry: true })}
                style={{ borderColor: fm.color.dangerBorder, color: fm.color.danger }}
              >
                Retry
              </Button>
            </div>
          </Section>
        )}
      </main>

      {confirmAction && (
        <ConfirmModal
          title={confirmMap[confirmAction].title}
          description={confirmMap[confirmAction].description}
          confirmLabel={confirmMap[confirmAction].confirmLabel}
          requireTypedConfirm={confirmMap[confirmAction].requireTypedConfirm}
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

/* ─────────────────────────────────────────────────────────────────────────
   INTEGRATION NOTE
   ─────────────────────────────────────────────────────────────────────────
   Mount with:
     <FocusModeSettings onDeleteAccount={handleReset} onNavigate={goTo} onOpenProfile={...}/>

   `handleReset` is App.jsx's real, existing full-wipe function (clears
   syn_streak/syn_history/syn_plan/syn_user/syn_archetype/syn_confess/
   syn_trigger_log/syn_chat_history, signs out, returns to onboarding) —
   reused as-is for "Delete Account Data," not reimplemented.
──────────────────────────────────────────────────────────────────────── */