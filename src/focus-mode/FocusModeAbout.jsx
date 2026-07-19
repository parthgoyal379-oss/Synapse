import { useMemo } from "react";
import { fm } from "./theme";
import { readSynapseSnapshot, readJournalEntries } from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  JourneyStepper,
  IdentityCard,
  FounderCard,
  CompareTable,
  BulletCard,
  MetricCard,
  NeuronArt,
  VerticalTimeline,
} from "./components";

// Every line below is reused verbatim (or lightly restructured for card
// layout) from App.jsx's real <About/> component and its FAQ content —
// nothing here is invented company copy.

const WHY_IT_EXISTS = [
  "Modern platforms are designed to capture attention and encourage repeated engagement.",
  "Most habits are reinforced by recurring triggers, environments, and routines.",
  "People often rely on motivation alone, even though motivation naturally fluctuates.",
];

const WHY_SOLUTIONS_FAIL = [
  "Blockers remove access but rarely change behavior.",
  "Generic habit trackers provide data without meaningful guidance.",
  "Most solutions stop at tracking progress instead of guiding moments of temptation.",
];

const PHILOSOPHY_STOPS = [
  { icon: "🔄", dayLabel: "STEP 1", title: "Reset", description: "Synapse learns your habits, goals, and the situations that lead to unhealthy decisions." },
  { icon: "🧠", dayLabel: "STEP 2", title: "Rewire", description: "Personalized support and adaptive recommendations when they're needed most." },
  { icon: "👑", dayLabel: "STEP 3", title: "Reconquer", description: "Synapse adapts to your journey, helping you build lasting discipline." },
];

const FOUNDERS = [
  { initials: "PG", name: "Parth Goyal", role: "Co-Founder & CEO", focus: "Engineering, AI Systems, Technical Strategy, Product Development", contribution: "Built the first prototype of Synapse, leads the platform's technical architecture, engineering, and AI development." },
  { initials: "ST", name: "Sandali Tiwari", role: "Co-Founder & COO", focus: "Product Management, Marketing, Operations, Growth", contribution: "Leads product strategy, user research, marketing, branding, partnerships, and company operations to ensure Synapse is built around real user needs." },
];

const VALUES = [
  { icon: "◆", title: "Discipline over motivation", caption: "Sustainable systems outperform temporary inspiration." },
  { icon: "◇", title: "People before metrics", caption: "Every decision begins with understanding the people we serve." },
  { icon: "△", title: "Continuous improvement", caption: "Small, consistent progress creates meaningful change." },
  { icon: "○", title: "Build with purpose", caption: "Technology should empower people, not compete for attention." },
];

const JOURNEY = [
  "Identified the growing need for personalized accountability in behavior change.",
  "Built the first version of Synapse to address addictive habits through AI-powered guidance.",
  "Continuously improving the platform through user feedback and rapid iteration.",
];

const DIFF_ROWS = [
  ["Restricts behavior", "Helps build better behavior"],
  ["Generic advice", "Personalized AI guidance"],
  ["Static habit trackers", "Adaptive accountability"],
  ["Depends on willpower", "Builds sustainable systems"],
  ["Reactive after relapse", "Proactive, real-time interventions"],
  ["One-size-fits-all plans", "Personalized change journeys"],
  ["Tracks what happened", "Helps shape what happens next"],
  ["Data without context", "Insights with actionable guidance"],
];

// Section wrapper — single source of vertical rhythm for this page.
function Section({ children, first = false }) {
  return <div style={{ padding: `clamp(14px,4vw,${first ? 24 : 56}px) clamp(14px,4vw,40px) 0` }}>{children}</div>;
}

function SectionHeading({ eyebrow, title, style = {} }) {
  return (
    <div style={{ marginBottom: 28, ...style }}>
      <Eyebrow style={{ marginBottom: 10 }}>{eyebrow}</Eyebrow>
      {title && <div style={{ fontFamily: fm.font.display, fontSize: 22, fontWeight: 600, color: fm.color.textPrimary, letterSpacing: -0.3 }}>{title}</div>}
    </div>
  );
}

export default function FocusModeAbout({ onNavigate, onOpenProfile, onBeginJourney }) {
  const snapshot = useMemo(() => readSynapseSnapshot(), []);
  const journalEntries = useMemo(() => readJournalEntries(), []);
  const { streak, history, addictions, stats } = snapshot;

  return (
    <FocusModeShell>
      <Sidebar active="about" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 72 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <Section first>
          <Card padding="clamp(20px,6vw,48px)" hover className="fm-fade-up">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
              <div style={{ flex: "1.1 1 280px", minWidth: 0 }}>
                <Eyebrow style={{ marginBottom: 18 }}>✦ Our Mission</Eyebrow>
                <div style={{ fontFamily: fm.font.display, fontSize: 40, fontWeight: 600, color: fm.color.textPrimary, lineHeight: 1.12, marginBottom: 20, letterSpacing: -0.5 }}>
                  Why <span style={{ color: fm.color.accent }}>SYNAPSE</span> exists.
                </div>
                <p style={{ fontSize: 14, color: fm.color.textSecondary, lineHeight: 1.8, marginBottom: 28, maxWidth: 420 }}>
                  Lasting change doesn't come from restricting behavior — it comes from understanding it, and building
                  accountability that evolves with you.
                </p>
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                  <ChipStat icon="✦" label="AI-powered" />
                  <ChipStat icon="◆" label="Personalized" />
                  <ChipStat icon="🔒" label="Data never sold" />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center", flex: "1 1 220px", minWidth: 0 }}>
                <NeuronArt size={280} color={fm.color.accent} />
              </div>
            </div>
          </Card>
        </Section>

        {/* ── The problem ────────────────────────────────────────── */}
        <Section>
          <SectionHeading eyebrow="The Problem" title="Habits are built quietly." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px,100%), 1fr))", gap: 20 }}>
            <div className="fm-fade-up" style={{ animationDelay: "0.05s" }}>
              <BulletCard title="Why It Exists" points={WHY_IT_EXISTS} />
            </div>
            <div className="fm-fade-up" style={{ animationDelay: "0.12s" }}>
              <BulletCard title="Why Solutions Fail" points={WHY_SOLUTIONS_FAIL} />
            </div>
          </div>
        </Section>

        {/* ── Philosophy: Reset → Rewire → Reconquer ─────────────── */}
        <Section>
          <SectionHeading eyebrow="The SYNAPSE Philosophy" />
          <Card padding="clamp(18px,5vw,36px)" hover>
            <JourneyStepper stops={PHILOSOPHY_STOPS} currentIndex={2} />
          </Card>
        </Section>

        {/* ── Founders ──────────────────────────────────────────── */}
        <Section>
          <SectionHeading eyebrow="Meet the Founders" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px,100%), 1fr))", gap: 20 }}>
            {FOUNDERS.map((f, i) => (
              <div key={f.initials} className="fm-fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
                <FounderCard {...f} />
              </div>
            ))}
          </div>
        </Section>

        {/* ── Journey ──────────────────────────────────────────── */}
        <Section>
          <SectionHeading eyebrow="The Journey" title="Where we've been." />
          <Card padding="clamp(18px,5vw,36px)" hover>
            <VerticalTimeline items={JOURNEY} color={fm.color.accent} />
          </Card>
        </Section>

        {/* ── Core values ─────────────────────────────────────────── */}
        <Section>
          <SectionHeading eyebrow="Our Values" />
          <div data-fm-grid="4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {VALUES.map((v, i) => (
              <div key={v.title} className="fm-fade-up" style={{ animationDelay: `${i * 0.06}s` }}>
                <IdentityCard icon={v.icon} title={v.title} caption={v.caption} />
              </div>
            ))}
          </div>
        </Section>

        {/* ── Your Synapse impact (real per-user data) ──────────── */}
        <Section>
          <SectionHeading eyebrow="Your SYNAPSE Impact" />
          <div data-fm-grid="5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
            <MetricCard icon="🔥" value={streak} label="Day Streak" tint={fm.color.accent} tintSoft={fm.color.accentSoft} />
            <MetricCard icon="🛡️" value={stats.urgesManaged} label="Urges Resisted" tint={fm.color.success} tintSoft={fm.color.successSoft} />
            <MetricCard icon="📖" value={journalEntries.length} label="Journal Entries" tint={fm.color.info} tintSoft={fm.color.infoSoft} />
            <MetricCard icon="🎯" value={addictions.length} label="Active Missions" tint={fm.color.warning} tintSoft={fm.color.warningSoft} />
            <MetricCard icon="✅" value={history.length} label="Total Check-Ins" tint={fm.color.textPrimary} tintSoft={fm.color.surfaceSunken} />
          </div>
        </Section>

        {/* ── Privacy ─────────────────────────────────────────────── */}
        <Section>
          <Card padding="clamp(18px,5vw,30px)" hover style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
            <span style={{ fontSize: 28, flexShrink: 0 }}>🔒</span>
            <div>
              <Eyebrow style={{ marginBottom: 8 }}>Your Privacy, Our Promise</Eyebrow>
              <p style={{ fontSize: 13, color: fm.color.textSecondary, lineHeight: 1.7, margin: 0 }}>
                Your recovery data is securely stored and used only to personalize your experience — never shared or sold.
              </p>
            </div>
          </Card>
        </Section>

        {/* ── Traditional vs SYNAPSE ─────────────────────────────── */}
        <Section>
          <SectionHeading eyebrow="The Difference" title="Traditional vs SYNAPSE" />
          <CompareTable leftLabel="Traditional Solutions" rightLabel="SYNAPSE" rows={DIFF_ROWS} />
        </Section>

        {/* ── Bottom CTA ─────────────────────────────────────────── */}
        <Section>
          <Card padding="clamp(24px,7vw,56px)" hover style={{ textAlign: "center", background: fm.color.surfaceMuted }}>
            <p style={{ fontSize: 14.5, color: fm.color.textSecondary, lineHeight: 1.75, maxWidth: 460, margin: "0 auto 22px" }}>
              Every habit begins with a choice. Every meaningful change begins with the next one.
            </p>
            <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 28, letterSpacing: -0.5 }}>
              Reset. Rewire. Reconquer.
            </div>
            <Button variant="primary" size="lg" onClick={() => onBeginJourney?.() ?? onNavigate?.("home")} style={{ background: fm.color.accent }}>
              Continue Your Recovery →
            </Button>
          </Card>
        </Section>
      </main>
    </FocusModeShell>
  );
}

function ChipStat({ icon, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: fm.color.accent }}>{icon}</span>
      <span style={{ fontSize: 12, color: fm.color.textSecondary, fontWeight: 500 }}>{label}</span>
    </div>
  );
}