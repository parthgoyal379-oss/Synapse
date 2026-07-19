import { useMemo } from "react";
import { fm, phaseColor } from "./theme";
import {
  readTriggerLog,
  urgeResistancePct,
  urgeResistanceTrend,
  triggerFrequency,
  peakUrgeHours,
  avgUrgeDuration,
  urgeDelaySuccessThisWeek,
  getDailyQuote,
} from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  ProgressBar,
  WeeklyTrendChart,
  DonutChart,
  EmergencyHeroCard,
  RescueActiveCard,
  PeakHoursChart,
  HistoryTimeline,
  QuickActionCard,
  StatTile,
  PillToggle,
} from "./components";

const TRIGGER_COLORS = [fm.color.danger, fm.color.accent, fm.color.warning, fm.color.success, fm.color.info, fm.color.textTertiary];
const INTENSITY_LEVELS = ["MILD", "MODERATE", "INTENSE", "OVERWHELMING"];

/**
 * FocusModeUrgeLog — presentation only.
 *
 * `rescue` is the literal object returned by App.jsx's shared useRescue()
 * hook (see the extraction note at the bottom of this file) — the exact
 * same object Command Mode's <UrgeTimer/> is driven by. This screen never
 * holds its own timer/task/log state; it only renders `rescue` and calls
 * back into rescue.startTimer() / rescue.logUrge() / rescue.newTask() /
 * rescue.setIntensity(), so both UIs are always perfectly in sync — one
 * timer, one task generator, one syn_urge_log writer.
 *
 * Props:
 *   rescue                — the shared useRescue() return value
 *   streak                — real recovery streak (for the phase color/stat)
 *   onNavigate, onOpenProfile
 */
export default function FocusModeUrgeLog({ rescue, streak, onNavigate, onOpenProfile }) {
  const { active, done, task, intensity, setIntensity, urgeLog, phase, progress, mins, secs, startTimer, reset, logUrge, newTask, survived, total } = rescue;

  const triggerLog = useMemo(() => readTriggerLog(), []);
  const quote = useMemo(() => getDailyQuote(), []);
  const pColor = phaseColor(streak ?? 0);

  const urgePct = urgeResistancePct(urgeLog);
  const urgeTrend = urgeResistanceTrend(urgeLog);
  const triggers = triggerFrequency(triggerLog);
  const { buckets, peak } = peakUrgeHours(urgeLog);
  const duration = avgUrgeDuration(urgeLog);
  const weeklyDelayPct = urgeDelaySuccessThisWeek(urgeLog);
  const todaysSaves = urgeLog.filter((u) => u.survived && new Date(u.date).toDateString() === new Date().toDateString()).length;

  const fmtDuration = (sec) => {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const insights = [];
  if (weeklyDelayPct !== null) insights.push(`You successfully delayed ${weeklyDelayPct}% of urges this week.`);
  if (peak) insights.push(`Most urges happen during ${peak.label}.`);
  if (duration?.deltaSec != null && duration.deltaSec < 0) insights.push(`Your average urge duration dropped by ${fmtDuration(Math.abs(duration.deltaSec))} vs last week.`);

  return (
    <FocusModeShell>
      <Sidebar active="urge" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔥</span>
            <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary }}>Urge Log</div>
          </div>
          <div style={{ fontSize: 12.5, color: fm.color.textSecondary, marginTop: 4 }}>Notice the urge. Don't become it.</div>
        </div>

        {/* ── Hero / active rescue + Today's Overview ──────────── */}
        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          {!active && !done && (
            <Card padding={36} style={{ flex: "1.7 1 320px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: fm.radius.sm, background: fm.color.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                  ⚡
                </div>
              </div>
              <div style={{ fontFamily: fm.font.display, fontSize: 28, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 10 }}>Feeling an Urge Right Now?</div>
              <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.7, maxWidth: 420, marginBottom: 20 }}>
                When you wait, urges naturally weaken. Rate it, then start a 10-minute recovery mission before reacting.
              </p>
              <div style={{ fontSize: 11, color: fm.color.textTertiary, marginBottom: 10, fontWeight: 600, letterSpacing: 0.3 }}>RATE THE INTENSITY</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
                {INTENSITY_LEVELS.map((lvl) => (
                  <PillToggle key={lvl} label={lvl} active={intensity === lvl} tint={fm.color.accent} size="md" onClick={() => setIntensity(lvl)} />
                ))}
              </div>
              <Button variant="primary" size="lg" onClick={startTimer} disabled={!intensity} style={{ background: intensity ? fm.color.textPrimary : fm.color.surfaceSunken, color: intensity ? "#fff" : fm.color.textTertiary }}>
                ⚡ Start 10 Minute Rescue
              </Button>
              <div style={{ marginTop: 16, fontSize: 11, color: fm.color.textTertiary, display: "flex", alignItems: "center", gap: 6 }}>
                <span>🛡️</span>90% of urges fade within 10 minutes if you don't act on them.
              </div>
            </Card>
          )}

          {active && (
            <div style={{ flex: "1.7 1 320px", minWidth: 0 }}>
              <RescueActiveCard
                timeLabel={`${mins}:${secs}`}
                phaseLabel={phase.label}
                phaseSub={phase.sub}
                progressPct={progress}
                task={task}
                onNewTask={newTask}
                onLogSlip={() => logUrge(false)}
                color={pColor}
              />
            </div>
          )}

          {done && (
            <Card padding={36} style={{ textAlign: "center", flex: "1.7 1 320px", minWidth: 0 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>✦</div>
              <div style={{ fontFamily: fm.font.display, fontSize: 24, fontWeight: 700, color: fm.color.success, marginBottom: 10 }}>You Held the Line</div>
              <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.7, marginBottom: 22, maxWidth: 420, marginInline: "auto" }}>
                10 minutes. The urge is gone. Every time you do this, the neural pathway weakens.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <Button variant="primary" onClick={() => logUrge(true)} style={{ background: fm.color.success }}>
                  Log This Win ✓
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Reset
                </Button>
              </div>
            </Card>
          )}

          <Card padding={22} style={{ flex: "0.9 1 260px", minWidth: 0 }}>
            <Eyebrow style={{ marginBottom: 16 }}>Today's Overview</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <StatTile icon="🔥" label="Current Streak (days)" value={streak ?? 0} tint={pColor} tintSoft={`${pColor}1a`} />
              <StatTile icon="⚡" label="Urges Resisted (total)" value={survived} tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
              <StatTile icon="✅" label="Today's Saves" value={todaysSaves} tint={fm.color.info} tintSoft={fm.color.infoSoft} />
              <StatTile icon="📊" label="Success Rate" value={`${urgePct}%`} tint={fm.color.success} tintSoft={fm.color.successSoft} />
            </div>
          </Card>
        </div>

        {/* ── Success rate trend + Peak hours ──────────────────── */}
        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          <Card padding={22}>
            <Eyebrow style={{ marginBottom: 14 }}>Success Rate Over Time</Eyebrow>
            {urgeLog.length > 0 ? (
              <WeeklyTrendChart points={urgeTrend} color={fm.color.success} width={420} height={90} area grid badge badgeSuffix="%" />
            ) : (
              <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No urges logged yet.</p>
            )}
          </Card>

          <Card padding={22}>
            <Eyebrow style={{ marginBottom: 14 }}>Peak Urge Hours</Eyebrow>
            {urgeLog.length > 0 ? (
              <>
                <PeakHoursChart buckets={buckets} color={fm.color.accent} />
                {peak && (
                  <div style={{ marginTop: 12, fontSize: 11, color: fm.color.textTertiary }}>
                    🕐 Most active: <strong style={{ color: fm.color.textPrimary }}>{peak.label}</strong>
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>Not enough urge sessions yet to find a pattern.</p>
            )}
          </Card>
        </div>

        {/* ── Triggers + Urge survival rate ─────────────────────── */}
        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20 }}>
          <Card padding={22} style={{ flex: "1.1 1 280px", minWidth: 0 }}>
            <Eyebrow style={{ marginBottom: 4 }}>Most Common Triggers</Eyebrow>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 14 }}>From your logged check-ins</div>
            {triggers.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
                <DonutChart
                  size={100}
                  thickness={14}
                  centerValue={triggers.reduce((s, t) => s + t.count, 0)}
                  centerLabel="Tagged"
                  segments={triggers.map((t, i) => ({ value: t.count, color: TRIGGER_COLORS[i % TRIGGER_COLORS.length] }))}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {triggers.map((t, i) => (
                    <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: TRIGGER_COLORS[i % TRIGGER_COLORS.length], flexShrink: 0 }} />
                      <span style={{ color: fm.color.textPrimary, fontWeight: 600 }}>{t.label}</span>
                      <span style={{ color: fm.color.textTertiary }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No triggers tagged yet — these show up once logged in Check-In.</p>
            )}
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: "0.9 1 240px", minWidth: 0 }}>
            <Card padding={22}>
              <Eyebrow style={{ marginBottom: 6 }}>Average Urge Duration</Eyebrow>
              <div style={{ fontFamily: fm.font.display, fontSize: 26, fontWeight: 700, color: fm.color.textPrimary }}>{fmtDuration(duration?.avgSec)}</div>
              {duration?.deltaSec != null && (
                <div style={{ fontSize: 11, color: duration.deltaSec < 0 ? fm.color.success : fm.color.warning, marginTop: 4 }}>
                  {duration.deltaSec < 0 ? "↓" : "↑"} {fmtDuration(Math.abs(duration.deltaSec))} vs last week
                </div>
              )}
            </Card>

            <Card padding={22}>
              <Eyebrow style={{ marginBottom: 10 }}>Urge Survival Rate</Eyebrow>
              <ProgressBar pct={urgePct} color={fm.color.success} height={8} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <span style={{ fontSize: 11, color: fm.color.textTertiary }}>{survived} survived</span>
                <span style={{ fontFamily: fm.font.display, fontSize: 16, fontWeight: 700, color: fm.color.success }}>{urgePct}%</span>
              </div>
            </Card>
          </div>
        </div>

        {/* ── Recent sessions + Insight + Quick actions ────────── */}
        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          <Card padding={26} style={{ flex: "1.3 1 280px", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <Eyebrow>Recent Rescue Sessions</Eyebrow>
              {urgeLog.length > 5 && (
                <button onClick={() => onNavigate?.("report")} style={{ background: "none", border: "none", fontSize: 10.5, color: fm.color.accent, fontWeight: 600 }}>
                  View All →
                </button>
              )}
            </div>
            {urgeLog.length > 0 ? (
              <HistoryTimeline
                rows={urgeLog.slice(0, 6).map((u) => ({
                  timeLabel: new Date(u.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                  title: u.intensity ? u.intensity.charAt(0) + u.intensity.slice(1).toLowerCase() : "Urge session",
                  meta: u.duration ? fmtDuration(u.duration) : null,
                  survived: u.survived,
                }))}
                renderStatus={(r) => (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: r.survived ? fm.color.success : fm.color.danger }}>{r.survived ? "Survived" : "Slip"}</span>
                )}
              />
            ) : (
              <p style={{ fontSize: 12.5, color: fm.color.textTertiary, padding: "12px 0" }}>No rescue sessions logged yet — your first one will show up here.</p>
            )}
          </Card>

          <Card padding={22}>
            <Eyebrow style={{ marginBottom: 10 }}>Recovery Insight</Eyebrow>
            {insights.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.map((text, i) => (
                  <div key={i} style={{ fontSize: 12, color: fm.color.textPrimary, lineHeight: 1.6, padding: "10px 12px", background: fm.color.accentSoft, borderRadius: fm.radius.sm }}>
                    {text}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <p style={{ fontFamily: fm.font.display, fontSize: 14, fontStyle: "italic", color: fm.color.textPrimary, lineHeight: 1.6, marginBottom: 6 }}>"{quote.q}"</p>
                <div style={{ fontSize: 10.5, color: fm.color.textTertiary }}>— {quote.a}</div>
              </>
            )}
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <QuickActionCard icon="⚡" label="Talk to AI Coach" sublabel="Get instant support" onClick={() => onNavigate?.("chat")} tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
            <QuickActionCard icon="📊" label="Open Report" sublabel="Full history & trends" onClick={() => onNavigate?.("report")} tint={fm.color.info} tintSoft={fm.color.infoSoft} />
            <QuickActionCard icon="🎯" label="View Battle Plan" sublabel="Your protocol" onClick={() => onNavigate?.("plan")} tint={fm.color.warning} tintSoft={fm.color.warningSoft} />
          </div>
        </div>
      </main>
    </FocusModeShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   INTEGRATION (App.jsx side — the extraction requested in this round)
   ─────────────────────────────────────────────────────────────────────────
   App.jsx now has a standalone useRescue() hook (placed right before
   UrgeTimer), called once in AppRoot:

     const rescue = useRescue();
     ...
     {screen==="urge" && <UrgeTimer streak={streak} savedPlan={savedPlan} rescue={rescue}/>}

   UrgeTimer's own useState/useEffect for the timer were removed — it now
   destructures everything from the `rescue` prop instead. Behavior is
   unchanged (same DURATION, same URGE_TASKS, same URGE_PHASES, same
   syn_urge_log writes) — only where the state lives moved.

   Mount this screen with the same object:

     <FocusModeUrgeLog rescue={rescue} streak={streak} onNavigate={goTo} onOpenProfile={...}/>

   Because both components read/drive the literal same `rescue` object,
   starting the rescue from Focus Mode and switching to Command Mode (or
   vice versa) mid-session shows the identical running timer — there is
   only one timer, one task generator, and one syn_urge_log writer.
──────────────────────────────────────────────────────────────────────── */