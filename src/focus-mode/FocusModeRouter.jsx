import { AnimatePresence, motion } from "framer-motion";
import FocusModeHome from "./FocusModeHome";
import FocusModeCheckIn from "./FocusModeCheckIn";
import FocusModePlan from "./FocusModePlan";
import FocusModeProgress from "./FocusModeProgress";
import FocusModeCoach from "./FocusModeCoach";
import FocusModeJournal from "./FocusModeJournal";
import FocusModeUrgeLog from "./FocusModeUrgeLog";
import FocusModeReport from "./FocusModeReport";
import FocusModeAbout from "./FocusModeAbout";
import FocusModeSettings from "./FocusModeSettings";

// Screens with a real Focus Mode implementation today.
export const FOCUS_SUPPORTED_SCREENS = ["home", "checkin", "plan", "progress", "chat", "journal", "urge", "report", "about", "settings"];

/**
 * FocusModeRouter — the single integration seam between App.jsx and the
 * Focus Mode screens. App.jsx only needs to import this one component and
 * pass through the state/handlers it already has; this file is the only
 * place that maps `screen` -> a specific Focus Mode component, so adding
 * or changing a Focus Mode screen never requires touching App.jsx again.
 *
 * NOTE on "chat": wired to App.jsx's shared useCoachChat() hook via the
 * `coach` prop — same messages, same tone, same syn_chat_history writes
 * Command Mode's <Chat/> uses. There is only one AI system; this screen
 * is a presentation layer over it, nothing more.
 */
export default function FocusModeRouter({
  screen,
  onNavigate,
  onOpenProfile,
  streak,
  savedPlan,
  lastCheckin,
  history,
  planHistory,
  rescue,
  coach,
  tones,
  renderMessage,
  onCheckin,
  onGoChat,
  onDeleteAccount,
  uid,
}) {
  // Page transition variants: fade in/out with slight vertical movement and scale
  const pageVariants = {
    initial: { opacity: 0, y: 20, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: "easeOut" } },
    exit: { opacity: 0, y: -20, scale: 0.98, transition: { duration: 0.2, ease: "easeOut" } },
  };

  return (
    <AnimatePresence>
      <motion.div
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageVariants}
      >
        {screen === "checkin" && <FocusModeCheckIn
          streak={streak}
          savedPlan={savedPlan}
          lastCheckin={lastCheckin}
          onCheckin={onCheckin}
          onGoChat={onGoChat}
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "plan" && <FocusModePlan
          savedPlan={savedPlan}
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "progress" && <FocusModeProgress
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "chat" && (
          <FocusModeCoach
            messages={coach?.msgs}
            loading={coach?.loading}
            mode={coach?.mode}
            tones={tones}
            onModeChange={coach?.switchMode}
            onSend={coach?.send}
            streak={streak}
            savedPlan={savedPlan}
            renderMessage={renderMessage}
            onNavigate={onNavigate}
            onOpenProfile={onOpenProfile}
          />
        )}
        {screen === "journal" && <FocusModeJournal
          uid={uid}
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "urge" && <FocusModeUrgeLog
          rescue={rescue}
          streak={streak}
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "report" && <FocusModeReport
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {screen === "about" && <FocusModeAbout
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
          onBeginJourney={() => onNavigate("home")}
        />}
        {screen === "settings" && <FocusModeSettings
          onDeleteAccount={onDeleteAccount}
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
        {/* Default to home for unknown screens */}
        {(screen === "home" || !(screen in FOCUS_SUPPORTED_SCREENS)) && <FocusModeHome
          onNavigate={onNavigate}
          onOpenProfile={onOpenProfile}
        />}
      </motion.div>
    </AnimatePresence>
  );
}