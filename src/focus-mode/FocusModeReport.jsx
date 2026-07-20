import { useMemo, useState } from "react";
import { Flame, Shield, Target, Clock, TrendingUp, Download, Share2, Sparkles, Lock, Check } from "lucide-react";
import { fm, phaseColor, useResponsive } from "./theme";
import { DebugOverflow } from "./DebugOverflow";
import {
  readSynapseSnapshot,
  readTriggerLog,
  readArchetype,
  longestStreak,
  verdictDistribution,
  weeklyHeatmapData,
  missionPerformance,
  missionDailySeries,
  missionRunStats,
  urgeResistancePct,
  urgeResistanceTrend,
  peakUrgeHours,
  urgePeakWeekday,
  avgUrgeDuration,
  triggerFrequency,
  reportConsistencyPct,
  consistencyMonthOverMonth,
  recoveryScore,
  disciplineScore,
  weeklySummaryBreakdown,
  streakRunStats,
  inferStrengthsAndGrowth,
  computeAchievements,
  exportAllSynapseData,
} from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  VerdictBadge,
  MetricCard,
  DonutChart,
  WeeklyTrendChart,
  RecoveryTimeline,
  ReflectionCalendar,
  MissionProgressRow,
  Reveal,
  CountUp,
} from "./components";

const MILESTONES = [
  { label: "Day 1", days: 1 },
  { label: "Day 7", days: 7 },
  { label: "Day 14", days: 14 },
  { label: "Day 30", days: 30 },
  { label: "Day 60", days: 60 },
  { label: "Day 90", days: 90 },
];
const hoverClass = (tier) => `fm-hover-card fm-hover-card--${tier}`;
const SHADOW = {
  primary: "0 24px 60px -18px rgba(42,32,20,0.22)",
  secondary: "0 16px 40px -14px rgba(42,32,20,0.18)",
  small: "0 10px 25px -10px rgba(42,32,20,0.15)",
};

export default function FocusModeReport({ onNavigate, onOpenProfile }) {
  const { isMobile } = useResponsive();
  const snapshot = useMemo(() => readSynapseSnapshot(), []);
  const triggerLog = useMemo(() => readTriggerLog(), []);
  const archetype = useMemo(() => readArchetype(), []);
  const { streak, history, addictions, urgeLog } = snapshot;

  const pColor = phaseColor(streak);
  const longest = longestStreak(history, streak);
  const consistencyPct = reportConsistencyPct(history);
  const urgePct = urgeResistancePct(urgeLog);
  const missionPerf = missionPerformance(addictions, history, triggerLog);
  const discipline = disciplineScore(missionPerf);
  const score = recoveryScore(consistencyPct, urgePct, snapshot.xpPct);
  const monthDelta = consistencyMonthOverMonth(history);
  const verdicts = verdictDistribution(history);
  const weeks = weeklySummaryBreakdown(history, 4);
  const { average: avgRun, missedDays } = streakRunStats(history, streak);
  const urgeTrend = urgeResistanceTrend(urgeLog);
  const { peak: peakHour } = peakUrgeHours(urgeLog);
  const peakWeekday = urgePeakWeekday(urgeLog);
  const duration = avgUrgeDuration(urgeLog);
  const triggers = triggerFrequency(triggerLog, 4);
  const { strengths, growth } = inferStrengthsAndGrowth(history, missionPerf, urgePct, streak);
  const achievements = computeAchievements({ history, streak, longest, urgeLog, consistencyPct });

  const streakSeries = [...history].reverse().map((h) => h.streak ?? 0).concat(streak);

  // Month calendar built from real check-in history, reusing the exact
  // same ReflectionCalendar component Journal uses — no new component.
  const now = new Date();
  const calendarCells = useMemo(() => {
    const byDate = new Map(history.map((h) => [new Date(h.date).toDateString(), h]));
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(now.getFullYear(), now.getMonth(), d);
      const h = byDate.get(date.toDateString());
      cells.push({
        day: d,
        date,
        isToday: date.toDateString() === now.toDateString(),
        entry: h ? { title: h.status?.toUpperCase(), preview: h.msg?.slice(0, 80) || "", wordCount: h.streak ?? 0 } : null,
        depth: h ? (h.status === "win" ? "breakthrough" : h.status === "mid" ? "deep" : "short") : "none",
      });
    }
    return cells;
  }, [history]);
  const CAL_DEPTH_COLORS = { none: fm.color.surfaceSunken, short: fm.color.dangerSoft, deep: fm.color.warningSoft, breakthrough: fm.color.successSoft };
  const [hoveredCell, setHoveredCell] = useState(null);

  const insights = [];
  if (monthDelta && monthDelta.delta > 0) insights.push(`Your consistency has improved ${monthDelta.delta}% compared to last month.`);
  if (peakHour) insights.push(`Your urges are most frequent during ${peakHour.label} — that's your highest-risk window.`);
  if (peakWeekday) insights.push(`${peakWeekday}s see your most logged urges. Plan ahead for that day.`);
  const worstMission = [...missionPerf].sort((a, b) => b.partial + b.slip - (a.partial + a.slip))[0];
  if (worstMission && worstMission.partial + worstMission.slip > 0) insights.push(`"${worstMission.label}" remains your most difficult mission to hold clean.`);

  return (
    <FocusModeShell>
      <DebugOverflow page="report" />
      <Sidebar active="report" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, width: "100%", paddingBottom: 60 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        {/* Header — centered */}
        <Reveal style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0", textAlign: "center" }}>
          <div style={{ fontFamily: fm.font.display, fontSize: 32, fontWeight: 600, color: fm.color.textPrimary }}>Report</div>
          <div style={{ fontSize: 13, color: fm.color.textSecondary, marginTop: 4 }}>Your complete recovery intelligence.</div>
        </Reveal>

        {/* Hero — recovery score */}
        <Reveal delay={80} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={40} style={{ boxShadow: SHADOW.primary }} className={hoverClass("primary")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 30, alignItems: "center", justifyContent: isMobile ? "center" : "flex-start" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: isMobile ? "center" : "flex-start", textAlign: isMobile ? "center" : "left", gap: 32, flex: "1 1 280px", minWidth: 0 }}>
                <ScoreRing score={score} color={pColor} />
                <div>
                  <Eyebrow style={{ marginBottom: 6 }}>Your Recovery Score</Eyebrow>
                  <div style={{ fontFamily: fm.font.display, fontSize: 15, fontWeight: 700, color: pColor, marginBottom: 4 }}>
                    {score >= 80 ? "Excellent Progress" : score >= 55 ? "Steady Progress" : "Early Days"}
                  </div>
                  {monthDelta && monthDelta.delta !== 0 ? (
                    <p style={{ fontSize: 12, color: fm.color.textSecondary, maxWidth: 240 }}>
                      Your consistency has {monthDelta.delta > 0 ? "improved" : "dropped"} by {Math.abs(monthDelta.delta)}% compared to last month.
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: fm.color.textTertiary, maxWidth: 240 }}>Keep logging — monthly comparisons appear after your second month.</p>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: "1 1 260px", minWidth: 0 }}>
                <MiniScore label="Recovery Score" value={score} color={pColor} />
                <MiniScore label="Consistency" value={consistencyPct} color={fm.color.info} />
                <MiniScore label="Urge Resistance" value={urgePct} color={fm.color.success} />
                <MiniScore label="Discipline" value={discipline} color={fm.color.warning} />
              </div>
            </div>
          </Card>
        </Reveal>

        {/* Monthly summary timeline */}
        <Reveal delay={160} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={30} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
            <Eyebrow style={{ marginBottom: 20 }}>Monthly Summary</Eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4,1fr)", gap: 16 }}>
              {weeks.map((w, i) => (
                <div key={w.label} style={{ padding: "16px 14px", borderRadius: fm.radius.md, background: fm.color.surfaceMuted, border: `1px solid ${fm.color.border}` }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: fm.color.textTertiary, marginBottom: 10 }}>{w.label.toUpperCase()}</div>
                  <div style={{ fontFamily: fm.font.display, fontSize: 22, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 6 }}>{w.checkins}</div>
                  <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 10 }}>check-ins</div>
                  <div style={{ display: "flex", gap: 10, fontSize: 10.5 }}>
                    <span style={{ color: fm.color.success, fontWeight: 700 }}>{w.wins}W</span>
                    <span style={{ color: fm.color.danger, fontWeight: 700 }}>{w.slips}S</span>
                    {w.streak != null && <span style={{ color: fm.color.textTertiary, marginLeft: "auto" }}>streak {w.streak}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>

        {/* Big chart */}
        <Reveal delay={240} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={30} style={{ boxShadow: SHADOW.primary }} className={hoverClass("primary")}>
            <Eyebrow style={{ marginBottom: 4 }}>Recovery Progress</Eyebrow>
            <div style={{ fontSize: 11, color: fm.color.textTertiary, marginBottom: 18 }}>Your streak trajectory over time</div>
            {streakSeries.length > 1 ? (
              <WeeklyTrendChart points={streakSeries} color={pColor} width={960} height={180} area grid badge drawIn />
            ) : (
              <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>Check in a few more days to see your trend.</p>
            )}
          </Card>
        </Reveal>

        {/* Heatmap + Verdict donut */}
        <div style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          <Reveal delay={300} style={{ flex: "1.2 1 300px", minWidth: 0 }}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Check-In Calendar</Eyebrow>
              <ReflectionCalendar
                monthLabel={now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                cells={calendarCells}
                depthColors={CAL_DEPTH_COLORS}
                onPrevMonth={() => {}}
                onNextMonth={() => {}}
                onHoverCell={setHoveredCell}
              />
              {hoveredCell?.entry && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: fm.color.surfaceMuted, borderRadius: fm.radius.sm, fontSize: 11.5 }}>
                  <strong style={{ color: fm.color.textPrimary }}>{hoveredCell.entry.title}</strong>
                  {hoveredCell.entry.preview && <div style={{ color: fm.color.textSecondary, marginTop: 3 }}>{hoveredCell.entry.preview}</div>}
                </div>
              )}
              <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
                <LegendDot color={CAL_DEPTH_COLORS.breakthrough} label="Win" />
                <LegendDot color={CAL_DEPTH_COLORS.deep} label="Mid" />
                <LegendDot color={CAL_DEPTH_COLORS.short} label="Slip" />
                <LegendDot color={CAL_DEPTH_COLORS.none} label="No entry" />
              </div>
            </Card>
          </Reveal>

          <Reveal delay={360} style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Verdict Analytics</Eyebrow>
              {verdicts.total > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
                  <DonutChart size={104} thickness={15} centerValue={verdicts.total} centerLabel="Total" drawIn segments={[{ value: verdicts.win, color: fm.color.success }, { value: verdicts.mid, color: fm.color.warning }, { value: verdicts.slip, color: fm.color.danger }]} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <LegendRow color={fm.color.success} label="Win" value={verdicts.win} total={verdicts.total} />
                    <LegendRow color={fm.color.warning} label="Mid" value={verdicts.mid} total={verdicts.total} />
                    <LegendRow color={fm.color.danger} label="Slip" value={verdicts.slip} total={verdicts.total} />
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No check-ins logged yet.</p>
              )}
            </Card>
          </Reveal>
        </div>

        {/* Streak + Urge analytics */}
        <div style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
          <Reveal delay={420}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Streak Analytics</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 12 }}>
                <MetricCard icon={<Flame size={15} color={pColor} />} value={<CountUp to={streak} />} label="Current" tint={pColor} tintSoft={`${pColor}1a`} />
                <MetricCard icon={<TrendingUp size={15} color={fm.color.accent} />} value={<CountUp to={longest} />} label="Longest" tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
                <MetricCard icon={<Target size={15} color={fm.color.info} />} value={<CountUp to={avgRun} />} label="Average" tint={fm.color.info} tintSoft={fm.color.infoSoft} />
                <MetricCard icon={<Clock size={15} color={fm.color.warning} />} value={<CountUp to={missedDays} />} label="Missed Days" tint={fm.color.warning} tintSoft={fm.color.warningSoft} />
                <MetricCard icon={<Shield size={15} color={fm.color.success} />} value={`${consistencyPct}%`} label="Recovery %" tint={fm.color.success} tintSoft={fm.color.successSoft} />
              </div>
            </Card>
          </Reveal>

          <Reveal delay={480}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Urge Analytics</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 12 }}>
                <MetricCard icon={<Target size={15} color={fm.color.accent} />} value={urgeLog.length} label="Total Urges" tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
                <MetricCard icon={<Shield size={15} color={fm.color.success} />} value={urgeLog.filter((u) => u.survived).length} label="Managed" tint={fm.color.success} tintSoft={fm.color.successSoft} />
                <MetricCard icon={<Flame size={15} color={fm.color.danger} />} value={urgeLog.filter((u) => !u.survived).length} label="Failed" tint={fm.color.danger} tintSoft={fm.color.dangerSoft} />
                <MetricCard icon={<Clock size={15} color={fm.color.info} />} value={duration?.avgSec ? `${Math.round(duration.avgSec / 60)}m` : "—"} label="Avg Duration" tint={fm.color.info} tintSoft={fm.color.infoSoft} />
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 10, fontSize: 11 }}>
                {peakHour && <span style={{ padding: "5px 12px", borderRadius: fm.radius.pill, background: fm.color.surfaceMuted, color: fm.color.textSecondary }}>Most common time: {peakHour.label}</span>}
                {peakWeekday && <span style={{ padding: "5px 12px", borderRadius: fm.radius.pill, background: fm.color.surfaceMuted, color: fm.color.textSecondary }}>Peak day: {peakWeekday}</span>}
              </div>
            </Card>
          </Reveal>
        </div>

        {/* Trigger intelligence */}
        {triggers.length > 0 && (
          <Reveal delay={540} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Sparkles size={13} color={fm.color.accent} />
                <Eyebrow>Trigger Intelligence</Eyebrow>
              </div>
              <div style={{ fontSize: 11.5, color: fm.color.textSecondary, marginBottom: 14 }}>Most urges are tagged to:</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {triggers.map((t) => (
                  <span key={t.label} style={{ padding: "8px 16px", borderRadius: fm.radius.pill, background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}`, fontSize: 11.5, fontWeight: 600, color: fm.color.accentDeep }}>
                    {t.label} · {t.count}
                  </span>
                ))}
              </div>
            </Card>
          </Reveal>
        )}

        {/* Mission performance table */}
        {missionPerf.length > 0 && (
          <Reveal delay={600} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Mission Performance</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: "clamp(18px,5vw,28px) 1fr 2.5fr clamp(36px,10vw,60px) clamp(36px,10vw,60px)", gap: 12, marginBottom: 8, fontSize: 9.5, color: fm.color.textTertiary, fontWeight: 700 }}>
                <span /><span>MISSION</span><span>SUCCESS</span><span style={{ textAlign: "center" }}>LONGEST</span><span style={{ textAlign: "center" }}>CURRENT</span>
              </div>
              {missionPerf.map((m) => {
                const series = missionDailySeries(m.id, history, triggerLog);
                const run = missionRunStats(series);
                const total = m.clean + m.partial + m.slip || 1;
                const successPct = Math.round((m.clean / total) * 100);
                return (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "clamp(18px,5vw,28px) 1fr 2.5fr clamp(36px,10vw,60px) clamp(36px,10vw,60px)", gap: 12, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${fm.color.border}` }}>
                    <span style={{ fontSize: 16 }}>{m.emoji}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                    <div style={{ height: 8, borderRadius: 4, overflow: "hidden", background: fm.color.surfaceSunken, minWidth: 0 }}>
                      <div style={{ height: "100%", width: `${successPct}%`, background: fm.color.success, transition: "width 1s cubic-bezier(.16,1,.3,1)" }} />
                    </div>
                    <span style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: fm.color.textPrimary }}>{run.longest}d</span>
                    <span style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: fm.color.accent }}>{run.current}d</span>
                  </div>
                );
              })}
            </Card>
          </Reveal>
        )}

        {/* Recovery timeline */}
        <Reveal delay={660} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={30} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
            <Eyebrow style={{ marginBottom: 20 }}>Recovery Timeline</Eyebrow>
            {/* Fixed ~464px minimum width (6 nodes + connectors) never
                shrinks below its label text — scroll inside the card on
                narrow phones instead of overflowing the page. */}
            <div style={{ overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch" }}>
              <div style={{ minWidth: isMobile ? 480 : "auto" }}>
                <RecoveryTimeline milestones={MILESTONES} streak={streak} color={pColor} />
              </div>
            </div>
          </Card>
        </Reveal>

        {/* AI-style insights */}
        <Reveal delay={720} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={30} style={{ boxShadow: SHADOW.primary, background: fm.color.textPrimary }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Sparkles size={14} color={fm.color.accent} />
              <Eyebrow style={{ color: "rgba(255,248,238,0.55)" }}>Recovery Insights</Eyebrow>
            </div>
            {insights.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.map((text, i) => (
                  <p key={i} style={{ fontFamily: fm.font.display, fontSize: 15, fontStyle: "italic", color: "rgba(255,248,238,0.92)", lineHeight: 1.6, margin: 0 }}>"{text}"</p>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: "rgba(255,248,238,0.6)" }}>Keep checking in — personalized insights appear once there's enough real history.</p>
            )}
          </Card>
        </Reveal>

        {/* Strengths + Growth */}
        <div style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
          <Reveal delay={780}>
            <Card padding={24} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
              <Eyebrow style={{ marginBottom: 12 }}>Personal Strengths</Eyebrow>
              {strengths.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <Check size={13} color={fm.color.success} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.5 }}>{s}</span>
                </div>
              ))}
            </Card>
          </Reveal>
          <Reveal delay={820}>
            <Card padding={24} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
              <Eyebrow style={{ marginBottom: 12 }}>Improvement Areas</Eyebrow>
              {growth.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <span style={{ color: fm.color.warning, fontSize: 12, fontWeight: 700 }}>→</span>
                  <span style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.5 }}>{s}</span>
                </div>
              ))}
            </Card>
          </Reveal>
        </div>

        {/* Achievements */}
        <Reveal delay={860} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
            <Eyebrow style={{ marginBottom: 16 }}>Achievements</Eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5,1fr)", gap: 14 }}>
              {achievements.map((a) => (
                <div key={a.id} className="fm-hover-card fm-hover-card--small" style={{ textAlign: "center", padding: "18px 10px", borderRadius: fm.radius.md, background: a.unlocked ? fm.color.accentSoft : fm.color.surfaceMuted, border: `1px solid ${a.unlocked ? fm.color.accentSoftBorder : fm.color.border}`, opacity: a.unlocked ? 1 : 0.5 }}>
                  <div style={{ fontSize: 24, marginBottom: 8, filter: a.unlocked ? "none" : "grayscale(1)" }}>{a.unlocked ? a.icon : <Lock size={20} color={fm.color.textTertiary} style={{ margin: "0 auto" }} />}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{a.label}</div>
                  <div style={{ fontSize: 9, color: fm.color.textTertiary }}>{a.desc}</div>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>

        {/* Export */}
        <Reveal delay={900} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Button variant="primary" onClick={exportAllSynapseData} style={{ background: fm.color.accent, gap: 8 }}>
            <Download size={14} /> Export Recovery Data
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const text = `${streak}-day streak · ${consistencyPct}% consistency · ${urgePct}% urge resistance — tracked with SYNAPSE.`;
              navigator.clipboard?.writeText(text);
            }}
            style={{ gap: 8 }}
          >
            <Share2 size={14} /> Share Progress
          </Button>
        </Reveal>

        {/* Motivational end card */}
        <Reveal delay={960} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={56} style={{ textAlign: "center", background: fm.color.surfaceMuted, boxShadow: SHADOW.small }}>
            <p style={{ fontFamily: fm.font.display, fontSize: 24, fontStyle: "italic", color: fm.color.textPrimary, marginBottom: 8 }}>
              "Every disciplined day rewires your future."
            </p>
            <div style={{ fontSize: 11, color: fm.color.textTertiary, letterSpacing: 1 }}>— SYNAPSE</div>
          </Card>
        </Reveal>
      </main>
    </FocusModeShell>
  );
}

function ScoreRing({ score, color }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const [mounted, setMounted] = useState(false);
  useMemo(() => setTimeout(() => setMounted(true), 50), []);
  return (
    <div style={{ position: "relative", width: 128, height: 128, flexShrink: 0 }}>
      <svg width={128} height={128} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={64} cy={64} r={r} fill="none" stroke={fm.color.surfaceSunken} strokeWidth={10} />
        <circle
          cx={64}
          cy={64}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${mounted ? (score / 100) * c : 0} ${c}`}
          style={{ transition: "stroke-dasharray 1.1s cubic-bezier(.16,1,.3,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{ fontFamily: fm.font.display, fontSize: 38, fontWeight: 700, color: fm.color.textPrimary }}>
          <CountUp to={score} duration={1100} />
        </div>
      </div>
    </div>
  );
}

function MiniScore({ label, value, color }) {
  if (value == null) return null;
  return (
    <div>
      <div style={{ fontFamily: fm.font.display, fontSize: 20, fontWeight: 700, color }}><CountUp to={value} />%</div>
      <div style={{ fontSize: 10, color: fm.color.textTertiary, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
      <span style={{ fontSize: 10.5, color: fm.color.textTertiary }}>{label}</span>
    </div>
  );
}

function LegendRow({ color, label, value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ color: fm.color.textPrimary, fontWeight: 600 }}>{label}</span>
      <span style={{ color: fm.color.textTertiary }}>{value} ({pct}%)</span>
    </div>
  );
}