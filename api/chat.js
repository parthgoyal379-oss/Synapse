// api/chat.js — Vercel serverless function
// GROQ_KEY lives here as an env variable, never in the frontend bundle

// ── Verified identity (Firebase Admin) ──────────────────────────────────────
// SECURITY FIX: the frontend used to send a plain `uid` field in the request
// body, which the server trusted blindly for rate-limit bookkeeping. Anyone
// could open DevTools, edit the fetch body, and impersonate any other user's
// uid — trivially bypassing their Free Plan limits or attributing usage to
// someone else. Instead we now require a Firebase ID token (short-lived JWT,
// obtained via `auth.currentUser.getIdToken()` on the client) in the
// Authorization header, and verify it server-side with firebase-admin. The
// uid used for rate limiting always comes from the *verified* token, never
// from anything the client claims in the body.
//
// Requires the `firebase-admin` package and a service account key set as the
// FIREBASE_SERVICE_ACCOUNT env var (JSON string) in Vercel project settings —
// see setup notes below the handler.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

// Returns a verified uid, or null if there's no token / it's invalid or expired.
// Never throws — an invalid token just means "treat as anonymous", same as
// before, so signed-out users can still hit the safety-classifier tier.
async function getVerifiedUid(req) {
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null; // expired/tampered/malformed token — don't trust it
  }
}

// ── Safety-classifier limiter (unchanged) ───────────────────────────────────
// Internal calls the app fires automatically (temp==0, max_tokens<=20) to
// screen every message for crisis language before it ever reaches the coach
// model. These are NOT "chatbot messages" from the user's point of view, so
// they don't count against the Free Plan chat limits below — they get their
// own generous per-IP allowance so they never block a real conversation.
const WINDOW_MS       = 60 * 1000;
const MAX_REQ_SAFETY  = 60;
const ipMap           = new Map(); // { key: { count, resetAt } }

function isRateLimited(key, maxReq) {
  const now   = Date.now();
  const entry = ipMap.get(key);
  if (!entry || now > entry.resetAt) {
    ipMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= maxReq) return true;
  entry.count++;
  return false;
}

// ── Per-user chat rate limiter (Free Plan) ──────────────────────────────────
// 7 messages/minute AND 40 messages/day, per user. Keyed by uid when the
// user is signed in (sent from the frontend on every /api/chat call),
// falling back to IP for anonymous calls (e.g. before sign-in). The daily
// counter resets automatically 24h after a user's first message in that
// window (rolling reset, not tied to a fixed clock time).
//
// NOTE: like the original limiter, this is in-memory — it resets on cold
// start and isn't shared across concurrent serverless instances/regions.
// That's an acceptable tradeoff for blocking runaway free-tier usage; if
// this needs to be airtight across instances, move counts to Firestore/Redis.
const MINUTE_MS       = 60 * 1000;
const DAY_MS          = 24 * 60 * 60 * 1000;
const MAX_PER_MINUTE  = 7;
const MAX_PER_DAY     = 40;
const userMap         = new Map(); // key -> { minute:{count,resetAt}, day:{count,resetAt} }

const UPGRADE_MESSAGE = "You've reached the limits of the Free Plan. Upgrade to a higher plan to continue chatting.";

// Returns null if allowed, or "minute"/"day" naming which limit was hit.
function checkUserLimit(key) {
  const now = Date.now();
  let entry = userMap.get(key);
  if (!entry) {
    entry = { minute: { count: 0, resetAt: now + MINUTE_MS }, day: { count: 0, resetAt: now + DAY_MS } };
    userMap.set(key, entry);
  }
  if (now > entry.minute.resetAt) entry.minute = { count: 0, resetAt: now + MINUTE_MS };
  if (now > entry.day.resetAt)    entry.day    = { count: 0, resetAt: now + DAY_MS };

  if (entry.minute.count >= MAX_PER_MINUTE) return "minute";
  if (entry.day.count >= MAX_PER_DAY) return "day";

  entry.minute.count++;
  entry.day.count++;
  return null;
}

// Clean up old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipMap.entries()) {
    if (now > entry.resetAt) ipMap.delete(key);
  }
  for (const [key, entry] of userMap.entries()) {
    if (now > entry.minute.resetAt && now > entry.day.resetAt) userMap.delete(key);
  }
}, 5 * 60 * 1000);

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get real IP (Vercel sets x-forwarded-for)
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const body = req.body || {};

  // Verify identity server-side — never trust a client-supplied uid.
  const verifiedUid = await getVerifiedUid(req);

  // Detect safety classifier call: temp==0, max_tokens<=20
  const isSafetyCall =
    body.temperature === 0 && body.max_tokens <= 20;

  if (isSafetyCall) {
    // Safety calls keep the old lenient per-IP tier, untouched by the
    // Free Plan chat limits.
    if (isRateLimited(`${ip}:safety`, MAX_REQ_SAFETY)) {
      return res.status(429).json({
        error: { message: "Safety check rate limited — try again shortly." },
      });
    }
  } else {
    // Real chatbot messages — Free Plan limits apply here.
    // Keyed by the *verified* uid when signed in; anonymous requests fall
    // back to IP. A spoofed body.uid can no longer affect this.
    const userKey = verifiedUid ? `uid:${verifiedUid}` : `ip:${ip}`;
    const hitLimit = checkUserLimit(userKey);
    if (hitLimit) {
      return res.status(429).json({
        error: {
          code: "PLAN_LIMIT_REACHED",
          limitType: hitLimit, // "minute" | "day"
          message: UPGRADE_MESSAGE,
        },
      });
    }
  }

  // Block empty or malformed requests
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  // Hard cap on max_tokens to prevent runaway costs
  if (body.max_tokens > 2048) {
    body.max_tokens = 2048;
  }

  // uid is our own bookkeeping field — Groq doesn't know about it.
  const { uid, ...groqBody } = body;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_KEY}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", details: err.message });
  }
}