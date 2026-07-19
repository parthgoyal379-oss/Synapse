import { useMemo } from "react";
import { motion } from "framer-motion";
import { fm, phaseColor } from "./theme";
import { readSynapseSnapshot, readArchetype, extractPlanSections, longestStreak } from "./synapseData";
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
  ProgressBar,
  StatTile,
  AmbientBackground,
  EASE,
  GLASS_CARD,
  HOVER_LIFT,
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
const MILESTONE_DESCRIPTIONS = {
  Awakening: "You notice the pattern for the first time.",
  Stabilizing: "The first week without giving in.",
  Rewiring: "New neural pathways start to form.",
  Recalibrated: "A full month of discipline.",
  Optimized: "Two months — this is who you are now.",
  Synapsed: "Full rewire. The old pattern is gone.",
};

export default function FocusModePlan({ savedPlan, onNavigate, onOpenProfile }) {
  const snapshot = useMemo(() => readSynapseSnapshot(), []);
  const archetype = useMemo(() => readArchetype(), []);
  const planSections = useMemo(() => extractPlanSections(savedPlan), [savedPlan]);
  const { streak, level, nextLevel, xpPct, daysToNext, quote, history, addictions, stats, checkedInToday } = snapshot;

  const pColor = fm.color.accent;
  const longest = longestStreak(history, streak);
  const urgeLogLen = snapshot.urgeLog?.length ?? 0;
  const urgeSuccessPct = urgeLogLen > 0 ? Math.round((stats.urgesManaged / Math.max(urgeLogLen, 1)) * 100) : 0;

  const cardVariant = (delay) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  });

  return (
    <FocusModeShell>
      <AmbientBackground color={pColor} />
      <Sidebar active="plan" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60, position: "relative", zIndex: 1 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <div style={{ padding: "clamp(14px,4vw,26px) clamp(14px,4vw,48px) 0" }}>
          <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary }}>My Plan</div>
          <div style={{ fontSize: 12.5, color: fm.color.textSecondary, marginTop: 4 }}>Your recovery battle plan. Follow it. Trust it. Win.</div>
        </div>

        {/* Quote banner — subtle one-time shimmer sweep, no constant motion */}
        <motion.div {...cardVariant(0)} style={{ padding: "clamp(14px,4vw,18px) clamp(14px,4vw,48px) 0" }}>
          <Card padding={18} style={{ ...GLASS_CARD, display: "flex", alignItems: "center", gap: 12, position: "relative", overflow: "hidden" }}>
            <motion.div
              initial={{ x: "-120%" }}
              animate={{ x: "220%" }}
              transition={{ duration: 1.4, ease: "easeInOut", delay: 1, repeat: Infinity, repeatDelay: 11.6 }}
              style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.5), transparent)", pointerEvents: "none" }}
            />
            <span style={{ fontSize: 18, color: fm.color.accent, position: "relative" }}>"</span>
            <p style={{ fontSize: 13, fontStyle: "italic", color: fm.color.textSecondary, flex: 1, position: "relative" }}>{quote.q}</p>
            <span style={{ fontSize: 11, color: fm.color.textTertiary, position: "relative" }}>— {quote.a}</span>
          </Card>
        </motion.div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,48px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: "1.4 1 320px", minWidth: 0 }}>
            {/* Archetype — visual centerpiece */}
            <motion.div {...cardVariant(0.05)} {...HOVER_LIFT}>
              <Card padding={30} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 18 }}>Your Archetype</Eyebrow>
                {archetype ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 16 }}>
                      <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
                        <div style={{ position: "absolute", inset: -14, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.accent}30, transparent 70%)` }} />
                        <div style={{ position: "relative", width: 64, height: 64, borderRadius: "50%", background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
                          {archetype.symbol || "⚡"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontFamily: fm.font.display, fontSize: 24, fontWeight: 700, color: fm.color.textPrimary, letterSpacing: -0.3 }}>{archetype.title}</div>
                        <div style={{ fontSize: 11.5, color: fm.color.textTertiary, marginTop: 2 }}>{archetype.sub}</div>
                      </div>
                    </div>
                    <p style={{ fontSize: 12.5, color: fm.color.textSecondary, lineHeight: 1.75, marginBottom: 20, maxWidth: 460 }}>{archetype.desc}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 12.5, color: fm.color.textTertiary, marginBottom: 20 }}>No archetype chosen yet.</p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 32, paddingTop: 18, borderTop: `1px solid ${fm.color.border}` }}>
                  <div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 3 }}>Current Streak</div>
                    <div style={{ fontFamily: fm.font.display, fontSize: 20, fontWeight: 700, color: fm.color.textPrimary }}><CountUp to={streak} /> days</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 3 }}>Longest Streak</div>
                    <div style={{ fontFamily: fm.font.display, fontSize: 20, fontWeight: 700, color: fm.color.textPrimary }}><CountUp to={longest} /> days</div>
                  </div>
                </div>
              </Card>
            </motion.div>

            {/* Today's Focus */}
            <motion.div {...cardVariant(0.15)} {...HOVER_LIFT}>
              <Card padding={30} style={GLASS_CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <Eyebrow>Today's Focus</Eyebrow>
                  <ViewCheckInButton checkedInToday={checkedInToday} onClick={() => onNavigate?.("checkin")} />
                </div>
                {addictions.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>No missions set up yet.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {addictions.map((a, i) => (
                      <motion.div
                        key={a.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EASE, delay: 0.25 + i * 0.06 }}
                        style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: `1px solid ${fm.color.border}` }}
                      >
                        <span style={{ fontSize: 26 }}>{a.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: fm.color.textPrimary }}>{a.label}</div>
                          <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 2 }}>
                            {a.isFreq ? `Baseline: ${a.value}x/week` : `Baseline: ${a.value}h/day`}
                          </div>
                        </div>
                        {checkedInToday && (
                          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4, duration: 0.3, ease: EASE }}>
                            <VerdictBadge verdict={(snapshot.todayEntry?.status || "mid").toUpperCase()} />
                          </motion.div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>

            {/* Recovery Timeline */}
            <motion.div {...cardVariant(0.25)} {...HOVER_LIFT}>
              <Card padding={30} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 20 }}>Your Recovery Timeline</Eyebrow>
                <RecoveryTimeline milestones={MILESTONES} streak={streak} color={pColor} descriptions={MILESTONE_DESCRIPTIONS} />
              </Card>
            </motion.div>

            {/* Battle Plan Protocol */}
            <motion.div {...cardVariant(0.32)} {...HOVER_LIFT}>
              <Card padding={30} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 20 }}>Battle Plan Protocol</Eyebrow>
                {planSections.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {planSections.map((s, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: EASE, delay: 0.4 + i * 0.08 }}
                        style={{ display: "flex", gap: 16, maxWidth: 560 }}
                      >
                        <div style={{ width: 30, height: 30, borderRadius: fm.radius.sm, background: fm.color.accentSoft, color: fm.color.accentDeep, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {i + 1}
                        </div>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{s.label}</div>
                          <div style={{ fontSize: 11.5, color: fm.color.textSecondary, lineHeight: 1.65 }}>{s.description}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 12.5, color: fm.color.textTertiary }}>{savedPlan ? "Your plan doesn't have labeled sections yet." : "No battle plan generated yet."}</p>
                )}
                {savedPlan && (
                  <div style={{ marginTop: 20 }}>
                    <Button variant="ghost" size="sm" onClick={() => onNavigate?.("planFull")}>View Full Plan</Button>
                  </div>
                )}
              </Card>
            </motion.div>
          </div>

          {/* Right rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: "1 1 260px", minWidth: 0 }}>
            <motion.div {...cardVariant(0.08)} {...HOVER_LIFT}>
              <RecoveryPhaseCard level={level} nextLevel={nextLevel} streak={streak} xpPct={xpPct} daysToNext={daysToNext} color={pColor} animateOnMount />
            </motion.div>

            <motion.div {...cardVariant(0.18)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 6 }}>Urge Resistance</Eyebrow>
                <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 10 }}>
                  <CountUp to={urgeSuccessPct} />%
                </div>
                <ProgressBar pct={urgeSuccessPct} color={pColor} animateOnMount />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                  <StatTile icon="💚" label="Survived" value={stats.urgesManaged} tint={fm.color.success} tintSoft={fm.color.successSoft} />
                  <StatTile icon="⏱️" label="Logged" value={urgeLogLen} tint={fm.color.info} tintSoft={fm.color.infoSoft} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <Button variant="primary" size="sm" onClick={() => onNavigate?.("urge")} style={{ width: "100%", justifyContent: "center" }}>Open Urge Timer</Button>
                </div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.28)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 12 }}>Tools & Resources</Eyebrow>
                <ToolRow icon="🛡️" label="Urge Timer" desc="Ride out a craving" onClick={() => onNavigate?.("urge")} />
                <ToolRow icon="⚡" label="AI Coach" desc="Talk it through" onClick={() => onNavigate?.("chat")} />
                <ToolRow icon="📊" label="Mission Report" desc="See your history" onClick={() => onNavigate?.("report")} last />
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.36)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <Eyebrow>Recent Check-Ins</Eyebrow>
                  <button onClick={() => onNavigate?.("report")} style={{ background: "none", border: "none", fontSize: 10.5, color: fm.color.accent, fontWeight: 600 }}>View All →</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {history.slice(0, 4).map((h, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: fm.color.textTertiary }}>{new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                      <VerdictBadge verdict={(h.status || "mid").toUpperCase()} />
                    </div>
                  ))}
                  {history.length === 0 && <div style={{ fontSize: 11.5, color: fm.color.textTertiary }}>No check-ins yet.</div>}
                </div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.44)}>
              <motion.div whileHover={{ y: -4, boxShadow: "0 24px 48px -12px rgba(0,0,0,0.35)" }} transition={{ duration: 0.2, ease: EASE }}>
                <Card padding={22} style={{ ...GLASS_CARD, background: "#1a1410", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <Eyebrow style={{ marginBottom: 8, color: "rgba(255,248,238,0.6)" }}>Need Help?</Eyebrow>
                  <p style={{ fontSize: 12, color: "rgba(255,248,238,0.85)", marginBottom: 14, lineHeight: 1.6 }}>Reach out to your AI Coach anytime you feel stuck.</p>
                  <Button variant="accentGhost" size="sm" onClick={() => onNavigate?.("chat")}>Talk to Coach</Button>
                </Card>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </main>
    </FocusModeShell>
  );
}

function ViewCheckInButton({ checkedInToday, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2, ease: EASE }}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: fm.radius.pill, background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}`, color: fm.color.accentDeep, fontSize: 11.5, fontWeight: 700 }}
    >
      {checkedInToday ? "View Check-In" : "Mark Today Done"}
      <motion.span whileHover={{ x: 4 }} style={{ display: "inline-block" }}>→</motion.span>
    </motion.button>
  );
}

function ToolRow({ icon, label, desc, onClick, last }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover="hover"
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 6px", borderRadius: fm.radius.sm, borderBottom: last ? "none" : `1px solid ${fm.color.border}`, background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
    >
      <motion.span variants={{ hover: { scale: 1.1, filter: `drop-shadow(0 0 6px ${fm.color.accent}60)` } }} style={{ fontSize: 18 }}>{icon}</motion.span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: fm.color.textPrimary }}>{label}</div>
        <div style={{ fontSize: 10.5, color: fm.color.textTertiary }}>{desc}</div>
      </div>
      <motion.span variants={{ hover: { x: 4, color: fm.color.accent } }} style={{ color: fm.color.textTertiary, fontSize: 14 }}>›</motion.span>
    </motion.button>
  );
}