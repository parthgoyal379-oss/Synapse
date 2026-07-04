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
// Requires no extra package — verifies the Firebase ID token via Google's
// Identity Toolkit REST API instead of the `firebase-admin` SDK.
//
// WHY: `firebase-admin`'s modular imports (`firebase-admin/app`,
// `firebase-admin/auth`) kept crashing on Vercel's actual build with
// ERR_REQUIRE_ESM, even though the exact same code, bundled locally with
// @vercel/ncc (the real bundler Vercel uses) and executed directly,
// worked fine every time — something about Vercel's live build pipeline
// differs in a way that wasn't reproducible locally. Rather than keep
// guessing at firebase-admin's bundling, this drops the SDK for this one
// call and hits the REST endpoint directly with plain fetch(), which has
// zero bundling surface area and can't hit this class of error at all.
//
// Uses the same public Firebase Web API key already set as
// VITE_FIREBASE_API_KEY (safe to reuse server-side — it's a public,
// non-secret key by design; Firebase's security model relies on
// server-side Security Rules, not on this key being hidden).
const FIREBASE_WEB_API_KEY = process.env.VITE_FIREBASE_API_KEY;

// Returns a verified uid, or null if there's no token / it's invalid or expired.
// Never throws — an invalid token just means "treat as anonymous", same as
// before, so signed-out users can still hit the safety-classifier tier.
async function getVerifiedUid(req) {
  if (!FIREBASE_WEB_API_KEY) return null;
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!r.ok) return null; // expired/tampered/malformed token — don't trust it
    const data = await r.json();
    return data?.users?.[0]?.localId || null;
  } catch {
    return null; // network error or unexpected response shape
  }
}

// ── Safety-classifier limiter ────────────────────────────────────────────────
// Internal calls the app fires automatically to screen every message for
// crisis language before it ever reaches the coach model. These are NOT
// "chatbot messages" from the user's point of view, so they don't count
// against the Free Plan chat limits below — they get their own generous
// per-IP allowance so they never block a real conversation.
//
// SECURITY FIX: `isSafetyCall` used to be decided purely from client-supplied
// `temperature`/`max_tokens` fields. Anyone could set temperature:0 and
// max_tokens:30 on a request carrying a real conversation and get routed
// into the lenient 60/min safety tier instead of the 7/min Free Plan tier —
// an easy rate-limit bypass. Now, whenever a request claims to be a safety
// call, the server ignores whatever `messages`/system-prompt the client sent
// and rebuilds the Groq request itself from a fixed, server-owned system
// prompt plus only the extracted user text — so spoofing the tier gains an
// attacker nothing but the real classifier's own (tiny, fixed-shape) output.
const SAFETY_SYSTEM_PROMPT = `You are a mental health safety classifier. Analyze the user message for indirect or subtle signs of suicidal ideation, self-harm intent, or severe hopelessness — including phrases like "everyone would be better off without me", "I don't see the point anymore", "I can't do this anymore", "I just want it to stop", "nobody would miss me", or similar indirect language. Respond with ONLY compact JSON, no whitespace, no markdown, no explanation: {"risk":true} or {"risk":false}`;

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

  // Tier is still *signaled* by temp==0 && max_tokens<=30, but that signal
  // is no longer trusted for content — see SECURITY FIX above. If it's
  // wrong, the worst case is a real chat message gets the safety tier's
  // rate limit, but the actual model call below is always rebuilt from
  // scratch for that branch, so there's nothing to gain by lying about it.
  const isSafetyCall =
    body.temperature === 0 && body.max_tokens <= 30;

  if (isSafetyCall) {
    // Safety calls keep the old lenient per-IP tier, untouched by the
    // Free Plan chat limits.
    if (isRateLimited(`${ip}:safety`, MAX_REQ_SAFETY)) {
      return res.status(429).json({
        error: { message: "Safety check rate limited — try again shortly." },
      });
    }

    // Pull out only the raw text the client wants classified — a single
    // user-role message's string content. Everything else the client sent
    // (fake system prompts, extra messages, a different model, etc.) is
    // discarded. The Groq request is rebuilt entirely server-side so
    // claiming "I'm a safety call" never buys an attacker a real chat
    // completion, only ever the classifier's own tiny fixed-shape output.
    const userText = Array.isArray(body.messages)
      ? body.messages.find(m => m?.role === "user")?.content
      : null;

    if (typeof userText !== "string" || !userText.trim()) {
      return res.status(400).json({ error: "Invalid request body." });
    }

    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          reasoning_effort: "low", // fast structured JSON classification, not deep reasoning
          temperature: 0,
          max_tokens: 30,
          messages: [
            { role: "system", content: SAFETY_SYSTEM_PROMPT },
            { role: "user", content: userText.slice(0, 4000) }, // cap input size too
          ],
        }),
      });
      const data = await groqRes.json();
      return res.status(groqRes.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: "Proxy error", details: err.message });
    }
  }

  // ── Real chatbot messages from here on — Free Plan limits apply. ──────────
  {
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
  // include_reasoning:false stops GPT-OSS from sending its reasoning trace
  // in the response — saves bandwidth + cost since SYNAPSE only needs the
  // final message content, not the internal chain-of-thought.
  const { uid, ...groqBody } = body;
  if (groqBody.model?.startsWith("openai/gpt-oss")) {
    groqBody.include_reasoning = false;
  }

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