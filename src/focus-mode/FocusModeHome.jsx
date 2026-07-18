import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, ClipboardCheck, Target, ArrowRight, Sparkles, Headphones, Flag, TrendingUp, Smile, Meh, Frown } from "lucide-react";
import { fm } from "./theme";
import { readSynapseSnapshot } from "./synapseData";

import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  VerdictBadge,
  StatTile,
  TaskRow,
  WeeklyTrendChart,
  RecoveryPhaseCard,
  RecoveryTimeline,
  NeuralOrb,
  AmbientBackground,
  EASE,
  GLASS_CARD,
  CountUp
} from "./components";

const MILESTONES = [
  { label: "Awakening", days: 3 },
  { label: "Stabilizing", days: 7 },
  { label: "Rewiring", days: 14 },
  { label: "Recalibrated", days: 30 },
  { label: "Optimized", days: 60 },
  { label: "Synapsed", days: 90 },
];

const MOOD_OPTIONS = [
  { id: "WIN", label: "Win", icon: Smile, desc: "I stayed strong and followed my plan.", tint: "success" },
  { id: "MID", label: "Mid", icon: Meh, desc: "I struggled but didn't give in.", tint: "warning" },
  { id: "SLIP", label: "Slip", icon: Frown, desc: "I gave in, but I'm ready to reset.", tint: "danger" },
];

// Animation language: transform + opacity only, no bounce, no rotation,
// scale never exceeds 1.02. This exact easing curve is used everywhere.
// (previously gated to play once per session — now always plays on mount)

/**
 * FocusModeHome
 * Props:
 *   onNavigate(screenId) — routes through the same AppRoot.goTo() screen
 *                           switcher Command Mode already uses.
 *   onOpenProfile()       — opens the existing ProfileSheet.
 * Reads all data live from the same localStorage keys App.jsx writes.
 * Animation-only pass on top of the existing visual design — no data,
// hooks (besides local UI state), routing, or shared-component *behavior* changed. RecoveryPhaseCard/ProgressBar/NeuralOrb gained small opt-in
// props (animateOnMount / floatEnabled) that default to their previous
// behavior, so every other screen using them is unaffected.
*/
export default function FocusModeHome({ onNavigate, onOpenProfile }) {
  const data = useMemo(() => readSynapseSnapshot(), []);
  const {
    name,
    streak,
    level,
    nextLevel,
    xpPct,
    daysToNext,
    quote,
    weekly,
    recentCheckin,
    todayEntry,
    checkedInToday,
    addictions,
    stats,
  } = data;

  const prefersReducedMotion = useReducedMotion();
  const [playIntro] = useState(() => !prefersReducedMotion);

  const firstName = (name || "Soldier").split(" ")[0];
  const greeting = getGreeting();
  const pColor = fm.color.accent;
  const weeklyPoints = weekly.length > 0 ? weekly.map((h) => h.streak ?? 0) : [0];
  const weeklyDayLabels = weekly.length > 0 ? weekly.map((h) => new Date(h.date).toLocaleDateString("en-IN", { weekday: "narrow" })) : undefined;

  // Instant (no-delay, no-transition) variants used when the intro has
  // already played this session — same end state, zero animation cost.
  const instant = { hidden: { opacity: 1 }, visible: { opacity: 1 } };

  const fadeIn = playIntro
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.5, ease: EASE } } }
    : instant;

  const sidebarSlide = playIntro
    ? { hidden: { opacity: 0, x: -30 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } } }
    : instant;

  const topIconsSlide = playIntro
    ? { hidden: { opacity: 0, y: -15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.6 } } }
    : instant;

  const heroCard = playIntro
    ? { hidden: { opacity: 0, y: 35 }, visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE, delay: 0.15 } } }
    : instant;

  const heroTextContainer = playIntro
    ? { hidden: {}, visible: { transition: { staggerChildren: 0.07, delayChildren: 0.3 } } }
    : instant;
  const heroTextItem = playIntro
    ? { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } }
    : instant;

  const orbIn = playIntro
    ? { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.9, ease: EASE, delay: 0.25 } } }
    : instant;

  const streakCard = playIntro
    ? { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 1.05 } } }
    : instant;

  const statsCard = playIntro
    ? { hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 1.15 } } }
    : instant;
  const statItem = playIntro
    ? { hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } } }
    : instant;

  const todayFocus = playIntro
    ? { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 0.55 } } }
    : instant;

  const recoveryPhase = playIntro
    ? { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 0.62 } } }
    : instant;

  const checkinCard = playIntro
    ? { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 1.25 } } }
    : instant;
  const moodStagger = playIntro
    ? { hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 1.5 } } }
    : instant;
  const moodItem = playIntro
    ? { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } } }
    : instant;

  const bottomRow = (delay) =>
    playIntro
      ? { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE, delay } } }
      : instant;

  // Cards lift on hover — same 200ms transform-only interaction everywhere.
  const hoverLift = { whileHover: { y: -4, transition: { duration: 0.2, ease: EASE } } };

  // Stagger variants for card groups
  const staggerContainer = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.2,
      },
    },
  };
  const staggerItem = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
  };

  return (
    <FocusModeShell>
      <motion.div initial="hidden" animate="visible" variants={fadeIn} style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <AmbientBackground color={pColor} />
      </motion.div>

      <motion.div initial="hidden" animate="visible" variants={sidebarSlide}>
        <Sidebar active="home" onNavigate={onNavigate} />
      </motion.div>

      <main style={{ flex: 1, minWidth: 0, paddingBottom: 72, position: "relative", zIndex: 1 }}>
        <motion.div initial="hidden" animate="visible" variants={topIconsSlide}>
          <TopBar userInitial={firstName[0]?.toUpperCase() || "S"} onOpenProfile={onOpenProfile} />
        </motion.div>

        <div style={{ padding: "26px 48px 0", display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* ── LEFT COLUMN ────────────────────────────────────── */}
          <div style={{ flex: "1.55 1 0%", display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            {/* Hero */}
            <motion.div initial="hidden" animate="visible" variants={heroCard} {...hoverLift}>
              <Card padding={0} style={{ ...GLASS_CARD, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", alignItems: "center", minHeight: 320 }}>
                  <motion.div variants={heroTextContainer} initial="hidden" animate="visible" style={{ padding: "40px 8px 40px 40px" }}>
                    <motion.div variants={heroTextItem} style={{ fontFamily: fm.font.display, fontSize: 15, color: fm.color.textSecondary, marginBottom: 4, letterSpacing: 0.2 }}>
                      {greeting},
                    </motion.div>
                    <motion.div variants={heroTextItem} style={{ fontFamily: fm.font.display, fontSize: 48, fontWeight: 600, color: fm.color.textPrimary, lineHeight: 1.02, letterSpacing: -0.8, marginBottom: 20 }}>
                      {firstName}
                    </motion.div>
                    <motion.p variants={heroTextItem} style={{ fontSize: 14, color: fm.color.textSecondary, maxWidth: 270, lineHeight: 1.75, marginBottom: 26 }}>
                      You are becoming someone who keeps promises.
                    </motion.p>
                    <motion.div variants={heroTextItem}>
                      <Button variant="accentGhost" onClick={() => onNavigate?.(checkedInToday ? "chat" : "checkin")} style={{ gap: 9, background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}` }}>
                        {checkedInToday ? "Talk to Your Coach" : "Continue Your Journey"}
                        <ArrowRight size={13} strokeWidth={2.4} />
                      </Button>
                    </motion.div>
                  </motion.div>
                  <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "18px 18px 22px" }}>
                    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 320, height: 320, borderRadius: "50%", background: `radial-gradient(circle, ${pColor}30, transparent 70%)`, filter: "blur(6px)", pointerEvents: "none" }} />
                    <motion.div variants={orbIn} initial="hidden" animate="visible">
                      <FloatingOrb size={236} color={pColor} disabled={prefersReducedMotion} />
                    </motion.div>
                    <motion.div
                      initial={playIntro ? { opacity: 0, y: 14 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: EASE, delay: playIntro ? 1.15 : 0 }}
                      style={{ textAlign: "center", marginTop: 6, position: "relative" }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, color: fm.color.textTertiary, textTransform: "uppercase" }}>Your Neural Core</div>
                      <div style={{ fontSize: 11.5, color: fm.color.textTertiary, marginTop: 3 }}>Every choice rewires your mind.</div>
                      <ViewEvolutionButton onClick={() => onNavigate?.("progress")} />
                    </motion.div>
                  </div>
                </div>
              </Card>
            </motion.div>

            {/* Today's Focus + Recovery Phase */}
            <div style={{ display: "flex", gap: 24 }}>
              <motion.div initial="hidden" animate="visible" variants={todayFocus} {...hoverLift} style={{ flex: "1.15 1 0%" }}>
                <Card padding={30} style={GLASS_CARD}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
                    <Eyebrow>Today's Focus</Eyebrow>
                    <span style={{ fontSize: 11, color: fm.color.textTertiary }}>{addictions.length} tracked</span>
                  </div>

                  {addictions.length === 0 ? (
                    <EmptyState text="No missions set up yet." cta="Set Up Your Missions" onClick={() => onNavigate?.("confess")} />
                  ) : (
                    <div>
                      <motion.div
                        initial={playIntro ? { opacity: 0, y: 8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EASE, delay: playIntro ? 0.7 + i * 0.06 : 0 }}
                        variants={staggerContainer}
                      >
                        {addictions.map((a, i) => (
                          <motion.div
                            key={a.id}
                            initial={playIntro ? { opacity: 0, y: 8 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: EASE, delay: playIntro ? 0.7 + i * 0.06 : 0 }}
                            variants={staggerItem}
                          >
                            <TaskRow
                              label={`${a.emoji || "•"} ${a.label}`}
                              meta={checkedInToday ? statusLabel(todayEntry?.status) : "Pending"}
                              done={checkedInToday}
                              onToggle={() => onNavigate?.("checkin")}
                            />
                          </motion.div>
                        ))}
                      </motion.div>
                    </div>
                  )}

                  {checkedInToday && todayEntry && (
                    <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 10 }}>
                      <VerdictBadge verdict={(todayEntry.status || "mid").toUpperCase()} />
                      <span style={{ fontSize: 11, color: fm.color.textTertiary }}>Today's check-in is logged.</span>
                    </div>
                  )}
                  {!checkedInToday && (
                    <div style={{ marginTop: 24 }}>
                      <Button variant="primary" size="sm" onClick={() => onNavigate?.("checkin")}>
                        Check In For Today
                      </Button>
                    </div>
                  )}
                </Card>
              </motion.div>

              <motion.div initial="hidden" animate="visible" variants={recoveryPhase} {...hoverLift} style={{ flex: "0.85 1 0%" }}>
                <RecoveryPhaseCard level={level} nextLevel={nextLevel} streak={streak} xpPct={xpPct} daysToNext={daysToNext} color={pColor} animateOnMount={playIntro} />
              </motion.div>
            </div>
          </div>

          {/* ── RIGHT COLUMN — Streak / Stats / Check-in, stacked ── */}
          <div style={{ flex: "1 1 0%", display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
            <motion.div initial="hidden" animate="visible" variants={streakCard} {...hoverLift}>
              <Card padding={24} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 14 }}>Your Streak</Eyebrow>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontFamily: fm.font.display, fontSize: 46, fontWeight: 700, color: fm.color.textPrimary, letterSpacing: -1.2 }}>
                      <CountUp to={streak} play={playIntro} />
                    </span>
                    <span style={{ fontSize: 12, color: fm.color.textTertiary }}>days</span>
                  </div>
                  <WeeklyTrendChart points={weeklyPoints} color={pColor} width={100} height={36} area badge />
                </div>
                {recentCheckin && (
                  <div style={{ marginTop: 14, fontSize: 10.5, color: fm.color.textTertiary, paddingTop: 12, borderTop: `1px solid ${fm.color.border}` }}>
                    Last entry: {relativeDay(recentCheckin.date)}
                  </div>
                )}
              </Card>
              </motion.div>

              <motion.div initial="hidden" animate="visible" variants={statsCard} {...hoverLift}>
                <Card padding={22} style={{ ...GLASS_CARD, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                  <motion.div variants={staggerContainer}>
                    <motion.div variants={staggerItem}>
                      <StatTile icon={<Heart size={14} strokeWidth={2.2} color={fm.color.success} />} label="Urges Managed" value={stats.urgesManaged} tint={fm.color.success} tintSoft={fm.color.successSoft} />
                    </motion.div>
                    <motion.div variants={staggerItem}>
                      <StatTile icon={<ClipboardCheck size={14} strokeWidth={2.2} color={fm.color.info} />} label="Check-Ins" value={stats.checkinsCount} tint={fm.color.info} tintSoft={fm.color.infoSoft} />
                    </motion.div>
                    <motion.div variants={staggerItem}>
                      <StatTile icon={<Target size={14} strokeWidth={2.2} color={fm.color.accent} />} label="Active Missions" value={stats.activeMissions} tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
                    </motion.div>
                  </motion.div>
                </Card>
              </motion.div>

              {/* Check-In preview — real verdict if already logged today,
                  otherwise a shortcut into the real Check-In screen. */}
              <motion.div initial="hidden" animate="visible" variants={checkinCard} {...hoverLift} style={{ flex: 1 }}>
                <Card padding={24} style={{ ...GLASS_CARD, height: "100%" }}>
                  <Eyebrow style={{ marginBottom: 4 }}>Check-In</Eyebrow>
                  <div style={{ fontFamily: fm.font.display, fontSize: 17, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 4 }}>How was your day?</div>
                  <div style={{ fontSize: 11, color: fm.color.textTertiary, marginBottom: 16, lineHeight: 1.5 }}>Your honesty builds your transformation.</div>

                  {checkedInToday && todayEntry ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <VerdictBadge verdict={(todayEntry.status || "mid").toUpperCase()} />
                      <span style={{ fontSize: 11, color: fm.color.textTertiary }}>Logged for today.</span>
                    </div>
                  ) : (
                    <>
                      <motion.div variants={staggerContainer}>
                        {MOOD_OPTIONS.map((m) => {
                          const Icon = m.icon;
                          const tintColor = fm.color[m.tint];
                          const tintSoft = fm.color[`${m.tint}Soft`];
                          return (
                            <motion.button
                              key={m.id}
                              initial={playIntro ? { opacity: 0, y: 8 } : false}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, ease: EASE, delay: playIntro ? 0.7 + MOOD_OPTIONS.indexOf(m) * 0.06 : 0 }}
                              variants={staggerItem}
                              whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.2, ease: EASE } }}
                              onClick={() => onNavigate?.("checkin")}
                              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 8px", borderRadius: fm.radius.md, border: `1px solid ${tintColor}30`, background: tintSoft }}
                            >
                              <Icon size={18} strokeWidth={2} color={tintColor} />
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: tintColor }}>{m.label}</span>
                            </motion.button>
                          );
                        })}
                      </motion.div>
                      <div style={{ fontSize: 10, color: fm.color.textTertiary, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
                        Every check-in is a step towards a stronger you.
                      </div>
                    </>
                  )}
                </Card>
              </motion.div>
            </div>
        </div>

        {/* ── Next Milestone strip ──────────────────────────────── */}
        <motion.div initial="hidden" animate="visible" variants={bottomRow(playIntro ? 1.35 : 0)} {...hoverLift} style={{ padding: "24px 48px 0" }}>
          <Card padding={26} style={GLASS_CARD}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
              <Flag size={13} strokeWidth={2.4} color={fm.color.accent} />
              <Eyebrow>Next Milestone</Eyebrow>
              {nextLevel && (
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: fm.color.textSecondary }}>
                  <strong style={{ color: fm.color.textPrimary }}>{titleCase(nextLevel.title)}</strong> — {daysToNext} day{daysToNext === 1 ? "" : "s"} to go
                </span>
              )}
            </div>
            <RecoveryTimeline milestones={MILESTONES} streak={streak} color={pColor} />
          </Card>
        </motion.div>

        {/* ── Insight / Weekly Progress / Recent check-in / Support ── */}
        <div style={{ padding: "24px 48px 0", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
          <motion.div initial="hidden" animate="visible" variants={bottomRow(playIntro ? 1.45 : 0)} {...hoverLift}>
            <Card padding={24} style={GLASS_CARD}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Sparkles size={13} strokeWidth={2.4} color={fm.color.accent} />
                <Eyebrow>Neural Insight</Eyebrow>
              </div>
              <p style={{ fontFamily: fm.font.display, fontSize: 14, color: fm.color.textPrimary, lineHeight: 1.6, fontStyle: "italic" }}>"{quote.q}"</p>
            </Card>
          </motion.div>

          <motion.div initial="hidden" animate="visible" variants={bottomRow(playIntro ? 1.49 : 0)} {...hoverLift}>
            <Card padding={24} style={GLASS_CARD}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <TrendingUp size={13} strokeWidth={2.4} color={fm.color.accent} />
                <Eyebrow>Weekly Progress</Eyebrow>
              </div>
              {weekly.length > 0 ? (
                <WeeklyTrendChart points={weeklyPoints} labels={weeklyDayLabels} color={pColor} width={180} height={54} area grid />
              ) : (
                <p style={{ fontSize: 11.5, color: fm.color.textTertiary }}>Check in a few days to see your trend.</p>
              )}
            </Card>
          </motion.div>

          <motion.div initial="hidden" animate="visible" variants={bottomRow(playIntro ? 1.53 : 0)} {...hoverLift}>
            <Card padding={24} style={GLASS_CARD}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Eyebrow>Recent Check-In</Eyebrow>
                {recentCheckin && <span style={{ fontSize: 10, color: fm.color.textTertiary }}>{relativeDay(recentCheckin.date)}</span>}
              </div>
              {recentCheckin ? (
                <>
                  <VerdictBadge verdict={(recentCheckin.status || "mid").toUpperCase()} />
                  {recentCheckin.msg && <p style={{ marginTop: 10, fontSize: 11.5, color: fm.color.textSecondary, lineHeight: 1.6 }}>{truncate(recentCheckin.msg, 90)}</p>}
                  <div style={{ marginTop: 12 }}>
                    <Button variant="ghost" size="sm" onClick={() => onNavigate?.("report")}>
                      View All Logs
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState text="No check-ins yet." cta="Check In Now" onClick={() => onNavigate?.("checkin")} />
              )}
            </Card>
          </motion.div>

          <motion.div initial="hidden" animate="visible" variants={bottomRow(playIntro ? 1.57 : 0)} {...hoverLift}>
            <Card padding={24} style={{ ...GLASS_CARD, background: `linear-gradient(180deg, rgba(255,255,255,0.9), ${fm.color.accentSoft})`, display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Headphones size={13} strokeWidth={2.4} color={fm.color.accentDeep} />
                  <Eyebrow>Need Support?</Eyebrow>
                </div>
                <p style={{ fontSize: 11.5, color: fm.color.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>Talk to your AI Coach or access resources anytime.</p>
              </div>
              <Button variant="accentGhost" size="sm" onClick={() => onNavigate?.("chat")} style={{ justifyContent: "center" }}>
                Get Support →
              </Button>
            </Card>
          </motion.div>
        </div>
      </main>
    </FocusModeShell>
  );
}

/* ── local presentational + animation helpers ── */

// Neural core: scale-in handled by the parent motion.div; this drives the
// continuous post-load float (7s, ±6px) and glow pulse (4s, 0.18→0.32→0.18)
// per spec, replacing NeuralOrb's default built-in timing for this screen
// only (About screen keeps NeuralOrb's own default float/glow).
function FloatingOrb({ size, color, disabled }) {
  if (disabled) return <NeuralOrb size={size} color={color} floatEnabled={false} />;
  return (
    <motion.div
      animate={{ y: [-6, 6, -6] }}
      transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      style={{ position: "relative" }}
    >
      <motion.div
        animate={{ opacity: [0.18, 0.32, 0.18] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ position: "absolute", inset: "-20%", borderRadius: "50%", background: `radial-gradient(circle, ${color}, transparent 65%)`, pointerEvents: "none" }}
      />
      <NeuralOrb size={size} color={color} floatEnabled={false} />
    </motion.div>
  );
}

function ViewEvolutionButton({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        marginTop: 10,
        fontSize: 10.5,
        fontWeight: 700,
        color: fm.color.accentDeep,
        background: fm.color.accentSoft,
        border: `1px solid ${fm.color.accentSoftBorder}`,
        borderRadius: fm.radius.pill,
        padding: "5px 14px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        transform: hover ? "translateY(-2px)" : "none",
        boxShadow: hover ? "0 4px 12px rgba(221,122,49,0.22)" : "none",
        transition: "transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.22,1,.36,1)",
      }}
    >
      View Evolution
      <span style={{ display: "inline-block", transition: "transform .2s cubic-bezier(.22,1,.36,1)", transform: hover ? "translateX(4px)" : "none" }}>→</span>
    </button>
  );
}

function EmptyState({ text, cta, onClick }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 12px" }}>
      <p style={{ fontSize: 12.5, color: fm.color.textTertiary, marginBottom: 14 }}>{text}</p>
      <Button variant="accentGhost" size="sm" onClick={onClick}>
        {cta}
      </Button>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function statusLabel(status) {
  if (status === "win") return "Clean";
  if (status === "slip") return "Slipped";
  if (status === "mid") return "Partial";
  return "Pending";
}

function titleCase(s = "") {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function relativeDay(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const diffDays = Math.round((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}
