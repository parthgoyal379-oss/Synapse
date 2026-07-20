import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Send, Paperclip, Mic, Target, TrendingUp, NotebookPen, ChevronRight } from "lucide-react";
import { fm, useResponsive } from "./theme";
import { readSynapseSnapshot, urgeResistancePct } from "./synapseData";
import {
  FocusModeShell,
  Sidebar,
  TopBar,
  Card,
  Eyebrow,
  Button,
  VerdictBadge,
  RecoveryPhaseCard,
  ToneCard,
  MarkdownMessage,
  AmbientBackground,
  EASE,
  GLASS_CARD,
  HOVER_LIFT,
  CountUp,
} from "./components";

/**
 * FocusModeCoach — presentation only. See original integration notes at
 * the bottom of this file for the exact prop contract (unchanged).
 */
export default function FocusModeCoach({
  messages = [],
  loading = false,
  mode,
  tones,
  onModeChange,
  onSend,
  streak,
  savedPlan,
  sessions,
  renderMessage,
  onNavigate,
  onOpenProfile,
}) {
  const { isMobile } = useResponsive();
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const bottomRef = useRef(null);
  const isFirstRender = useRef(true);

  const snapshot = readSynapseSnapshot();
  const { level, nextLevel, xpPct, daysToNext, addictions, urgeLog, todayEntry, checkedInToday } = snapshot;
  const pColor = fm.color.accent;
  const urgePct = urgeResistancePct(urgeLog);
  const effectiveStreak = streak ?? snapshot.streak;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading || !onSend) return;
    setInput("");
    onSend(text);
  };

  const toneList = Array.isArray(tones) ? tones : tones ? Object.values(tones) : [];
  const activeToneId = mode?.id;
  const coachStatus = loading ? "THINKING" : "ONLINE";

  const cardVariant = (delay) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  });

  return (
    <FocusModeShell>
      <AmbientBackground color={pColor} />
      <Sidebar active="chat" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 40, position: "relative", zIndex: 1 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, ease: EASE }} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,44px) 0" }}>
          <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary }}>AI Coach</div>
          <div style={{ fontSize: 12.5, color: fm.color.textSecondary, marginTop: 4 }}>Personalized guidance based on today's recovery.</div>
          <div style={{ width: 40, height: 2, background: fm.color.accent, borderRadius: 2, marginTop: 12 }} />
        </motion.div>

        {/* Coach Identity — hero card */}
        <motion.div {...cardVariant(0.05)} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0" }}>
          <Card padding={26} style={GLASS_CARD}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18 }}>
              <div style={{ position: "relative", width: 58, height: 58, flexShrink: 0 }}>
                <div style={{ position: "absolute", inset: -10, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.accent}28, transparent 70%)` }} />
                <div style={{ position: "relative", width: 58, height: 58, borderRadius: "50%", background: fm.color.textPrimary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Brain size={24} color="#fff" strokeWidth={1.8} />
                </div>
              </div>
              <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                <div style={{ fontFamily: fm.font.display, fontSize: 19, fontWeight: 700, color: fm.color.textPrimary }}>{mode?.label || "Coach"}</div>
                <div style={{ fontSize: 11.5, color: fm.color.textSecondary, marginTop: 2 }}>
                  {level.title.charAt(0) + level.title.slice(1).toLowerCase()} · Phase {level.level}
                  {mode?.desc ? ` · ${mode.desc}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? fm.color.warning : fm.color.success }}
                />
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: loading ? fm.color.warning : fm.color.success }}>{coachStatus}</span>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Tone selector */}
        {toneList.length > 0 && (
          <motion.div {...cardVariant(0.1)} style={{ padding: "clamp(14px,4vw,18px) clamp(14px,4vw,44px) 0", display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${toneList.length},1fr)`, gap: 14 }}>
            {toneList.map((t) => (
              <ToneCard
                key={t.id}
                icon={t.icon || "🧭"}
                title={t.label}
                subtitle={t.desc}
                description={TONE_DESCRIPTIONS[t.id] || t.desc}
                selected={t.id === activeToneId}
                onSelect={() => onModeChange?.(t)}
                tint={t.accent || fm.color.accent}
                tintSoft={`${t.accent || fm.color.accent}1f`}
              />
            ))}
          </motion.div>
        )}

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          {/* Chat container */}
          <motion.div {...cardVariant(0.16)} style={{ flex: "1.7 1 320px", minWidth: 0, width: "100%" }}>
            <Card padding={0} style={{ ...GLASS_CARD, display: "flex", flexDirection: "column", height: 620, overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "26px clamp(14px,4vw,28px)" }}>
                {messages.length === 0 ? (
                  <EmptyChatState streak={effectiveStreak} />
                ) : (
                  <>
                    <AnimatePresence initial={false}>
                      {messages.map((m, i) => (
                        <MessageBubble key={i} role={m.role} text={m.text} crisis={m.crisis} offTopic={m.offTopic} renderMessage={renderMessage} delay={i === messages.length - 1 ? 0 : 0} />
                      ))}
                    </AnimatePresence>
                    {loading && <ThinkingIndicator />}
                  </>
                )}
                <div ref={bottomRef} />
              </div>

              <div style={{ padding: "16px 24px 22px", borderTop: `1px solid ${fm.color.border}` }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: fm.color.surface,
                    borderRadius: fm.radius.pill,
                    padding: "8px 8px 8px 18px",
                    boxShadow: focused ? `0 0 0 3px ${fm.color.accentSoft}, 0 4px 16px -4px ${fm.color.accent}40` : fm.shadow.card,
                    border: `1px solid ${focused ? fm.color.accentSoftBorder : fm.color.border}`,
                    transition: "box-shadow .25s ease, border-color .25s ease",
                  }}
                >
                  <Paperclip size={15} color={fm.color.textTertiary} />
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask your coach anything…"
                    rows={1}
                    disabled={loading}
                    style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", fontSize: 13, fontFamily: fm.font.body, color: fm.color.textPrimary, maxHeight: 100, padding: "6px 0" }}
                  />
                  <Mic size={15} color={fm.color.textTertiary} />
                  <motion.button
                    onClick={handleSend}
                    disabled={!input.trim() || loading}
                    whileHover={input.trim() && !loading ? { y: -2, boxShadow: `0 6px 18px -4px ${fm.color.accent}70` } : {}}
                    transition={{ duration: 0.2, ease: EASE }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      border: "none",
                      background: input.trim() && !loading ? fm.color.accent : fm.color.surfaceSunken,
                      color: input.trim() && !loading ? "#fff" : fm.color.textTertiary,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Send size={14} strokeWidth={2.3} />
                  </motion.button>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Right rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 260px", minWidth: 0 }}>
            <motion.div {...cardVariant(0.1)} {...HOVER_LIFT}>
              <RecoveryPhaseCard level={level} nextLevel={nextLevel} streak={effectiveStreak} xpPct={xpPct} daysToNext={daysToNext} color={pColor} compact animateOnMount />
            </motion.div>

            <motion.div {...cardVariant(0.18)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Today's Verdict</Eyebrow>
                {checkedInToday && todayEntry ? (
                  <VerdictBadge verdict={(todayEntry.status || "mid").toUpperCase()} />
                ) : (
                  <span style={{ fontSize: 11.5, color: fm.color.textTertiary }}>Not checked in yet today.</span>
                )}
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.24)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Urge Resistance</Eyebrow>
                <div style={{ fontFamily: fm.font.display, fontSize: 26, fontWeight: 700, color: fm.color.textPrimary }}><CountUp to={urgePct} />%</div>
                <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 2 }}>{urgeLog.length} urges logged</div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.3)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Today's Focus</Eyebrow>
                {addictions.length === 0 ? (
                  <span style={{ fontSize: 11.5, color: fm.color.textTertiary }}>No missions set up yet.</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {addictions.slice(0, 4).map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <span>{a.emoji}</span>
                        <span style={{ color: fm.color.textPrimary }}>{a.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.36)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Recent Sessions</Eyebrow>
                {sessions && sessions.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {sessions.map((s, i) => (
                      <button key={i} onClick={() => s.onOpen?.()} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", width: "100%", textAlign: "left" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: fm.color.textPrimary }}>{s.label}</span>
                        <span style={{ fontSize: 10, color: fm.color.textTertiary }}>{s.meta}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 11.5, color: fm.color.textTertiary }}>No past sessions tracked yet.</span>
                )}
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.42)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <QuickAction icon={Target} label="Battle Plan" onClick={() => onNavigate?.("plan")} />
              <QuickAction icon={TrendingUp} label="Progress" onClick={() => onNavigate?.("progress")} />
              <QuickAction icon={NotebookPen} label="Journal" onClick={() => onNavigate?.("journal")} />
            </motion.div>
          </div>
        </div>
      </main>
    </FocusModeShell>
  );
}

const TONE_DESCRIPTIONS = {
  operator: "Calm accountability and practical guidance for difficult moments.",
  commander: "Firm direction with tactical advice and disciplined coaching.",
  warlord: "No excuses. Direct truth. Maximum accountability.",
};

function MessageBubble({ role, text, crisis, offTopic, renderMessage }) {
  const isUser = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, x: isUser ? 24 : -24, y: 8 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 18, gap: 10 }}
    >
      {!isUser && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          style={{ width: 30, height: 30, borderRadius: "50%", background: crisis ? fm.color.infoSoft : fm.color.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          <Brain size={13} color={crisis ? fm.color.info : "#fff"} strokeWidth={1.8} />
        </motion.div>
      )}
      <div
        style={{
          maxWidth: "72%",
          padding: "13px 16px",
          borderRadius: isUser ? `${fm.radius.md}px ${fm.radius.md}px 4px ${fm.radius.md}px` : `${fm.radius.md}px ${fm.radius.md}px ${fm.radius.md}px 4px`,
          background: isUser ? fm.color.accentSoft : crisis ? fm.color.infoSoft : fm.color.surfaceMuted,
          border: `1px solid ${isUser ? fm.color.accentSoftBorder : offTopic ? fm.color.dangerBorder : fm.color.border}`,
          boxShadow: "0 2px 8px -4px rgba(42,32,20,0.08)",
        }}
      >
        {renderMessage ? renderMessage(text) : <MarkdownMessage text={text} tone={isUser ? fm.color.accentDeep : fm.color.textPrimary} />}
      </div>
    </motion.div>
  );
}

function ThinkingIndicator() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
      <motion.div
        animate={{ boxShadow: [`0 0 0 0px ${fm.color.accent}22`, `0 0 0 6px ${fm.color.accent}00`] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: 30, height: 30, borderRadius: "50%", background: fm.color.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <Brain size={13} color="#fff" strokeWidth={1.8} />
      </motion.div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: fm.radius.md, background: fm.color.surfaceMuted, border: `1px solid ${fm.color.border}` }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <motion.span key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }} style={{ width: 5, height: 5, borderRadius: "50%", background: fm.color.textTertiary }} />
          ))}
        </div>
        <span style={{ fontSize: 11, color: fm.color.textTertiary, fontStyle: "italic" }}>Analyzing your progress…</span>
      </div>
    </motion.div>
  );
}

function EmptyChatState({ streak }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }} style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        style={{ position: "relative", width: 72, height: 72, marginBottom: 20 }}
      >
        <div style={{ position: "absolute", inset: -16, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.accent}25, transparent 70%)` }} />
        <div style={{ position: "relative", width: 72, height: 72, borderRadius: "50%", background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Brain size={28} color={fm.color.accentDeep} strokeWidth={1.6} />
        </div>
      </motion.div>
      <div style={{ fontFamily: fm.font.display, fontSize: 18, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 8 }}>Day {streak} — I'm here.</div>
      <p style={{ fontSize: 12.5, color: fm.color.textSecondary, maxWidth: 320, lineHeight: 1.7 }}>Ask about your recovery, an urge you're fighting, or what's next in the plan.</p>
    </motion.div>
  );
}

function QuickAction({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -4, boxShadow: fm.shadow.cardHover }}
      transition={{ duration: 0.2, ease: EASE }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 6px", borderRadius: fm.radius.md, background: fm.color.surface, border: `1px solid ${fm.color.border}`, boxShadow: fm.shadow.card }}
    >
      <motion.span whileHover={{ scale: 1.08 }}>
        <Icon size={15} color={fm.color.accent} strokeWidth={2} />
      </motion.span>
      <span style={{ fontSize: 10, fontWeight: 600, color: fm.color.textPrimary }}>{label}</span>
    </motion.button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   INTEGRATION NOTES — unchanged from before, same prop contract:

     <FocusModeCoach
       messages={msgs} loading={loading} mode={mode} tones={MODES}
       onModeChange={switchMode}
       onSend={(text) => { setInput(text); send(); }}
       streak={streak} savedPlan={savedPlan}
       onNavigate={goTo} onOpenProfile={...}
       renderMessage={(text) => parseBold(text)}
     />
──────────────────────────────────────────────────────────────────────── */