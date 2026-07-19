import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, BookHeart } from "lucide-react";
import { fm } from "./theme";
import {
  readJournalEntries, saveJournalEntry, deleteJournalEntry,
  syncJournalEntryToCloud, journalWritingStreak, journalMoodDistribution,
  journalMoodTimeline, journalCalendarMonth, extractMemoryCards,
  generateGrowthInsights, makeJournalEntry, computeWordStats,
} from "./synapseData";
import {
  FocusModeShell, Sidebar, TopBar, Card, Eyebrow, Button,
  JournalEditor, JournalCard, ReflectionCalendar, MemoryCard,
  InsightCard, MoodTimeline, PromptCard, DonutChart,
  AmbientBackground, EASE, GLASS_CARD, HOVER_LIFT, CountUp,
} from "./components";

const PROMPTS = [
  "What challenged you today? What are you proud of?",
  "What urge taught you something today?",
  "What did your future self do differently today?",
  "What's one promise you kept to yourself this week?",
  "Where did discipline show up today, even in a small way?",
  "What would the version of you 90 days from now say to you right now?",
];
const MOOD_OPTIONS = [
  { id: "calm", label: "Calm", color: fm.color.success },
  { id: "focused", label: "Focused", color: fm.color.info },
  { id: "grateful", label: "Grateful", color: fm.color.warning },
  { id: "struggling", label: "Struggling", color: fm.color.danger },
  { id: "hopeful", label: "Hopeful", color: fm.color.accent },
];
const MOOD_COLOR_MAP = Object.fromEntries(MOOD_OPTIONS.map((m) => [m.id, m.color]));
const DEPTH_COLORS = {
  none: fm.color.surfaceSunken, short: fm.color.accentSoft,
  deep: fm.color.warningSoft, breakthrough: fm.color.successSoft,
};
const FILTERS = ["All", "Today", "Week", "Month", "Favorites"];

export default function FocusModeJournal({ uid, onNavigate, onOpenProfile }) {
  const [entries, setEntries] = useState(() => readJournalEntries());
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftMood, setDraftMood] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [promptIdx, setPromptIdx] = useState(0);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [hoveredCell, setHoveredCell] = useState(null);
  const [readingEntry, setReadingEntry] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter, setFilter] = useState("All");

  const pColor = fm.color.accent;
  const writingStreak = useMemo(() => journalWritingStreak(entries), [entries]);
  const moodDist = useMemo(() => journalMoodDistribution(entries), [entries]);
  const timeline = useMemo(() => journalMoodTimeline(entries, 14), [entries]);
  const calendarCells = useMemo(() => journalCalendarMonth(entries, monthCursor.year, monthCursor.month), [entries, monthCursor]);
  const memoryCards = useMemo(() => extractMemoryCards(entries), [entries]);
  const insights = useMemo(() => generateGrowthInsights(entries), [entries]);
  const todayEntry = entries.find((e) => new Date(e.createdAt).toDateString() === new Date().toDateString());

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    let list = entries;
    if (filter === "Today") list = list.filter((e) => new Date(e.createdAt).toDateString() === new Date().toDateString());
    else if (filter === "Week") list = list.filter((e) => now - new Date(e.createdAt).getTime() <= 7 * 864e5);
    else if (filter === "Month") list = list.filter((e) => now - new Date(e.createdAt).getTime() <= 30 * 864e5);
    else if (filter === "Favorites") list = list.filter((e) => e.favorite);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => (e.title || "").toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
    }
    return list;
  }, [entries, filter, search]);

  const handleSave = async () => {
    if (!draftContent.trim()) return;
    setSaving(true);
    const entry = todayEntry
      ? { ...todayEntry, title: draftTitle, content: draftContent, mood: draftMood || todayEntry.mood }
      : makeJournalEntry({ title: draftTitle, content: draftContent, mood: draftMood });
    const saved = saveJournalEntry(entry);
    setEntries(readJournalEntries());
    syncJournalEntryToCloud(uid, saved);
    setSaving(false);
    setLastSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
  };

  const handleDelete = (id) => {
    deleteJournalEntry(id);
    setEntries(readJournalEntries());
    setConfirmDeleteId(null);
    if (readingEntry?.id === id) setReadingEntry(null);
  };

  const monthLabel = new Date(monthCursor.year, monthCursor.month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const changeMonth = (delta) =>
    setMonthCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const cv = (delay) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  });

  return (
    <FocusModeShell>
      <AmbientBackground color={pColor} />
      <Sidebar active="journal" onNavigate={onNavigate} />
      <main style={{ flex: 1, minWidth: 0, paddingBottom: 60, position: "relative", zIndex: 1 }}>
        <TopBar userInitial="S" onOpenProfile={onOpenProfile} />

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} style={{ padding: "clamp(14px,4vw,24px) clamp(14px,4vw,44px) 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BookHeart size={22} color={fm.color.accent} strokeWidth={1.8} />
            <div style={{ fontFamily: fm.font.display, fontSize: 30, fontWeight: 600, color: fm.color.textPrimary }}>Journal</div>
          </div>
          <div style={{ fontSize: 12.5, color: fm.color.textSecondary, marginTop: 4 }}>Every entry becomes evidence of who you're becoming.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
            <span style={{ fontSize: 11, color: fm.color.textTertiary }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span>
            <span style={{ fontFamily: fm.font.display, fontSize: 11.5, fontStyle: "italic", color: fm.color.accentDeep }}>"The unexamined day isn't worth repeating."</span>
          </div>
        </motion.div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "start" }}>
          <motion.div {...cv(0.05)} style={{ flex: "1.5 1 300px", minWidth: 0, width: "100%" }}>
            <Card padding={28} style={GLASS_CARD}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <Eyebrow>Today's Reflection</Eyebrow>
                <span style={{ fontSize: 11, color: fm.color.textTertiary }}>
                  {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {MOOD_OPTIONS.map((m) => (
                  <button key={m.id} onClick={() => setDraftMood(m.id)}
                    style={{ padding: "5px 12px", borderRadius: fm.radius.pill, border: `1px solid ${draftMood === m.id ? m.color : fm.color.border}`, background: draftMood === m.id ? `${m.color}1f` : "transparent", color: draftMood === m.id ? m.color : fm.color.textTertiary, fontSize: 10.5, fontWeight: 600, cursor: "pointer", transition: "all .2s ease" }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <JournalEditor title={draftTitle} onTitleChange={setDraftTitle} content={draftContent} onContentChange={setDraftContent} onSave={handleSave} saving={saving} lastSavedAt={lastSavedAt} />
            </Card>
          </motion.div>

          <motion.div {...cv(0.11)} style={{ flex: "0.8 1 220px", minWidth: 0 }}>
            <PromptCard prompt={PROMPTS[promptIdx]} dotCount={PROMPTS.length} dotIndex={promptIdx} onRefresh={() => setPromptIdx((i) => (i + 1) % PROMPTS.length)} />
          </motion.div>

          <motion.div {...cv(0.17)} {...HOVER_LIFT} style={{ flex: "0.7 1 200px", minWidth: 0 }}>
            <Card padding={22} style={{ ...GLASS_CARD, textAlign: "center" }}>
              <Eyebrow style={{ marginBottom: 12 }}>Writing Streak</Eyebrow>
              <div style={{ width: 84, height: 84, borderRadius: "50%", border: `6px solid ${fm.color.accentSoft}`, borderTopColor: fm.color.accent, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <span style={{ fontFamily: fm.font.display, fontSize: 24, fontWeight: 700, color: fm.color.textPrimary }}><CountUp to={writingStreak} /></span>
                <span style={{ fontSize: 9, color: fm.color.textTertiary }}>Days</span>
              </div>
              <div style={{ fontSize: 11, color: fm.color.textSecondary }}>Consistency compounds.</div>
            </Card>
          </motion.div>
        </div>

        <motion.div {...cv(0.2)} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 220px", maxWidth: 320, background: fm.color.surface, borderRadius: fm.radius.pill, padding: "9px 16px", border: `1px solid ${searchFocused ? fm.color.accentSoftBorder : fm.color.border}`, boxShadow: searchFocused ? `0 0 0 3px ${fm.color.accentSoft}` : fm.shadow.card, transition: "box-shadow .25s ease, border-color .25s ease" }}>
            <motion.span animate={{ x: searchFocused ? 2 : 0 }}><Search size={14} color={fm.color.textTertiary} /></motion.span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="Search entries…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12.5, color: fm.color.textPrimary }} />
          </div>
          <div style={{ display: "flex", gap: 3, background: fm.color.surfaceSunken, borderRadius: fm.radius.pill, padding: 3 }}>
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: "6px 14px", borderRadius: fm.radius.pill, border: "none", background: filter === f ? fm.color.surface : "transparent", boxShadow: filter === f ? fm.shadow.card : "none", color: filter === f ? fm.color.accentDeep : fm.color.textTertiary, fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all .2s ease" }}>
                {f}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div {...cv(0.24)} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0" }} {...HOVER_LIFT}>
          <Card padding={26} style={GLASS_CARD}>
            <Eyebrow>Mood Timeline (Last 14 Days)</Eyebrow>
            <MoodTimeline days={timeline} moodColors={MOOD_COLOR_MAP} onHoverDay={() => {}} />
          </Card>
        </motion.div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, alignItems: "start" }}>
          <motion.div {...cv(0.28)} {...HOVER_LIFT}>
            <Card padding={26} style={GLASS_CARD}>
              <Eyebrow style={{ marginBottom: 14 }}>Reflection Calendar</Eyebrow>
              <ReflectionCalendar monthLabel={monthLabel} cells={calendarCells} depthColors={DEPTH_COLORS} onPrevMonth={() => changeMonth(-1)} onNextMonth={() => changeMonth(1)} onHoverCell={setHoveredCell} />
              {hoveredCell?.entry && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: fm.color.surfaceMuted, borderRadius: fm.radius.sm, fontSize: 11.5 }}>
                  <strong style={{ color: fm.color.textPrimary }}>{hoveredCell.entry.title || "Untitled"}</strong>
                  <div style={{ color: fm.color.textSecondary, marginTop: 3 }}>{hoveredCell.entry.preview}</div>
                  <div style={{ color: fm.color.textTertiary, marginTop: 3 }}>{hoveredCell.entry.wordCount} words</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                {Object.entries({ "No entry": DEPTH_COLORS.none, Short: DEPTH_COLORS.short, Deep: DEPTH_COLORS.deep, Breakthrough: DEPTH_COLORS.breakthrough }).map(([label, color]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
                    <span style={{ fontSize: 10.5, color: fm.color.textTertiary }}>{label}</span>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <motion.div {...cv(0.32)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 14 }}>Memory Cards</Eyebrow>
                {memoryCards.length > 0
                  ? <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{memoryCards.map((m, i) => <MemoryCard key={i} text={m.text} date={new Date(m.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} />)}</div>
                  : <p style={{ fontSize: 12, color: fm.color.textTertiary }}>Keep writing — meaningful moments will surface here automatically.</p>}
              </Card>
            </motion.div>
            <motion.div {...cv(0.36)} {...HOVER_LIFT}>
              <Card padding={22} style={GLASS_CARD}>
                <Eyebrow style={{ marginBottom: 14 }}>Growth Insights</Eyebrow>
                {insights.length > 0 ? insights.map((text, i) => <InsightCard key={i} icon="📈" text={text} />) : <p style={{ fontSize: 12, color: fm.color.textTertiary }}>Insights appear once you've written a few entries.</p>}
              </Card>
            </motion.div>
          </div>
        </div>

        <div style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          <motion.div {...cv(0.4)} {...HOVER_LIFT}>
            <Card padding={22} style={GLASS_CARD}>
              <Eyebrow style={{ marginBottom: 14 }}>Emotion Distribution</Eyebrow>
              {moodDist.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
                  <DonutChart size={100} thickness={14} centerValue={entries.length} centerLabel="Entries" segments={moodDist.map((m) => ({ value: m.count, color: MOOD_COLOR_MAP[m.mood] || fm.color.textTertiary }))} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {moodDist.map((m) => {
                      const total = moodDist.reduce((s, x) => s + x.count, 0);
                      return (
                        <div key={m.mood} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: MOOD_COLOR_MAP[m.mood], flexShrink: 0 }} />
                          <span style={{ color: fm.color.textPrimary, fontWeight: 600, textTransform: "capitalize" }}>{m.mood}</span>
                          <span style={{ color: fm.color.textTertiary }}>{Math.round((m.count / total) * 100)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : <p style={{ fontSize: 12, color: fm.color.textTertiary }}>Tag a mood on your entries to see your emotional mix here.</p>}
            </Card>
          </motion.div>
          <motion.div {...cv(0.44)} {...HOVER_LIFT}>
            <Card padding={22} style={{ ...GLASS_CARD, background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}` }}>
              <Eyebrow style={{ marginBottom: 10, color: fm.color.accentDeep }}>✦ AI Reflection</Eyebrow>
              <p style={{ fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.7, marginBottom: 14 }}>A coach-generated summary of your journal isn't wired up yet — this panel will populate once that's connected.</p>
              <Button variant="accentGhost" size="sm" onClick={() => onNavigate?.("chat")}>Discuss With Coach</Button>
            </Card>
          </motion.div>
        </div>

        <motion.div {...cv(0.48)} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0" }}>
          <Card padding={26} style={GLASS_CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Eyebrow>{filter === "All" ? "Recent Entries" : `${filter} Entries`}</Eyebrow>
              {entries.length > 0 && <span style={{ fontSize: 10.5, color: fm.color.accent, fontWeight: 600 }}>{filteredEntries.length} shown</span>}
            </div>
            <AnimatePresence mode="popLayout">
              {filteredEntries.length > 0 ? filteredEntries.slice(0, 6).map((e, i) => (
                <motion.div key={e.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE, delay: i * 0.04 }}>
                  <JournalCard title={e.title} preview={e.content.slice(0, 120)} date={new Date(e.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} wordCount={e.wordCount} mood={e.mood} moodColor={MOOD_COLOR_MAP[e.mood]}
                    onRead={() => setReadingEntry(e)}
                    onEdit={() => { setDraftTitle(e.title); setDraftContent(e.content); setDraftMood(e.mood); }}
                    onDelete={() => setConfirmDeleteId(e.id)} />
                  {confirmDeleteId === e.id && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px 12px" }}>
                      <span style={{ fontSize: 11, color: fm.color.danger }}>Delete this entry permanently?</span>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(e.id)}>Confirm</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                    </div>
                  )}
                </motion.div>
              )) : entries.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", padding: "36px 12px" }}>
                  <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 16px" }}>
                    <div style={{ position: "absolute", inset: -14, borderRadius: "50%", background: `radial-gradient(circle, ${fm.color.accent}22, transparent 70%)` }} />
                    <div style={{ position: "relative", width: 64, height: 64, borderRadius: "50%", background: fm.color.accentSoft, border: `1px solid ${fm.color.accentSoftBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <BookHeart size={26} color={fm.color.accentDeep} strokeWidth={1.6} />
                    </div>
                  </div>
                  <p style={{ fontFamily: fm.font.display, fontSize: 15, fontStyle: "italic", color: fm.color.textPrimary, marginBottom: 6 }}>"The unexamined day isn't worth repeating."</p>
                  <p style={{ fontSize: 12, color: fm.color.textTertiary, marginBottom: 18 }}>No reflections written yet — today's is a good place to start.</p>
                  <Button variant="accentGhost" size="sm" onClick={() => document.querySelector("textarea")?.focus()}>Write Your First Entry</Button>
                </motion.div>
              ) : (
                <p style={{ fontSize: 12.5, color: fm.color.textTertiary, padding: "20px 0", textAlign: "center" }}>No entries match this filter.</p>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        <motion.div {...cv(0.52)} style={{ padding: "clamp(14px,4vw,20px) clamp(14px,4vw,44px) 0" }}>
          <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2, ease: EASE }}>
            <Card padding={26} style={{ ...GLASS_CARD, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: fm.font.display, fontSize: 17, fontWeight: 600, color: fm.color.textPrimary }}>Continue Writing Tomorrow</div>
                <div style={{ fontSize: 11.5, color: fm.color.textSecondary, marginTop: 3 }}>One page today. A new you tomorrow.</div>
              </div>
              <Button variant="primary" onClick={() => onNavigate?.("plan")} style={{ background: fm.color.accent }}>Set Tomorrow's Intention</Button>
            </Card>
          </motion.div>
        </motion.div>

        <AnimatePresence>
          {readingEntry && (
            <motion.div onClick={() => setReadingEntry(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, background: "rgba(42,32,20,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.3, ease: EASE }}
                style={{ background: fm.color.surface, borderRadius: fm.radius.lg, padding: 32, maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto", boxShadow: fm.shadow.cardHover }}>
                <div style={{ fontSize: 11, color: fm.color.textTertiary, marginBottom: 6 }}>{new Date(readingEntry.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · {readingEntry.wordCount} words</div>
                <div style={{ fontFamily: fm.font.display, fontSize: 21, fontWeight: 600, color: fm.color.textPrimary, marginBottom: 14 }}>{readingEntry.title || "Untitled reflection"}</div>
                <p style={{ fontSize: 13.5, lineHeight: 1.9, color: fm.color.textPrimary, whiteSpace: "pre-wrap" }}>{readingEntry.content}</p>
                <div style={{ marginTop: 20 }}><Button variant="ghost" size="sm" onClick={() => setReadingEntry(null)}>Close</Button></div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </FocusModeShell>
  );
}