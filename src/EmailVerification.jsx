import { useEffect, useReducer, useRef, useCallback } from "react";
import { auth, functions } from "./firebase";
import { reload } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { NeuralMark } from "./App";
import { Lock, WifiOff, CheckCircle2, Inbox, Tag, Users, Bell } from "lucide-react";

// Server-authoritative: re-verifies against Firebase Auth itself and
// idempotently fires the Welcome email exactly once (Firestore is used
// only for "have we sent it" bookkeeping, never as the verification
// source of truth — see functions/emails/index.js).
async function confirmVerificationAndOnboard() {
  try {
    await httpsCallable(functions, "confirmVerificationAndOnboard")();
  } catch (e) {
    // Non-fatal: the user IS verified (Firebase Auth already confirmed
    // that before this was ever called) — a failure here just means the
    // welcome email / lifecycle metadata write didn't happen this time.
    // Don't block the user from entering the app over it.
    console.warn("confirmVerificationAndOnboard failed:", e);
  }
}

const RESEND_COOLDOWN = 60;
const POLL_INTERVAL_MS = 3500;

function mapVerifyError(code) {
  switch (code) {
    case "auth/network-request-failed":
      return { message: "Network error — check your connection and try again.", kind: "network" };
    case "auth/user-token-expired":
    case "auth/user-not-found":
      return { message: "This account no longer exists. Please sign up again.", kind: "deleted" };
    case "auth/user-disabled":
      return { message: "This account has been disabled. Contact support.", kind: "disabled" };
    case "auth/too-many-requests":
      return { message: "Too many attempts — please wait a moment and try again.", kind: "rate_limited" };
    case "auth/requires-recent-login":
      return { message: "Please sign in again to continue.", kind: "reauth" };
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return { message: "That verification link has expired or was already used.", kind: "expired" };
    default:
      return { message: "Something went wrong. Please try again.", kind: "unknown" };
  }
}

const EMAIL_CLIENTS = [
  { name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/from%3Asynapserewire.site" },
  { name: "Outlook", url: "https://outlook.live.com/mail/0/inbox" },
  { name: "Apple Mail", url: "message://" },
  { name: "Yahoo", url: "https://mail.yahoo.com" },
  { name: "Proton", url: "https://mail.proton.me" },
];

/* ─── STATE MACHINE ────────────────────────────────────────────────────────
   polling -> confirming -> success -> (onVerified handoff)
   offline can interrupt polling at any point and resumes it on reconnect.
   error is terminal-ish but user actions (resend / back to sign in) exit it.
────────────────────────────────────────────────────────────────────────── */
const initialState = {
  phase: "polling", // polling | confirming | success | offline | error
  error: null, // { message, kind }
};

function reducer(state, action) {
  switch (action.type) {
    case "WENT_OFFLINE":
      return state.phase === "success" ? state : { ...state, phase: "offline" };
    case "CAME_ONLINE":
      return state.phase === "offline" ? { ...state, phase: "polling" } : state;
    case "START_CONFIRMING":
      return { ...state, phase: "confirming", error: null };
    case "CONFIRMED":
      return { ...state, phase: "success", error: null };
    case "CHECK_FAILED":
      return { ...state, phase: "error", error: action.error };
    case "RESET_TO_POLLING":
      return { ...state, phase: "polling", error: null };
    default:
      return state;
  }
}

/* ─── EMAIL VERIFICATION ──────────────────────────────────────────────────
   Reached in two ways:
     - reason="signup": user just created an account, is still signed in,
       and needs to confirm their email before onVerified() hands them into
       the app.
     - reason="login": user tried to sign in with an unverified account —
       App.jsx already forced a signOut() before routing here, so there is
       no live session. The check/resend actions need a live user, so in
       this case we just point them back to the sign-in form instead.
────────────────────────────────────────────────────────────────────────── */
export default function EmailVerification({ email, reason = "signup", onVerified, onBackToSignIn }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [resendState, setResendStateRaw] = useReducer((s, a) => ({ ...s, ...a }), {
    status: "idle", // idle | sending | sent | error
    error: "",
    cooldown: 0,
  });

  const hasSession = !!auth.currentUser;
  const pollTimerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const phaseRef = useRef(state.phase);
  useEffect(() => { phaseRef.current = state.phase; }, [state.phase]);

  // The single place that actually performs a verification check. Used by
  // the background poll and the manual button — one implementation, two
  // triggers, per "do not duplicate polling".
  const runVerificationCheck = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !mountedRef.current) return;
    try {
      await reload(user);
      if (!mountedRef.current) return;
      if (user.emailVerified) {
        dispatch({ type: "START_CONFIRMING" });
        await confirmVerificationAndOnboard();
        if (!mountedRef.current) return;
        dispatch({ type: "CONFIRMED" });
        // Hold on the success animation for a beat before handing off —
        // this is the one intentional, user-visible delay in the whole flow.
        setTimeout(() => {
          if (mountedRef.current) onVerified(user);
        }, 1200);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      // A failed background poll shouldn't scare the user with an error
      // screen — only surface errors from an explicit manual action.
      console.warn("Background verification check failed:", e.code, e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background polling — single self-scheduling timeout (not setInterval,
  // so a slow reload() can't overlap with the next tick), fully cleaned up
  // on unmount, and it simply stops scheduling itself while phase !== polling
  // (offline / confirming / success / error) instead of running a second
  // parallel mechanism to pause it.
  useEffect(() => {
    if (!hasSession) return undefined;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      if (phaseRef.current === "polling") runVerificationCheck();
      pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    }
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    // Also check immediately on mount (covers "verified in another tab,
    // came back to this one") without waiting a full interval.
    runVerificationCheck();

    return () => {
      cancelled = true;
      clearTimeout(pollTimerRef.current);
    };
  }, [hasSession, runVerificationCheck]);

  // Network state — pause/resume polling, never invent a second timer for it.
  useEffect(() => {
    function goOffline() { dispatch({ type: "WENT_OFFLINE" }); }
    function goOnline() { dispatch({ type: "CAME_ONLINE" }); }
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) goOffline();
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Resend cooldown — single interval, cleaned up on unmount or completion.
  useEffect(() => {
    if (resendState.cooldown <= 0) return undefined;
    cooldownTimerRef.current = setTimeout(
      () => setResendStateRaw({ cooldown: Math.max(0, resendState.cooldown - 1) }),
      1000
    );
    return () => clearTimeout(cooldownTimerRef.current);
  }, [resendState.cooldown]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  async function handleCheckVerified() {
    const user = auth.currentUser;
    if (!user) {
      dispatch({ type: "CHECK_FAILED", error: { message: "You're signed out — please sign in again to continue.", kind: "reauth" } });
      return;
    }
    dispatch({ type: "START_CONFIRMING" });
    try {
      await reload(user);
      if (user.emailVerified) {
        await confirmVerificationAndOnboard();
        dispatch({ type: "CONFIRMED" });
        setTimeout(() => onVerified(user), 1200);
      } else {
        dispatch({ type: "CHECK_FAILED", error: { message: "Still not verified — check your inbox and try again.", kind: "not_yet" } });
      }
    } catch (e) {
      console.error("Verification check failed:", e.code, e.message);
      dispatch({ type: "CHECK_FAILED", error: mapVerifyError(e.code) });
    }
  }

  async function handleResend() {
    if (resendState.cooldown > 0) return;
    const user = auth.currentUser;
    if (!user) {
      setResendStateRaw({ status: "error", error: "You're signed out — please sign in again to resend." });
      return;
    }
    setResendStateRaw({ status: "sending", error: "" });
    try {
      // Custom-branded pipeline (Cloud Function + Resend), same as the
      // initial signup send — never Firebase's default template.
      await httpsCallable(functions, "sendVerificationEmail")();
      setResendStateRaw({ status: "sent", cooldown: RESEND_COOLDOWN });
      setTimeout(() => setResendStateRaw({ status: "idle" }), 4000);
      dispatch({ type: "RESET_TO_POLLING" });
    } catch (e) {
      console.error("Resend failed:", e.code, e.message);
      const { message, kind } = mapVerifyError(e.code);
      setResendStateRaw({ status: "error", error: message });
      if (kind === "rate_limited") setResendStateRaw({ cooldown: RESEND_COOLDOWN });
    }
  }

  if (!hasSession) {
    return <SignedOutCard onBackToSignIn={onBackToSignIn} />;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "80px 24px" }}>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, background: "radial-gradient(circle,rgba(255,100,0,0.07) 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 2, animation: "fadeUp .6s cubic-bezier(.16,1,.3,1)" }}>

        {state.phase === "success" ? (
          <SuccessPanel />
        ) : (
          <>
            <HeroHeader phase={state.phase} reason={reason} />
            <div className="glass" style={{ padding: 32, animation: state.phase === "polling" ? "borderGlow 5s ease-in-out infinite" : "none" }}>

              {reason === "login" && (
                <Banner tone="warn">Please verify your email before logging in.</Banner>
              )}

              <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, textAlign: "center", marginBottom: 4 }}>
                We've sent a verification email to
              </p>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#ffb347", textAlign: "center", marginBottom: 20, wordBreak: "break-word" }}>
                {email}
              </p>

              {state.phase === "offline" && (
                <Banner tone="neutral" icon={<WifiOff size={13} />}>
                  Waiting for connection… we'll keep checking automatically once you're back online.
                </Banner>
              )}
              {state.phase === "confirming" && <PollingStatus label="Confirming verification" />}
              {state.phase === "polling" && <PollingStatus label="Checking verification status" />}
              {state.phase === "error" && state.error && (
                <ErrorBanner error={state.error} onBackToSignIn={onBackToSignIn} />
              )}
              {resendState.status === "sent" && (
                <Banner tone="success">Verification email sent — check your inbox.</Banner>
              )}
              {resendState.status === "error" && resendState.error && (
                <Banner tone="warn">{resendState.error}</Banner>
              )}

              <button
                className="btn-primary"
                onClick={handleCheckVerified}
                disabled={state.phase === "confirming"}
                style={{ width: "100%", padding: 15, fontSize: 13, borderRadius: 12, justifyContent: "center", display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 12 }}
              >
                {state.phase === "confirming" ? (
                  <span style={{ display: "flex", gap: 4 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff", animation: `dotBlink 1s ${i * 0.18}s infinite` }} />)}</span>
                ) : "I've Verified →"}
              </button>
              <button
                onClick={handleResend}
                disabled={resendState.cooldown > 0 || resendState.status === "sending"}
                style={{ width: "100%", padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: resendState.cooldown > 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500, cursor: resendState.cooldown > 0 ? "default" : "pointer", transition: "all .25s" }}
              >
                {resendState.status === "sending" ? "Sending…" : resendState.cooldown > 0 ? `Resend in ${resendState.cooldown}s` : "Resend Email"}
              </button>

              <p style={{ textAlign: "center", fontSize: 11, color: "var(--text4)", marginTop: 18, lineHeight: 1.9, letterSpacing: 0.2 }}>
                Wrong email or need to start over?{" "}
                <span onClick={onBackToSignIn} style={{ color: "rgba(255,180,80,0.6)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
                  Back to sign in
                </span>
              </p>
            </div>

            <EmailClientLaunchers />
            <SpamHelperCard />
            <SecurityCard />
          </>
        )}
      </div>
    </div>
  );
}

/* ─── HERO ─────────────────────────────────────────────────────────────── */
function HeroHeader({ phase, reason }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        {phase === "polling" && (
          <div style={{ position: "absolute", inset: -14, borderRadius: "50%", border: "1px solid rgba(255,140,0,0.35)", animation: "pulseRing 2.4s ease-out infinite" }} />
        )}
        <NeuralMark size={56} />
      </div>
      <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 26, fontWeight: 900, letterSpacing: -1, background: "linear-gradient(145deg,#fff 30%,rgba(255,180,80,.75) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 8, animation: "fadeUp .6s cubic-bezier(.16,1,.3,1) .05s both" }}>
        Verify Your Neural Identity
      </div>
      <div style={{ fontSize: 12, color: "var(--text4)", letterSpacing: 1.5, textTransform: "uppercase", animation: "fadeUp .6s cubic-bezier(.16,1,.3,1) .1s both" }}>
        {reason === "login" ? "One final step before you log in" : "One final step before your recovery begins"}
      </div>
    </div>
  );
}

function PollingStatus({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 0 20px" }}>
      <div style={{ display: "flex", gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#ff8c00", animation: `dotBlink 1.2s ${i * 0.2}s ease-in-out infinite` }} />
        ))}
      </div>
      <span style={{ fontSize: 11, color: "rgba(255,180,80,0.55)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 500 }}>
        {label}…
      </span>
    </div>
  );
}

/* ─── SUCCESS ──────────────────────────────────────────────────────────── */
function SuccessPanel() {
  return (
    <div className="glass" style={{ padding: "48px 32px", textAlign: "center", animation: "scaleIn .5s cubic-bezier(.16,1,.3,1)" }}>
      <div style={{ position: "relative", width: 84, height: 84, margin: "0 auto 24px" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(120,255,160,0.4)", animation: "ringOut 1.4s ease-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(80,255,150,0.1)", display: "flex", alignItems: "center", justifyContent: "center", animation: "scaleIn .5s cubic-bezier(.16,1,.3,1) .1s both" }}>
          <CheckCircle2 size={40} color="#66ffaa" />
        </div>
      </div>
      <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color: "#fff", marginBottom: 8 }}>
        Identity Verified
      </div>
      <div style={{ fontSize: 13, color: "var(--text4)", letterSpacing: 0.5 }}>
        Initializing your recovery protocol…
      </div>
    </div>
  );
}

/* ─── EMAIL CLIENT SHORTCUTS ───────────────────────────────────────────── */
function EmailClientLaunchers() {
  return (
    <div className="glass" style={{ padding: "20px 22px", marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(255,180,80,0.7)", marginBottom: 14, textAlign: "center" }}>
        Open Your Inbox
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {EMAIL_CLIENTS.map((c) => (
          <a
            key={c.name}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,140,0,.07)", border: "1px solid rgba(255,140,0,.2)", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 500, color: "rgba(255,220,180,0.85)", textDecoration: "none", transition: "all .2s", animation: "tagGlow 4s ease-in-out infinite" }}
          >
            {c.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── SPAM HELPER ──────────────────────────────────────────────────────── */
function SpamHelperCard() {
  const items = [
    { icon: <Inbox size={13} />, label: "Spam / Junk" },
    { icon: <Tag size={13} />, label: "Promotions" },
    { icon: <Users size={13} />, label: "Social" },
    { icon: <Bell size={13} />, label: "Updates" },
  ];
  return (
    <div className="glass" style={{ padding: "20px 22px", marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10, textAlign: "center" }}>
        Didn't receive the email?
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {items.map((it) => (
          <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "6px 12px" }}>
            {it.icon}{it.label}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text4)", textAlign: "center", marginTop: 12, lineHeight: 1.6 }}>
        Check these folders, then use "Resend Email" above if it's still missing.
      </div>
    </div>
  );
}

/* ─── SECURITY EXPLAINER ───────────────────────────────────────────────── */
function SecurityCard() {
  return (
    <div className="glass" style={{ padding: "18px 22px", marginTop: 12, display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,140,0,0.08)", border: "1px solid rgba(255,140,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Lock size={13} color="#ffb347" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text4)", lineHeight: 1.7 }}>
        Verifying your email confirms this account is really yours, protects your recovery streak and history from being hijacked, and lets us reach you if something urgent needs your attention.
      </div>
    </div>
  );
}

/* ─── SHARED BANNERS / ERROR STATES ────────────────────────────────────── */
function Banner({ tone, icon, children }) {
  const palette = {
    warn: { color: "#ff7777", bg: "rgba(255,60,60,0.07)", border: "rgba(255,60,60,0.2)" },
    success: { color: "#66ffaa", bg: "rgba(60,255,120,0.06)", border: "rgba(60,255,120,0.2)" },
    neutral: { color: "rgba(255,220,180,0.85)", bg: "rgba(255,140,0,0.06)", border: "rgba(255,140,0,0.2)" },
  }[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: palette.color, padding: "10px 14px", background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 8, lineHeight: 1.5, marginBottom: 16 }}>
      {icon}{children}
    </div>
  );
}

function ErrorBanner({ error, onBackToSignIn }) {
  if (error.kind === "deleted") {
    return (
      <Banner tone="warn">
        {error.message}{" "}
        <span onClick={onBackToSignIn} style={{ textDecoration: "underline", cursor: "pointer" }}>Sign up again</span>
      </Banner>
    );
  }
  return <Banner tone="warn">{error.message}</Banner>;
}

function SignedOutCard({ onBackToSignIn }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "80px 24px" }}>
      <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 2, animation: "fadeUp .6s cubic-bezier(.16,1,.3,1)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ marginBottom: 20 }}><NeuralMark size={52} /></div>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 22, fontWeight: 900, color: "#fff" }}>Session Ended</div>
        </div>
        <div className="glass" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text4)", lineHeight: 1.7, marginBottom: 22 }}>
            Please sign in again to continue verifying your email.
          </p>
          <button className="btn-primary" onClick={onBackToSignIn} style={{ width: "100%", padding: 15, fontSize: 13, borderRadius: 12, justifyContent: "center", display: "flex", alignItems: "center", gap: 8 }}>
            Back to Sign In →
          </button>
        </div>
      </div>
    </div>
  );
}