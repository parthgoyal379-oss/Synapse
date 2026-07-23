import { auth } from "./firebase";

export class RateLimitError extends Error {
  constructor(message, limitType) {
    super(message);
    this.isRateLimit = true;
    this.limitType = limitType; // "minute" | "day"
  }
}

/**
 * callAI(userMessages, systemPrompt, opts) — the ONE place any part of
 * SYNAPSE (Command Mode, Focus Mode, or the shared Recovery Engine) talks
 * to the AI backend. Moved out of App.jsx so it isn't redefined per
 * consumer — everything imports this same function, same endpoint, same
 * model, same timeout/rate-limit handling.
 */
export async function callAI(userMessages, systemPrompt, opts = {}) {
  // Send a short-lived Firebase ID token so the server can verify identity
  // itself (see api/chat.js) instead of trusting a client-claimed uid.
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  // Abort the request if the serverless function doesn't respond in time —
  // otherwise a slow/dead connection leaves fetch pending forever.
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.85,
        messages: [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out — check your connection and try again.", { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (res.status === 429) {
    if (data.error?.code === "PLAN_LIMIT_REACHED") {
      throw new RateLimitError(data.error.message, data.error.limitType);
    }
    throw new Error(data.error?.message || "Too many requests — wait a minute and try again.");
  }
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "Keep going. You showed up today — that's the mission.";
}
