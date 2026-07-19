import { useMemo } from "react";
import { fm, phaseColor } from "./theme";
import {
  readSynapseSnapshot,
  monthlyCheckinsCount,
  weeklyHeatmapData,
  verdictDistribution,
  urgeResistancePct,
  urgeResistanceTrend,
  missionPerformance,
  inferStrengthsAndGrowth,
  readTriggerLog,
  longestStreak,
} from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  VerdictBadge,
  RecoveryPhaseCard,
  RecoveryTimeline,
  WeeklyTrendChart,
  MetricCard,
  Heatmap,
  DonutChart,
  MissionProgressRow,
  InlineBanner,
  Reveal,
  CountUp,
} from "./components";

const MILESTONES = [
  { label: "Awakening", days: 3 },
  { label: "Stabilizing", days: 7 },
  { label: "Rewiring", days: 14 },
  { label: "Recalibrated", days: 30 },
  { label: "Optimized", days: 60 },
  { label: "Synapsed", days: 90 },
];

const HEATMAP_COLORS = {
  win: fm.color.success,
  mid: fm.color.warning,
  slip: fm.color.danger,
  missed: fm.color.surfaceSunken,
};

const SHADOW = {
  primary: "0 24px 60px -18px rgba(42,32,20,0.22)",
  secondary: "0 16px 40px -14px rgba(42,32,20,0.18)",
  small: "0 10px 25px -10px rgba(42,32,20,0.15)",
};
const hoverClass = (tier) => `fm-hover-card fm-hover-card--${tier}`;

export default function FocusModeProgress({ onNavigate, onOpenProfile }) {
  const snapshot = useMemo(() => readSynapseSnapshot(), []);
  const triggerLog = useMemo(() => readTriggerLog(), []);
  const { streak, level, nextLevel, xpPct, daysToNext, quote, history, addictions, urgeLog } = snapshot;

  const pColor = phaseColor(streak);
  const longest = longestStreak(history, streak);
  const monthlyCheckins = monthlyCheckinsCount(history);
  const urgePct = urgeResistancePct(urgeLog);
  const urgeTrend = urgeResistanceTrend(urgeLog);
  const heatWeeks = weeklyHeatmapData(history, 4);
  const verdicts = verdictDistribution(history);
  const missionPerf = missionPerformance(addictions, history, triggerLog);
  const { strengths, growth } = inferStrengthsAndGrowth(history, missionPerf, urgePct, streak);

  const streakSeries = [...history].reverse().map((h) => h.streak ?? 0).concat(streak);
  const streakLabels = (() => {
    const src = [...history].reverse();
    if (src.length === 0) return undefined;
    const pick = [src[0], src[Math.floor(src.length / 2)], src[src.length - 1]];
    return [...pick.map((h) => new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })), "Today"];
  })();

  return (
    <FocusModeShell>
      <Sidebar active="progress" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <Reveal style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0" }}>
          <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary }}>Progress</div>
          <div style={{ fontSize: 12.5, color: fm.color.textSecondary, marginTop: 4 }}>See how far you've come. Track what matters.</div>
        </Reveal>

        <div data-fm-grid="5" style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
          {[
            { icon: "🔥", value: streak, label: "Current Streak (days)", tint: pColor, tintSoft: `${pColor}1a` },
            { icon: "📈", value: longest, label: "Longest Streak (days)", tint: fm.color.accent, tintSoft: fm.color.accentSoft },
            { icon: "🛡️", value: urgePct, suffix: "%", label: "Urge Resistance", tint: fm.color.success, tintSoft: fm.color.successSoft },
            { icon: "✅", value: monthlyCheckins, label: "Check-Ins This Month", tint: fm.color.info, tintSoft: fm.color.infoSoft },
            { icon: "🎯", value: addictions.length, label: "Missions Active", tint: fm.color.warning, tintSoft: fm.color.warningSoft },
          ].map((m, i) => (
            <Reveal key={m.label} delay={i * 80}>
              <div className={hoverClass("small")} style={{ borderRadius: fm.radius.lg }}>
                <MetricCard icon={m.icon} value={<CountUp to={m.value} duration={900} />} label={m.label} tint={m.tint} tintSoft={m.tintSoft} />
              </div>
            </Reveal>
          ))}
        </div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "stretch" }}>
          <Reveal delay={150} style={{ flex: "0.9 1 260px", minWidth: 0 }}>
            <div className={hoverClass("primary")} style={{ borderRadius: fm.radius.lg, height: "100%" }}>
              <RecoveryPhaseCard level={level} nextLevel={nextLevel} streak={streak} xpPct={xpPct} daysToNext={daysToNext} color={pColor} animateOnMount />
            </div>
          </Reveal>

          <Reveal delay={150} style={{ flex: "1.6 1 300px", minWidth: 0 }}>
            <Card padding={24} style={{ boxShadow: SHADOW.primary }} className={hoverClass("primary")}>
              <Eyebrow style={{ marginBottom: 16 }}>Streak Over Time</Eyebrow>
              {streakSeries.length > 1 ? (
                <WeeklyTrendChart points={streakSeries} labels={streakLabels} color={pColor} width={560} height={140} area grid badge drawIn />
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>Check in a few more days to see your trend.</p>
              )}
              <div style={{ marginTop: 16 }}>
                <InlineBanner icon="🧭" tint={pColor} tintSoft={`${pColor}14`}>
                  Consistency is compounding. Keep protecting your streak.
                </InlineBanner>
              </div>
            </Card>
          </Reveal>
        </div>

        <Reveal delay={250} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
            <Eyebrow style={{ marginBottom: 18 }}>Your Recovery Timeline</Eyebrow>
            <RecoveryTimeline milestones={MILESTONES} streak={streak} color={pColor} />
          </Card>
        </Reveal>

        <div data-fm-grid="3" style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: "1.1fr 1fr 1.1fr", gap: 20 }}>
          <Reveal delay={320}>
            <Card padding={22} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 14 }}>Check-In Consistency</Eyebrow>
              {history.length > 0 ? (
                <Heatmap weeks={heatWeeks} levelColors={HEATMAP_COLORS} cellSize={17} cellReveal />
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No check-ins logged yet.</p>
              )}
              <div style={{ marginTop: 14, fontSize: 11, color: fm.color.textTertiary }}>{history.length} check-ins total</div>
            </Card>
          </Reveal>

          <Reveal delay={380}>
            <Card padding={22} style={{ display: "flex", flexDirection: "column", boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 14 }}>Daily Verdict Distribution</Eyebrow>
              {verdicts.total > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18 }}>
                  <DonutChart
                    size={104}
                    thickness={14}
                    centerValue={verdicts.total}
                    centerLabel="Total"
                    drawIn
                    segments={[
                      { value: verdicts.win, color: fm.color.success },
                      { value: verdicts.mid, color: fm.color.warning },
                      { value: verdicts.slip, color: fm.color.danger },
                    ]}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <LegendRow color={fm.color.success} label="Win" value={verdicts.win} total={verdicts.total} />
                    <LegendRow color={fm.color.warning} label="Mid" value={verdicts.mid} total={verdicts.total} />
                    <LegendRow color={fm.color.danger} label="Slip" value={verdicts.slip} total={verdicts.total} />
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No check-ins logged yet.</p>
              )}
              {verdicts.total > 0 && (
                <div style={{ marginTop: "auto", paddingTop: 14 }}>
                  <InlineBanner icon={verdicts.win >= verdicts.mid + verdicts.slip ? "🌱" : "🎯"} tint={fm.color.success} tintSoft={fm.color.successSoft}>
                    {verdicts.win >= verdicts.mid + verdicts.slip ? "You're winning more days than slipping." : "Every day logged is data you can use."}
                  </InlineBanner>
                </div>
              )}
            </Card>
          </Reveal>

          <Reveal delay={440}>
            <Card padding={22} style={{ display: "flex", flexDirection: "column", boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 14 }}>Urge Resistance Trend</Eyebrow>
              {urgeLog.length > 0 ? (
                <WeeklyTrendChart points={urgeTrend} color={fm.color.success} width={280} height={90} area grid badge badgeSuffix="%" drawIn />
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No urges logged yet.</p>
              )}
              {urgeLog.length > 0 && (
                <div style={{ marginTop: "auto", paddingTop: 14 }}>
                  <InlineBanner icon="🛡️" tint={fm.color.success} tintSoft={fm.color.successSoft}>
                    You're getting stronger at handling urges.
                  </InlineBanner>
                </div>
              )}
            </Card>
          </Reveal>
        </div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          <Reveal delay={500} style={{ flex: "1.3 1 300px", minWidth: 0 }}>
            <Card padding={26} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <Eyebrow style={{ marginBottom: 8 }}>Mission Performance</Eyebrow>
              {missionPerf.length > 0 ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 3fr 30px 30px 30px", gap: 10, marginBottom: 2 }}>
                    <span />
                    <span />
                    <span />
                    <span style={{ fontSize: 9, color: fm.color.success, textAlign: "center" }}>Clean</span>
                    <span style={{ fontSize: 9, color: fm.color.warning, textAlign: "center" }}>Part.</span>
                    <span style={{ fontSize: 9, color: fm.color.danger, textAlign: "center" }}>Slip</span>
                  </div>
                  {missionPerf.map((m, i) => (
                    <div key={m.id} className="fm-fade-up fm-row-hover" style={{ animationDelay: `${550 + i * 60}ms`, borderRadius: fm.radius.sm }}>
                      <MissionProgressRow emoji={m.emoji} label={m.label} clean={m.clean} partial={m.partial} slip={m.slip} />
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No missions set up yet.</p>
              )}
              <div style={{ marginTop: 14 }}>
                <Button variant="ghost" size="sm" onClick={() => onNavigate?.("report")}>
                  View Detailed Report
                </Button>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={560} style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Card padding={22} style={{ boxShadow: SHADOW.secondary }} className={hoverClass("secondary")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <Eyebrow>Recent Check-Ins</Eyebrow>
                <button onClick={() => onNavigate?.("report")} style={{ background: "none", border: "none", fontSize: 10.5, color: fm.color.accent, fontWeight: 600 }}>
                  View All →
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {history.slice(0, 5).map((h, i) => (
                  <div key={i} className="fm-fade-up fm-row-hover" style={{ animationDelay: `${600 + i * 60}ms`, display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 8px", borderRadius: fm.radius.sm }}>
                    <VerdictBadge verdict={(h.status || "mid").toUpperCase()} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, color: fm.color.textTertiary }}>
                        {new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </div>
                      {h.msg && (
                        <div style={{ fontSize: 11.5, color: fm.color.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.msg}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {history.length === 0 && <div style={{ fontSize: 11.5, color: fm.color.textTertiary }}>No check-ins yet.</div>}
              </div>
            </Card>
          </Reveal>
        </div>

        <div data-fm-grid="3" style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          <Reveal delay={620}>
            <Card padding={22} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
              <Eyebrow style={{ marginBottom: 12 }}>Strengths This Month</Eyebrow>
              <BulletList items={strengths} tint={fm.color.success} icon="✓" />
            </Card>
          </Reveal>

          <Reveal delay={680}>
            <Card padding={22} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
              <Eyebrow style={{ marginBottom: 12 }}>Growth Areas</Eyebrow>
              <BulletList items={growth} tint={fm.color.warning} icon="→" />
            </Card>
          </Reveal>

          <Reveal delay={740}>
            <Card padding={22} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
              <Eyebrow style={{ marginBottom: 12 }}>Next Milestone</Eyebrow>
              {nextLevel ? (
                <>
                  <div style={{ fontFamily: fm.font.display, fontSize: 18, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 2 }}>
                    {nextLevel.minDays}-Day Streak
                  </div>
                  <div style={{ fontSize: 11.5, color: fm.color.textSecondary, marginBottom: 14 }}>
                    You're {daysToNext} day{daysToNext === 1 ? "" : "s"} away!
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: fm.color.surfaceSunken, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${xpPct}%`, background: pColor, transition: "width 1s cubic-bezier(.16,1,.3,1)" }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 8 }}>
                    {streak} / {nextLevel.minDays} days
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textSecondary }}>You've reached the final phase. This is mastery.</p>
              )}
            </Card>
          </Reveal>
        </div>

        <Reveal delay={900} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,40px) 0" }}>
          <Card padding={24} style={{ boxShadow: SHADOW.small }} className={hoverClass("small")}>
            <Eyebrow style={{ marginBottom: 10 }}>Today's Neural Insight</Eyebrow>
            <p style={{ fontFamily: fm.font.display, fontSize: 15, fontStyle: "italic", color: fm.color.textPrimary, lineHeight: 1.6 }}>"{quote.q}"</p>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 6 }}>— {quote.a}</div>
          </Card>
        </Reveal>
      </main>
    </FocusModeShell>
  );
}

function LegendRow({ color, label, value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ color: fm.color.textPrimary, fontWeight: 600 }}>{label}</span>
      <span style={{ color: fm.color.textTertiary }}>
        {value} ({pct}%)
      </span>
    </div>
  );
}

function BulletList({ items, tint, icon }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((text, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ color: tint, fontSize: 12, fontWeight: 700, marginTop: 1 }}>{icon}</span>
          <span style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.5 }}>{text}</span>
        </div>
      ))}
    </div>
  );
}