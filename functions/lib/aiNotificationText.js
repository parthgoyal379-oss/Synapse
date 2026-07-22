const { highRiskFallback } = require("./messageGenerator");

/**
 * getHighRiskText(uid, user, todayKey, db) -> Promise<string>
 *
 * The ONLY AI call in the entire notification engine — used purely for
 * TEXT, never for deciding whether/when to send (that's eligibility.js +
 * highRiskReminder.js's own deterministic trigger conditions).
 *
 * Reuses the exact same AI provider/model the app's real chat already uses
 * (api/chat.js -> Groq "openai/gpt-oss-120b") instead of a separate
 * pipeline. Requires the GROQ_KEY secret to be configured for this Cloud
 * Function (see deployment notes) — if it's missing or the call fails for
 * any reason, this falls back to messageGenerator's handcrafted per-tone
 * line and caches that instead, so a notification is never blocked on AI
 * availability.
 *
 * Cached at users/{uid}.notifications.aiCache.highRisk = {date, text} —
 * checked BEFORE calling AI, so a user can never get billed/generated for
 * more than one highRisk line per local day, no matter how many times this
 * function fires that day.
 */
async function getHighRiskText(uid, user, todayKey, db) {
  const cache = user.notifications?.aiCache?.highRisk;
  if (cache && cache.date === todayKey && cache.text) return cache.text; // never regenerate same day

  const tone = user.tone || "commander";
  let text = null;

  const groqKey = process.env.GROQ_KEY;
  if (groqKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0.9,
          max_tokens: 60,
          include_reasoning: false,
          messages: [
            {
              role: "system",
              content: `You are SYNAPSE — an AI recovery coach sending a push notification to a user showing signs of a high-risk moment (recent slip, very low streak, or multiple urges logged today). Write ONE short, powerful, personal line — under 20 words, plain text, no quotes, no markdown — that meets them where they are without being alarmist. Tone: ${tone === "warlord" ? "blunt, no-excuses, tough-love" : tone === "operator" ? "calm, steady, reassuring" : "direct, mission-focused"}.`,
            },
            { role: "user", content: "Write the notification line now." },
          ],
        }),
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content?.trim();
        if (raw) text = raw.replace(/^["“”]+|["“”]+$/g, "").replace(/\s+/g, " ").trim();
      }
    } catch (e) {
      console.warn(`getHighRiskText AI call failed for ${uid}:`, e.message);
    }
  }

  if (!text) text = highRiskFallback(tone); // AI unavailable/failed — handcrafted, still tone-aware

  // Cache regardless of source (AI or fallback) — "cached per day" applies
  // to whatever text was actually shown, not just successful AI calls.
  await db.collection("users").doc(uid).set(
    { notifications: { aiCache: { highRisk: { date: todayKey, text } } } },
    { merge: true }
  );

  return text;
}

module.exports = { getHighRiskText };
