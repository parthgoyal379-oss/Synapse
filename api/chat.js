// api/chat.js — Vercel serverless function
// GROQ_KEY lives here as an env variable, never in the frontend bundle

// ── Simple in-memory rate limiter ─────────────────────────────────────────
// 10 requests per IP per 60 seconds — enough for real users, blocks scrapers
const WINDOW_MS = 60 * 1000;
const MAX_REQ   = 10;
const ipMap     = new Map(); // { ip: { count, resetAt } }

function isRateLimited(ip) {
  const now  = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= MAX_REQ) return true;
  entry.count++;
  return false;
}

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

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Too many requests. Wait a minute and try again.",
    });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_KEY}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", details: err.message });
  }
}