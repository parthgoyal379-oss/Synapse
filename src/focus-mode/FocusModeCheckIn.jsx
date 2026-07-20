import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Target, Activity, CloudRain, Flag, BadgeCheck, Hourglass, Loader2, Check, Users, Smartphone, MessageCircleX, Moon, TrendingDown, Repeat2, Frown as FrownIcon, HelpCircle, Sunrise, Sun, Sunset, MoonStar } from "lucide-react";
import { fm, useResponsive } from "./theme";
import { readSynapseSnapshot, MOODS, TRIGGERS, TIME_SLOTS, getCheckinCountdownLabel, computeVerdict } from "./synapseData";
import { FocusModeShell, Sidebar, TopBar, Card, Eyebrow, Button, VerdictBadge, WeeklyTrendChart, RecoveryPhaseCard, AmbientBackground, EASE, GLASS_CARD, HOVER_LIFT, CountUp } from "./components";

const MOOD_ICONS = { strong: ShieldCheck, held: Target, struggled: Activity, rough: CloudRain };
const MOOD_TINTS = {
  strong: { tint: fm.color.success, soft: fm.color.successSoft },
  held: { tint: fm.color.accent, soft: fm.color.accentSoft },
  struggled: { tint: fm.color.warning, soft: fm.color.warningSoft },
  rough: { tint: fm.color.info, soft: fm.color.infoSoft }, // calm blue, not alarming red
};
const TRIGGER_ICONS = {
  bored: HelpCircle, stressed: Activity, lonely: Users, alone_room: MoonStar, phone_bed: Smartphone,
  after_argument: MessageCircleX, tired: Moon, social_media: Smartphone, friends_around: Users,
  failure: TrendingDown, free_time: Hourglass, habit_cue: Repeat2,
};
const TIME_ICONS = { morning: Sunrise, afternoon: Sun, evening: Sunset, late_night: MoonStar };

export default function FocusModeCheckIn({
  streak,
  savedPlan,
  lastCheckin,
  onCheckin,
  onGoChat,
  onSendChat,
  onDownloadPlan,
  onShare,
  onNavigate,
  onOpenProfile,
}) {
  const snapshot = useMemo(() => readSynapseSnapshot(), []);
  const { isMobile } = useResponsive();
  const { addictions, level, nextLevel, xpPct, daysToNext, quote, weekly, history } = snapshot;
  const pColor = fm.color.accent;

  const [adStatus, setAdStatus] = useState(() => Object.fromEntries(addictions.map((a) => [a.id, "clean"])));
  const [adUsage, setAdUsage] = useState(() => Object.fromEntries(addictions.map((a) => [a.id, 0])));
  const [adTriggers, setAdTriggers] = useState(() => Object.fromEntries(addictions.map((a) => [a.id, []])));
  const [adTimeOfDay, setAdTimeOfDay] = useState(() => Object.fromEntries(addictions.map((a) => [a.id, []])));
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState("");

  const [reply, setReply] = useState(() => {
    const today = new Date().toDateString();
    if (lastCheckin !== today) return "";
    const e = history.find((h) => h.date === today);
    return e?.reply || (e ? "Logged. (Coach response wasn't saved for this check-in.)" : "");
  });
  const [status, setStatus] = useState(() => {
    const today = new Date().toDateString();
    if (lastCheckin !== today) return null;
    const e = history.find((h) => h.date === today);
    return e ? e.status.toUpperCase() : null;
  });
  const [loading, setLoading] = useState(false);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const [countdown, setCountdown] = useState(getCheckinCountdownLabel());
  const [pulse, setPulse] = useState(false);

  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  const today = new Date().toDateString();
  const done = lastCheckin === today;

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(getCheckinCountdownLabel());
      setPulse(true);
      setTimeout(() => setPulse(false), 400);
    }, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatLoading]);

  const toggleTrigger = (id, t) =>
    setAdTriggers((p) => ({ ...p, [id]: p[id].includes(t) ? p[id].filter((x) => x !== t) : [...p[id], t] }));
  const toggleTimeOfDay = (id, t) =>
    setAdTimeOfDay((p) => ({ ...p, [id]: p[id].includes(t) ? p[id].filter((x) => x !== t) : [...p[id], t] }));

  const buildReport = () => {
    const adLines = addictions
      .map((a) => {
        const s = adStatus[a.id];
        const goal = a.isFreq ? `Goal: 0x/week` : `Goal: 0h/day`;
        const baseline = a.isFreq ? `Baseline: ${a.value}x/week` : `Baseline: ${a.value}h/day`;
        if (s === "clean") return `${a.emoji} ${a.label}: CLEAN ✓ (${goal}, ${baseline})`;
        const usage = adUsage[a.id];
        const usageStr = a.isFreq ? `${usage}x today` : `${usage}h today`;
        const triggerIds = adTriggers[a.id] || [];
        const triggerStr = triggerIds.length ? ` | Triggers: ${triggerIds.map((t) => TRIGGERS.find((tr) => tr.id === t)?.label.replace(/^\S+\s/, "") || t).join(", ")}` : "";
        const timeIds = adTimeOfDay[a.id] || [];
        const timeStr = timeIds.length ? ` | When: ${timeIds.map((id) => TIME_SLOTS.find((t) => t.id === id)?.label.replace(/^\S+\s/, "") || id).join(", ")}` : "";
        return `${a.emoji} ${a.label}: ${s === "partial" ? "PARTIAL ~" : "SLIPPED ✗"} (${usageStr}, ${goal}, ${baseline}${triggerStr}${timeStr})`;
      })
      .join("\n");
    const moodLine = mood ? `\nOverall mood: ${MOODS.find((m) => m.id === mood)?.label || mood}` : "";
    const notesLine = notes.trim() ? `\nAdditional notes: ${notes.trim()}` : "";
    return `Day ${streak + 1} structured check-in:\n\n${adLines}${moodLine}${notesLine}`;
  };

  const logTriggerData = () => {
    try {
      const log = JSON.parse(localStorage.getItem("syn_trigger_log") || "[]");
      log.push({
        date: new Date().toDateString(),
        mood,
        addictions: addictions.filter((a) => adStatus[a.id] !== "clean").map((a) => ({ id: a.id, label: a.label, status: adStatus[a.id], usage: adUsage[a.id], triggers: adTriggers[a.id] || [], timeOfDay: adTimeOfDay[a.id] })),
      });
      localStorage.setItem("syn_trigger_log", JSON.stringify(log.slice(-90)));
    } catch {}
  };

  const liveVerdict = addictions.length > 0 ? computeVerdict(addictions, adStatus) : null;
  const VERDICT_TINT = { WIN: fm.color.success, MID: fm.color.warning, SLIP: fm.color.danger };
  const canSubmit = mood && !done && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const report = buildReport();
    const computedStatus = computeVerdict(addictions, adStatus);
    logTriggerData();
    const result = await onCheckin(report, computedStatus);
    setLoading(false);
    setJustSucceeded(true);
    setTimeout(() => {
      setReply(result.reply);
      setStatus(result.status);
    }, 700); // let the success glow read before the AI section mounts
  };

  const sendChat = async () => {
    const txt = chatInput.trim();
    if (!txt || chatLoading || !onSendChat) return;
    setChatInput("");
    setChatMsgs((m) => [...m, { role: "user", text: txt }]);
    setChatLoading(true);
    try {
      const r = await onSendChat(txt);
      setChatMsgs((m) => [...m, { role: "ai", text: r.text, crisis: r.crisis }]);
    } catch {
      setChatMsgs((m) => [...m, { role: "ai", text: "Connection issue — try again." }]);
    }
    setChatLoading(false);
  };

  const cardVariant = (delay) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  });

  return (
    <FocusModeShell>
      <AmbientBackground color={pColor} />
      <Sidebar active="checkin" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60, position: "relative", zIndex: 1 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <div style={{ padding: "clamp(14px,4vw,26px) clamp(14px,4vw,48px) 0" }}>
          <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 6 }}>Check-In</div>
          <div style={{ fontFamily: fm.font.display, fontSize: 15, color: fm.color.textSecondary, fontStyle: "italic", marginBottom: 2 }}>How was your day?</div>
          <div style={{ fontSize: 12, color: fm.color.textTertiary }}>Your honesty builds your transformation.</div>
        </div>

        <div style={{ padding: "clamp(14px,4vw,22px) clamp(14px,4vw,48px) 0", display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: 22, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22, flex: isMobile ? "1 1 auto" : "1.4 1 320px", minWidth: 0, width: isMobile ? "100%" : "auto" }}>
            {!done ? (
              <>
                <motion.div {...cardVariant(0)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderRadius: fm.radius.sm, background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}` }}>
                    <Hourglass size={15} color={fm.color.accent} />
                    <motion.strong animate={{ scale: pulse ? 1.06 : 1 }} transition={{ duration: 0.35, ease: EASE }} style={{ color: fm.color.accent }}>
                      {countdown}
                    </motion.strong>
                    <span style={{ fontSize: 12.5, color: fm.color.textSecondary }}>left to check in {streak > 0 ? "and keep your streak alive" : "and start your streak"}</span>
                  </div>
                </motion.div>

                <motion.div {...cardVariant(0.06)}>
                  <Card padding={26} style={GLASS_CARD}>
                    <Eyebrow style={{ marginBottom: 4 }}>How do you feel right now?</Eyebrow>
                    <div style={{ fontSize: 11.5, color: fm.color.textTertiary, marginBottom: 16 }}>Be honest with yourself. There's no right or wrong.</div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 10 }}>
                      {MOODS.map((m, i) => {
                        const Icon = MOOD_ICONS[m.id];
                        const t = MOOD_TINTS[m.id];
                        const selected = mood === m.id;
                        return (
                          <motion.button
                            key={m.id}
                            onClick={() => setMood(m.id)}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: EASE, delay: 0.1 + i * 0.05 }}
                            whileHover={{ y: -5, scale: 1.02, transition: { duration: 0.2, ease: EASE } }}
                            style={{
                              padding: "16px 16px",
                              borderRadius: fm.radius.md,
                              border: `1.5px solid ${selected ? t.tint : fm.color.border}`,
                              background: selected ? t.soft : fm.color.surfaceMuted,
                              textAlign: "left",
                              boxShadow: selected ? `0 0 0 3px ${t.tint}22, 0 12px 28px -8px ${t.tint}40` : "none",
                            }}
                          >
                            <div style={{ width: 34, height: 34, borderRadius: "50%", background: selected ? "#fff" : t.soft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                              <Icon size={17} strokeWidth={2.1} color={t.tint} />
                            </div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: fm.color.textPrimary, marginBottom: 2 }}>{m.label.replace(/^\S+\s/, "")}</div>
                            <div style={{ fontSize: 10.5, color: fm.color.textSecondary, lineHeight: 1.4 }}>{m.desc}</div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </Card>
                </motion.div>

                {addictions.length > 0 && (
                  <motion.div {...cardVariant(0.12)}>
                    <Card padding={26} style={GLASS_CARD}>
                      <Eyebrow style={{ marginBottom: 16 }}>
                        <Flag size={12} style={{ marginRight: 6, verticalAlign: -2 }} /> Your Missions — How did today go?
                      </Eyebrow>
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {addictions.map((a) => {
                          const s = adStatus[a.id];
                          const goalStr = a.isFreq ? `Goal: 0x/week · Baseline: ${a.value}x/week` : `Goal: 0h/day · Baseline: ${a.value}h/day`;
                          const maxVal = a.isFreq ? Math.max(a.value * 2, 10) : Math.max(a.value * 2, 12);
                          return (
                            <MissionRow
                              key={a.id}
                              a={a}
                              s={s}
                              goalStr={goalStr}
                              maxVal={maxVal}
                              usage={adUsage[a.id]}
                              onUsage={(v) => setAdUsage((p) => ({ ...p, [a.id]: v }))}
                              onStatus={(v) => setAdStatus((p) => ({ ...p, [a.id]: v }))}
                              timeOfDay={adTimeOfDay[a.id] || []}
                              onToggleTime={(t) => toggleTimeOfDay(a.id, t)}
                              triggers={adTriggers[a.id] || []}
                              onToggleTrigger={(t) => toggleTrigger(a.id, t)}
                            />
                          );
                        })}
                      </div>

                      <AnimatePresence>
                        {liveVerdict && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginTop: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: fm.radius.sm, background: `${VERDICT_TINT[liveVerdict]}14`, border: `1px solid ${VERDICT_TINT[liveVerdict]}40`, fontSize: 11.5, color: VERDICT_TINT[liveVerdict], fontWeight: 600 }}>
                              {liveVerdict === "WIN" ? <BadgeCheck size={14} /> : liveVerdict === "MID" ? <Activity size={14} /> : <TrendingDown size={14} />}
                              Today's verdict: {liveVerdict} — based on your answers above
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Card>
                  </motion.div>
                )}

                <motion.div {...cardVariant(0.18)}>
                  <Card padding={26} style={GLASS_CARD}>
                    <Eyebrow style={{ marginBottom: 12 }}>
                      Additional Notes <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
                    </Eyebrow>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="What made today hard? What helped? Anything SYNAPSE should know..."
                      rows={3}
                      maxLength={500}
                      style={{ width: "100%", background: fm.color.surfaceMuted, border: `1px solid ${fm.color.border}`, borderRadius: fm.radius.sm, color: fm.color.textPrimary, fontFamily: fm.font.body, fontSize: 13, padding: "12px 14px", outline: "none", resize: "none", lineHeight: 1.7 }}
                    />
                    <div style={{ textAlign: "right", fontSize: 10, color: fm.color.textTertiary, marginTop: 4 }}>{notes.length} / 500</div>
                  </Card>
                </motion.div>

                <motion.div {...cardVariant(0.22)}>
                  <SubmitButton canSubmit={canSubmit} loading={loading} justSucceeded={justSucceeded} onClick={submit} hasMood={!!mood} />
                </motion.div>
              </>
            ) : (
              <>
                {status && <VerdictBadge verdict={status === "CRISIS" ? "MID" : status} />}
                <AnimatePresence>
                  {reply ? (
                    <motion.div key="reply" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
                      <Card padding={28} style={GLASS_CARD}>
                        <Eyebrow style={{ marginBottom: 12 }}>Synapse — Coach Response</Eyebrow>
                        <p style={{ fontSize: 13.5, lineHeight: 1.9, color: fm.color.textPrimary, whiteSpace: "pre-wrap" }}>{reply}</p>
                      </Card>
                    </motion.div>
                  ) : (
                    <ReplySkeleton />
                  )}
                </AnimatePresence>

                {reply && status !== "CRISIS" && onSendChat && (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.15 }}>
                    <Card padding={22} style={GLASS_CARD}>
                      <Eyebrow style={{ marginBottom: 14 }}>Continue With Coach</Eyebrow>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                        {chatMsgs.map((m, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                            <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: fm.radius.md, background: m.role === "user" ? fm.color.accentSoft : fm.color.surfaceMuted, color: m.role === "user" ? fm.color.accentDeep : fm.color.textPrimary, fontSize: 12.5, lineHeight: 1.7 }}>
                              {m.text}
                            </div>
                          </div>
                        ))}
                        {chatLoading && <div style={{ fontSize: 11, color: fm.color.textTertiary }}>Coach is typing…</div>}
                        <div ref={chatBottomRef} />
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="Ask your coach anything…" style={{ flex: 1, background: fm.color.surfaceMuted, border: `1px solid ${fm.color.border}`, borderRadius: fm.radius.sm, padding: "10px 14px", fontSize: 12.5, outline: "none", color: fm.color.textPrimary }} />
                        <Button variant="primary" onClick={sendChat} disabled={!chatInput.trim() || chatLoading}>Send</Button>
                      </div>
                    </Card>
                  </motion.div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                  <Button variant="accentGhost" onClick={() => onGoChat?.()} style={{ flex: 1, justifyContent: "center" }}>Open Full Coach</Button>
                  {onShare && <Button variant="ghost" onClick={onShare} style={{ flex: 1, justifyContent: "center" }}>Share Day {streak}</Button>}
                </div>
              </>
            )}
          </div>

          {/* Right rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: isMobile ? "1 1 auto" : "1 1 260px", minWidth: 0, width: isMobile ? "100%" : "auto" }}>
            <motion.div {...cardVariant(0.02)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Today's Progress</Eyebrow>
                <WeeklyTrendChart points={weekly.length > 0 ? weekly.map((h) => h.streak ?? 0) : [0]} width={220} height={70} color={pColor} area grid labels={weekly.length > 0 ? weekly.map((h) => new Date(h.date).toLocaleDateString("en-IN", { weekday: "narrow" })) : undefined} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${fm.color.border}` }}>
                  <div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary }}>Check-In Streak</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: fm.color.textPrimary, fontFamily: fm.font.display }}><CountUp to={streak} /> days</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: fm.color.textTertiary }}>Longest Streak</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: fm.color.textPrimary, fontFamily: fm.font.display }}><CountUp to={Math.max(streak, ...history.map((h) => h.streak || 0))} /> days</div>
                  </div>
                </div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.06)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 8 }}>Your Streak</Eyebrow>
                <div style={{ fontFamily: fm.font.display, fontSize: 34, fontWeight: 700, color: fm.color.textPrimary }}>
                  <CountUp to={streak} /> <span style={{ fontSize: 13, fontWeight: 400, color: fm.color.textTertiary }}>days</span>
                </div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.1)} {...HOVER_LIFT}>
              <RecoveryPhaseCard level={level} nextLevel={nextLevel} streak={streak} xpPct={xpPct} daysToNext={daysToNext} color={pColor} compact animateOnMount />
            </motion.div>

            <motion.div {...cardVariant(0.14)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 10 }}>Today's Signal</Eyebrow>
                <p style={{ fontFamily: fm.font.display, fontSize: 13, fontStyle: "italic", color: fm.color.textPrimary, lineHeight: 1.6, marginBottom: 6 }}>"{quote.q}"</p>
                <div style={{ fontSize: 10, color: fm.color.textTertiary }}>— {quote.a}</div>
              </Card>
            </motion.div>

            <motion.div {...cardVariant(0.18)} {...HOVER_LIFT}>
              <Card padding={20} style={GLASS_CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Eyebrow>Recent Check-Ins</Eyebrow>
                  <button onClick={() => onNavigate?.("report")} style={{ background: "none", border: "none", fontSize: 10.5, color: fm.color.accent, fontWeight: 600 }}>View All Logs →</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {history.slice(0, 4).map((h, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, color: fm.color.textSecondary }}>{new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                      <VerdictBadge verdict={(h.status || "mid").toUpperCase()} />
                    </div>
                  ))}
                  {history.length === 0 && <div style={{ fontSize: 11.5, color: fm.color.textTertiary }}>No check-ins yet.</div>}
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </main>
    </FocusModeShell>
  );
}

function MissionRow({ a, s, goalStr, maxVal, usage, onUsage, onStatus, timeOfDay, onToggleTime, triggers, onToggleTrigger }) {
  const [hover, setHover] = useState(false);
  const statusColor = s === "clean" ? fm.color.success : s === "partial" ? fm.color.warning : fm.color.danger;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "16px 18px",
        borderRadius: fm.radius.md,
        border: `1px solid ${statusColor}30`,
        borderLeft: `3px solid ${hover ? statusColor : "transparent"}`,
        background: hover ? `${statusColor}08` : fm.color.surfaceMuted,
        transition: "background .2s ease, border-color .2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>{a.emoji}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: fm.color.textPrimary }}>{a.label}</div>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginTop: 1 }}>{goalStr}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, borderRadius: fm.radius.pill, background: fm.color.surfaceSunken, padding: 3 }}>
          {[["clean", "Clean", fm.color.success], ["partial", "Partial", fm.color.warning], ["slip", "Slipped", fm.color.danger]].map(([id, label, color]) => (
            <motion.button
              key={id}
              onClick={() => onStatus(id)}
              whileTap={{ scale: 0.97 }}
              animate={{ backgroundColor: s === id ? color : "rgba(0,0,0,0)", color: s === id ? "#fff" : fm.color.textTertiary, boxShadow: s === id ? `0 4px 12px -2px ${color}66` : "none" }}
              transition={{ duration: 0.2, ease: EASE }}
              style={{ padding: "6px 12px", borderRadius: fm.radius.pill, border: "none", fontSize: 10.5, fontWeight: 700 }}
            >
              {label}
            </motion.button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {(s === "partial" || s === "slip") && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", background: fm.color.surface, borderRadius: fm.radius.sm, border: `1px solid ${fm.color.border}`, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, color: fm.color.textSecondary }}>How much today?</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: fm.color.accent }}>{usage}{a.isFreq ? "x" : "h"}</span>
              </div>
              <input type="range" min={0} max={maxVal} step={a.isFreq ? 1 : 0.5} value={usage} onChange={(e) => onUsage(parseFloat(e.target.value))} style={{ width: "100%", accentColor: fm.color.accent, height: 3 }} />

              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${fm.color.border}` }}>
                <div style={{ fontSize: 10.5, color: fm.color.textSecondary, marginBottom: 8 }}>When did it happen?</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {TIME_SLOTS.map((t) => {
                    const Icon = TIME_ICONS[t.id];
                    const active = timeOfDay.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => onToggleTime(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: fm.radius.pill, border: `1px solid ${active ? fm.color.accent : fm.color.border}`, background: active ? `${fm.color.accent}1f` : "transparent", color: active ? fm.color.accent : fm.color.textTertiary, fontSize: 10.5, fontWeight: 600 }}>
                        {Icon && <Icon size={11} />}
                        {t.label.replace(/^\S+\s/, "")}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${fm.color.border}` }}>
                <div style={{ fontSize: 10.5, color: fm.color.textSecondary, marginBottom: 8 }}>What triggered it?</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {TRIGGERS.map((t) => {
                    const Icon = TRIGGER_ICONS[t.id];
                    const active = triggers.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => onToggleTrigger(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: fm.radius.pill, border: `1px solid ${active ? fm.color.accent : fm.color.border}`, background: active ? `${fm.color.accent}1f` : "transparent", color: active ? fm.color.accent : fm.color.textTertiary, fontSize: 10.5, fontWeight: 600 }}>
                        {Icon && <Icon size={11} />}
                        {t.label.replace(/^\S+\s/, "")}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubmitButton({ canSubmit, loading, justSucceeded, onClick, hasMood }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={!canSubmit}
      whileHover={canSubmit ? { y: -2, filter: "brightness(1.05)" } : {}}
      animate={{
        backgroundColor: justSucceeded ? fm.color.success : canSubmit ? fm.color.accent : fm.color.surfaceSunken,
        boxShadow: justSucceeded ? `0 0 0 6px ${fm.color.success}22, 0 12px 28px -8px ${fm.color.success}55` : "none",
      }}
      transition={{ duration: 0.3, ease: EASE }}
      style={{ width: "100%", padding: "15px 28px", borderRadius: fm.radius.pill, border: "none", color: canSubmit || justSucceeded ? "#fff" : fm.color.textTertiary, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
    >
      <AnimatePresence mode="wait">
        {justSucceeded ? (
          <motion.span key="done" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={16} /> Logged
          </motion.span>
        ) : loading ? (
          <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} style={{ display: "flex" }}>
              <Loader2 size={16} />
            </motion.span>
            Synapse is reading your day…
          </motion.span>
        ) : (
          <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {!hasMood ? "Select your mood to continue" : "Continue →"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ReplySkeleton() {
  return (
    <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <Card padding={28} style={GLASS_CARD}>
        <Eyebrow style={{ marginBottom: 14 }}>Synapse — Coach Response</Eyebrow>
        {[92, 78, 85, 60].map((w, i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
            style={{ height: 12, width: `${w}%`, background: fm.color.surfaceSunken, borderRadius: 6, marginBottom: 10 }}
          />
        ))}
      </Card>
    </motion.div>
  );
}