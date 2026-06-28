// api/chat.js — Vercel serverless function
// GROQ_KEY lives here as an env variable, never in the frontend bundle

// ── In-memory rate limiter ─────────────────────────────────────────────────
// Two tiers:
//   - Safety classifier calls (max_tokens<=20, temp==0): 60 req/min — very lenient
//   - All other calls: 10 req/min per IP — blocks scrapers, allows real users
const WINDOW_MS        = 60 * 1000;
const MAX_REQ_NORMAL   = 10;
const MAX_REQ_SAFETY   = 60;
const ipMap            = new Map(); // { key: { count, resetAt } }

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

// Clean up old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipMap.entries()) {
    if (now > entry.resetAt) ipMap.delete(key);
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

  // Detect safety classifier call: temp==0, max_tokens<=20
  const isSafetyCall =
    body.temperature === 0 && body.max_tokens <= 20;

  // Rate limit key — use IP (uid not available server-side without auth token)
  const limitKey    = `${ip}:${isSafetyCall ? "safety" : "normal"}`;
  const maxReq      = isSafetyCall ? MAX_REQ_SAFETY : MAX_REQ_NORMAL;

  if (isRateLimited(limitKey, maxReq)) {
    return res.status(429).json({
      error: isSafetyCall
        ? "Safety check rate limited — try again shortly."
        : "Too many requests. Wait a minute and try again.",
    });
  }

  // Block empty or malformed requests
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  // Hard cap on max_tokens to prevent runaway costs
  if (body.max_tokens > 2048) {
    body.max_tokens = 2048;
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", details: err.message });
  }
}