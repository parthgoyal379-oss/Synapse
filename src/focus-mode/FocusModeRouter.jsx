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
  switch (screen) {
    case "checkin":
      return <FocusModeCheckIn streak={streak} savedPlan={savedPlan} lastCheckin={lastCheckin} onCheckin={onCheckin} onGoChat={onGoChat} onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "plan":
      return <FocusModePlan savedPlan={savedPlan} onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "progress":
      return <FocusModeProgress onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "chat":
      return (
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
      );
    case "journal":
      return <FocusModeJournal uid={uid} onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "urge":
      return <FocusModeUrgeLog rescue={rescue} streak={streak} onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "report":
      return <FocusModeReport onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "about":
      return <FocusModeAbout onNavigate={onNavigate} onOpenProfile={onOpenProfile} onBeginJourney={() => onNavigate("home")} />;
    case "settings":
      return <FocusModeSettings uid={uid} coach={coach} onDeleteAccount={onDeleteAccount} onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
    case "home":
    default:
      return <FocusModeHome onNavigate={onNavigate} onOpenProfile={onOpenProfile} />;
  }
}