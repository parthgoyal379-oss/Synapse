import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { fm, injectFocusModeStyles } from "./theme";

/* ─────────────────────────────────────────────────────────────────────────
   FOCUS MODE — SHARED COMPONENT LIBRARY
   ─────────────────────────────────────────────────────────────────────────
   Every Focus Mode screen (Home today, Check-In / Coach / Progress / etc.
   later) should be built out of these primitives instead of one-off
   styles, so the whole surface stays visually identical without copy-
   pasting inline style objects screen to screen.
──────────────────────────────────────────────────────────────────────── */

export const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "checkin", label: "Check-In", icon: "check" },
  { id: "plan", label: "My Plan", icon: "list" },
  { id: "chat", label: "AI Coach", icon: "message" },
  { id: "progress", label: "Progress", icon: "trend" },
  { id: "journal", label: "Journal", icon: "book" },
  { id: "urge", label: "Urge Log", icon: "clock" },
  { id: "report", label: "Report", icon: "chart" },
  { id: "about", label: "About Us", icon: "info" },
  { id: "settings", label: "Settings", icon: "gear" },
];

/* ── Shell : mounts once per Focus Mode session, injects styles + scopes
   the .focus-mode CSS variable namespace, lays out sidebar + content. ── */
export function FocusModeShell({ children }) {
  useEffect(() => {
    injectFocusModeStyles();
  }, []);

  return (
    <div
      className="focus-mode"
      style={{
        display: "flex",
        alignItems: "flex-start",
        width: "100%",
        minHeight: "100vh",
        background: fm.color.bg,
        backgroundImage: `radial-gradient(600px 400px at 55% 0%, ${fm.color.bgGlowAmber}, transparent 60%),
                           radial-gradient(500px 380px at 90% 20%, ${fm.color.bgGlowPeach}, transparent 65%)`,
        backgroundRepeat: "no-repeat",
      }}
    >
      {children}
    </div>
  );
}

/* ── Sidebar navigation, shared across every screen ── */
export function Sidebar({ active, onNavigate, streakSubtitle = "Reset · Rewire · Reconquer" }) {
  return (
    <aside
      style={{
        width: 268,
        flexShrink: 0,
        minHeight: "100vh",
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 34,
        position: "sticky",
        top: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 8px" }}>
        <NeuralGlyph />
        <div>
          <div
            style={{
              fontFamily: fm.font.display,
              fontWeight: 600,
              fontSize: 15.5,
              letterSpacing: 3,
              color: fm.color.textPrimary,
            }}
          >
            SYNAPSE
          </div>
          <div style={{ fontSize: 8.5, letterSpacing: 1.1, color: fm.color.textTertiary, marginTop: 3 }}>
            {streakSubtitle.toUpperCase()}
          </div>
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate?.(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "11px 16px",
                borderRadius: 14,
                border: "none",
                background: isActive ? fm.color.surface : "transparent",
                boxShadow: isActive ? fm.shadow.card : "none",
                color: isActive ? fm.color.accent : fm.color.textSecondary,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                textAlign: "left",
                transition: "all .18s ease",
              }}
            >
              <NavIcon name={item.icon} active={isActive} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div data-fm-role="sidebar-footer" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <Card padding={14} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: fm.color.textPrimary }}>Streak Protector</div>
            <div style={{ fontSize: 10, color: fm.color.textTertiary }}>You've got this.</div>
          </div>
        </Card>
      </div>
    </aside>
  );
}

function NeuralGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="2.4" fill={fm.color.accent} />
      {[0, 60, 120, 180, 240, 300].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const x = 15 + Math.cos(rad) * 10;
        const y = 15 + Math.sin(rad) * 10;
        return (
          <g key={i}>
            <line x1="15" y1="15" x2={x} y2={y} stroke={fm.color.accent} strokeWidth="1" opacity="0.5" />
            <circle cx={x} cy={y} r="1.6" fill={fm.color.accent} opacity="0.85" />
          </g>
        );
      })}
    </svg>
  );
}

const ICONS = {
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  check: "M5 13l4 4L19 7",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  message: "M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1.2-4.1A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z",
  trend: "M3 17l6-6 4 4 8-8M21 7v6h-6",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z",
  clock: "M12 8v4l3 3M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
  chart: "M4 20V10M12 20V4M20 20v-7",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  info: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
};

function NavIcon({ name, active }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d={ICONS[name] || ICONS.home}
        stroke={active ? fm.color.accent : fm.color.textTertiary}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Top bar : notifications + avatar, reused on every screen ── */
export function TopBar({ userInitial = "S", onOpenProfile }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, padding: "clamp(16px,4vw,28px) clamp(14px,4vw,40px) 0" }}>
      <button
        aria-label="Notifications"
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: fm.color.surface,
          border: `1px solid ${fm.color.border}`,
          boxShadow: fm.shadow.card,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"
            stroke={fm.color.textSecondary}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 9,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: fm.color.accent,
          }}
        />
      </button>
      <button
        onClick={onOpenProfile}
        aria-label="Profile"
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: fm.color.textPrimary,
          color: fm.color.textInverse,
          border: "none",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: fm.font.display,
        }}
      >
        {userInitial}
      </button>
    </div>
  );
}

/* ── Card : the one surface every panel in Focus Mode is built from ── */
export function Card({ children, padding = 24, style = {}, hover = false, className = "" }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={className}
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: fm.color.surface,
        border: `1px solid ${hover && hovered ? fm.color.accentSoftBorder : fm.color.border}`,
        borderRadius: fm.radius.lg,
        padding,
        boxShadow: hovered ? fm.shadow.cardHover : fm.shadow.card,
        transition: "box-shadow .3s cubic-bezier(.16,1,.3,1), transform .3s cubic-bezier(.16,1,.3,1), border-color .3s ease",
        transform: hovered ? "translateY(-3px)" : "none",
        willChange: hover ? "transform" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Eyebrow / section label, matches the "TODAY'S FOCUS" style caps ── */
export function Eyebrow({ children, style = {} }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 1.6,
        color: fm.color.textTertiary,
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Buttons ── */
export function Button({ children, variant = "primary", size = "md", onClick, disabled, style = {}, icon }) {
  const sizes = { sm: "8px 16px", md: "12px 22px", lg: "15px 28px" };
  const variants = {
    primary: { background: fm.color.textPrimary, color: fm.color.textInverse, border: "none" },
    accentGhost: {
      background: fm.color.accentSoft,
      color: fm.color.accentDeep,
      border: `1px solid ${fm.color.accentSoftBorder}`,
    },
    ghost: { background: "transparent", color: fm.color.textSecondary, border: `1px solid ${fm.color.border}` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variants[variant],
        padding: sizes[size],
        borderRadius: fm.radius.pill,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        opacity: disabled ? 0.5 : 1,
        transition: "all .2s ease",
        ...style,
      }}
    >
      {children}
      {icon === "arrow" && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/* ── Status badge — reuses the exact WIN / MID / SLIP semantics from
   Command Mode's Checkin verdict, just restyled for Focus Mode's palette. ── */
export function VerdictBadge({ verdict }) {
  const map = {
    WIN: { label: "Win", bg: fm.color.successSoft, fg: fm.color.success, border: fm.color.successBorder, icon: "🙂" },
    MID: { label: "Mid", bg: fm.color.warningSoft, fg: fm.color.warning, border: fm.color.warningBorder, icon: "😐" },
    SLIP: { label: "Slip", bg: fm.color.dangerSoft, fg: fm.color.danger, border: fm.color.dangerBorder, icon: "🙁" },
  };
  const v = map[verdict] || map.MID;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: fm.radius.pill,
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span>{v.icon}</span> {v.label}
    </span>
  );
}

/* ── Small stat tile used in the top-right stat cluster ── */
export function StatTile({ icon, label, value, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: fm.radius.sm,
          background: tintSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: fm.color.textPrimary, fontFamily: fm.font.display }}>{value}</div>
        <div style={{ fontSize: 10, color: fm.color.textTertiary }}>{label}</div>
      </div>
    </div>
  );
}

/* ── Progress bar, used for XP/phase progress and battle-plan progress ── */
export function ProgressBar({ pct, color = fm.color.accent, track = fm.color.surfaceSunken, height = 6, animateOnMount = false }) {
  const [display, setDisplay] = useState(animateOnMount ? 0 : pct);
  useEffect(() => {
    if (!animateOnMount) {
      setDisplay(pct);
      return;
    }
    const id = requestAnimationFrame(() => setDisplay(pct));
    return () => cancelAnimationFrame(id);
  }, [pct, animateOnMount]);
  return (
    <div style={{ height, background: track, borderRadius: height, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${Math.max(0, Math.min(100, display))}%`,
          background: color,
          borderRadius: height,
          transition: "width 1s cubic-bezier(.16,1,.3,1)",
        }}
      />
    </div>
  );
}

/* ── Weekly trend chart — generic sparkline/line-chart used anywhere a
   short time series needs showing (streak history today; urge intensity,
   mood trend, etc. on future screens). Not Home- or Check-In-specific. ── */
export function WeeklyTrendChart({
  points = [],
  color = fm.color.accent,
  width = 96,
  height = 34,
  labels = null,
  showLastDot = true,
  area = false,
  grid = false,
  badge = false,
  badgeSuffix = "",
  drawIn = false,
}) {
  const pathRef = useRef(null);
  const [drawn, setDrawn] = useState(!drawIn);
  const vals = points.length > 0 ? points : [0];
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const coords = vals.map((v, i) => {
    const x = vals.length === 1 ? width : (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / (max - min || 1)) * height;
    return [x, y];
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = area && coords.length > 0 ? `${path} L${coords[coords.length - 1][0]},${height} L${coords[0][0]},${height} Z` : null;
  const gradId = `fm-area-${color.replace("#", "")}`;
  const last = coords[coords.length - 1];

  useEffect(() => {
    if (!drawIn || !pathRef.current) return;
    const len = pathRef.current.getTotalLength();
    const el = pathRef.current;
    el.style.transition = "none";
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    el.getBoundingClientRect(); // force reflow before enabling the transition
    el.style.transition = "stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)";
    el.style.strokeDashoffset = "0";
    const t = setTimeout(() => setDrawn(true), 850);
    return () => clearTimeout(t);
  }, [drawIn, path]);

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: width }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        {grid &&
          [0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} stroke={fm.color.border} strokeWidth="1" />
          ))}
        {area && (
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {areaPath && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" style={drawIn ? { opacity: drawn ? 1 : 0, transition: "opacity .5s ease-out" } : undefined} />}
        <path ref={pathRef} d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {showLastDot && last && (
          <circle
            cx={last[0]}
            cy={last[1]}
            r="3"
            fill={color}
            stroke={fm.color.surface}
            strokeWidth="1.5"
            style={drawIn ? { opacity: drawn ? 1 : 0, transition: "opacity .3s ease-out", animation: drawn ? "fmPulseGlow 1s ease-in-out 1" : "none", transformOrigin: `${last[0]}px ${last[1]}px` } : undefined}
          />
        )}
      </svg>
      {badge && last && vals.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: `${(last[0] / width) * 100}%`,
            top: Math.max(0, (last[1] / height) * height - 22),
            transform: "translateX(-50%)",
            background: color,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: fm.radius.pill,
            whiteSpace: "nowrap",
            opacity: drawn ? 1 : 0,
            transition: "opacity .3s ease-out",
          }}
        >
          {vals[vals.length - 1]}
          {badgeSuffix}
        </div>
      )}
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 6 }}>
          {labels.map((l, i) => (
            <span key={i} style={{ fontSize: 9, color: fm.color.textTertiary }}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Recovery Phase card — single implementation shared by Home, Check-In,
   and any future screen that shows phase/XP progress. Takes plain data
   (level, nextLevel, streak, xpPct, color) so it stays free of any one
   screen's data-fetching concerns. ── */
export function RecoveryPhaseCard({ level, nextLevel, streak, xpPct, daysToNext, color = fm.color.accent, compact = false, animateOnMount = false }) {
  return (
    <Card padding={compact ? 20 : 26}>
      <Eyebrow style={{ marginBottom: 14 }}>Your Recovery Phase</Eyebrow>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: `${color}1a`,
            border: `1px solid ${color}40`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          🌱
        </div>
        <div>
          <div style={{ fontSize: 11, color: fm.color.textTertiary }}>Phase {level.level}</div>
          <div style={{ fontFamily: fm.font.display, fontSize: 20, fontWeight: 600, color: fm.color.textPrimary }}>
            {titleCase(level.title)}
          </div>
        </div>
      </div>
      <ProgressBar pct={xpPct} color={color} animateOnMount={animateOnMount} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: fm.color.textTertiary }}>
        <span>{streak} days</span>
        <span>{nextLevel ? `${nextLevel.minDays} days` : "Max phase"}</span>
      </div>
      {nextLevel && (
        <div style={{ marginTop: 12, fontSize: 11, color: fm.color.textSecondary }}>
          {daysToNext} day{daysToNext === 1 ? "" : "s"} to <strong>{titleCase(nextLevel.title)}</strong>
        </div>
      )}
    </Card>
  );
}

function titleCase(s = "") {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/* ── Selectable tile for a labeled option + description — generic enough
   for mood pickers, archetype pickers, or any future "choose one" step.
   Deliberately upbeat: soft tints, no harsh/alarming colors even for the
   hardest option — the palette communicates "safe to be honest here". ── */
export function OptionCard({ emoji, label, description, selected, onClick, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "14px 16px",
        borderRadius: fm.radius.md,
        border: `1.5px solid ${selected ? tint : fm.color.border}`,
        background: selected ? tintSoft : fm.color.surfaceMuted,
        textAlign: "left",
        transition: "all .2s ease",
        boxShadow: selected ? fm.shadow.card : "none",
      }}
    >
      <div style={{ fontSize: 20, marginBottom: 6 }}>{emoji}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 2 }}>{label}</div>
      {description && <div style={{ fontSize: 10.5, color: fm.color.textSecondary, lineHeight: 1.4 }}>{description}</div>}
    </button>
  );
}

/* ── Small rounded chip/pill toggle — used for status pills (Clean/
   Partial/Slipped), trigger tags, time-of-day tags; generic across any
   future multi-choice tag list. ── */
export function PillToggle({ label, active, onClick, tint = fm.color.accent, size = "sm" }) {
  const pad = size === "sm" ? "5px 12px" : "7px 14px";
  return (
    <button
      onClick={onClick}
      style={{
        padding: pad,
        borderRadius: fm.radius.pill,
        border: `1px solid ${active ? tint : fm.color.border}`,
        background: active ? `${tint}1f` : "transparent",
        color: active ? tint : fm.color.textTertiary,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        transition: "all .18s ease",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/* ── Inline banner strip — used for the live verdict readout, countdown
   reminders, or any short contextual notice tied to a color/tint. ── */
export function InlineBanner({ icon, children, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: fm.radius.sm,
        background: tintSoft,
        border: `1px solid ${tint}40`,
        fontSize: 11.5,
        color: tint,
        fontWeight: 600,
      }}
    >
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
      {children}
    </div>
  );
}

/* ── Recovery Timeline — generic horizontal phase-progression strip.
   Takes a list of {label, days} milestones plus the current streak, so any
   screen showing phase progression (Plan, Progress, ...) uses the same
   visual. Not tied to Plan specifically. ── */
export function RecoveryTimeline({ milestones, streak, color = fm.color.accent, descriptions = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "8px 4px" }}>
      {milestones.map((m, i) => {
        const reached = streak >= m.days;
        const isCurrent = reached && (i === milestones.length - 1 || streak < milestones[i + 1].days);
        return (
          <div key={m.label} style={{ display: "flex", alignItems: "center", flex: i === milestones.length - 1 ? "0 0 auto" : 1 }}>
            <div className="fm-timeline-node" style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64, position: "relative" }}>
              <motion.div
                animate={isCurrent ? { boxShadow: [`0 0 0 4px ${color}22`, `0 0 0 8px ${color}00`, `0 0 0 4px ${color}22`] } : {}}
                transition={isCurrent ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" } : {}}
                style={{
                  width: isCurrent ? 16 : 12,
                  height: isCurrent ? 16 : 12,
                  borderRadius: "50%",
                  background: reached ? color : fm.color.surface,
                  border: `2px solid ${reached ? color : fm.color.border}`,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 10.5, fontWeight: 700, color: reached ? fm.color.textPrimary : fm.color.textTertiary, marginTop: 8, whiteSpace: "nowrap" }}>
                {m.label}
              </div>
              <div style={{ fontSize: 9.5, color: fm.color.textTertiary, marginTop: 1 }}>{m.days} days</div>
              {descriptions[m.label] && (
                <div className="fm-timeline-tooltip" style={{ position: "absolute", bottom: "100%", marginBottom: 10, background: fm.color.surface, border: `1px solid ${fm.color.border}`, boxShadow: fm.shadow.cardHover, borderRadius: fm.radius.sm, padding: "8px 12px", width: 150, fontSize: 10.5, color: fm.color.textSecondary, opacity: 0, pointerEvents: "none", transition: "opacity .2s ease", zIndex: 5, textAlign: "center" }}>
                  {descriptions[m.label]}
                </div>
              )}
            </div>
            {i < milestones.length - 1 && (
              <div style={{ flex: 1, height: 2, background: fm.color.border, marginTop: -20, minWidth: 16, overflow: "hidden" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: streak >= milestones[i + 1].days ? "100%" : "0%" }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: "100%", background: color }}
                />
              </div>
            )}
          </div>
        );
      })}
      <style>{`.fm-timeline-node:hover .fm-timeline-tooltip { opacity: 1; }`}</style>
    </div>
  );
}

/* ── Metric card — the top-row "big number + icon" stat cards (Current
   Streak / Longest Streak / etc). Generic enough for any dashboard header
   row on Progress, Report, or a future summary screen. ── */
export function MetricCard({ icon, value, label, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <Card padding={18} style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: tintSoft,
          color: tint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 17,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontFamily: fm.font.display, fontSize: 22, fontWeight: 700, color: fm.color.textPrimary, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 2 }}>{label}</div>
      </div>
    </Card>
  );
}

/* ── Heatmap — generic week x day grid, colored by a per-cell "level" key.
   Used for the check-in consistency grid here; reusable for any other
   day-by-day pattern (urge log, journal streaks, etc). ── */
export function Heatmap({ weeks, dayLabels = ["M", "T", "W", "T", "F", "S", "S"], levelColors, cellSize = 20, cellReveal = false }) {
  let cellIndex = 0;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${dayLabels.length}, ${cellSize}px)`, gap: 5, marginBottom: 6 }}>
        <span />
        {dayLabels.map((d, i) => (
          <span key={i} style={{ fontSize: 9.5, color: fm.color.textTertiary, textAlign: "center" }}>
            {d}
          </span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: `44px repeat(${dayLabels.length}, ${cellSize}px)`, gap: 5, marginBottom: 5 }}>
          <span style={{ fontSize: 9.5, color: fm.color.textTertiary, alignSelf: "center" }}>{week.label}</span>
          {week.days.map((d, di) => {
            const idx = cellIndex++;
            return (
              <div
                key={di}
                title={d.tooltip || ""}
                className={cellReveal ? "fm-heat-cell fm-fade-up" : "fm-heat-cell"}
                style={{
                  width: cellSize,
                  height: cellSize,
                  borderRadius: 5,
                  background: levelColors[d.level] || fm.color.surfaceSunken,
                  animationDelay: cellReveal ? `${idx * 0.012}s` : undefined,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Donut chart — generic single-series proportion ring with a centered
   total. Reusable for verdict distribution here, and any future category
   breakdown (mood mix, trigger mix, etc). ── */
export function DonutChart({ segments, size = 120, thickness = 16, centerLabel, centerValue, drawIn = false }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const [mounted, setMounted] = useState(!drawIn);
  useEffect(() => {
    if (!drawIn) return;
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, [drawIn]);
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fm.color.surfaceSunken} strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circumference;
          const thisOffset = offset;
          const circle = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${mounted ? dash : 0} ${circumference - (mounted ? dash : 0)}`}
              strokeDashoffset={-thisOffset}
              strokeLinecap="butt"
              style={drawIn ? { transition: `stroke-dasharray .7s cubic-bezier(.16,1,.3,1) ${i * 0.15}s` } : undefined}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: fm.font.display, fontSize: 22, fontWeight: 700, color: fm.color.textPrimary }}>
          {drawIn ? <CountUp to={centerValue} play={mounted} duration={700} /> : centerValue}
        </div>
        {centerLabel && <div style={{ fontSize: 9.5, color: fm.color.textTertiary }}>{centerLabel}</div>}
      </div>
    </div>
  );
}

/* ── Mission progress row — a single addiction's clean/partial/slip bar +
   counts. Reusable in Plan, Report, or a future Missions screen. ── */
export function MissionProgressRow({ emoji, label, clean, partial, slip }) {
  const total = clean + partial + slip || 1;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 3fr 30px 30px 30px", alignItems: "center", gap: 10, padding: "9px 0" }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: fm.color.textPrimary }}>{label}</span>
      <div style={{ height: 8, borderRadius: 4, overflow: "hidden", display: "flex", background: fm.color.surfaceSunken }}>
        <div style={{ width: `${(clean / total) * 100}%`, background: fm.color.success }} />
        <div style={{ width: `${(partial / total) * 100}%`, background: fm.color.warning }} />
        <div style={{ width: `${(slip / total) * 100}%`, background: fm.color.danger }} />
      </div>
      <span style={{ fontSize: 11, color: fm.color.success, fontWeight: 700, textAlign: "center" }}>{clean}</span>
      <span style={{ fontSize: 11, color: fm.color.warning, fontWeight: 700, textAlign: "center" }}>{partial}</span>
      <span style={{ fontSize: 11, color: fm.color.danger, fontWeight: 700, textAlign: "center" }}>{slip}</span>
    </div>
  );
}

/* ── Markdown message — lightweight presentational renderer for chat text
   (bold, italics, inline code, code blocks, quotes, links, lists). This is
   purely text formatting, not AI/business logic — App.jsx's own richer
   renderer (if any) can be passed in via a `renderMessage` prop instead. ── */
export function MarkdownMessage({ text, tone = fm.color.textPrimary }) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let listBuffer = [];
  let codeBuffer = null;

  const flushList = () => {
    if (listBuffer.length) {
      blocks.push({ type: "list", items: listBuffer });
      listBuffer = [];
    }
  };

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) {
      if (codeBuffer === null) {
        codeBuffer = [];
      } else {
        blocks.push({ type: "code", text: codeBuffer.join("\n") });
        codeBuffer = null;
      }
      return;
    }
    if (codeBuffer !== null) {
      codeBuffer.push(line);
      return;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      listBuffer.push(line.trim().replace(/^[-*]\s+/, ""));
      return;
    }
    flushList();
    if (line.trim().startsWith(">")) {
      blocks.push({ type: "quote", text: line.trim().replace(/^>\s?/, "") });
    } else if (line.trim()) {
      blocks.push({ type: "p", text: line });
    } else {
      blocks.push({ type: "br" });
    }
  });
  flushList();

  const inline = (str, keyBase) => {
    const parts = str.split(/(\*\*.+?\*\*|\*.+?\*|`.+?`|\[.+?\]\(.+?\))/g).filter(Boolean);
    return parts.map((p, i) => {
      const key = `${keyBase}-${i}`;
      if (/^\*\*.+\*\*$/.test(p)) return <strong key={key} style={{ color: fm.color.accentDeep, fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
      if (/^\*.+\*$/.test(p)) return <em key={key}>{p.slice(1, -1)}</em>;
      if (/^`.+`$/.test(p))
        return (
          <code key={key} style={{ background: fm.color.surfaceSunken, padding: "1px 5px", borderRadius: 4, fontSize: "0.92em", fontFamily: "monospace" }}>
            {p.slice(1, -1)}
          </code>
        );
      const linkMatch = p.match(/^\[(.+?)\]\((.+?)\)$/);
      if (linkMatch)
        return (
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer" style={{ color: fm.color.accent, textDecoration: "underline" }}>
            {linkMatch[1]}
          </a>
        );
      return <span key={key}>{p}</span>;
    });
  };

  return (
    <div style={{ fontSize: 13, lineHeight: 1.8, color: tone }}>
      {blocks.map((b, i) => {
        if (b.type === "br") return <div key={i} style={{ height: 8 }} />;
        if (b.type === "p") return <p key={i} style={{ margin: 0 }}>{inline(b.text, i)}</p>;
        if (b.type === "quote")
          return (
            <p key={i} style={{ margin: "6px 0", paddingLeft: 12, borderLeft: `2px solid ${fm.color.accentSoftBorder}`, color: fm.color.textSecondary, fontStyle: "italic" }}>
              {inline(b.text, i)}
            </p>
          );
        if (b.type === "code")
          return (
            <pre key={i} style={{ background: fm.color.surfaceSunken, borderRadius: fm.radius.sm, padding: "10px 12px", overflowX: "auto", fontSize: 12, fontFamily: "monospace", margin: "8px 0" }}>
              {b.text}
            </pre>
          );
        if (b.type === "list")
          return (
            <ul key={i} style={{ margin: "6px 0", paddingLeft: 18 }}>
              {b.items.map((it, j) => (
                <li key={j} style={{ marginBottom: 3 }}>
                  {inline(it, `${i}-${j}`)}
                </li>
              ))}
            </ul>
          );
        return null;
      })}
    </div>
  );
}

/* ── Coach chat bubble — a single message, user or assistant. Renders via
   MarkdownMessage by default, or a custom `renderMessage` fn if the host
   app passes its own (e.g. App.jsx's real markdown/typewriter renderer). ── */
export function CoachBubble({ role, text, crisis, offTopic, timestamp, avatar, renderMessage }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 16, gap: 10 }}>
      {!isUser && (
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: crisis ? fm.color.infoSoft : fm.color.textPrimary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 13,
          }}
        >
          {avatar || (crisis ? "🤝" : "🧠")}
        </div>
      )}
      <div style={{ maxWidth: "72%" }}>
        <div
          style={{
            padding: "13px 16px",
            borderRadius: isUser ? `${fm.radius.md}px ${fm.radius.md}px 4px ${fm.radius.md}px` : `${fm.radius.md}px ${fm.radius.md}px ${fm.radius.md}px 4px`,
            background: isUser ? fm.color.accentSoft : crisis ? fm.color.infoSoft : fm.color.surfaceMuted,
            border: `1px solid ${isUser ? fm.color.accentSoftBorder : offTopic ? fm.color.dangerBorder : fm.color.border}`,
          }}
        >
          {renderMessage ? renderMessage(text) : <MarkdownMessage text={text} tone={isUser ? fm.color.accentDeep : fm.color.textPrimary} />}
        </div>
        {timestamp && (
          <div style={{ fontSize: 10, color: fm.color.textTertiary, marginTop: 4, textAlign: isUser ? "right" : "left" }}>{timestamp}</div>
        )}
      </div>
    </div>
  );
}

/* ── Typing / streaming indicator — three-dot pulse used while the coach
   is composing a reply. Purely presentational. ── */
export function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: fm.color.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
        🧠
      </div>
      <div style={{ display: "flex", gap: 4, padding: "13px 16px", borderRadius: fm.radius.md, background: fm.color.surfaceMuted, border: `1px solid ${fm.color.border}` }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: fm.color.textTertiary,
              animation: "fmPulseGlow 1s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Conversation date divider — centered pill splitting message groups. ── */
export function ConversationDivider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
      <div style={{ flex: 1, height: 1, background: fm.color.border }} />
      <span style={{ fontSize: 10.5, color: fm.color.textTertiary, fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: fm.color.border }} />
    </div>
  );
}

/* ── Coach input bar — attach / voice / text / send. Purely a controlled
   input; the actual send call is always delegated to the host via onSend. ── */
export function CoachInput({ value, onChange, onSend, loading, placeholder = "Ask your coach anything…" }) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !loading) onSend();
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: fm.color.surface, border: `1px solid ${fm.color.border}`, borderRadius: fm.radius.pill, padding: "8px 8px 8px 18px", boxShadow: fm.shadow.card }}>
      <button aria-label="Attach" style={{ background: "none", border: "none", color: fm.color.textTertiary, fontSize: 15, display: "flex", flexShrink: 0 }}>
        📎
      </button>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={loading}
        style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", fontSize: 13, fontFamily: fm.font.body, color: fm.color.textPrimary, maxHeight: 100, padding: "6px 0" }}
      />
      <button aria-label="Voice" style={{ background: "none", border: "none", color: fm.color.textTertiary, fontSize: 15, display: "flex", flexShrink: 0 }}>
        🎙️
      </button>
      <button
        aria-label="Send"
        onClick={() => value.trim() && !loading && onSend()}
        disabled={!value.trim() || loading}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: "none",
          background: value.trim() && !loading ? fm.color.accent : fm.color.surfaceSunken,
          color: value.trim() && !loading ? "#fff" : fm.color.textTertiary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
          transition: "all .2s ease",
        }}
      >
        ➤
      </button>
    </div>
  );
}

/* ── Tone selector card — Operator / Commander / Warlord picker. Purely
   presentational; the tone data (id/label/desc/toneAddon) always comes
   from the host app's own MODES definition via props. ── */
export function ToneCard({ icon, title, subtitle, description, selected, onSelect, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <Card
      padding={22}
      style={{
        border: `1.5px solid ${selected ? tint : fm.color.border}`,
        boxShadow: selected ? fm.shadow.cardHover : fm.shadow.card,
        transform: selected ? "translateY(-2px)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: tintSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontFamily: fm.font.display, fontSize: 16, fontWeight: 600, color: fm.color.textPrimary }}>{title}</div>
          <div style={{ fontSize: 10.5, color: tint, fontWeight: 600 }}>{subtitle}</div>
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: fm.color.textSecondary, lineHeight: 1.6, marginBottom: 16, minHeight: 34 }}>{description}</p>
      <Button
        variant={selected ? "primary" : "ghost"}
        size="sm"
        onClick={onSelect}
        style={{ width: "100%", justifyContent: "center", background: selected ? tint : undefined, color: selected ? "#fff" : undefined }}
      >
        {selected ? "✓ Currently Active" : "Select Tone"}
      </Button>
    </Card>
  );
}

/* ── Journal editor — auto-expanding textarea with live word count /
   reading time, save state, and Ctrl+S. Purely controlled; persistence is
   the caller's job (via onSave). Reusable anywhere free-form reflective
   writing is needed. ── */
const ROTATING_PROMPTS = [
  "What happened today?",
  "What did you overcome?",
  "What are you grateful for?",
  "What's weighing on you right now?",
  "What would your future self say to you today?",
];

export function JournalEditor({ title, onTitleChange, content, onContentChange, onSave, saving, lastSavedAt, placeholder, isOffline = false }) {
  const stats = useMemoWordStats(content);
  const [focused, setFocused] = useState(false);
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSave]);

  useEffect(() => {
    if (placeholder || content) return; // only rotate the default prompts, and stop once they're writing
    const id = setInterval(() => setPromptIdx((i) => (i + 1) % ROTATING_PROMPTS.length), 4000);
    return () => clearInterval(id);
  }, [placeholder, content]);

  const activePlaceholder = placeholder || ROTATING_PROMPTS[promptIdx];

  return (
    <div>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled reflection"
        style={{
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          fontFamily: fm.font.display,
          fontSize: 18,
          fontWeight: 600,
          color: fm.color.textPrimary,
          marginBottom: 12,
        }}
      />
      <div style={{ position: "relative" }}>
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={activePlaceholder}
          rows={8}
          style={{
            width: "100%",
            border: `1px solid ${focused ? fm.color.accentSoftBorder : "transparent"}`,
            borderRadius: fm.radius.lg,
            background: `linear-gradient(180deg, rgba(255,255,255,0.7), ${fm.color.surfaceMuted})`,
            padding: "22px 24px",
            fontSize: 14,
            lineHeight: 1.8,
            fontFamily: fm.font.body,
            color: fm.color.textPrimary,
            resize: "vertical",
            outline: "none",
            boxShadow: focused ? `0 0 0 3px ${fm.color.accentSoft}, 0 4px 20px -6px ${fm.color.accent}35` : "0 1px 2px rgba(42,32,20,0.04)",
            transition: "box-shadow .3s ease, border-color .3s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: fm.color.textTertiary }}>
          <span>{stats.wordCount} words · {stats.readingTime} min</span>
          <SaveStatus saving={saving} lastSavedAt={lastSavedAt} isOffline={isOffline} />
        </div>
        <Button variant="primary" size="sm" onClick={onSave} icon={null} style={{ background: fm.color.accent }}>
          ✎ Save Reflection
        </Button>
      </div>
    </div>
  );
}

function SaveStatus({ saving, lastSavedAt, isOffline }) {
  if (isOffline) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 5, color: fm.color.warning, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: fm.color.warning }} />
        Offline
      </span>
    );
  }
  if (saving) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 5, color: fm.color.accent, fontWeight: 600, animation: "fmPulseGlow 1.2s ease-in-out infinite" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: fm.color.accent }} />
        Saving…
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 5, color: fm.color.success, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: fm.color.success }} />
        Saved {lastSavedAt}
      </span>
    );
  }
  return null;
}

function useMemoWordStats(content) {
  const words = content?.trim().length ? content.trim().split(/\s+/).length : 0;
  return { wordCount: words, readingTime: Math.max(content ? 1 : 0, Math.round(words / 200)) };
}

/* ── Journal entry card — title, preview, date, word count, read/edit/
   delete actions. Reusable in Journal, Report, or a future archive view. ── */
export function JournalCard({ title, preview, date, wordCount, mood, moodColor, onRead, onEdit, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "16px 18px",
        marginBottom: 10,
        borderRadius: fm.radius.md,
        background: hover ? fm.color.surfaceMuted : fm.color.surface,
        border: `1px solid ${fm.color.border}`,
        boxShadow: hover ? fm.shadow.cardHover : fm.shadow.card,
        transform: hover ? "translateY(-3px) scale(1.005)" : "none",
        transition: "all .25s cubic-bezier(.22,1,.36,1)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <button onClick={onRead} style={{ background: "none", border: "none", textAlign: "left", flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: fm.color.textPrimary }}>{title || "Untitled reflection"}</div>
            {mood && (
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "capitalize", color: moodColor || fm.color.accent, background: `${moodColor || fm.color.accent}18`, padding: "2px 8px", borderRadius: fm.radius.pill }}>
                {mood}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 6 }}>
            {date} · {wordCount} words
          </div>
          <div style={{ fontSize: 11.5, color: fm.color.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</div>
        </button>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {onEdit && (
            <button onClick={onEdit} aria-label="Edit" style={{ background: "none", border: "none", color: fm.color.textTertiary, fontSize: 13, cursor: "pointer" }}>
              ✎
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} aria-label="Delete" style={{ background: "none", border: "none", color: fm.color.textTertiary, fontSize: 13, cursor: "pointer" }}>
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Reflection calendar — GitHub-style month grid shaded by real entry
   depth. Generic: takes pre-built cells (see synapseData.journalCalendarMonth
   or an analogous derivation for another dataset). ── */
export function ReflectionCalendar({ monthLabel, cells, depthColors, onPrevMonth, onNextMonth, onHoverCell }) {
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: fm.font.display, fontSize: 14, fontWeight: 600, color: fm.color.textPrimary }}>{monthLabel}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onPrevMonth} style={navBtnStyle}>‹</button>
          <button onClick={onNextMonth} style={navBtnStyle}>›</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 6 }}>
        {dayLabels.map((d) => (
          <div key={d} style={{ fontSize: 9.5, color: fm.color.textTertiary, textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
        {cells.map((c, i) =>
          c === null ? (
            <div key={i} />
          ) : (
            <div
              key={i}
              onMouseEnter={() => onHoverCell?.(c)}
              onMouseLeave={() => onHoverCell?.(null)}
              style={{
                aspectRatio: "1",
                borderRadius: 8,
                background: depthColors[c.depth],
                border: c.isToday ? `1.5px solid ${fm.color.accent}` : "1px solid transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: c.depth === "none" ? fm.color.textTertiary : fm.color.textPrimary,
                cursor: c.entry ? "pointer" : "default",
              }}
            >
              {c.day}
            </div>
          )
        )}
      </div>
    </div>
  );
}

const navBtnStyle = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: `1px solid ${fm.color.border}`,
  background: fm.color.surface,
  color: fm.color.textSecondary,
  fontSize: 12,
};

/* ── Memory card — a short verbatim quote pulled from the user's own past
   entry, with its date. Generic "highlight quote" card. ── */
export function MemoryCard({ text, date, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: fm.color.surfaceMuted,
        border: `1px solid ${fm.color.border}`,
        borderRadius: fm.radius.md,
        padding: "16px 16px 14px",
        minWidth: 160,
        flex: "1 1 160px",
      }}
    >
      <div style={{ fontSize: 18, color: fm.color.accentSoftBorder, lineHeight: 1, marginBottom: 6 }}>"</div>
      <div style={{ fontSize: 12.5, color: fm.color.textPrimary, lineHeight: 1.6, marginBottom: 10 }}>{text}</div>
      <div style={{ fontSize: 10, color: fm.color.textTertiary }}>{date}</div>
    </button>
  );
}

/* ── Insight card / row — a single data-backed observation, used in Growth
   Insights here and reusable for any "here's what your data shows" list. ── */
export function InsightCard({ icon = "◆", text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: fm.color.warningSoft, borderRadius: fm.radius.sm, marginBottom: 8 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 12, color: fm.color.textPrimary }}>{text}</span>
    </div>
  );
}

/* ── Mood timeline — horizontal dot timeline with hover preview. Generic
   over any {date, isToday, entry:{title,mood,preview}|null}[] series. ── */
export function MoodTimeline({ days, moodColors, onHoverDay }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  return (
    <div style={{ position: "relative", padding: "24px 4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: fm.color.border }} />
        {days.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
            <div
              onMouseEnter={() => {
                setHoverIdx(i);
                onHoverDay?.(d);
              }}
              onMouseLeave={() => {
                setHoverIdx(null);
                onHoverDay?.(null);
              }}
              style={{
                width: d.isToday ? 13 : 9,
                height: d.isToday ? 13 : 9,
                borderRadius: "50%",
                background: d.entry ? moodColors[d.entry.mood] || fm.color.textTertiary : fm.color.surfaceSunken,
                border: d.isToday ? `2px solid ${fm.color.textPrimary}` : "none",
                zIndex: 1,
                cursor: d.entry ? "pointer" : "default",
              }}
            />
            <div style={{ fontSize: 8.5, color: fm.color.textTertiary, marginTop: 8, whiteSpace: "nowrap" }}>
              {d.isToday ? "Today" : d.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </div>
            {hoverIdx === i && d.entry && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  marginBottom: 10,
                  background: fm.color.surface,
                  border: `1px solid ${fm.color.border}`,
                  boxShadow: fm.shadow.cardHover,
                  borderRadius: fm.radius.sm,
                  padding: "10px 12px",
                  width: 160,
                  zIndex: 5,
                }}
              >
                <div style={{ fontSize: 10, color: fm.color.textTertiary, marginBottom: 3 }}>
                  {d.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 3 }}>{d.entry.title || "Untitled"}</div>
                <div style={{ fontSize: 10.5, color: fm.color.textSecondary }}>{d.entry.preview}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Prompt card — reflection prompt with a refresh action. Generic over
   any rotating-suggestion use case. ── */
export function PromptCard({ prompt, onRefresh, dotCount = 4, dotIndex = 0 }) {
  return (
    <Card padding={22}>
      <Eyebrow style={{ marginBottom: 14 }}>Today's Prompt</Eyebrow>
      <p style={{ fontFamily: fm.font.display, fontSize: 17, fontWeight: 600, color: fm.color.textPrimary, lineHeight: 1.4, marginBottom: 16 }}>{prompt}</p>
      <div style={{ display: "flex", gap: 5, marginBottom: 16 }}>
        {Array.from({ length: dotCount }).map((_, i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === dotIndex ? fm.color.accent : fm.color.surfaceSunken }} />
        ))}
      </div>
      <Button variant="accentGhost" size="sm" onClick={onRefresh} style={{ width: "100%", justifyContent: "center" }}>
        ↻ Generate Another Prompt
      </Button>
    </Card>
  );
}

/* ── Emergency hero card — the big "start rescue" call to action. Purely
   presentational: the actual rescue flow is triggered via onStart, whose
   implementation lives entirely in the host app. ── */
export function EmergencyHeroCard({ title, description, buttonLabel, onStart, footnote }) {
  return (
    <Card padding={36} style={{ position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          right: -40,
          top: -40,
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${fm.color.bgGlowAmber}, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, position: "relative" }}>
        <div style={{ width: 44, height: 44, borderRadius: fm.radius.sm, background: fm.color.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
          ⚡
        </div>
      </div>
      <div style={{ fontFamily: fm.font.display, fontSize: 28, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 12, position: "relative" }}>{title}</div>
      <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.7, maxWidth: 420, marginBottom: 24, position: "relative" }}>{description}</p>
      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        style={{ background: fm.color.textPrimary, position: "relative" }}
      >
        ⚡ {buttonLabel}
      </Button>
      {footnote && (
        <div style={{ marginTop: 16, fontSize: 11, color: fm.color.textTertiary, display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <span>🛡️</span>
          {footnote}
        </div>
      )}
    </Card>
  );
}

/* ── Rescue-active card — renders whatever live rescue state the host app
   provides (timeLeft, task, progress, phase). No timer logic lives here;
   this only formats and displays props, plus forwards user actions. ── */
export function RescueActiveCard({ timeLabel, phaseLabel, phaseSub, progressPct, task, onNewTask, onLogWin, onLogSlip, color = fm.color.accent }) {
  return (
    <Card padding={32} style={{ textAlign: "center" }}>
      <Eyebrow style={{ marginBottom: 8 }}>{phaseLabel}</Eyebrow>
      {phaseSub && <div style={{ fontSize: 12, color: fm.color.textSecondary, marginBottom: 20 }}>{phaseSub}</div>}
      <div style={{ fontFamily: fm.font.display, fontSize: 56, fontWeight: 700, color, marginBottom: 20 }}>{timeLabel}</div>
      <ProgressBar pct={progressPct} color={color} height={5} />
      {task && (
        <div style={{ marginTop: 24, padding: "16px 18px", background: fm.color.surfaceMuted, borderRadius: fm.radius.md, textAlign: "left" }}>
          <Eyebrow style={{ marginBottom: 8 }}>Do This Now</Eyebrow>
          <div style={{ fontSize: 13.5, color: fm.color.textPrimary, lineHeight: 1.6, marginBottom: 10 }}>{task}</div>
          {onNewTask && (
            <button onClick={onNewTask} style={{ background: "none", border: "none", color: fm.color.accent, fontSize: 11, fontWeight: 600 }}>
              Give me another →
            </button>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        {onLogWin && (
          <Button variant="primary" onClick={onLogWin} style={{ flex: 1, justifyContent: "center", background: fm.color.success }}>
            I Held the Line ✓
          </Button>
        )}
        {onLogSlip && (
          <Button variant="ghost" onClick={onLogSlip} style={{ flex: 1, justifyContent: "center" }}>
            I Gave In
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ── Peak hours bar chart — generic small bar chart over labeled buckets.
   Reusable anywhere a time-of-day distribution needs showing. ── */
export function PeakHoursChart({ buckets, color = fm.color.accent, height = 90 }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height }}>
      {buckets.map((b, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: "100%",
              maxWidth: 26,
              height: `${Math.max(4, (b.count / max) * (height - 20))}px`,
              background: b.count === max && b.count > 0 ? color : `${color}55`,
              borderRadius: 5,
            }}
          />
          <span style={{ fontSize: 8.5, color: fm.color.textTertiary, whiteSpace: "nowrap" }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── History timeline row — a single past-session row (icon, label, meta,
   status badge). Generic across urge sessions, check-ins, or any log. ── */
export function HistoryTimeline({ rows, renderStatus, onRowClick }) {
  return (
    <div>
      {rows.map((r, i) => (
        <button
          key={i}
          onClick={() => onRowClick?.(r)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "12px 4px",
            borderBottom: i < rows.length - 1 ? `1px solid ${fm.color.border}` : "none",
            background: "none",
            border: "none",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 11, color: fm.color.textTertiary, width: 92, flexShrink: 0 }}>{r.timeLabel}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: fm.color.textPrimary }}>{r.title}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {r.meta && <span style={{ fontSize: 11, color: fm.color.textTertiary }}>{r.meta}</span>}
            {renderStatus ? renderStatus(r) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Quick action card — small icon + label + sublabel nav tile. Generic
   for any "shortcuts" row across Focus Mode screens. ── */
export function QuickActionCard({ icon, label, sublabel, onClick, tint = fm.color.accent, tintSoft = fm.color.accentSoft }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "14px 16px",
        borderRadius: fm.radius.md,
        background: tintSoft,
        border: `1px solid ${tint}30`,
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.textPrimary }}>{label}</div>
        {sublabel && <div style={{ fontSize: 10.5, color: fm.color.textTertiary }}>{sublabel}</div>}
      </div>
      <span style={{ color: fm.color.textTertiary, fontSize: 14 }}>›</span>
    </button>
  );
}

/* ── Neural orb — a glowing glass sphere with a branching light-tree
   inside, for hero sections that want a premium illustrated focal point.
   Pure SVG/CSS, no images. Generic, reusable anywhere. ── */
export function NeuralOrb({ size = 260, color = fm.color.accent, floatEnabled = true }) {
  const branches = [
    { x1: 50, y1: 78, x2: 50, y2: 55 },
    { x1: 50, y1: 55, x2: 36, y2: 40 },
    { x1: 50, y1: 55, x2: 64, y2: 42 },
    { x1: 36, y1: 40, x2: 26, y2: 28 },
    { x1: 36, y1: 40, x2: 34, y2: 24 },
    { x1: 64, y1: 42, x2: 74, y2: 30 },
    { x1: 64, y1: 42, x2: 60, y2: 24 },
    { x1: 50, y1: 55, x2: 50, y2: 34 },
    // second tier — denser branching so the sphere reads as a full neural
    // core, not a sparse sketch
    { x1: 26, y1: 28, x2: 18, y2: 20 },
    { x1: 26, y1: 28, x2: 20, y2: 34 },
    { x1: 34, y1: 24, x2: 30, y2: 14 },
    { x1: 74, y1: 30, x2: 82, y2: 22 },
    { x1: 74, y1: 30, x2: 80, y2: 36 },
    { x1: 60, y1: 24, x2: 64, y2: 14 },
    { x1: 50, y1: 34, x2: 44, y2: 22 },
    { x1: 50, y1: 34, x2: 56, y2: 22 },
    { x1: 50, y1: 78, x2: 42, y2: 68 },
    { x1: 50, y1: 78, x2: 58, y2: 68 },
  ];
  const nodes = [
    { x: 26, y: 28, r: 1.6 }, { x: 34, y: 24, r: 1.3 }, { x: 74, y: 30, r: 1.6 },
    { x: 60, y: 24, r: 1.3 }, { x: 50, y: 34, r: 2 }, { x: 36, y: 40, r: 1.4 },
    { x: 64, y: 42, r: 1.4 }, { x: 50, y: 55, r: 2.4 },
    { x: 18, y: 20, r: 1 }, { x: 20, y: 34, r: 1 }, { x: 30, y: 14, r: 0.9 },
    { x: 82, y: 22, r: 1 }, { x: 80, y: 36, r: 1 }, { x: 64, y: 14, r: 0.9 },
    { x: 44, y: 22, r: 1 }, { x: 56, y: 22, r: 1 }, { x: 42, y: 68, r: 1.1 }, { x: 58, y: 68, r: 1.1 },
  ];

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: size, aspectRatio: "1 / 1", animation: floatEnabled ? "fmFloat 9s ease-in-out infinite" : "none", willChange: "transform" }}>
      {/* ambient bloom behind the sphere */}
      <div style={{ position: "absolute", inset: "-28%", borderRadius: "50%", background: `radial-gradient(circle, ${color}38, transparent 65%)`, animation: floatEnabled ? "fmPulseGlow 5s ease-in-out infinite" : "none", willChange: "opacity" }} />
      <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "relative", display: "block" }}>
        <defs>
          <radialGradient id="fm-orb-glass" cx="35%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.02" />
          </radialGradient>
          <radialGradient id="fm-orb-base" cx="50%" cy="88%" r="34%">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fm-orb-core" cx="50%" cy="68%" r="30%">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* base glow puddle under the sphere */}
        <ellipse cx="50" cy="92" rx="28" ry="4.5" fill="url(#fm-orb-base)" />

        {/* outer rings, faint */}
        {[48, 42].map((r, i) => (
          <circle key={i} cx="50" cy="46" r={r} fill="none" stroke={color} strokeWidth="0.25" opacity={0.12 - i * 0.03} />
        ))}

        {/* glass sphere */}
        <circle cx="50" cy="46" r="40" fill="url(#fm-orb-glass)" stroke={color} strokeOpacity="0.2" strokeWidth="0.5" />

        {/* warm core glow where the trunk meets the base */}
        <circle cx="50" cy="60" r="16" fill="url(#fm-orb-core)" />

        {/* light tree inside — dense enough to read as a full neural core */}
        <g opacity="0.92">
          {branches.map((b, i) => (
            <line key={i} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={color} strokeWidth={i < 8 ? 0.7 : 0.45} strokeLinecap="round" opacity={i < 8 ? 0.6 : 0.4} />
          ))}
          {nodes.map((n, i) => (
            <circle
              key={i}
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={color}
              style={{ animation: "fmPulseGlow 2.6s ease-in-out infinite", animationDelay: `${i * 0.15}s`, transformOrigin: `${n.x}px ${n.y}px` }}
            />
          ))}
        </g>

        {/* highlight sheen */}
        <ellipse cx="36" cy="26" rx="13" ry="8" fill="#fff" opacity="0.28" transform="rotate(-25 36 26)" />
      </svg>
    </div>
  );
}

/* ── Journey stepper — a horizontal narrative sequence of real milestones
   (icon, day label, title, description), with a "you are here" highlight.
   Generic over any ordered stop list, reusable beyond Report. ── */
export function JourneyStepper({ stops, currentIndex }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", overflowX: "auto", gap: 4, padding: "4px 2px" }}>
      {stops.map((s, i) => {
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;
        const isFuture = i > currentIndex;
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", flex: i === stops.length - 1 ? "0 0 auto" : 1, minWidth: 92 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", minWidth: 92 }}>
              <div
                style={{
                  width: isCurrent ? 46 : 38,
                  height: isCurrent ? 46 : 38,
                  borderRadius: "50%",
                  background: isCurrent ? fm.color.accent : isPast ? fm.color.accentSoft : fm.color.surfaceMuted,
                  border: `1.5px solid ${isCurrent ? fm.color.accent : isPast ? fm.color.accentSoftBorder : fm.color.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isCurrent ? 18 : 15,
                  color: isCurrent ? "#fff" : isFuture ? fm.color.textTertiary : fm.color.accentDeep,
                  boxShadow: isCurrent ? fm.shadow.pop : "none",
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: isCurrent ? fm.color.accentDeep : fm.color.textTertiary, marginBottom: 2 }}>{s.dayLabel}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: isFuture ? fm.color.textTertiary : fm.color.textPrimary, marginBottom: 3 }}>{s.title}</div>
              <div style={{ fontSize: 9.5, color: fm.color.textTertiary, lineHeight: 1.4, maxWidth: 100 }}>{s.description}</div>
            </div>
            {i < stops.length - 1 && (
              <div style={{ flex: 1, height: 2, background: isPast ? fm.color.accentSoftBorder : fm.color.border, marginTop: 19, minWidth: 12 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Identity card — a labeled attribute tile (Archetype, Phase, etc.)
   with an icon/emoji, title, and short caption. Generic "profile facet"
   card reusable anywhere a set of identity attributes is shown. ── */
export function IdentityCard({ eyebrow, icon, title, caption, children }) {
  return (
    <Card padding={26} hover style={{ textAlign: "center" }}>
      {eyebrow && <Eyebrow style={{ marginBottom: 16 }}>{eyebrow}</Eyebrow>}
      {children ? (
        children
      ) : (
        <>
          {icon && (
            <div
              className="fm-icon-pop"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: fm.color.accentSoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: fm.color.accentDeep,
                margin: "0 auto 16px",
                transition: "transform .3s cubic-bezier(.16,1,.3,1)",
              }}
            >
              {icon}
            </div>
          )}
          <div style={{ fontFamily: fm.font.display, fontSize: 15.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 6, lineHeight: 1.35 }}>{title}</div>
          {caption && <div style={{ fontSize: 11, color: fm.color.textTertiary, lineHeight: 1.55 }}>{caption}</div>}
        </>
      )}
    </Card>
  );
}

/* ── Victory row — a single real logged event (check-in win, urge defeat,
   journal entry) with a type icon, title, quoted detail, and relative
   date. Generic timeline row reusable for any merged-event feed. ── */
export function VictoryRow({ icon, title, detail, when, tint = fm.color.success }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: `1px solid ${fm.color.border}` }}>
      <span style={{ color: tint, fontSize: 14, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.textPrimary }}>{title}</div>
        <div style={{ fontSize: 11, color: fm.color.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{detail}"</div>
      </div>
      <span style={{ fontSize: 10, color: fm.color.textTertiary, flexShrink: 0 }}>{when}</span>
    </div>
  );
}

/* ── Neuron art — soft breathing hero illustration built from CSS/SVG,
   no external image asset. Generic decorative component, reusable
   anywhere a calm brand-mark visual is wanted. ── */
export function NeuronArt({ size = 260, color = fm.color.accent }) {
  const nodes = [0, 51, 102, 154, 205, 257, 308].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: 50 + Math.cos(rad) * 34, y: 50 + Math.sin(rad) * 34 };
  });
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: size, aspectRatio: "1 / 1", animation: "fmFloat 8s ease-in-out infinite", willChange: "transform" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}20, transparent 68%)`,
          animation: "fmPulseGlow 4.5s ease-in-out infinite",
          willChange: "opacity",
        }}
      />
      <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "relative", display: "block" }}>
        {[14, 24, 34].map((r, i) => (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="0.35"
            opacity={0.14 - i * 0.03}
            style={{ animation: `fmPulseGlow ${5 + i}s ease-in-out infinite`, animationDelay: `${i * 0.6}s`, transformOrigin: "50px 50px" }}
          />
        ))}
        {nodes.map((n, i) => (
          <line key={`l${i}`} x1="50" y1="50" x2={n.x} y2={n.y} stroke={color} strokeWidth="0.6" opacity="0.45" />
        ))}
        {nodes.map((n, i) => (
          <circle
            key={`n${i}`}
            cx={n.x}
            cy={n.y}
            r="2.4"
            fill={color}
            opacity="0.85"
            style={{ animation: "fmPulseGlow 3s ease-in-out infinite", animationDelay: `${i * 0.25}s`, transformOrigin: `${n.x}px ${n.y}px` }}
          />
        ))}
        <circle cx="50" cy="50" r="5.5" fill={color} />
      </svg>
    </div>
  );
}

/* ── Founder card — initials avatar (no photo), name, role, focus and
   contribution copy. Generic "person profile" card, reusable for a future
   team page. ── */
export function FounderCard({ initials, name, role, focus, contribution }) {
  return (
    <Card padding={30} hover>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
        <div
          className="fm-icon-pop"
          style={{
            width: 60,
            height: 60,
            borderRadius: fm.radius.md,
            flexShrink: 0,
            background: `linear-gradient(145deg, ${fm.color.accent}, ${fm.color.accentDeep})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fm.font.display,
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            boxShadow: fm.shadow.pop,
            transition: "transform .3s cubic-bezier(.16,1,.3,1)",
          }}
        >
          {initials}
        </div>
        <div>
          <div style={{ fontFamily: fm.font.display, fontSize: 19, fontWeight: 700, color: fm.color.textPrimary, letterSpacing: -0.2 }}>{name}</div>
          <div style={{ fontSize: 10.5, color: fm.color.accentDeep, fontWeight: 700, marginTop: 4, letterSpacing: 0.8, textTransform: "uppercase" }}>{role}</div>
        </div>
      </div>
      <div style={{ height: 1, background: fm.color.border, marginBottom: 20 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Eyebrow style={{ marginBottom: 7 }}>Focus</Eyebrow>
          <p style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.65, margin: 0 }}>{focus}</p>
        </div>
        <div>
          <Eyebrow style={{ marginBottom: 7 }}>Contribution</Eyebrow>
          <p style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.65, margin: 0 }}>{contribution}</p>
        </div>
      </div>
    </Card>
  );
}

/* ── Compare table — a two-column "A vs B" row list. Generic enough for
   any before/after or old-vs-new comparison, not About-page specific. ── */
export function CompareTable({ leftLabel, rightLabel, rows }) {
  return (
    <div style={{ border: `1px solid ${fm.color.border}`, borderRadius: fm.radius.lg, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: "clamp(10px,3vw,16px) clamp(10px,4vw,24px)", fontSize: 12, fontWeight: 700, color: fm.color.textTertiary, background: fm.color.surfaceMuted, borderBottom: `1px solid ${fm.color.border}`, letterSpacing: 0.3 }}>
          {leftLabel}
        </div>
        <div
          style={{
            padding: "clamp(10px,3vw,16px) clamp(10px,4vw,24px)",
            fontSize: 12,
            fontWeight: 700,
            color: fm.color.accentDeep,
            background: fm.color.accentSoft,
            borderBottom: `1px solid ${fm.color.accentSoftBorder}`,
            borderLeft: `2px solid ${fm.color.accent}`,
            letterSpacing: 0.3,
          }}
        >
          {rightLabel}
        </div>
      </div>
      {rows.map(([a, b], i) => (
        <div
          key={i}
          className="fm-fade-up"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: i ? `1px solid ${fm.color.border}` : "none", animationDelay: `${Math.min(i * 0.05, 0.5)}s` }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "clamp(10px,3vw,16px) clamp(10px,4vw,24px)", fontSize: 12.5, color: fm.color.textSecondary, lineHeight: 1.6 }}>
            <span style={{ color: fm.color.textTertiary, fontSize: 11, flexShrink: 0 }}>✕</span>
            {a}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "clamp(10px,3vw,16px) clamp(10px,4vw,24px)",
              fontSize: 12.5,
              color: fm.color.textPrimary,
              fontWeight: 500,
              lineHeight: 1.6,
              background: fm.color.accentSoft,
              borderLeft: `2px solid ${fm.color.accent}`,
            }}
          >
            <span style={{ color: fm.color.success, fontSize: 12, flexShrink: 0 }}>✓</span>
            {b}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Bullet card — a titled card with a short list of dash-prefixed
   points. Generic content card, reusable wherever a labeled bullet list
   needs a card wrapper. ── */
export function BulletCard({ title, points }) {
  return (
    <Card padding={22}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.accentDeep, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {points.map((p, i) => (
          <div key={i} style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.6 }}>
            — {p}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Vertical timeline — connected dots with sequential fade-up reveal.
   Generic ordered-history component, reusable wherever a narrative
   timeline (not a phase progression) is needed. ── */
export function VerticalTimeline({ items, color = fm.color.accent }) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="fm-fade-up" style={{ display: "flex", gap: 18, animationDelay: `${i * 0.12}s` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: fm.color.accentSoft,
                border: `1.5px solid ${fm.color.accentSoftBorder}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: fm.font.display,
                fontSize: 13,
                fontWeight: 700,
                color,
              }}
            >
              {i + 1}
            </div>
            {i < items.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 34, background: fm.color.border, margin: "4px 0" }} />}
          </div>
          <div style={{ paddingBottom: i < items.length - 1 ? 28 : 0 }}>
            <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.7, margin: 0, paddingTop: 6 }}>{it}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Toggle switch — smooth spring-style slide, controlled. Generic
   on/off control reusable anywhere a boolean preference is shown. ── */
export function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 42,
        height: 24,
        borderRadius: fm.radius.pill,
        border: "none",
        background: checked ? fm.color.accent : fm.color.surfaceSunken,
        position: "relative",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "background .25s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left .25s cubic-bezier(.34,1.56,.64,1)",
        }}
      />
    </button>
  );
}

/* ── Radio card — a selectable option card with icon/title/description,
   scale + outline animation on select. Generic single-choice tile,
   reusable beyond tone/appearance pickers. ── */
export function RadioCard({ icon, title, description, selected, onSelect, tint = fm.color.accent }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "16px 18px",
        borderRadius: fm.radius.md,
        border: `1.5px solid ${selected ? tint : fm.color.border}`,
        background: selected ? `${tint}10` : fm.color.surface,
        boxShadow: selected ? `0 0 0 3px ${tint}1a` : "none",
        transform: selected ? "scale(1)" : "scale(0.99)",
        transition: "all .25s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      {icon && <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: fm.color.textPrimary }}>{title}</span>
        </div>
        {description && <div style={{ fontSize: 11, color: fm.color.textSecondary, marginTop: 3, lineHeight: 1.5 }}>{description}</div>}
      </div>
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `1.5px solid ${selected ? tint : fm.color.border}`,
          background: selected ? tint : "transparent",
          flexShrink: 0,
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
      </div>
    </button>
  );
}

/* ── Settings row — label + description on the left, arbitrary control
   (toggle, input, select) on the right. Generic list-row layout reusable
   for any preferences screen. ── */
export function SettingsRow({ icon, title, description, control, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 4px" }}>
      {icon && (
        <div style={{ width: 36, height: 36, borderRadius: fm.radius.sm, background: fm.color.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.textPrimary }}>{title}</div>
        {description && <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 2 }}>{description}</div>}
      </div>
      {meta && <div style={{ fontSize: 11, color: fm.color.textTertiary, flexShrink: 0 }}>{meta}</div>}
      {control && <div style={{ flexShrink: 0 }}>{control}</div>}
    </div>
  );
}

/* ── Danger action — an outlined destructive button with icon/title/
   description, used for irreversible actions. Generic, reusable for any
   confirm-then-destroy control. ── */
export function DangerAction({ icon = "🗑", title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        borderRadius: fm.radius.md,
        border: `1px solid ${fm.color.dangerBorder}`,
        background: fm.color.dangerSoft,
        textAlign: "left",
        width: "100%",
      }}
    >
      <span style={{ color: fm.color.danger, fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: fm.color.danger }}>{title}</div>
        {description && <div style={{ fontSize: 10.5, color: fm.color.textSecondary, marginTop: 2 }}>{description}</div>}
      </div>
    </button>
  );
}

/* ── Confirm modal — generic confirm-before-destroy dialog. Reusable for
   any irreversible action across Focus Mode. ── */
export function ConfirmModal({ title, description, confirmLabel = "Confirm", danger = true, onConfirm, onCancel, requireTypedConfirm = null }) {
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const locked = requireTypedConfirm && typed !== requireTypedConfirm;
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(42,32,20,0.35)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} className="fm-fade-up" style={{ background: fm.color.surface, borderRadius: fm.radius.lg, padding: 28, maxWidth: 380, width: "90%", boxShadow: fm.shadow.cardHover }}>
        <div style={{ fontFamily: fm.font.display, fontSize: 17, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 10 }}>{title}</div>
        <p style={{ fontSize: 12.5, color: fm.color.textSecondary, lineHeight: 1.6, marginBottom: requireTypedConfirm ? 16 : 22 }}>{description}</p>
        {requireTypedConfirm && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, color: fm.color.textTertiary, marginBottom: 8 }}>
              Type <strong style={{ color: fm.color.danger }}>{requireTypedConfirm}</strong> to continue.
            </div>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={requireTypedConfirm}
              autoFocus
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: fm.radius.sm,
                border: `1px solid ${focused ? fm.color.dangerBorder : fm.color.border}`,
                boxShadow: focused ? `0 0 0 3px ${fm.color.dangerSoft}` : "none",
                outline: "none",
                fontSize: 13,
                fontFamily: fm.font.body,
                color: fm.color.textPrimary,
                transition: "box-shadow .2s ease, border-color .2s ease",
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="ghost" onClick={onCancel} style={{ flex: 1, justifyContent: "center" }}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={locked}
            style={{ flex: 1, justifyContent: "center", background: danger ? fm.color.danger : fm.color.accent, opacity: locked ? 0.45 : 1, cursor: locked ? "not-allowed" : "pointer" }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const EASE = [0.22, 1, 0.36, 1];
export const GLASS_CARD = {
  borderRadius: 26,
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.85)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  boxShadow: "0 1px 1px rgba(42,32,20,0.04), 0 20px 48px -14px rgba(42,32,20,0.15)",
};
export const HOVER_LIFT = { whileHover: { y: -4, transition: { duration: 0.2, ease: EASE } } };

/* ── Ambient background — the exact layered glow/particle/noise system
   Home uses. Shared so every screen gets the identical atmosphere. ── */
export function AmbientBackground({ color = fm.color.accent }) {
  const points = [
    [6, 16], [20, 60], [13, 84], [93, 10], [89, 38], [96, 74], [50, 5], [62, 92], [33, 45], [79, 57], [45, 8], [8, 55],
  ];
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
      <div style={{ position: "absolute", top: "-16%", left: "32%", width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.bgGlowAmber}, transparent 66%)`, filter: "blur(16px)" }} />
      <div style={{ position: "absolute", top: "2%", right: "-4%", width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.bgGlowPeach}, transparent 70%)`, filter: "blur(8px)" }} />
      <div style={{ position: "absolute", bottom: "-12%", left: "6%", width: 420, height: 420, borderRadius: "50%", background: `radial-gradient(circle, ${color}1c, transparent 72%)`, filter: "blur(10px)" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 100% at 50% 0%, transparent 55%, rgba(42,32,20,0.05) 100%)" }} />
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.025, mixBlendMode: "multiply" }}>
        <filter id="fm-noise-shared">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#fm-noise-shared)" />
      </svg>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {points.map(([x, y], i) => (
          <circle key={i} cx={`${x}%`} cy={`${y}%`} r={i % 3 === 0 ? 1.7 : 1} fill={color} opacity={0.2} style={{ animation: `fmPulseGlow ${4 + (i % 4)}s ease-in-out infinite`, animationDelay: `${i * 0.35}s` }} />
        ))}
      </svg>
    </div>
  );
}

/* ── Count-up number — animates 0 -> the real value once, then just
   displays the value on subsequent renders. Reusable anywhere a stat
   number should feel alive without misrepresenting the underlying data. ── */
export function CountUp({ to, play = true, duration = 1200 }) {
  const [value, setValue] = useState(play ? 0 : to);
  useEffect(() => {
    if (!play) {
      setValue(to);
      return;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * to));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  return <>{value}</>;
}

/* ── Reveal — pure CSS + IntersectionObserver entrance wrapper. No motion
   library dependency: toggles a CSS class (.fm-reveal-in) once the element
   scrolls into view (or immediately on mount if already visible), and the
   actual animation is a plain CSS transition defined in theme.js. Generic,
   reusable anywhere a scroll/mount reveal is wanted without Framer Motion. ── */
export function Reveal({ children, delay = 0, style = {} }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const t = setTimeout(() => setVisible(true), delay);
          io.disconnect();
          return () => clearTimeout(t);
        }
      },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`fm-reveal${visible ? " fm-reveal-in" : ""}`} style={style}>
      {children}
    </div>
  );
}

/* ── Checkbox-style row used for mission/task lists ── */
export function TaskRow({ label, meta, done, onToggle }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 4px",
        borderBottom: `1px solid ${fm.color.border}`,
      }}
    >
      <button
        onClick={onToggle}
        aria-label={done ? "Mark not done" : "Mark done"}
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flexShrink: 0,
          border: `1.5px solid ${done ? fm.color.accent : fm.color.border}`,
          background: done ? fm.color.accent : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L20 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: done ? fm.color.textTertiary : fm.color.textPrimary,
            textDecoration: done ? "line-through" : "none",
          }}
        >
          {label}
        </div>
      </div>
      {meta && <div style={{ fontSize: 11, color: fm.color.textTertiary }}>{meta}</div>}
    </div>
  );
}