import { useState, useEffect } from "react";
import { auth } from "./firebase";
import { sendEmailVerification, reload } from "firebase/auth";
import { NeuralMark } from "./App";

const RESEND_COOLDOWN = 60;

function mapVerifyError(code) {
  switch (code) {
    case "auth/network-request-failed":
      return "Network error — check your connection and try again.";
    case "auth/user-token-expired":
    case "auth/user-not-found":
      return "This account no longer exists. Please sign up again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/too-many-requests":
      return "Too many attempts — please wait a moment and try again.";
    case "auth/requires-recent-login":
      return "Please sign in again to continue.";
    default:
      return "Something went wrong. Please try again.";
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
  const [checking, setChecking] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendState, setResendState] = useState("idle"); // idle | sending | sent | error
  const [resendError, setResendError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const hasSession = !!auth.currentUser;

  // Optimistic silent check on mount — if they already clicked the link in
  // another tab and came back here, don't make them click a button to find
  // out. Failure here is silent; the manual "I've Verified" button below
  // is always available as the explicit fallback.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    (async () => {
      try {
        await reload(user);
        if (user.emailVerified) onVerified(user);
      } catch {
        // ignore — manual check below still works
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleCheckVerified() {
    setVerifyError("");
    const user = auth.currentUser;
    if (!user) {
      setVerifyError("You're signed out — please sign in again to continue.");
      return;
    }
    setChecking(true);
    try {
      await reload(user);
      if (user.emailVerified) {
        onVerified(user);
      } else {
        setVerifyError("Your email is still not verified.");
      }
    } catch (e) {
      console.error("Verification check failed:", e.code, e.message);
      setVerifyError(mapVerifyError(e.code));
    } finally {
      setChecking(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    const user = auth.currentUser;
    if (!user) {
      setResendError("You're signed out — please sign in again to resend.");
      return;
    }
    setResendState("sending");
    setResendError("");
    try {
      await sendEmailVerification(user);
      setResendState("sent");
      setCooldown(RESEND_COOLDOWN);
      setTimeout(() => setResendState("idle"), 4000);
    } catch (e) {
      console.error("Resend failed:", e.code, e.message);
      setResendState("error");
      setResendError(mapVerifyError(e.code));
      // Firebase's own rate limit is the real backstop — if it rejects us,
      // keep the client-side cooldown in sync instead of letting the
      // button go tappable again immediately.
      if (e.code === "auth/too-many-requests") setCooldown(RESEND_COOLDOWN);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "80px 24px" }}>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, background: "radial-gradient(circle,rgba(255,100,0,0.07) 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 2 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 20 }}>
            <NeuralMark size={52} />
          </div>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 26, fontWeight: 900, letterSpacing: -1, background: "linear-gradient(145deg,#fff 30%,rgba(255,180,80,.75) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 8 }}>
            VERIFY YOUR EMAIL
          </div>
          <div style={{ fontSize: 12, color: "var(--text4)", letterSpacing: 2, textTransform: "uppercase" }}>
            {reason === "login" ? "One more step before you log in" : "One more step to initialize your protocol"}
          </div>
        </div>

        <div className="glass" style={{ padding: 36 }}>
          <div style={{ textAlign: "center", fontSize: 34, marginBottom: 14 }}>📩</div>

          {reason === "login" && (
            <div style={{ fontSize: 13, color: "#ff7777", padding: "10px 14px", background: "rgba(255,60,60,0.07)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 8, lineHeight: 1.5, marginBottom: 18, textAlign: "center" }}>
              Please verify your email before logging in.
            </div>
          )}

          <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, textAlign: "center", marginBottom: 4 }}>
            We've sent a verification email to
          </p>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#ffb347", textAlign: "center", marginBottom: 22, wordBreak: "break-word" }}>
            {email}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text4)", textAlign: "center", lineHeight: 1.7, marginBottom: 24 }}>
            Please verify your email before continuing.
          </p>

          {verifyError && (
            <div style={{ fontSize: 12, color: "#ff7777", padding: "10px 14px", background: "rgba(255,60,60,0.07)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 8, lineHeight: 1.5, marginBottom: 16 }}>
              {verifyError}
            </div>
          )}
          {resendState === "sent" && (
            <div style={{ fontSize: 12, color: "#66ffaa", padding: "10px 14px", background: "rgba(60,255,120,0.06)", border: "1px solid rgba(60,255,120,0.2)", borderRadius: 8, marginBottom: 16 }}>
              ✓ Verification email sent — check your inbox.
            </div>
          )}
          {resendError && (
            <div style={{ fontSize: 12, color: "#ff7777", padding: "10px 14px", background: "rgba(255,60,60,0.07)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 8, lineHeight: 1.5, marginBottom: 16 }}>
              {resendError}
            </div>
          )}

          {hasSession ? (
            <>
              <button className="btn-primary" onClick={handleCheckVerified} disabled={checking} style={{ width: "100%", padding: "15px", fontSize: 13, borderRadius: 12, justifyContent: "center", display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                {checking ? (
                  <span style={{ display: "flex", gap: 4 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff", animation: `dotBlink 1s ${i * 0.18}s infinite` }} />)}</span>
                ) : "I've Verified →"}
              </button>
              <button
                onClick={handleResend}
                disabled={cooldown > 0 || resendState === "sending"}
                style={{ width: "100%", padding: "14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: cooldown > 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500, cursor: cooldown > 0 ? "default" : "pointer", transition: "all .25s" }}
              >
                {resendState === "sending" ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Email"}
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={onBackToSignIn} style={{ width: "100%", padding: "15px", fontSize: 13, borderRadius: 12, justifyContent: "center", display: "flex", alignItems: "center", gap: 8 }}>
              Back to Sign In →
            </button>
          )}

          <p style={{ textAlign: "center", fontSize: 11, color: "var(--text4)", marginTop: 20, lineHeight: 1.9, letterSpacing: 0.2 }}>
            Wrong email or need to start over?{" "}
            <span onClick={onBackToSignIn} style={{ color: "rgba(255,180,80,0.6)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
              Back to sign in
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
