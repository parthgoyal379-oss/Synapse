import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Sparkles } from "lucide-react";
import { fm } from "./theme";
import { Card, Eyebrow, GLASS_CARD, EASE } from "./components";
import { useSmartStreakRecovery, toggleEmergencyTask } from "../recoveryEngine";

// Same momentum words the shared engine returns for Command Mode — mapped
// to Focus Mode's own warm, calm palette instead of Command Mode's
// tactical reds/blues. The WORD is identical across both themes; only this
// color mapping is theme-specific.
const MOMENTUM_STYLE = {
  Critical: { label: "Needing Care", color: "#C9714B" },
  Recovering: { label: "Recovering", color: "#DD7A31" },
  Building: { label: "Building", color: "#6E9BB8" },
  Stable: { label: "Stable", color: "#5FA88A" },
  Strong: { label: "Strong", color: "#4C9A73" },
};

/**
 * SmartRecoveryCard — drop into FocusModeHome (or any Focus Mode screen)
 * alongside the existing hero/stats cards. Reads `streak` the same way
 * every other Focus Mode card does (from readSynapseSnapshot()'s value,
 * passed in as a prop) and calls the SAME useSmartStreakRecovery hook
 * Command Mode's Checkin screen calls — same Firestore/localStorage
 * fields, same formulas, same AI prompts. Nothing here recomputes
 * integrity, momentum, or lifetime days independently.
 */
export default function SmartRecoveryCard({ streak, onOpenCoach }) {
  const data = useSmartStreakRecovery({ streak });
  if (!data) return null;

  const momentumStyle = MOMENTUM_STYLE[data.momentum] || MOMENTUM_STYLE.Building;
  const isRebuilding = streak < data.previousBest;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      <Card padding={24} style={GLASS_CARD}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Heart size={13} strokeWidth={2.4} color={fm.color.accent} />
          <Eyebrow>Recovery Wellbeing</Eyebrow>
        </div>

        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: isRebuilding || data.isSlipToday ? 18 : 0 }}>
          <div>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 4 }}>Recovery Integrity</div>
            <div style={{ fontFamily: fm.font.display, fontSize: 26, fontWeight: 600, color: fm.color.textPrimary }}>{data.integrity}%</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 4 }}>Momentum</div>
            <div style={{ fontFamily: fm.font.display, fontSize: 15, fontWeight: 600, color: momentumStyle.color }}>{momentumStyle.label}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: fm.color.textTertiary, marginBottom: 4 }}>Days of Progress</div>
            <div style={{ fontFamily: fm.font.display, fontSize: 15, fontWeight: 600, color: fm.color.textPrimary }}>{data.lifetimeCleanDays}</div>
          </div>
        </div>

        {isRebuilding && !data.isSlipToday && (
          <div style={{ padding: "12px 14px", borderRadius: fm.radius.md, background: fm.color.accentSoft, fontSize: 12, color: fm.color.textSecondary, lineHeight: 1.6 }}>
            You're on day {streak} of a new chapter. Your best stretch was {data.previousBest} days, and none of that progress was erased — {data.lifetimeCleanDays} clean days are still yours.
          </div>
        )}

        {data.isSlipToday && <EmergencyMissionSection data={data} onOpenCoach={onOpenCoach} />}
      </Card>
    </motion.div>
  );
}

function EmergencyMissionSection({ data, onOpenCoach }) {
  const [mission, setMission] = useState(data.mission);
  if (!mission) return null;

  const onToggle = (taskId) => {
    const updated = toggleEmergencyTask(data.todayDate, taskId);
    if (updated) setMission({ ...updated });
  };

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: fm.color.textSecondary, marginBottom: 10 }}>A few small steps to steady yourself today</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {mission.tasks.map((t) => (
          <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: t.done ? fm.color.textTertiary : fm.color.textPrimary, textDecoration: t.done ? "line-through" : "none", cursor: "pointer" }}>
            <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} style={{ width: 16, height: 16, accentColor: fm.color.accent }} />
            {t.text}
          </label>
        ))}
      </div>
      {mission.completed && (
        <div style={{ fontSize: 11.5, color: fm.color.accentDeep, marginBottom: 10 }}>You completed today's reset. That effort is already reflected above.</div>
      )}

      {data.analysis && (
        <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1px solid ${fm.color.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Sparkles size={12} strokeWidth={2.4} color={fm.color.accent} />
            <span style={{ fontSize: 10.5, fontWeight: 600, color: fm.color.textTertiary }}>What your coach noticed</span>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.75, color: fm.color.textSecondary, whiteSpace: "pre-wrap", margin: 0 }}>{data.analysis}</p>
        </div>
      )}

      {onOpenCoach && (
        <button onClick={onOpenCoach} style={{ marginTop: 12, fontSize: 11.5, fontWeight: 600, color: fm.color.accentDeep, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          Talk it through with your coach →
        </button>
      )}
    </div>
  );
}
