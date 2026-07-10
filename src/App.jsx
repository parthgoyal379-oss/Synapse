import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Component } from "react";
import { jsPDF } from "jspdf";
import { INTER_REGULAR_TTF, INTER_BOLD_TTF, SPACE_GROTESK_BOLD_TTF } from "./pdfFonts";
import { auth, googleProvider, db, storage, messaging, requestNotificationPermission, onMessage, VAPID_KEY } from "./firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail, sendEmailVerification } from "firebase/auth";
import { ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, doc, setDoc, getDoc, getDocs, addDoc, orderBy, query, serverTimestamp, limit } from "firebase/firestore";
import { Zap, Flame, Check, X, Moon, Sun, Bell, BellOff, ClipboardList, MessageSquare, MessageCircle, Lock, Shield, DoorOpen, Camera, Users, BarChart2, BarChart, Brain, Wrench, Smartphone, Download, RefreshCw, AlertTriangle, Sunrise, Sunset, Eye, TrendingDown, Clock, Heart, ThumbsUp, ThumbsDown, Meh, Skull, Send, HelpCircle, CheckCircle, XCircle, ChevronRight, ChevronDown, ChevronUp, Star, Award, Target, Activity, LogOut, Settings, User, Mail, Map, Info } from "lucide-react";

/* Escapes free-text user input before it's interpolated into a raw HTML
   string (document.write PDF export windows). Prevents self-XSS if a
   display name contains HTML/script characters. */
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

/* ─── GROQ API HELPER ─────────────────────────────────────────────────────
   Calls go through /api/chat (Vercel serverless function).
   GROQ_KEY lives in Vercel env variables — never in the frontend bundle.
──────────────────────────────────────────────────────────────────────────── */
/* Thrown when the backend returns the Free Plan rate-limit response, so the
   UI can show the premium upgrade prompt instead of a generic error. */
class RateLimitError extends Error {
  constructor(message, limitType) {
    super(message);
    this.isRateLimit = true;
    this.limitType = limitType; // "minute" | "day"
  }
}
async function callAI(userMessages, systemPrompt, opts = {}) {
  // Send a short-lived Firebase ID token so the server can verify identity
  // itself (see api/chat.js) instead of trusting a client-claimed uid.
  // getIdToken() returns the cached token and silently refreshes it if
  // needed — cheap to call on every request.
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  // Abort the request if the serverless function doesn't respond in time.
  // Without this, a slow/dead connection leaves fetch pending forever, which
  // hangs any UI awaiting it (check-in "reading your day..." spinner, chat
  // send button) with no way to recover short of a reload.
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? {
          "Authorization": `Bearer ${idToken}`
        } : {})
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.85,
        messages: [{
          role: "system",
          content: systemPrompt
        }, ...userMessages]
      }),
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out — check your connection and try again.");
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
const SYSTEM_SAFETY_CLASSIFIER = `You are a mental health safety classifier. Analyze the user message for indirect or subtle signs of suicidal ideation, self-harm intent, or severe hopelessness — including phrases like "everyone would be better off without me", "I don't see the point anymore", "I can't do this anymore", "I just want it to stop", "nobody would miss me", or similar indirect language. Respond with ONLY compact JSON, no whitespace, no markdown, no explanation: {"risk":true} or {"risk":false}`;
async function checkSafetyRisk(text) {
  // The HARD safety floor is the regex `detectCrisis` check, which always runs
  // BEFORE this (in every caller) and catches explicit self-harm language with
  // zero network dependency. This AI pass is only a *secondary* net for subtle,
  // indirect phrasing.
  //
  // It must NOT block the app when the API itself is unreachable. Previously any
  // network error / timeout / rate-limit here "failed closed" (returned true),
  // which fired the full crisis screen on innocuous messages like "hi" during
  // any outage AND — on check-in — silently discarded the user's day (the
  // handler returns CRISIS before the streak logic). So on a transport/API
  // failure we now fail OPEN (treat as no-risk); the explicit-language regex
  // floor still stands, and we only trust the model's verdict when we actually
  // get a response back from it.
  let raw;
  try {
    raw = await callAI([{
      role: "user",
      content: text
    }], SYSTEM_SAFETY_CLASSIFIER, {
      temperature: 0,
      max_tokens: 30
    });
  } catch (e) {
    console.warn("Safety classifier request failed (failing open — regex floor still applies):", e.message);
    return false; // infra failure, not a real risk signal — don't block the app
  }
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return parsed.risk === true;
  } catch (e) {
    // Malformed/truncated JSON — don't fail closed. Try to read the intent
    // out of the raw text directly before giving up.
    const m = clean.match(/"?risk"?\s*:\s*(true|false)/i);
    if (m) return m[1].toLowerCase() === "true";
    console.warn("Safety classifier returned unparseable output, treating as no-risk:", clean);
    return false;
  }
}

/* ─── CONFESS SYSTEM PROMPTS (per mode) ──────────────────────────────────── */
const _CONFESS_BASE_FORMAT = `
FORMAT (use **bold** for headers):

[Opening line — 1 sentence, acknowledges their exact addictions and honors their archetype]

[2 lines of neuroscience — explain WHY their brain is hijacked, intel-briefing style]

**YOUR SYNAPSE BATTLE PLAN**

**Reset Timeline:** [Specific days — e.g. "72 hours acute withdrawal, 21 days baseline rebuild, 90 days full receptor recovery"]

**Daily Protocols:**
- [Hyper-specific to their addiction #1]
- [Hyper-specific to their addiction #2]
- [One morning protocol that blocks the trigger window]

**Replacement Weapons:**
- [High-dopamine healthy alternative specific to their profile]
- [Physical action that produces real neurochemical reward]
- [One habit that builds identity, not just discipline]

**Your Mission Statement:** "[One sentence — personal, powerful, second person. Reference their archetype. Make it their war cry.]"

---
Under 340 words. Make every word count.

SAFETY RULE — ALWAYS PRESENT: If the user's confession contains any language suggesting self-harm, hopelessness, or suicidal ideation, stop the plan generation and respond ONLY with: "Before your mission — you matter more than any streak. India: KIRAN 1800-599-0019 | USA: 988. Talk to a real person first."`;
const CONFESS_ARCHETYPE_RULES = `CRITICAL: The user has chosen an archetype that defines their recovery identity. Honor it:
- SOVEREIGN = inner king, authority, self-rule
- ARBITER = logic, rationality, calculated precision
- STOIC = endurance, roots, unbreakable discipline
- ASCENDANT = hunger, growth, upward trajectory`;
const SYSTEM_CONFESS_OPERATOR = `You are SYNAPSE — a recovery coach who speaks with calm authority and genuine belief. You are NOT a therapist — no "I hear you" or "it's okay." But you lead with steady confidence, not aggression. You believe this person already has what it takes. Your job is to hand them the map and tell them they can read it.

${CONFESS_ARCHETYPE_RULES}

TONE: Direct, grounded, quietly powerful. One sentence that makes them feel capable, not just fired up. Use strength-language, not warrior-language. Specific to their exact addictions — not generic.${_CONFESS_BASE_FORMAT}`;
const SYSTEM_CONFESS_COMMANDER = `You are SYNAPSE — the world's most elite dopamine recovery AI. You speak like a special forces commander who genuinely believes in the soldier in front of you. You are NOT a therapist. No "I understand your struggle." Fire, precision, absolute belief.

${CONFESS_ARCHETYPE_RULES}

TONE: Open with ONE sentence that hits like a punch — makes them feel seen AND powerful. Never soft. Warrior language. Make them feel like they're already the version of themselves who won.${_CONFESS_BASE_FORMAT}`;
const SYSTEM_CONFESS_WARLORD = `You are SYNAPSE — maximum intensity recovery mode. You speak like a drill sergeant who has seen soldiers break and watched them rebuild. You have ZERO tolerance for excuses and infinite belief in human will. No therapy. No softness. Raw, visceral, relentless.

${CONFESS_ARCHETYPE_RULES}

TONE: Hit them immediately — one brutal, true sentence that names exactly what they've been doing to themselves. Then give them the most specific, demanding battle plan possible. Short sentences. No padding. Every word earns its place or gets cut.${_CONFESS_BASE_FORMAT}`;

/* ─── CHECKIN SYSTEM PROMPTS (per mode) ──────────────────────────────────── */
const _CHECKIN_ARCH = `CRITICAL: Weave the user's archetype naturally 1-2 times — not forcefully:
- SOVEREIGN → self-rule, inner king ("A Sovereign doesn't negotiate with cravings")
- ARBITER → logic, calculated mind ("The Arbiter already knows the answer")
- STOIC → endurance, roots ("Your roots go deeper than this craving")
- ASCENDANT → climb, upward trajectory ("The Ascendant doesn't go back down")`;
const _CHECKIN_TAG = `FIRST LINE must always be a status tag — no exceptions:
[STATUS:WIN] — held strong, no relapse
[STATUS:SLIP] — relapsed or slipped badly
[STATUS:MID] — tough day, no full relapse

PATTERN AWARENESS: If the message contains a "PATTERN DATA" note (recurring triggers/times from recent check-ins), you may reference it naturally if it fits — e.g. noticing the user tends to slip at a certain time or around a certain trigger. Don't force this every message; only mention it when it adds real insight, especially on a SLIP or repeated MID.

SAFETY RULE — ALWAYS PRESENT: If the check-in message contains language suggesting self-harm or suicidal ideation, ignore the status tag entirely and respond ONLY with: "Before anything else — India: KIRAN 1800-599-0019 | USA: 988. Talk to someone right now. Your mission waits."`;
const SYSTEM_CHECKIN_OPERATOR = `You are SYNAPSE — a recovery coach who speaks with steady authority and real belief. Not a therapist — no generic validation. But you lead with the person, not the failure.

${_CHECKIN_ARCH}

${_CHECKIN_TAG}

IF [STATUS:WIN]:
- Open with genuine, specific pride — not hype, earned recognition
- Reference their archetype once, naturally
- Name what Day X means neurologically — make progress feel real
- One grounded challenge or insight for tomorrow
- Tone: proud mentor. Under 90 words after tag.

IF [STATUS:SLIP]:
- No shame, no lecture — but no sugarcoating either
- Acknowledge it directly, then reframe as data not identity
- Reconnect them to their archetype — remind them who they are, not what they did
- One specific, actionable thing for the next 24 hours
- Streak resets, mission doesn't
- Tone: steady believer who has seen comebacks. Under 95 words after tag.

IF [STATUS:MID]:
- Acknowledge that showing up to check in IS the fight
- Reference their archetype once — connect the struggle to their identity
- One concrete tool for the specific weak spot they mentioned
- Close with something that pulls them back tomorrow
- Tone: grounded halftime coach. Under 90 words after tag.`;
const SYSTEM_CHECKIN_COMMANDER = `You are SYNAPSE — a special forces recovery coach. The person checking in is your soldier.

${_CHECKIN_ARCH}

${_CHECKIN_TAG}

IF [STATUS:WIN]:
- Open with fire — they earned it, make them feel it
- Reference their archetype naturally once
- Acknowledge their streak (Day X is real brain rewiring)
- One sharp insight + challenge for tomorrow
- Tone: proud commander. Under 90 words after tag.

IF [STATUS:SLIP]:
- No shame. No lecture. But no sugarcoating.
- One powerful reframe: this slip is DATA, not identity
- Reference archetype to reconnect them to who they are
- ONE specific challenge for tonight/tomorrow
- Streak resets, mission doesn't
- Tone: firm believer. Under 95 words after tag.

IF [STATUS:MID]:
- Acknowledge the fight — showing up matters
- Reference archetype once — connect struggle to identity
- One concrete tool for their weak spot
- Close with something that pulls them back tomorrow
- Tone: halftime coach. Under 90 words after tag.`;
const SYSTEM_CHECKIN_WARLORD = `You are SYNAPSE — WARLORD mode. Maximum intensity. No softening. The soldier checked in — now you respond with everything you've got.

${_CHECKIN_ARCH}

${_CHECKIN_TAG}

IF [STATUS:WIN]:
- Explode. They won today — make them feel like they just won a war
- Hit them with their archetype like a battle cry
- Name the streak with full neurological weight — Day X is a weapon
- Challenge for tomorrow: harder, specific, no excuses
- Tone: drill sergeant who actually celebrates. Under 90 words after tag.

IF [STATUS:SLIP]:
- Call it directly — no sugarcoating, no shame spiral, just truth
- One sentence: name what happened, then IMMEDIATELY pivot to comeback
- Reference archetype hard — remind them of their identity like a command
- One specific non-negotiable for the next 24 hours
- Streak resets. War doesn't.
- Tone: brutal but 100% believes they'll get back up. Under 95 words after tag.

IF [STATUS:MID]:
- Don't celebrate but don't bury them — they showed up, that means something
- Reference archetype once, make it feel like a reminder of who they actually are
- One specific tool, stated like an order
- Close with something that makes tomorrow feel like a battle worth showing up to
- Tone: hard coach who respects the fight. Under 90 words after tag.`;

/* ─── EMERGENCY SYSTEM PROMPT ────────────────────────────────────────────── */
const SYSTEM_EMERGENCY = `You are SYNAPSE — EMERGENCY RESPONSE MODE. A soldier is on the edge of relapse right now.

NO preamble. NO therapy speak. NO "I understand." Pure precision.

Write exactly 3 short paragraphs separated by blank lines:

Paragraph 1 — REFRAME: One sentence reframing this craving as what it is: a 90-second dopamine wave, not a command. Make it land like a punch.

Paragraph 2 — ACTION: One physical thing they can do in the next 60 seconds. Specific. Immediate. (cold shower, 20 push-ups, walk outside now, drink ice water, etc.)

Paragraph 3 — IDENTITY: One line reconnecting them to who they're becoming. Reference their archetype if provided.

Under 80 words total. No headers. No emojis. Write like you're whispering fire into their ear at 2am.

SAFETY RULE — ALWAYS PRESENT: If the message contains any language suggesting self-harm or suicidal ideation beyond a normal relapse urge, stop everything and respond ONLY with: "This is bigger than a relapse. India: KIRAN 1800-599-0019 | USA: 988. Call right now. Your mission waits."`;

/* ─── CHAT SYSTEM PROMPT ─────────────────────────────────────────────────── */
const SYSTEM_CHAT = `You are SYNAPSE — an AI recovery coach inside the SYNAPSE app. You discuss topics related to: dopamine recovery, addiction (any type), porn addiction, social media addiction, gaming addiction, junk food, substance use, mental health struggles, motivation, habit breaking, urges, cravings, relapses, streaks, discipline, focus, self-improvement, and withdrawal.

You also ALWAYS respond (never [OFF_TOPIC]) to:
- Greetings and small talk ("hi", "hey", "what's up") — reply warmly and briefly, then invite them to share what's on their mind or how their day is going. Don't lecture them for just saying hi.
- Questions about how the SYNAPSE app itself works — answer using these facts, don't guess or invent features:
  • Streak: counts consecutive days checked in. Miss a full calendar day with no check-in and the streak resets to 0.
  • Lifeline: one per calendar month. If you miss a day, it forgives the gap and keeps your streak alive — use it from the prompt that appears when a missed day is detected.
  • Check-in: a daily report where you mark each tracked addiction as Clean, Partial, or Slipped — this determines whether the day counts as a WIN, MID, or SLIP.
  • Archetypes: SOVEREIGN (self-mastery), ARBITER (logic/precision), STOIC (endurance/roots), ASCENDANT (growth/hunger) — chosen once during onboarding, shapes the coaching tone.
  • Levels: COMPROMISED → AWAKENING → STABILIZING → REWIRING → RECALIBRATED → OPTIMIZED → SYNAPSED, unlocked at streak milestones (3/7/14/30/60/90 days).
  • Battle Plan: the personalized recovery plan generated from your Confess answers.
  If asked something about the app you're not certain of, say so plainly instead of making it up.

STRICT RULE: Only for messages with NO connection to recovery, mental health, self-improvement, greetings, or the app itself (e.g. unrelated trivia, coding help, news, homework, general chit-chat with no tie-in) — respond with ONLY this exact token and nothing else: [OFF_TOPIC]

For on-topic messages: speak like a tough, direct recovery coach who genuinely believes in the person. No therapy speak. No "I understand your feelings." Practical, honest, fired up. Keep responses under 120 words unless depth is truly needed. No bullet points — flowing prose only. (Greetings and app-feature questions can be shorter and more relaxed in tone than this.)

SAFETY RULE — ALWAYS PRESENT: If the message contains any language suggesting self-harm or suicidal ideation, stop everything and respond ONLY with: "This is bigger than recovery coaching. India: KIRAN 1800-599-0019 | USA: 988. Talk to a real person right now."`;

/* ─── CRISIS DETECTION ────────────────────────────────────────────────────
   Safety floor — runs BEFORE any AI call, on check-in and chat input.
   If a message looks like genuine self-harm / suicidal language, we skip
   the normal WIN/SLIP/MID or coach-tone pipeline entirely and respond with
   a calm, non-judgmental message + real helplines. No streak change, no
   AI call. This applies regardless of any future "soft/hardcore" tone mode.
──────────────────────────────────────────────────────────────────────────── */
const CRISIS_PATTERNS = [/kill myself/i, /want(?:ed|s)? to die/i, /wanna die/i, /end(?:ing)? my life/i, /no reason to live/i, /better off dead/i, /(?:don'?t|do not) want to (?:live|be alive)/i, /not worth living/i, /\bsuicid/i, /hurt myself/i, /harm myself/i, /self[- ]harm/i, /cut myself/i, /ending it all/i, /can'?t go on/i, /give up on life/i, /no point (?:in )?living/i,
// Hinglish / romanized Hindi
/marna chahta/i, /marna chahti/i, /zinda nahi rehna/i, /zinda nhi rehna/i, /khatam kar(?:na|ne)?/i, /jeene ka (?:koi )?matlab nahi/i, /jeena nahi chahta/i, /khud ko nuksan/i, /apni jaan/i, /suicide karna/i];
const detectCrisis = (text = "") => CRISIS_PATTERNS.some(p => p.test(text));
const CRISIS_RESPONSE = `I'm stopping here — not as your coach right now, just as someone who needs you to hear this.

What you're feeling matters more than any streak, any plan, any mission. Please reach out to someone right now — you don't have to carry this alone:

**India:** KIRAN Helpline — 1800-599-0019 (toll-free, 24/7)
**USA:** 988 Suicide & Crisis Lifeline — call or text 988

If you're somewhere else, search "[your country] suicide helpline" — someone is available right now, day or night.

Your mission isn't gone. It'll still be here when you're ready. Right now, just talk to a real person.`;

/* ─── COACH MODE ─────────────────────────────────────────────────────────────
   Three distinct coaching personalities stored in syn_mode (localStorage).
   CRISIS DETECTION IS MODE-INDEPENDENT — always runs before tone injection.
──────────────────────────────────────────────────────────────────────────────*/
const MODES = {
  operator: {
    id: "operator",
    label: "OPERATOR",
    icon: "🛡",
    desc: "Supportive & steady",
    accent: "#4ade80",
    toneAddon: `\n\nTONE MODE — OPERATOR: You are still direct and no-nonsense, but lead with belief over pressure. On slips: zero shame, maximum reframe. Encourage often. Never use aggression or military metaphors that could feel alienating. Think: experienced mentor who's seen it all and still believes in this person.`
  },
  commander: {
    id: "commander",
    label: "COMMANDER",
    icon: "⚡",
    desc: "Balanced & battle-ready",
    accent: "#ff8c00",
    toneAddon: `` // default — no change to existing prompts
  },
  warlord: {
    id: "warlord",
    label: "WARLORD",
    icon: "🔥",
    desc: "Brutal & unfiltered",
    accent: "#ef4444",
    toneAddon: `\n\nTONE MODE — WARLORD: Maximum intensity. Zero softening. Speak like a drill sergeant who has no patience for excuses. On slips: call it out hard, no sugarcoating, then immediately refocus. On wins: explosive pride. Use raw, visceral language. Short sentences. Hit like a sledgehammer. The user chose this — give them everything.`
  }
};
const getMode = () => MODES[ls.get("syn_mode", "commander")] || MODES.commander;

/* ─── SHARED CHAT HISTORY ─────────────────────────────────────────────────
   Checkin's inline follow-up chat and the full Coach screen share ONE
   continuous conversation log, so the AI never starts from zero — it
   always has today's structured check-in report, notes, and prior
   messages in context, regardless of where the user enters from.
──────────────────────────────────────────────────────────────────────────── */
const loadChatHistory = () => {
  try {
    return JSON.parse(ls.get("syn_chat_history", "[]"));
  } catch {
    return [];
  }
};
const saveChatHistory = msgs => {
  try {
    ls.set("syn_chat_history", JSON.stringify(msgs.slice(-60)));
  } catch {}
};
const appendChatHistory = (...newMsgs) => {
  const log = loadChatHistory();
  const updated = [...log, ...newMsgs];
  saveChatHistory(updated);
  return updated;
};
const getConfessPrompt = () => ({
  operator: SYSTEM_CONFESS_OPERATOR,
  commander: SYSTEM_CONFESS_COMMANDER,
  warlord: SYSTEM_CONFESS_WARLORD
})[ls.get("syn_mode", "commander")] || SYSTEM_CONFESS_COMMANDER;
const getCheckinPrompt = () => ({
  operator: SYSTEM_CHECKIN_OPERATOR,
  commander: SYSTEM_CHECKIN_COMMANDER,
  warlord: SYSTEM_CHECKIN_WARLORD
})[ls.get("syn_mode", "commander")] || SYSTEM_CHECKIN_COMMANDER;

// Language mirroring — appended to every system prompt so the AI matches
// the user's language naturally: English → English, Hindi → Hindi,
// Hinglish → Hinglish, etc. No translation, no switching mid-response.
const LANGUAGE_INSTRUCTION = `

LANGUAGE RULE (highest priority — always follow this):
Detect the language of the user's most recent message and reply entirely in that same language and style. Mirror it exactly:
- If they write in English → reply in English.
- If they write in Hindi (Devanagari script) → reply in Hindi.
- If they write in Hinglish (Hindi words in Roman script mixed with English) → reply in Hinglish the same way.
- If they write in any other language → reply in that language.
Never switch languages mid-response. Never translate what they said. Just reply naturally in the same language they used.`;
const withTone = prompt => prompt + LANGUAGE_INSTRUCTION;

/* ─── SHARED COACH CONTEXT (archetype + addictions + recent trend + pattern) ─
   Single source of truth for "what does the AI know about this person beyond
   the raw chat log" — their chosen archetype, what they're fighting, their
   last 5 check-in outcomes, and any recurring trigger/time patterns from the
   last 14 days. Originally only archetype+pattern lived inline inside
   handleCheckin(); extracted and expanded here so the full Coach screen
   (Chat.send), the inline checkin chat (Checkin.sendChat), and handleCheckin
   itself all build the exact same context instead of quietly knowing
   different amounts about the same person. Pure function — reads
   localStorage, returns a string, no side effects, safe to call anywhere.
──────────────────────────────────────────────────────────────────────────── */
function getCoachContext() {
  let archetypeCtx = "";
  try {
    const arch = JSON.parse(ls.get("syn_archetype", "null"));
    if (arch) archetypeCtx = `\n\nUser's chosen archetype: ${arch.title} (${arch.sub}) — weave this into your response naturally.`;
  } catch {}
  let addictionCtx = "";
  try {
    const confess = JSON.parse(ls.get("syn_confess", "null"));
    const list = (confess?.addictions || []).map(a => a.label || a.id).filter(Boolean);
    if (list.length) addictionCtx = `\n\nUser is fighting: ${list.join(", ")}.`;
  } catch {}
  let trendCtx = "";
  try {
    const h = JSON.parse(ls.get("syn_history", "[]"));
    // history is stored newest-first
    const recent = h.slice(0, 5).map(e => e.status?.toUpperCase() || "?").reverse();
    if (recent.length) trendCtx = `\n\nLast ${recent.length} check-in${recent.length > 1 ? "s" : ""} (oldest→newest): ${recent.join(", ")}.`;
  } catch {}
  let patternCtx = "";
  try {
    const log = JSON.parse(ls.get("syn_trigger_log", "[]"));
    const recent = log.slice(-14);
    const triggerCounts = {};
    const timeCounts = {};
    recent.forEach(entry => {
      (entry.addictions || []).forEach(a => {
        (a.triggers || []).forEach(t => {
          triggerCounts[t] = (triggerCounts[t] || 0) + 1;
        });
        const times = Array.isArray(a.timeOfDay) ? a.timeOfDay : a.timeOfDay ? [a.timeOfDay] : [];
        times.forEach(ti => {
          timeCounts[ti] = (timeCounts[ti] || 0) + 1;
        });
      });
    });
    const topTriggers = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c >= 2);
    const topTimes = Object.entries(timeCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, c]) => c >= 2);
    if (topTriggers.length || topTimes.length) {
      const trigNames = {
        bored: "boredom",
        stressed: "stress",
        lonely: "loneliness",
        alone_room: "being alone in their room",
        phone_bed: "phone in bed",
        after_argument: "arguments",
        tired: "tiredness/late nights",
        social_media: "social media exposure",
        friends_around: "certain friends",
        failure: "feeling like a failure",
        free_time: "too much free time",
        habit_cue: "autopilot/habit"
      };
      const timeNames = {
        morning: "mornings",
        afternoon: "afternoons",
        evening: "evenings",
        late_night: "late nights"
      };
      const trigStr = topTriggers.map(([id]) => trigNames[id] || id).join(", ");
      const timeStr = topTimes.map(([id]) => timeNames[id] || id).join(", ");
      patternCtx = `\n\nPATTERN DATA (last 14 days, for your awareness only — mention naturally if relevant, don't force it every time): Recurring triggers: ${trigStr || "none significant"}. Recurring slip times: ${timeStr || "none significant"}.`;
    }
  } catch {}
  return archetypeCtx + addictionCtx + trendCtx + patternCtx;
}
const MILESTONE_DATA = {
  7: {
    emoji: "🔥",
    name: "IGNITION",
    color: "#ff9500",
    rgb: "255,149,0",
    msg: "7 days. Your dopamine receptors are beginning to reset. The fog is lifting. This is where most people quit — you didn't."
  },
  21: {
    emoji: "⚡",
    name: "REWIRED",
    color: "#ffcc00",
    rgb: "255,204,0",
    msg: "21 days. Neural pathways are physically changing. Old cravings are losing their signal. You are not the same person who started."
  },
  30: {
    emoji: "🌙",
    name: "THRESHOLD",
    color: "#a78bfa",
    rgb: "167,139,250",
    msg: "30 days. One month. Your prefrontal cortex is back online. Decisions feel clearer. You've crossed the line most never reach."
  },
  90: {
    emoji: "👁",
    name: "SYNAPSED",
    color: "#22d3ee",
    rgb: "34,211,238",
    msg: "90 days. Full rewire. What used to control you is now background noise. You rebuilt your brain with discipline alone. This is permanent."
  }
};

/* ─── SHARE CARD GENERATOR ───────────────────────────────────────────────── */
async function generateShareCard(streak, lv) {
  await document.fonts.ready;
  const arch = (() => {
    try {
      return JSON.parse(ls.get("syn_archetype", "null"));
    } catch {
      return null;
    }
  })();
  const W = 1080,
    H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const accent = lv?.color || "#ff8c00";
  // Small helper: hex/rgb string -> "r,g,b" for building rgba() strings from
  // the level color, so the whole card tints itself to the user's current
  // level instead of always being flat orange.
  const rgbOf = c => {
    if (c.startsWith("#")) {
      const h = c.slice(1);
      const n = h.length === 3 ? h.split("").map(x => x + x).join("") : h;
      const r = parseInt(n.slice(0, 2), 16),
        g = parseInt(n.slice(2, 4), 16),
        b = parseInt(n.slice(4, 6), 16);
      return `${r},${g},${b}`;
    }
    const m = c.match(/\d+/g);
    return m ? m.slice(0, 3).join(",") : "255,140,0";
  };
  const rgb = rgbOf(accent);

  // Background — near-black, slightly warm rather than flat
  ctx.fillStyle = "#060309";
  ctx.fillRect(0, 0, W, H);

  // Deep radial glow tinted to the level color
  const grd = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, W * 0.62);
  grd.addColorStop(0, `rgba(${rgb},0.22)`);
  grd.addColorStop(0.45, `rgba(${rgb},0.07)`);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Neural network scatter — deterministic pseudo-random nodes connected by
  // faint lines, echoing the app's boot-screen neural canvas so the share
  // card actually looks like it belongs to the product instead of being a
  // generic stat card.
  let seed = streak * 137 + 7; // deterministic per streak so it isn't jarring/random each export
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const nodes = [];
  for (let i = 0; i < 26; i++) {
    nodes.push({
      x: rnd() * W,
      y: rnd() * H,
      r: 1 + rnd() * 2.2
    });
  }
  ctx.strokeStyle = `rgba(${rgb},0.10)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x,
        dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 200) {
        ctx.globalAlpha = 1 - dist / 200;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb},0.35)`;
    ctx.fill();
  });

  // Outer border with rounded corners
  const pad = 52,
    rad = 28;
  ctx.strokeStyle = `rgba(${rgb},0.28)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, rad);
  ctx.stroke();

  // Corner accents (brighter than the border)
  const cs = 30;
  ctx.strokeStyle = `rgba(${rgb},0.8)`;
  ctx.lineWidth = 3;
  [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * cs, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * cs);
    ctx.stroke();
  });

  // SYNAPSE wordmark (top left)
  ctx.font = "700 28px 'Orbitron',monospace";
  ctx.fillStyle = `rgba(${rgb},0.55)`;
  ctx.textAlign = "left";
  ctx.fillText("SYNAPSE", pad + 34, pad + 66);
  ctx.font = "400 13px 'Space Mono',monospace";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("RESET · REWIRE · RECONQUER", pad + 34, pad + 86);

  // Level badge pill (top right)
  ctx.font = "600 17px 'JetBrains Mono',monospace";
  const badgeText = `LVL ${lv.level} · ${lv.title.toUpperCase()}`;
  const badgeW = ctx.measureText(badgeText).width + 40;
  const badgeX = W - pad - 32 - badgeW,
    badgeY = pad + 34;
  ctx.strokeStyle = `rgba(${rgb},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, 36, 18);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 24);

  // Circular progress ring behind the streak number — visualizes rewire
  // progress toward the 90-day mark rather than the number floating alone.
  const ringCx = W / 2,
    ringCy = H * 0.46,
    ringR = 280;
  const pct = Math.min(1, streak / 90);
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.shadowColor = `rgba(${rgb},0.6)`;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Big streak number
  const digits = streak.toString().length;
  const numSize = digits === 1 ? 260 : digits === 2 ? 220 : 170;
  ctx.font = `900 ${numSize}px 'Orbitron',monospace`;
  ctx.textAlign = "center";
  ctx.shadowColor = `rgba(${rgb},0.5)`;
  ctx.shadowBlur = 50;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(streak.toString(), ringCx, ringCy + numSize * 0.32);
  ctx.shadowBlur = 0;

  // DAYS CLEAN label
  ctx.font = "500 26px 'JetBrains Mono',monospace";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "center";
  ctx.fillText("DAYS CLEAN", ringCx, ringCy + numSize * 0.32 + 52);

  // Percent-to-90 caption under the ring
  ctx.font = "400 16px 'Inter',sans-serif";
  ctx.fillStyle = `rgba(${rgb},0.7)`;
  ctx.fillText(streak >= 90 ? "NEURAL RESET COMPLETE" : `${Math.round(pct * 100)}% TO FULL NEURAL RESET`, ringCx, ringCy + ringR + 52);

  // Horizontal divider
  const divY = H - 232;
  ctx.strokeStyle = `rgba(${rgb},0.15)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad + 100, divY);
  ctx.lineTo(W - pad - 100, divY);
  ctx.stroke();

  // Archetype row
  if (arch) {
    const arcEmoji = arch.id === "sovereign" ? "♛" : arch.id === "arbiter" ? "⚖" : arch.id === "stoic" ? "⬡" : "▲";
    ctx.font = "600 24px 'Inter',sans-serif";
    ctx.fillStyle = "rgba(255,200,150,0.6)";
    ctx.textAlign = "center";
    ctx.fillText(`${arcEmoji}  ${arch.title.toUpperCase()}`, W / 2, divY + 54);
  }

  // Date
  ctx.font = "400 15px 'JetBrains Mono',monospace";
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.textAlign = "center";
  ctx.fillText(new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }), W / 2, divY + 86);

  // URL watermark — was pointing at the retired synapseparth.vercel.app
  // domain; every card exported before this fix advertised a dead link.
  ctx.font = "400 17px 'JetBrains Mono',monospace";
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.textAlign = "center";
  ctx.fillText("synapserewire.site", W / 2, H - pad - 30);
  return canvas;
}
async function doShare(streak, lv, setSharing) {
  try {
    setSharing(true);
    const canvas = await generateShareCard(streak, lv);
    canvas.toBlob(async blob => {
      const file = new File([blob], `synapse-day-${streak}.png`, {
        type: "image/png"
      });
      try {
        if (navigator.share && navigator.canShare && navigator.canShare({
          files: [file]
        })) {
          await navigator.share({
            files: [file],
            title: `Day ${streak} Clean 🔥`,
            text: `${streak} days clean. Rewiring my brain on SYNAPSE.`
          });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `synapse-day-${streak}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      } catch {}
      setSharing(false);
    }, "image/png", 0.95);
  } catch {
    setSharing(false);
  }
}

// Shared PDF generator for the AI battle plan — replaces the old plain-text
// .txt Blob download. A multi-page PDF paginates automatically and stays
// readable regardless of plan length, and downloads identically across
// desktop/Android/iOS without any popup/print-dialog dependency.
// Manual word-wrap — does NOT rely on jsPDF's splitTextToSize, which has
// had version-specific wrapping bugs. Measures each candidate line with
// getTextWidth against the CURRENT font/size and breaks strictly before
// any line would exceed maxWidth. Guaranteed to never overflow the page.
function wrapTextManual(docPdf, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? current + " " + word : word;
    if (docPdf.getTextWidth(candidate) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // handle a single word longer than maxWidth by hard-breaking it
      if (docPdf.getTextWidth(word) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          const test = chunk + ch;
          if (docPdf.getTextWidth(test) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk = test;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
function generatePlanPDF({
  name,
  archName,
  streak,
  date,
  cleanPlan
}) {
  const docPdf = new jsPDF({
    unit: "pt",
    format: "a4"
  });

  // Register SYNAPSE's real brand fonts (Inter + Space Grotesk) as embedded
  // TTF data. This guarantees the PDF renders with the correct typography on
  // every device/viewer — previously the PDF used jsPDF's base-14 "courier"
  // and "helvetica" fonts, which are NOT embedded in the file and rely on
  // the viewer supplying its own substitute. Many mobile/in-app PDF viewers
  // don't ship real Helvetica/Courier metrics and silently fall back to a
  // single default monospace font for everything, which is why the font
  // "wasn't fixing" no matter what setFont() calls were made.
  docPdf.addFileToVFS("Inter-Regular.ttf", INTER_REGULAR_TTF);
  docPdf.addFont("Inter-Regular.ttf", "Inter", "normal");
  docPdf.addFileToVFS("Inter-Bold.ttf", INTER_BOLD_TTF);
  docPdf.addFont("Inter-Bold.ttf", "Inter", "bold");
  docPdf.addFileToVFS("SpaceGrotesk-Bold.ttf", SPACE_GROTESK_BOLD_TTF);
  docPdf.addFont("SpaceGrotesk-Bold.ttf", "SpaceGrotesk", "bold");
  const pageW = docPdf.internal.pageSize.getWidth();
  const pageH = docPdf.internal.pageSize.getHeight();
  const margin = 56;
  // Extra safety buffer beyond the raw margin math — guards against any
  // font-metric rounding so wrapped lines never touch the page edge.
  const contentW = pageW - margin * 2 - 12;
  let y = margin;
  const newPageIfNeeded = lineHeight => {
    if (y + lineHeight > pageH - margin) {
      docPdf.addPage();
      y = margin;
    }
  };
  docPdf.setFont("SpaceGrotesk", "bold");
  docPdf.setFontSize(18);
  docPdf.setTextColor(255, 120, 0);
  docPdf.text("SYNAPSE — RECOVERY PROTOCOL", margin, y);
  y += 22;
  docPdf.setDrawColor(255, 140, 0);
  docPdf.setLineWidth(1);
  docPdf.line(margin, y, pageW - margin, y);
  y += 22;
  docPdf.setFont("Inter", "bold");
  docPdf.setFontSize(11);
  docPdf.setTextColor(40, 40, 40);
  const metaLines = [`Name:      ${name || "—"}`, `Archetype: ${archName}`, `Streak:    Day ${streak}`, `Generated: ${date}`];
  metaLines.forEach(line => {
    newPageIfNeeded(16);
    docPdf.text(line, margin, y);
    y += 16;
  });
  y += 10;
  docPdf.setDrawColor(200, 200, 200);
  docPdf.line(margin, y, pageW - margin, y);
  y += 24;
  docPdf.setFont("Inter", "normal");
  docPdf.setFontSize(11);
  docPdf.setTextColor(20, 20, 20);
  const bodyLineHeight = 15;
  const paragraphs = String(cleanPlan || "").replace(/\r\n/g, "\n").replace(/\*\*/g, "").split("\n");
  paragraphs.forEach(para => {
    if (para.trim() === "") {
      newPageIfNeeded(bodyLineHeight);
      y += bodyLineHeight * 0.6;
      return;
    }
    const wrapped = wrapTextManual(docPdf, para, contentW);
    wrapped.forEach(line => {
      newPageIfNeeded(bodyLineHeight);
      docPdf.text(line, margin, y);
      y += bodyLineHeight;
    });
  });
  y += 10;
  newPageIfNeeded(20);
  docPdf.setDrawColor(255, 140, 0);
  docPdf.line(margin, y, pageW - margin, y);
  y += 18;
  docPdf.setFont("Inter", "normal");
  docPdf.setFontSize(9);
  docPdf.setTextColor(150, 150, 150);
  docPdf.text("synapserewire.site", margin, y);
  return docPdf;
}

/* ─── LEVELS ─────────────────────────────────────────────────────────────── */
const LEVELS = [{
  level: 1,
  title: "COMPROMISED",
  minDays: 0,
  color: "#ff4444",
  hex: "255,68,68"
}, {
  level: 2,
  title: "AWAKENING",
  minDays: 3,
  color: "#ff8c00",
  hex: "255,140,0"
}, {
  level: 3,
  title: "STABILIZING",
  minDays: 7,
  color: "#ffcc00",
  hex: "255,204,0"
}, {
  level: 4,
  title: "REWIRING",
  minDays: 14,
  color: "#88ff44",
  hex: "136,255,68"
}, {
  level: 5,
  title: "RECALIBRATED",
  minDays: 30,
  color: "#44ddff",
  hex: "68,221,255"
}, {
  level: 6,
  title: "OPTIMIZED",
  minDays: 60,
  color: "#cc88ff",
  hex: "204,136,255"
}, {
  level: 7,
  title: "SYNAPSED",
  minDays: 90,
  color: "var(--text)",
  hex: "255,255,255"
}];
const getLevel = s => [...LEVELS].reverse().find(l => s >= l.minDays) || LEVELS[0];
const getNextLvl = s => LEVELS.find(l => s < l.minDays) || null;
function parseBold(text) {
  if (!text) return null;
  return text.split(/\*\*(.*?)\*\*/g).map((p, i) => i % 2 === 1 ? <strong key={i} style={{
    color: "#ffb347",
    fontWeight: 700
  }}>{p}</strong> : p);
}
function useTypewriter(text, speed = 11) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setIdx(0);
    setDone(false);
  }, [text]);
  useEffect(() => {
    if (!text) return;
    if (idx < text.length) {
      const t = setTimeout(() => setIdx(i => i + 1), speed);
      return () => clearTimeout(t);
    } else setDone(true);
  }, [idx, text, speed]);
  return {
    displayed: text.slice(0, idx),
    done
  };
}
function AnimatedNumber({
  target,
  duration = 1400
}) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setVal(Math.round((1 - Math.pow(1 - p, 4)) * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return <>{val}</>;
}
const ls = {
  get: (key, fallback = null) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, val) => {
    try {
      localStorage.setItem(key, val);
    } catch {}
  },
  remove: key => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
};

/* ─── DURABLE FIRESTORE SYNC QUEUE ────────────────────────────────────────
   Problem this solves: every existing Firestore write in this app is
   fire-and-forget (`setDoc(...).catch(console.warn)`). On a network blip,
   or if auth.currentUser isn't ready yet, the write is just lost forever —
   the data only survives in localStorage and the admin dashboard (which
   reads from Firestore) never sees it.

   This queue makes writes durable WITHOUT changing any existing data shape,
   document IDs, or admin dashboard read logic:
   1. Every write is first persisted to a localStorage queue (survives reload/close).
   2. We attempt it immediately, with retry + exponential backoff (3 tries).
   3. On success, it's removed from the queue.
   4. On final failure, it STAYS in the queue and gets retried automatically
      next time the app opens (or comes back online) — instead of vanishing.
   5. Each queued write has a stable `key` (e.g. "checkin_<id>") so re-queuing
      the same logical write just overwrites the pending entry, never duplicates.
──────────────────────────────────────────────────────────────────────────── */
const SYNC_QUEUE_KEY = "syn_sync_queue";
const loadSyncQueue = () => {
  try {
    return JSON.parse(ls.get(SYNC_QUEUE_KEY, "[]"));
  } catch {
    return [];
  }
};
const saveSyncQueue = q => {
  try {
    ls.set(SYNC_QUEUE_KEY, JSON.stringify(q.slice(-50)));
  } catch {}
};
function enqueueSyncWrite(key, collectionName, docId, data) {
  const q = loadSyncQueue();
  const existingIdx = q.findIndex(item => item.key === key);
  const entry = {
    key,
    collectionName,
    docId,
    data,
    queuedAt: Date.now(),
    attempts: 0
  };
  if (existingIdx >= 0) q[existingIdx] = entry;else q.push(entry);
  saveSyncQueue(q);
}
function dequeueSyncWrite(key) {
  const q = loadSyncQueue().filter(item => item.key !== key);
  saveSyncQueue(q);
}
const _wait = ms => new Promise(res => setTimeout(res, ms));

// Attempts a single queued write with retry + exponential backoff.
// Returns true on success, false if all attempts failed (write stays queued).
async function _attemptWrite(item) {
  const delays = [0, 800, 2500]; // immediate, then ~0.8s, then ~2.5s
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await _wait(delays[i]);
    try {
      // Race each Firestore write against a 5s timeout — without this,
      // a slow/unresponsive connection causes setDoc to hang indefinitely,
      // which freezes any UI that awaits durableWrite (e.g. feedback "Sending..."
      // spinner would never resolve until the browser killed the request itself).
      await Promise.race([setDoc(doc(db, item.collectionName, item.docId), item.data, {
        merge: true
      }), new Promise((_, reject) => setTimeout(() => reject(new Error("write timeout")), 5000))]);
      return true;
    } catch (e) {
      if (i === delays.length - 1) console.warn(`Sync queue write failed (${item.key}) after ${delays.length} attempts:`, e.message);
    }
  }
  return false;
}

// Public helper — use this instead of calling setDoc directly for any write
// that must not be silently lost. Persists to the durable queue first, then
// tries immediately. If it fails, it's retried automatically by flushSyncQueue()
// on next app load or reconnect, so the data is never dropped on the floor.
async function durableWrite(key, collectionName, docId, data) {
  enqueueSyncWrite(key, collectionName, docId, data);
  const ok = await _attemptWrite({
    key,
    collectionName,
    docId,
    data
  });
  if (ok) dequeueSyncWrite(key);
  return ok;
}

// Flushes any writes left over from a previous session (app was closed mid-sync,
// or every retry failed while offline). Call this once on auth-ready + on
// regaining network connectivity. Safe to call repeatedly — it's a no-op if
// the queue is empty, and each item is independent so one failure doesn't
// block the others.
let _flushInFlight = false;
async function flushSyncQueue() {
  if (_flushInFlight) return;
  _flushInFlight = true;
  try {
    const q = loadSyncQueue();
    for (const item of q) {
      const ok = await _attemptWrite(item);
      if (ok) dequeueSyncWrite(item.key);
    }
  } finally {
    _flushInFlight = false;
  }
}

// Perf flag — lighten the always-on background animations on phones (fewer particles,
// lower internal canvas resolution, capped frame rate, pause when tab/app is hidden).
// Animation timing is delta-time based, so motion speed is unchanged either way.
const IS_MOBILE = typeof window !== "undefined" && (window.innerWidth <= 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

/* ══════════════════════════════════════════════════════════════════════════
   SYNAPSE BACKGROUND — 3-layer neural animation
══════════════════════════════════════════════════════════════════════════ */
function SynapseBackground({
  intensity = "normal"
}) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let W,
      H,
      raf,
      time = 0;
    let mouseX = 0,
      mouseY = 0,
      mouseVX = 0,
      mouseVY = 0,
      prevMX = 0,
      prevMY = 0;
    // Mobile perf: render at a slightly lower internal resolution (CSS stretches the canvas
    // back to full size — since everything here is soft glow/gradient, the difference is
    // invisible) and cap the frame rate. Motion below is delta-time based, so it doesn't slow down.
    const RES_SCALE = IS_MOBILE ? 0.78 : 1;
    const TARGET_FPS = IS_MOBILE ? 30 : 60;
    const FRAME_MS = 1000 / TARGET_FPS;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * RES_SCALE);
      canvas.height = Math.round(H * RES_SCALE);
      ctx.setTransform(RES_SCALE, 0, 0, RES_SCALE, 0, 0);
      mouseX = W / 2;
      mouseY = H / 2;
    };
    resize();
    window.addEventListener("resize", resize);
    const onMouse = e => {
      mouseVX = e.clientX - prevMX;
      mouseVY = e.clientY - prevMY;
      prevMX = mouseX;
      prevMY = mouseY;
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    window.addEventListener("mousemove", onMouse);
    const DEEP_N = intensity === "heavy" ? IS_MOBILE ? 90 : 110 : IS_MOBILE ? 62 : 75;
    const deepNodes = Array.from({
      length: DEEP_N
    }, () => ({
      x: (Math.random() - .5) * 3000,
      y: (Math.random() - .5) * 2000,
      z: (Math.random() - .5) * 1800,
      vx: (Math.random() - .5) * .13,
      vy: (Math.random() - .5) * .11,
      vz: (Math.random() - .5) * .09,
      r: Math.random() * 2 + .8,
      pulse: Math.random() * Math.PI * 2,
      signalT: Math.random(),
      signalSpeed: .002 + Math.random() * .004
    }));
    const project3D = (x, y, z, rY, rX) => {
      const cY = Math.cos(rY),
        sY = Math.sin(rY);
      const x1 = x * cY - z * sY,
        z1 = x * sY + z * cY;
      const cX = Math.cos(rX),
        sX = Math.sin(rX);
      const y1 = y * cX - z1 * sX,
        z2 = y * sX + z1 * cX;
      const fov = 900,
        d = fov / (fov + z2 + 700);
      return {
        sx: W / 2 + x1 * d,
        sy: H / 2 + y1 * d,
        depth: d
      };
    };
    const EDGE_D = 580;
    let deepEdges = [];
    const computeEdges = () => {
      deepEdges = [];
      for (let i = 0; i < deepNodes.length; i++) for (let j = i + 1; j < deepNodes.length; j++) {
        const dx = deepNodes[i].x - deepNodes[j].x,
          dy = deepNodes[i].y - deepNodes[j].y,
          dz = deepNodes[i].z - deepNodes[j].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < EDGE_D) deepEdges.push({
          i,
          j,
          d
        });
      }
    };
    computeEdges();
    let edgeTimer = 0;
    const clusters = Array.from({
      length: 9
    }, (_, ci) => ({
      cx: .08 + ci % 3 * .31 + (Math.random() - .5) * .07,
      cy: .12 + Math.floor(ci / 3) * .36 + (Math.random() - .5) * .1,
      vx: (Math.random() - .5) * .00017,
      vy: (Math.random() - .5) * .00013,
      phase: Math.random() * Math.PI * 2,
      scale: .45 + Math.random() * .7,
      op: .25 + Math.random() * .4,
      nodes: Array.from({
        length: 9
      }, (_, ni) => {
        if (ni === 0) return {
          dx: 0,
          dy: 0,
          r: 9,
          tier: 0
        };
        const a = ni / 8 * Math.PI * 2,
          rad = ni <= 4 ? 55 : 105;
        return {
          dx: Math.cos(a) * rad,
          dy: Math.sin(a) * rad,
          r: ni <= 4 ? 4.5 : 2.8,
          tier: ni <= 4 ? 1 : 2
        };
      })
    }));
    const bursts = [];
    const spawnBurst = (x, y, n = 2) => {
      for (let i = 0; i < n; i++) {
        if (bursts.length > 65) bursts.shift();
        const a = Math.random() * Math.PI * 2,
          spd = .8 + Math.random() * 2.5;
        bursts.push({
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          life: 1,
          decay: .013 + Math.random() * .017,
          r: 1.2 + Math.random() * 2.8,
          trail: []
        });
      }
    };
    let burstTimer = 0;
    let lastFrame = performance.now();
    let paused = document.hidden;
    const onVis = () => {
      paused = document.hidden;
      if (!paused) lastFrame = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);
    const draw = now => {
      raf = requestAnimationFrame(draw);
      if (paused) return;
      const elapsed = now - lastFrame;
      if (elapsed < FRAME_MS) return;
      const dt = Math.min(elapsed / 16.6667, 3);
      lastFrame = now - elapsed % FRAME_MS;
      time += .005 * dt;
      edgeTimer += dt;
      burstTimer += dt;
      if (edgeTimer > 210) {
        computeEdges();
        edgeTimer = 0;
      }
      if (burstTimer >= 22) {
        spawnBurst(Math.random() * W, Math.random() * H, 1);
        burstTimer = 0;
      }
      if (Math.sqrt(mouseVX * mouseVX + mouseVY * mouseVY) > 7) spawnBurst(mouseX, mouseY, 1);
      ctx.clearRect(0, 0, W, H);
      const pX = (mouseX / W - .5) * 55,
        pY = (mouseY / H - .5) * 35;
      const rY = time * .022 + pX * .0005,
        rX = Math.sin(time * .016) * .13 + pY * .0004;
      const proj = deepNodes.map(n => project3D(n.x, n.y, n.z, rY, rX));
      deepNodes.forEach(n => {
        n.x += n.vx;
        n.y += n.vy;
        n.z += n.vz;
        if (Math.abs(n.x) > 1500) n.vx *= -1;
        if (Math.abs(n.y) > 1000) n.vy *= -1;
        if (Math.abs(n.z) > 900) n.vz *= -1;
      });
      deepEdges.forEach(({
        i,
        j,
        d
      }) => {
        const a = proj[i],
          b = proj[j];
        const prox = 1 - d / EDGE_D,
          df = Math.max(0, (a.depth + b.depth) / 2),
          alpha = prox * df * .32;
        const g = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
        g.addColorStop(0, `rgba(255,120,0,${alpha * .5})`);
        g.addColorStop(.5, `rgba(255,170,55,${alpha})`);
        g.addColorStop(1, `rgba(255,80,0,${alpha * .5})`);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(0, prox * df * 1.05);
        ctx.stroke();
        deepNodes[i].signalT += deepNodes[i].signalSpeed;
        if (deepNodes[i].signalT > 1) deepNodes[i].signalT = 0;
        const t = deepNodes[i].signalT;
        const sx = a.sx + (b.sx - a.sx) * t,
          sy = a.sy + (b.sy - a.sy) * t;
        const sa = Math.sin(t * Math.PI) * prox * df;
        const signalR = Math.max(0, 2.1 * df);
        if (signalR > 0) {
          ctx.beginPath();
          ctx.arc(sx, sy, signalR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,205,95,${sa * .8})`;
          ctx.fill();
        }
      });
      proj.forEach((p, idx) => {
        const n = deepNodes[idx];
        const pulse = .7 + .3 * Math.sin(time * 2.2 + n.pulse);
        const size = Math.max(0, n.r * p.depth * pulse * 2.3),
          alpha = Math.max(0, p.depth * .78 * pulse);
        if (size <= 0 || p.depth <= 0) return;
        const outerR = Math.max(0, size * 4.2);
        const grd = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, outerR || 0.01);
        grd.addColorStop(0, `rgba(255,145,30,${alpha * .42})`);
        grd.addColorStop(.4, `rgba(255,95,0,${alpha * .16})`);
        grd.addColorStop(1, `rgba(255,50,0,0)`);
        if (outerR > 0) {
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, outerR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
        if (size > 0) {
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,185,85,${alpha})`;
          ctx.fill();
        }
      });
      clusters.forEach(cl => {
        cl.cx += cl.vx;
        cl.cy += cl.vy;
        if (cl.cx < .03 || cl.cx > .97) cl.vx *= -1;
        if (cl.cy < .03 || cl.cy > .97) cl.vy *= -1;
        const bcx = cl.cx * W + Math.sin(time * .85 + cl.phase) * 20;
        const bcy = cl.cy * H + Math.cos(time * .6 + cl.phase) * 14;
        const sc = cl.scale,
          pulse = .62 + .38 * Math.sin(time * 1.35 + cl.phase),
          op = cl.op;
        for (let i = 1; i <= 4; i++) {
          const na = cl.nodes[0],
            nb = cl.nodes[i];
          const x1 = bcx + na.dx * sc,
            y1 = bcy + na.dy * sc,
            x2 = bcx + nb.dx * sc,
            y2 = bcy + nb.dy * sc;
          const g = ctx.createLinearGradient(x1, y1, x2, y2);
          g.addColorStop(0, `rgba(255,155,0,${op * .16 * pulse})`);
          g.addColorStop(.5, `rgba(255,205,75,${op * .26 * pulse})`);
          g.addColorStop(1, `rgba(255,95,0,${op * .16 * pulse})`);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
        for (let i = 1; i <= 4; i++) {
          const na = cl.nodes[i],
            nb = cl.nodes[i % 4 + 1];
          ctx.beginPath();
          ctx.moveTo(bcx + na.dx * sc, bcy + na.dy * sc);
          ctx.lineTo(bcx + nb.dx * sc, bcy + nb.dy * sc);
          ctx.strokeStyle = `rgba(255,135,0,${op * .08 * pulse})`;
          ctx.lineWidth = .65;
          ctx.stroke();
        }
        for (let i = 5; i <= 8; i++) {
          const na = cl.nodes[i % 4 + 1],
            nb = cl.nodes[i];
          ctx.beginPath();
          ctx.moveTo(bcx + na.dx * sc, bcy + na.dy * sc);
          ctx.lineTo(bcx + nb.dx * sc, bcy + nb.dy * sc);
          ctx.strokeStyle = `rgba(255,135,0,${op * .05 * pulse})`;
          ctx.lineWidth = .45;
          ctx.stroke();
        }
        for (let i = 5; i <= 8; i++) {
          const na = cl.nodes[i],
            nb = cl.nodes[i % 4 + 5];
          ctx.beginPath();
          ctx.moveTo(bcx + na.dx * sc, bcy + na.dy * sc);
          ctx.lineTo(bcx + nb.dx * sc, bcy + nb.dy * sc);
          ctx.strokeStyle = `rgba(255,135,0,${op * .04 * pulse})`;
          ctx.lineWidth = .4;
          ctx.stroke();
        }
        cl.nodes.forEach((n, ni) => {
          const nx = bcx + n.dx * sc,
            ny = bcy + n.dy * sc;
          const np = .8 + .2 * Math.sin(time * 2 + ni * .9 + cl.phase);
          const nr = n.r * sc * np;
          if (n.tier === 0) {
            const og = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr * 5);
            og.addColorStop(0, `rgba(255,145,0,${op * .2 * pulse})`);
            og.addColorStop(1, "rgba(0,0,0,0)");
            ctx.beginPath();
            ctx.arc(nx, ny, nr * 5, 0, Math.PI * 2);
            ctx.fillStyle = og;
            ctx.fill();
            const cg = ctx.createRadialGradient(nx - nr * .3, ny - nr * .3, 0, nx, ny, nr);
            cg.addColorStop(0, `rgba(255,225,115,${op * .58 * pulse})`);
            cg.addColorStop(.5, `rgba(255,135,0,${op * .38 * pulse})`);
            cg.addColorStop(1, `rgba(195,55,0,${op * .18 * pulse})`);
            ctx.beginPath();
            ctx.arc(nx, ny, nr, 0, Math.PI * 2);
            ctx.fillStyle = cg;
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(nx, ny, nr, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,155,38,${op * .22 * pulse})`;
            ctx.fill();
          }
        });
      });
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.trail.push({
          x: b.x,
          y: b.y
        });
        if (b.trail.length > 9) b.trail.shift();
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= .97;
        b.vy *= .97;
        b.life -= b.decay;
        if (b.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }
        for (let t = 0; t < b.trail.length - 1; t++) {
          const t0 = b.trail[t],
            t1 = b.trail[t + 1];
          const ta = t / b.trail.length * b.life * .28;
          ctx.beginPath();
          ctx.moveTo(t0.x, t0.y);
          ctx.lineTo(t1.x, t1.y);
          ctx.strokeStyle = `rgba(255,195,75,${ta})`;
          ctx.lineWidth = t / b.trail.length * b.r * .75;
          ctx.stroke();
        }
        const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 3);
        grd.addColorStop(0, `rgba(255,225,115,${b.life * .65})`);
        grd.addColorStop(.4, `rgba(255,135,0,${b.life * .28})`);
        grd.addColorStop(1, "rgba(255,75,0,0)");
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * b.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,215,95,${b.life * .88})`;
        ctx.fill();
      }
    };
    // Defer animation start until browser is idle so the 3D canvas computation
    // doesn't compete with LCP element paint on the main thread. Without this,
    // requestAnimationFrame fires immediately on mount and the 75-110 node
    // 3D projection + edge computation blocks the browser from finishing its
    // first meaningful paint — which was the main driver of LCP 6-7s.
    // requestIdleCallback fires after the browser has finished its pending work;
    // setTimeout(300) is the fallback for Safari which lacks rIC.
    let startTimeout;
    const startAnimation = () => {
      raf = requestAnimationFrame(draw);
    };
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(startAnimation, {
        timeout: 300
      });
    } else {
      startTimeout = setTimeout(startAnimation, 300);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(startTimeout);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intensity]);
  return <canvas ref={canvasRef} style={{
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 0,
    opacity: intensity === "heavy" ? .72 : .52
  }} />;
}

/* ─── FLOATING NEURONS ───────────────────────────────────────────────────── */
function FloatingNeurons() {
  const neurons = useRef(Array.from({
    length: IS_MOBILE ? 13 : 18
  }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 4 + Math.random() * 14,
    speedX: (Math.random() - .5) * 0.018,
    speedY: (Math.random() - .5) * 0.014,
    phase: Math.random() * Math.PI * 2,
    pulseSpeed: 0.6 + Math.random() * 0.8,
    opacity: 0.12 + Math.random() * 0.22
  })));
  const posRef = useRef(neurons.current.map(n => ({
    x: n.x,
    y: n.y
  })));
  const [tick, setTick] = useState(0);
  const rafRef = useRef(null);
  const tRef = useRef(0);
  useEffect(() => {
    const FRAME_GAP = IS_MOBILE ? 45 : 32;
    let last = 0;
    const animate = ts => {
      if (!document.hidden && ts - last > FRAME_GAP) {
        tRef.current += 0.016;
        neurons.current.forEach((n, i) => {
          let nx = posRef.current[i].x + n.speedX;
          let ny = posRef.current[i].y + n.speedY;
          if (nx < -5) nx = 105;
          if (nx > 105) nx = -5;
          if (ny < -5) ny = 105;
          if (ny > 105) ny = -5;
          posRef.current[i] = {
            x: nx,
            y: ny
          };
        });
        setTick(t => t + 1);
        last = ts;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);
  const t = tRef.current;
  return <div style={{
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 1,
    overflow: "hidden",
    background: "transparent"
  }}>
      <svg xmlns="http://www.w3.org/2000/svg" style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      background: "none",
      display: "block"
    }}>
        {neurons.current.map((n, i) => neurons.current.slice(i + 1).map((m, j) => {
        const dx = posRef.current[i].x - posRef.current[i + j + 1].x;
        const dy = posRef.current[i].y - posRef.current[i + j + 1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 22) return null;
        const alpha = (1 - dist / 22) * 0.18;
        return <line key={`${i}-${i + j + 1}`} x1={`${posRef.current[i].x}%`} y1={`${posRef.current[i].y}%`} x2={`${posRef.current[i + j + 1].x}%`} y2={`${posRef.current[i + j + 1].y}%`} stroke={`rgba(255,160,40,${alpha})`} strokeWidth="0.8" />;
      }))}
      </svg>
      {neurons.current.map((n, i) => {
      const pulse = 0.75 + 0.25 * Math.sin(t * n.pulseSpeed + n.phase);
      const sz = n.size * pulse;
      const op = n.opacity * pulse;
      return <div key={n.id} style={{
        position: "absolute",
        left: `${posRef.current[i].x}%`,
        top: `${posRef.current[i].y}%`,
        width: sz,
        height: sz,
        borderRadius: "50%",
        transform: "translate(-50%,-50%)",
        background: `radial-gradient(circle at 35% 35%, rgba(255,220,120,${op * 0.9}), rgba(255,120,0,${op * 0.6}), rgba(200,50,0,${op * 0.2}))`,
        boxShadow: `0 0 ${sz * 2.5}px rgba(255,140,0,${op * 0.5}), 0 0 ${sz * 5}px rgba(255,100,0,${op * 0.2})`,
        willChange: "transform"
      }} />;
    })}
    </div>;
}

/* ─── NEURAL MARK ────────────────────────────────────────────────────────── */
function NeuralMark({
  size = 36
}) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas.getContext("2d");
    const S = size;
    canvas.width = S;
    canvas.height = S;
    const cx = S / 2,
      cy = S / 2;
    let raf,
      t = 0;
    const nodes = [{
      x: cx,
      y: cy,
      r: S * .11,
      tier: 0
    }, ...Array.from({
      length: 6
    }, (_, i) => {
      const a = i / 6 * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(a) * S * .22,
        y: cy + Math.sin(a) * S * .22,
        r: S * .045,
        tier: 1
      };
    }), ...Array.from({
      length: 6
    }, (_, i) => {
      const a = i / 6 * Math.PI * 2 - Math.PI / 2 + Math.PI / 6;
      return {
        x: cx + Math.cos(a) * S * .38,
        y: cy + Math.sin(a) * S * .38,
        r: S * .03,
        tier: 2
      };
    })];
    const edges = [];
    for (let i = 1; i <= 6; i++) edges.push({
      a: 0,
      b: i,
      w: 1
    });
    for (let i = 0; i < 6; i++) {
      edges.push({
        a: i + 1,
        b: 7 + i,
        w: .7
      });
      edges.push({
        a: i + 1,
        b: 7 + (i + 1) % 6,
        w: .5
      });
    }
    for (let i = 0; i < 6; i++) edges.push({
      a: 7 + i,
      b: 7 + (i + 1) % 6,
      w: .4
    });
    const sigs = edges.slice(0, 8).map((e, i) => ({
      edge: e,
      t: i / 8,
      speed: .005 + Math.random() * .007
    }));
    const draw = () => {
      if (document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }
      t += .015;
      ctx.clearRect(0, 0, S, S);
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * .5);
      bg.addColorStop(0, "rgba(255,120,0,0.08)");
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, S * .5, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      edges.forEach(({
        a,
        b,
        w
      }) => {
        const na = nodes[a],
          nb = nodes[b];
        if (!na || !nb) return;
        const g = ctx.createLinearGradient(na.x, na.y, nb.x, nb.y);
        g.addColorStop(0, `rgba(255,160,40,${w * .3})`);
        g.addColorStop(.5, `rgba(255,200,80,${w * .5})`);
        g.addColorStop(1, `rgba(255,120,0,${w * .3})`);
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.strokeStyle = g;
        ctx.lineWidth = w * 1.5;
        ctx.stroke();
      });
      sigs.forEach(sig => {
        sig.t += sig.speed;
        if (sig.t > 1) sig.t = 0;
        const na = nodes[sig.edge.a],
          nb = nodes[sig.edge.b];
        if (!na || !nb) return;
        const sx = na.x + (nb.x - na.x) * sig.t,
          sy = na.y + (nb.y - na.y) * sig.t;
        const p = Math.sin(sig.t * Math.PI);
        const pg = ctx.createRadialGradient(sx, sy, 0, sx, sy, S * .04 * p + S * .015);
        pg.addColorStop(0, `rgba(255,240,180,${p * .9})`);
        pg.addColorStop(1, "rgba(255,100,0,0)");
        ctx.beginPath();
        ctx.arc(sx, sy, S * .04 * p + S * .015, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();
      });
      nodes.forEach((n, i) => {
        const pulse = .85 + .15 * Math.sin(t * 2 + i * .9);
        if (n.tier === 0) {
          const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, n.r * 5);
          og.addColorStop(0, "rgba(255,140,0,0.3)");
          og.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(cx, cy, n.r * 5, 0, Math.PI * 2);
          ctx.fillStyle = og;
          ctx.fill();
          const cg = ctx.createRadialGradient(cx - n.r * .3, cy - n.r * .3, 0, cx, cy, n.r * pulse);
          cg.addColorStop(0, "#fff8e0");
          cg.addColorStop(.3, "#ffdd88");
          cg.addColorStop(.7, "#ff9500");
          cg.addColorStop(1, "#cc2200");
          ctx.beginPath();
          ctx.arc(cx, cy, n.r * pulse, 0, Math.PI * 2);
          ctx.fillStyle = cg;
          ctx.shadowColor = "#ff8c00";
          ctx.shadowBlur = S * .1;
          ctx.fill();
          ctx.shadowBlur = 0;
          const sg = ctx.createRadialGradient(cx - n.r * .4, cy - n.r * .5, 0, cx, cy, n.r * .7);
          sg.addColorStop(0, "rgba(255,255,255,0.65)");
          sg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.beginPath();
          ctx.arc(cx, cy, n.r * pulse, 0, Math.PI * 2);
          ctx.fillStyle = sg;
          ctx.fill();
        } else {
          const bg2 = ctx.createRadialGradient(n.x - n.r * .2, n.y - n.r * .2, 0, n.x, n.y, n.r * pulse);
          bg2.addColorStop(0, n.tier === 1 ? "#ffeeaa" : "#ffd060");
          bg2.addColorStop(1, n.tier === 1 ? "#cc4400" : "#aa3300");
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r * pulse, 0, Math.PI * 2);
          ctx.fillStyle = bg2;
          ctx.shadowColor = "#ff8800";
          ctx.shadowBlur = n.r * 2;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return <canvas ref={ref} style={{
    display: "block",
    flexShrink: 0
  }} />;
}

/* ─── AMBIENT AUDIO TOGGLE ───────────────────────────────────────────────── */
// Background music removed. AmbientAudio renders nothing and exposes a no-op
// play fn so existing callers (e.g. the first-interaction handler) stay safe.
window.__synapsePlayAmbient = () => {};
function AmbientAudio({
  onReady
}) {
  useEffect(() => {
    if (onReady) onReady(() => {});
  }, []);
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   ONBOARDING TOUR — shown once on first visit
══════════════════════════════════════════════════════════════════════════ */
const TOUR_SLIDES = [{
  icon: "◈",
  tag: "WELCOME, SOLDIER",
  title: "SYNAPSE\nPROTOCOL",
  sub: "Your brain has been hijacked by dopamine traps. SYNAPSE is your command center to reclaim it — one day at a time.",
  accent: "#ff8c00"
}, {
  icon: "⬡",
  tag: "STEP 1 — CONFESS",
  title: "CONFESS\nYOUR\nBATTLE",
  sub: "Tell SYNAPSE exactly what you're fighting — porn, reels, social media, games, anything. Be brutal. Be honest. The AI will forge your personal battle plan from it.",
  accent: "#ff6030"
}, {
  icon: "▣",
  tag: "STEP 2 — YOUR PLAN",
  title: "YOUR\nBATTLE\nPLAN",
  sub: "A custom AI-generated mission plan built around YOUR addictions and YOUR archetype identity. No generic advice. No therapy talk. Just orders.",
  accent: "#ff9500"
}, {
  icon: "◉",
  tag: "STEP 3 — DAILY CHECK-IN",
  title: "CHECK IN\nEVERY\nDAY",
  sub: "WIN, MID, or SLIP — log your day every 24 hours. Your streak grows, your brain rewires. Miss a day and the streak resets. No mercy.",
  accent: "#ffb347"
}, {
  icon: "⬟",
  tag: "STEP 4 — AI COACH",
  title: "YOUR\nCOMMANDER\nON CALL",
  sub: "Struggling at 2 AM? The AI Coach knows your plan, your streak, your archetype. Talk to it. It will not coddle you — it will reload your weapons.",
  accent: "#ff7020"
}, {
  icon: "◈",
  tag: "STEP 5 — REPORT",
  title: "TRACK YOUR\nREWIRING",
  sub: "The Report screen shows your brain rewiring progress, streak history, archetype evolution, and past battle plans. Watch yourself become the operator.",
  accent: "#ff8c00"
}, {
  icon: "✦",
  tag: "YOU ARE READY",
  title: "BEGIN\nYOUR\nMISSION",
  sub: "The soldier who shows up every day, even broken, even tired — that soldier wins. SYNAPSE is your witness. Now go confess and get your orders.",
  accent: "#ff9500",
  final: true
}];
function OnboardingTour({
  onComplete
}) {
  const [idx, setIdx] = useState(0);
  const [anim, setAnim] = useState(true);
  const slide = TOUR_SLIDES[idx];
  const total = TOUR_SLIDES.length;
  const go = next => {
    setAnim(false);
    setTimeout(() => {
      setIdx(next);
      setAnim(true);
    }, 220);
  };
  const finish = () => {
    ls.set("syn_toured", "1");
    onComplete();
  };
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "radial-gradient(ellipse at 30% 20%, rgba(255,140,0,0.07) 0%, transparent 60%), #07040a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(20px,5vw,60px)",
    fontFamily: "'Inter',sans-serif"
  }}>

      {/* Stars */}
      <div style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      pointerEvents: "none"
    }}>
        {Array.from({
        length: 40
      }, (_, i) => <div key={i} style={{
        position: "absolute",
        width: i % 5 === 0 ? 2 : 1,
        height: i % 5 === 0 ? 2 : 1,
        borderRadius: "50%",
        background: `rgba(255,${140 + i % 60},0,${0.15 + i % 4 * 0.1})`,
        top: `${(i * 37 + 11) % 100}%`,
        left: `${(i * 53 + 7) % 100}%`,
        animation: `dotBlink ${2 + i % 3}s ${i % 10 * 0.3}s ease-in-out infinite`
      }} />)}
      </div>

      {/* Progress dots */}
      <div style={{
      display: "flex",
      gap: 6,
      marginBottom: 32,
      position: "relative",
      zIndex: 2
    }}>
        {TOUR_SLIDES.map((_, i) => <div key={i} onClick={() => go(i)} style={{
        width: i === idx ? 22 : 6,
        height: 6,
        borderRadius: 999,
        cursor: "pointer",
        background: i === idx ? slide.accent : i < idx ? "rgba(255,140,0,0.35)" : "rgba(255,255,255,0.08)",
        transition: "all .35s cubic-bezier(.16,1,.3,1)",
        boxShadow: i === idx ? `0 0 12px ${slide.accent}88` : "none"
      }} />)}
      </div>

      {/* Card */}
      <div style={{
      maxWidth: 480,
      width: "100%",
      position: "relative",
      zIndex: 2,
      opacity: anim ? 1 : 0,
      transform: anim ? "translateY(0) scale(1)" : "translateY(18px) scale(0.97)",
      transition: "opacity .22s ease, transform .22s ease"
    }}>

        <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,140,0,0.07)",
        border: "1px solid rgba(255,140,0,0.2)",
        borderRadius: 999,
        padding: "5px 14px",
        marginBottom: 24,
        fontSize: 10,
        letterSpacing: 2.5,
        color: "rgba(255,180,80,0.6)",
        textTransform: "uppercase"
      }}>
          <span style={{
          color: slide.accent,
          fontSize: 8
        }}>◆</span>{slide.tag}
        </div>

        <div style={{
        fontSize: "clamp(48px,12vw,80px)",
        lineHeight: 1,
        marginBottom: 16,
        color: slide.accent,
        filter: `drop-shadow(0 0 24px ${slide.accent}66)`,
        fontFamily: "monospace"
      }}>
          {slide.icon}
        </div>

        <h1 style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,8vw,52px)",
        fontWeight: 900,
        lineHeight: 1.05,
        color: "#fff",
        marginBottom: 20,
        whiteSpace: "pre-line",
        textShadow: `0 0 60px ${slide.accent}44`
      }}>{slide.title}</h1>

        <div style={{
        width: 40,
        height: 2,
        background: `linear-gradient(90deg,${slide.accent},transparent)`,
        borderRadius: 999,
        marginBottom: 20
      }} />

        <p style={{
        fontSize: "clamp(13px,3.5vw,16px)",
        lineHeight: 1.75,
        color: "rgba(255,255,255,0.45)",
        fontWeight: 300,
        marginBottom: 36
      }}>{slide.sub}</p>

        <div style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap"
      }}>
          {slide.final ? <button className="btn-primary" onClick={finish} style={{
          fontSize: 13,
          padding: "14px 36px"
        }}>
              BEGIN MISSION →
            </button> : <>
              <button className="btn-primary" onClick={() => go(idx + 1)} style={{
            fontSize: 13,
            padding: "14px 36px"
          }}>
                NEXT →
              </button>
              <button onClick={finish} style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.2)",
            fontSize: 11,
            letterSpacing: 1.5,
            cursor: "pointer",
            textTransform: "uppercase",
            padding: "14px 0"
          }}>
                Skip Tour
              </button>
            </>}
        </div>

        <div style={{
        marginTop: 24,
        fontSize: 10,
        letterSpacing: 2,
        color: "rgba(255,255,255,0.15)",
        textTransform: "uppercase"
      }}>
          {idx + 1} / {total}
        </div>
      </div>
    </div>;
}

/* ─── CUSTOM CURSOR ──────────────────────────────────────────────────────── */
function CustomCursor() {
  // Don't render on touch devices — cursor:none breaks UX on mobile
  const isTouch = typeof window !== "undefined" && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const dotRef = useRef(null),
    ringRef = useRef(null);
  const pos = useRef({
      x: 0,
      y: 0
    }),
    ring = useRef({
      x: 0,
      y: 0
    });
  useEffect(() => {
    if (isTouch) return;
    const trails = Array.from({
      length: 7
    }, (_, i) => {
      const el = document.createElement("div");
      el.style.cssText = `position:fixed;pointer-events:none;z-index:9998;width:${7 - i}px;height:${7 - i}px;border-radius:50%;background:rgba(255,155,40,${.18 - i * .022});transform:translate(-50%,-50%);`;
      document.body.appendChild(el);
      return {
        el,
        x: 0,
        y: 0
      };
    });
    const onMove = e => {
      pos.current = {
        x: e.clientX,
        y: e.clientY
      };
      if (dotRef.current) {
        dotRef.current.style.left = e.clientX + "px";
        dotRef.current.style.top = e.clientY + "px";
        dotRef.current.style.opacity = "1";
      }
      if (ringRef.current) ringRef.current.style.opacity = "1";
    };
    const onDown = () => {
      if (dotRef.current) dotRef.current.style.transform = "translate(-50%,-50%) scale(0.5)";
    };
    const onUp = () => {
      if (dotRef.current) dotRef.current.style.transform = "translate(-50%,-50%) scale(1)";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    let raf;
    const animate = () => {
      ring.current.x += (pos.current.x - ring.current.x) * .1;
      ring.current.y += (pos.current.y - ring.current.y) * .1;
      if (ringRef.current) {
        ringRef.current.style.left = ring.current.x + "px";
        ringRef.current.style.top = ring.current.y + "px";
      }
      let px = pos.current.x,
        py = pos.current.y;
      trails.forEach((tr, i) => {
        tr.x += (px - tr.x) * (.28 - i * .03);
        tr.y += (py - tr.y) * (.28 - i * .03);
        tr.el.style.left = tr.x + "px";
        tr.el.style.top = tr.y + "px";
        px = tr.x;
        py = tr.y;
      });
      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(raf);
      trails.forEach(tr => tr.el.remove());
    };
  }, []);
  if (isTouch) return null;
  return <>
    <div ref={dotRef} style={{
      position: "fixed",
      pointerEvents: "none",
      zIndex: 9999,
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "#ff9500",
      boxShadow: "0 0 10px #ff9500,0 0 22px rgba(255,149,0,.5)",
      transform: "translate(-50%,-50%)",
      transition: "transform .1s ease",
      opacity: 0
    }} />
    <div ref={ringRef} style={{
      position: "fixed",
      pointerEvents: "none",
      zIndex: 9998,
      width: 30,
      height: 30,
      borderRadius: "50%",
      border: "1px solid rgba(255,149,0,.45)",
      transform: "translate(-50%,-50%)",
      opacity: 0
    }} />
  </>;
}

/* ─── GLOBAL CSS ─────────────────────────────────────────────────────────── */
/* Font loading (Orbitron/Inter/JetBrains Mono/Space Mono/Space Grotesk) moved
   to index.html <head> as <link> tags — see setup note. A `@import` here used
   to be a major LCP hit: this whole <style> only reaches the DOM after the
   JS bundle has downloaded, parsed, and React has committed its first
   render, so the browser couldn't even discover the font request until then.
   Putting <link rel="preconnect"> + <link rel="stylesheet"> in the HTML
   <head> lets the browser start fetching fonts immediately, in parallel
   with the JS bundle, instead of after it. */
const G = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
svg{background:transparent!important;overflow:visible;}

/* ── THEME VARIABLES ── */
:root{
  --bg:#07040a;
  --bg2:#0d0910;
  --bg3:#130e18;
  --surface:rgba(255,140,0,.06);
  --surface2:rgba(255,255,255,.025);
  --surface3:rgba(255,255,255,.04);
  --border:rgba(255,140,0,.12);
  --border2:rgba(255,255,255,.07);
  --border3:rgba(255,140,0,.22);
  --text:#ffffff;
  --text2:rgba(255,255,255,.62);
  --text3:rgba(255,255,255,.28);
  --text4:rgba(255,255,255,.15);
  --accent:#ff8c00;
  --accent2:#ffb347;
  --accent3:rgba(255,140,0,.08);
  --accent4:rgba(255,180,80,.65);
  --glass-bg:linear-gradient(135deg,rgba(255,140,0,.06) 0%,rgba(255,60,0,.02) 100%);
  --glass-before:rgba(255,255,255,.03);
  --nav-text:rgba(255,170,60,.4);
  --tag-bg:rgba(255,140,0,.08);
  --tag-border:rgba(255,140,0,.18);
  --tag-text:rgba(255,180,80,.65);
  --input-bg:rgba(255,255,255,.025);
  --input-border:rgba(255,140,0,.12);
  --input-placeholder:rgba(255,255,255,.15);
  --selection:#ff8c0030;
  --danger:rgba(255,50,50,.18);
  --danger-text:rgba(255,80,80,.35);
  --shadow:rgba(0,0,0,.5);
  --gradient-text:linear-gradient(135deg,#ffffff 0%,#ffcc00 60%,#ff9500 100%);
}

html{scroll-behavior:auto;overflow-x:hidden;width:100%;margin:0;padding:0;box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none;}
html::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;overflow-x:hidden;overflow-y:auto;cursor:auto;width:100%;max-width:100%;min-height:100vh;margin:0;padding:0;scrollbar-width:none;-ms-overflow-style:none;transition:background .35s ease,color .35s ease;}
body::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}
*{scrollbar-width:none;-ms-overflow-style:none;}
button,a,[role="button"]{cursor:pointer;}
input,textarea{cursor:text;}
input{background:transparent;}
@media (hover:none),(pointer:coarse){body,*{cursor:auto!important;}}
*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}
::selection{background:var(--selection);}
.glass{background:var(--glass-bg);border:1px solid var(--border);border-radius:18px;backdrop-filter:blur(16px);position:relative;overflow:hidden;}
.glass::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--glass-before) 0%,transparent 60%);pointer-events:none;border-radius:18px;}
.btn-primary{background:linear-gradient(135deg,#ff9500,#ff4d00);border:none;color:#fff;padding:14px 40px;border-radius:999px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:.3px;cursor:pointer;transition:all .35s cubic-bezier(.16,1,.3,1);box-shadow:0 0 40px rgba(255,140,0,.35),0 4px 24px var(--shadow);position:relative;overflow:hidden;white-space:nowrap;}
.btn-primary::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.18),transparent);opacity:0;transition:opacity .3s;border-radius:999px;}
.btn-primary:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 0 60px rgba(255,140,0,.55),0 8px 32px var(--shadow);}
.btn-primary:hover::after{opacity:1;}.btn-primary:active{transform:scale(.98);}.btn-primary:disabled{opacity:.3;transform:none!important;}
.btn-ghost{background:var(--accent3);border:1px solid var(--border3);color:var(--accent4);padding:14px 40px;border-radius:999px;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .3s;white-space:nowrap;}
.btn-ghost:hover{background:rgba(255,140,0,.14);border-color:rgba(255,140,0,.5);color:var(--accent2);transform:translateY(-1px);}
.syn-textarea{width:100%;background:var(--input-bg);border:1px solid var(--input-border);border-radius:12px;color:var(--text);font-family:'Inter',sans-serif;font-size:15px;font-weight:300;padding:22px;outline:none;resize:none;line-height:1.85;transition:all .4s;caret-color:var(--accent);cursor:text;}
.syn-textarea:focus{border-color:var(--border3);background:var(--accent3);box-shadow:0 0 0 4px rgba(255,140,0,.07),0 0 40px rgba(255,140,0,.06);}
.syn-textarea::placeholder{color:var(--input-placeholder);}
.nav-pill{background:transparent;border:1px solid var(--border);color:var(--nav-text);padding:8px 20px;border-radius:999px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:.8px;cursor:pointer;transition:all .25s;text-transform:uppercase;}
.nav-pill:hover,.nav-pill.active{border-color:rgba(255,140,0,.55);color:var(--accent2);background:var(--accent3);}
.nav-pill.danger{border-color:var(--danger);color:var(--danger-text);}
.nav-pill.danger:hover{border-color:rgba(255,50,50,.55);color:#ff6060;background:rgba(255,50,50,.08);}
/* Testimonials marquee — continuous left-scroll, pauses on hover */
.testi-viewport{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);}
.testi-track{display:flex;gap:16px;width:max-content;animation:testiScroll 46s linear infinite;}
.testi-track:hover{animation-play-state:paused;}
.testi-card{width:300px;flex-shrink:0;background:rgba(255,140,0,0.025);border:1px solid rgba(255,140,0,0.12);border-radius:16px;padding:22px 20px;display:flex;flex-direction:column;}
@keyframes testiScroll{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
/* Icon hidden everywhere by default (mobile/tablet) — desktop media query below re-enables it for the active tab only. */
.nav-pill-icon{display:none;}
/* Desktop-only nav upgrade: unified segmented track, glow on active tab only. Mobile/tablet untouched. */
@media (min-width:768px){
  .nav-tabs-row{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:5px;gap:2px !important;display:inline-flex !important;width:fit-content;}
  .light .nav-tabs-row{background:rgba(0,0,0,.02);border-color:rgba(0,0,0,.06);}
  nav .nav-pill{border:none !important;background:transparent !important;padding:9px 16px !important;border-radius:10px !important;color:rgba(255,255,255,.45);font-weight:500;}
  .light nav .nav-pill{color:rgba(26,26,26,.5) !important;}
  nav .nav-pill.active{padding:9px 18px !important;background:linear-gradient(135deg,rgba(255,140,0,.2),rgba(255,140,0,.06)) !important;box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 0 16px rgba(255,140,0,.14);color:#ffb35a !important;font-weight:600;}
  .light nav .nav-pill.active{color:#c05a00 !important;}
  nav .nav-pill.active .nav-pill-icon{display:inline-flex;margin-right:6px;vertical-align:-2px;}
}
.tag{display:inline-flex;align-items:center;gap:8px;background:var(--tag-bg);border:1px solid var(--tag-border);border-radius:999px;padding:6px 16px;font-size:11px;font-weight:500;letter-spacing:1.2px;color:var(--tag-text);text-transform:uppercase;}
.tag .d{width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 7px var(--accent);flex-shrink:0;}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes slideUp{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}
@keyframes fadeUp{from{opacity:0;transform:translateY(32px);}to{opacity:1;transform:translateY(0);}}
@keyframes scaleIn{from{opacity:0;transform:scale(.93);}to{opacity:1;transform:scale(1);}}
@keyframes shimmer{from{transform:translateX(-100%);}to{transform:translateX(200%)}}
@keyframes ringOut{from{transform:scale(.7) translate(50%,-50%);opacity:.7;}to{transform:scale(2.6) translate(50%,-50%);opacity:0;}}
@keyframes dotBlink{0%,100%{opacity:.2;transform:scale(.7);}50%{opacity:1;transform:scale(1.1);}}
@keyframes marqueeAnim{from{transform:translateX(0);}to{transform:translateX(-50%)}}
@keyframes scanLine{0%{top:-1px;}100%{top:100%;}}
@keyframes borderGlow{0%,100%{box-shadow:0 0 20px rgba(255,140,0,.1);}50%{box-shadow:0 0 50px rgba(255,140,0,.25),inset 0 0 30px rgba(255,140,0,.03);}}
@keyframes shakeX{0%,100%{transform:translateX(0);}15%{transform:translateX(-8px);}30%{transform:translateX(7px);}45%{transform:translateX(-6px);}60%{transform:translateX(5px);}75%{transform:translateX(-3px);}90%{transform:translateX(2px);}}
@keyframes glitch1{0%,90%,100%{clip-path:none;transform:none;}91%{clip-path:polygon(0 15%,100% 15%,100% 30%,0 30%);transform:translateX(-4px);}93%{clip-path:polygon(0 60%,100% 60%,100% 75%,0 75%);transform:translateX(4px);}95%{clip-path:polygon(0 40%,100% 40%,100% 55%,0 55%);transform:translateX(-2px);}97%{clip-path:none;transform:translateX(1px);}}
@keyframes glitch2{0%,88%,100%{clip-path:none;transform:none;opacity:0;}89%{clip-path:polygon(0 20%,100% 20%,100% 35%,0 35%);transform:translateX(6px);opacity:.7;}92%{clip-path:polygon(0 65%,100% 65%,100% 80%,0 80%);transform:translateX(-6px);opacity:.5;}95%{opacity:0;}}
@keyframes termCursor{0%,49%{opacity:1;}50%,100%{opacity:0;}}
@keyframes pulseRing{0%{transform:scale(1);opacity:.6;}100%{transform:scale(2.4);opacity:0;}}
@keyframes tagGlow{0%,100%{box-shadow:0 0 0 rgba(255,120,0,0);}50%{box-shadow:0 0 18px rgba(255,120,0,.25);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes blink{0%,49%{opacity:1;}50%,100%{opacity:0;}}
@keyframes pulse{0%,100%{box-shadow:0 0 8px #ff3333;}50%{box-shadow:0 0 20px #ff3333,0 0 40px #ff333388;}}
.s1{animation:fadeUp .7s cubic-bezier(.16,1,.3,1) .05s both;}
.s2{animation:fadeUp .7s cubic-bezier(.16,1,.3,1) .15s both;}
.s3{animation:fadeUp .7s cubic-bezier(.16,1,.3,1) .25s both;}
.s4{animation:fadeUp .7s cubic-bezier(.16,1,.3,1) .35s both;}
.s5{animation:fadeUp .7s cubic-bezier(.16,1,.3,1) .45s both;}
input{cursor:text;background:transparent;}
input::placeholder{color:var(--input-placeholder);}
input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;}

/* ── LIGHT MODE OVERRIDES ── */
.light [style*="background:\"#07040a\""],.light [style*='background:"#07040a"']{background:var(--bg)!important;}
.light [style*="color:\"#fff\""],.light [style*="color:\"rgba(255,255,255"]{color:var(--text)!important;}
.light [style*="rgba(7,4,10"]{--dark-surface:rgba(230,224,238,0.9);}
.light canvas{opacity:.45;filter:sepia(.2) saturate(1.3) brightness(1.08) hue-rotate(-5deg);mix-blend-mode:multiply;}
.light .glass{background:var(--glass-bg)!important;border-color:var(--border)!important;box-shadow:0 1px 2px rgba(80,50,20,.04),0 8px 24px -8px rgba(80,50,20,.12),inset 0 1px 0 rgba(255,255,255,.8)!important;}
.light .glass::before{background:linear-gradient(135deg,rgba(255,255,255,.55) 0%,transparent 60%)!important;}
.light .syn-textarea{color:var(--text)!important;background:var(--input-bg)!important;box-shadow:inset 0 1px 3px rgba(80,50,20,.05)!important;}
.light .syn-textarea::placeholder{color:var(--input-placeholder)!important;}
.light .tag{background:var(--tag-bg)!important;border-color:var(--tag-border)!important;color:var(--tag-text)!important;}
.light .tag .d{background:var(--accent)!important;box-shadow:0 0 7px var(--accent)!important;}
.light .btn-ghost{background:var(--accent3)!important;border-color:var(--border3)!important;color:var(--accent4)!important;}
.light .btn-primary{box-shadow:0 2px 8px rgba(184,84,15,.25),0 8px 28px -6px rgba(184,84,15,.4)!important;}
.light .nav-pill{border-color:var(--border)!important;color:var(--nav-text)!important;}
.light .nav-pill:hover,.light .nav-pill.active{border-color:var(--border3)!important;color:var(--accent2)!important;background:var(--accent3)!important;}

/* Light mode — screen backgrounds */
.light [style*="minHeight:\"100vh\""]{background:var(--bg)!important;}
.light [style*="background:\"rgba(7,4,10"]{background:var(--bg)!important;}

/* Light mode — text color overrides for major text elements */
.light [style*="color:\"rgba(255,255,255,.62)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.28)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.15)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.5)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.4)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.3)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.7)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.65)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.6)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.58)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.75)\""]{color:var(--text)!important;}
.light [style*="color:\"rgba(255,255,255,.8)\""]{color:var(--text)!important;}
.light [style*="color:\"rgba(255,255,255,.25)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.2)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.35)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.45)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.55)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.85)\""]{color:var(--text)!important;}
.light [style*="color:\"rgba(255,255,255,.9)\""]{color:var(--text)!important;}
.light [style*="color:\"rgba(255,255,255,.1)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.12)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.05)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.18)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.16)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,255,255,.42)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.22)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.32)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,255,255,.48)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,255,255,.52)\""]{color:var(--text2)!important;}
.light [style*="color:\"#fff\""]{color:var(--text)!important;}
/* orange/amber faint text → dark in light mode */
.light [style*="color:\"rgba(255,180,80,.4)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,180,80,.5)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,180,80,.6)\""]{color:var(--text2)!important;}
.light [style*="color:\"rgba(255,140,0,.3)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,140,0,.2)\""]{color:var(--text4)!important;}
.light [style*="color:\"rgba(255,140,0,.35)\""]{color:var(--text3)!important;}
.light [style*="color:\"rgba(255,140,0,.45)\""]{color:var(--text3)!important;}
/* letter-spacing labels, small uppercase tags */
.light [style*="letterSpacing"][style*="color:\"rgba(255,255,255"]{color:var(--text3)!important;}
.light [style*="letterSpacing"][style*="color:\"rgba(255,180,80"]{color:var(--text3)!important;}
.light [style*="letterSpacing"][style*="color:\"rgba(255,140,0"]{color:var(--text3)!important;}

/* Light mode — THE CRITICAL FIX: gradient text headings were white→orange,
   invisible on a light background. Force them to a deep charcoal→burnt-amber
   gradient instead — this is what was making everything look washed out/inverted. */
.light [style*="WebkitTextFillColor:\"transparent\""]{
  background:var(--gradient-text)!important;
  -webkit-background-clip:text!important;
  background-clip:text!important;
}

/* Light mode — surface/card backgrounds */
.light [style*="background:\"rgba(255,255,255,.025)\""]{background:rgba(40,28,16,.035)!important;}
.light [style*="background:\"rgba(255,255,255,.04)\""]{background:rgba(40,28,16,.045)!important;}
.light [style*="background:\"rgba(255,255,255,.03)\""]{background:rgba(40,28,16,.035)!important;}
.light [style*="border:\"1px solid rgba(255,255,255,.07)\""]{border-color:rgba(40,28,16,.1)!important;}
.light [style*="border:\"1px solid rgba(255,255,255,.08)\""]{border-color:rgba(40,28,16,.11)!important;}

/* Light mode — gradient lock overlay in BattlePlanPreview */
.light [style*="rgba(7,4,10,1)"]{background:linear-gradient(0deg,var(--bg) 0%,rgba(250,247,242,.92) 40%,rgba(250,247,242,0) 100%)!important;}

/* Light mode — premium colorful gradient mesh, visible throughout the page (not just top) */
.light body{
  background:
    radial-gradient(ellipse 55% 45% at 12% 0%, rgba(224,84,15,.12), transparent 60%),
    radial-gradient(ellipse 45% 40% at 92% 10%, rgba(232,85,47,.1), transparent 60%),
    radial-gradient(ellipse 50% 55% at 50% 105%, rgba(10,143,128,.06), transparent 65%),
    linear-gradient(160deg,#f7f5f2 0%,#efebe4 55%,#e6dfd3 100%);
  background-attachment:fixed;
}

/* ── CHECK-IN HERO NUMBER (all screen sizes) ──
   The huge streak digit was flat white, which at clamp(72px,16vw,200px) on
   desktop reads as a plain pale block with no depth — this is what looked
   "broken" on Day 0. Amber/gold gradient + glow matches the brand and gives
   it real weight instead of a flat slab. Previously this was only applied
   inside the ≤768px mobile block; desktop never got it. */
.ci-num{
  background:linear-gradient(135deg,#ffd24d 0%,#ff9500 48%,#ff5000 100%) !important;
  -webkit-background-clip:text !important;background-clip:text !important;
  -webkit-text-fill-color:transparent !important;color:transparent !important;
  text-shadow:none !important;
  filter:drop-shadow(0 0 22px rgba(255,140,0,.45)) drop-shadow(0 2px 6px rgba(255,80,0,.25)) !important;
}

/* ── MOBILE RESPONSIVE ── */
.step-inner{box-sizing:border-box;width:100%;}
.archetype-grid{box-sizing:border-box;}
@media(max-width:700px){
  .archetype-grid{grid-template-columns:1fr 1fr!important;gap:10px!important;}
  .archetype-grid>div{min-height:clamp(220px,55vw,280px)!important;}
}
@media(max-width:380px){
  .archetype-grid{grid-template-columns:1fr 1fr!important;}
}
.addiction-grid{box-sizing:border-box;}

@media(max-width:768px){
  /* ── Nav ── (breathable pills — see MOBILE POLISH PASS below for the
     scroll/fade treatment; padding intentionally roomy now that the tab row
     scrolls horizontally instead of cramming to fit) */
  nav .nav-pill{padding:9px 16px !important;font-size:10px !important;letter-spacing:.5px !important;}
  .nav-logo-text div:last-child{display:none !important;} /* hide "RESET · REWIRE · RECONQUER" */
  .report-issue-pill{padding:9px 12px !important;border-radius:50% !important;width:34px;height:34px;justify-content:center;}
  .report-issue-text{display:none;}

  /* ── Global heading scale ── */
  /* Force all Orbitron giant headings to scale down */
  [style*="font-size:clamp"]{font-size:clamp(28px,8vw,48px);}

  /* ── Confess-flow glitch headlines (WHO ARE.../WHAT ARE.../TELL THE...) ── */
  /* Previous mobile size (38-64px) with the desktop -3px letter-spacing
     still applied made these read cramped/glitchy instead of bold — the
     -3px spacing was tuned for the much larger desktop sizes (84-104px)
     and is too tight once the font shrinks down for phones. Bumped the
     size up and loosened the tracking specifically on mobile. */
  .glitch-hl{font-size:clamp(44px,13vw,76px)!important;letter-spacing:-1.5px!important;}

  /* ── Boot page ── */
  .boot-inner{padding:110px 5vw 60px !important;}

  /* ── Confess steps ── */
  .step-inner{padding:110px 5vw 60px !important;}
  .step-bar{padding:0 4vw !important;}
  .step-label{display:none !important;}

  /* ── Grids ── */
  .addiction-grid{grid-template-columns:1fr 1fr !important;gap:8px !important;}

  /* ── Content pads ── */
  .content-pad{padding:100px 5vw 80px !important;}
  .hero-pad{padding:84px 5vw 32px !important;}

  /* ── Streak number ── */
  .streak-num{font-size:clamp(72px,20vw,120px) !important;}

  /* ── Auth ── */
  .auth-wrap{padding:60px 5vw !important;max-width:100% !important;}

  /* ── Buttons ── */
  .btn-primary{padding:13px 24px !important;font-size:12px !important;}
  .btn-ghost{padding:13px 24px !important;font-size:12px !important;}

  /* ── Footer ── */
  .footer-wrap{padding:20px 5vw !important;flex-direction:column !important;gap:10px !important;}

  /* ── Emergency SOS button — keep small AND lift it clear of the bottom
     check-in reminder / marquee bar so it never overlaps them (was bottom:18px
     which sat right on top of the "⏳ … left to check in" bar on load). ── */
  .sos-btn,button[style*="I'm Struggling"],button[style*="Struggling"]{
    padding:8px 14px !important;font-size:8px !important;letter-spacing:0.5px !important;gap:5px !important;
    bottom:88px !important;right:16px !important;
  }

  /* ══ MOBILE POLISH PASS (≤768px only — desktop untouched) ══ */

  /* ── NAV: smooth horizontal scroll with wider fade-edge gradients on the
     tabs row (pills overflow now that padding is roomier — the row scrolls
     instead of shrinking the pills) ── */
  .nav-tabs-row{position:relative;scroll-behavior:smooth;scroll-snap-type:x proximity;gap:9px !important;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%);}
  .nav-tabs-row .nav-pill{scroll-snap-align:start;}
  /* Tap targets: keep pills tall enough to hit comfortably (~40px) */
  nav .nav-pill{min-height:38px;display:inline-flex;align-items:center;}

  /* ── ADMIN DASHBOARD ── */
  .admin-header{padding:12px 16px !important;flex-wrap:wrap;gap:8px;}
  .admin-header-sub{display:none !important;}      /* drop "Founders Dashboard — Confidential" subtitle */
  .admin-updated{display:none !important;}          /* drop timestamp + loading text — refresh button conveys state */
  .admin-header-actions{gap:6px !important;}
  .admin-tabs{padding:0 12px !important;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 12px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 12px),transparent 100%);}
  .admin-tabs button{padding:12px 12px !important;min-height:44px;}
  /* Stat cards: 2-up grid instead of a cramped 4-wide flex-wrap */
  .admin-stat-row{display:grid !important;grid-template-columns:1fr 1fr !important;gap:8px !important;}
  .admin-stat-card{min-width:0 !important;padding:14px 14px !important;}

  /* ── ABOUT PAGE: tighten the tall section rhythm, consistent side padding ── */
  section[data-asec]{padding-top:clamp(44px,10vw,64px) !important;padding-bottom:clamp(44px,10vw,64px) !important;padding-left:22px !important;padding-right:22px !important;}
  section[data-asec="hero"]{min-height:78vh !important;}
  section[data-asec="cta"]{min-height:58vh !important;}

  /* ══ CHECK-IN SCREEN ONLY (ci-* classes are used exclusively in the Checkin
        component's hero — no other screen carries them, so desktop and every
        other screen are untouched) ══ */

  /* 1 ─ (gradient treatment now applied globally above, not just here) */

  /* 2 ─ Standardized vertical rhythm between the stacked hero elements so the
        badge row → number → label → level → progress → signal card read as an
        even sequence instead of the uneven 20/12/24/32 desktop spacing */
  .ci-badgerow{margin-bottom:12px !important;}
  .ci-num{margin-bottom:4px !important;}
  .ci-daysclean{margin-bottom:14px !important;}
  .ci-level{margin-bottom:18px !important;}
  .ci-progress{margin-top:2px !important;}
  /* tighten the gap between the hero and the Today's Signal card, and reserve
     bottom room so the lifted SOS button never covers the trailing buttons */
  .ci-body{padding-top:22px !important;padding-bottom:104px !important;}
  .ci-quote{margin-bottom:18px !important;}

  /* 3 ─ Check-in reminder bar: give the right edge breathing room (belt-and-
        suspenders in case the raised SOS ever drifts near it) */
  .ci-reminder{padding-right:16px !important;}
}

@media(max-width:480px){
  /* ── Single column grids ── */
  .addiction-grid{grid-template-columns:1fr !important;}

  /* ── Nav pills — stay breathable; the row scrolls horizontally so pills
     don't need to shrink to fit ── */
  nav .nav-pill{padding:9px 15px !important;font-size:10px !important;}

  /* ── Body text — enforce readable sizes ── */
  p{font-size:13px !important;line-height:1.75 !important;}

  /* ── Input fields — prevent iOS zoom (must be 16px+) ── */
  input,textarea{font-size:16px !important;}

  /* ── Section tag pills ── */
  [style*="letterSpacing:2.5"]{font-size:8px !important;}
  [style*='letterSpacing:"2.5']{font-size:8px !important;}

  /* ── ABOUT: single-column all multi-col grids at phone width ── */
  section[data-asec] [style*="grid-template-columns"],
  section[data-asec] [style*="gridTemplateColumns"]{grid-template-columns:1fr !important;}
  /* Keep the Traditional-vs-Synapse comparison table 2-col (it's meant to compare side by side) */
  section[data-asec="diff"] [style*="1fr 1fr"]{grid-template-columns:1fr 1fr !important;}

  /* ── Admin body padding — reclaim edge space ── */
  .admin-stat-row{gap:8px !important;}
}

@media(max-width:380px){
  nav .nav-pill{padding:8px 13px !important;font-size:9px !important;letter-spacing:.3px !important;}
  /* Stat cards stack to a single column on the narrowest phones */
  .admin-stat-row{grid-template-columns:1fr !important;}
}
`;

/* ─── NAV ────────────────────────────────────────────────────────────────── */
// Capture install prompt ASAP — before React even mounts
// Must be at module level so it fires before useEffect
if (typeof window !== "undefined") {
  window.__installPrompt = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    window.__installPrompt = e;
  });
}

// ─── NOTIFICATION PERMISSION PROMPT ─────────────────────────────────────────
// ─── MISSED-DAY LIFELINE PROMPT ──────────────────────────────────────────────
function LifelinePrompt({
  theme,
  missedDays,
  onUse,
  onDecline
}) {
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 1150,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "0 0 24px"
  }}>
      {/* No backdrop dismiss — this decision matters, don't let it get swiped away by accident */}
      <div style={{
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.65)",
      backdropFilter: "blur(8px)"
    }} />
      <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 480,
      background: "#0d0b14",
      border: "1px solid rgba(255,140,0,0.25)",
      borderRadius: 24,
      padding: "28px 24px 24px",
      margin: "0 16px",
      animation: "slideUp .4s cubic-bezier(.16,1,.3,1)",
      boxShadow: "0 -4px 40px rgba(255,140,0,0.15)"
    }}>
        <div style={{
        width: 52,
        height: 52,
        borderRadius: 14,
        background: "linear-gradient(135deg,#44ddff,#2299cc)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
        fontSize: 24
      }}>🛡️</div>
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: 15,
        fontWeight: 800,
        color: "var(--text)",
        letterSpacing: .5,
        marginBottom: 8
      }}>You Missed {missedDays} Day{missedDays > 1 ? "s" : ""}</div>
        <div style={{
        fontSize: 13,
        color: "var(--text3)",
        lineHeight: 1.7,
        marginBottom: 20
      }}>
          Your streak is about to reset. You have <strong style={{
          color: "#44ddff"
        }}>one lifeline this month</strong> — use it to forgive the gap and keep your streak alive, no questions asked.
        </div>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}>
          <button onClick={onUse} style={{
          padding: "14px",
          borderRadius: 14,
          background: "linear-gradient(135deg,#44ddff,#2299cc)",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(68,221,255,0.35)"
        }}>
            🛡️ Use My Lifeline — Keep Streak
          </button>
          <button onClick={onDecline} style={{
          padding: "14px 18px",
          borderRadius: 14,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--text3)",
          fontSize: 13,
          cursor: "pointer"
        }}>
            No — reset my streak
          </button>
        </div>
        <div style={{
        marginTop: 14,
        fontSize: 10,
        color: "var(--text4)",
        textAlign: "center"
      }}>One lifeline available per calendar month.</div>
      </div>
    </div>;
}
function NotifPrompt({
  theme,
  onAllow,
  onDismiss
}) {
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 1100,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "0 0 24px"
  }}>
      <div onClick={onDismiss} style={{
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(8px)"
    }} />
      <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 480,
      background: "#0d0b14",
      border: "1px solid rgba(255,140,0,0.2)",
      borderRadius: 24,
      padding: "28px 24px 24px",
      margin: "0 16px",
      animation: "slideUp .4s cubic-bezier(.16,1,.3,1)",
      boxShadow: "0 -4px 40px rgba(255,140,0,0.1)"
    }}>
        <div style={{
        width: 52,
        height: 52,
        borderRadius: 14,
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
        fontSize: 24
      }}>🔔</div>
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: 15,
        fontWeight: 800,
        color: "var(--text)",
        letterSpacing: .5,
        marginBottom: 8
      }}>Stay on Track</div>
        <div style={{
        fontSize: 13,
        color: "var(--text3)",
        lineHeight: 1.7,
        marginBottom: 24
      }}>
          Enable notifications to get daily check-in reminders and streak alerts — even when SYNAPSE is closed.
        </div>
        <div style={{
        display: "flex",
        gap: 10
      }}>
          <button onClick={onAllow} style={{
          flex: 1,
          padding: "14px",
          borderRadius: 14,
          background: "linear-gradient(135deg,#ff9500,#ff5000)",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(255,140,0,0.35)"
        }}>
            🔔 Enable Notifications
          </button>
          <button onClick={onDismiss} style={{
          padding: "14px 18px",
          borderRadius: 14,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--text3)",
          fontSize: 13,
          cursor: "pointer"
        }}>
            Later
          </button>
        </div>
      </div>
    </div>;
}

// ─── FCM FOREGROUND TOAST ────────────────────────────────────────────────────
function FcmToast({
  toast,
  theme
}) {
  if (!toast) return null;
  return <div style={{
    position: "fixed",
    top: 80,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1200,
    maxWidth: 380,
    width: "calc(100% - 32px)",
    background: "rgba(13,11,20,0.97)",
    border: "1px solid rgba(255,140,0,0.25)",
    borderRadius: 16,
    padding: "14px 18px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    animation: "fadeUp .4s cubic-bezier(.16,1,.3,1)",
    display: "flex",
    gap: 12,
    alignItems: "flex-start"
  }}>
      <div style={{
      width: 36,
      height: 36,
      borderRadius: 10,
      background: "linear-gradient(135deg,#ff9500,#ff5000)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }}>
        <span style={{
        fontSize: 18
      }}>⚡</span>
      </div>
      <div style={{
      flex: 1,
      minWidth: 0
    }}>
        <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: "var(--text)",
        marginBottom: 3
      }}>{toast.title}</div>
        <div style={{
        fontSize: 12,
        color: "var(--text3)",
        lineHeight: 1.5
      }}>{toast.body}</div>
      </div>
    </div>;
}

// ─── PWA INSTALL PROMPT ──────────────────────────────────────────────────────
function InstallPrompt({
  theme,
  onInstall,
  onDismiss
}) {
  const [installing, setInstalling] = useState(false);
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 1100,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "0 0 24px"
  }}>
      {/* Backdrop */}
      <div onClick={onDismiss} style={{
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(8px)"
    }} />
      {/* Card */}
      <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 480,
      background: "#0d0b14",
      border: "1px solid rgba(255,140,0,0.2)",
      borderRadius: 24,
      padding: "28px 24px 24px",
      margin: "0 16px",
      animation: "slideUp .4s cubic-bezier(.16,1,.3,1)",
      boxShadow: "0 -4px 40px rgba(255,140,0,0.1)"
    }}>
        {/* Icon */}
        <div style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 18,
        boxShadow: "0 8px 24px rgba(255,140,0,0.35)"
      }}>
          <span style={{
          fontSize: 28
        }}>⚡</span>
        </div>
        {/* Text */}
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: 16,
        fontWeight: 800,
        color: "var(--text)",
        letterSpacing: .5,
        marginBottom: 8
      }}>Add SYNAPSE to Home Screen</div>
        <div style={{
        fontSize: 13,
        color: "var(--text3)",
        lineHeight: 1.7,
        marginBottom: 24
      }}>
          Install SYNAPSE for instant access — faster check-ins, no browser bar, feels like a real app.
        </div>
        {/* Buttons */}
        <div style={{
        display: "flex",
        gap: 12
      }}>
          <button onClick={async () => {
          setInstalling(true);
          await onInstall();
          setInstalling(false);
        }} style={{
          flex: 1,
          padding: "14px",
          borderRadius: 14,
          background: "linear-gradient(135deg,#ff9500,#ff5000)",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: "0 4px 16px rgba(255,140,0,0.35)"
        }}>
            {installing ? <div style={{
            width: 16,
            height: 16,
            border: "2px solid rgba(255,255,255,0.3)",
            borderTop: "2px solid #fff",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite"
          }} /> : "📲 Install App"}
          </button>
          <button onClick={onDismiss} style={{
          padding: "14px 20px",
          borderRadius: 14,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--text3)",
          fontSize: 13,
          cursor: "pointer"
        }}>
            Later
          </button>
        </div>
        {/* iOS fallback hint */}
        <div style={{
        marginTop: 14,
        fontSize: 10,
        color: "var(--text4)",
        textAlign: "center",
        lineHeight: 1.6
      }}>
          On iPhone? Tap <strong style={{
          color: "rgba(255,180,80,0.7)"
        }}>Share →</strong> then <strong style={{
          color: "rgba(255,180,80,0.7)"
        }}>Add to Home Screen</strong>
        </div>
      </div>
    </div>;
}

// ─── ADMIN DASHBOARD ────────────────────────────────────────────────────────
const ADMIN_UIDS = ["r2JKcDHrBOgGD1A14M9ugGQ6rzc2", "U79EcPjqUeXsZOP80uXO0NqcNNp2"]; // Parth + Lily

function AdminDashboard({
  theme,
  onClose
}) {
  // Load from cache instantly
  const getCached = () => {
    try {
      const c = sessionStorage.getItem("syn_admin_cache");
      if (c) {
        const p = JSON.parse(c);
        return p;
      }
    } catch (e) {}
    return null;
  };
  const cached = getCached();
  const [users, setUsers] = useState(cached?.users || []);
  const [checkins, setCheckins] = useState(cached?.checkins || []);
  const [feedbacks, setFeedbacks] = useState(cached?.feedbacks || []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState("7d");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userSearch, setUserSearch] = useState("");
  const [dbError, setDbError] = useState(false);
  const [lastFetchError, setLastFetchError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(cached?.ts ? new Date(cached.ts) : null);
  const bg = "#09070f";
  const card = "rgba(255,255,255,0.03)";
  const bdr = "rgba(255,255,255,0.07)";
  const acc = "#ff9500";
  const txt = "rgba(255,255,255,0.88)";
  const txt2 = "rgba(255,255,255,0.38)";
  const green = "#4ade80";
  const amber = "#fbbf24";
  const red = "#f87171";
  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);else if (!cached) setLoading(true);
    setDbError(false);
    setLastFetchError("");
    try {
      if (!db) throw new Error("db undefined");
      // Bug fix: these getDocs() calls previously had no timeout. If any one
      // of them hung (flaky connection, Firestore rules rejecting silently,
      // cold connection on first load), Promise.all never resolved OR
      // rejected — meaning the finally{} block below never ran either, so
      // the loading/refreshing spinner stayed on forever AND no fresh data
      // ever arrived, with no error surfaced. Racing against a timeout
      // guarantees this always settles one way or the other.
      // Bug fix 2: a single 10s timeout was too aggressive for a cold
      // Firestore connection (first load of the session), causing this to
      // fall back to local-only data even when the account had valid read
      // access. Bumped to 15s, with one retry at 25s if the first attempt
      // times out specifically (not on other errors like permission-denied).
      const attemptFetch = timeoutMs => {
        // Bug fix: previously these used orderBy("timestamp","desc"). In
        // Firestore, an orderBy on a field SILENTLY EXCLUDES every document
        // that is missing (or has null for) that field. So any checkin/feedback
        // written before the timestamp field existed — or whose serverTimestamp()
        // write hadn't fully resolved — never showed up in the admin dashboard
        // ("data fetched but not all"). We now fetch the whole collection with
        // no orderBy (so nothing is dropped) and sort client-side below, where
        // a missing timestamp is handled gracefully instead of hiding the row.
        const fetchPromise = Promise.all([getDocs(collection(db, "users")), getDocs(query(collection(db, "checkins"), limit(5000))), getDocs(query(collection(db, "feedbacks"), limit(2000)))]);
        return Promise.race([fetchPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("admin-fetch-timeout")), timeoutMs))]);
      };
      let uSnap, cSnap, fSnap;
      try {
        [uSnap, cSnap, fSnap] = await attemptFetch(15000);
      } catch (firstErr) {
        if (firstErr.message === "admin-fetch-timeout") {
          console.warn("Admin fetch timed out once, retrying with longer timeout...");
          [uSnap, cSnap, fSnap] = await attemptFetch(25000);
        } else {
          throw firstErr;
        }
      }
      // Sort newest-first client-side (replaces the orderBy we removed above).
      // Docs missing a timestamp sort to the bottom instead of being dropped.
      const _ts = x => x?.timestamp?.toDate?.()?.getTime?.() || 0;
      const _sortDesc = (a, b) => _ts(b) - _ts(a);
      const uData = uSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      const cData = cSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })).sort(_sortDesc);
      const fData = fSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })).sort(_sortDesc);
      // Merge userstreak data into user objects
      const userMap = {};
      uData.forEach(user => {
        userMap[user.id] = user;
      });
      uSnap.docs.forEach(doc => {
        if (doc.id.startsWith('userstreak_')) {
          const uid = doc.id.replace('userstreak_', '');
          const streakData = doc.data();
          if (userMap[uid]) {
            Object.assign(userMap[uid], streakData);
          } else {
            userMap[uid] = {
              id: uid,
              ...streakData
            };
          }
        }
      });
      const enrichedUData = Object.values(userMap);
      setUsers(enrichedUData);
      setCheckins(cData);
      setFeedbacks(fData);
      const ts = Date.now();
      setLastUpdated(new Date(ts));
      // Cache in sessionStorage — persists for tab session
      try {
        sessionStorage.setItem("syn_admin_cache", JSON.stringify({
          users: uData,
          checkins: cData,
          feedbacks: fData,
          ts
        }));
      } catch (e) {}
    } catch (e) {
      console.warn("Firestore fetch failed:", e.message);
      setDbError(true);
      setLastFetchError(`${e.code || "error"}: ${e.message || "unknown"}`);
      if (!cached) {
        // localStorage fallback
        try {
          const u = JSON.parse(localStorage.getItem("syn_user") || "{}");
          const h = JSON.parse(localStorage.getItem("syn_history") || "[]");
          const archetype = JSON.parse(localStorage.getItem("syn_archetype") || "{}");
          const confess = JSON.parse(localStorage.getItem("syn_confess") || "{}");
          const streak = parseInt(localStorage.getItem("syn_streak") || "0");
          setUsers([{
            id: u.uid || "local",
            uid: u.uid || "local",
            name: u.name || "You",
            email: u.email || "",
            photoURL: u.photoURL || "",
            archetype: archetype?.title || "",
            addictions: confess?.addictions || [],
            hoursPerDay: confess?.hours || {},
            currentStreak: streak,
            lastCheckin: localStorage.getItem("syn_last") || "",
            dob: u.dob || "",
            gender: u.gender || "",
            lastSeen: {
              toDate: () => new Date()
            }
          }]);
          setCheckins(h.map((entry, i) => ({
            id: `local_${i}`,
            uid: u.uid || "local",
            date: entry.date || "",
            status: entry.status || "win",
            streak: entry.streak || 0,
            msg: entry.msg || "",
            timestamp: {
              toDate: () => new Date(entry.date || Date.now())
            }
          })));
          const f = JSON.parse(localStorage.getItem("syn_feedbacks") || "[]");
          setFeedbacks(f);
        } catch (le) {
          console.error(le);
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    (async () => {
      await flushSyncQueue();
      // If no cache, fetch immediately
      // If cache exists, fetch in background silently
      if (!cached) fetchData(false);else fetchData(true); // silent background refresh
    })();
  }, []);

  // ── Range filter ──
  const now = Date.now();
  const rangeMs = {
    "1d": 864e5,
    "7d": 6048e5,
    "30d": 2592e6,
    "all": Infinity
  };
  const filteredCI = useMemo(() => checkins.filter(c => {
    if (range === "all") return true;
    const ts = c.timestamp?.toDate?.()?.getTime() || 0;
    return now - ts <= rangeMs[range];
  }), [checkins, range]);

  // ── Overview stats ──
  const totalUsers = users.length;
  const activeToday = users.filter(u => u.lastCheckin === new Date().toDateString()).length;
  const avgStreak = users.length ? Math.round(users.reduce((s, u) => s + (u.currentStreak || 0), 0) / users.length) : 0;
  const winRate = filteredCI.length ? Math.round(filteredCI.filter(c => c.status === "win").length / filteredCI.length * 100) : 0;

  // ── Daily check-in chart data ──
  const dailyData = useMemo(() => {
    const days = range === "1d" ? 24 : range === "7d" ? 7 : range === "30d" ? 30 : 30;
    const map = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * (range === "1d" ? 3600000 : 86400000));
      const key = range === "1d" ? `${d.getHours()}:00` : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short"
      });
      map[key] = {
        label: key,
        win: 0,
        mid: 0,
        slip: 0,
        total: 0
      };
    }
    filteredCI.forEach(c => {
      const ts = c.timestamp?.toDate?.();
      if (!ts) return;
      const key = range === "1d" ? `${ts.getHours()}:00` : ts.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short"
      });
      if (map[key]) {
        map[key][c.status] = (map[key][c.status] || 0) + 1;
        map[key].total++;
      }
    });
    return Object.values(map);
  }, [filteredCI, range]);

  // ── Addiction map ──
  const addictionMap = useMemo(() => {
    const map = {};
    // Addictions are stored as objects ({id,label,emoji,...}); older/local data
    // may still be plain strings. Normalize both to a display label so they
    // don't all collapse into a single "[object Object]" bucket.
    users.forEach(u => (u.addictions || []).forEach(a => {
      const key = typeof a === "string" ? a : a?.label || a?.id || "Unknown";
      map[key] = (map[key] || 0) + 1;
    }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [users]);

  // ── Archetype breakdown ──
  const archetypeMap = useMemo(() => {
    const map = {};
    users.forEach(u => {
      if (u.archetype) map[u.archetype] = (map[u.archetype] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [users]);
  const maxBar = Math.max(...dailyData.map(d => d.total), 1);
  const maxAdd = addictionMap[0]?.[1] || 1;
  const StatCard = ({
    label,
    value,
    sub,
    color
  }) => <div className="admin-stat-card" style={{
    background: card,
    border: `1px solid ${bdr}`,
    borderRadius: 14,
    padding: "16px 18px",
    flex: 1,
    minWidth: 0
  }}>
      <div style={{
      fontSize: 11,
      color: txt2,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 6
    }}>{label}</div>
      <div style={{
      fontSize: 28,
      fontWeight: 800,
      fontFamily: "'Orbitron',sans-serif",
      color: color || acc,
      lineHeight: 1
    }}>{value}</div>
      {sub && <div style={{
      fontSize: 10,
      color: txt2,
      marginTop: 4
    }}>{sub}</div>}
    </div>;
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: bg,
    overflowY: "auto",
    fontFamily: "'Inter',sans-serif"
  }}>

      {/* ── Header ── */}
      <div className="admin-header" style={{
      position: "sticky",
      top: 0,
      background: "rgba(9,7,15,0.95)",
      backdropFilter: "blur(20px)",
      borderBottom: `1px solid ${bdr}`,
      padding: "14px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      zIndex: 10
    }}>
        <div>
          <div style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: 13,
          fontWeight: 800,
          color: acc,
          letterSpacing: 2
        }}>⚡ SYNAPSE ADMIN</div>
          <div className="admin-header-sub" style={{
          fontSize: 10,
          color: txt2,
          marginTop: 1,
          letterSpacing: .5
        }}>Founders Dashboard — Confidential</div>
        </div>
        <div className="admin-header-actions" style={{
        display: "flex",
        gap: 8,
        alignItems: "center"
      }}>
          {lastUpdated && <div className="admin-updated" style={{
          fontSize: 10,
          color: txt2
        }}>Updated {lastUpdated.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit"
          })}</div>}
          <button onClick={() => fetchData(true)} disabled={refreshing} style={{
          padding: "6px 12px",
          borderRadius: 999,
          background: card,
          border: `1px solid ${bdr}`,
          color: refreshing ? txt2 : acc,
          fontSize: 10,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4
        }}>
            <RefreshCw size={11} style={{
            animation: refreshing ? "spin 0.7s linear infinite" : "none"
          }} />{refreshing ? "Syncing..." : "Refresh"}
          </button>
          <div className="admin-updated" style={{
          fontSize: 10,
          color: txt2
        }}>{loading ? "Loading..." : ""}</div>
          <button onClick={onClose} style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: card,
          border: `1px solid ${bdr}`,
          color: txt2,
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1
        }}>×</button>
        </div>
      </div>

      {/* Firestore status banner */}
      {dbError && <div style={{
      background: "rgba(251,191,36,0.08)",
      border: "none",
      borderBottom: "1px solid rgba(251,191,36,0.2)",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      gap: 10
    }}>
          <AlertTriangle size={14} color={amber} />
          <div style={{
        fontSize: 11,
        color: amber,
        lineHeight: 1.5
      }}>
            <strong>Couldn't load live data — showing local fallback.</strong> Most likely cause: your Firestore Security Rules don't grant this account read access to the users/checkins/feedbacks collections. Check the browser console for the exact error (permission-denied vs network vs timeout).
            {lastFetchError && <div style={{
          marginTop: 4,
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 10,
          opacity: 0.75,
          wordBreak: "break-all"
        }}>{lastFetchError}</div>}
          </div>
        </div>}

      {/* ── Tab bar ── */}
      <div className="admin-tabs" style={{
      display: "flex",
      gap: 0,
      borderBottom: `1px solid ${bdr}`,
      padding: "0 20px",
      overflowX: "auto"
    }}>
        {[["overview", "📊 Overview"], ["users", "👥 Users"], ["checkins", "📋 Check-ins"], ["addictions", "🧠 Addictions"], ["feedbacks", "💬 Feedback"]].map(([t, l]) => <button key={t} onClick={() => setTab(t)} style={{
        padding: "12px 16px",
        background: "none",
        border: "none",
        borderBottom: `2px solid ${tab === t ? acc : "transparent"}`,
        color: tab === t ? acc : txt2,
        fontSize: 11,
        fontWeight: tab === t ? 700 : 400,
        cursor: "pointer",
        letterSpacing: .5,
        transition: "all .2s",
        whiteSpace: "nowrap",
        flexShrink: 0
      }}>{l}</button>)}
      </div>

      {/* ── Range filter (shown on all tabs) ── */}
      <div style={{
      display: "flex",
      gap: 6,
      padding: "12px 20px",
      borderBottom: `1px solid ${bdr}`,
      alignItems: "center"
    }}>
        <span style={{
        fontSize: 10,
        color: txt2,
        letterSpacing: 1,
        marginRight: 4
      }}>RANGE:</span>
        {[["1d", "Today"], ["7d", "7 Days"], ["30d", "30 Days"], ["all", "All Time"]].map(([v, l]) => <button key={v} onClick={() => setRange(v)} style={{
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${range === v ? acc : bdr}`,
        background: range === v ? `rgba(${"255,140,0"},0.12)` : "transparent",
        color: range === v ? acc : txt2,
        fontSize: 10,
        fontWeight: range === v ? 700 : 400,
        cursor: "pointer",
        transition: "all .2s"
      }}>{l}</button>)}
        <span style={{
        marginLeft: "auto",
        fontSize: 10,
        color: txt2
      }}>{filteredCI.length} check-ins in range</span>
      </div>
      {checkins.length >= 5000 && <div style={{
      padding: "6px 20px",
      fontSize: 10,
      color: amber,
      background: "rgba(251,191,36,0.06)"
    }}>
          ⚠️ Showing most recent 5,000 check-ins only — older records aren't included in "All Time" stats. Consider pagination if you need full historical data beyond this.
        </div>}

      {loading ? <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 300,
      flexDirection: "column",
      gap: 12
    }}>
          <div style={{
        width: 32,
        height: 32,
        border: `2px solid ${bdr}`,
        borderTop: `2px solid ${acc}`,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite"
      }} />
          <div style={{
        fontSize: 12,
        color: txt2
      }}>Fetching from Firestore...</div>
        </div> : <div style={{
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 16
    }}>

          {/* ══ OVERVIEW TAB ══ */}
          {tab === "overview" && <>
            {/* Stat cards */}
            <div className="admin-stat-row" style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap"
        }}>
              <StatCard label="Total Users" value={totalUsers} sub="Registered accounts" />
              <StatCard label="Active Today" value={activeToday} sub="Checked in today" color={green} />
              <StatCard label="Avg Streak" value={`${avgStreak}d`} sub="Across all users" color={amber} />
              <StatCard label="Win Rate" value={`${winRate}%`} sub={`In selected range`} color={winRate > 60 ? green : winRate > 30 ? amber : red} />
            </div>

            {/* Daily bar chart */}
            <div style={{
          background: card,
          border: `1px solid ${bdr}`,
          borderRadius: 16,
          padding: "20px"
        }}>
              <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: txt,
            marginBottom: 4
          }}>Check-in Activity</div>
              <div style={{
            fontSize: 10,
            color: txt2,
            marginBottom: 16
          }}>{range === "1d" ? "By hour — today" : "Daily breakdown"}</div>
              <div style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            height: 120,
            overflowX: "auto",
            paddingBottom: 4
          }}>
                {dailyData.map((d, i) => <div key={i} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              flex: "0 0 auto",
              minWidth: range === "30d" ? 18 : 24
            }}>
                    <div style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                height: 100,
                gap: 1
              }}>
                      {d.win > 0 && <div style={{
                  width: "100%",
                  height: `${d.win / maxBar * 100}%`,
                  minHeight: d.win > 0 ? 3 : 0,
                  background: green,
                  borderRadius: "2px 2px 0 0",
                  opacity: .85
                }} />}
                      {d.mid > 0 && <div style={{
                  width: "100%",
                  height: `${d.mid / maxBar * 100}%`,
                  minHeight: d.mid > 0 ? 3 : 0,
                  background: amber,
                  opacity: .85
                }} />}
                      {d.slip > 0 && <div style={{
                  width: "100%",
                  height: `${d.slip / maxBar * 100}%`,
                  minHeight: d.slip > 0 ? 3 : 0,
                  background: red,
                  borderRadius: "0 0 2px 2px",
                  opacity: .85
                }} />}
                      {d.total === 0 && <div style={{
                  width: "100%",
                  height: 3,
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 2
                }} />}
                    </div>
                    <div style={{
                fontSize: 7,
                color: txt2,
                transform: "rotate(-45deg)",
                transformOrigin: "center",
                whiteSpace: "nowrap",
                marginTop: 4
              }}>{d.label}</div>
                  </div>)}
              </div>
              {/* Legend */}
              <div style={{
            display: "flex",
            gap: 12,
            marginTop: 8,
            flexWrap: "wrap"
          }}>
                {[[green, "WIN"], [amber, "MID"], [red, "SLIP"]].map(([c, l]) => <div key={l} style={{
              display: "flex",
              alignItems: "center",
              gap: 4
            }}>
                    <div style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: c
              }} />
                    <span style={{
                fontSize: 9,
                color: txt2,
                letterSpacing: 1
              }}>{l}: {filteredCI.filter(ci => ci.status === l.toLowerCase()).length}</span>
                  </div>)}
              </div>
            </div>

            {/* Archetype breakdown */}
            <div style={{
          background: card,
          border: `1px solid ${bdr}`,
          borderRadius: 16,
          padding: "20px"
        }}>
              <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: txt,
            marginBottom: 16
          }}>Archetype Distribution</div>
              <div style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}>
                {archetypeMap.length === 0 ? <div style={{
              fontSize: 12,
              color: txt2
            }}>No data yet.</div> : archetypeMap.map(([name, count]) => {
              const arcColors = {
                SOVEREIGN: "#f59e0b",
                ARBITER: "#60a5fa",
                STOIC: "#4ade80",
                ASCENDANT: "#c084fc"
              };
              const c = arcColors[name] || acc;
              return <div key={name} style={{
                flex: 1,
                minWidth: 100,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid rgba(${c.replace("#", "").match(/.{2}/g).map(x => parseInt(x, 16)).join(",")},0.25)`,
                borderRadius: 12,
                padding: "14px",
                textAlign: "center"
              }}>
                      <div style={{
                  fontSize: 20,
                  fontWeight: 800,
                  fontFamily: "'Orbitron',sans-serif",
                  color: c
                }}>{count}</div>
                      <div style={{
                  fontSize: 9,
                  color: c,
                  fontWeight: 600,
                  letterSpacing: 1,
                  marginTop: 2
                }}>{name}</div>
                      <div style={{
                  fontSize: 9,
                  color: txt2,
                  marginTop: 2
                }}>{totalUsers ? Math.round(count / totalUsers * 100) : 0}%</div>
                    </div>;
            })}
              </div>
            </div>
          </>}

          {/* ══ USERS TAB ══ */}
          {tab === "users" && <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}>
              {/* Search — becomes essential once you're past a handful of users */}
              <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by name or email..." style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 12,
          background: card,
          border: `1px solid ${bdr}`,
          color: txt,
          fontSize: 12,
          outline: "none",
          boxSizing: "border-box"
        }} />
              {users.length === 0 && <div style={{
          textAlign: "center",
          color: txt2,
          padding: 40,
          fontSize: 13
        }}>No users yet.</div>}
              {[...users].filter(u => {
          if (!userSearch.trim()) return true;
          const q = userSearch.trim().toLowerCase();
          return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
        }).sort((a, b) => (b.lastSeen?.seconds || 0) - (a.lastSeen?.seconds || 0)).map(u => {
          const initials = (u.name || u.email || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          const lastSeen = u.lastSeen?.toDate?.();
          const minsAgo = lastSeen ? Math.floor((Date.now() - lastSeen) / 60000) : null;
          const lastSeenStr = minsAgo === null ? "Never" : minsAgo < 60 ? `${minsAgo}m ago` : minsAgo < 1440 ? `${Math.floor(minsAgo / 60)}h ago` : `${Math.floor(minsAgo / 1440)}d ago`;
          const isOnline = minsAgo !== null && minsAgo < 30;
          const userCIs = checkins.filter(c => c.uid === u.uid);
          return <div key={u.id} onClick={() => setSelectedUser(selectedUser === u.id ? null : u.id)} style={{
            background: card,
            border: `1px solid ${selectedUser === u.id ? acc : bdr}`,
            borderRadius: 14,
            padding: "16px",
            cursor: "pointer",
            transition: "all .2s"
          }}>
                    <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12
            }}>
                      <div style={{
                position: "relative",
                flexShrink: 0
              }}>
                        {u.photoURL ? <img src={u.photoURL} style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: `2px solid ${bdr}`
                }} /> : <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: `rgba(${"255,140,0"},0.15)`,
                  border: `1px solid ${bdr}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "'Orbitron',sans-serif",
                  fontSize: 13,
                  fontWeight: 700,
                  color: acc
                }}>{initials}</div>}
                        <div style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isOnline ? green : "rgba(255,255,255,0.15)",
                  border: `2px solid ${bg}`
                }} />
                      </div>
                      <div style={{
                flex: 1,
                minWidth: 0
              }}>
                        <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6
                }}>
                          <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: txt,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}>{u.name || "Unknown"}</span>
                          {u.archetype && <span style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: `rgba(${"255,140,0"},0.1)`,
                    border: `1px solid rgba(${"255,140,0"},0.25)`,
                    fontSize: 9,
                    color: acc,
                    fontWeight: 600,
                    flexShrink: 0
                  }}>{u.archetype}</span>}
                        </div>
                        <div style={{
                  fontSize: 11,
                  color: txt2,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>{u.email}</div>
                      </div>
                      <div style={{
                textAlign: "right",
                flexShrink: 0
              }}>
                        <div style={{
                  fontSize: 20,
                  fontWeight: 800,
                  fontFamily: "'Orbitron',sans-serif",
                  color: acc
                }}>{u.currentStreak || 0}</div>
                        <div style={{
                  fontSize: 8,
                  color: txt2,
                  letterSpacing: 1
                }}>STREAK</div>
                      </div>
                    </div>
                    {/* Expanded details */}
                    {selectedUser === u.id && <div style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${bdr}`
            }}>
                        <div style={{
                display: "flex",
                gap: 8,
                marginBottom: 10,
                flexWrap: "wrap"
              }}>
                          {(u.addictions || []).map((a, i) => {
                  // Addiction entries are objects ({id,label,...}); render the
                  // label, never the raw object (that throws "Objects are not
                  // valid as a React child" and crashes the whole dashboard).
                  const label = typeof a === "string" ? a : a?.label || a?.id || "Unknown";
                  return <span key={i} style={{
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: card,
                    border: `1px solid ${bdr}`,
                    fontSize: 10,
                    color: txt2
                  }}>{a?.emoji ? `${a.emoji} ` : ""}{label}</span>;
                })}
                          {(u.addictions || []).length === 0 && <span style={{
                  fontSize: 11,
                  color: txt2
                }}>No addictions recorded</span>}
                        </div>
                        <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
                marginBottom: 10
              }}>
                          {[["WIN", green], ["MID", amber], ["SLIP", red]].map(([s, c]) => <div key={s} style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${bdr}`,
                  borderRadius: 10,
                  padding: "10px",
                  textAlign: "center"
                }}>
                              <div style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: c
                  }}>{userCIs.filter(ci => ci.status === s.toLowerCase()).length}</div>
                              <div style={{
                    fontSize: 9,
                    color: c,
                    letterSpacing: 1
                  }}>{s}</div>
                            </div>)}
                        </div>
                        <div style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: txt2
              }}>
                          <span>Last check-in: <span style={{
                    color: txt
                  }}>{u.lastCheckin || "Never"}</span></span>
                          <span>Last seen: <span style={{
                    color: txt
                  }}>{lastSeenStr}</span></span>
                        </div>
                        <div style={{
                display: "flex",
                gap: 16,
                marginTop: 8,
                fontSize: 10,
                color: txt2
              }}>
                          {u.dob && <span>DOB: <span style={{
                    color: txt
                  }}>{new Date(u.dob).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    })}</span></span>}
                          {u.gender && <span>Gender: <span style={{
                    color: txt
                  }}>{u.gender}</span></span>}
                        </div>
                      </div>}
                  </div>;
        })}
            </div>}

          {/* ══ CHECKINS TAB ══ */}
          {tab === "checkins" && <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}>
              {filteredCI.length === 0 && <div style={{
          textAlign: "center",
          color: txt2,
          padding: 40,
          fontSize: 13
        }}>No check-ins in this range.</div>}
              {filteredCI.map(c => {
          const u = users.find(us => us.uid === c.uid);
          const ts = c.timestamp?.toDate?.();
          const timeStr = ts ? ts.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
          }) : "—";
          const sColor = {
            win: green,
            mid: amber,
            slip: red,
            crisis: "#60a5fa"
          }[c.status] || "#888";
          return <div key={c.id} style={{
            background: card,
            border: `1px solid ${bdr}`,
            borderRadius: 12,
            padding: "14px 16px"
          }}>
                    <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 6
            }}>
                      <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8
              }}>
                        <div style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: sColor,
                  boxShadow: `0 0 8px ${sColor}`,
                  flexShrink: 0,
                  marginTop: 2
                }} />
                        <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: txt
                }}>{u?.name || c.uid.slice(0, 8) + "..."}</span>
                        <span style={{
                  fontSize: 10,
                  color: sColor,
                  fontWeight: 600,
                  textTransform: "uppercase"
                }}>{c.status}</span>
                        <span style={{
                  fontSize: 10,
                  color: txt2
                }}>Day {c.streak}</span>
                      </div>
                      <span style={{
                fontSize: 10,
                color: txt2,
                flexShrink: 0
              }}>{timeStr}</span>
                    </div>
                    <div style={{
              fontSize: 11,
              color: txt2,
              lineHeight: 1.6,
              paddingLeft: 15,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical"
            }}>{c.msg || "—"}</div>
                  </div>;
        })}
            </div>}

          {/* ══ ADDICTIONS TAB ══ */}
          {tab === "addictions" && <>
            <div style={{
          background: card,
          border: `1px solid ${bdr}`,
          borderRadius: 16,
          padding: "20px"
        }}>
              <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: txt,
            marginBottom: 4
          }}>Addiction Frequency</div>
              <div style={{
            fontSize: 10,
            color: txt2,
            marginBottom: 16
          }}>Across {users.length} user profiles</div>
              {addictionMap.length === 0 ? <div style={{
            fontSize: 12,
            color: txt2
          }}>No data yet.</div> : addictionMap.map(([name, count]) => {
            const pct = Math.round(count / maxAdd * 100);
            const pctUsers = Math.round(count / Math.max(users.length, 1) * 100);
            return <div key={name} style={{
              marginBottom: 14
            }}>
                    <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6
              }}>
                      <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: txt,
                  textTransform: "capitalize"
                }}>{name}</span>
                      <div style={{
                  display: "flex",
                  gap: 10
                }}>
                        <span style={{
                    fontSize: 10,
                    color: txt2
                  }}>{pctUsers}% of users</span>
                        <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: acc,
                    minWidth: 20,
                    textAlign: "right"
                  }}>{count}</span>
                      </div>
                    </div>
                    <div style={{
                height: 8,
                background: "rgba(255,255,255,0.05)",
                borderRadius: 4,
                overflow: "hidden"
              }}>
                      <div style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: "linear-gradient(90deg,#ff9500,#ffcc00)",
                  borderRadius: 4,
                  boxShadow: `0 0 8px ${acc}55`,
                  transition: "width 1s cubic-bezier(.16,1,.3,1)"
                }} />
                    </div>
                  </div>;
          })}
            </div>

            {/* Hours per addiction */}
            <div style={{
          background: card,
          border: `1px solid ${bdr}`,
          borderRadius: 16,
          padding: "20px"
        }}>
              <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: txt,
            marginBottom: 4
          }}>Avg Hours/Day Per Addiction</div>
              <div style={{
            fontSize: 10,
            color: txt2,
            marginBottom: 16
          }}>How much time users report spending</div>
              {(() => {
            const hoursMap = {};
            const countMap = {};
            users.forEach(u => {
              const h = u.hoursPerDay || {};
              Object.entries(h).forEach(([k, v]) => {
                hoursMap[k] = (hoursMap[k] || 0) + Number(v);
                countMap[k] = (countMap[k] || 0) + 1;
              });
            });
            const avgHours = Object.entries(hoursMap).map(([k, v]) => [k, +(v / countMap[k]).toFixed(1)]).sort((a, b) => b[1] - a[1]);
            const maxH = avgHours[0]?.[1] || 1;
            return avgHours.length === 0 ? <div style={{
              fontSize: 12,
              color: txt2
            }}>No hours data yet.</div> : avgHours.map(([name, avg]) => <div key={name} style={{
              marginBottom: 12
            }}>
                    <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 5
              }}>
                      <span style={{
                  fontSize: 12,
                  color: txt,
                  textTransform: "capitalize"
                }}>{name}</span>
                      <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: amber
                }}>{avg}h/day</span>
                    </div>
                    <div style={{
                height: 6,
                background: "rgba(255,255,255,0.05)",
                borderRadius: 3,
                overflow: "hidden"
              }}>
                      <div style={{
                  height: "100%",
                  width: `${avg / maxH * 100}%`,
                  background: "linear-gradient(90deg,#fbbf24,#f59e0b)",
                  borderRadius: 3,
                  transition: "width 1s cubic-bezier(.16,1,.3,1)"
                }} />
                    </div>
                  </div>);
          })()}
            </div>
          </>}

          {/* ══ FEEDBACKS TAB ══ */}
          {tab === "feedbacks" && <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}>
              {/* Summary stats */}
              <div style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 4
        }}>
                <div style={{
            background: card,
            border: `1px solid ${bdr}`,
            borderRadius: 14,
            padding: "16px 20px",
            flex: 1,
            minWidth: 120
          }}>
                  <div style={{
              fontSize: 10,
              color: txt2,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6
            }}>Total</div>
                  <div style={{
              fontSize: 28,
              fontWeight: 800,
              fontFamily: "'Orbitron',sans-serif",
              color: acc
            }}>{feedbacks.length}</div>
                </div>
                <div style={{
            background: card,
            border: `1px solid ${bdr}`,
            borderRadius: 14,
            padding: "16px 20px",
            flex: 1,
            minWidth: 120
          }}>
                  <div style={{
              fontSize: 10,
              color: txt2,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6
            }}>Avg Rating</div>
                  <div style={{
              fontSize: 28,
              fontWeight: 800,
              fontFamily: "'Orbitron',sans-serif",
              color: amber
            }}>{feedbacks.length ? (feedbacks.reduce((s, f) => s + (f.rating || 0), 0) / feedbacks.length).toFixed(1) : "—"} ⭐</div>
                </div>
                <div style={{
            background: card,
            border: `1px solid ${bdr}`,
            borderRadius: 14,
            padding: "16px 20px",
            flex: 1,
            minWidth: 120
          }}>
                  <div style={{
              fontSize: 10,
              color: txt2,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6
            }}>Would Recommend</div>
                  <div style={{
              fontSize: 28,
              fontWeight: 800,
              fontFamily: "'Orbitron',sans-serif",
              color: green
            }}>
                    {feedbacks.length ? Math.round(feedbacks.filter(f => f.recommend?.includes("Absolutely")).length / feedbacks.length * 100) : 0}%
                  </div>
                </div>
              </div>

              {feedbacks.length === 0 && <div style={{
          textAlign: "center",
          color: txt2,
          padding: 40,
          fontSize: 13
        }}>No feedback yet — it'll appear here after users submit.</div>}

              {feedbacks.map(f => {
          const ts = f.timestamp?.toDate?.();
          const timeStr = ts ? ts.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
          }) : "—";
          const stars = "⭐".repeat(f.rating || 0);
          return <div key={f.id} style={{
            background: card,
            border: `1px solid ${bdr}`,
            borderRadius: 14,
            padding: "16px"
          }}>
                    {/* Header */}
                    <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 10
            }}>
                      <div>
                        <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: txt
                }}>{f.name || "Anonymous"}</div>
                        <div style={{
                  fontSize: 11,
                  color: txt2,
                  marginTop: 2
                }}>{f.email || ""}</div>
                      </div>
                      <div style={{
                textAlign: "right",
                flexShrink: 0
              }}>
                        <div style={{
                  fontSize: 14
                }}>{stars}</div>
                        <div style={{
                  fontSize: 10,
                  color: txt2,
                  marginTop: 2
                }}>{timeStr}</div>
                      </div>
                    </div>
                    {/* Meta badges */}
                    <div style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 10
            }}>
                      {f.archetype && <span style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: `rgba(${"255,140,0"},0.1)`,
                border: `1px solid rgba(${"255,140,0"},0.25)`,
                fontSize: 10,
                color: acc
              }}>{f.archetype}</span>}
                      {f.streak > 0 && <span style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: card,
                border: `1px solid ${bdr}`,
                fontSize: 10,
                color: txt2
              }}>Day {f.streak}</span>}
                      {f.recommend && <span style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: f.recommend.includes("Absolutely") ? "rgba(74,222,128,0.1)" : f.recommend.includes("Not") ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
                border: `1px solid ${f.recommend.includes("Absolutely") ? "rgba(74,222,128,0.3)" : f.recommend.includes("Not") ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}`,
                fontSize: 10,
                color: f.recommend.includes("Absolutely") ? green : f.recommend.includes("Not") ? red : amber
              }}>{f.recommend}</span>}
                    </div>
                    {/* Answers */}
                    {f.best && <div style={{
              marginBottom: 8
            }}>
                      <div style={{
                fontSize: 10,
                color: green,
                fontWeight: 600,
                letterSpacing: .5,
                marginBottom: 3
              }}>✅ What's working</div>
                      <div style={{
                fontSize: 12,
                color: txt,
                lineHeight: 1.6
              }}>{f.best}</div>
                    </div>}
                    {f.improve && <div>
                      <div style={{
                fontSize: 10,
                color: amber,
                fontWeight: 600,
                letterSpacing: .5,
                marginBottom: 3
              }}>🔧 Improve</div>
                      <div style={{
                fontSize: 12,
                color: txt,
                lineHeight: 1.6
              }}>{f.improve}</div>
                    </div>}
                  </div>;
        })}
            </div>}

        </div>}
    </div>;
}

// ─── END ADMIN DASHBOARD ─────────────────────────────────────────────────────

function ProfileSheet({
  user,
  theme,
  onThemeToggle,
  onCommandMode,
  onClose,
  onSignOut,
  onPhotoUpdate,
  onAdminOpen,
  onFeedback
}) {
  const initials = (user?.name || user?.email || "U").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(() => {
    const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
    return stored.photoURL || auth.currentUser?.photoURL || null;
  });
  const [dob, setDob] = useState(() => {
    const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
    return stored.dob || user?.dob || "";
  });
  const [gender, setGender] = useState(() => {
    const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
    return stored.gender || user?.gender || "";
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showNotifInfo, setShowNotifInfo] = useState(false);
  const fileRef = useRef();
  const handlePhotoClick = () => fileRef.current?.click();
  const handlePhotoChange = async e => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Photo must be under 5MB");
      return;
    }
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const storageRef = sRef(storage, `avatars/${auth.currentUser.uid}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateProfile(auth.currentUser, {
        photoURL: url
      });
      setPhotoURL(url);
      const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
      localStorage.setItem("syn_user", JSON.stringify({
        ...stored,
        photoURL: url
      }));
      onPhotoUpdate?.(url);
    } catch (err) {
      console.error("Photo upload failed:", err);
      alert("Upload failed — check Firebase Storage rules.");
    } finally {
      setUploading(false);
    }
  };
  const handleSaveProfile = async () => {
    // 1. Save to localStorage INSTANTLY — no async
    const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
    localStorage.setItem("syn_user", JSON.stringify({
      ...stored,
      dob,
      gender
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // 2. Firestore in background — non-blocking, durable (queued + retried)
    const uid = auth.currentUser?.uid;
    if (uid && db) {
      try {
        await durableWrite(`profile_${uid}`, "users", uid, {
          dob,
          gender,
          lastSeen: serverTimestamp()
        });
      } catch (e) {
        console.warn("Profile save failed:", e);
      }
    }
  };
  const inp = {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "11px 14px",
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
    fontFamily: "'Inter',sans-serif",
    boxSizing: "border-box"
  };
  return <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
      position: "fixed",
      inset: 0,
      zIndex: 900,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(6px)"
    }} />
      {/* Sheet */}
      <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 901,
      background: "#0d0b14",
      borderTop: "1px solid rgba(255,140,0,0.15)",
      borderRadius: "24px 24px 0 0",
      padding: "8px 0 40px",
      animation: "slideUp .35s cubic-bezier(.16,1,.3,1)",
      maxHeight: "90vh",
      overflowY: "auto"
    }}>
        {/* Handle */}
        <div style={{
        width: 40,
        height: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.15)",
        margin: "12px auto 20px"
      }} />
        {/* Avatar + info */}
        <div style={{
        padding: "0 24px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        gap: 16
      }}>
          {/* Avatar — tappable to change photo */}
          <div onClick={handlePhotoClick} style={{
          position: "relative",
          flexShrink: 0,
          cursor: "pointer"
        }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{
            display: "none"
          }} />
            {photoURL ? <img src={photoURL} alt="avatar" style={{
            width: 62,
            height: 62,
            borderRadius: "50%",
            objectFit: "cover",
            border: "2px solid rgba(255,140,0,0.4)",
            boxShadow: "0 4px 16px rgba(255,140,0,0.3)"
          }} /> : <div style={{
            width: 62,
            height: 62,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#ff9500,#ff5000)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 18,
            fontWeight: 900,
            color: "#fff",
            boxShadow: "0 4px 16px rgba(255,140,0,0.35)"
          }}>
                {initials}
              </div>}
            {/* Edit overlay */}
            <div style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: uploading ? 1 : 0,
            transition: "opacity .2s"
          }} className="avatar-edit-overlay">
              {uploading ? <div style={{
              width: 18,
              height: 18,
              border: "2px solid rgba(255,255,255,0.3)",
              borderTop: "2px solid #fff",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite"
            }} /> : <span style={{
              fontSize: 16
            }}>📷</span>}
            </div>
            {/* Camera badge */}
            <div style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#ff9500",
            border: "2px solid #0d0b14",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10
          }}>📷</div>
          </div>
          <div style={{
          overflow: "hidden",
          flex: 1
        }}>
            <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}>{user?.name || "Soldier"}</div>
            <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}>{user?.email || ""}</div>
            <div style={{
            fontSize: 10,
            color: "var(--text4)",
            marginTop: 4,
            cursor: "pointer"
          }} onClick={handlePhotoClick}>Tap photo to change</div>
            <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginTop: 6,
            background: "rgba(255,140,0,0.08)",
            border: "1px solid rgba(255,140,0,0.2)",
            borderRadius: 999,
            padding: "3px 10px"
          }}>
              <div style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#ff8c00",
              boxShadow: "0 0 6px #ff8c00"
            }} />
              <span style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: "rgba(255,180,80,0.7)",
              textTransform: "uppercase"
            }}>Active Protocol</span>
            </div>
          </div>
        </div>
        {/* DOB + Gender */}
        <div style={{
        padding: "20px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}>
          <div style={{
          fontSize: 10,
          letterSpacing: 1.5,
          color: "var(--text4)",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 2
        }}>Personal Info</div>
          {/* DOB */}
          <div>
            <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 6,
            fontWeight: 500
          }}>Date of Birth</div>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} style={{
            ...inp,
            colorScheme: "dark"
          }} />
          </div>
          {/* Gender */}
          <div>
            <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 8,
            fontWeight: 500
          }}>Gender</div>
            <div style={{
            display: "flex",
            gap: 8
          }}>
              {["Male", "Female"].map(g => <div key={g} onClick={() => setGender(g)} style={{
              flex: 1,
              padding: "11px",
              borderRadius: 10,
              textAlign: "center",
              background: gender === g ? "rgba(255,140,0,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${gender === g ? "rgba(255,140,0,0.4)" : "rgba(255,255,255,0.08)"}`,
              cursor: "pointer",
              transition: "all .2s",
              fontSize: 13,
              fontWeight: gender === g ? 600 : 400,
              color: gender === g ? "#ff9500" : "var(--text3)"
            }}>
                  {g === "Male" ? "👨 Male" : "👩 Female"}
                </div>)}
            </div>
          </div>
          {/* Save button */}
          <button onClick={handleSaveProfile} style={{
          padding: "11px",
          borderRadius: 10,
          background: saved ? "rgba(74,222,128,0.12)" : "linear-gradient(135deg,#ff9500,#ff5000)",
          border: saved ? "1px solid rgba(74,222,128,0.4)" : "none",
          color: saved ? "#4ade80" : "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all .3s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6
        }}>
            {saved ? "✓ Saved!" : "Save Profile"}
          </button>
        </div>
        {/* Options */}
        <div style={{
        padding: "16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 4
      }}>
          {/* Admin Dashboard — only for admin UIDs */}
          {ADMIN_UIDS.includes(auth.currentUser?.uid) && <div onClick={() => {
          onClose();
          onAdminOpen();
        }} style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,140,0,0.06)",
          border: "1px solid rgba(255,140,0,0.15)",
          cursor: "pointer",
          transition: "all .2s"
        }}>
              <Shield size={18} />
              <div>
                <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#ff9500"
            }}>Admin Dashboard</div>
                <div style={{
              fontSize: 11,
              color: "var(--text4)",
              marginTop: 1
            }}>Users · Check-ins · Analytics</div>
              </div>
              <div style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "rgba(255,140,0,0.4)"
          }}>→</div>
            </div>}

          {/* Command Mode — switches to the new light "environment" */}
          {onCommandMode && <div onClick={() => {
          onClose();
          onCommandMode();
        }} style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,140,0,0.06)",
          border: "1px solid rgba(255,140,0,0.15)",
          cursor: "pointer",
          transition: "all .2s"
        }}>
              <Sun size={18} />
              <div>
                <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#ff9500"
            }}>Command Mode</div>
                <div style={{
              fontSize: 11,
              color: "var(--text4)",
              marginTop: 1
            }}>Try the new light environment (preview)</div>
              </div>
              <div style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "rgba(255,140,0,0.4)"
          }}>→</div>
            </div>}

          {/* Notifications toggle */}
          {(() => {
          const granted = "Notification" in window && Notification.permission === "granted";
          const denied = "Notification" in window && Notification.permission === "denied";
          const isAndroid = /android/i.test(navigator.userAgent);
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
          const instructions = isAndroid ? "Settings → Apps → Chrome → Notifications → synapserewire.site → Block" : isIOS ? "Settings → Chrome/Safari → Notifications → Turn off" : "Click 🔒 lock icon in address bar → Notifications → Block";
          return <div onClick={() => {
            if (!granted && !denied) {
              onClose();
              return;
            }
            setShowNotifInfo(true);
          }} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            cursor: "pointer",
            transition: "all .2s"
          }}>
                <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12
            }}>
                  <span style={{
                fontSize: 18
              }}>{granted ? <Bell size={18} /> : denied ? <BellOff size={18} /> : <Bell size={18} />}</span>
                  <div>
                    <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text)"
                }}>Notifications</div>
                    <div style={{
                  fontSize: 11,
                  color: granted ? "#4ade80" : denied ? "#f87171" : "var(--text3)",
                  marginTop: 1
                }}>
                      {granted ? "Enabled · Tap to manage" : denied ? "Blocked · Tap to enable" : "Tap to enable reminders"}
                    </div>
                  </div>
                </div>
                <div style={{
              width: 44,
              height: 24,
              borderRadius: 999,
              background: granted ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${granted ? "rgba(74,222,128,0.4)" : denied ? "rgba(248,113,113,0.3)" : "rgba(255,255,255,0.1)"}`,
              position: "relative",
              transition: "all .3s"
            }}>
                  <div style={{
                position: "absolute",
                top: 3,
                left: granted ? 19 : 3,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: granted ? "#4ade80" : denied ? "#f87171" : "rgba(255,255,255,0.2)",
                transition: "left .3s",
                boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
              }} />
                </div>
              </div>;
        })()}
          {showNotifInfo && <div style={{
          background: "rgba(255,140,0,0.06)",
          border: "1px solid rgba(255,140,0,0.15)",
          borderRadius: 12,
          padding: "14px 16px",
          fontSize: 12,
          color: "var(--text3)",
          lineHeight: 1.7
        }}>
              <div style={{
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 6,
            display: "flex",
            justifyContent: "space-between"
          }}>
                <span>To manage notifications:</span>
                <span onClick={() => setShowNotifInfo(false)} style={{
              cursor: "pointer",
              opacity: .5,
              fontSize: 16,
              lineHeight: 1
            }}>×</span>
              </div>
              {/android/i.test(navigator.userAgent) ? "📱 Settings → Apps → Chrome → Notifications → synapserewire.site" : /iphone|ipad/i.test(navigator.userAgent) ? "📱 Settings → Chrome → Notifications → Turn off" : "💻 Click 🔒 in address bar → Notifications → Block/Allow"}
            </div>}

          {/* Feedback */}
          <div onClick={() => {
          onClose();
          onFeedback && onFeedback();
        }} style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          cursor: "pointer",
          transition: "all .2s",
          marginTop: 4
        }}>
            <MessageSquare size={18} />
            <div>
              <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text)"
            }}>Share Feedback</div>
              <div style={{
              fontSize: 11,
              color: "var(--text4)",
              marginTop: 1
            }}>Help us build what you need</div>
            </div>
          </div>
          {/* Sign out */}
          <div onClick={onSignOut} style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,60,60,0.04)",
          border: "1px solid rgba(255,60,60,0.1)",
          cursor: "pointer",
          transition: "all .2s",
          marginTop: 4
        }}>
            <LogOut size={18} />
            <div>
              <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,90,90,0.9)"
            }}>Sign Out</div>
              <div style={{
              fontSize: 11,
              color: "var(--text4)",
              marginTop: 1
            }}>Your progress stays saved</div>
            </div>
          </div>
          <button onClick={onClose} style={{
          width: "100%",
          padding: "13px",
          borderRadius: 14,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.07)",
          color: "var(--text3)",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 4
        }}>
            ← Close
          </button>
        </div>
      </div>
    </>;
}
function Nav({
  screen,
  goTo,
  savedPlan,
  onReset,
  theme,
  onThemeToggle,
  onCommandMode,
  user
}) {
  const [scrolled, setScrolled] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);
  const initials = (user?.name || user?.email || "U").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const handleSignOut = () => {
    signOut(auth).catch(() => {});
    setShowProfile(false);
  };
  return <>
    <nav style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 500,
      background: scrolled ? `rgba(${"7,4,10"},0.95)` : `rgba(${"7,4,10"},0.80)`,
      backdropFilter: "blur(20px)",
      borderBottom: "1px solid var(--border)",
      transition: "all .5s ease"
    }}>
      {/* Row 1 — Logo + controls */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px clamp(12px,4vw,48px)"
      }}>
        <div onClick={() => goTo("boot")} style={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0
        }}>
          <NeuralMark size={32} />
          <div className="nav-logo-text">
            <div style={{
              fontFamily: "'Orbitron',sans-serif",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 2.5,
              color: "var(--text)",
              lineHeight: 1
            }}>SYNAPSE</div>
            <div style={{
              fontSize: 7,
              letterSpacing: 2.5,
              color: "var(--accent)",
              opacity: .5,
              marginTop: 2
            }}>RESET · REWIRE · RECONQUER</div>
          </div>
        </div>
        <div style={{
          display: "flex",
          gap: 8,
          alignItems: "center"
        }}>
          {/* Profile avatar */}
          <div onClick={() => setShowProfile(true)} style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(255,140,0,0.35)",
            border: "2px solid rgba(255,140,0,0.3)",
            transition: "transform .2s"
          }}>
            {user?.photoURL || auth.currentUser?.photoURL ? <img src={user?.photoURL || auth.currentUser?.photoURL} alt="avatar" style={{
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }} /> : <div style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg,#ff9500,#ff5000)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Orbitron',sans-serif",
              fontSize: 11,
              fontWeight: 900,
              color: "#fff"
            }}>
                {initials}
              </div>}
          </div>
          <a className="nav-pill report-issue-pill" href={`mailto:synapserewire@gmail.com?subject=${encodeURIComponent("Report an Issue")}&body=${encodeURIComponent("Please describe the issue you encountered:\n\n\nSteps to reproduce:\n\n\nDevice/Browser:\n\n\nAdditional details:\n")}`} style={{
            flexShrink: 0,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6
          }}><AlertTriangle size={13} style={{
              flexShrink: 0
            }} /><span className="report-issue-text">Report an Issue</span></a>
        </div>
      </div>
      {/* Row 2 — Screen tabs */}
      <div className="nav-tabs-row" style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "0 clamp(12px,4vw,48px) 10px",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        whiteSpace: "nowrap"
      }}>
        {savedPlan && [["checkin", "Check-In", Flame], ["plan", "My Plan", Map], ["chat", "Coach", MessageCircle], ["report", "Report", BarChart2], ["history", "Log", Clock], ["urge", "Urge", Zap]].map(([s, l, Ic]) => <button key={s} className={`nav-pill${screen === s ? " active" : ""}`} onClick={() => goTo(s)} style={{
          flexShrink: 0
        }}><Ic size={14} className="nav-pill-icon" />{l}</button>)}
        <button className={`nav-pill${screen === "confess" ? " active" : ""}`} onClick={() => goTo("confess")} style={{
          flexShrink: 0
        }}><Lock size={14} className="nav-pill-icon" />Confess</button>
        <button className={`nav-pill${screen === "about" ? " active" : ""}`} onClick={() => goTo("about")} style={{
          flexShrink: 0
        }}><Info size={14} className="nav-pill-icon" />About</button>
      </div>
    </nav>
    {showProfile && <ProfileSheet user={user} theme={theme} onThemeToggle={() => {
      onThemeToggle();
    }} onCommandMode={onCommandMode} onClose={() => setShowProfile(false)} onSignOut={handleSignOut} onPhotoUpdate={url => {
      user.photoURL = url;
    }} onAdminOpen={() => setShowAdmin(true)} onFeedback={() => setShowFeedback(true)} />}
    {showAdmin && <AdminDashboard theme={theme} onClose={() => setShowAdmin(false)} />}
    {showFeedback && <FeedbackSheet theme={theme} onClose={() => setShowFeedback(false)} />}
    </>;
}
function Marquee() {
  const txt = "RESET YOUR DOPAMINE · REWIRE YOUR BRAIN · RECONQUER YOUR MIND · SYNAPSE PROTOCOL · ";
  return <div style={{
    overflow: "hidden",
    borderTop: "1px solid rgba(255,140,0,0.07)",
    padding: "10px 0",
    background: "rgba(255,140,0,0.015)",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    contain: "layout"
  }}><div style={{
      display: "flex",
      animation: "marqueeAnim 35s linear infinite",
      whiteSpace: "nowrap",
      width: "max-content",
      willChange: "transform"
    }}>{Array(16).fill(txt).map((t, i) => <span key={i} style={{
        fontSize: 10,
        letterSpacing: 4,
        color: "rgba(255,140,0,0.28)",
        textTransform: "uppercase",
        fontWeight: 500,
        paddingRight: 48,
        flexShrink: 0
      }}>{t}</span>)}</div></div>;
}
function Dots({
  label
}) {
  return <div style={{
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 0"
  }}><div style={{
      display: "flex",
      gap: 5
    }}>{[0, 1, 2].map(i => <div key={i} style={{
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: "#ff8c00",
        animation: `dotBlink 1.2s ${i * .2}s ease-in-out infinite`
      }} />)}</div><span style={{
      fontSize: 11,
      color: "rgba(255,180,80,0.4)",
      letterSpacing: 2,
      textTransform: "uppercase",
      fontWeight: 500
    }}>{label}</span></div>;
}
const TAGLINES = ["Are you struggling to focus for more than 5 minutes?", "Do you reach for your phone the moment you're bored?", "Is your attention span getting shorter every week?", "Do reels and shorts feel impossible to stop watching?", "Are you feeling mentally foggy and unmotivated?", "Has porn or social media become an escape you can't quit?", "Do you feel dopamine crashes after every scroll session?", "Is your brain craving constant stimulation to feel normal?", "Are you unable to enjoy simple things anymore?", "Do you feel like your willpower has completely vanished?"];
function RotatingTaglines() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % TAGLINES.length);
        setVisible(true);
      }, 500);
    }, 3200);
    return () => clearInterval(t);
  }, []);
  return <div style={{
    marginBottom: 8,
    minHeight: 56
  }}><div style={{
      fontSize: 15,
      fontWeight: 300,
      lineHeight: 1.7,
      color: "var(--text3)",
      maxWidth: 520,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(8px)",
      transition: "all .5s cubic-bezier(.16,1,.3,1)",
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }}><span style={{
        color: "rgba(255,140,0,0.5)",
        fontSize: 16,
        marginTop: 1,
        flexShrink: 0
      }}>◈</span>{TAGLINES[idx]}</div></div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   ABOUT US — company / mission / founders page.
   Reuses the exact visual language of the landing (Boot) screen:
   Orbitron 900 amber→orange gradient headings, Space Grotesk 700 sub-heads,
   Space Mono terminal labels, Inter body, green-dot amber status chips,
   amber-bordered badge, and the #ff5500 orange-red CTA.
══════════════════════════════════════════════════════════════════════════ */
function About({
  onBegin,
  onBack
}) {
  // ── Shared style tokens (match landing page palette exactly) ──
  const GRAD = "linear-gradient(165deg,#fff8e7 0%,#fff8e7 12%,#f5a000 55%,#ff5500 100%)";
  const gradText = {
    fontFamily: "'Orbitron',sans-serif",
    fontWeight: 900,
    background: GRAD,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    letterSpacing: "-0.02em",
    lineHeight: 1.18,
    margin: 0,
    paddingBottom: "0.1em",
    textAlign: "center"
  };
  const kicker = {
    fontFamily: "'Space Mono',monospace",
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: "0.28em",
    color: "#6a5820",
    textTransform: "uppercase",
    marginBottom: 16,
    lineHeight: 1.4,
    textAlign: "center"
  };
  const subHead = {
    fontFamily: "'Space Grotesk',sans-serif",
    fontWeight: 700,
    fontSize: "clamp(15px,2.4vw,20px)",
    color: "#f5a000",
    letterSpacing: "0.01em",
    lineHeight: 1.35,
    margin: "0 0 14px"
  };
  const body = {
    fontFamily: "'Inter',sans-serif",
    fontWeight: 400,
    fontSize: "clamp(14px,1.5vw,16px)",
    lineHeight: 1.75,
    color: "#a89060",
    maxWidth: 680,
    margin: "0 auto",
    letterSpacing: "0.01em",
    textAlign: "left"
  };
  // Shared token for the smaller 14px copy used *inside* cards — reusing the
  // 1.75 line-height meant for the larger clamp() body text made these read
  // too loose/floaty at a fixed 14px. Tightened just for this context.
  const cardText = {
    ...body,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#9a8558"
  };
  const hl = {
    color: "#f5a000",
    fontWeight: 500
  }; // SEO keyword highlight
  const card = {
    background: "rgba(255,140,0,0.02)",
    border: "1px solid rgba(255,140,0,0.10)",
    borderRadius: 16,
    padding: "clamp(20px,3vw,30px)"
  };
  const sectionStyle = {
    position: "relative",
    zIndex: 2,
    padding: "clamp(56px,9vh,96px) clamp(24px,6vw,90px)",
    maxWidth: 960,
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box"
  };
  const rule = {
    width: "100%",
    height: 1,
    background: "#3a2800",
    margin: "clamp(18px,3vh,30px) 0"
  };

  // Scroll-reveal (mirrors the landing page IntersectionObserver pattern)
  const [seen, setSeen] = useState({});
  const [faqOpen, setFaqOpen] = useState(null);
  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = e.target.getAttribute("data-asec");
          setSeen(p => p[id] ? p : {
            ...p,
            [id]: true
          });
        }
      });
    }, {
      threshold: 0.12
    });
    document.querySelectorAll("[data-asec]").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  const reveal = id => ({
    opacity: seen[id] ? 1 : 0,
    transform: seen[id] ? "translateY(0)" : "translateY(18px)",
    transition: "opacity .6s ease,transform .6s ease"
  });
  const Chip = ({
    label
  }) => <div style={{
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontFamily: "'Space Mono',monospace",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.06em",
    color: "#c9a860",
    padding: "11px 0"
  }}>
      <span style={{
      color: "#00ff88",
      textShadow: "0 0 10px #00ff88",
      fontSize: 9,
      flexShrink: 0
    }}>●</span>
      <span>{label}</span>
    </div>;
  const diffRows = [["Restricts behavior", "Helps build better behavior"], ["Generic advice", "Personalized AI guidance"], ["Static habit trackers", "Adaptive accountability"], ["Tracks progress", "Guides and tracks progress"], ["Depends on willpower", "Builds sustainable lasting systems"], ["Clinical, transactional interfaces", "Immersive, engaging user experience"], ["Generic dashboards", "A purposeful experience that keeps users motivated"], ["Reactive after relapse", "Proactive, real-time interventions"], ["One-size-fits-all plans", "Personalized behavior-change journeys"], ["Focus on blocking distractions", "Focus on understanding and replacing habits"], ["Tracks what happened", "Helps shape what happens next"], ["Data without context", "Insights with actionable guidance"]];
  const faqs = [["Why use SYNAPSE instead of ChatGPT or other AI chatbots?", "Most AI chatbots answer questions. SYNAPSE is built to change behavior. Instead of starting from scratch every conversation, it creates a personalized recovery protocol, remembers your progress, adapts after relapses, analyzes patterns, and keeps you accountable through structured daily check-ins. It's not just an AI conversation — it's an AI-powered recovery system."], ["What is SYNAPSE?", "SYNAPSE is an AI-powered recovery platform designed to help people overcome compulsive digital habits such as pornography, doomscrolling, social media addiction, gaming, and other dopamine-driven behaviors. Using personalized coaching, daily accountability, and adaptive recovery plans, SYNAPSE helps you build healthier habits one day at a time."], ["How does SYNAPSE work?", "Start by completing a short assessment about your habits and challenges. SYNAPSE then generates a recovery protocol tailored to your goals, behavior, and triggers. Every day, you check in with your AI coach, track your progress, and receive guidance that evolves with your journey."], ["What makes SYNAPSE different?", "Most habit trackers count streaks. SYNAPSE focuses on understanding why you relapse and continuously adjusts your recovery strategy based on your behavior. Recovery is personalized — not one-size-fits-all."], ["What happens if I relapse?", "Relapse doesn't erase your progress. SYNAPSE helps you analyze what happened, identify triggers, and update your recovery plan to reduce the chances of repeating the same pattern. The goal is long-term improvement — not perfection."], ["How does the AI create my recovery plan?", "Your recovery plan is generated using the information you provide during onboarding along with your ongoing check-ins. As your behavior changes, the AI continuously refines your protocol instead of keeping you on a fixed routine."], ["How do daily check-ins work?", "Each day you'll complete a quick check-in to record your progress, urges, wins, setbacks, and mindset. Your responses help the AI understand your recovery journey and provide more relevant guidance over time."], ["Can SYNAPSE help with more than porn addiction?", "Yes. SYNAPSE is designed for behavioral addictions driven by unhealthy dopamine-seeking patterns, including social media, doomscrolling, gaming, binge-watching, and similar compulsive habits."], ["Does SYNAPSE replace therapy?", "No. SYNAPSE is a self-improvement and accountability tool, not a replacement for licensed mental health care. If you're experiencing serious mental health concerns, professional support is recommended."], ["Is my data private?", "Yes. Your recovery data is securely stored and used only to personalize your experience. Your information is never shared or sold."], ["Is SYNAPSE free?", "SYNAPSE offers a free experience with optional premium features that unlock more advanced AI coaching and recovery tools."], ["Can I use SYNAPSE on my phone?", "Yes. SYNAPSE is built as a Progressive Web App (PWA), allowing you to install and use it on desktop, Android, and iPhone without downloading it from an app store."], ["How long does recovery take?", "Recovery looks different for everyone. Some users notice improvements within weeks, while lasting behavioral change often requires consistent effort over several months. SYNAPSE is designed to support long-term progress, not quick fixes."], ["What are Recovery Levels?", "Recovery Levels mark important milestones in your journey. As you remain consistent and build healthier habits, you'll unlock higher levels that reflect your long-term progress — not just your current streak."], ["Why doesn't SYNAPSE focus only on streaks?", "A streak doesn't explain your behavior. SYNAPSE looks beyond the number of days and focuses on patterns, triggers, consistency, and sustainable recovery. The objective isn't to chase the longest streak — it's to build lasting change."]];
  return <div style={{
    background: "var(--bg)",
    minHeight: "100vh",
    width: "100%",
    position: "relative",
    overflowX: "hidden"
  }}>

      {/* ── HERO ── */}
      <section data-asec="hero" style={{
      ...sectionStyle,
      minHeight: "88vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      textAlign: "center",
      alignItems: "center"
    }}>
        {/* amber badge (DOPAMINE RESET PROTOCOL style) */}
        <div style={{
        ...reveal("hero"),
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 16px",
        borderRadius: 999,
        border: "1px solid #ffb347",
        background: "rgba(255,140,0,0.05)",
        fontFamily: "'Orbitron',sans-serif",
        fontSize: 9,
        fontWeight: 700,
        color: "#ffb347",
        letterSpacing: "0.28em",
        marginBottom: 30
      }}>
          <span style={{
          color: "#00ff88",
          textShadow: "0 0 8px #00ff88",
          fontSize: 8
        }}>●</span>ABOUT SYNAPSE
        </div>
        <h1 style={{
        ...gradText,
        fontSize: "clamp(32px,6.5vw,68px)",
        maxWidth: 900,
        ...reveal("hero")
      }}>Break the habit today.<br />Or stay in the loop tomorrow.</h1>
        <p style={{
        ...body,
        color: "#a89060",
        maxWidth: 720,
        margin: "28px auto 0",
        textAlign: "center",
        ...reveal("hero")
      }}>
          Synapse is an <span style={hl}>AI-powered accountability</span> and habit-building platform that helps people overcome addictive habits—including doomscrolling, social media addiction, pornography, gaming, caffeine, junk food, and gambling—through <span style={hl}>personalized guidance</span>, <span style={hl}>real-time interventions</span>, and intelligent <span style={hl}>behavior change</span>.
        </p>
        <div style={{
        ...kicker,
        marginTop: 34,
        marginBottom: 0,
        fontSize: 13,
        letterSpacing: "0.36em",
        color: "#f5a000",
        fontWeight: 700,
        ...reveal("hero")
      }}>RESET · REWIRE · RECONQUER</div>
      </section>

      {/* ── PROBLEM ── */}
      <section data-asec="problem" style={{
      ...sectionStyle,
      ...reveal("problem")
    }}>
        <div style={kicker}>THE PROBLEM</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Habits are built quietly.</h2>
        <div style={rule} />
        <p style={{
        ...body,
        marginBottom: 18
      }}>Addictive habits rarely begin with a lack of ambition. They begin with small decisions repeated every day—one more scroll, one more game, one more excuse. Over time, those moments become patterns, and those patterns become habits that quietly shape our decisions, our attention, and ultimately, the lives we live.</p>
        <p style={body}>Today, millions of people recognise the issue and want to change. Yet most simply don't have the right system to help them stay consistent when it matters most.</p>
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
        gap: 20,
        marginTop: 40
      }}>
          <div style={card}>
            <div style={subHead}>Why it exists</div>
            {["Modern platforms are designed to capture attention and encourage repeated engagement.", "Most habits are reinforced by recurring triggers, environments, and routines.", "People often rely on motivation alone, even though motivation naturally fluctuates."].map((t, i) => <p key={i} style={{
            ...cardText,
            marginBottom: i < 2 ? 12 : 0
          }}>— {t}</p>)}
          </div>
          <div style={card}>
            <div style={subHead}>Why current solutions fail</div>
            {["Blockers remove access but rarely change behavior.", "Generic habit trackers provide data without meaningful guidance.", "Most solutions stop at tracking progress instead of helping users navigate moments of temptation."].map((t, i) => <p key={i} style={{
            ...cardText,
            marginBottom: i < 2 ? 12 : 0
          }}>— {t}</p>)}
          </div>
        </div>
      </section>

      {/* ── INSIGHT ── */}
      <section data-asec="insight" style={{
      ...sectionStyle,
      ...reveal("insight")
    }}>
        <div style={kicker}>THE INSIGHT</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>It was never about willpower.</h2>
        <div style={rule} />
        <p style={{
        ...body,
        marginBottom: 18
      }}>Breaking a habit isn't about having stronger willpower. It's about having the right support at the right moment. Real <span style={hl}>behavior change</span> happens when people understand their patterns, receive <span style={hl}>personalized guidance</span>, and build systems that make better choices easier over time.</p>
        <div style={{
        ...card,
        borderColor: "rgba(255,140,0,0.2)",
        background: "rgba(255,140,0,0.04)"
      }}>
          <div style={subHead}>Gap in the Market</div>
          <p style={body}>Most existing solutions focus on <span style={hl}>restricting</span> behavior. We believe lasting change comes from <span style={hl}>understanding</span> behavior, adapting to the individual, and creating accountability that evolves with them.</p>
        </div>
      </section>

      {/* ── SOLUTION ── */}
      <section data-asec="solution" style={{
      ...sectionStyle,
      ...reveal("solution")
    }}>
        <div style={kicker}>THE SOLUTION</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Synapse adapts to you.</h2>
        <div style={rule} />
        <p style={{
        ...body,
        marginBottom: 18
      }}>Whether someone is trying to quit doomscrolling, reduce screen time, stop gambling, overcome pornography addiction, or build healthier routines, Synapse adapts to their individual journey instead of offering one-size-fits-all advice.</p>
        <p style={{
        ...body,
        marginBottom: 36
      }}>We built an <span style={hl}>AI-powered accountability</span> platform that helps people overcome addictive habits through personalized interventions, <span style={hl}>dopamine &amp; addiction recovery</span>, an AI coach, adaptive habit systems, and <span style={hl}>real-time guidance</span>. Rather than simply telling users what not to do, Synapse helps them understand why habits occur and supports them in building healthier ones.</p>
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
        gap: 18
      }}>
          {[["01", "Understand", "Synapse learns your addictions, habits, goals, routines, and the situations that lead to unhealthy decisions."], ["02", "Guide", "Using AI-powered accountability, Synapse delivers personalized support, practical interventions, and adaptive recommendations when they're needed most."], ["03", "Grow", "As you progress, Synapse continuously adapts to your journey, helping you build stronger habits and lasting discipline over time."]].map(([n, h, t]) => <div key={n} style={card}>
              <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontWeight: 700,
            fontSize: 26,
            color: "#f5a000",
            filter: "drop-shadow(0 0 12px rgba(245,160,0,.4))",
            marginBottom: 12
          }}>{n}</div>
              <div style={subHead}>{h}</div>
              <p style={{
            ...cardText
          }}>{t}</p>
            </div>)}
        </div>
        <div style={{
        marginTop: 38
      }}>
          <div style={{
          ...subHead,
          marginBottom: 20
        }}>Impact</div>
          <Chip label="Replace unhealthy habits with healthier routines" />
          <Chip label="Regain control over attention, decisions, and daily life" />
          <Chip label="Build sustainable discipline instead of relying on temporary motivation" />
        </div>
      </section>

      {/* ── MISSION + VISION ── */}
      <section data-asec="mv" style={{
      ...sectionStyle,
      ...reveal("mv")
    }}>
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
        gap: 28
      }}>
          <div>
            <div style={kicker}>MISSION</div>
            <h2 style={{
            ...gradText,
            fontSize: "clamp(22px,3.4vw,34px)",
            marginBottom: 18
          }}>Why we exist</h2>
            <p style={{
            ...body,
            marginBottom: 20
          }}>To empower people to overcome addictive habits by combining intelligent technology with <span style={hl}>personalized accountability</span>, making lasting <span style={hl}>behavior change</span> more accessible to everyone.</p>
            {["AI-powered accountability", "Behavior change through habit systems", "Long-term discipline over short-term motivation"].map((t, i) => <Chip key={i} label={t} />)}
          </div>
          <div>
            <div style={kicker}>VISION</div>
            <h2 style={{
            ...gradText,
            fontSize: "clamp(22px,3.4vw,34px)",
            marginBottom: 18
          }}>Where we're going</h2>
            <p style={body}>We envision a future where overcoming addictive habits is no longer limited by willpower alone, but supported by intelligent systems that help people make better decisions every day. Our long-term goal is to build the world's most trusted <span style={hl}>AI platform for lasting behavior change</span>.</p>
          </div>
        </div>
      </section>

      {/* ── FOUNDERS ── */}
      <section data-asec="founders" style={{
      ...sectionStyle,
      ...reveal("founders")
    }}>
        <div style={kicker}>THE TEAM</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Founders</h2>
        <div style={rule} />
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
        gap: 22
      }}>
          {[{
          ini: "PG",
          name: "Parth Goyal",
          role: "Co-Founder & CEO",
          focus: "Engineering, AI Systems, Technical Strategy, Product Development",
          contrib: "Built the first prototype of Synapse, leads the platform's technical architecture, engineering, and AI development."
        }, {
          ini: "ST",
          name: "Sandali Tiwari",
          role: "Co-Founder & COO",
          focus: "Product Management, Marketing, Operations, Growth",
          contrib: "Leads product strategy, user research, marketing, branding, partnerships, and company operations to ensure Synapse is built around real user needs."
        }].map(f => <div key={f.ini} style={card}>
              <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 16
          }}>
                <div style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              flexShrink: 0,
              background: "linear-gradient(135deg,#ff9500,#ff5000)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Orbitron',sans-serif",
              fontSize: 15,
              fontWeight: 900,
              color: "#fff",
              boxShadow: "0 4px 16px rgba(255,140,0,0.35)"
            }}>{f.ini}</div>
                <div>
                  <div style={{
                fontFamily: "'Orbitron',sans-serif",
                fontWeight: 800,
                fontSize: 16,
                color: "var(--text)",
                letterSpacing: 0.3
              }}>{f.name}</div>
                  <div style={{
                fontFamily: "'Space Mono',monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: "#f5a000",
                marginTop: 3,
                textTransform: "uppercase"
              }}>{f.role}</div>
                </div>
              </div>
              <div style={{
            fontFamily: "'Space Mono',monospace",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 8
          }}>Focus</div>
              <p style={{
            ...cardText,
            marginBottom: 14
          }}>{f.focus}</p>
              <div style={{
            fontFamily: "'Space Mono',monospace",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 8
          }}>Contribution</div>
              <p style={{
            ...cardText
          }}>{f.contrib}</p>
            </div>)}
        </div>
      </section>

      {/* ── VALUES ── */}
      <section data-asec="values" style={{
      ...sectionStyle,
      ...reveal("values")
    }}>
        <div style={kicker}>WHAT WE STAND FOR</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Our values</h2>
        <div style={rule} />
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
        gap: 18
      }}>
          {[["Discipline over motivation", "Sustainable systems outperform temporary inspiration."], ["People before metrics", "Every decision begins with understanding the people we serve."], ["Continuous improvement", "Small, consistent progress creates meaningful change."], ["Build with purpose", "Technology should empower people, not compete for their attention."]].map(([h, t]) => <div key={h} style={card}>
              <div style={subHead}>{h}</div>
              <p style={{
            ...cardText
          }}>{t}</p>
            </div>)}
        </div>
      </section>

      {/* ── DIFFERENTIATION TABLE ── */}
      <section data-asec="diff" style={{
      ...sectionStyle,
      ...reveal("diff")
    }}>
        <div style={kicker}>THE DIFFERENCE</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Traditional vs Synapse</h2>
        <div style={rule} />
        <div style={{
        border: "1px solid rgba(255,140,0,0.14)",
        borderRadius: 16,
        overflow: "hidden"
      }}>
          {/* header row */}
          <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr"
        }}>
            <div style={{
            padding: "14px clamp(14px,2.5vw,24px)",
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: "clamp(13px,1.6vw,15px)",
            letterSpacing: "0.01em",
            color: "#8a7040",
            background: "rgba(255,255,255,0.015)",
            borderBottom: "1px solid rgba(255,140,0,0.14)"
          }}>Traditional Solutions</div>
            <div style={{
            padding: "14px clamp(14px,2.5vw,24px)",
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: "clamp(13px,1.6vw,15px)",
            letterSpacing: "0.01em",
            color: "#f5a000",
            background: "rgba(255,140,0,0.06)",
            borderBottom: "1px solid rgba(255,140,0,0.22)"
          }}>Synapse</div>
          </div>
          {diffRows.map(([a, b], i) => <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderTop: i ? "1px solid rgba(255,140,0,0.07)" : "none"
        }}>
              <div style={{
            padding: "13px clamp(14px,2.5vw,24px)",
            fontFamily: "'Inter',sans-serif",
            fontSize: "clamp(12px,1.5vw,14px)",
            color: "#8a7040",
            lineHeight: 1.55
          }}>{a}</div>
              <div style={{
            padding: "13px clamp(14px,2.5vw,24px)",
            fontFamily: "'Inter',sans-serif",
            fontSize: "clamp(12px,1.5vw,14px)",
            fontWeight: 500,
            color: "#d8b878",
            lineHeight: 1.55,
            background: "rgba(255,140,0,0.025)"
          }}>{b}</div>
            </div>)}
        </div>
      </section>

      {/* ── HOW WE BUILD ── */}
      <section data-asec="build" style={{
      ...sectionStyle,
      ...reveal("build")
    }}>
        <div style={kicker}>HOW WE BUILD</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Built with users, not ahead of them.</h2>
        <div style={rule} />
        <p style={{
        ...body,
        marginBottom: 28
      }}>We build alongside our users, not ahead of them. Every feature begins with a real problem, it's shaped through user feedback, and is refined through continuous iteration. Our goal isn't to maximize screen time—it's to help people spend less time fighting unhealthy habits and compulsive behaviours, and more time living intentionally.</p>
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
        gap: 18
      }}>
          {["Build for real problems, not assumptions.", "Listen first, iterate second.", "Prioritize long-term impact over short-term engagement."].map((t, i) => <div key={i} style={card}><p style={{
            ...cardText
          }}>{t}</p></div>)}
        </div>
      </section>

      {/* ── JOURNEY ── */}
      <section data-asec="journey" style={{
      ...sectionStyle,
      ...reveal("journey")
    }}>
        <div style={kicker}>THE JOURNEY</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(26px,4.5vw,44px)"
      }}>Where we've been</h2>
        <div style={rule} />
        <div>
          {["Identified the growing need for personalized accountability in behavior change.", "Built the first version of Synapse to address addictive habits through AI-powered guidance.", "Continuously improving the platform through user feedback and rapid iteration."].map((t, i) => <div key={i} style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          padding: "14px 0",
          borderTop: i ? "1px solid rgba(255,140,0,0.07)" : "none"
        }}>
              <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontWeight: 700,
            fontSize: 15,
            color: "#f5a000",
            flexShrink: 0,
            minWidth: 34
          }}>{`0${i + 1}`}</div>
              <p style={{
            ...body,
            fontSize: 15,
            margin: 0
          }}>{t}</p>
            </div>)}
        </div>
      </section>

      {/* ── CLOSING + CTA ── */}
      <section data-asec="cta" style={{
      ...sectionStyle,
      textAlign: "center",
      minHeight: "70vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      ...reveal("cta")
    }}>
        <p style={{
        ...body,
        maxWidth: 640,
        textAlign: "center",
        margin: "0 auto 40px",
        fontSize: "clamp(16px,2vw,19px)",
        color: "#c9a860"
      }}>Every habit begins with a choice. Every meaningful change begins with the next one. Synapse is here to help you make it count.</p>
        <div style={{
        ...kicker,
        color: "#6a5820",
        marginBottom: 22
      }}>READY TO TAKE BACK CONTROL?</div>
        <h2 style={{
        ...gradText,
        fontSize: "clamp(30px,5vw,52px)",
        marginBottom: 8
      }}>Reset. Rewire. Reconquer.</h2>
        <button onClick={onBegin} style={{
        marginTop: 34,
        fontFamily: "'Orbitron',sans-serif",
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: "0.45em",
        padding: "22px 56px",
        paddingLeft: "calc(56px + 0.45em)",
        background: "#ff5500",
        border: "1px solid #ff5500",
        color: "#fff",
        cursor: "pointer",
        boxShadow: "0 0 40px rgba(255,85,0,.35)",
        transition: "box-shadow .3s,transform .2s"
      }} onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 0 60px rgba(255,85,0,.5)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }} onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 0 40px rgba(255,85,0,.35)";
        e.currentTarget.style.transform = "translateY(0)";
      }}>
          BEGIN RESET ›
        </button>
        {onBack && <button onClick={onBack} style={{
        marginTop: 24,
        background: "transparent",
        border: "none",
        fontFamily: "'Space Mono',monospace",
        fontSize: 10,
        letterSpacing: "0.2em",
        color: "#6a5820",
        textTransform: "uppercase",
        cursor: "pointer"
      }}>‹ Back</button>}
      </section>

    </div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   SPLIT LAYOUT — Boot (branding left) + Auth (form right) simultaneously
   This is the first page the user sees. No separate screens.
══════════════════════════════════════════════════════════════════════════ */
function Boot({
  onBegin,
  onLogin,
  hasPlan,
  theme,
  onThemeToggle,
  onAbout
}) {
  const canvasRef = useRef(null);
  const curRef = useRef(null);
  const [bootDone, setBootDone] = useState(false);
  const [mainVisible, setMainVisible] = useState(false);
  const [wmOn, setWmOn] = useState(false);
  const [ht1On, setHt1On] = useState(false);
  const [ht2On, setHt2On] = useState(false);
  const [hmetaOn, setHmetaOn] = useState(false);
  const [blogLines, setBlogLines] = useState([]);
  const [bpct, setBpct] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [s1vis, setS1vis] = useState(false);
  const [s2vis, setS2vis] = useState(false);
  const [s3vis, setS3vis] = useState(false);
  const [s4vis, setS4vis] = useState(false);
  const [s5vis, setS5vis] = useState(false);
  const [ctaCharged, setCtaCharged] = useState(false);
  const [ctaFill, setCtaFill] = useState(0);
  const [metric1, setMetric1] = useState(0);
  const [metric2, setMetric2] = useState(0);
  const [faqOpen, setFaqOpen] = useState(null);
  const chargeRef = useRef(null);
  const chargeVal = useRef(0);

  // Font loading moved to index.html (preconnect + <link>) for LCP — see
  // note there. This JS injection used to make the browser wait for the
  // full JS bundle to parse/execute before even requesting fonts.

  const BL = ["> ACCESSING NEURAL INTERFACE...", "> IDENTITY VERIFIED.", "> DOPAMINE PROFILE LOADED.", "> CALIBRATING RECOVERY MATRIX...", "> INITIALIZING SYNAPSE PROTOCOL v2.0..."];

  // Boot sequence
  // PERF FIX: the boot overlay is a full-screen opaque black div (z-index 8000)
  // that sits on top of the real page content until this sequence finishes.
  // Content behind an opaque overlay doesn't count toward LCP, so every visitor
  // — including mobile — had their Largest Contentful Paint pushed back by the
  // full ~4s boot duration (2.1s of typed lines + ~1.8s progress bar), which is
  // why mobile Speed Insights showed LCP ~6.3s ("Poor") while desktop's faster
  // CPU absorbed the same delay chain unnoticed. Two changes:
  //   1. Repeat visitors (localStorage flag) skip the cinematic boot entirely —
  //      they've seen it, it adds nothing but pure LCP tax on every return visit.
  //   2. First-time visitors still get the intro, but at half the duration —
  //      still reads as intentional/cinematic, no longer as "stuck loading".
  useEffect(() => {
    const seen = ls.get("syn_boot_seen", "");
    if (seen) {
      // Instant skip — no black overlay delay for returning users.
      setShowProgress(true);
      setBpct(100);
      launch();
      return;
    }
    ls.set("syn_boot_seen", "1");
    let i = 0;
    const addLine = () => {
      if (i >= BL.length) {
        setShowProgress(true);
        return;
      }
      setBlogLines(l => [...l, BL[i]]);
      i++;
      setTimeout(addLine, i <= 2 ? 240 : 170); // was 480/340 — halved
    };
    setTimeout(addLine, 250); // was 500
  }, []);

  // Progress bar
  useEffect(() => {
    if (!showProgress || bootDone) return;
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(p + (p < 65 ? 2.8 : p < 88 ? 1.5 : .7), 100); // ~2x speed vs original
      setBpct(Math.round(p));
      if (p >= 100) {
        clearInterval(iv);
        setTimeout(launch, 90);
      }
    }, 16);
    return () => clearInterval(iv);
  }, [showProgress]);
  function launch() {
    setBootDone(true);
    setTimeout(() => {
      setMainVisible(true);
      setTimeout(() => {
        setWmOn(true);
      }, 180);
      setTimeout(() => setHt1On(true), 400);
      setTimeout(() => setHt2On(true), 500);
      setTimeout(() => setHmetaOn(true), 640);
      setTimeout(() => trigGlitch(), 2100);
    }, 120);
  }
  function trigGlitch() {
    setGlitch(true);
    setTimeout(() => setGlitch(false), 100);
    setTimeout(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 75);
    }, 170);
    setTimeout(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 85);
    }, 290);
  }
  useEffect(() => {
    const iv = setInterval(trigGlitch, 9000);
    return () => clearInterval(iv);
  }, []);

  // Scroll reveal
  useEffect(() => {
    if (!mainVisible) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.getAttribute("data-sec");
        if (id === "s1") setTimeout(() => setS1vis(true), 80);
        if (id === "s2") setTimeout(() => setS2vis(true), 80);
        if (id === "s3") setTimeout(() => setS3vis(true), 80);
        if (id === "s4") {
          setTimeout(() => setS4vis(true), 80);
          setTimeout(() => {
            let c = 0;
            const iv = setInterval(() => {
              c = Math.min(c + 5, 90);
              setMetric1(c);
              if (c >= 90) clearInterval(iv);
            }, 40);
          }, 900);
          setTimeout(() => {
            let c = 0;
            const iv = setInterval(() => {
              c = Math.min(c + 1, 7);
              setMetric2(c);
              if (c >= 7) clearInterval(iv);
            }, 80);
          }, 900);
        }
        if (id === "s5") setTimeout(() => setS5vis(true), 80);
      });
    }, {
      threshold: .22
    });
    document.querySelectorAll("[data-sec]").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [mainVisible]);

  // Neural canvas
  useEffect(() => {
    if (!mainVisible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let W,
      H,
      lastT = 0,
      speedMult = 1,
      pulseStr = 0,
      mouse = {
        x: 0,
        y: 0
      };
    class Neuron {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.nbrs = [];
        this.act = 0;
        this.ref = 0;
      }
      update(dt) {
        this.act = Math.max(0, this.act - dt * 2.2);
        this.ref = Math.max(0, this.ref - dt);
      }
      canFire() {
        return this.ref <= 0;
      }
      fire() {
        this.act = 1;
        this.ref = 1.4 + Math.random() * .8;
      }
    }
    class Signal {
      constructor(f, t) {
        this.f = f;
        this.t = t;
        this.p = 0;
        this.sp = .22 + Math.random() * .18;
        this.done = false;
      }
      update(dt, sm) {
        this.p += this.sp * dt * sm;
        if (this.p >= 1) {
          this.done = true;
          if (this.t.canFire() && Math.random() < .55) {
            this.t.fire();
            if (sigs.length < 35) this.t.nbrs.slice(0, 1 + Math.floor(Math.random() * 2)).forEach(n => {
              if (n !== this.f && Math.random() < .45) sigs.push(new Signal(this.t, n));
            });
          }
        }
      }
      draw() {
        const x = this.f.x + (this.t.x - this.f.x) * this.p,
          y = this.f.y + (this.t.y - this.f.y) * this.p;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245,160,0,.18)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245,160,0,.95)";
        ctx.fill();
      }
    }
    const neurs = [],
      sigs = [];
    function initN() {
      neurs.length = 0;
      sigs.length = 0;
      for (let i = 0; i < 38; i++) {
        const a = i / 38 * Math.PI * 2,
          r = .08 + Math.random() * .44;
        let x = W * .5 + Math.cos(a) * r * W * .55 + (Math.random() - .5) * W * .28,
          y = H * .5 + Math.sin(a) * r * H * .55 + (Math.random() - .5) * H * .28;
        x = Math.max(60, Math.min(W - 60, x));
        y = Math.max(60, Math.min(H - 60, y));
        neurs.push(new Neuron(x, y));
      }
      neurs.forEach(n => {
        n.nbrs = neurs.filter(m => m !== n).sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y)).slice(0, 2 + Math.floor(Math.random() * 3));
      });
    }
    const onMM = e => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener("mousemove", onMM);
    let lastFire = 0,
      raf;
    function ntick(ts) {
      const dt = Math.min((ts - lastT) / 1000, .05);
      lastT = ts;
      speedMult = 1 + pulseStr * 2.8;
      if (ts - lastFire > 900) {
        lastFire = ts;
        const el = neurs.filter(n => n.canFire() && n.nbrs.length > 0);
        if (el.length && sigs.length < 28) {
          const src = el[Math.floor(Math.random() * el.length)];
          src.fire();
          src.nbrs.slice(0, 1 + Math.floor(Math.random() * 2)).forEach(t => sigs.push(new Signal(src, t)));
        }
      }
      neurs.forEach(n => {
        const dx = n.x - mouse.x,
          dy = n.y - mouse.y,
          d = Math.sqrt(dx * dx + dy * dy);
        if (d < 140) {
          const f = (140 - d) / 140 * .0015;
          n.x += dx * f;
          n.y += dy * f;
        }
        n.update(dt);
      });
      ctx.clearRect(0, 0, W, H);
      neurs.forEach(n => {
        n.nbrs.forEach(m => {
          const dist = Math.hypot(n.x - m.x, n.y - m.y),
            actv = Math.max(n.act, m.act),
            base = Math.max(.025, .08 - dist / 2800),
            alpha = base + actv * .28;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(m.x, m.y);
          ctx.strokeStyle = `rgba(245,160,0,${alpha})`;
          ctx.lineWidth = actv > .3 ? .8 : .35;
          ctx.stroke();
        });
      });
      neurs.forEach(n => {
        const r = 1.8 + n.act * 4,
          a = .3 + n.act * .7;
        if (n.act > .25) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 7);
          g.addColorStop(0, `rgba(245,160,0,${n.act * .38})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 7, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,160,0,${a})`;
        ctx.fill();
      });
      sigs.forEach(s => s.update(dt, speedMult));
      sigs.forEach(s => s.draw());
      for (let i = sigs.length - 1; i >= 0; i--) if (sigs[i].done) sigs.splice(i, 1);
      raf = requestAnimationFrame(ntick);
    }
    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    const onR = () => {
      resize();
      initN();
    };
    window.addEventListener("resize", onR);
    resize();
    initN();
    raf = requestAnimationFrame(ts => {
      lastT = ts;
      ntick(ts);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMM);
      window.removeEventListener("resize", onR);
    };
  }, [mainVisible]);

  // Cursor
  useEffect(() => {
    const cur = curRef.current;
    if (!cur) return;
    let cx = 0,
      cy = 0,
      tx = 0,
      ty = 0,
      raf;
    const onM = e => {
      tx = e.clientX;
      ty = e.clientY;
    };
    window.addEventListener("mousemove", onM);
    const tick = () => {
      cx += (tx - cx) * .13;
      cy += (ty - cy) * .13;
      cur.style.left = cx + "px";
      cur.style.top = cy + "px";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onM);
    };
  }, []);

  // CTA charge
  const handleCtaEnter = () => {
    if (ctaCharged) return;
    clearInterval(chargeRef.current);
    chargeRef.current = setInterval(() => {
      chargeVal.current = Math.min(chargeVal.current + 1.1, 100);
      setCtaFill(chargeVal.current);
      if (chargeVal.current >= 100) {
        clearInterval(chargeRef.current);
        setCtaCharged(true);
      }
    }, 16);
  };
  const handleCtaLeave = () => {
    if (ctaCharged) return;
    clearInterval(chargeRef.current);
    chargeRef.current = setInterval(() => {
      chargeVal.current = Math.max(chargeVal.current - 4, 0);
      setCtaFill(chargeVal.current);
      if (chargeVal.current <= 0) clearInterval(chargeRef.current);
    }, 16);
  };
  const slineStyle = (vis, delay = 0) => ({
    fontFamily: "'Space Mono',monospace",
    fontWeight: 400,
    fontSize: 10,
    letterSpacing: "0.06em",
    color: "#8a7040",
    display: "flex",
    alignItems: "center",
    gap: 9,
    opacity: vis ? 1 : 0,
    transform: vis ? "translateX(0)" : "translateX(-12px)",
    transition: `opacity .4s ${delay}ms,transform .4s ${delay}ms`
  });
  const stitleStyle = vis => ({
    fontFamily: "'Space Grotesk',sans-serif",
    fontWeight: 700,
    fontSize: "clamp(30px,5.2vw,66px)",
    lineHeight: 1.05,
    letterSpacing: "-0.025em",
    color: "#fff8e7",
    marginBottom: 40,
    textAlign: "left",
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(20px)",
    transition: "opacity .7s,transform .7s cubic-bezier(.1,0,0,1)",
    WebkitFontSmoothing: "antialiased"
  });
  const sbodyStyle = (vis, delay = 0) => ({
    fontFamily: "'Inter',sans-serif",
    fontWeight: 400,
    fontSize: 15,
    letterSpacing: "0.01em",
    lineHeight: 1.82,
    color: "#8a7040",
    textAlign: "left",
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(7px)",
    transition: `opacity .5s ${delay}ms,transform .5s ${delay}ms`
  });
  return <div style={{
    background: "#0a0800",
    minHeight: "100vh",
    position: "relative",
    overflowX: "hidden",
    overflowY: "auto",
    fontFamily: "'Inter',sans-serif",
    cursor: "none"
  }}>

      {/* Custom cursor */}
      <div ref={curRef} style={{
      position: "fixed",
      pointerEvents: "none",
      zIndex: 9999,
      transform: "translate(-50%,-50%)",
      transition: "none"
    }}>
        <svg width="26" height="26"><circle cx="13" cy="13" r="11" fill="none" stroke="rgba(245,160,0,.7)" strokeWidth="1" /></svg>
      </div>

      {/* Boot overlay */}
      {!bootDone && <div style={{
      position: "fixed",
      inset: 0,
      background: "#000",
      zIndex: 8000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
          <div style={{
        width: 520,
        maxWidth: "88vw"
      }}>
            <div style={{
          marginBottom: 28
        }}>
              {blogLines.map((l, i) => <div key={i} style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 12,
            letterSpacing: "0.06em",
            lineHeight: 2.2,
            color: "#f5a000",
            opacity: 1,
            transition: "opacity .2s"
          }}>
                  {l}
                </div>)}
            </div>
            {showProgress && <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 10
        }}>
                <div style={{
            height: 2,
            background: "#1a1200",
            border: "1px solid #3a2800"
          }}>
                  <div style={{
              height: "100%",
              width: bpct + "%",
              background: "#f5a000",
              boxShadow: "0 0 10px #f5a000",
              transition: "width .016s linear"
            }} />
                </div>
                <div style={{
            fontFamily: "'Space Mono',monospace",
            fontSize: 9,
            letterSpacing: "0.25em",
            color: "#6a5820",
            textAlign: "right"
          }}>{bpct}%</div>
              </div>}
          </div>
        </div>}

      {/* Direct login entry — returning users with an account shouldn't have
          to go through the whole Confess → Plan flow just to sign in. */}
      {onAbout && <button onClick={onAbout} style={{
      position: "fixed",
      top: 18,
      left: "clamp(14px,4vw,32px)",
      zIndex: 7000,
      background: "rgba(245,160,0,0.08)",
      border: "1px solid rgba(245,160,0,0.3)",
      color: "#f5a000",
      padding: "9px 18px",
      borderRadius: 999,
      fontFamily: "'Space Mono',monospace",
      fontSize: 9,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      cursor: "pointer",
      backdropFilter: "blur(8px)",
      transition: "all .25s"
    }} onMouseEnter={e => {
      e.currentTarget.style.background = "rgba(245,160,0,0.16)";
      e.currentTarget.style.borderColor = "rgba(245,160,0,0.55)";
    }} onMouseLeave={e => {
      e.currentTarget.style.background = "rgba(245,160,0,0.08)";
      e.currentTarget.style.borderColor = "rgba(245,160,0,0.3)";
    }}>
          About
        </button>}
      {onLogin && <button onClick={onLogin} style={{
      position: "fixed",
      top: 18,
      right: "clamp(14px,4vw,32px)",
      zIndex: 7000,
      background: "rgba(245,160,0,0.08)",
      border: "1px solid rgba(245,160,0,0.3)",
      color: "#f5a000",
      padding: "9px 18px",
      borderRadius: 999,
      fontFamily: "'Space Mono',monospace",
      fontSize: 9,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      cursor: "pointer",
      backdropFilter: "blur(8px)",
      transition: "all .25s"
    }} onMouseEnter={e => {
      e.currentTarget.style.background = "rgba(245,160,0,0.16)";
      e.currentTarget.style.borderColor = "rgba(245,160,0,0.55)";
    }} onMouseLeave={e => {
      e.currentTarget.style.background = "rgba(245,160,0,0.08)";
      e.currentTarget.style.borderColor = "rgba(245,160,0,0.3)";
    }}>
        Log In →
      </button>}

      {/* Main content */}
      <div style={{
      opacity: mainVisible ? 1 : 0,
      pointerEvents: mainVisible ? "auto" : "none",
      transition: "opacity .7s",
      position: "relative"
    }}>

        {/* Neural canvas */}
        <canvas ref={canvasRef} style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0
      }} />

        {/* Ambient halos */}
        <div style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 1,
        overflow: "hidden"
      }}>
          <div style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          filter: "blur(100px)",
          opacity: mainVisible ? .09 : 0,
          transition: "opacity 2.5s",
          background: "radial-gradient(circle,#f5a000,transparent 70%)",
          top: "-10%",
          left: "-5%"
        }} />
          <div style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          filter: "blur(100px)",
          opacity: mainVisible ? .09 : 0,
          transition: "opacity 2.5s",
          background: "radial-gradient(circle,#cc5500,transparent 70%)",
          top: "20%",
          right: "-15%"
        }} />
          <div style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          filter: "blur(100px)",
          opacity: mainVisible ? .09 : 0,
          transition: "opacity 2.5s",
          background: "radial-gradient(circle,#cc7a00,transparent 70%)",
          bottom: "-5%",
          left: "30%"
        }} />
        </div>

        {/* Border frame */}
        <div style={{
        position: "fixed",
        inset: 3,
        border: "1px solid #1a0f00",
        pointerEvents: "none",
        zIndex: 200
      }} />

        {/* ── SECTION 0: Hero ── */}
        <section style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)",
        overflow: "visible"
      }}>
          {/* H-rules */}
          <div style={{
          width: "100%",
          height: 1,
          background: "#cc7a00",
          marginBottom: 18,
          clipPath: wmOn ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
          transition: "clip-path 1s cubic-bezier(.4,0,.1,1)"
        }} />

          {/* SYNAPSE wordmark */}
          <div style={{
          position: "relative",
          width: "100%",
          textAlign: "center",
          overflow: "visible",
          padding: "18px 0"
        }}>            <span style={{
            fontFamily: "'Orbitron',sans-serif",
            fontWeight: 900,
            fontSize: "clamp(44px,12vw,196px)",
            letterSpacing: "-0.03em",
            lineHeight: 1,
            fontFeatureSettings: '"kern" 1,"liga" 0',
            background: "linear-gradient(165deg,#fff8e7 0%,#fff8e7 18%,#f5a000 52%,#ff5500 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 50px rgba(245,160,0,.4))",
            userSelect: "none",
            display: "block",
            width: "100%",
            padding: "0.05em 0",
            opacity: wmOn ? 1 : 0,
            transform: wmOn ? "translateY(0) scale(1)" : "translateY(-26px) scale(1.03)",
            transition: "opacity .7s,transform .7s cubic-bezier(.1,0,0,1)",
            position: "relative"
          }}>
              SYNAPSE
              {glitch && <>
                <span style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                fontFamily: "'Orbitron',sans-serif",
                fontWeight: 900,
                fontSize: "inherit",
                letterSpacing: "-0.03em",
                lineHeight: .9,
                background: "linear-gradient(165deg,#ff8800,#ff5500)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                clipPath: "polygon(0 12%,100% 12%,100% 34%,0 34%)",
                transform: "translateX(-4px)",
                opacity: .88
              }}>SYNAPSE</span>
                <span style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                fontFamily: "'Orbitron',sans-serif",
                fontWeight: 900,
                fontSize: "inherit",
                letterSpacing: "-0.03em",
                lineHeight: .9,
                background: "linear-gradient(165deg,#f5a000,#d4920a)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                clipPath: "polygon(0 64%,100% 64%,100% 82%,0 82%)",
                transform: "translateX(4px)",
                opacity: .88
              }}>SYNAPSE</span>
              </>}
            </span>
          </div>

          {/* Taglines */}
          <div style={{
          margin: "10px 0 4px"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: "clamp(9px,0.85vw,12px)",
            letterSpacing: "0.42em",
            lineHeight: 1.7,
            color: "#f5a000",
            opacity: ht1On ? 1 : 0,
            transition: "opacity .6s",
            margin: "2px 0"
          }}>GET BACK TO YOUR</div>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: "clamp(9px,0.85vw,12px)",
            letterSpacing: "0.42em",
            lineHeight: 1.7,
            color: "#f5a000",
            opacity: ht2On ? 1 : 0,
            transition: "opacity .6s",
            margin: "2px 0"
          }}>DOPAMINE BASELINE</div>
          </div>

          <div style={{
          width: "100%",
          height: 1,
          background: "#cc7a00",
          marginTop: 18,
          clipPath: wmOn ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
          transition: "clip-path 1s cubic-bezier(.4,0,.1,1) .2s"
        }} />

          {/* Meta */}
          <div style={{
          fontFamily: "'Space Mono',monospace",
          fontWeight: 400,
          fontSize: "clamp(9px,0.75vw,13px)",
          letterSpacing: "0.28em",
          color: "#6a5820",
          marginTop: 28,
          display: "flex",
          gap: 12,
          justifyContent: "center",
          alignItems: "center",
          flexWrap: "wrap",
          opacity: hmetaOn ? 1 : 0,
          transition: "opacity .6s"
        }}>
            <span>AI RECOVERY SYSTEM</span>
            <span style={{
            color: "#3a2800"
          }}>·</span>
            <span>VERSION 2.4.1</span>
            <span style={{
            color: "#3a2800"
          }}>·</span>
            <span>STATUS:&nbsp;<span style={{
              color: "#00ff88"
            }}>ONLINE</span></span>
          </div>

          {/* Scroll hint */}
          <div style={{
          position: "absolute",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "'Space Mono',monospace",
          fontSize: 8,
          letterSpacing: "0.4em",
          color: "#6a5820",
          animation: "shrb 2.2s ease-in-out infinite",
          whiteSpace: "nowrap"
        }}>▼ SCROLL TO CONTINUE</div>
        </section>

        {/* ── SECTION 1: Who Are You ── */}
        <section data-sec="s1" style={{
        minHeight: "70vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)"
      }}>
          <div style={{
          maxWidth: 680
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 9,
            letterSpacing: "0.44em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 20,
            opacity: s1vis ? 1 : 0,
            transform: s1vis ? "translateX(0)" : "translateX(-16px)",
            transition: "opacity .5s,transform .5s"
          }}>SUBJECT ANALYSIS</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44,
            position: "relative",
            overflow: "hidden",
            opacity: s1vis ? 1 : 0,
            transition: "opacity .3s .1s"
          }}>
              <div style={{
              content: "''",
              position: "absolute",
              left: "-100%",
              top: 0,
              width: "80%",
              height: "100%",
              background: "linear-gradient(90deg,transparent,rgba(245,160,0,.7),transparent)",
              animation: "rscan 5s ease-in-out infinite"
            }} />
            </div>
            <h2 style={stitleStyle(s1vis)}>WHO ARE YOU?</h2>
            <div style={{
            maxWidth: "56ch"
          }}>
              {[{
              t: "You reach for your phone before you're out of bed.",
              d: 0
            }, {
              t: "You can't finish a thought without an interruption.",
              d: 65
            }, {
              t: "You scroll not to find something —",
              d: 130
            }, {
              t: "to feel something.",
              d: 195
            }, {
              t: "Your dopamine system has been hijacked.",
              d: 260,
              amber: true
            }, {
              t: "This is not a willpower problem.",
              d: 340,
              dim: true
            }, {
              t: "This is neuroscience.",
              d: 405,
              dim: true
            }].map((p, i) => <p key={i} style={{
              fontFamily: "'Inter',sans-serif",
              fontWeight: p.amber ? 500 : 400,
              fontSize: 15,
              letterSpacing: "0.01em",
              lineHeight: 1.82,
              color: p.amber ? "#f5a000" : p.dim ? "#6a5820" : "#8a7040",
              marginTop: i === 4 || i === 5 ? 18 : 0,
              marginBottom: 0,
              textAlign: "left",
              opacity: s1vis ? 1 : 0,
              transform: s1vis ? "translateY(0)" : "translateY(7px)",
              transition: `opacity .5s ${560 + p.d}ms,transform .5s ${560 + p.d}ms`
            }}>{p.t}</p>)}
            </div>
          </div>
        </section>

        {/* ── SECTION 2: Your Brain Has Changed ── */}
        <section data-sec="s2" style={{
        minHeight: "70vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)"
      }}>
          <div style={{
          maxWidth: 680,
          textAlign: "left"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 9,
            letterSpacing: "0.44em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 20,
            opacity: s2vis ? 1 : 0,
            transform: s2vis ? "translateX(0)" : "translateX(-16px)",
            transition: "opacity .5s,transform .5s"
          }}>NEURAL ASSESSMENT</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44,
            opacity: s2vis ? 1 : 0,
            transition: "opacity .3s .1s"
          }} />
            <h2 style={stitleStyle(s2vis)}>YOUR BRAIN<br />HAS CHANGED.</h2>
            <div style={{
            maxWidth: "56ch"
          }}>
              {[{
              t: "Chronic overstimulation has altered your dopamine baseline threshold.",
              d: 0
            }, {
              t: "Tasks that once felt rewarding now feel impossible.",
              d: 65
            }, {
              t: "The problem isn't you.",
              d: 145,
              amber: true
            }, {
              t: "The problem is the loop you're stuck in.",
              d: 210,
              amber: true
            }].map((p, i) => <p key={i} style={{
              ...sbodyStyle(s2vis, 560 + p.d),
              color: p.amber ? "#f5a000" : "#8a7040",
              fontWeight: p.amber ? 500 : 400,
              marginTop: i >= 2 ? 18 : 0
            }}>{p.t}</p>)}
            </div>
          </div>
        </section>

        {/* ── SECTION 3: We Can Map It ── */}
        <section data-sec="s3" style={{
        minHeight: "70vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)"
      }}>
          <div style={{
          maxWidth: 680,
          textAlign: "left"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 9,
            letterSpacing: "0.44em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 20,
            opacity: s3vis ? 1 : 0,
            transform: s3vis ? "translateX(0)" : "translateX(-16px)",
            transition: "opacity .5s,transform .5s"
          }}>RECOVERY ARCHITECTURE</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44,
            opacity: s3vis ? 1 : 0,
            transition: "opacity .3s .1s"
          }} />
            <h2 style={stitleStyle(s3vis)}>WE CAN<br />MAP IT.</h2>
            <div style={{
            maxWidth: "56ch"
          }}>
              <p style={sbodyStyle(s3vis, 560)}>SYNAPSE builds your protocol from:</p>
              <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 11,
              margin: "22px 0"
            }}>
                {["ADDICTION PATTERN ANALYSIS", "PSYCHOLOGICAL ARCHETYPE", "BEHAVIORAL HISTORY", "DAILY CHECK-IN DATA"].map((item, i) => <div key={i} style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#f5a000",
                display: "flex",
                alignItems: "center",
                gap: 14,
                opacity: s3vis ? 1 : 0,
                transform: s3vis ? "translateX(0)" : "translateX(-12px)",
                transition: `opacity .4s ${680 + i * 110}ms,transform .4s ${680 + i * 110}ms`
              }}>
                    <span style={{
                  color: "#d4920a",
                  fontSize: 8
                }}>◆</span>{item}
                  </div>)}
              </div>
              <p style={{
              ...sbodyStyle(s3vis, 1100),
              color: "#f5a000",
              fontWeight: 500
            }}>Not generic advice. Precision recovery.</p>
            </div>
          </div>
        </section>

        {/* ── SECTION 4: System Status + Metrics ── */}
        <section data-sec="s4" style={{
        minHeight: "70vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)"
      }}>
          <div style={{
          maxWidth: 1040,
          width: "100%"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 9,
            letterSpacing: "0.44em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 20,
            opacity: s4vis ? 1 : 0,
            transform: s4vis ? "translateX(0)" : "translateX(-16px)",
            transition: "opacity .5s,transform .5s"
          }}>SYSTEM STATUS</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44,
            opacity: s4vis ? 1 : 0,
            transition: "opacity .3s .1s"
          }} />
            <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 15
          }}>
              {[["NEURAL SCANNER", "ONLINE"], ["DOPAMINE ANALYZER", "ACTIVE"], ["RECOVERY PROTOCOL ENGINE", "LOADED"], ["CONFESSION VAULT", "ARMED"]].map(([label, val], i) => <div key={i} style={slineStyle(s4vis, 480 + i * 140)}>
                  <span style={{
                color: "#00ff88",
                textShadow: "0 0 10px #00ff88",
                fontSize: 9
              }}>●</span>
                  <span>{label}</span>
                  <span style={{
                flex: 1,
                color: "#2a1a00",
                overflow: "hidden",
                whiteSpace: "nowrap",
                letterSpacing: "0.15em"
              }}>{"·".repeat(60)}</span>
                  <span style={{
                fontFamily: "'Space Mono',monospace",
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: "0.06em",
                color: "#f5a000",
                flexShrink: 0
              }}>{val}</span>
                </div>)}
            </div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            margin: "44px 0 40px",
            opacity: s4vis ? 1 : 0,
            transition: "opacity .3s .2s"
          }} />
            <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)"
          }}>
              {[[metric1 + "+", "DAY RESET"], [metric2, "RECOVERY PHASES"], ["AI", "DAILY COACH"], ["∞", "ADAPTIVE"]].map(([num, lbl], i) => <div key={i} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              opacity: s4vis ? 1 : 0,
              transform: s4vis ? "translateY(0)" : "translateY(16px)",
              transition: `opacity .5s ${740 + i * 140}ms,transform .5s ${740 + i * 140}ms`
            }}>
                  <div style={{
                fontFamily: "'Orbitron',sans-serif",
                fontWeight: 700,
                fontSize: "clamp(28px,4vw,58px)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "#f5a000",
                filter: "drop-shadow(0 0 12px rgba(245,160,0,.45))"
              }}>{num}</div>
                  <div style={{
                fontFamily: "'Space Mono',monospace",
                fontSize: 8,
                color: "#5a4200",
                letterSpacing: "-0.1em"
              }}>━━━━━━━━━━</div>
                  <div style={{
                fontFamily: "'Space Mono',monospace",
                fontWeight: 400,
                fontSize: 8,
                letterSpacing: "0.22em",
                color: "#6a5820",
                textAlign: "center"
              }}>{lbl}</div>
                </div>)}
            </div>
          </div>
        </section>

        {/* ── SECTION 4.5: TESTIMONIALS ── */}
        <section data-sec="testi" style={{
        position: "relative",
        zIndex: 2,
        padding: "clamp(50px,7vh,80px) 0"
      }}>
          <div style={{
          fontFamily: "'Space Mono',monospace",
          fontWeight: 400,
          fontSize: 9,
          letterSpacing: "0.44em",
          color: "#6a5820",
          textTransform: "uppercase",
          marginBottom: 20,
          textAlign: "center"
        }}>REAL RESULTS</div>
          <div style={{
          width: "min(100%,1160px)",
          height: 1,
          background: "#3a2800",
          marginBottom: 44,
          marginLeft: "auto",
          marginRight: "auto"
        }} />
          <div className="testi-viewport">
            <div className="testi-track">
              {[...Array(2)].flatMap(() => [["As a student, I personally felt a huge difference using Synapse. It has helped me dismantle the habits that I was struggling with for over an year. I've saved a huge amount of time that I'm really really grateful for!", "Kanchi", "Beta Tester"], ["The UI definitely doesn't feel like another boring habit tracker. It actually made me want to come back every day.", "Satyam", "Beta Tester"], ["The conversations felt surprisingly personal. It remembered what I was struggling with and gave practical suggestions that were really helpful for me to be better.", "Sanvee", "Early User"], ["I really liked the fact that it tried to understand why I was procrastinating instead of just telling me to stop.", "Kanha", "Beta Tester"], ["The AI coach is the feature I liked the most along with the battle plan. It builds a proper plan for addicted people which is very useful and necessary.", "Aditya", "Early User"], ["The plan was genuinely helpful and made a real difference in managing my compulsive habits. It also provided a clear roadmap to follow which makes the journey to my goal feel achievable.", "Jiya", "Early User"], ["The website is built impressively. It helped me channelize my time productively. I love using it.", "Jyotica", "Early User"]]).map(([quote, name, role], i) => <div key={i} className="testi-card">
                  <div style={{
                color: "#f5a000",
                fontSize: 13,
                letterSpacing: 2,
                marginBottom: 14
              }}>★★★★★</div>
                  <p style={{
                fontFamily: "'Inter',sans-serif",
                fontSize: 13.5,
                lineHeight: 1.65,
                color: "#c9a860",
                margin: "0 0 18px",
                flex: 1
              }}>&ldquo;{quote}&rdquo;</p>
                  <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10
              }}>
                    <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: "linear-gradient(135deg,#ff9500,#ff5000)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "'Orbitron',sans-serif",
                  fontSize: 11,
                  fontWeight: 900,
                  color: "#fff"
                }}>{name[0]}</div>
                    <div>
                      <div style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)"
                  }}>{name}</div>
                      <div style={{
                    fontFamily: "'Space Mono',monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.06em",
                    color: "#6a5820",
                    textTransform: "uppercase"
                  }}>{role}</div>
                    </div>
                  </div>
                </div>)}
            </div>
          </div>
        </section>
        <section data-sec="s5" style={{
        minHeight: "70vh",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "clamp(40px,6vh,70px) clamp(24px,6vw,90px)"
      }}>
          <div style={{
          maxWidth: 680,
          width: "100%",
          textAlign: "center",
          margin: "0 auto"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 9,
            letterSpacing: "0.44em",
            color: "#6a5820",
            textTransform: "uppercase",
            marginBottom: 20,
            display: "flex",
            justifyContent: "center",
            opacity: s5vis ? 1 : 0,
            transition: "opacity .5s"
          }}>READY TO RECLAIM CONTROL?</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44,
            opacity: s5vis ? 1 : 0,
            transition: "opacity .3s .1s"
          }} />
            {/* CTA Button */}
            <button onMouseEnter={handleCtaEnter} onMouseLeave={handleCtaLeave} onClick={onBegin} style={{
            position: "relative",
            overflow: "hidden",
            fontFamily: "'Orbitron',sans-serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.45em",
            textRendering: "geometricPrecision",
            padding: "22px 64px",
            paddingLeft: "calc(64px + 0.45em)",
            background: "transparent",
            border: `1px solid ${ctaCharged ? "#ff5500" : "#f5a000"}`,
            color: ctaCharged ? "#fff" : "#f5a000",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "border-color .4s,color .4s,box-shadow .4s",
            boxShadow: ctaCharged ? "0 0 40px rgba(255,85,0,.35)" : "none",
            opacity: s5vis ? 1 : 0,
            transform: s5vis ? "translateY(0)" : "translateY(16px)"
          }}>
              <div style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: ctaFill + "%",
              background: ctaCharged ? "#ff5500" : "linear-gradient(90deg,rgba(255,85,0,.08),rgba(255,85,0,.22))",
              transition: ctaCharged ? "none" : "none"
            }} />
              <span style={{
              position: "relative",
              zIndex: 1
            }}>
                {ctaCharged ? "BEGIN RESET ›" : hasPlan ? "RESUME MISSION ›" : "INITIALIZE PROTOCOL"}
              </span>
            </button>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 400,
            fontSize: 8,
            letterSpacing: "0.4em",
            color: "#6a5820",
            marginTop: 28,
            opacity: s5vis ? 1 : 0,
            transition: "opacity .5s .2s"
          }}>
              CONFESS &nbsp;·&nbsp; PLAN &nbsp;·&nbsp; RECOVER
            </div>
          </div>
        </section>

        {/* ── FAQ (home page, last section) ── */}
        <section data-sec="faq" style={{
        position: "relative",
        zIndex: 2,
        padding: "clamp(50px,7vh,90px) clamp(24px,6vw,90px) clamp(80px,10vh,120px)"
      }}>
          <div style={{
          maxWidth: 760,
          width: "100%",
          margin: "0 auto"
        }}>
            <div style={{
            fontFamily: "'Space Mono',monospace",
            fontWeight: 600,
            fontSize: 22,
            letterSpacing: "0.25em",
            color: "#c9962e",
            textTransform: "uppercase",
            marginBottom: 24,
            textAlign: "center"
          }}>FAQ</div>
            <div style={{
            width: "100%",
            height: 1,
            background: "#3a2800",
            marginBottom: 44
          }} />
            <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 10
          }}>
              {[["Why use SYNAPSE instead of ChatGPT or other AI chatbots?", "Most AI chatbots answer questions. SYNAPSE is built to change behavior. Instead of starting from scratch every conversation, it creates a personalized recovery protocol, remembers your progress, adapts after relapses, analyzes patterns, and keeps you accountable through structured daily check-ins. It's not just an AI conversation — it's an AI-powered recovery system."], ["What is SYNAPSE?", "SYNAPSE is an AI-powered recovery platform designed to help people overcome compulsive digital habits such as pornography, doomscrolling, social media addiction, gaming, and other dopamine-driven behaviors. Using personalized coaching, daily accountability, and adaptive recovery plans, SYNAPSE helps you build healthier habits one day at a time."], ["How does SYNAPSE work?", "Start by completing a short assessment about your habits and challenges. SYNAPSE then generates a recovery protocol tailored to your goals, behavior, and triggers. Every day, you check in with your AI coach, track your progress, and receive guidance that evolves with your journey."], ["What makes SYNAPSE different?", "Most habit trackers count streaks. SYNAPSE focuses on understanding why you relapse and continuously adjusts your recovery strategy based on your behavior. Recovery is personalized — not one-size-fits-all."], ["What happens if I relapse?", "Relapse doesn't erase your progress. SYNAPSE helps you analyze what happened, identify triggers, and update your recovery plan to reduce the chances of repeating the same pattern. The goal is long-term improvement — not perfection."], ["How does the AI create my recovery plan?", "Your recovery plan is generated using the information you provide during onboarding along with your ongoing check-ins. As your behavior changes, the AI continuously refines your protocol instead of keeping you on a fixed routine."], ["How do daily check-ins work?", "Each day you'll complete a quick check-in to record your progress, urges, wins, setbacks, and mindset. Your responses help the AI understand your recovery journey and provide more relevant guidance over time."], ["Can SYNAPSE help with more than porn addiction?", "Yes. SYNAPSE is designed for behavioral addictions driven by unhealthy dopamine-seeking patterns, including social media, doomscrolling, gaming, binge-watching, and similar compulsive habits."], ["Does SYNAPSE replace therapy?", "No. SYNAPSE is a self-improvement and accountability tool, not a replacement for licensed mental health care. If you're experiencing serious mental health concerns, professional support is recommended."], ["Is my data private?", "Yes. Your recovery data is securely stored and used only to personalize your experience. Your information is never shared or sold."], ["Is SYNAPSE free?", "SYNAPSE offers a free experience with optional premium features that unlock more advanced AI coaching and recovery tools."], ["Can I use SYNAPSE on my phone?", "Yes. SYNAPSE is built as a Progressive Web App (PWA), allowing you to install and use it on desktop, Android, and iPhone without downloading it from an app store."], ["How long does recovery take?", "Recovery looks different for everyone. Some users notice improvements within weeks, while lasting behavioral change often requires consistent effort over several months. SYNAPSE is designed to support long-term progress, not quick fixes."], ["What are Recovery Levels?", "Recovery Levels mark important milestones in your journey. As you remain consistent and build healthier habits, you'll unlock higher levels that reflect your long-term progress — not just your current streak."], ["Why doesn't SYNAPSE focus only on streaks?", "A streak doesn't explain your behavior. SYNAPSE looks beyond the number of days and focuses on patterns, triggers, consistency, and sustainable recovery. The objective isn't to chase the longest streak — it's to build lasting change."]].map(([q, a], i) => {
              const open = faqOpen === i;
              return <div key={i} style={{
                background: "rgba(255,140,0,0.02)",
                border: "1px solid rgba(255,140,0,0.10)",
                borderColor: open ? "rgba(255,140,0,0.28)" : "rgba(255,140,0,0.10)",
                borderRadius: 16,
                overflow: "hidden",
                transition: "border-color .3s"
              }}>
                    <button onClick={() => setFaqOpen(open ? null : i)} style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "18px clamp(18px,3vw,26px)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left"
                }}>
                      <span style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 600,
                    fontSize: "clamp(15px,2vw,19px)",
                    color: open ? "#f5a000" : "var(--text)",
                    lineHeight: 1.4,
                    transition: "color .3s"
                  }}>{q}</span>
                      <span style={{
                    flexShrink: 0,
                    color: "#f5a000",
                    transform: open ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform .3s"
                  }}>
                        <ChevronDown size={18} />
                      </span>
                    </button>
                    <div style={{
                  maxHeight: open ? 400 : 0,
                  opacity: open ? 1 : 0,
                  transition: "max-height .4s ease, opacity .3s ease"
                }}>
                      <p style={{
                    fontFamily: "'Inter',sans-serif",
                    fontSize: "clamp(14px,1.8vw,17px)",
                    lineHeight: 1.7,
                    color: "#b89968",
                    margin: 0,
                    padding: "0 clamp(18px,3vw,26px) 22px"
                  }}>{a}</p>
                    </div>
                  </div>;
            })}
            </div>
          </div>
        </section>
        <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 28,
        background: "#0f0900",
        borderTop: "1px solid #3a2800",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        zIndex: 20
      }}>
          <div style={{
          fontFamily: "'Space Mono',monospace",
          fontWeight: 400,
          fontSize: 8,
          letterSpacing: "0.28em",
          color: "#d4920a",
          display: "flex",
          whiteSpace: "nowrap",
          animation: "tk 30s linear infinite"
        }}>
            {[1, 2].map(k => <span key={k}>DOPAMINE &nbsp;·&nbsp; REWIRE YOUR BRAIN &nbsp;·&nbsp; RECONQUER YOUR MIND &nbsp;·&nbsp; SYNAPSE PROTOCOL &nbsp;·&nbsp; RESET YOUR DOPAMINE &nbsp;·&nbsp; REWIRE YOUR BRAIN &nbsp;·&nbsp; DOPAMINE &nbsp;·&nbsp; RECONQUER YOUR MIND &nbsp;·&nbsp; SYNAPSE PROTOCOL &nbsp;·&nbsp; RESET YOUR DOPAMINE &nbsp;·&nbsp;&nbsp;&nbsp;</span>)}
          </div>
        </div>

        {/* Hex badge */}
        <div style={{
        position: "fixed",
        top: 20,
        right: 24,
        zIndex: 10,
        animation: "hpx 3s ease-in-out infinite"
      }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="none" stroke="#f5a000" strokeWidth="1.5" />
            <polygon points="14,7 22,11.5 22,16.5 14,21 6,16.5 6,11.5" fill="#f5a000" opacity=".75" />
          </svg>
        </div>

        {/* Wave badge */}
        <div style={{
        position: "fixed",
        bottom: 38,
        right: 18,
        width: 36,
        height: 36,
        border: "1px solid #cc7a00",
        borderRadius: "50%",
        background: "#1a1000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10
      }}>
          <svg width="20" height="14" viewBox="0 0 20 14">
            <rect x="0" y="4" width="2" height="6" fill="#f5a000" opacity=".7" />
            <rect x="3" y="2" width="2" height="10" fill="#f5a000" opacity=".85" />
            <rect x="6" y="0" width="2" height="14" fill="#f5a000" />
            <rect x="9" y="3" width="2" height="8" fill="#f5a000" opacity=".85" />
            <rect x="12" y="5" width="2" height="4" fill="#f5a000" opacity=".65" />
            <rect x="15" y="2" width="2" height="10" fill="#f5a000" opacity=".75" />
            <rect x="18" y="5" width="2" height="4" fill="#f5a000" opacity=".5" />
          </svg>
        </div>

      </div>

      {/* Extra keyframes */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Space+Grotesk:wght@500;600;700&family=Space+Mono:wght@400;700&family=Inter:wght@400;500&display=swap');
        @keyframes shrb{0%,100%{opacity:.2;}50%{opacity:.75;}}
        @keyframes rscan{0%{left:-80%;}100%{left:180%;}}
        @keyframes tk{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
        @keyframes hpx{0%,100%{filter:drop-shadow(0 0 4px #f5a000);}50%{filter:drop-shadow(0 0 16px #f5a000);}}
      `}</style>
    </div>;
}
function getErrorMsg(code) {
  const map = {
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "Email already registered — sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Invalid email address.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/popup-blocked": "Popup blocked — allow popups for this site.",
    "auth/popup-closed-by-user": "",
    "auth/cancelled-popup-request": "",
    "auth/network-request-failed": "Network error — check your connection and try again.",
    "auth/unauthorized-domain": "This domain isn't authorized for Google sign-in yet — contact support.",
    "auth/account-exists-with-different-credential": "An account already exists with this email using a different sign-in method.",
    "auth/internal-error": "Sign-in service hiccup — try again in a moment."
  };
  return map[code] || "Something went wrong. Try again.";
}
function TCModal({
  onAccept,
  onClose
}) {
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.8)",
    backdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px"
  }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
      width: "100%",
      maxWidth: 620,
      maxHeight: "82vh",
      background: "#0d0b10",
      border: "1px solid rgba(255,140,0,0.15)",
      borderRadius: 20,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 32px 80px rgba(0,0,0,0.6)"
    }}>
        {/* Header */}
        <div style={{
        padding: "22px 28px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0
      }}>
          <div>
            <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "#ffb347",
            letterSpacing: 1
          }}>SYNAPSE TERMS OF SERVICE</div>
            <div style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            marginTop: 3
          }}>Effective Date: June 25, 2026 · Please read carefully</div>
          </div>
          <button onClick={onClose} style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1
        }}>×</button>
        </div>
        {/* Content */}
        <div style={{
        padding: "20px 28px",
        overflowY: "auto",
        flex: 1,
        fontSize: 12,
        color: "rgba(255,255,255,0.55)",
        lineHeight: 1.9
      }}>
          {[{
          h: "1. Definitions",
          b: `"Service" means all websites, applications, software, AI systems, content, and features provided by Synapse. "AI Content" means any content generated through AI systems. "User Content" means all information, data, and submissions provided by a User.`
        }, {
          h: "2. Eligibility",
          b: "The Service is not directed at, and is not intended to be used by, any individual under the age of thirteen (13) years. Users register on the basis of self-attested age information; a parent or guardian who believes a child has registered without appropriate consent should contact synapserewire@gmail.com. Synapse reserves the right to refuse registration, suspend access, or terminate accounts at its sole discretion."
        }, {
          h: "3. Account Registration",
          b: "Users agree to provide accurate, complete, and current information. Users are solely responsible for maintaining account confidentiality and assume full responsibility for all activities conducted through their account."
        }, {
          h: "4. Description of Service",
          b: "Synapse provides AI-powered productivity, habit-building, behavioral support, educational guidance, goal management, accountability tools, and related features. Service functionality may change without prior notice."
        }, {
          h: "5. NO MEDICAL OR CLINICAL SERVICES",
          b: "THE SERVICE DOES NOT PROVIDE MEDICAL CARE. Synapse is not a healthcare provider. Information provided is for informational, educational, and self-development purposes only. Users should seek qualified professional assistance for medical, psychological, or mental health concerns."
        }, {
          h: "6. CRISIS AND EMERGENCY DISCLAIMER",
          b: "Synapse uses automated pattern-matching and an AI classifier to scan certain messages (check-ins and AI coach chats) for language suggesting self-harm or suicidal risk, and displays crisis-support resources (including KIRAN in India and 988 in the United States) when detected. THIS DETECTION IS AUTOMATED, IMPERFECT, AND NOT GUARANTEED TO CATCH EVERY INSTANCE — it must never be relied upon as a substitute for real emergency services. THE SERVICE IS NOT DESIGNED FOR EMERGENCY RESPONSE and does not monitor users in real time or dispatch emergency responders. Users experiencing thoughts of self-harm, suicide, violence, or immediate danger should immediately contact local emergency services or a crisis hotline directly."
        }, {
          h: "7. Artificial Intelligence Disclosure",
          b: "AI-generated outputs may contain inaccuracies, omissions, biases, or hallucinations. Users acknowledge that AI-generated content should not be relied upon as the sole basis for important decisions. Synapse does not guarantee accuracy or fitness of AI outputs."
        }, {
          h: "8. User Content",
          b: "Users retain ownership of User Content. Users grant Synapse a worldwide, non-exclusive, royalty-free license to host, process, analyze, and use User Content solely for operation and improvement of the Service. Confession, check-in, mood, and trigger-tracking content is not used to train AI models unless a user separately opts in, and is deleted from active systems within a defined period after account deletion, as detailed in the full Privacy Policy."
        }, {
          h: "9. Prohibited Conduct",
          b: "Users shall not: violate applicable laws; attempt unauthorized access; reverse engineer the Service; interfere with platform security; distribute malware; scrape or harvest data; impersonate another person; or use the Service for unlawful activity."
        }, {
          h: "10. Intellectual Property",
          b: "All Service components, software, designs, interfaces, trademarks, AI systems, and algorithms remain the exclusive property of Synapse. Users receive only a limited, revocable, non-transferable license to access the Service."
        }, {
          h: "11. Fees, Subscriptions & Billing",
          b: "Certain features may require payment. Fees may be modified at any time. Except where required by law, payments are non-refundable. Failure to pay may result in suspension or termination."
        }, {
          h: "12. Third-Party Services",
          b: "The Service may integrate with third-party providers. Synapse does not control third-party services and shall not be responsible for third-party content, actions, policies, or security incidents."
        }, {
          h: "13. Privacy",
          b: "Collection and processing of personal information is governed by the Privacy Policy. Users consent to processing, storage, and transfer of information necessary to provide the Service."
        }, {
          h: "14. Termination",
          b: "Synapse may suspend or terminate access at any time. Upon termination, licenses cease immediately. Liability limitations, indemnification, arbitration provisions, and IP protections survive termination."
        }, {
          h: "15. DISCLAIMER OF WARRANTIES",
          b: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED ON AN \"AS IS\" AND \"AS AVAILABLE\" BASIS. SYNAPSE EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT."
        }, {
          h: "16. LIMITATION OF LIABILITY",
          b: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, SYNAPSE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. AGGREGATE LIABILITY SHALL NOT EXCEED USD $100 OR THE TOTAL AMOUNT PAID BY THE USER IN THE PRECEDING 12 MONTHS. Nothing in this clause limits liability for Synapse's gross negligence, willful misconduct, or fraud, or any liability that cannot lawfully be excluded under applicable law."
        }, {
          h: "17. Indemnification",
          b: "Users agree to defend, indemnify, and hold harmless Synapse from any claims, losses, liabilities, and legal fees arising from use of the Service, violation of these Terms, or infringement of third-party rights."
        }, {
          h: "18. Force Majeure",
          b: "Synapse shall not be liable for delays or failures caused by circumstances beyond reasonable control, including natural disasters, internet failures, cyberattacks, governmental actions, or other force majeure events."
        }, {
          h: "19. Dispute Resolution & Arbitration",
          b: "Any dispute arising from these Terms shall be resolved through binding arbitration. Users waive rights to jury trials and class action participation where legally permissible. Arbitration shall be conducted confidentially."
        }, {
          h: "20. Governing Law",
          b: "These Terms are governed by the laws of India for Indian users and by applicable United States federal and state law for United States users, as further detailed in the full Terms and Conditions. Any matter not subject to arbitration shall fall within the exclusive jurisdiction of competent courts as specified therein."
        }, {
          h: "21. Data Protection Compliance",
          b: "Synapse intends to comply with applicable privacy laws including the Digital Personal Data Protection Act, 2023; IT Act, 2000; IT Rules, 2021; GDPR where applicable; and CCPA/CPRA where applicable."
        }, {
          h: "22–28. Additional Provisions",
          b: "Synapse reserves the right to modify these Terms at any time. Continued use constitutes acceptance. Electronic acceptance (checkboxes, account creation) constitutes a valid electronic signature. Beta features are provided on an \"as available\" basis without warranties. No guarantee of uninterrupted service availability. User feedback grants Synapse a perpetual, royalty-free right to use and incorporate such feedback."
        }, {
          h: "29–37. Final Provisions",
          b: "Synapse may assign rights under these Terms without restriction. These Terms constitute the complete agreement between the parties. Export control compliance is the User's responsibility. Headings are for convenience only. Any rights not expressly granted are reserved exclusively by Synapse."
        }, {
          h: "Contact",
          b: "Synapse · Email: synapserewire@gmail.com · Grievance Officer: synapserewire@gmail.com"
        }].map((s, i) => <div key={i} style={{
          marginBottom: 16
        }}>
              <div style={{
            fontWeight: 700,
            color: "rgba(255,180,80,0.75)",
            marginBottom: 4,
            fontSize: 12
          }}>{s.h}</div>
              <div>{s.b}</div>
            </div>)}
          <div style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "rgba(255,140,0,0.05)",
          border: "1px solid rgba(255,140,0,0.12)",
          borderRadius: 8,
          fontSize: 11,
          color: "rgba(255,255,255,0.3)"
        }}>
            BY USING THE SERVICE, YOU ACKNOWLEDGE HAVING READ AND UNDERSTOOD THIS AGREEMENT IN ITS ENTIRETY AND VOLUNTARILY AGREE TO BE BOUND BY ITS TERMS.
          </div>
        </div>
        {/* Footer */}
        <div style={{
        padding: "20px 28px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
        display: "flex",
        gap: 12
      }}>
          <button onClick={onAccept} style={{
          flex: 1,
          padding: "13px",
          borderRadius: 12,
          background: "linear-gradient(135deg,#ff9500,#ff5000)",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer"
        }}><Check size={14} style={{
            display: "inline",
            marginRight: 6
          }} />Accept & Continue</button>
          <button onClick={onClose} style={{
          padding: "13px 20px",
          borderRadius: 12,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.4)",
          fontSize: 13,
          cursor: "pointer"
        }}>Cancel</button>
        </div>
      </div>
    </div>;
}
function PrivacyModal({
  onClose
}) {
  const sections = [{
    h: "1. Introduction",
    b: "This Privacy Policy describes how Synapse collects, uses, stores, discloses, and processes information relating to users who access or use the Synapse platform and related services. By using the Services, you acknowledge that you have read and understood this Policy and consent to the collection and processing of information as described herein."
  }, {
    h: "2. Scope",
    b: "This Policy applies to all information collected through the Services. It does not apply to third-party websites or platforms linked to or integrated with the Services but operated independently of Synapse."
  }, {
    h: "3. Information We Collect",
    b: "We may collect: full name or display name; email address; profile information; date of birth and gender (where voluntarily provided); user preferences; communications submitted through support channels; authentication data from third-party providers (Google Sign-In); and technical information such as device characteristics, browser info, IP address, access timestamps, and diagnostic data."
  }, {
    h: "4. Purposes of Processing",
    b: "We process information for: account creation and management; user authentication; service delivery; security monitoring and fraud prevention; technical troubleshooting; performance optimization; customer support; compliance with legal obligations; and internal analytics and service improvement."
  }, {
    h: "5. Legal Basis for Processing",
    b: "We process information on the basis of: user consent; performance of contractual obligations; compliance with legal obligations; legitimate business interests; protection of vital interests; and establishment or defense of legal claims."
  }, {
    h: "6. Disclosure of Information",
    b: "Synapse does not sell personal information to advertisers or data brokers. Information may be shared with carefully selected third-party service providers (authentication, cloud infrastructure, security, analytics, customer support, and professional advisors) solely to the extent necessary to operate the Services."
  }, {
    h: "7. Data Retention",
    b: "Information is retained only as long as necessary to provide the Services, fulfill contractual obligations, comply with legal requirements, resolve disputes, enforce agreements, and preserve security and integrity of systems."
  }, {
    h: "8. Data Security",
    b: "Synapse implements commercially reasonable administrative, technical, and organizational safeguards to protect information. No method of electronic transmission or storage can be guaranteed to be completely secure. Users acknowledge the inherent risks associated with internet-based communications."
  }, {
    h: "9. User Rights",
    b: "Subject to applicable law, you may have the right to access, correct, delete, restrict, or object to processing of your information, and to withdraw consent where processing is based on consent. Submit requests to: synapserewire@gmail.com"
  }, {
    h: "10. Children's Privacy",
    b: "The Services are not directed toward children under thirteen (13) years of age. We do not knowingly collect personal information from children under the applicable minimum age."
  }, {
    h: "11. International Data Transfers",
    b: "Information may be processed, stored, or transferred in jurisdictions different from your country of residence. By using the Services, you consent to such transfers where permitted by applicable law."
  }, {
    h: "12. Modifications",
    b: "Synapse reserves the right to modify this Policy at any time. Material modifications may be communicated through the Services. Continued use following revisions constitutes acknowledgment of the updated Policy."
  }, {
    h: "13. Contact",
    b: "For privacy-related inquiries, contact: Synapse Privacy Team — synapserewire@gmail.com"
  }];
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.8)",
    backdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px"
  }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
      width: "100%",
      maxWidth: 620,
      maxHeight: "82vh",
      background: "#0d0b10",
      border: "1px solid rgba(255,140,0,0.15)",
      borderRadius: 20,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 32px 80px rgba(0,0,0,0.6)"
    }}>
        {/* Header */}
        <div style={{
        padding: "22px 28px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0
      }}>
          <div>
            <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "#ffb347",
            letterSpacing: 1
          }}>SYNAPSE PRIVACY POLICY</div>
            <div style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            marginTop: 3
          }}>Effective Date: June 25, 2026 · Last Updated: June 25, 2026</div>
          </div>
          <button onClick={onClose} style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1
        }}>×</button>
        </div>
        {/* Content */}
        <div style={{
        padding: "20px 28px",
        overflowY: "auto",
        flex: 1,
        fontSize: 12,
        color: "rgba(255,255,255,0.55)",
        lineHeight: 1.9
      }}>
          {sections.map((s, i) => <div key={i} style={{
          marginBottom: 18
        }}>
              <div style={{
            fontWeight: 700,
            color: "rgba(255,180,80,0.75)",
            marginBottom: 5,
            fontSize: 12
          }}>{s.h}</div>
              <div>{s.b}</div>
            </div>)}
          <div style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "rgba(255,140,0,0.05)",
          border: "1px solid rgba(255,140,0,0.12)",
          borderRadius: 8,
          fontSize: 11,
          color: "rgba(255,255,255,0.3)"
        }}>
            By accessing or using Synapse, you acknowledge that you have read and understood this Privacy Policy and consent to the collection and processing of your information as described herein.
          </div>
        </div>
        {/* Footer */}
        <div style={{
        padding: "16px 28px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0
      }}>
          <button onClick={onClose} style={{
          width: "100%",
          padding: "13px",
          borderRadius: 12,
          background: "linear-gradient(135deg,#ff9500,#ff5000)",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer"
        }}>Got it</button>
        </div>
      </div>
    </div>;
}
function Auth({
  onAuth,
  context = ""
}) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [shake, setShake] = useState(false);
  const [googleHover, setGoogleHover] = useState(false);
  const [ready, setReady] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  useEffect(() => {
    setTimeout(() => setReady(true), 80);
  }, []);
  const handleSubmit = async () => {
    if (!email.trim() || !password.trim() || mode === "signup" && !name.trim()) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Terms & Conditions to continue.");
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    setLoading(true);
    setError("");
    let cred;
    try {
      if (mode === "signup") {
        cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, {
          displayName: name.trim()
        });
        // Fire-and-forget — never block signup on this. Firebase's own
        // rate limiting protects the endpoint from abuse (e.g. spamming
        // verification emails to someone else's inbox via repeated signup
        // attempts on an already-taken address, which createUser would
        // reject before we even get here).
        sendEmailVerification(cred.user).catch(e => console.warn("Verification email failed:", e));
      } else {
        cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      // Auth itself failed — this IS a sign-in error, show it.
      console.error("Email auth failed:", e.code, e.message);
      const msg = getErrorMsg(e.code);
      if (msg) {
        setError(msg);
        setShake(true);
        setTimeout(() => setShake(false), 600);
      }
      setLoading(false);
      return;
    }
    setLoading(false);
    // Auth succeeded at this point. Anything below is post-auth app setup,
    // not a sign-in failure — never show the user a "wrong password"-style
    // error for something that happens after they're already logged in.
    try {
      onAuth({
        email: cred.user.email,
        name: cred.user.displayName || name.trim() || cred.user.email.split("@")[0],
        uid: cred.user.uid
      });
    } catch (e) {
      console.error("Post-auth setup error (user IS signed in):", e);
    }
  };
  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    let cred;
    try {
      cred = await signInWithPopup(auth, googleProvider);
    } catch (e) {
      // Real sign-in failure (popup blocked, network, wrong config, etc).
      // Logged in full so the actual Firebase error code is visible in
      // devtools even when it's not one of the mapped messages below.
      console.error("Google sign-in failed:", e.code, e.message);
      const msg = getErrorMsg(e.code);
      if (msg) setError(msg);
      setLoading(false);
      return;
    }
    setLoading(false);
    // Sign-in itself succeeded here — anything below is post-auth app setup,
    // not an auth failure. A bug in onAuth should never look like a failed
    // Google login to the user, since they ARE signed in at this point.
    try {
      onAuth({
        email: cred.user.email,
        name: cred.user.displayName || cred.user.email.split("@")[0],
        uid: cred.user.uid
      });
    } catch (e) {
      console.error("Post-auth setup error (user IS signed in):", e);
    }
  };
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError("Enter your email above first.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (e) {
      // Deliberately swallow auth/user-not-found (and invalid-email) so the
      // response is identical whether or not the email is registered.
      // This prevents email enumeration via the forgot-password flow.
      if (e.code !== "auth/user-not-found" && e.code !== "auth/invalid-email") {
        setError(getErrorMsg(e.code));
        return;
      }
    }
    // Always show the same neutral success state, regardless of outcome.
    setResetSent(true);
    setError("");
  };
  const inputStyle = field => ({
    width: "100%",
    background: "rgba(255,255,255,0.03)",
    border: `1px solid ${focusedField === field ? "rgba(255,140,0,0.55)" : "rgba(255,140,0,0.12)"}`,
    borderRadius: 12,
    color: "var(--text)",
    fontFamily: "'Inter',sans-serif",
    fontSize: 14,
    fontWeight: 300,
    padding: "14px 18px",
    outline: "none",
    transition: "all .3s",
    caretColor: "#ff8c00",
    boxShadow: focusedField === field ? "0 0 0 3px rgba(255,140,0,0.08),0 0 24px rgba(255,140,0,0.06)" : "none"
  });
  return <>
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      padding: "80px 24px"
    }}>
      <div style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        width: 800,
        height: 800,
        background: "radial-gradient(circle,rgba(255,100,0,0.07) 0%,transparent 70%)",
        pointerEvents: "none",
        zIndex: 0
      }} />
      <div className="auth-wrap" style={{
        width: "100%",
        maxWidth: 460,
        position: "relative",
        zIndex: 2,
        opacity: ready ? 1 : 0,
        transform: ready ? "translateY(0)" : "translateY(24px)",
        transition: "all .8s cubic-bezier(.16,1,.3,1)",
        animation: shake ? "shakeX .5s ease" : "none"
      }}>
        <div style={{
          textAlign: "center",
          marginBottom: 36
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            marginBottom: 20
          }}><NeuralMark size={52} /></div>
          <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: -1,
            background: "linear-gradient(145deg,#fff 30%,rgba(255,180,80,.75) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 8
          }}>
            {context === "lock" ? "LOCK IN YOUR" : "SYNAPSE"}
          </div>
          <div style={{
            fontSize: 12,
            color: "var(--text4)",
            letterSpacing: 2,
            textTransform: "uppercase"
          }}>
            {context === "lock" ? "Protocol. Begin Day 1." : mode === "signin" ? "Welcome back, soldier" : "Initialize your protocol"}
          </div>
        </div>
        <div className="glass" style={{
          padding: 36,
          boxShadow: "0 0 60px rgba(255,140,0,0.08),0 32px 64px rgba(0,0,0,0.4)",
          animation: "borderGlow 5s ease-in-out infinite"
        }}>
          <div style={{
            display: "flex",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 10,
            padding: 4,
            marginBottom: 28,
            border: "1px solid rgba(255,140,0,0.08)"
          }}>
            {[["signin", "Sign In"], ["signup", "Sign Up"]].map(([m, l]) => <button key={m} onClick={() => {
              setMode(m);
              setError("");
              setResetSent(false);
            }} style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 8,
              border: "none",
              background: mode === m ? "linear-gradient(135deg,rgba(255,140,0,0.18),rgba(255,80,0,0.1))" : "transparent",
              color: mode === m ? "#ffb347" : "rgba(255,255,255,0.25)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: .8,
              textTransform: "uppercase",
              transition: "all .25s",
              cursor: "pointer"
            }}>{l}</button>)}
          </div>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 14
          }}>
            {mode === "signup" && <div><div style={{
                fontSize: 11,
                color: "rgba(255,180,80,0.4)",
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 7,
                fontWeight: 500
              }}>Name</div><input style={inputStyle("name")} type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} onFocus={() => setFocusedField("name")} onBlur={() => setFocusedField(null)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>}
            <div><div style={{
                fontSize: 11,
                color: "rgba(255,180,80,0.4)",
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 7,
                fontWeight: 500
              }}>Email</div><input style={inputStyle("email")} type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>
            <div><div style={{
                fontSize: 11,
                color: "rgba(255,180,80,0.4)",
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 7,
                fontWeight: 500
              }}>Password</div><input style={inputStyle("password")} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>
            {error && <div style={{
              fontSize: 12,
              color: "#ff7777",
              padding: "10px 14px",
              background: "rgba(255,60,60,0.07)",
              border: "1px solid rgba(255,60,60,0.2)",
              borderRadius: 8,
              lineHeight: 1.5
            }}>{error}</div>}
            {resetSent && <div style={{
              fontSize: 12,
              color: "#66ffaa",
              padding: "10px 14px",
              background: "rgba(60,255,120,0.06)",
              border: "1px solid rgba(60,255,120,0.2)",
              borderRadius: 8
            }}>✓ Reset email sent — check your inbox.</div>}
            {mode === "signin" && <div style={{
              textAlign: "right",
              marginTop: -6
            }}><span onClick={handleForgotPassword} style={{
                fontSize: 11,
                color: "rgba(255,180,80,0.7)",
                letterSpacing: .3,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3
              }}>Forgot password?</span></div>}

            {/* T&C checkbox — only on signup */}
            {mode === "signup" && <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 14px",
              background: "rgba(255,140,0,0.04)",
              border: "1px solid rgba(255,140,0,0.12)",
              borderRadius: 10
            }}>
                <div onClick={() => setTermsAccepted(v => !v)} style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: `2px solid ${termsAccepted ? "#ff9500" : "rgba(255,255,255,0.2)"}`,
                background: termsAccepted ? "#ff9500" : "transparent",
                flexShrink: 0,
                marginTop: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all .2s"
              }}>
                  {termsAccepted && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <p style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.45)",
                lineHeight: 1.6,
                margin: 0
              }}>
                  I have read and agree to the{" "}
                  <span onClick={() => setShowTerms(true)} style={{
                  color: "rgba(255,180,80,0.85)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: 3
                }}>Terms & Conditions</span>
                  {" "}including warranty disclaimers, liability limitations, and binding arbitration provisions.
                </p>
              </div>}

            <button className="btn-primary" onClick={handleSubmit} disabled={loading || mode === "signup" && !termsAccepted} style={{
              width: "100%",
              marginTop: 8,
              padding: "15px",
              fontSize: 13,
              borderRadius: 12,
              justifyContent: "center",
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: mode === "signup" && !termsAccepted ? 0.4 : 1
            }}>
              {loading ? <span style={{
                display: "flex",
                gap: 4
              }}>{[0, 1, 2].map(i => <span key={i} style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "#fff",
                  animation: `dotBlink 1s ${i * .18}s infinite`
                }} />)}</span> : mode === "signin" ? "Enter the Protocol →" : "Initialize Protocol →"}
            </button>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "4px 0"
            }}><div style={{
                flex: 1,
                height: 1,
                background: "rgba(255,255,255,0.06)"
              }} /><span style={{
                fontSize: 11,
                color: "var(--text4)",
                letterSpacing: 1
              }}>OR</span><div style={{
                flex: 1,
                height: 1,
                background: "rgba(255,255,255,0.06)"
              }} /></div>
            <button onClick={handleGoogle} disabled={loading} onMouseEnter={() => setGoogleHover(true)} onMouseLeave={() => setGoogleHover(false)} style={{
              width: "100%",
              padding: "14px",
              borderRadius: 12,
              background: googleHover ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${googleHover ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
              color: googleHover ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all .25s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill={googleHover ? "#4285F4" : "rgba(66,133,244,0.6)"} /><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill={googleHover ? "#34A853" : "rgba(52,168,83,0.6)"} /><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill={googleHover ? "#FBBC05" : "rgba(251,188,5,0.6)"} /><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill={googleHover ? "#EA4335" : "rgba(234,67,53,0.6)"} />
              </svg>
              Continue with Google
            </button>
          </div>
          <p style={{
            textAlign: "center",
            fontSize: 11,
            color: "var(--text4)",
            marginTop: 20,
            lineHeight: 1.9,
            letterSpacing: .2
          }}>
            <span style={{
              color: "rgba(255,140,0,0.28)"
            }}>Encrypted. Private. Never sold.</span><br />
            <span style={{
              color: "var(--text4)"
            }}>⚠ Progress stored locally. Clearing browser data erases your streak.</span><br />
            <span style={{
              color: "var(--text4)"
            }}>By continuing you agree to our{" "}
              <span onClick={() => setShowTerms(true)} style={{
                color: "rgba(255,180,80,0.6)",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2
              }}>Terms & Conditions</span>
              {" "}and{" "}
              <span onClick={() => setShowPrivacy(true)} style={{
                color: "rgba(255,180,80,0.6)",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2
              }}>Privacy Policy</span>
            </span>
          </p>
        </div>
      </div>
    </div>

    {/* T&C Modal — theme aware */}
    {showTerms && <TCModal onAccept={() => {
      setTermsAccepted(true);
      setShowTerms(false);
    }} onClose={() => setShowTerms(false)} />}
    {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
  </>;
}

/* ─── ADDICTION DATA ─────────────────────────────────────────────────────── */
const ADDICTIONS = [{
  id: "reels",
  emoji: "📱",
  label: "Reels / Shorts",
  color: "#ff4466",
  desc: "Instagram, YouTube, TikTok shorts"
}, {
  id: "porn",
  emoji: "🔞",
  label: "Porn",
  color: "#ff2244",
  desc: "Adult content, explicit material"
}, {
  id: "gaming",
  emoji: "🎮",
  label: "Gaming",
  color: "#aa44ff",
  desc: "Video games, mobile gaming"
}, {
  id: "social",
  emoji: "💬",
  label: "Social Media",
  color: "#4488ff",
  desc: "Twitter, Instagram, Reddit scrolling"
}, {
  id: "smoking",
  emoji: "🚬",
  label: "Smoking",
  color: "#888888",
  desc: "Cigarettes, vaping, nicotine"
}, {
  id: "alcohol",
  emoji: "🍺",
  label: "Alcohol",
  color: "#ffaa00",
  desc: "Beer, wine, spirits"
}, {
  id: "junk",
  emoji: "🍔",
  label: "Junk Food",
  color: "#ff8800",
  desc: "Binge eating, sugar addiction"
}, {
  id: "caffeine",
  emoji: "☕",
  label: "Caffeine",
  color: "#aa6600",
  desc: "Coffee, energy drinks, tea excess"
}, {
  id: "news",
  emoji: "📰",
  label: "Doomscrolling",
  color: "#ff6600",
  desc: "News addiction, anxiety loops"
}, {
  id: "shopping",
  emoji: "🛒",
  label: "Impulse Shopping",
  color: "#00ccaa",
  desc: "Online shopping, spending compulsion"
}, {
  id: "gambling",
  emoji: "🎰",
  label: "Gambling",
  color: "#ffcc00",
  desc: "Betting, casino, fantasy sports"
}, {
  id: "masturbation",
  emoji: "🌊",
  label: "Masturbation",
  color: "#ff3366",
  desc: "Compulsive self-pleasure habit"
}];

// These addictions are measured by frequency (times/day) not hours
const FREQ_ADDICTIONS = new Set(["masturbation", "junk", "smoking", "caffeine", "gambling", "alcohol", "shopping"]);
const EFFECTS = {
  reels: {
    brain: "Shrinks attention span to under 40 seconds. Dopamine spikes every 3 seconds rewire your reward circuit permanently.",
    loss: ["Deep focus & flow states", "Ability to read books", "Real-world patience", "Creative thinking"],
    stat: "2.4 hrs avg daily"
  },
  porn: {
    brain: "Desensitizes dopamine receptors. Creates unrealistic expectations. Causes real-world intimacy dysfunction.",
    loss: ["Real intimacy & connection", "Sexual sensitivity", "Relationship depth", "Self-respect"],
    stat: "Affects 1 in 3 men"
  },
  gaming: {
    brain: "Triggers same pathways as gambling. Victory dopamine loops replace real achievement satisfaction entirely.",
    loss: ["Real-world ambition", "Social skills", "Sleep quality", "Physical fitness"],
    stat: "Avg 6.3 hrs/day gamers"
  },
  social: {
    brain: "Variable reward loops keep you checking. Comparison culture erodes self-worth on every scroll.",
    loss: ["Self-confidence", "Present-moment living", "Real relationships", "Mental peace"],
    stat: "2.5 hrs avg daily"
  },
  smoking: {
    brain: "Nicotine hijacks acetylcholine receptors. Creates anxiety it then relieves. A perfect chemical trap.",
    loss: ["Lung capacity", "10+ years of life", "₹50K+ per year", "Clear skin & energy"],
    stat: "Kills 8M people/year"
  },
  alcohol: {
    brain: "Suppresses prefrontal cortex. Kills new neurons. Destroys REM sleep every single session.",
    loss: ["Sharp decision making", "Liver function", "Morning productivity", "Real emotional range"],
    stat: "Ages brain 5x faster"
  },
  junk: {
    brain: "Sugar spikes insulin and dopamine simultaneously. Creates crash-crave cycle every 2-3 hours.",
    loss: ["Metabolic health", "Mental clarity", "Energy stability", "Body confidence"],
    stat: "Reduces IQ by ~13pts"
  },
  caffeine: {
    brain: "Blocks adenosine receptors. Creates dependency where baseline feels like exhaustion without it.",
    loss: ["Natural energy rhythms", "Deep sleep quality", "Calm baseline mood", "Adrenal health"],
    stat: "Withdrawal hits day 1"
  },
  news: {
    brain: "Negativity bias locks you in threat-detection mode. Cortisol stays chronically elevated all day.",
    loss: ["Mental peace", "Optimism & hope", "Productive hours", "Rational thinking"],
    stat: "77% feel anxious after"
  },
  shopping: {
    brain: "Anticipation of purchase beats the purchase itself. The buy button is the dopamine hit.",
    loss: ["Financial security", "Real fulfillment", "Self-control", "Future freedom"],
    stat: "Avg ₹18K wasted/month"
  },
  gambling: {
    brain: "Intermittent reward is the most addictive pattern in neuroscience. Near-misses fire like wins.",
    loss: ["Financial stability", "Relationships & trust", "Mental health", "Future planning"],
    stat: "House wins 100% long-term"
  },
  masturbation: {
    brain: "Excess rewires arousal to screens. Causes social withdrawal and real intimacy avoidance.",
    loss: ["Drive & ambition", "Eye contact & confidence", "Real attraction response", "Energy levels"],
    stat: "PMO loop avg 94min/day"
  }
};

/* ─── CONFESS 4-STEP FLOW ────────────────────────────────────────────────── */

/* ─── ARCHETYPE SELECTION ────────────────────────────────────────────────── */
const ARCHETYPES = [{
  id: "sovereign",
  title: "SOVEREIGN",
  sub: "Self-Mastery",
  desc: "You rule yourself before you rule anything else. Iron will. Unshakeable standards. The king who conquered his own mind.",
  symbol: "♛",
  gradient: "linear-gradient(160deg, #1a1200 0%, #0d0900 40%, #000 100%)",
  glow: "rgba(212,175,55,0.35)",
  accent: "#d4af37",
  accentRgb: "212,175,55",
  border: "rgba(212,175,55,0.3)",
  // Crown throne hall aesthetic
  bg: `url("data:image/jpeg;base64,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") center/cover no-repeat`,
  pillars: true
}, {
  id: "arbiter",
  title: "ARBITER",
  sub: "Rational Control",
  desc: "Cold logic over cheap emotion. You see through the illusion of instant pleasure. Every decision is deliberate, calculated, sovereign.",
  symbol: "⚖",
  gradient: "linear-gradient(160deg, #0a0f1a 0%, #050810 40%, #000 100%)",
  glow: "rgba(150,180,255,0.3)",
  accent: "#8ba8e8",
  accentRgb: "139,168,232",
  border: "rgba(139,168,232,0.28)",
  bg: `url("data:image/jpeg;base64,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") center/cover no-repeat`,
  pillars: false
}, {
  id: "stoic",
  title: "STOIC",
  sub: "Discipline",
  desc: "Unmoved by pleasure. Unbroken by pain. You train in the dark so you shine in the light. Roots run deeper than any craving.",
  symbol: "🌳",
  gradient: "linear-gradient(160deg, #0a1000 0%, #050800 40%, #000 100%)",
  glow: "rgba(180,160,80,0.28)",
  accent: "#c8a84b",
  accentRgb: "200,168,75",
  border: "rgba(200,168,75,0.25)",
  bg: `url("data:image/jpeg;base64,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fSsor2Fjl9etdWNhasiqLSJ4wwOS2py2T254q44d4rubDjw4nHBE4MC28luxOiRQgUZPQggMD0IrmsjNbAz8KKQWWXAuIRcOuJmubY3cE1u9tJGJPLJDY3DYODtQr2S1kn1WFq9rBgARvL5hB6nVgUoBUhjG9Fewslk1NDtvUQazIoALnA25VmvfnQc7YzWs460UFjAfFaR8DApfUa0rHNFAMrqDLjOByxRvMIPMj40srGp5B50ANrISPrfjUxMANzg0irYArZfPXIpUFj3mEjZvxqaSkfWzVdG5Ukch70YSZ/woodj7Sk5wxFa85gFJY7c8Gk/NGKiX65WigsbaYlznOT786VuWHM6tQ5ZrWr327VCdiUOTmigF5dzlc70LrUyxGwqBpiJZzWgcHY1DG9YdqYiea1viok5rM0AYdq3vWhWx1oA38ah1qVaOKAMxnrWq3WUARJrCT13FbIqOKAG+GDN5H8/yrKlwkfz6P4H8qyqQC4rDisrKgZomtDesrKYiWB863yrKygDXPnWVlZQM2CM4FEj+1WVlJggUhy2K1msrKAM196zVWVlAE8jbvUgSd+QrKyhAa2rMjOKyspiNNgnetMRisrKAIty51GsrKAMrDWVlAGGtGsrKAI1lZWUAZzrfxrKygDVarKygDKysrKAMxmsrKygDdSA2rKygDKz51lZQBojtWwdqysoA3qqWdudZWUASDbVmc8hWVlAzW/atHPMg4rKygCJPY1sGsrKBBUJIqYNZWUDNFvVjNbDVlZQBmQcZqSN7cqyspAEzitawRWVlAGgRmoSnb3rKygADGsJFZWUxETWZrKygDRrXWsrKAMyOlbzWVlAG87VpqysoAwGszWVlAGVnSsrKAD2U629wsrZIAOw58qysrKYH/9k=") center/cover no-repeat`,
  pillars: false
}, {
  id: "ascendant",
  title: "ASCENDANT",
  sub: "Growth",
  desc: "You don't recover — you evolve. Every day clean is a higher peak. You're not going back to the valley. Only upward from here.",
  symbol: "▲",
  gradient: "linear-gradient(160deg, #1a0800 0%, #0d0400 40%, #000 100%)",
  glow: "rgba(255,140,30,0.3)",
  accent: "#ff8c00",
  accentRgb: "255,140,0",
  border: "rgba(255,140,0,0.28)",
  bg: `url("data:image/jpeg;base64,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") center/cover no-repeat`,
  pillars: false
}];
function ArchetypeStep({
  onSelect,
  selected
}) {
  const [vis, setVis] = useState(false);
  const [hovered, setHovered] = useState(null);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  return <div style={{
    minHeight: "100vh",
    paddingTop: "clamp(80px,12vw,120px)",
    paddingBottom: 80,
    paddingLeft: "6vw",
    paddingRight: "6vw",
    position: "relative",
    zIndex: 2,
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)",
    width: "100%",
    boxSizing: "border-box"
  }}>
      {/* Step tag */}
      <div style={{
      width: "100%"
    }}>
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,140,0,.07)",
        border: "1px solid rgba(255,140,0,.2)",
        borderRadius: 999,
        padding: "7px 18px",
        marginBottom: 28,
        animation: "tagGlow 3s ease-in-out infinite"
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#ff8c00",
          boxShadow: "0 0 10px #ff8c00"
        }} />
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 2.5,
          color: "rgba(255,180,80,.65)",
          textTransform: "uppercase"
        }}>Step 01 of 05 — Choose Your Archetype</span>
      </div>
      </div>

      {/* Headline */}
      <div style={{
      position: "relative",
      lineHeight: .9,
      marginBottom: 8,
      width: "100%"
    }}>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7vw,88px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "glitch1 9s ease-in-out infinite",
        lineHeight: .9
      }}>WHO ARE</div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7vw,88px)",
        fontWeight: 900,
        letterSpacing: -3,
        color: "rgba(255,80,0,.35)",
        animation: "glitch2 9s ease-in-out infinite",
        position: "absolute",
        top: 0,
        left: 0,
        lineHeight: .9
      }}>WHO ARE</div>
      </div>
      <div className="glitch-hl" style={{
      fontFamily: "'Orbitron',sans-serif",
      fontSize: "clamp(28px,7vw,88px)",
      fontWeight: 900,
      letterSpacing: -3,
      background: "var(--gradient-text)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: .9,
      marginBottom: 20
    }}>YOU BECOMING?</div>

      <p style={{
      fontSize: 15,
      color: "var(--text3)",
      fontWeight: 300,
      lineHeight: 1.75,
      maxWidth: 500,
      marginBottom: 52,
      textAlign: "center",
      margin: "0 auto 52px auto"
    }}>
        Choose the archetype that resonates with the version of yourself you're fighting to become.{" "}
        <span style={{
        color: document.documentElement.classList.contains("light") ? "rgba(164,90,90,0.85)" : "rgba(255,180,80,.5)",
        fontWeight: 500
      }}>This shapes your recovery identity.</span>
      </p>

      {/* Archetype cards grid */}
      <div className="archetype-grid" style={{
      display: "grid",
      gridTemplateColumns: window.innerWidth <= 700 ? "1fr 1fr" : "repeat(4,1fr)",
      gap: window.innerWidth <= 700 ? 10 : 12,
      marginBottom: 52,
      width: "100%",
      boxSizing: "border-box"
    }}>
        {ARCHETYPES.map((a, i) => {
        const isSel = selected === a.id;
        const isHov = hovered === a.id;
        const active = isSel || isHov;
        return <div key={a.id} onClick={() => onSelect(a.id)} onMouseEnter={() => setHovered(a.id)} onMouseLeave={() => setHovered(null)} style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          cursor: "pointer",
          border: `1px solid ${active ? a.accent + "66" : "rgba(255,255,255,.06)"}`,
          background: a.bg,
          backgroundSize: "cover",
          backgroundPosition: "center",
          transition: "all .4s cubic-bezier(.16,1,.3,1)",
          transform: isSel ? "translateY(-6px) scale(1.02)" : isHov ? "translateY(-3px)" : "translateY(0)",
          boxShadow: isSel ? `0 0 60px rgba(${a.accentRgb},.35), 0 20px 40px rgba(0,0,0,.6), inset 0 1px 0 rgba(${a.accentRgb},.2)` : isHov ? `0 0 30px rgba(${a.accentRgb},.2), 0 12px 28px rgba(0,0,0,.5)` : "0 4px 16px rgba(0,0,0,.4)",
          minHeight: window.innerWidth <= 700 ? "clamp(180px,44vw,240px)" : "clamp(260px,40vw,320px)",
          animation: `fadeUp .6s cubic-bezier(.16,1,.3,1) ${i * .1}s both`
        }}>

              {/* Dark overlay over image — keeps text readable */}
              <div style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(160deg, rgba(0,0,0,${active ? .55 : .72}) 0%, rgba(0,0,0,${active ? .45 : .65}) 100%)`,
            transition: "all .4s",
            pointerEvents: "none",
            zIndex: 1
          }} />
              {/* Accent color tint overlay */}
              <div style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 50% 0%, rgba(${a.accentRgb},${active ? .22 : .08}) 0%, transparent 65%)`,
            transition: "all .4s",
            pointerEvents: "none",
            zIndex: 1
          }} />

              {/* Top accent line */}
              <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${a.accent}${active ? "cc" : "44"}, transparent)`,
            transition: "all .4s",
            zIndex: 2
          }} />

              {/* Pillar effect for Sovereign */}
              {a.pillars && <>
                  <div style={{
              position: "absolute",
              left: 16,
              top: 0,
              bottom: 0,
              width: 2,
              background: `linear-gradient(180deg, transparent, rgba(${a.accentRgb},.15), transparent)`,
              pointerEvents: "none"
            }} />
                  <div style={{
              position: "absolute",
              right: 16,
              top: 0,
              bottom: 0,
              width: 2,
              background: `linear-gradient(180deg, transparent, rgba(${a.accentRgb},.15), transparent)`,
              pointerEvents: "none"
            }} />
                </>}

              {/* Selected check */}
              {isSel && <div style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: a.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            color: "#000",
            boxShadow: `0 0 16px rgba(${a.accentRgb},.8)`
          }}>✓</div>}

              {/* Content */}
              <div style={{
            padding: "clamp(20px,4vw,36px) clamp(14px,3vw,28px) clamp(18px,3vw,32px)",
            position: "relative",
            zIndex: 2
          }}>
                {/* Symbol */}
                <div style={{
              fontSize: "clamp(32px,8vw,44px)",
              marginBottom: 16,
              filter: `drop-shadow(0 0 16px rgba(${a.accentRgb},${active ? .7 : .35}))`,
              transition: "filter .4s",
              lineHeight: 1
            }}>
                  {a.symbol}
                </div>

                {/* Title */}
                <div style={{
              fontFamily: "'Orbitron',sans-serif",
              fontSize: "clamp(14px,4vw,22px)",
              fontWeight: 900,
              letterSpacing: 2,
              color: active ? a.accent : "rgba(255,255,255,.55)",
              marginBottom: 4,
              transition: "color .3s"
            }}>
                  {a.title}
                </div>

                {/* Subtitle */}
                <div style={{
              fontSize: 10,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: `rgba(${a.accentRgb},${active ? .6 : .3})`,
              marginBottom: 18,
              fontWeight: 600,
              transition: "color .3s"
            }}>
                  {a.sub}
                </div>

                {/* Divider */}
                <div style={{
              height: 1,
              background: `linear-gradient(90deg, rgba(${a.accentRgb},${active ? .3 : .1}), transparent)`,
              marginBottom: 18,
              transition: "all .3s"
            }} />

                {/* Description */}
                <p style={{
              fontSize: window.innerWidth <= 700 ? 11 : 13,
              color: active ? "rgba(255,255,255,.52)" : "rgba(255,255,255,.28)",
              lineHeight: 1.8,
              fontWeight: 300,
              transition: "color .3s",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: window.innerWidth <= 700 ? 3 : 8,
              WebkitBoxOrient: "vertical",
              margin: 0
            }}>
                  {a.desc}
                </p>

                {/* Bottom CTA */}
                {isSel && <div style={{
              marginTop: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: a.accent,
              letterSpacing: 1,
              fontWeight: 600,
              textTransform: "uppercase",
              animation: "fadeUp .4s ease both"
            }}>
                    <div style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: a.accent,
                boxShadow: `0 0 8px ${a.accent}`
              }} />
                    ARCHETYPE LOCKED
                  </div>}
              </div>
            </div>;
      })}
      </div>

      {/* Footer */}
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 24,
      borderTop: "1px solid rgba(255,140,0,.08)"
    }}>
        <div style={{
        fontSize: 12,
        color: "var(--text4)",
        fontFamily: "'JetBrains Mono',monospace",
        letterSpacing: 1
      }}>
          {selected ? `${ARCHETYPES.find(a => a.id === selected)?.title} — ${ARCHETYPES.find(a => a.id === selected)?.sub}` : "Choose your identity"}
        </div>
        <button onClick={() => selected && onSelect(selected, true)} disabled={!selected} style={{
        background: selected ? "linear-gradient(135deg,#ff9500,#ff5000)" : "rgba(255,255,255,.04)",
        border: `1px solid ${selected ? "transparent" : "rgba(255,255,255,.08)"}`,
        color: selected ? "#fff" : "rgba(255,255,255,.2)",
        padding: "14px 40px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: .3,
        transition: "all .3s",
        boxShadow: selected ? "0 0 40px rgba(255,140,0,.4),0 6px 24px rgba(0,0,0,.4)" : "none",
        opacity: selected ? 1 : .4,
        cursor: "pointer"
      }}>
          Forge My Identity → Step 2
        </button>
      </div>
    </div>;
}
function ConfessStep1({
  selected,
  onToggle,
  onNext
}) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  return <div className="step-inner" style={{
    minHeight: "100vh",
    padding: "clamp(80px,12vw,120px) 6vw 80px",
    width: "100%",
    boxSizing: "border-box",
    position: "relative",
    zIndex: 2,
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)",
    textAlign: "center"
  }}>
      <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(255,140,0,.07)",
      border: "1px solid rgba(255,140,0,.2)",
      borderRadius: 999,
      padding: "7px 18px",
      marginBottom: 28,
      animation: "tagGlow 3s ease-in-out infinite"
    }}>
        <div style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#ff8c00",
        boxShadow: "0 0 10px #ff8c00"
      }} />
        <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.5,
        color: "rgba(255,180,80,.65)",
        textTransform: "uppercase"
      }}>Step 02 of 05 — Select Your Poisons</span>
      </div>
      <div style={{
      position: "relative",
      lineHeight: .9,
      marginBottom: 8
    }}>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7.5vw,96px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "glitch1 8s ease-in-out infinite",
        lineHeight: .9
      }}>WHAT ARE</div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7.5vw,96px)",
        fontWeight: 900,
        letterSpacing: -3,
        color: "rgba(255,80,0,.4)",
        animation: "glitch2 8s ease-in-out infinite",
        position: "absolute",
        top: 0,
        left: 0,
        lineHeight: .9
      }}>WHAT ARE</div>
      </div>
      <div className="glitch-hl" style={{
      fontFamily: "'Orbitron',sans-serif",
      fontSize: "clamp(28px,7.5vw,96px)",
      fontWeight: 900,
      letterSpacing: -3,
      background: "var(--gradient-text)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: .9,
      marginBottom: 24
    }}>YOUR POISONS?</div>
      <p style={{
      fontSize: 15,
      color: "var(--text3)",
      fontWeight: 300,
      lineHeight: 1.75,
      maxWidth: 520,
      marginBottom: 48,
      marginTop: 8,
      textAlign: "center",
      marginLeft: "auto",
      marginRight: "auto"
    }}>
        Be honest. Select everything that has a grip on you —{" "}
        <span style={{
        color: "rgba(255,180,80,.6)",
        fontWeight: 400
      }}>even if it feels embarrassing.</span>
        <br />
        <span style={{
        fontSize: 13,
        color: "var(--text4)"
      }}>The AI only builds a real plan if you're real with it.</span>
      </p>
      <div className="addiction-grid" style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
      gap: 14,
      marginBottom: 48
    }}>
        {ADDICTIONS.map((a, i) => {
        const sel = selected.includes(a.id);
        const rgb = a.color.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',');
        const cardBg = sel ? `rgba(${rgb},0.12)` : "rgba(255,255,255,.025)";
        const cardBdr = sel ? a.color + "88" : "rgba(255,255,255,.07)";
        const lblClr = sel ? "#fff" : "rgba(255,255,255,.42)";
        const descClr = sel ? `${a.color}cc` : "rgba(255,255,255,.16)";
        const emojiFilter = sel ? "none" : "grayscale(40%) opacity(.6)";
        return <div key={a.id} onClick={() => onToggle(a.id)} style={{
          padding: "20px 18px",
          borderRadius: 16,
          background: cardBg,
          border: `1px solid ${cardBdr}`,
          cursor: "pointer",
          transition: "all .25s cubic-bezier(.16,1,.3,1)",
          transform: sel ? "translateY(-3px)" : "translateY(0)",
          boxShadow: sel ? `0 0 30px ${a.color}22,0 8px 24px rgba(0,0,0,.4)` : "none",
          animation: `fadeUp .6s cubic-bezier(.16,1,.3,1) ${i * .04}s both`,
          position: "relative",
          overflow: "hidden"
        }}>
              {sel && <div style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at top left, ${a.color}${"18"}, transparent 65%)`,
            pointerEvents: "none"
          }} />}
              <div style={{
            fontSize: 26,
            marginBottom: 10,
            filter: emojiFilter,
            transition: "filter .25s"
          }}>{a.emoji}</div>
              <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: lblClr,
            marginBottom: 3,
            transition: "color .25s"
          }}>{a.label}</div>
              <div style={{
            fontSize: 10,
            color: descClr,
            lineHeight: 1.5,
            transition: "color .25s"
          }}>{a.desc}</div>
              {sel && <div style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: a.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 800,
            color: "#fff"
          }}>✓</div>}
            </div>;
      })}
      </div>
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 24,
      borderTop: document.documentElement.classList.contains("light") ? "1px solid rgba(192,225,210,.4)" : "1px solid rgba(255,140,0,.08)"
    }}>
        <div style={{
        fontSize: 12,
        color: "var(--text3)",
        fontFamily: "'JetBrains Mono',monospace",
        letterSpacing: 1
      }}>{selected.length === 0 ? "Select at least one" : `${selected.length} poison${selected.length > 1 ? "s" : ""} identified`}</div>
        <button onClick={onNext} disabled={selected.length === 0} style={{
        background: document.documentElement.classList.contains("light") ? "linear-gradient(135deg,#c47a7a,#a85c5c)" : "linear-gradient(135deg,#ff9500,#ff5000)",
        border: "none",
        color: "#fff",
        padding: "14px 40px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: .3,
        transition: "all .3s",
        boxShadow: selected.length ? "0 0 30px rgba(255,140,0,.3),0 6px 20px rgba(0,0,0,.3)" : "none",
        opacity: selected.length ? 1 : .35,
        cursor: "pointer"
      }}>
          Analyze Damage → Step 2
        </button>
      </div>
    </div>;
}
function ConfessStep2({
  selected,
  hours,
  onHoursChange,
  onNext,
  onBack
}) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  const selectedAddictions = ADDICTIONS.filter(a => selected.includes(a.id));
  // For total audit: freq addictions contribute ~0.5h per time as rough estimate
  const totalHours = selectedAddictions.reduce((s, a) => {
    const v = hours[a.id] || 0;
    return s + (FREQ_ADDICTIONS.has(a.id) ? v * 0.5 : v);
  }, 0);
  const hasAnyValue = selectedAddictions.some(a => (hours[a.id] || 0) > 0);
  return <div style={{
    minHeight: "100vh",
    padding: "clamp(80px,12vw,120px) 6vw 80px",
    maxWidth: "100%",
    margin: "0 auto",
    position: "relative",
    zIndex: 2,
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)"
  }}>
      <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(255,140,0,.07)",
      border: "1px solid rgba(255,140,0,.2)",
      borderRadius: 999,
      padding: "7px 18px",
      marginBottom: 28,
      animation: "tagGlow 3s ease-in-out infinite"
    }}>
        <div style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#ff8c00",
        boxShadow: "0 0 10px #ff8c00"
      }} />
        <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.5,
        color: "rgba(255,180,80,.65)",
        textTransform: "uppercase"
      }}>Step 03 of 05 — Measure the Damage</span>
      </div>
      <div style={{
      textAlign: "center",
      marginBottom: 28
    }}>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(26px,7vw,84px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: .9,
        overflow: "visible",
        width: "100%"
      }}>HOW MUCH</div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(26px,7vw,84px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: .9,
        overflow: "visible",
        width: "100%",
        marginTop: 8
      }}>& HOW OFTEN?</div>
        <p style={{
        fontSize: 14,
        color: "var(--text3)",
        fontWeight: 300,
        lineHeight: 1.9,
        maxWidth: 480,
        marginBottom: 0,
        textAlign: "center",
        margin: "20px auto 0"
      }}>Screen addictions are measured in hours per day. Urge-based addictions are measured in times per week. Be brutally honest.</p>
      </div>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 18,
      marginBottom: 40
    }}>
        {selectedAddictions.map((a, i) => {
        const v = hours[a.id] || 0;
        const isFreq = FREQ_ADDICTIONS.has(a.id);
        const max = isFreq ? 10 : 12;
        const step = isFreq ? 1 : 0.5;
        const rgb = a.color.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',');
        const displayVal = isFreq ? v === 0 ? "Not measured yet" : v === 1 ? "1 time this week" : `${v}x per week` : v === 0 ? "Not measured yet" : v < 1 ? "Less than an hour" : `${v}h per day`;
        const unitLabel = isFreq ? `${v}x` : `${v}h`;
        const unitSub = isFreq ? v > 0 ? `${Math.round(v * 52)}x/year` : "" : v > 0 ? `${v * 365} hrs/year` : "";
        const tickMarks = isFreq ? [0, 2, 4, 6, 8, 10] : [0, 2, 4, 6, 8, 10, 12];
        const tickLabel = isFreq ? n => `${n}x` : n => `${n}h`;
        return <div key={a.id} className="glass" style={{
          padding: "24px 28px",
          animation: `fadeUp .5s cubic-bezier(.16,1,.3,1) ${i * .07}s both`,
          border: `1px solid rgba(${rgb},.2)`
        }}>
              <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18
          }}>
                <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12
            }}>
                  <div style={{
                fontSize: 22
              }}>{a.emoji}</div>
                  <div>
                    <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)"
                }}>{a.label}</div>
                    <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 3
                }}>
                      <div style={{
                    fontSize: 10,
                    color: `rgba(${rgb},.65)`,
                    letterSpacing: .5
                  }}>{displayVal}</div>
                      {isFreq && <div style={{
                    fontSize: 9,
                    background: `rgba(${rgb},.12)`,
                    border: `1px solid rgba(${rgb},.3)`,
                    borderRadius: 999,
                    padding: "1px 7px",
                    color: `rgba(${rgb},.8)`,
                    letterSpacing: .5,
                    fontFamily: "'JetBrains Mono',monospace"
                  }}>FREQUENCY</div>}
                    </div>
                  </div>
                </div>
                <div style={{
              textAlign: "right"
            }}>
                  <div style={{
                fontFamily: "'Orbitron',sans-serif",
                fontSize: 28,
                fontWeight: 900,
                color: a.color,
                letterSpacing: -1,
                lineHeight: 1
              }}>{unitLabel}</div>
                  {v > 0 && <div style={{
                fontSize: 9,
                color: "var(--text4)",
                marginTop: 2
              }}>{unitSub}</div>}
                </div>
              </div>
              <div style={{
            position: "relative",
            height: 5,
            background: "rgba(255,255,255,.05)",
            borderRadius: 3
          }}>
                <div style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              borderRadius: 3,
              background: `linear-gradient(90deg,rgba(${rgb},.4),${a.color})`,
              width: `${v / max * 100}%`,
              transition: "width .15s",
              boxShadow: `0 0 8px rgba(${rgb},.45)`
            }} />
                <input type="range" min={0} max={max} step={step} value={v} onChange={e => onHoursChange(a.id, parseFloat(e.target.value))} style={{
              position: "absolute",
              top: -8,
              left: 0,
              width: "100%",
              height: 22,
              opacity: 0,
              zIndex: 2
            }} />
                <div style={{
              position: "absolute",
              top: "50%",
              left: `${v / max * 100}%`,
              transform: "translate(-50%,-50%)",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: a.color,
              boxShadow: `0 0 10px ${a.color}`,
              border: "2px solid rgba(0,0,0,.5)",
              transition: "left .15s",
              pointerEvents: "none"
            }} />
              </div>
              <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            fontSize: 9,
            color: "var(--text4)",
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: 1
          }}>
                {tickMarks.map(n => <span key={n}>{tickLabel(n)}</span>)}
              </div>
            </div>;
      })}
      </div>
      {hasAnyValue && <div style={{
      background: "rgba(255,40,40,.05)",
      border: "1px solid rgba(255,40,40,.18)",
      borderRadius: 14,
      padding: "20px 28px",
      marginBottom: 36,
      animation: "fadeUp .5s ease both"
    }}>
          <div style={{
        display: "flex",
        alignItems: "center",
        gap: 32,
        flexWrap: "wrap"
      }}>
            {[[`${selectedAddictions.filter(a => !FREQ_ADDICTIONS.has(a.id)).reduce((s, a) => s + (hours[a.id] || 0), 0)}h`, "screen time/day"], [`${selectedAddictions.filter(a => FREQ_ADDICTIONS.has(a.id)).reduce((s, a) => s + (hours[a.id] || 0), 0)}x`, "urges/day"], [`${Math.round(totalHours * 365 / 24)} days`, "lost per year"]].map(([v, l]) => <div key={l}><div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 24,
            fontWeight: 800,
            color: "#ff4444",
            letterSpacing: -1,
            lineHeight: 1
          }}>{v}</div><div style={{
            fontSize: 10,
            color: "var(--text4)",
            marginTop: 3,
            letterSpacing: .5
          }}>{l}</div></div>)}
          </div>
        </div>}
      <div style={{
      display: "flex",
      gap: 14,
      justifyContent: "space-between",
      paddingTop: 24,
      borderTop: "1px solid rgba(255,140,0,.08)"
    }}>
        <button onClick={onBack} style={{
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.1)",
        color: "var(--text3)",
        padding: "13px 28px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 500,
        transition: "all .25s",
        cursor: "pointer"
      }}>← Back</button>
        <button onClick={onNext} disabled={!hasAnyValue} style={{
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        border: "none",
        color: "var(--text)",
        padding: "14px 40px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: .3,
        transition: "all .3s",
        boxShadow: hasAnyValue ? "0 0 40px rgba(255,140,0,.4),0 6px 24px rgba(0,0,0,.4)" : "none",
        opacity: hasAnyValue ? 1 : .3,
        cursor: "pointer"
      }}>
          See What You're Losing → Step 3
        </button>
      </div>
    </div>;
}
function ConfessStep3({
  selected,
  hours,
  onNext,
  onBack
}) {
  const [vis, setVis] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [tagIdx, setTagIdx] = useState(0);
  const [tagVis, setTagVis] = useState(true);
  const selectedAddictions = ADDICTIONS.filter(a => selected.includes(a.id));
  const active = selectedAddictions[activeIdx];
  const effects = active ? EFFECTS[active.id] : null;
  const allLosses = selectedAddictions.flatMap(a => EFFECTS[a.id]?.loss || []);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      setTagVis(false);
      setTimeout(() => {
        setTagIdx(i => (i + 1) % allLosses.length);
        setTagVis(true);
      }, 400);
    }, 2800);
    return () => clearInterval(t);
  }, [allLosses.length]);
  if (!active || !effects) return null;
  const totalHours = selectedAddictions.reduce((s, a) => s + (FREQ_ADDICTIONS.has(a.id) ? 0 : hours[a.id] || 0), 0);
  const rgb = active.color.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',');
  return <div style={{
    minHeight: "100vh",
    padding: "clamp(80px,12vw,120px) 6vw 80px",
    maxWidth: "100%",
    margin: "0 auto",
    position: "relative",
    zIndex: 2,
    opacity: vis ? 1 : 0,
    transform: vis ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)"
  }}>
      <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(255,40,40,.07)",
      border: "1px solid rgba(255,40,40,.25)",
      borderRadius: 999,
      padding: "7px 18px",
      marginBottom: 28
    }}>
        <div style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#ff4444",
        boxShadow: "0 0 10px #ff4444",
        animation: "pulseRing 1.4s ease-out infinite"
      }} />
        <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.5,
        color: "rgba(255,120,100,.7)",
        textTransform: "uppercase"
      }}>Step 04 of 05 — The Real Cost</span>
      </div>
      <div className="glitch-hl" style={{
      fontFamily: "'Orbitron',sans-serif",
      fontSize: "clamp(26px,7vw,84px)",
      fontWeight: 900,
      letterSpacing: -3,
      background: "linear-gradient(160deg,#ff4444 0%,#ff8844 60%,rgba(255,180,80,.7) 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: .9,
      marginBottom: 8
    }}>WHAT YOU</div>
      <div className="glitch-hl" style={{
      fontFamily: "'Orbitron',sans-serif",
      fontSize: "clamp(26px,7vw,84px)",
      fontWeight: 900,
      letterSpacing: -3,
      background: "linear-gradient(160deg,#ff4444 0%,#ff8844 60%,rgba(255,180,80,.7) 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: .9,
      marginBottom: 36
    }}>ARE LOSING.</div>
      <div style={{
      marginBottom: 40,
      height: 52,
      display: "flex",
      alignItems: "center"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: tagVis ? 1 : 0,
        transform: tagVis ? "translateY(0)" : "translateY(10px)",
        transition: "all .4s cubic-bezier(.16,1,.3,1)"
      }}>
          <div style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "#ff4444",
          flexShrink: 0,
          boxShadow: "0 0 8px #ff4444"
        }} />
          <span style={{
          fontSize: 17,
          fontWeight: 300,
          color: "var(--text2)",
          letterSpacing: .3
        }}>You are trading <span style={{
            color: "var(--text)",
            fontWeight: 600
          }}>{allLosses[tagIdx]}</span> for 5-second dopamine.</span>
        </div>
      </div>
      <div style={{
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 24
    }}>
        {selectedAddictions.map((a, i) => {
        const r2 = a.color.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',');
        return <button key={a.id} onClick={() => setActiveIdx(i)} style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          borderRadius: 999,
          border: `1px solid ${activeIdx === i ? a.color + "88" : "rgba(255,255,255,.07)"}`,
          background: activeIdx === i ? `rgba(${r2},.12)` : "rgba(255,255,255,.03)",
          color: activeIdx === i ? "#fff" : "rgba(255,255,255,.28)",
          fontSize: 11,
          fontWeight: 600,
          transition: "all .2s",
          cursor: "pointer"
        }}><span>{a.emoji}</span><span>{a.label}</span></button>;
      })}
      </div>
      <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
      marginBottom: 36
    }}>
        <div style={{
        background: `rgba(${rgb},.06)`,
        border: `1px solid rgba(${rgb},.2)`,
        borderRadius: 16,
        padding: "28px 24px",
        animation: "scaleIn .4s cubic-bezier(.16,1,.3,1) both"
      }}>
          <div style={{
          fontSize: 9,
          fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: 3,
          color: `rgba(${rgb},.55)`,
          textTransform: "uppercase",
          marginBottom: 14
        }}>🧠 Brain Damage</div>
          <p style={{
          fontSize: 13,
          lineHeight: 1.9,
          color: "var(--text2)",
          fontWeight: 300
        }}>{effects.brain}</p>
          <div style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px solid rgba(${rgb},.12)`,
          display: "flex",
          alignItems: "center",
          gap: 8
        }}>
            <div style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: active.color,
            boxShadow: `0 0 6px ${active.color}`
          }} />
            <span style={{
            fontSize: 10,
            color: `rgba(${rgb},.65)`,
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: .5
          }}>{effects.stat}</span>
          </div>
        </div>
        <div style={{
        background: "rgba(255,40,40,.04)",
        border: "1px solid rgba(255,40,40,.14)",
        borderRadius: 16,
        padding: "28px 24px",
        animation: "scaleIn .4s cubic-bezier(.16,1,.3,1) .08s both"
      }}>
          <div style={{
          fontSize: 9,
          fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: 3,
          color: "rgba(255,100,80,.55)",
          textTransform: "uppercase",
          marginBottom: 14
        }}>💸 What You're Losing</div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 9
        }}>
            {effects.loss.map((l, i) => <div key={i} style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: `fadeUp .4s ease ${i * .06}s both`
          }}><div style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "rgba(255,40,40,.14)",
              border: "1px solid rgba(255,40,40,.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              color: "#ff6644",
              flexShrink: 0
            }}>✕</div><span style={{
              fontSize: 12,
              color: "var(--text3)",
              fontWeight: 400
            }}>{l}</span></div>)}
          </div>
        </div>
      </div>
      <div style={{
      background: "rgba(255,60,0,.04)",
      border: "1px solid rgba(255,60,0,.18)",
      borderRadius: 14,
      padding: "20px 28px",
      marginBottom: 36,
      display: "flex",
      gap: 28,
      flexWrap: "wrap",
      alignItems: "center"
    }}>
        <div style={{
        fontSize: 10,
        color: "rgba(255,140,80,.38)",
        fontFamily: "'JetBrains Mono',monospace",
        letterSpacing: 2,
        textTransform: "uppercase",
        flex: "0 0 auto"
      }}>⏱ Time Audit</div>
        {[[`${totalHours}h`, "stolen every day"], [`${Math.round(totalHours * 30)}h`, "this month"], [`${Math.round(totalHours * 365 / 24)} days`, "this year"], [`${Math.round(totalHours * 365 * 10 / 24 / 365)} years`, "in 10 years"]].map(([v, l]) => <div key={l}><div style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: 20,
          fontWeight: 800,
          color: "#ff6644",
          letterSpacing: -1,
          lineHeight: 1
        }}>{v}</div><div style={{
          fontSize: 9,
          color: "var(--text4)",
          marginTop: 3,
          letterSpacing: .5
        }}>{l}</div></div>)}
      </div>
      <div style={{
      display: "flex",
      gap: 14,
      justifyContent: "space-between",
      paddingTop: 24,
      borderTop: "1px solid rgba(255,140,0,.08)"
    }}>
        <button onClick={onBack} style={{
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.1)",
        color: "var(--text3)",
        padding: "13px 28px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 500,
        transition: "all .25s",
        cursor: "pointer"
      }}>← Back</button>
        <button onClick={onNext} style={{
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        border: "none",
        color: "var(--text)",
        padding: "14px 40px",
        borderRadius: 12,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: .3,
        transition: "all .3s",
        boxShadow: "0 0 40px rgba(255,140,0,.4),0 6px 24px rgba(0,0,0,.4)",
        cursor: "pointer"
      }}>
          I'm Ready. Build My Plan → Step 4
        </button>
      </div>
    </div>;
}
function ConfessStep4({
  selected,
  hours,
  onSubmit,
  loading,
  onBack
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setTimeout(() => setVisible(true), 80);
  }, []);
  const selectedAddictions = ADDICTIONS.filter(a => selected.includes(a.id));
  const totalHours = Object.values(hours).reduce((s, v) => s + (v || 0), 0);
  const buildPrompt = () => {
    const list = selectedAddictions.map(a => {
      const v = hours[a.id] || 0;
      const unit = FREQ_ADDICTIONS.has(a.id) ? `${v}x/day` : `${v}h/day`;
      return `${a.label} (${unit})`;
    }).join(", ");
    const screenHours = selectedAddictions.filter(a => !FREQ_ADDICTIONS.has(a.id)).reduce((s, a) => s + (hours[a.id] || 0), 0);
    const extra = text.trim() ? `\n\nAdditional context from user: ${text.trim()}` : "";
    return `My addictions: ${list}. Daily screen time wasted: ${screenHours} hours.${extra}`;
  };
  const lineCount = Math.max((text.match(/\n/g) || []).length + 1, 6);
  return <div style={{
    minHeight: "100vh",
    padding: "120px 80px 80px",
    maxWidth: 1100,
    margin: "0 auto",
    position: "relative",
    zIndex: 2,
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)"
  }}>
      <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(255,140,0,.07)",
      border: "1px solid rgba(255,140,0,.2)",
      borderRadius: 999,
      padding: "7px 18px",
      marginBottom: 28,
      animation: "tagGlow 3s ease-in-out infinite"
    }}>
        <div style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#ff8c00",
        boxShadow: "0 0 10px #ff8c00",
        position: "relative"
      }}><div style={{
          position: "absolute",
          inset: -3,
          borderRadius: "50%",
          background: "rgba(255,140,0,.3)",
          animation: "pulseRing 1.8s ease-out infinite"
        }} /></div>
        <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.5,
        color: "rgba(255,180,80,.65)",
        textTransform: "uppercase"
      }}>Step 05 of 05 — Final Confession</span>
      </div>
      <div style={{
      position: "relative",
      lineHeight: .9,
      marginBottom: 8
    }}>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7.5vw,96px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "glitch1 7s ease-in-out infinite"
      }}>TELL THE</div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7.5vw,96px)",
        fontWeight: 900,
        letterSpacing: -3,
        color: "rgba(255,80,0,.4)",
        animation: "glitch2 7s ease-in-out infinite",
        position: "absolute",
        top: 0,
        left: 0
      }}>TELL THE</div>
      </div>
      <div className="glitch-hl" style={{
      fontFamily: "'Orbitron',sans-serif",
      fontSize: "clamp(28px,7.5vw,96px)",
      fontWeight: 900,
      letterSpacing: -3,
      background: "var(--gradient-text)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: .9,
      marginBottom: 20
    }}>TRUTH.</div>
      <p style={{
      fontSize: 14,
      color: "var(--text4)",
      fontWeight: 300,
      lineHeight: 1.9,
      maxWidth: 480,
      marginBottom: 36
    }}>Anything extra SYNAPSE should know? How long, what you've tried, your biggest struggle? <span style={{
        color: "rgba(255,180,80,.45)"
      }}>Optional — your plan generates either way.</span></p>
      <div style={{
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 28
    }}>
        {selectedAddictions.map(a => {
        const rgb = a.color.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',');
        const v = hours[a.id] || 0;
        const unitStr = FREQ_ADDICTIONS.has(a.id) ? `${v}x/d` : `${v}h/d`;
        return <div key={a.id} style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: `rgba(${rgb},.1)`,
          border: `1px solid rgba(${rgb},.28)`,
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 10,
          color: `rgba(${rgb},1)`
        }}><span>{a.emoji}</span><span>{a.label}</span><span style={{
            opacity: .4
          }}>·</span><span style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9
          }}>{unitStr}</span></div>;
      })}
      </div>
      <div style={{
      background: "rgba(0,0,0,.5)",
      border: `1px solid ${focused ? "rgba(255,140,0,.55)" : "rgba(255,140,0,.14)"}`,
      borderRadius: 14,
      overflow: "hidden",
      transition: "border-color .3s, box-shadow .3s",
      boxShadow: focused ? "0 0 0 1px rgba(255,140,0,.22),0 0 40px rgba(255,100,0,.12)" : "none",
      marginBottom: 20
    }}>
        <div style={{
        background: "rgba(255,140,0,.06)",
        borderBottom: "1px solid rgba(255,140,0,.1)",
        padding: "10px 18px",
        display: "flex",
        alignItems: "center",
        gap: 10
      }}>
          <div style={{
          display: "flex",
          gap: 6
        }}>{["#ff5f57", "#ffbd2e", "#28ca41"].map((c, i) => <div key={i} style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: c,
            opacity: .65
          }} />)}</div>
          <span style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 10,
          color: "rgba(255,180,80,.4)",
          letterSpacing: 2,
          marginLeft: 6
        }}>SYNAPSE_TERMINAL — confession.log</span>
          <div style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 5
        }}>
            <div style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: focused ? "#88ff44" : "rgba(255,140,0,.25)",
            boxShadow: focused ? "0 0 6px #88ff44" : "none",
            transition: "all .3s"
          }} />
            <span style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9,
            color: focused ? "rgba(136,255,68,.55)" : "rgba(255,255,255,.15)",
            letterSpacing: 1
          }}>{focused ? "RECORDING" : "OPTIONAL"}</span>
          </div>
        </div>
        <div style={{
        display: "flex",
        minHeight: 160
      }}>
          <div style={{
          width: 40,
          background: "rgba(255,140,0,.02)",
          borderRight: "1px solid rgba(255,140,0,.06)",
          padding: "16px 0",
          flexShrink: 0
        }}>
            {Array.from({
            length: lineCount + 2
          }, (_, i) => <div key={i} style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            color: "rgba(255,140,0,.18)",
            textAlign: "right",
            padding: "0 8px",
            lineHeight: "26px"
          }}>{i + 1}</div>)}
          </div>
          <div style={{
          flex: 1,
          position: "relative",
          padding: "16px 4px 16px 0"
        }}>
            <div style={{
            position: "absolute",
            top: 18,
            left: 12,
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12,
            color: "rgba(255,140,0,.45)",
            pointerEvents: "none",
            zIndex: 2,
            lineHeight: "26px"
          }}>›</div>
            <textarea value={text} onChange={e => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder={focused ? "" : "(Optional) How long has this been going on? What have you tried before? Your biggest struggle..."} style={{
            width: "100%",
            minHeight: 140,
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12,
            fontWeight: 400,
            color: "var(--text)",
            lineHeight: "26px",
            padding: "0 18px 0 28px",
            caretColor: "#ff8c00",
            letterSpacing: .3
          }} />
            {focused && !text && <div style={{
            position: "absolute",
            top: 20,
            left: 40,
            width: 7,
            height: 12,
            background: "#ff8c00",
            animation: "termCursor .9s step-end infinite",
            borderRadius: 1
          }} />}
          </div>
        </div>
        <div style={{
        borderTop: "1px solid rgba(255,140,0,.07)",
        background: "rgba(255,140,0,.02)",
        padding: "8px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
          <span style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 9,
          color: "rgba(255,180,80,.25)",
          letterSpacing: .5
        }}>CHARS: <span style={{
            color: "rgba(255,180,80,.45)"
          }}>{text.length}</span></span>
          <span style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 9,
          color: "rgba(255,140,0,.25)",
          letterSpacing: .5
        }}>OPTIONAL — plan generates either way</span>
        </div>
      </div>
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 16,
      paddingTop: 8
    }}>
        <div style={{
        display: "flex",
        gap: 12
      }}>
          <button onClick={onBack} style={{
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.1)",
          color: "var(--text3)",
          padding: "13px 24px",
          borderRadius: 12,
          fontFamily: "'Inter',sans-serif",
          fontSize: 13,
          fontWeight: 500,
          transition: "all .25s",
          cursor: "pointer"
        }}>← Back</button>
          <div style={{
          fontSize: 11,
          color: "var(--text4)",
          fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: .5,
          lineHeight: 1.7,
          display: "flex",
          alignItems: "center"
        }}>🔒 Never stored or shared</div>
        </div>
        <button onClick={() => onSubmit(buildPrompt())} disabled={loading} style={{
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        border: "none",
        color: "var(--text)",
        padding: "16px 48px",
        borderRadius: 14,
        fontFamily: "'Inter',sans-serif",
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: .5,
        transition: "all .3s cubic-bezier(.16,1,.3,1)",
        boxShadow: "0 0 50px rgba(255,140,0,.5),0 0 100px rgba(255,80,0,.2),0 8px 28px rgba(0,0,0,.5)",
        cursor: "pointer"
      }}>
          {loading ? "Building Your Battle Plan..." : "Generate My Battle Plan 🔥"}
        </button>
      </div>
      {loading && <div style={{
      marginTop: 16,
      height: 2,
      background: "rgba(255,140,0,.05)",
      borderRadius: 1,
      overflow: "hidden",
      position: "relative"
    }}><div style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(90deg,transparent,rgba(255,140,0,.6),transparent)",
        animation: "shimmer 1.6s ease-in-out infinite"
      }} /></div>}
    </div>;
}
function Confess({
  onSubmit,
  loading
}) {
  const [step, setStep] = useState(0);
  const [archetype, setArchetype] = useState(null);
  const [selected, setSelected] = useState([]);
  const [hours, setHours] = useState({});
  const toggleAddiction = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const setHoursFor = (id, val) => setHours(h => ({
    ...h,
    [id]: val
  }));
  const handleArchetypeSelect = (id, proceed = false) => {
    setArchetype(id);
    if (proceed) setStep(1);
  };

  // Fix: clicking "Next" at the bottom of a long step previously carried the
  // scroll position straight into the next step, so the new step rendered
  // already scrolled to wherever the old one left off (often mid/bottom of
  // the page) instead of starting at the top. Force scroll-to-top on every
  // step change, same pattern used by the top-level goTo() screen navigator.
  useEffect(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [step]);
  const handleSubmitWithArchetype = prompt => {
    const arch = ARCHETYPES.find(a => a.id === archetype);
    const archData = arch ? {
      id: arch.id,
      title: arch.title,
      sub: arch.sub
    } : null;
    if (arch) ls.set("syn_archetype", JSON.stringify(archData));
    // Save addiction data for structured checkin screen
    const confessData = {
      addictions: selected.map(id => {
        const full = ADDICTIONS.find(a => a.id === id);
        return {
          id,
          label: full?.label || id,
          emoji: full?.emoji || "⚡",
          color: full?.color || "#ff8c00",
          isFreq: FREQ_ADDICTIONS.has(id),
          value: hours[id] || 0
        };
      }),
      // Per-addiction baseline usage as an id->value map. handleConfess and the
      // admin dashboard both read confessData.hours for the `hoursPerDay` field;
      // without this key it was always {} (the per-addiction value lived only
      // inside addictions[].value), so the dashboard's hours column stayed blank.
      hours: Object.fromEntries(selected.map(id => [id, hours[id] || 0]))
    };
    ls.set("syn_confess", JSON.stringify(confessData));
    const enriched = arch ? `User Archetype: ${arch.title} (${arch.sub})\n\n${prompt}` : prompt;
    onSubmit(enriched, archData);
  };
  const steps = ["Archetype", "Poisons", "Damage", "Cost", "Plan"];
  return <div style={{
    minHeight: "100vh",
    background: "var(--bg)",
    position: "relative",
    overflowX: "hidden",
    width: "100%"
  }}>
      {/* Full-screen background - no gaps */}
      <div style={{
      position: "fixed",
      inset: 0,
      background: "var(--bg)",
      zIndex: -1,
      pointerEvents: "none"
    }} />
      <div style={{
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      zIndex: 0
    }}>
        <div style={{
        position: "absolute",
        top: "-10%",
        right: "-5%",
        width: 700,
        height: 700,
        background: "radial-gradient(circle,rgba(255,90,0,.07) 0%,transparent 65%)"
      }} />
        <div style={{
        position: "absolute",
        bottom: "10%",
        left: "-8%",
        width: 500,
        height: 500,
        background: "radial-gradient(circle,rgba(255,140,0,.04) 0%,transparent 70%)"
      }} />
      </div>
      {/* Step progress bar */}
      <div className="step-bar-outer" style={{
      position: "fixed",
      top: 72,
      left: 0,
      right: 0,
      zIndex: 400,
      padding: "0",
      background: "rgba(6,3,10,.85)",
      backdropFilter: "blur(20px)",
      borderBottom: "1px solid rgba(255,140,0,.07)"
    }}>
        <div style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        padding: "12px 6vw",
        gap: 4,
        overflowX: "auto"
      }}>
          {steps.map((s, i) => {
          const done = step > i,
            active = step === i;
          return <div key={s} style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flex: i < steps.length - 1 ? 1 : "auto"
          }}><div style={{
              display: "flex",
              alignItems: "center",
              gap: 7
            }}><div style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: done ? "#ff8c00" : active ? "rgba(255,140,0,.18)" : "rgba(255,255,255,.04)",
                border: `1px solid ${done || active ? "rgba(255,140,0,.55)" : "rgba(255,255,255,.09)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: done ? "#fff" : active ? "rgba(255,180,80,.75)" : "rgba(255,255,255,.18)",
                transition: "all .3s",
                flexShrink: 0
              }}>{done ? "✓" : i + 1}</div><span style={{
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontWeight: 500,
                color: active ? "rgba(255,180,80,.75)" : done ? "rgba(255,140,0,.55)" : "rgba(255,255,255,.18)",
                transition: "all .3s",
                whiteSpace: "nowrap"
              }} className="step-label">{s}</span></div>{i < steps.length - 1 && <div style={{
              flex: 1,
              height: 1,
              background: done ? "rgba(255,140,0,.35)" : "rgba(255,255,255,.05)",
              marginLeft: 6,
              transition: "background .3s"
            }} />}</div>;
        })}
        </div>
      </div>
      {step === 0 && <ArchetypeStep selected={archetype} onSelect={handleArchetypeSelect} />}
      {step === 1 && <ConfessStep1 selected={selected} onToggle={toggleAddiction} onNext={() => setStep(2)} />}
      {step === 2 && <ConfessStep2 selected={selected} hours={hours} onHoursChange={setHoursFor} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <ConfessStep3 selected={selected} hours={hours} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <ConfessStep4 selected={selected} hours={hours} onSubmit={handleSubmitWithArchetype} loading={loading} onBack={() => setStep(3)} />}
    </div>;
}

/* ─── PLAN ───────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════
   URGE SURFING TIMER
══════════════════════════════════════════════════════════════════════════ */
const URGE_TASKS = [
// Physical release — burns adrenaline fast, breaks the freeze
"20 pushups, right now, no thinking. Can't do 20? Do as many as you can, then 10 more slow ones on your knees.", "50 jumping jacks. Full speed. Your heart rate spiking kills the urge signal faster than anything else on this list.", "Hold a wall-sit for 45 seconds. Legs burning is a better feeling to sit with than the urge — and it ends.", "Stand up and shake your whole body out for 30 seconds like a wet dog. Feels stupid. Works.",
// Sensory grounding — properly explained, not vague
"5-4-3-2-1 grounding: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste. Say them out loud, not in your head.", "Hold an ice cube in your fist until it melts. Cold shock resets your nervous system out of urge-mode in under 90 seconds.", "Splash cold water on your face and the back of your neck 3 times. Then look at yourself in the mirror for 10 seconds and say 'not today.'", "Put on one song, headphones in, volume up. Don't scroll — just listen to the whole thing, eyes closed if you can.",
// Cognitive reframe — gives the brain something real to chew on
"Write down exactly what happened in the 10 minutes before this urge hit. What triggered it? Be specific — this is data for tomorrow's you.", "Write one sentence: 'In 30 minutes I will feel ___ if I give in, and ___ if I don't.' Fill both blanks honestly.", "Open your battle plan and read it out loud, not in your head. Hearing your own reasons in your own voice hits different.", "Picture yourself 10 minutes from now, urge gone, having said no. What does that version of you say to you right now?",
// Connection — breaks isolation, which is usually part of the trigger
"Text one person 'hey, thinking of you' — no context needed. Just get a human thread open. Isolation is fuel for urges.", "Call someone, even for 60 seconds, even about nothing. Ask how their day is. Talking out loud interrupts the loop.",
// Environment change — physically remove yourself from the trigger
"Get up and change rooms right now. If you can, go outside for 2 minutes — no phone. New environment, new state.", "Do a 60-second tidy: make your bed, clear your desk, put 5 things away. Small physical order calms a spiking brain.", "Go brush your teeth. Sounds random — it's a hard behavioral signal to your brain that this part of the day is 'closed.'",
// Productive redirection — replaces the urge with a real 2-minute win
"Do the dishes in your sink, even just 3 of them. A finished task beats a fought urge — you get to end this on a win.", "Write down one thing you're proud of from this week. Doesn't have to be big. Read it back to yourself.", "Plan tomorrow's first hour in 3 bullet points. Urges thrive on a blank, aimless mind — give it a job."];
const URGE_PHASES = [{
  at: 600,
  label: "WAVE INCOMING",
  color: "#ff4040",
  sub: "Peak intensity. This is the hardest part. Hold."
}, {
  at: 480,
  label: "HOLDING THE LINE",
  color: "#ff6020",
  sub: "You're in it. Don't negotiate. Just wait."
}, {
  at: 300,
  label: "PAST THE PEAK",
  color: "#ff8c00",
  sub: "The wave is breaking. Keep breathing."
}, {
  at: 120,
  label: "ALMOST THROUGH",
  color: "#ffb347",
  sub: "90% urges die in 10 minutes. You're almost there."
}, {
  at: 0,
  label: "YOU SURVIVED",
  color: "#4caf50",
  sub: "The urge passed. It always does. Log this win."
}];
function UrgeTimer({
  streak,
  savedPlan
}) {
  const DURATION = 600; // 10 minutes
  const [active, setActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [done, setDone] = useState(false);
  const [task, setTask] = useState(null);
  const [urgeLog, setUrgeLog] = useState(() => {
    try {
      return JSON.parse(ls.get("syn_urge_log", "[]"));
    } catch {
      return [];
    }
  });
  const [intensity, setIntensity] = useState(null); // null = not selected yet
  const intervalRef = useRef(null);
  const phase = URGE_PHASES.find(p => timeLeft > p.at) || URGE_PHASES[URGE_PHASES.length - 1];
  const progress = (DURATION - timeLeft) / DURATION * 100;
  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");
  const startTimer = () => {
    setActive(true);
    setDone(false);
    setTimeLeft(DURATION);
    setTask(URGE_TASKS[Math.floor(Math.random() * URGE_TASKS.length)]);
    intervalRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(intervalRef.current);
          setActive(false);
          setDone(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };
  const reset = () => {
    clearInterval(intervalRef.current);
    setActive(false);
    setDone(false);
    setTimeLeft(DURATION);
    setIntensity(null);
    setTask(null);
  };
  const logUrge = survived => {
    const entry = {
      date: new Date().toISOString(),
      intensity,
      survived,
      duration: DURATION - timeLeft
    };
    const updated = [entry, ...urgeLog].slice(0, 30);
    setUrgeLog(updated);
    ls.set("syn_urge_log", JSON.stringify(updated));
    reset();
  };
  const newTask = () => setTask(URGE_TASKS[Math.floor(Math.random() * URGE_TASKS.length)]);
  useEffect(() => () => clearInterval(intervalRef.current), []);
  const survived = urgeLog.filter(u => u.survived).length;
  const total = urgeLog.length;
  return <div style={{
    maxWidth: 600,
    margin: "0 auto",
    padding: "clamp(80px,12vw,120px) clamp(16px,5vw,40px) 40px"
  }}>

      {/* Header */}
      <div style={{
      marginBottom: 40
    }}>
        <div style={{
        fontSize: 10,
        letterSpacing: 3,
        color: "rgba(255,140,0,0.4)",
        textTransform: "uppercase",
        marginBottom: 12
      }}>
          ◆ URGE PROTOCOL
        </div>
        <h1 style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,7vw,44px)",
        fontWeight: 900,
        color: "#fff",
        lineHeight: 1.1,
        marginBottom: 12
      }}>
          SURF THE<br />WAVE
        </h1>
        <p style={{
        fontSize: 14,
        color: "rgba(255,255,255,0.35)",
        lineHeight: 1.7
      }}>
          Every urge peaks in 3–5 minutes and dies within 10. You don't fight it — you outlast it.
        </p>
      </div>

      {/* Stats bar */}
      {total > 0 && <div style={{
      display: "flex",
      gap: 12,
      marginBottom: 32,
      flexWrap: "wrap"
    }}>
          {[{
        label: "URGES LOGGED",
        val: total
      }, {
        label: "SURVIVED",
        val: survived
      }, {
        label: "WIN RATE",
        val: total > 0 ? Math.round(survived / total * 100) + "%" : "—"
      }].map(({
        label,
        val
      }) => <div key={label} style={{
        flex: 1,
        minWidth: 80,
        background: "rgba(255,140,0,0.05)",
        border: "1px solid rgba(255,140,0,0.12)",
        borderRadius: 12,
        padding: "12px 16px"
      }}>
              <div style={{
          fontSize: "clamp(18px,4vw,24px)",
          fontFamily: "'Orbitron',sans-serif",
          fontWeight: 700,
          color: "#ffb347"
        }}>{val}</div>
              <div style={{
          fontSize: 8,
          letterSpacing: 2,
          color: "rgba(255,255,255,0.25)",
          textTransform: "uppercase",
          marginTop: 4
        }}>{label}</div>
            </div>)}
        </div>}

      {/* Main card */}
      <div style={{
      background: "rgba(255,140,0,0.04)",
      border: "1px solid rgba(255,140,0,0.12)",
      borderRadius: 20,
      padding: "clamp(24px,6vw,40px)",
      marginBottom: 24
    }}>

        {/* IDLE STATE — intensity picker */}
        {!active && !done && <div>
            <div style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.4)",
          marginBottom: 20,
          lineHeight: 1.6
        }}>
              Rate the intensity of your urge right now:
            </div>
            <div style={{
          display: "flex",
          gap: 8,
          marginBottom: 28,
          flexWrap: "wrap"
        }}>
              {["MILD", "MODERATE", "INTENSE", "OVERWHELMING"].map(lvl => <button key={lvl} onClick={() => setIntensity(lvl)} style={{
            padding: "8px 16px",
            borderRadius: 999,
            fontSize: 10,
            letterSpacing: 1.5,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all .2s",
            textTransform: "uppercase",
            background: intensity === lvl ? "rgba(255,140,0,0.18)" : "transparent",
            border: `1px solid ${intensity === lvl ? "rgba(255,140,0,0.5)" : "rgba(255,255,255,0.1)"}`,
            color: intensity === lvl ? "#ffb347" : "rgba(255,255,255,0.3)",
            boxShadow: intensity === lvl ? "0 0 16px rgba(255,140,0,0.2)" : "none"
          }}>
                  {lvl}
                </button>)}
            </div>

            <button className="btn-primary" onClick={startTimer} disabled={!intensity} style={{
          width: "100%",
          fontSize: 13,
          padding: "16px",
          opacity: intensity ? 1 : 0.35,
          cursor: intensity ? "pointer" : "not-allowed"
        }}>
              START 10-MIN TIMER →
            </button>

            <div style={{
          marginTop: 16,
          fontSize: 12,
          color: "rgba(255,255,255,0.2)",
          textAlign: "center"
        }}>
              Research: 90% of urges fade within 10 minutes if you don't act on them.
            </div>
          </div>}

        {/* ACTIVE STATE — timer running */}
        {active && <div>
            {/* Phase label */}
            <div style={{
          textAlign: "center",
          marginBottom: 24
        }}>
              <div style={{
            fontSize: 10,
            letterSpacing: 3,
            color: phase.color,
            textTransform: "uppercase",
            marginBottom: 8,
            transition: "color .5s"
          }}>
                {phase.label}
              </div>
              <div style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.3)",
            lineHeight: 1.6
          }}>{phase.sub}</div>
            </div>

            {/* Big timer */}
            <div style={{
          textAlign: "center",
          marginBottom: 28
        }}>
              <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: "clamp(56px,18vw,96px)",
            fontWeight: 900,
            lineHeight: 1,
            color: phase.color,
            filter: `drop-shadow(0 0 30px ${phase.color}66)`,
            transition: "color .5s, filter .5s",
            letterSpacing: 4
          }}>
                {mins}:{secs}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{
          height: 4,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 999,
          marginBottom: 28,
          overflow: "hidden"
        }}>
              <div style={{
            height: "100%",
            borderRadius: 999,
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${phase.color}, ${phase.color}aa)`,
            transition: "width 1s linear, background .5s",
            boxShadow: `0 0 12px ${phase.color}88`
          }} />
            </div>

            {/* Task card */}
            {task && <div style={{
          background: "rgba(255,140,0,0.07)",
          border: "1px solid rgba(255,140,0,0.18)",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20
        }}>
                <div style={{
            fontSize: 9,
            letterSpacing: 2.5,
            color: "rgba(255,180,80,0.5)",
            textTransform: "uppercase",
            marginBottom: 8
          }}>◆ DO THIS NOW</div>
                <div style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.75)",
            lineHeight: 1.65,
            fontWeight: 500
          }}>{task}</div>
                <button onClick={newTask} style={{
            marginTop: 12,
            background: "none",
            border: "none",
            color: "rgba(255,140,0,0.4)",
            fontSize: 11,
            letterSpacing: 1.5,
            cursor: "pointer",
            textTransform: "uppercase",
            padding: 0
          }}>
                  Give me another →
                </button>
              </div>}

            {/* Slip button */}
            <button onClick={() => logUrge(false)} style={{
          width: "100%",
          background: "transparent",
          border: "1px solid rgba(255,50,50,0.15)",
          borderRadius: 12,
          padding: "12px",
          color: "rgba(255,80,80,0.35)",
          fontSize: 11,
          letterSpacing: 1.5,
          cursor: "pointer",
          textTransform: "uppercase"
        }}>
              I gave in — log this slip
            </button>
          </div>}

        {/* DONE STATE — survived */}
        {done && <div style={{
        textAlign: "center"
      }}>
            <div style={{
          fontSize: "clamp(48px,14vw,72px)",
          marginBottom: 16,
          filter: "drop-shadow(0 0 24px #4caf5088)"
        }}>✦</div>
            <div style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: "clamp(22px,6vw,32px)",
          fontWeight: 900,
          color: "#4caf50",
          marginBottom: 12
        }}>
              YOU HELD THE LINE
            </div>
            <p style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.4)",
          lineHeight: 1.7,
          marginBottom: 28
        }}>
              10 minutes. The urge is gone. Every time you do this, the neural pathway weakens. This is how recovery actually works.
            </p>
            <div style={{
          display: "flex",
          gap: 10,
          justifyContent: "center",
          flexWrap: "wrap"
        }}>
              <button className="btn-primary" onClick={() => logUrge(true)} style={{
            fontSize: 12,
            padding: "14px 28px"
          }}>
                LOG THIS WIN ✓
              </button>
              <button onClick={reset} style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: "14px 28px",
            color: "rgba(255,255,255,0.3)",
            fontSize: 12,
            cursor: "pointer"
          }}>
                Reset
              </button>
            </div>
          </div>}
      </div>

      {/* Recent log */}
      {urgeLog.length > 0 && <div>
          <div style={{
        fontSize: 10,
        letterSpacing: 2.5,
        color: "rgba(255,255,255,0.2)",
        textTransform: "uppercase",
        marginBottom: 14
      }}>Recent Urge Log</div>
          <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}>
            {urgeLog.slice(0, 5).map((u, i) => <div key={i} style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 10,
          padding: "10px 16px"
        }}>
                <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10
          }}>
                  <span style={{
              fontSize: 14,
              color: u.survived ? "#4caf50" : "#ff4040"
            }}>{u.survived ? "✓" : "✗"}</span>
                  <span style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.3)",
              textTransform: "uppercase",
              letterSpacing: 1
            }}>{u.intensity}</span>
                </div>
                <span style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.2)"
          }}>
                  {new Date(u.date).toLocaleDateString("en-IN", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })}
                </span>
              </div>)}
          </div>
        </div>}
    </div>;
}
function Plan({
  plan,
  loading,
  onBegin,
  onRetry
}) {
  const {
    displayed,
    done
  } = useTypewriter(plan, 11);
  const isError = !!plan && plan.startsWith("Connection error:");

  // PDF download via jsPDF — paginates automatically for long plans and
  // behaves identically across desktop/Android/iOS with no popup dependency.
  const downloadPlan = () => {
    const user = JSON.parse(ls.get("syn_user", "{}"));
    const arch = JSON.parse(ls.get("syn_archetype", "null"));
    const streak = parseInt(ls.get("syn_streak", "0")) || 0;
    const date = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    const archName = arch?.title || "WARRIOR";
    const cleanPlan = plan.replace(/\*\*(.+?)\*\*/g, "$1");
    const pdf = generatePlanPDF({
      name: user?.name,
      archName,
      streak,
      date,
      cleanPlan
    });
    pdf.save(`synapse-battle-plan-${date.replace(/\s+/g, "-")}.pdf`);
  };
  return <div style={{
    minHeight: "100vh",
    paddingTop: 80,
    position: "relative",
    overflowX: "hidden"
  }}>
      <div className="hero-pad" style={{
      padding: "clamp(60px,8vw,80px) clamp(20px,8vw,100px) clamp(40px,5vw,64px)",
      borderBottom: "1px solid rgba(255,140,0,0.07)",
      position: "relative",
      zIndex: 1
    }}>
        <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at 30% 60%, rgba(255,100,0,0.06) 0%, transparent 60%)",
        pointerEvents: "none"
      }} />
        <div className="tag s1" style={{
        marginBottom: 24
      }}><span className="d" />Recovery Protocol</div>
        <h2 className="s2 glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(32px,8vw,104px)",
        fontWeight: 800,
        lineHeight: .88,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent"
      }}>YOUR<br />MISSION.</h2>
      </div>
      <div className="content-pad" style={{
      maxWidth: 820,
      margin: "0 auto",
      padding: "clamp(40px,6vw,72px) clamp(16px,8vw,100px)",
      position: "relative",
      zIndex: 1
    }}>
        <div className="tag s1" style={{
        marginBottom: 32
      }}><span className="d" />Synapse Recovery Plan</div>
        {loading ? <div className="glass s2" style={{
        padding: 48
      }}>
            <Dots label="Building your personalized battle plan" />
            <div style={{
          marginTop: 24,
          height: 3,
          background: "rgba(255,140,0,0.06)",
          borderRadius: 2,
          overflow: "hidden",
          position: "relative"
        }}><div style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg,transparent,rgba(255,140,0,0.4),transparent)",
            animation: "shimmer 1.8s ease-in-out infinite"
          }} /></div>
          </div> : <div className="glass s2" style={{
        padding: 44,
        animation: "borderGlow 4s ease-in-out infinite"
      }}>
            <div style={{
          fontSize: 15,
          lineHeight: 2.15,
          color: "var(--text2)",
          fontWeight: 300,
          whiteSpace: "pre-wrap",
          borderLeft: "2px solid rgba(255,140,0,0.22)",
          paddingLeft: 28
        }}>
              {done ? parseBold(plan) : <>{parseBold(displayed)}<span style={{
              animation: "dotBlink .7s infinite",
              color: "#ff8c00"
            }}>█</span></>}
            </div>
            {done && (isError ? <div style={{
          marginTop: 40,
          paddingTop: 28,
          borderTop: "1px solid rgba(255,140,0,0.08)",
          animation: "fadeUp .6s ease both"
        }}><button className="btn-primary" onClick={onRetry} style={{
            fontSize: 14,
            padding: "16px 48px",
            background: "linear-gradient(135deg,#cc4400,#992200)"
          }}>← Back to Confess & Retry</button></div> : <div style={{
          marginTop: 40,
          paddingTop: 28,
          borderTop: "1px solid rgba(255,140,0,0.08)",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          animation: "fadeUp .6s ease both"
        }}>
                  <button className="btn-primary" onClick={() => onBegin(plan)} style={{
            fontSize: 14,
            padding: "16px 48px"
          }}>Begin Day 1 →</button>
                  <button onClick={downloadPlan} style={{
            background: "rgba(255,140,0,0.07)",
            border: "1px solid rgba(255,140,0,0.25)",
            color: "rgba(255,180,80,0.8)",
            padding: "16px 28px",
            borderRadius: 12,
            fontFamily: "'Inter',sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: .3,
            cursor: "pointer",
            transition: "all .3s",
            display: "flex",
            alignItems: "center",
            gap: 8
          }} onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,140,0,0.12)";
            e.currentTarget.style.borderColor = "rgba(255,140,0,0.45)";
          }} onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,140,0,0.07)";
            e.currentTarget.style.borderColor = "rgba(255,140,0,0.25)";
          }}>
                    <span>⬇</span><span>Download Plan</span>
                  </button>
                </div>)}
          </div>}
      </div>
    </div>;
}

/* ─── BATTLE PLAN ACCORDION ──────────────────────────────────────────────── */
function BattlePlanAccordion({
  plan
}) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  return <div style={{
    marginBottom: 32
  }}>
      <button onClick={() => setOpen(o => !o)} style={{
      width: "100%",
      background: "rgba(255,140,0,0.03)",
      border: "1px solid rgba(255,140,0,0.14)",
      borderRadius: 12,
      padding: "14px 22px",
      color: "rgba(255,180,80,0.6)",
      cursor: "pointer",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      transition: "all .3s",
      fontSize: 11,
      letterSpacing: 2,
      textTransform: "uppercase",
      fontFamily: "'Orbitron',sans-serif",
      fontWeight: 600
    }}>
        <span>📋 My Battle Plan</span>
        <span style={{
        fontSize: 16,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform .3s"
      }}>↓</span>
      </button>
      {open && <div className="glass" style={{
      padding: "28px 32px",
      borderRadius: "0 0 12px 12px",
      borderTop: "none",
      animation: "fadeUp .4s ease both"
    }}>
          <div style={{
        fontSize: 13,
        lineHeight: 2.1,
        color: "var(--text2)",
        fontWeight: 300,
        whiteSpace: "pre-wrap",
        borderLeft: "2px solid rgba(255,140,0,0.2)",
        paddingLeft: 20
      }}>{parseBold(plan)}</div>
        </div>}
    </div>;
}

/* ─── CHECKIN ────────────────────────────────────────────────────────────── */
/* ─── DAILY QUOTES ───────────────────────────────────────────────────────── */
const DAILY_QUOTES = [{
  q: "The first and greatest victory is to conquer yourself.",
  a: "Plato"
}, {
  q: "Discipline is the bridge between goals and accomplishment.",
  a: "Jim Rohn"
}, {
  q: "You don't rise to the level of your goals. You fall to the level of your systems.",
  a: "James Clear"
}, {
  q: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
  a: "Aristotle"
}, {
  q: "The cave you fear to enter holds the treasure you seek.",
  a: "Joseph Campbell"
}, {
  q: "Do not indulge in dreams of having what you have not, but count the blessings you actually possess.",
  a: "Marcus Aurelius"
}, {
  q: "Strength does not come from physical capacity. It comes from an indomitable will.",
  a: "Gandhi"
}, {
  q: "It does not matter how slowly you go as long as you do not stop.",
  a: "Confucius"
}, {
  q: "The mind is everything. What you think, you become.",
  a: "Buddha"
}, {
  q: "He who conquers himself is the mightiest warrior.",
  a: "Confucius"
}, {
  q: "What stands in the way becomes the way.",
  a: "Marcus Aurelius"
}, {
  q: "The impediment to action advances action. What stands in the way becomes the way.",
  a: "Marcus Aurelius"
}, {
  q: "You have power over your mind — not outside events. Realize this, and you will find strength.",
  a: "Marcus Aurelius"
}, {
  q: "Fall seven times, stand up eight.",
  a: "Japanese Proverb"
}, {
  q: "If you are going through hell, keep going.",
  a: "Winston Churchill"
}, {
  q: "The secret of getting ahead is getting started.",
  a: "Mark Twain"
}, {
  q: "Act as if what you do makes a difference. It does.",
  a: "William James"
}, {
  q: "The only way out is through.",
  a: "Robert Frost"
}, {
  q: "Energy and persistence conquer all things.",
  a: "Benjamin Franklin"
}, {
  q: "In the middle of difficulty lies opportunity.",
  a: "Albert Einstein"
}, {
  q: "One day or day one. You decide.",
  a: "Unknown"
}, {
  q: "Your future self is watching you right now through your memories.",
  a: "Aubrey Marcus"
}, {
  q: "Don't count the days. Make the days count.",
  a: "Muhammad Ali"
}, {
  q: "The two most powerful warriors are patience and time.",
  a: "Leo Tolstoy"
}, {
  q: "Success is the sum of small efforts repeated day in and day out.",
  a: "Robert Collier"
}, {
  q: "To improve is to change; to be perfect is to change often.",
  a: "Winston Churchill"
}, {
  q: "Hardships often prepare ordinary people for an extraordinary destiny.",
  a: "C.S. Lewis"
}, {
  q: "The harder the battle, the sweeter the victory.",
  a: "Les Brown"
}, {
  q: "Every moment is a fresh beginning.",
  a: "T.S. Eliot"
}, {
  q: "Doubt kills more dreams than failure ever will.",
  a: "Suzy Kassem"
}, {
  q: "Pain is temporary. Quitting lasts forever.",
  a: "Lance Armstrong"
}, {
  q: "Be so good they can't ignore you.",
  a: "Steve Martin"
}, {
  q: "The brain is plastic. Every clean day reshapes it.",
  a: "SYNAPSE"
}, {
  q: "Your dopamine system is healing right now. Trust the process.",
  a: "SYNAPSE"
}, {
  q: "Discipline now. Freedom forever.",
  a: "SYNAPSE"
}, {
  q: "Every urge you outlast is a neural pathway you starve.",
  a: "SYNAPSE"
}, {
  q: "The soldier who shows up every day wins the war.",
  a: "SYNAPSE"
}];
const getDailyQuote = () => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
};

/* ─── CHECKIN COUNTDOWN ──────────────────────────────────────────────────── */
function CheckinCountdown() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const diff = Math.max(0, midnight - now);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor(diff % 3600000 / 60000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  return <strong style={{
    color: "var(--accent2)",
    fontWeight: 700
  }}>{label}</strong>;
}
function Checkin({
  streak,
  savedPlan,
  lastCheckin,
  onCheckin,
  onGoChat
}) {
  // Load saved confess data (addictions + baseline values)
  const confessData = useMemo(() => {
    try {
      return JSON.parse(ls.get("syn_confess", "null"));
    } catch {
      return null;
    }
  }, []);
  const addictions = confessData?.addictions || [];

  // Per-addiction status: "clean" | "partial" | "slip"
  const [adStatus, setAdStatus] = useState(() => Object.fromEntries(addictions.map(a => [a.id, "clean"])));
  // Per-addiction actual usage today (for partial/slip)
  const [adUsage, setAdUsage] = useState(() => Object.fromEntries(addictions.map(a => [a.id, 0])));
  // Per-addiction trigger tags (only relevant for partial/slip)
  const [adTriggers, setAdTriggers] = useState(() => Object.fromEntries(addictions.map(a => [a.id, []])));
  // Per-addiction time of day it happened
  const [adTimeOfDay, setAdTimeOfDay] = useState(() => Object.fromEntries(addictions.map(a => [a.id, []])));
  // Overall mood
  const [mood, setMood] = useState(null);
  // Optional notes
  const [notes, setNotes] = useState("");
  const [notesFocused, setNotesFocused] = useState(false);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState(() => {
    const today = new Date().toDateString();
    if (lastCheckin !== today) return null;
    try {
      const h = JSON.parse(ls.get("syn_history", "[]"));
      const e = h.find(e => e.date === today);
      return e ? e.status.toUpperCase() : null;
    } catch {
      return null;
    }
  });
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entered, setEntered] = useState(false);
  // Inline follow-up chat after AI responds
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const isFirstChatRender = useRef(true);
  const bottomRef = useRef(null);
  const chatBottomRef = useRef(null);
  const today = new Date().toDateString();
  const done = lastCheckin === today;
  const lv = getLevel(streak);
  const nx = getNextLvl(streak);
  const xp = nx ? Math.min(100, (streak - lv.minDays) / (nx.minDays - lv.minDays) * 100) : 100;
  function getGaugePosition(streak) {
    const next = getNextLvl(streak);
    if (!next) return 1;
    const current = getLevel(streak);
    const currMin = Math.sqrt(current.minDays);
    const nextMin = Math.sqrt(next.minDays);
    const streakSqrt = Math.sqrt(streak);
    return (streakSqrt - currMin) / (nextMin - currMin);
  }
  useEffect(() => {
    setTimeout(() => setEntered(true), 60);
  }, []);
  useEffect(() => {
    if (reply) bottomRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [reply]);
  useEffect(() => {
    if (isFirstChatRender.current) {
      isFirstChatRender.current = false;
      return;
    }
    chatBottomRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [chatMsgs, chatLoading]);
  const MOODS = [{
    id: "strong",
    label: "💪 Strong",
    desc: "Felt in control"
  }, {
    id: "held",
    label: "😤 Held firm",
    desc: "Tough but managed"
  }, {
    id: "struggled",
    label: "😔 Struggled",
    desc: "Close calls today"
  }, {
    id: "rough",
    label: "💀 Rough day",
    desc: "Really hard"
  }];
  const TRIGGERS = [{
    id: "bored",
    label: "😑 Bored"
  }, {
    id: "stressed",
    label: "😰 Stressed"
  }, {
    id: "lonely",
    label: "🫤 Lonely"
  }, {
    id: "alone_room",
    label: "🚪 Alone in room"
  }, {
    id: "phone_bed",
    label: "📱 Phone in bed"
  }, {
    id: "after_argument",
    label: "💢 After argument"
  }, {
    id: "tired",
    label: "😴 Tired / late night"
  }, {
    id: "social_media",
    label: "📲 Saw it on social media"
  }, {
    id: "friends_around",
    label: "👥 Around certain friends"
  }, {
    id: "failure",
    label: "📉 Felt like a failure"
  }, {
    id: "free_time",
    label: "⏳ Too much free time"
  }, {
    id: "habit_cue",
    label: "🔁 Just a habit / autopilot"
  }];
  const TIME_SLOTS = [{
    id: "morning",
    label: "🌅 Morning"
  }, {
    id: "afternoon",
    label: "☀️ Afternoon"
  }, {
    id: "evening",
    label: "🌆 Evening"
  }, {
    id: "late_night",
    label: "🌙 Late Night"
  }];
  const toggleTrigger = (addictionId, triggerId) => {
    setAdTriggers(prev => {
      const current = prev[addictionId] || [];
      const next = current.includes(triggerId) ? current.filter(t => t !== triggerId) : [...current, triggerId];
      return {
        ...prev,
        [addictionId]: next
      };
    });
  };

  // Build structured report for AI
  const buildReport = () => {
    const adLines = addictions.map(a => {
      const s = adStatus[a.id];
      const goal = a.isFreq ? `Goal: 0x/week` : `Goal: 0h/day`;
      const baseline = a.isFreq ? `Baseline: ${a.value}x/week` : `Baseline: ${a.value}h/day`;
      const usage = adUsage[a.id];
      if (s === "clean") return `${a.emoji} ${a.label}: CLEAN ✓ (${goal}, ${baseline})`;
      const usageStr = a.isFreq ? `${usage}x today` : `${usage}h today`;
      const triggerIds = adTriggers[a.id] || [];
      const triggerStr = triggerIds.length ? ` | Triggers: ${triggerIds.map(t => TRIGGERS.find(tr => tr.id === t)?.label.replace(/^\S+\s/, "") || t).join(", ")}` : "";
      const timeIds = adTimeOfDay[a.id] || [];
      const timeStr = timeIds.length ? ` | When: ${timeIds.map(id => TIME_SLOTS.find(t => t.id === id)?.label.replace(/^\S+\s/, "") || id).join(", ")}` : "";
      return `${a.emoji} ${a.label}: ${s === "partial" ? "PARTIAL ~" : "SLIPPED ✗"} (${usageStr}, ${goal}, ${baseline}${triggerStr}${timeStr})`;
    }).join("\n");
    const moodLine = mood ? `\nOverall mood: ${MOODS.find(m => m.id === mood)?.label || mood}` : "";
    const notesLine = notes.trim() ? `\nAdditional notes: ${notes.trim()}` : "";
    return `Day ${streak + 1} structured check-in:\n\n${adLines}${moodLine}${notesLine}`;
  };

  // Save raw trigger data to a separate localStorage log for long-term pattern detection
  const logTriggerData = () => {
    try {
      const log = JSON.parse(ls.get("syn_trigger_log", "[]"));
      const entry = {
        date: new Date().toDateString(),
        mood,
        addictions: addictions.filter(a => adStatus[a.id] !== "clean").map(a => ({
          id: a.id,
          label: a.label,
          status: adStatus[a.id],
          usage: adUsage[a.id],
          triggers: adTriggers[a.id] || [],
          timeOfDay: adTimeOfDay[a.id]
        }))
      };
      log.push(entry);
      ls.set("syn_trigger_log", JSON.stringify(log.slice(-90))); // keep last 90 days
    } catch {}
  };

  // Deterministic WIN / MID / SLIP verdict — computed from the user's own
  // explicit per-addiction answers (the clean/partial/slip pills above),
  // not guessed by the AI from free text. This is the actual source of
  // truth passed to handleCheckin; the AI only writes the coaching tone
  // for whichever verdict this produces, it doesn't get to overrule it.
  //   - Any addiction marked "slip"     -> SLIP
  //   - Else any addiction marked "partial" -> MID
  //   - All addictions "clean" (or none tracked) -> WIN
  const computeStatus = () => {
    if (addictions.length === 0) return "WIN";
    const statuses = addictions.map(a => adStatus[a.id]);
    if (statuses.some(s => s === "slip")) return "SLIP";
    if (statuses.some(s => s === "partial")) return "MID";
    return "WIN";
  };
  const liveVerdict = addictions.length > 0 ? computeStatus() : null;
  const VERDICT_DISPLAY = {
    WIN: {
      label: "WIN",
      icon: "✅",
      color: "#88ff44"
    },
    MID: {
      label: "MID",
      icon: "🟡",
      color: "#ffcc00"
    },
    SLIP: {
      label: "SLIP",
      icon: "🔴",
      color: "#ff5555"
    }
  };
  const submit = async () => {
    if (done || !mood) return;
    setLoading(true);
    const report = buildReport();
    const computedStatus = computeStatus();
    logTriggerData();
    const result = await onCheckin(report, computedStatus);
    setReply(result.reply);
    setStatus(result.status);
    setLoading(false);
    // Seed shared chat history with today's structured report + AI's response,
    // so the full Coach screen (and tomorrow's checkin) has full context.
    if (result.status !== "CRISIS") {
      appendChatHistory({
        role: "user",
        text: report
      }, {
        role: "ai",
        text: result.reply
      });
    }
  };
  const sendChat = async () => {
    const txt = chatInput.trim();
    if (!txt || chatLoading) return;
    setChatInput("");
    setChatMsgs(m => [...m, {
      role: "user",
      text: txt
    }]);
    if (detectCrisis(txt)) {
      setChatMsgs(m => [...m, {
        role: "ai",
        text: CRISIS_RESPONSE,
        crisis: true
      }]);
      appendChatHistory({
        role: "user",
        text: txt
      }, {
        role: "ai",
        text: CRISIS_RESPONSE,
        crisis: true
      });
      return;
    }
    // AI safety classifier for indirect language
    setChatLoading(true);
    const aiRisk = await checkSafetyRisk(txt);
    if (aiRisk) {
      setChatMsgs(m => [...m, {
        role: "ai",
        text: CRISIS_RESPONSE,
        crisis: true
      }]);
      appendChatHistory({
        role: "user",
        text: txt
      }, {
        role: "ai",
        text: CRISIS_RESPONSE,
        crisis: true
      });
      setChatLoading(false);
      return;
    }
    try {
      // Archetype + recurring trigger pattern context — shared with handleCheckin
      // and the full Coach screen so this inline chat has the same "memory".
      const coachCtx = getCoachContext();
      // Pull full shared history for context — includes today's report, past days, everything
      const sharedHistory = loadChatHistory();
      const ctx = [{
        role: "user",
        content: savedPlan + coachCtx
      }, {
        role: "assistant",
        content: "Your mission begins now."
      }, ...sharedHistory.slice(-12).map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      })), {
        role: "user",
        content: txt
      }];
      const r = await callAI(ctx, withTone(SYSTEM_CHAT));
      const aiText = r.startsWith("[OFF_TOPIC]") ? "That's outside my scope — I only coach on recovery topics. What's on your mind about your mission?" : r;
      setChatMsgs(m => [...m, {
        role: "ai",
        text: aiText
      }]);
      appendChatHistory({
        role: "user",
        text: txt
      }, {
        role: "ai",
        text: aiText
      });
    } catch (e) {
      if (e.isRateLimit) {
        setChatMsgs(m => [...m, {
          role: "ai",
          upgradePrompt: true,
          text: e.message
        }]);
      } else {
        setChatMsgs(m => [...m, {
          role: "ai",
          text: "Connection issue — try again."
        }]);
      }
    }
    setChatLoading(false);
  };
  const canSubmit = mood && !done && !loading;
  return <div style={{
    minHeight: "100vh",
    paddingTop: 80,
    position: "relative",
    overflowX: "hidden"
  }}>
      {/* Hero streak */}
      <div className="hero-pad" style={{
      padding: "clamp(60px,8vw,80px) clamp(20px,8vw,100px) clamp(40px,5vw,64px)",
      borderBottom: document.documentElement.classList.contains("light") ? "1px solid rgba(192,225,210,0.4)" : "1px solid rgba(255,140,0,0.07)",
      position: "relative",
      zIndex: 1,
      minHeight: "52vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end"
    }}>
        <div style={{
        position: "absolute",
        inset: 0,
        background: document.documentElement.classList.contains("light") ? `radial-gradient(ellipse at 65% 55%, rgba(${lv.hex},0.07) 0%, transparent 60%)` : `radial-gradient(ellipse at 65% 55%, rgba(${lv.hex},0.12) 0%, transparent 60%)`,
        pointerEvents: "none",
        transition: "background 1s"
      }} />
        {[100, 180, 260].map((s, i) => <div key={i} style={{
        position: "absolute",
        top: "45%",
        right: "30%",
        width: s,
        height: s,
        borderRadius: "50%",
        border: `1px solid rgba(${lv.hex},0.2)`,
        animation: `ringOut ${3.5 + i * .8}s ease-out ${i * .6}s infinite`,
        pointerEvents: "none"
      }} />)}
        <div style={{
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0)" : "translateY(24px)",
        transition: "all .9s cubic-bezier(.16,1,.3,1)",
        position: "relative",
        zIndex: 2
      }}>
          <div className="ci-badgerow" style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
          flexWrap: "wrap"
        }}>
            <div className="tag"><span className="d" />Current Streak</div>
            {(() => {
            try {
              const arch = JSON.parse(ls.get("syn_archetype", "null"));
              if (!arch) return null;
              const ad = ARCHETYPES.find(a => a.id === arch.id);
              return <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: `rgba(${ad?.accentRgb || "255,140,0"},0.08)`,
                border: `1px solid rgba(${ad?.accentRgb || "255,140,0"},0.22)`,
                borderRadius: 999,
                padding: "5px 14px"
              }}><span style={{
                  fontSize: 13
                }}>{arch.id === "sovereign" ? "♛" : arch.id === "arbiter" ? "⚖" : arch.id === "stoic" ? "🌳" : "▲"}</span><span style={{
                  fontSize: 10,
                  letterSpacing: 1.5,
                  fontWeight: 600,
                  color: `rgba(${ad?.accentRgb || "255,180,80"},0.75)`,
                  textTransform: "uppercase"
                }}>{arch.title}</span></div>;
            } catch {
              return null;
            }
          })()}
          </div>
          <div className="ci-num" style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: "clamp(72px,16vw,200px)",
          fontWeight: 800,
          lineHeight: .85,
          color: "var(--text)",
          marginBottom: 12,
          textShadow: document.documentElement.classList.contains("light") ? `0 2px 0 rgba(0,0,0,0.08),0 0 40px rgba(${lv.hex},0.1)` : `0 0 80px rgba(${lv.hex},0.25)`,
          transition: "text-shadow 1s"
        }}><AnimatedNumber target={streak} /></div>           <div className="ci-daysclean" style={{
          fontSize: 11,
          letterSpacing: 5,
          color: document.documentElement.classList.contains("light") ? "rgba(26,26,26,0.6)" : "var(--text3)",
          textTransform: "uppercase",
          marginBottom: 24,
          fontWeight: 600
        }}>Days Clean</div>
          <div className="ci-level" style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          background: `rgba(${lv.hex},0.09)`,
          border: `1px solid rgba(${lv.hex},0.3)`,
          borderRadius: 999,
          padding: "9px 22px",
          marginBottom: 32,
          transition: "all .8s"
        }}>
            <div style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: lv.color,
            boxShadow: `0 0 12px ${lv.color}`,
            transition: "all .8s"
          }} />
            <span style={{
            fontSize: 11,
            letterSpacing: 2,
            color: document.documentElement.classList.contains("light") ? lv.color.replace("0.", "0.9") : lv.color,
            textTransform: "uppercase",
            fontWeight: 700,
            transition: "color .8s"
          }}>Level {lv.level} — {lv.title}</span>
          </div>
          <div className="ci-progress" style={{
          maxWidth: 480,
          margin: "0 auto"
        }}>
            <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            fontSize: 10,
            color: document.documentElement.classList.contains("light") ? "rgba(26,26,26,0.45)" : "var(--text4)",
            letterSpacing: 1,
            textTransform: "uppercase",
            marginBottom: 10,
            fontWeight: 500
          }}><span>{lv.title}</span><span>{nx ? `${streak} / ${nx.minDays} days` : "MAX LEVEL REACHED"}</span></div>
            <div style={{
            height: 4,
            background: document.documentElement.classList.contains("light") ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.05)",
            borderRadius: 2,
            overflow: "hidden"
          }}><div style={{
              height: "100%",
              borderRadius: 2,
              background: `linear-gradient(90deg,${lv.color}cc,${lv.color})`,
              boxShadow: `0 0 14px ${lv.color}80`,
              width: `${xp}%`,
              transition: "width 1.6s cubic-bezier(.16,1,.3,1) .3s"
            }} /></div>
          </div>
        </div>
      </div>

      <div className="ci-body" style={{
      maxWidth: 820,
      margin: "0 auto",
      padding: "clamp(32px,5vw,60px) clamp(16px,8vw,100px)",
      position: "relative",
      zIndex: 1
    }}>
        {/* Daily Quote */}
        {(() => {
        const dq = getDailyQuote();
        return <div className="ci-quote" style={{
          marginBottom: 28,
          padding: "18px 24px",
          borderRadius: 12,
          background: "var(--accent3)",
          border: "1px solid var(--border)",
          position: "relative",
          overflow: "hidden"
        }}>
            <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 3,
            height: "100%",
            background: "linear-gradient(180deg,rgba(255,140,0,0.6),rgba(255,80,0,0.2))",
            borderRadius: "3px 0 0 3px"
          }} />
            <div style={{
            fontSize: 9,
            letterSpacing: 2.5,
            color: "var(--accent)",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 8,
            paddingLeft: 4
          }}>⚡ Today's Signal</div>
            <div style={{
            fontSize: 13,
            lineHeight: 1.75,
            color: "var(--text2)",
            fontWeight: 300,
            fontStyle: "italic",
            paddingLeft: 4,
            marginBottom: 6
          }}>"{dq.q}"</div>
            <div style={{
            fontSize: 10,
            color: "var(--text4)",
            letterSpacing: 1,
            paddingLeft: 4
          }}>— {dq.a}</div>
          </div>;
      })()}

        {!done ? <>
            {/* Check-in countdown — visual reminder of the daily deadline.
                Mirrors the actual streak-break rule in App: miss a full
                calendar day with no check-in and no lifeline, streak resets. */}
            <div className="ci-reminder" style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderRadius: 12,
          background: "rgba(255,140,0,0.05)",
          border: "1px solid rgba(255,140,0,0.15)"
        }}>
              <span style={{
            fontSize: 16
          }}>⏳</span>
              <span style={{
            fontSize: 12,
            color: "var(--text2)"
          }}>
                <CheckinCountdown /> left to check in {streak > 0 ? "and keep your streak alive" : "and start your streak"}
              </span>
            </div>

            {/* Section: Addiction Cards */}
            {addictions.length > 0 && <div style={{
          marginBottom: 28
        }}>
                <div className="tag" style={{
            marginBottom: 16,
            display: "inline-flex"
          }}><span className="d" />Your Missions — How did today go?</div>
                <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 12
          }}>
                  {addictions.map(a => {
              const s = adStatus[a.id];
              const goalStr = a.isFreq ? `Goal: 0x/week • Baseline: ${a.value}x/week` : `Goal: 0h/day • Baseline: ${a.value}h/day`;
              const maxVal = a.isFreq ? Math.max(a.value * 2, 10) : Math.max(a.value * 2, 12);
              const rgb = a.color.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)).join(',') || "255,140,0";
              return <div key={a.id} className="glass" style={{
                padding: "18px 22px",
                border: `1px solid ${s === "clean" ? "rgba(136,255,68,0.2)" : s === "partial" ? "rgba(255,200,0,0.2)" : "rgba(255,80,80,0.2)"}`,
                transition: "border-color .3s"
              }}>
                        <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  flexWrap: "wrap",
                  gap: 8
                }}>
                          <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                            <span style={{
                      fontSize: 22
                    }}>{a.emoji}</span>
                            <div>
                              <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text)"
                      }}>{a.label}</div>
                              <div style={{
                        fontSize: 10,
                        color: "var(--text4)",
                        marginTop: 1
                      }}>{goalStr}</div>
                            </div>
                          </div>
                          {/* Status pills */}
                          <div style={{
                    display: "flex",
                    gap: 6
                  }}>
                            {[["clean", "✓ Clean", "rgba(136,255,68,"], ["partial", "~ Partial", "rgba(255,200,0,"], ["slip", "✗ Slipped", "rgba(255,80,80,"]].map(([id, label, c]) => <button key={id} onClick={() => setAdStatus(p => ({
                      ...p,
                      [a.id]: id
                    }))} style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: `1px solid ${s === id ? c + "0.6)" : c + "0.15)"}`,
                      background: s === id ? c + "0.12)" : "transparent",
                      color: s === id ? c + "0.9)" : c + "0.4)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: .5,
                      transition: "all .2s"
                    }}>
                                {label}
                              </button>)}
                          </div>
                        </div>
                        {/* Usage slider — only on partial/slip */}
                        {(s === "partial" || s === "slip") && <div style={{
                  marginTop: 8,
                  padding: "12px 16px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.06)"
                }}>
                            <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8
                  }}>
                              <span style={{
                      fontSize: 10,
                      color: "var(--text3)"
                    }}>How much today?</span>
                              <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--accent)",
                      fontFamily: "'JetBrains Mono',monospace"
                    }}>{adUsage[a.id]}{a.isFreq ? "x" : "h"}</span>
                            </div>
                            <input type="range" min={0} max={maxVal} step={a.isFreq ? 1 : 0.5} value={adUsage[a.id]} onChange={e => setAdUsage(p => ({
                    ...p,
                    [a.id]: parseFloat(e.target.value)
                  }))} style={{
                    width: "100%",
                    accentColor: a.color,
                    height: 3
                  }} />
                            <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 9,
                    color: "var(--text4)",
                    marginTop: 4
                  }}>
                              <span>0{a.isFreq ? "x" : "h"}</span><span>{maxVal}{a.isFreq ? "x" : "h"}</span>
                            </div>

                            {/* Time of day picker */}
                            <div style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(255,255,255,0.05)"
                  }}>
                              <div style={{
                      fontSize: 10,
                      color: "var(--text3)",
                      marginBottom: 8
                    }}>When did it happen? <span style={{
                        opacity: .6
                      }}>(pick any)</span></div>
                              <div style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap"
                    }}>
                                {TIME_SLOTS.map(t => {
                        const sel = (adTimeOfDay[a.id] || []).includes(t.id);
                        return <button key={t.id} onClick={() => setAdTimeOfDay(p => {
                          const cur = p[a.id] || [];
                          const next = cur.includes(t.id) ? cur.filter(x => x !== t.id) : [...cur, t.id];
                          return {
                            ...p,
                            [a.id]: next
                          };
                        })} style={{
                          padding: "5px 11px",
                          borderRadius: 999,
                          border: `1px solid ${sel ? "rgba(255,140,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                          background: sel ? "rgba(255,140,0,0.1)" : "transparent",
                          color: sel ? "var(--accent2)" : "var(--text3)",
                          fontSize: 10,
                          fontWeight: 500,
                          transition: "all .2s"
                        }}>
                                    {t.label}
                                  </button>;
                      })}
                              </div>
                            </div>

                            {/* Trigger tags */}
                            <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(255,255,255,0.05)"
                  }}>
                              <div style={{
                      fontSize: 10,
                      color: "var(--text3)",
                      marginBottom: 8
                    }}>What triggered it? <span style={{
                        opacity: .5
                      }}>(pick any)</span></div>
                              <div style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap"
                    }}>
                                {TRIGGERS.map(t => {
                        const active = (adTriggers[a.id] || []).includes(t.id);
                        return <button key={t.id} onClick={() => toggleTrigger(a.id, t.id)} style={{
                          padding: "5px 11px",
                          borderRadius: 999,
                          border: `1px solid ${active ? "rgba(255,140,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                          background: active ? "rgba(255,140,0,0.1)" : "transparent",
                          color: active ? "var(--accent2)" : "var(--text3)",
                          fontSize: 10,
                          fontWeight: 500,
                          transition: "all .2s"
                        }}>
                                      {t.label}
                                    </button>;
                      })}
                              </div>
                            </div>
                          </div>}
                      </div>;
            })}
                </div>
                {/* Live verdict — transparently shows what today will be logged as,
                    computed deterministically from the statuses picked above. */}
                <div style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 10,
            background: `${VERDICT_DISPLAY[liveVerdict].color}14`,
            border: `1px solid ${VERDICT_DISPLAY[liveVerdict].color}40`
          }}>
                  <span style={{
              fontSize: 14
            }}>{VERDICT_DISPLAY[liveVerdict].icon}</span>
                  <span style={{
              fontSize: 11,
              letterSpacing: 1,
              color: VERDICT_DISPLAY[liveVerdict].color,
              fontWeight: 700
            }}>TODAY'S VERDICT: {VERDICT_DISPLAY[liveVerdict].label}</span>
                  <span style={{
              fontSize: 10,
              color: "var(--text4)",
              marginLeft: 4
            }}>— based on your answers above</span>
                </div>
              </div>}

            {/* Section: Mood */}
            <div style={{
          marginBottom: 28
        }}>
              <div className="tag" style={{
            marginBottom: 16,
            display: "inline-flex"
          }}><span className="d" />Overall — How are you feeling?</div>
              <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 10
          }}>
                {MOODS.map(m => <button key={m.id} onClick={() => setMood(m.id)} style={{
              padding: "14px 16px",
              borderRadius: 12,
              border: `1px solid ${mood === m.id ? "rgba(255,140,0,0.5)" : "var(--border)"}`,
              background: mood === m.id ? "var(--accent3)" : "var(--surface2)",
              textAlign: "left",
              transition: "all .2s"
            }}>
                    <div style={{
                fontSize: 15,
                marginBottom: 4
              }}>{m.label}</div>
                    <div style={{
                fontSize: 11,
                color: "var(--text2)"
              }}>{m.desc}</div>
                  </button>)}
              </div>
            </div>

            {/* Section: Optional notes */}
            <div style={{
          marginBottom: 28
        }}>
              <div className="tag" style={{
            marginBottom: 14,
            display: "inline-flex"
          }}><span className="d" />Anything else? <span style={{
              opacity: .5,
              marginLeft: 6,
              fontStyle: "italic",
              textTransform: "none",
              letterSpacing: 0
            }}>optional</span></div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} onFocus={() => setNotesFocused(true)} onBlur={() => setNotesFocused(false)} placeholder="What made today hard? What helped? Anything SYNAPSE should know..." rows={3} style={{
            width: "100%",
            background: "var(--input-bg)",
            border: `1px solid ${notesFocused ? "var(--border3)" : "var(--border)"}`,
            borderRadius: 10,
            color: "var(--text)",
            fontFamily: "'Inter',sans-serif",
            fontSize: 13,
            fontWeight: 300,
            padding: "14px 16px",
            outline: "none",
            resize: "none",
            lineHeight: 1.75,
            transition: "all .3s",
            caretColor: "var(--accent)"
          }} />
            </div>

            {/* Battle Plan accordion + download */}
            {savedPlan && <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 28
        }}>
              <div style={{
            flex: 1
          }}><BattlePlanAccordion plan={savedPlan} /></div>
              <button onClick={() => {
            const user = JSON.parse(ls.get("syn_user", "{}"));
            let soldierName = user.name || "";
            if (!soldierName || soldierName === "Anonymous") {
              soldierName = window.prompt("Enter your name for the file:", "")?.trim() || "Soldier";
              if (soldierName && soldierName !== "Soldier") {
                ls.set("syn_user", JSON.stringify({
                  ...user,
                  name: soldierName
                }));
              }
            }
            const arch = JSON.parse(ls.get("syn_archetype", "null"));
            const streakVal = parseInt(ls.get("syn_streak", "0")) || 0;
            const date = new Date().toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric"
            });
            const archName = arch?.title || "WARRIOR";
            const cleanPlan = savedPlan.replace(/\*\*(.+?)\*\*/g, "$1");
            // Same PDF generator used on the Plan screen — paginates
            // automatically, no popup/print dependency.
            const pdf = generatePlanPDF({
              name: soldierName,
              archName,
              streak: streakVal,
              date,
              cleanPlan
            });
            pdf.save(`synapse-battle-plan-${date.replace(/\s+/g, "-")}.pdf`);
          }} style={{
            flexShrink: 0,
            background: "var(--accent3)",
            border: "1px solid var(--border)",
            color: "var(--accent2)",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all .25s",
            whiteSpace: "nowrap"
          }}><Download size={14} style={{
              display: "inline",
              marginRight: 4
            }} />Plan</button>
            </div>}

            {/* Submit button */}
            <button onClick={submit} disabled={!canSubmit} style={{
          width: "100%",
          background: canSubmit ? "linear-gradient(135deg,#ff9500,#ff5000)" : "rgba(255,140,0,0.06)",
          border: canSubmit ? "none" : "1px solid rgba(255,140,0,0.12)",
          color: canSubmit ? "#fff" : "rgba(255,255,255,0.2)",
          padding: "18px",
          borderRadius: 14,
          fontFamily: "'Orbitron',sans-serif",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 1,
          transition: "all .3s",
          boxShadow: canSubmit ? "0 0 40px rgba(255,140,0,0.35)" : "none",
          marginBottom: 8
        }}>
              {loading ? "Synapse is reading your day..." : !mood ? "Select your mood to submit" : "Submit Day " + (streak + 1) + " Report ⚡"}
            </button>
            {!mood && <div style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--text4)",
          marginBottom: 8
        }}>Select how you're feeling above to unlock submit</div>}
          </> : <>
            {/* Done state — show results */}
            {status === "CRISIS" && reply ? <div className="glass" style={{
          padding: "clamp(24px,5vw,44px)",
          marginBottom: 20,
          border: "1px solid rgba(100,180,255,0.25)",
          background: "linear-gradient(135deg,rgba(70,150,255,0.07),rgba(40,100,255,0.03))",
          animation: "fadeUp .6s ease both"
        }}>
                <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18
          }}><span style={{
              fontSize: 20
            }}>🤝</span><span style={{
              fontSize: 10,
              letterSpacing: 2.5,
              color: "rgba(140,200,255,0.7)",
              textTransform: "uppercase",
              fontWeight: 600
            }}>A moment, soldier</span></div>
                <p style={{
            fontSize: 14,
            lineHeight: 2.1,
            color: "var(--text)",
            fontWeight: 300,
            whiteSpace: "pre-wrap"
          }}>{parseBold(reply)}</p>
              </div> : null}
            {status === "WIN" && <div className="glass" style={{
          padding: "clamp(24px,5vw,52px) clamp(16px,4vw,48px)",
          textAlign: "center",
          marginBottom: 16,
          background: "linear-gradient(135deg,rgba(255,140,0,0.08),rgba(255,80,0,0.04))"
        }}><div style={{
            fontSize: 48,
            marginBottom: 16
          }}>🔥</div><h3 style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 36,
            fontWeight: 800,
            background: "linear-gradient(135deg,#ff9500,#ffcc00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 8,
            letterSpacing: -1
          }}>MISSION COMPLETE</h3><p style={{
            fontSize: 13,
            color: "var(--text3)",
            letterSpacing: 1
          }}>Day {streak} locked in. Your brain rewired a little more today.</p></div>}
            {status === "SLIP" && <div className="glass" style={{
          padding: "clamp(24px,5vw,52px) clamp(16px,4vw,48px)",
          textAlign: "center",
          marginBottom: 16,
          background: "linear-gradient(135deg,rgba(255,50,50,0.07),rgba(200,20,20,0.03))",
          border: "1px solid rgba(255,80,80,0.2)"
        }}><div style={{
            fontSize: 48,
            marginBottom: 16
          }}>⚔️</div><h3 style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 32,
            fontWeight: 800,
            color: "#ff4444",
            marginBottom: 8,
            letterSpacing: -1
          }}>STREAK RESET</h3><p style={{
            fontSize: 13,
            color: "var(--text3)",
            letterSpacing: .5,
            lineHeight: 1.8
          }}>Every soldier falls. The ones who win are the ones who get back up.<br /><span style={{
              color: "rgba(255,140,0,0.5)"
            }}>Your mission doesn't end here — it restarts.</span></p></div>}
            {reply && <div className="glass" style={{
          padding: "36px 40px",
          marginBottom: 16,
          position: "relative",
          animation: "fadeUp .6s ease both",
          border: `1px solid ${status === "WIN" ? "rgba(255,140,0,0.18)" : status === "SLIP" ? "rgba(255,80,80,0.18)" : "rgba(255,200,0,0.15)"}`
        }}><div style={{
            position: "absolute",
            top: -14,
            left: 28,
            background: "var(--bg)",
            padding: "0 12px"
          }}><div className="tag" style={{
              fontSize: 9,
              padding: "5px 12px",
              borderColor: status === "SLIP" ? "rgba(255,80,80,0.3)" : "rgba(255,140,0,0.18)"
            }}><span className="d" style={{
                background: status === "WIN" ? "#ff8c00" : status === "SLIP" ? "#ff4444" : "#ffcc00",
                boxShadow: `0 0 7px ${status === "WIN" ? "#ff8c00" : status === "SLIP" ? "#ff4444" : "#ffcc00"}`
              }} />{status === "WIN" ? "Synapse — Coach Response" : status === "SLIP" ? "Synapse — Get Back Up" : "Synapse — Keep Fighting"}</div></div><p style={{
            fontSize: 14,
            lineHeight: 2.1,
            color: "var(--text2)",
            fontWeight: 300,
            whiteSpace: "pre-wrap"
          }}>{parseBold(reply)}</p></div>}

            {/* Inline follow-up chat */}
            {reply && status !== "CRISIS" && <div style={{
          marginBottom: 16,
          animation: "fadeUp .6s ease .2s both"
        }}>
                <div className="tag" style={{
            marginBottom: 14,
            display: "inline-flex"
          }}><span className="d" />Continue with Coach</div>
                {chatMsgs.map((m, i) => <div key={i} style={{
            display: "flex",
            justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            marginBottom: 12,
            animation: "fadeUp .4s ease both"
          }}>
                    {m.role !== "user" && <div style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: m.crisis ? "rgba(70,150,255,.12)" : "rgba(255,140,0,.1)",
              border: `1px solid ${m.crisis ? "rgba(100,180,255,.3)" : "rgba(255,140,0,.2)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginRight: 8,
              marginTop: 2,
              fontSize: 11
            }}>{m.crisis ? "🤝" : "⚡"}</div>}
                    <div style={{
              maxWidth: "80%",
              padding: "11px 16px",
              borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: m.role === "user" ? "linear-gradient(135deg,rgba(255,140,0,.16),rgba(255,80,0,.1))" : m.crisis ? "linear-gradient(135deg,rgba(70,150,255,.08),rgba(40,100,255,.04))" : "var(--surface3)",
              border: `1px solid ${m.role === "user" ? "rgba(255,140,0,.22)" : m.crisis ? "rgba(100,180,255,.22)" : "var(--border2)"}`,
              fontSize: 13,
              lineHeight: 1.8,
              color: "var(--text2)",
              fontWeight: 300
            }}>{parseBold(m.text)}</div>
                  </div>)}
                {chatLoading && <div style={{
            display: "flex",
            gap: 5,
            padding: "10px 14px"
          }}><Dots label="" /></div>}
                <div ref={chatBottomRef} />
                <div style={{
            display: "flex",
            gap: 10,
            marginTop: 8
          }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="Ask your coach anything..." style={{
              flex: 1,
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--text)",
              fontFamily: "'Inter',sans-serif",
              fontSize: 13,
              padding: "12px 16px",
              outline: "none",
              transition: "border-color .3s",
              caretColor: "var(--accent)"
            }} />
                  <button onClick={sendChat} disabled={!chatInput.trim() || chatLoading} style={{
              background: "linear-gradient(135deg,#ff9500,#ff5000)",
              border: "none",
              color: "var(--text)",
              padding: "12px 20px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              opacity: chatInput.trim() && !chatLoading ? 1 : 0.4,
              transition: "opacity .2s"
            }}>⚡</button>
                </div>
              </div>}

            {/* Share + go to full coach */}
            {status !== "SLIP" && streak > 0 && <div style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "fadeUp .6s ease .3s both"
        }}><button onClick={() => doShare(streak, lv, setSharing)} disabled={sharing} style={{
            width: "100%",
            background: "var(--surface2)",
            border: "1px solid var(--border2)",
            color: "var(--text3)",
            padding: "15px 28px",
            borderRadius: 12,
            fontFamily: "'Inter',sans-serif",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "all .3s"
          }}><span style={{
              fontSize: 16
            }}>{sharing ? "⏳" : "📤"}</span>{sharing ? "Generating card..." : `Share Day ${streak} 🔥`}</button></div>}
            <button onClick={() => onGoChat && onGoChat()} style={{
          width: "100%",
          background: "var(--accent3)",
          border: "1px solid var(--border3)",
          borderRadius: 12,
          padding: "14px",
          color: "var(--accent2)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Orbitron',sans-serif",
          marginBottom: 8
        }}>⚡ Open Full Coach</button>
            <div ref={bottomRef} />
          </>}
      </div>
    </div>;
}

/* ─── HISTORY ────────────────────────────────────────────────────────────── */
function History({
  history
}) {
  return <div style={{
    minHeight: "100vh",
    paddingTop: 80,
    position: "relative",
    overflowX: "hidden"
  }}>
      <div style={{
      padding: "clamp(60px,8vw,80px) clamp(20px,8vw,100px) clamp(40px,5vw,64px)",
      borderBottom: "1px solid rgba(255,140,0,0.07)",
      position: "relative",
      zIndex: 1
    }}>
        <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at 80% 40%, rgba(255,100,0,0.06) 0%, transparent 60%)",
        pointerEvents: "none"
      }} />
        <div className="tag s1" style={{
        marginBottom: 24
      }}><span className="d" />Mission Log</div>
        <h2 className="s2 glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(32px,8vw,104px)",
        fontWeight: 800,
        lineHeight: .88,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent"
      }}>YOUR<br />RECORD.</h2>
      </div>
      <div style={{
      maxWidth: 820,
      margin: "0 auto",
      padding: "clamp(40px,6vw,72px) clamp(16px,8vw,100px)",
      position: "relative",
      zIndex: 1
    }}>
        <div className="tag s1" style={{
        marginBottom: 40
      }}><span className="d" />{history.length} entries logged</div>
        {history.length === 0 ? <div className="glass s2" style={{
        padding: 72,
        textAlign: "center"
      }}><div style={{
          fontSize: 36,
          marginBottom: 16
        }}>📋</div><p style={{
          fontSize: 14,
          color: "var(--text4)"
        }}>No entries yet. Complete your first check-in to start the log.</p></div> : history.map((e, i) => <div key={i} className="glass" style={{
        padding: "24px 28px",
        marginBottom: 12,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 20,
        animation: `fadeUp .55s cubic-bezier(.16,1,.3,1) ${i * .06}s both`,
        borderColor: e.status === "slip" ? "rgba(255,80,80,0.18)" : e.status === "win" ? "rgba(255,140,0,0.18)" : "rgba(255,255,255,0.07)"
      }}>
            <div>
              <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8
          }}>
                <div style={{
              fontSize: 10,
              color: "rgba(255,140,0,0.35)",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontWeight: 500
            }}>{e.date}</div>
                {e.status && <div style={{
              fontSize: 8,
              letterSpacing: 1.5,
              fontWeight: 700,
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 999,
              background: e.status === "win" ? "rgba(255,140,0,0.12)" : e.status === "slip" ? "rgba(255,50,50,0.12)" : "rgba(255,200,0,0.1)",
              color: e.status === "win" ? "#ff9500" : e.status === "slip" ? "#ff4444" : "#ffcc00",
              border: `1px solid ${e.status === "win" ? "rgba(255,140,0,0.3)" : e.status === "slip" ? "rgba(255,80,80,0.3)" : "rgba(255,200,0,0.25)"}`
            }}>
                    {e.status === "win" ? "🔥 WIN" : e.status === "slip" ? "⚔️ RESET" : "⚡ HELD"}
                  </div>}
              </div>
              <div style={{
            fontSize: 13,
            color: "var(--text3)",
            lineHeight: 1.8,
            fontWeight: 300
          }}>{e.msg}</div>
            </div>
            <div style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: 40,
          fontWeight: 800,
          color: e.status === "slip" ? "rgba(255,80,80,0.15)" : "rgba(255,140,0,0.12)",
          lineHeight: 1,
          alignSelf: "center",
          textAlign: "right",
          letterSpacing: -2
        }}>{e.streak}</div>
          </div>)}
      </div>
    </div>;
}

/* ─── REPORT ─────────────────────────────────────────────────────────────── */
function Report({
  history,
  savedPlan,
  streak,
  planHistory
}) {
  const [planOpen, setPlanOpen] = useState(true);
  const [oldPlanIdx, setOldPlanIdx] = useState(null);
  // Date-range filter — everything below reacts to this instead of hardcoded
  // 14/30-day windows, so the report actually reflects what the person asks
  // to see rather than one fixed slice.
  const [range, setRange] = useState(30); // days; 9999 = all-time
  const RANGES = [{
    id: 7,
    label: "7D"
  }, {
    id: 30,
    label: "30D"
  }, {
    id: 9999,
    label: "All"
  }];
  const daysAgo = n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };
  const withinRange = (dateStr, days) => {
    const d = new Date(dateStr);
    if (isNaN(d)) return true;
    return d >= daysAgo(days);
  };
  const filteredHistory = useMemo(() => history.filter(h => withinRange(h.date, range)), [history, range]);
  const wins = filteredHistory.filter(h => h.status === "win").length;
  const slips = filteredHistory.filter(h => h.status === "slip").length;
  const mids = filteredHistory.filter(h => h.status === "mid").length;
  const total = filteredHistory.length;
  const winRate = total > 0 ? Math.round(wins / total * 100) : 0;

  // Week-over-week delta — same-length window immediately before the current
  // one, so "62%" means something (vs "was 48% last period").
  const prevWinRate = useMemo(() => {
    if (range === 9999) return null; // no meaningful "previous all-time" window
    const prevStart = daysAgo(range * 2),
      prevEnd = daysAgo(range);
    const prevEntries = history.filter(h => {
      const d = new Date(h.date);
      return !isNaN(d) && d >= prevStart && d < prevEnd;
    });
    if (prevEntries.length === 0) return null;
    const prevWins = prevEntries.filter(h => h.status === "win").length;
    return Math.round(prevWins / prevEntries.length * 100);
  }, [history, range]);
  const winRateDelta = prevWinRate === null ? null : winRate - prevWinRate;
  const rewire = Math.min(100, Math.round(streak / 90 * 100));
  const rewireLabel = rewire < 20 ? "Early Detox" : rewire < 40 ? "Rewiring Begins" : rewire < 60 ? "Pathways Forming" : rewire < 80 ? "Deep Rewire" : "Neural Reset Complete";
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setTimeout(() => setEntered(true), 60);
  }, []);

  // Load trigger log + confess data for analytics
  const triggerLog = useMemo(() => {
    try {
      return JSON.parse(ls.get("syn_trigger_log", "[]"));
    } catch {
      return [];
    }
  }, []);
  const confessData = useMemo(() => {
    try {
      return JSON.parse(ls.get("syn_confess", "null"));
    } catch {
      return null;
    }
  }, []);
  const allAddictions = confessData?.addictions || [];
  const TRIGGER_LABELS = {
    bored: "😑 Bored",
    stressed: "😰 Stressed",
    lonely: "🫤 Lonely",
    alone_room: "🚪 Alone in room",
    phone_bed: "📱 Phone in bed",
    after_argument: "💢 Argument",
    tired: "😴 Tired",
    social_media: "📲 Social media",
    friends_around: "👥 Friends around",
    failure: "📉 Felt failure",
    free_time: "⏳ Free time",
    habit_cue: "🔁 Habit/autopilot"
  };
  const TIME_LABELS = {
    morning: "🌅 Morning",
    afternoon: "☀️ Afternoon",
    evening: "🌆 Evening",
    late_night: "🌙 Late Night"
  };
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rangedTriggerLog = useMemo(() => triggerLog.filter(e => withinRange(e.date, range)), [triggerLog, range]);

  // Aggregate: trigger frequency within selected range
  const triggerCounts = useMemo(() => {
    const counts = {};
    rangedTriggerLog.forEach(e => (e.addictions || []).forEach(a => (a.triggers || []).forEach(t => {
      counts[t] = (counts[t] || 0) + 1;
    })));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [rangedTriggerLog]);

  // Aggregate: time of day frequency within selected range
  const timeCounts = useMemo(() => {
    const counts = {
      morning: 0,
      afternoon: 0,
      evening: 0,
      late_night: 0
    };
    rangedTriggerLog.forEach(e => (e.addictions || []).forEach(a => {
      const times = Array.isArray(a.timeOfDay) ? a.timeOfDay : a.timeOfDay ? [a.timeOfDay] : [];
      times.forEach(ti => {
        counts[ti] = (counts[ti] || 0) + 1;
      });
    }));
    return counts;
  }, [rangedTriggerLog]);
  const maxTimeCount = Math.max(1, ...Object.values(timeCounts));

  // Aggregate: day-of-week frequency — separate from time-of-day, this
  // answers "which day of the week trips me up" rather than "which hour".
  const dayOfWeekCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    rangedTriggerLog.forEach(e => {
      const d = new Date(e.date);
      if (isNaN(d)) return;
      const slipCount = (e.addictions || []).length; // one slip-log entry per non-clean addiction that day
      if (slipCount > 0) counts[d.getDay()] += slipCount;
    });
    return counts;
  }, [rangedTriggerLog]);
  const maxDayCount = Math.max(1, ...dayOfWeekCounts);

  // Per-addiction usage trend for the selected range (capped at 30 points
  // rendered so the chart doesn't get unreadably dense on "All" range)
  const rangedForTrend = range === 9999 ? triggerLog : rangedTriggerLog;
  const trendWindow = rangedForTrend.slice(-30);
  const addictionTrends = useMemo(() => {
    return allAddictions.map(ad => {
      const points = trendWindow.map(e => {
        const entry = (e.addictions || []).find(a => a.id === ad.id);
        return entry ? entry.status === "clean" ? 0 : entry.usage || 0 : 0;
      });
      const cleanDays = trendWindow.filter(e => !(e.addictions || []).find(a => a.id === ad.id)).length;
      return {
        ...ad,
        points,
        cleanDays,
        total14: trendWindow.length
      };
    });
  }, [allAddictions, trendWindow]);
  const maxTrigger = triggerCounts.length ? triggerCounts[0][1] : 1;

  // Share/export — a PDF snapshot of the current report view, reusing the
  // same jsPDF approach as the battle-plan export so the download behaves
  // identically (paginated, no popup dependency) rather than introducing a
  // second, different export mechanism.
  const exportReportPDF = () => {
    const pdf = new jsPDF({
      unit: "pt",
      format: "a4"
    });
    pdf.addFileToVFS("Inter-Regular.ttf", INTER_REGULAR_TTF);
    pdf.addFont("Inter-Regular.ttf", "Inter", "normal");
    pdf.addFileToVFS("Inter-Bold.ttf", INTER_BOLD_TTF);
    pdf.addFont("Inter-Bold.ttf", "Inter", "bold");
    pdf.addFileToVFS("SpaceGrotesk-Bold.ttf", SPACE_GROTESK_BOLD_TTF);
    pdf.addFont("SpaceGrotesk-Bold.ttf", "SpaceGrotesk", "bold");
    const pageW = pdf.internal.pageSize.getWidth(),
      pageH = pdf.internal.pageSize.getHeight();
    const margin = 48;
    let y = margin;
    const nl = h => {
      if (y + h > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
    };
    pdf.setFont("SpaceGrotesk", "bold");
    pdf.setFontSize(18);
    pdf.setTextColor(255, 120, 0);
    pdf.text("SYNAPSE — NEURAL REPORT", margin, y);
    y += 22;
    pdf.setDrawColor(255, 140, 0);
    pdf.setLineWidth(1);
    pdf.line(margin, y, pageW - margin, y);
    y += 22;
    pdf.setFont("Inter", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(40, 40, 40);
    const rangeLabel = range === 9999 ? "All-time" : `Last ${range} days`;
    [`Generated:      ${new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric"
    })}`, `Range:          ${rangeLabel}`, `Current streak: ${streak} days`, `Rewire progress:${rewire}%  (${rewireLabel})`, `Days logged:    ${total}`, `Win / Held / Reset: ${wins} / ${mids} / ${slips}`, `Win rate:       ${winRate}%${winRateDelta !== null ? `  (${winRateDelta >= 0 ? "+" : ""}${winRateDelta}% vs previous period)` : ""}`].forEach(line => {
      nl(16);
      pdf.text(line, margin, y);
      y += 16;
    });
    y += 10;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageW - margin, y);
    y += 24;
    if (triggerCounts.length) {
      nl(16);
      pdf.setFont("Inter", "bold");
      pdf.text("TOP TRIGGERS", margin, y);
      y += 18;
      pdf.setFont("Inter", "normal");
      triggerCounts.forEach(([id, count]) => {
        nl(15);
        pdf.text(`${(TRIGGER_LABELS[id] || id).replace(/^\S+\s/, "")}: ${count}×`, margin, y);
        y += 15;
      });
      y += 10;
    }
    if (Object.values(timeCounts).some(v => v > 0)) {
      nl(16);
      pdf.setFont("Inter", "bold");
      pdf.text("WHEN SLIPS HAPPEN", margin, y);
      y += 18;
      pdf.setFont("Inter", "normal");
      Object.entries(timeCounts).forEach(([id, count]) => {
        nl(15);
        pdf.text(`${TIME_LABELS[id].replace(/^\S+\s/, "")}: ${count}`, margin, y);
        y += 15;
      });
    }
    y += 14;
    nl(20);
    pdf.setDrawColor(255, 140, 0);
    pdf.line(margin, y, pageW - margin, y);
    y += 18;
    pdf.setFont("Inter", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text("synapserewire.site", margin, y);
    pdf.save(`synapse-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };
  return <div style={{
    minHeight: "100vh",
    paddingTop: 80,
    position: "relative",
    overflowX: "hidden",
    opacity: entered ? 1 : 0,
    transform: entered ? "translateY(0)" : "translateY(24px)",
    transition: "all .8s cubic-bezier(.16,1,.3,1)"
  }}>
      <div style={{
      padding: "clamp(60px,8vw,80px) clamp(20px,8vw,100px) clamp(40px,5vw,64px)",
      borderBottom: "1px solid rgba(255,140,0,0.07)",
      position: "relative",
      zIndex: 1
    }}>
        <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at 60% 40%, rgba(255,100,0,0.07) 0%, transparent 60%)",
        pointerEvents: "none"
      }} />
        <div className="tag s1" style={{
        marginBottom: 24
      }}><span className="d" />Neural Report</div>
        <h2 className="s2 glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(32px,8vw,104px)",
        fontWeight: 800,
        lineHeight: .88,
        letterSpacing: -3,
        background: "var(--gradient-text)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent"
      }}>YOUR<br />REWIRING.</h2>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 14,
        marginTop: 28
      }}>
          <div style={{
          display: "flex",
          gap: 8
        }}>
            {RANGES.map(r => <button key={r.id} onClick={() => setRange(r.id)} style={{
            padding: "7px 16px",
            borderRadius: 999,
            border: `1px solid ${range === r.id ? "rgba(255,140,0,0.5)" : "rgba(255,255,255,0.1)"}`,
            background: range === r.id ? "rgba(255,140,0,0.12)" : "transparent",
            color: range === r.id ? "var(--accent2)" : "var(--text3)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: .5,
            cursor: "pointer",
            transition: "all .2s"
          }}>
                {r.label}
              </button>)}
          </div>
          <button onClick={exportReportPDF} style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 18px",
          borderRadius: 10,
          border: "1px solid rgba(255,140,0,0.25)",
          background: "rgba(255,140,0,0.06)",
          color: "rgba(255,180,80,0.85)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: .5,
          cursor: "pointer",
          transition: "all .2s"
        }} onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(255,140,0,0.12)";
        }} onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(255,140,0,0.06)";
        }}>
            <Download size={13} /> Share My Progress
          </button>
        </div>
      </div>
      <div style={{
      maxWidth: 820,
      margin: "0 auto",
      padding: "clamp(40px,6vw,72px) clamp(16px,8vw,100px)",
      position: "relative",
      zIndex: 1
    }}>

        {/* Rewire meter */}
        <div className="tag s1" style={{
        marginBottom: 24
      }}><span className="d" />Brain Rewiring Progress</div>
        <div className="glass" style={{
        padding: "36px 40px",
        marginBottom: 16,
        animation: "borderGlow 4s ease-in-out infinite"
      }}>
          <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 16
        }}>
            <div>
              <div style={{
              fontFamily: "'Orbitron',sans-serif",
              fontSize: 48,
              fontWeight: 800,
              color: "var(--text)",
              lineHeight: 1
            }}>{rewire}<span style={{
                fontSize: 20,
                color: "rgba(255,140,0,0.5)"
              }}>%</span></div>
              <div style={{
              fontSize: 11,
              letterSpacing: 3,
              color: "rgba(255,140,0,0.5)",
              textTransform: "uppercase",
              marginTop: 6
            }}>{rewireLabel}</div>
            </div>
            <div style={{
            textAlign: "right"
          }}>
              <div style={{
              fontSize: 11,
              color: "var(--text4)",
              letterSpacing: 1
            }}>TARGET</div>
              <div style={{
              fontFamily: "'Orbitron',sans-serif",
              fontSize: 20,
              color: "rgba(255,140,0,0.4)",
              fontWeight: 700
            }}>90 DAYS</div>
            </div>
          </div>
          <div style={{
          height: 6,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 12
        }}>
            <div style={{
            height: "100%",
            borderRadius: 4,
            background: "linear-gradient(90deg,rgba(255,80,0,0.8),rgba(255,180,50,1))",
            boxShadow: "0 0 20px rgba(255,140,0,0.4)",
            width: `${rewire}%`,
            transition: "width 2s cubic-bezier(.16,1,.3,1) .3s"
          }} />
          </div>
          <div style={{
          fontSize: 11,
          color: "var(--text4)",
          letterSpacing: 1
        }}>
            {90 - streak > 0 ? `${90 - streak} days to full neural reset` : "Full dopamine baseline restored 🔥"}
          </div>
        </div>

        {/* Stats row */}
        <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
        gap: 12,
        marginBottom: 32,
        marginTop: 32
      }}>
          {[{
          label: "Days Logged",
          val: total,
          color: "rgba(255,180,80,0.8)"
        }, {
          label: "Win Days 🔥",
          val: wins,
          color: "rgba(255,140,0,1)"
        }, {
          label: "Held Days ⚡",
          val: mids,
          color: "rgba(255,200,0,0.8)"
        }, {
          label: "Resets ⚔️",
          val: slips,
          color: "rgba(255,80,80,0.8)"
        }, {
          label: "Win Rate",
          val: `${winRate}%`,
          color: "rgba(255,160,60,0.9)",
          delta: winRateDelta
        }, {
          label: "Current Streak",
          val: `${streak}d`,
          color: "rgba(255,220,100,1)"
        }].map(({
          label,
          val,
          color,
          delta
        }) => <div key={label} className="glass" style={{
          padding: "20px 22px",
          textAlign: "center",
          position: "relative"
        }}>
              <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 32,
            fontWeight: 800,
            color,
            marginBottom: 6,
            lineHeight: 1
          }}>{val}</div>
              <div style={{
            fontSize: 9,
            letterSpacing: 2,
            color: "var(--text4)",
            textTransform: "uppercase"
          }}>{label}</div>
              {delta !== undefined && delta !== null && delta !== 0 && <div style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 10,
            fontWeight: 700,
            color: delta > 0 ? "#4ade80" : "#ff6060"
          }}>
                  {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}%
                </div>}
            </div>)}
        </div>

        {/* WIN/MID/SLIP bar */}
        {total > 0 && <div className="glass" style={{
        padding: "28px 32px",
        marginBottom: 32
      }}>
            <div style={{
          fontSize: 10,
          letterSpacing: 3,
          color: "rgba(255,140,0,0.4)",
          textTransform: "uppercase",
          marginBottom: 16
        }}>Day Breakdown</div>
            <div style={{
          display: "flex",
          height: 12,
          borderRadius: 6,
          overflow: "hidden",
          gap: 2
        }}>
              {wins > 0 && <div style={{
            flex: wins,
            background: "linear-gradient(90deg,rgba(255,140,0,0.7),rgba(255,180,50,0.9))",
            borderRadius: "6px 0 0 6px",
            transition: "flex 1s"
          }} />}
              {mids > 0 && <div style={{
            flex: mids,
            background: "rgba(255,200,0,0.35)",
            transition: "flex 1s"
          }} />}
              {slips > 0 && <div style={{
            flex: slips,
            background: "rgba(255,80,80,0.35)",
            borderRadius: "0 6px 6px 0",
            transition: "flex 1s"
          }} />}
            </div>
            <div style={{
          display: "flex",
          gap: 20,
          marginTop: 12,
          flexWrap: "wrap"
        }}>
              {[["🔥 Win", wins, "rgba(255,140,0,0.6)"], ["⚡ Held", mids, "rgba(255,200,0,0.5)"], ["⚔️ Reset", slips, "rgba(255,80,80,0.5)"]].map(([l, v, c]) => <div key={l} style={{
            display: "flex",
            alignItems: "center",
            gap: 6
          }}>
                  <div style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: c
            }} />
                  <span style={{
              fontSize: 11,
              color: "var(--text3)"
            }}>{l}: <span style={{
                color: "var(--text2)"
              }}>{v}</span></span>
                </div>)}
            </div>
          </div>}

        {/* ═══ ADDICTION ANALYTICS ═══ */}
        {addictionTrends.length > 0 && <>
            <div className="tag s1" style={{
          marginBottom: 16,
          marginTop: 8
        }}><span className="d" />Addiction Breakdown — Last 14 Days</div>

            {/* Per-addiction usage trend cards */}
            <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          marginBottom: 32
        }}>
              {addictionTrends.map(ad => {
            const slipDays = ad.points.filter(p => p > 0).length;
            const cleanRate = ad.total14 > 0 ? Math.round((ad.total14 - slipDays) / ad.total14 * 100) : 100;
            const maxPoint = Math.max(1, ...ad.points, ad.value || 1);
            const w = 280,
              h = 56,
              pad = 4;
            const stepX = ad.points.length > 1 ? (w - pad * 2) / (ad.points.length - 1) : 0;
            const pathPoints = ad.points.map((p, i) => {
              const x = pad + i * stepX;
              const y = h - pad - p / maxPoint * (h - pad * 2);
              return `${x},${y}`;
            }).join(" ");
            const areaPath = `M${pad},${h - pad} L${pathPoints.split(" ").join(" L")} L${w - pad},${h - pad} Z`;
            return <div key={ad.id} className="glass" style={{
              padding: "22px 26px"
            }}>
                    <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
                flexWrap: "wrap",
                gap: 10
              }}>
                      <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10
                }}>
                        <span style={{
                    fontSize: 20
                  }}>{ad.emoji}</span>
                        <div>
                          <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)"
                    }}>{ad.label}</div>
                          <div style={{
                      fontSize: 10,
                      color: "var(--text4)"
                    }}>{cleanRate}% clean rate · last 14 days</div>
                        </div>
                      </div>
                      <div style={{
                  display: "flex",
                  gap: 14,
                  fontSize: 10,
                  color: "var(--text3)"
                }}>
                        <span><span style={{
                      color: "#88ff44",
                      fontWeight: 700
                    }}>{ad.total14 - slipDays}</span> clean</span>
                        <span><span style={{
                      color: "#ff5050",
                      fontWeight: 700
                    }}>{slipDays}</span> slipped</span>
                      </div>
                    </div>
                    {/* Mini trend chart */}
                    <svg width="100%" height="56" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{
                display: "block"
              }}>
                      <defs>
                        <linearGradient id={`grad-${ad.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={ad.color} stopOpacity="0.35" />
                          <stop offset="100%" stopColor={ad.color} stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill={`url(#grad-${ad.id})`} />
                      <polyline points={pathPoints} fill="none" stroke={ad.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                      {ad.points.map((p, i) => {
                  const x = pad + i * stepX;
                  const y = h - pad - p / maxPoint * (h - pad * 2);
                  return p > 0 ? <circle key={i} cx={x} cy={y} r="2" fill={ad.color} /> : null;
                })}
                    </svg>
                    <div style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 8,
                color: "var(--text4)",
                marginTop: 2
              }}>
                      <span>14 days ago</span><span>Today</span>
                    </div>
                  </div>;
          })}
            </div>

            {/* Trigger frequency chart */}
            {triggerCounts.length > 0 ? <div className="glass" style={{
          padding: "26px 30px",
          marginBottom: 20
        }}>
                <div style={{
            fontSize: 10,
            letterSpacing: 3,
            color: "rgba(255,140,0,0.45)",
            textTransform: "uppercase",
            marginBottom: 18
          }}>⚡ Top Triggers — {range === 9999 ? "All-Time" : `Last ${range} Days`}</div>
                <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 12
          }}>
                  {triggerCounts.map(([id, count]) => <div key={id}>
                      <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 5
              }}>
                        <span style={{
                  fontSize: 12,
                  color: "var(--text2)"
                }}>{TRIGGER_LABELS[id] || id}</span>
                        <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--accent)",
                  fontFamily: "'JetBrains Mono',monospace"
                }}>{count}×</span>
                      </div>
                      <div style={{
                height: 7,
                background: "rgba(255,255,255,0.04)",
                borderRadius: 4,
                overflow: "hidden"
              }}>
                        <div style={{
                  height: "100%",
                  borderRadius: 4,
                  width: `${count / maxTrigger * 100}%`,
                  background: "linear-gradient(90deg,rgba(255,100,0,0.7),rgba(255,180,50,0.95))",
                  transition: "width 1s ease"
                }} />
                      </div>
                    </div>)}
                </div>
              </div> : <div className="glass" style={{
          padding: "22px 26px",
          marginBottom: 20,
          textAlign: "center"
        }}>
                <p style={{
            fontSize: 12,
            color: "var(--text4)"
          }}>Not enough slip data in this range yet to spot a trigger pattern — check the "All" range or keep logging.</p>
              </div>}

            {/* Time of day heatmap */}
            {Object.values(timeCounts).some(v => v > 0) && <div className="glass" style={{
          padding: "26px 30px",
          marginBottom: 20
        }}>
                <div style={{
            fontSize: 10,
            letterSpacing: 3,
            color: "rgba(255,140,0,0.45)",
            textTransform: "uppercase",
            marginBottom: 18
          }}>🕐 When Slips Happen Most</div>
                <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10
          }}>
                  {Object.entries(timeCounts).map(([id, count]) => {
              const intensity = count / maxTimeCount;
              return <div key={id} style={{
                textAlign: "center",
                padding: "16px 8px",
                borderRadius: 10,
                background: `rgba(255,${Math.round(140 - intensity * 60)},0,${0.04 + intensity * 0.14})`,
                border: `1px solid rgba(255,140,0,${0.1 + intensity * 0.3})`,
                transition: "all .5s"
              }}>
                        <div style={{
                  fontSize: 18,
                  marginBottom: 6
                }}>{TIME_LABELS[id].split(" ")[0]}</div>
                        <div style={{
                  fontSize: 9,
                  color: "var(--text3)",
                  marginBottom: 4,
                  letterSpacing: .5
                }}>{TIME_LABELS[id].split(" ")[1]}</div>
                        <div style={{
                  fontFamily: "'Orbitron',sans-serif",
                  fontSize: 18,
                  fontWeight: 800,
                  color: intensity > 0.6 ? "#ff8c00" : "var(--text3)"
                }}>{count}</div>
                      </div>;
            })}
                </div>
              </div>}

            {/* Day of week heatmap — separate axis from time-of-day: this
                answers "which day trips me up" (e.g. weekends) rather than
                "which hour", so it earns its own chart instead of overloading
                the time-of-day one. */}
            {dayOfWeekCounts.some(v => v > 0) && <div className="glass" style={{
          padding: "26px 30px",
          marginBottom: 32
        }}>
                <div style={{
            fontSize: 10,
            letterSpacing: 3,
            color: "rgba(255,140,0,0.45)",
            textTransform: "uppercase",
            marginBottom: 18
          }}>📅 Slips By Day Of Week</div>
                <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            gap: 6
          }}>
                  {DAY_LABELS.map((label, i) => {
              const count = dayOfWeekCounts[i];
              const intensity = count / maxDayCount;
              return <div key={label} style={{
                textAlign: "center"
              }}>
                        <div style={{
                  height: 60,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  marginBottom: 6
                }}>
                          <div style={{
                    width: "70%",
                    height: `${Math.max(4, intensity * 60)}px`,
                    borderRadius: "4px 4px 0 0",
                    background: count > 0 ? `rgba(255,140,0,${0.25 + intensity * 0.55})` : "rgba(255,255,255,0.04)",
                    transition: "height .5s"
                  }} />
                        </div>
                        <div style={{
                  fontSize: 9,
                  color: "var(--text4)",
                  letterSpacing: .5
                }}>{label}</div>
                        <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: count > 0 ? "var(--text2)" : "var(--text4)",
                  fontFamily: "'JetBrains Mono',monospace"
                }}>{count}</div>
                      </div>;
            })}
                </div>
              </div>}
          </>}

        {/* Battle Plan — always accessible */}
        <div className="tag s1" style={{
        marginBottom: 16
      }}><span className="d" />Your Battle Plan</div>
        {savedPlan ? <>
            <button onClick={() => setPlanOpen(o => !o)} style={{
          width: "100%",
          background: "rgba(255,140,0,0.04)",
          border: "1px solid rgba(255,140,0,0.18)",
          borderRadius: 12,
          padding: "18px 24px",
          color: "rgba(255,180,80,0.8)",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: planOpen ? 0 : 32,
          transition: "all .3s",
          fontSize: 13,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Orbitron',sans-serif",
          fontWeight: 600
        }}>
              <span>📋 View My Battle Plan</span>
              <span style={{
            fontSize: 18,
            transform: planOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .3s"
          }}>↓</span>
            </button>
            {planOpen && <div className="glass" style={{
          padding: "36px 40px",
          marginBottom: 32,
          borderTop: "none",
          borderRadius: "0 0 12px 12px",
          animation: "fadeUp .4s ease both"
        }}>
                <div style={{
            fontSize: 14,
            lineHeight: 2.15,
            color: "var(--text2)",
            fontWeight: 300,
            whiteSpace: "pre-wrap",
            borderLeft: "2px solid rgba(255,140,0,0.22)",
            paddingLeft: 24
          }}>{parseBold(savedPlan)}</div>
              </div>}
          </> : <div className="glass s2" style={{
        padding: 40,
        textAlign: "center",
        marginBottom: 32
      }}>
            <p style={{
          fontSize: 13,
          color: "var(--text4)"
        }}>No battle plan yet. Complete the Confess flow to generate yours.</p>
          </div>}

        {/* Previous plans */}
        {planHistory && planHistory.length > 0 && <>
            <div className="tag s1" style={{
          marginBottom: 16,
          marginTop: 16
        }}><span className="d" />Previous Plans</div>
            {planHistory.map((p, i) => <div key={i} className="glass" style={{
          padding: "20px 24px",
          marginBottom: 10,
          cursor: "pointer"
        }} onClick={() => setOldPlanIdx(oldPlanIdx === i ? null : i)}>
                <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
                  <span style={{
              fontSize: 11,
              color: "rgba(255,140,0,0.4)",
              letterSpacing: 1
            }}>Plan from {new Date(p.date).toLocaleDateString()}</span>
                  <span style={{
              fontSize: 12,
              color: "var(--text4)"
            }}>{oldPlanIdx === i ? "▲" : "▼"}</span>
                </div>
                {oldPlanIdx === i && <div style={{
            fontSize: 13,
            lineHeight: 2,
            color: "var(--text3)",
            fontWeight: 300,
            whiteSpace: "pre-wrap",
            borderLeft: "2px solid rgba(255,140,0,0.12)",
            paddingLeft: 20,
            marginTop: 16,
            maxHeight: 360,
            overflowY: "auto"
          }}>{parseBold(p.plan)}</div>}
              </div>)}
          </>}

      </div>
    </div>;
}

/* ─── CHAT ───────────────────────────────────────────────────────────────── */
const OFF_TOPIC_MSG = "That's outside what I can help with here. Ask me about your recovery, urges, streaks, how SYNAPSE works, or just say what's on your mind.";
function ChatBubble({
  msg,
  idx
}) {
  const isUser = msg.role === "user";
  if (msg.upgradePrompt) {
    return <div style={{
      display: "flex",
      justifyContent: "flex-start",
      marginBottom: 16,
      animation: `fadeUp .4s cubic-bezier(.16,1,.3,1) both`,
      animationDelay: `${idx * 0.04}s`
    }}>
        <div style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "rgba(255,140,0,.15)",
        border: "1px solid rgba(255,180,80,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginRight: 10,
        marginTop: 2
      }}><span style={{
          fontSize: 12
        }}>⚡</span></div>
        <div style={{
        maxWidth: "84%",
        padding: "18px 20px",
        borderRadius: "16px 16px 16px 4px",
        background: "linear-gradient(135deg,rgba(255,140,0,.1),rgba(255,80,0,.05))",
        border: "1px solid rgba(255,140,0,.3)"
      }}>
          <div style={{
          fontSize: 13,
          lineHeight: 1.75,
          color: "rgba(255,255,255,.8)",
          fontWeight: 400,
          marginBottom: 14
        }}>{msg.text}</div>
          <a href="" onClick={e => e.preventDefault() /* TODO: point at the real pricing/subscription URL once it exists */} style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "linear-gradient(135deg,#ff9500,#ff5000)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: .5,
          padding: "11px 22px",
          borderRadius: 10,
          textDecoration: "none",
          boxShadow: "0 0 20px rgba(255,140,0,.35)",
          transition: "transform .2s"
        }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.03)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
            Upgrade Plan →
          </a>
        </div>
      </div>;
  }
  return <div style={{
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
    marginBottom: 16,
    animation: `fadeUp .4s cubic-bezier(.16,1,.3,1) both`,
    animationDelay: `${idx * 0.04}s`
  }}>
      {!isUser && <div style={{
      width: 28,
      height: 28,
      borderRadius: "50%",
      background: msg.crisis ? "rgba(70,150,255,.12)" : "rgba(255,140,0,.12)",
      border: `1px solid ${msg.crisis ? "rgba(100,180,255,.3)" : "rgba(255,140,0,.25)"}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginRight: 10,
      marginTop: 2
    }}><span style={{
        fontSize: 12
      }}>{msg.crisis ? "🤝" : "⚡"}</span></div>}
      <div style={{
      maxWidth: "78%",
      padding: "13px 18px",
      borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
      background: isUser ? "linear-gradient(135deg,rgba(255,140,0,.18),rgba(255,80,0,.12))" : msg.crisis ? "linear-gradient(135deg,rgba(70,150,255,.08),rgba(40,100,255,.04))" : "rgba(255,255,255,.04)",
      border: `1px solid ${isUser ? "rgba(255,140,0,.25)" : msg.crisis ? "rgba(100,180,255,.25)" : msg.offTopic ? "rgba(255,80,80,.2)" : "rgba(255,255,255,.07)"}`,
      fontSize: 13,
      lineHeight: 1.85,
      color: msg.crisis ? "rgba(255,255,255,.75)" : msg.offTopic ? "rgba(255,120,120,.75)" : isUser ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.65)",
      fontWeight: 300
    }}>
        {parseBold(msg.text)}
      </div>
    </div>;
}
function Chat({
  streak,
  savedPlan
}) {
  const [msgs, setMsgs] = useState(() => {
    const history = loadChatHistory();
    if (history.length > 0) return history;
    return [{
      role: "ai",
      text: `Day ${streak} — I'm here. What's on your mind? Ask me anything about your recovery, urges, or the battle ahead.`
    }];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [vis, setVis] = useState(false);
  const [mode, setMode] = useState(getMode());
  const bottomRef = useRef(null);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [msgs, loading]);
  const switchMode = m => {
    ls.set("syn_mode", m.id);
    setMode(m);
  };
  const send = async () => {
    const txt = input.trim();
    if (!txt || loading) return;
    setInput("");
    const userMsg = {
      role: "user",
      text: txt
    };
    setMsgs(m => {
      const next = [...m, userMsg];
      saveChatHistory(next);
      return next;
    });
    if (detectCrisis(txt)) {
      setMsgs(m => {
        const next = [...m, {
          role: "ai",
          text: CRISIS_RESPONSE,
          crisis: true
        }];
        saveChatHistory(next);
        return next;
      });
      return;
    }
    // AI safety classifier for indirect language
    setLoading(true);
    const aiRisk = await checkSafetyRisk(txt);
    if (aiRisk) {
      setMsgs(m => {
        const next = [...m, {
          role: "ai",
          text: CRISIS_RESPONSE,
          crisis: true
        }];
        saveChatHistory(next);
        return next;
      });
      setLoading(false);
      return;
    }
    try {
      // Build context — last 12 messages for memory, includes checkin reports too
      const ctx = [...msgs, userMsg].slice(-12).map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      }));
      // Add streak + archetype + recurring trigger pattern context to first message —
      // same coach context handleCheckin and the inline checkin chat already use,
      // so the full Coach screen doesn't "know less" about the user than they do.
      const coachCtx = getCoachContext();
      ctx[0] = {
        ...ctx[0],
        content: `[User context: Day ${streak} of recovery. Plan: ${savedPlan ? savedPlan.slice(0, 120) + "..." : "not set yet"}]${coachCtx}\n\n${ctx[0].content}`
      };
      const reply = await callAI(ctx, withTone(SYSTEM_CHAT));
      if (reply.includes("[OFF_TOPIC]")) {
        setMsgs(m => {
          const next = [...m, {
            role: "ai",
            text: OFF_TOPIC_MSG,
            offTopic: true
          }];
          saveChatHistory(next);
          return next;
        });
      } else {
        setMsgs(m => {
          const next = [...m, {
            role: "ai",
            text: reply
          }];
          saveChatHistory(next);
          return next;
        });
      }
    } catch (e) {
      if (e.isRateLimit) {
        setMsgs(m => {
          const next = [...m, {
            role: "ai",
            upgradePrompt: true,
            text: e.message
          }];
          saveChatHistory(next);
          return next;
        });
      } else {
        setMsgs(m => {
          const next = [...m, {
            role: "ai",
            text: "Connection error. Stay strong — try again."
          }];
          saveChatHistory(next);
          return next;
        });
      }
    }
    setLoading(false);
  };
  return <div style={{
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    opacity: vis ? 1 : 0,
    transition: "opacity .6s ease"
  }}>

      {/* Header — same max-width as messages */}
      <div style={{
      maxWidth: 760,
      width: "100%",
      margin: "0 auto",
      padding: "clamp(90px,12vw,120px) clamp(16px,5vw,48px) 24px",
      boxSizing: "border-box"
    }}>
        <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,140,0,.07)",
        border: "1px solid rgba(255,140,0,.2)",
        borderRadius: 999,
        padding: "7px 18px",
        marginBottom: 20
      }}>
          <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#ff8c00",
          boxShadow: "0 0 10px #ff8c00",
          animation: "pulse 1.5s ease-in-out infinite"
        }} />
          <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 2.5,
          color: "rgba(255,180,80,.65)",
          textTransform: "uppercase"
        }}>SYNAPSE Coach — Live</span>
        </div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(24px,5.5vw,52px)",
        fontWeight: 900,
        letterSpacing: -2,
        background: "linear-gradient(135deg,#fff,rgba(255,180,80,.7))",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: .95,
        marginBottom: 14
      }}>TALK TO<br />SYNAPSE</div>
        <p style={{
        fontSize: 13,
        color: "var(--text4)",
        lineHeight: 1.8,
        maxWidth: "100%",
        margin: "0 0 24px 0"
      }}>Ask anything about your recovery — urges, relapses, streaks, cravings, your battle plan. I stay on topic.</p>

        {/* Mode selector */}
        <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap"
      }}>
          {Object.values(MODES).map(m => {
          const active = mode.id === m.id;
          return <button key={m.id} onClick={() => switchMode(m)} style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 999,
            border: `1px solid ${active ? m.accent : "rgba(255,255,255,.1)"}`,
            background: active ? `rgba(${m.id === "operator" ? "74,222,128" : m.id === "warlord" ? "239,68,68" : "255,140,0"},.1)` : "transparent",
            color: active ? m.accent : "rgba(255,255,255,.3)",
            fontSize: 11,
            fontWeight: active ? 700 : 400,
            letterSpacing: active ? 2 : 1.5,
            textTransform: "uppercase",
            cursor: "pointer",
            transition: "all .25s",
            boxShadow: active ? `0 0 16px ${m.accent}33` : "none"
          }}>
                <span style={{
              fontSize: 13
            }}>{m.icon}</span>
                {m.label}
                {active && <span style={{
              fontSize: 9,
              opacity: .7,
              marginLeft: 2
            }}>●</span>}
              </button>;
        })}
          <span style={{
          fontSize: 11,
          color: "var(--text4)",
          alignSelf: "center",
          marginLeft: 4
        }}>{mode.desc}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{
      flex: 1,
      maxWidth: 760,
      width: "100%",
      margin: "0 auto",
      padding: "0 clamp(16px,5vw,48px) 160px",
      boxSizing: "border-box"
    }}>
        {msgs.map((m, i) => <ChatBubble key={i} msg={m} idx={i} />)}
        {loading && <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16
      }}>
            <div style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "rgba(255,140,0,.12)",
          border: "1px solid rgba(255,140,0,.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0
        }}><span style={{
            fontSize: 12
          }}>⚡</span></div>
            <div style={{
          display: "flex",
          gap: 5,
          padding: "12px 16px",
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: "16px 16px 16px 4px"
        }}>
              {[0, 1, 2].map(i => <div key={i} style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#ff9500",
            animation: `dotBlink 1s ${i * .18}s infinite`
          }} />)}
            </div>
          </div>}
        <div ref={bottomRef} />
      </div>

      {/* Input bar — fixed at bottom */}
      <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      padding: "16px clamp(16px,5vw,48px)",
      background: "linear-gradient(0deg,var(--bg) 70%,rgba(7,4,10,0) 100%)",
      zIndex: 100
    }}>
        <div style={{
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        gap: 12,
        alignItems: "flex-end"
      }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }} placeholder="Ask about your urges, battle plan, recovery tactics..." rows={1} style={{
          flex: 1,
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,140,0,.2)",
          borderRadius: 14,
          padding: "14px 18px",
          color: "var(--text)",
          fontSize: 13,
          fontFamily: "'Inter',sans-serif",
          fontWeight: 300,
          outline: "none",
          resize: "none",
          lineHeight: 1.6,
          caretColor: "#ff8c00",
          transition: "border .3s",
          boxSizing: "border-box"
        }} onFocus={e => e.target.style.borderColor = "rgba(255,140,0,.55)"} onBlur={e => e.target.style.borderColor = "rgba(255,140,0,.2)"} />
          <button onClick={send} disabled={!input.trim() || loading} style={{
          background: input.trim() ? "linear-gradient(135deg,#ff9500,#ff5000)" : "rgba(255,255,255,.05)",
          border: "none",
          borderRadius: 12,
          padding: "14px 20px",
          color: input.trim() ? "#fff" : "rgba(255,255,255,.2)",
          fontSize: 16,
          cursor: "pointer",
          transition: "all .25s",
          flexShrink: 0,
          boxShadow: input.trim() ? "0 0 20px rgba(255,140,0,.3)" : "none"
        }}>
            ↑
          </button>
        </div>
        <div style={{
        textAlign: "center",
        marginTop: 8,
        fontSize: 10,
        color: "var(--text4)",
        letterSpacing: 1
      }}>Recovery topics only · Shift+Enter for new line</div>
      </div>
    </div>;
}

/* ─── BATTLE PLAN PREVIEW ────────────────────────────────────────────────── */
function BattlePlanPreview({
  plan,
  loading,
  onAuth,
  onBack
}) {
  const [vis, setVis] = useState(false);
  const {
    displayed,
    done: twDone
  } = useTypewriter(plan, 6);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
  }, []);
  return <div style={{
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    opacity: vis ? 1 : 0,
    transition: "opacity .7s ease"
  }}>
      {/* Header */}
      <div style={{
      padding: "clamp(60px,10vw,100px) clamp(20px,6vw,80px) 32px"
    }}>
        <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,140,0,.07)",
        border: "1px solid rgba(255,140,0,.2)",
        borderRadius: 999,
        padding: "7px 18px",
        marginBottom: 24
      }}>
          <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#ff8c00",
          boxShadow: "0 0 10px #ff8c00",
          animation: "pulse 1.5s ease-in-out infinite"
        }} />
          <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 2.5,
          color: "rgba(255,180,80,.65)",
          textTransform: "uppercase"
        }}>Your Battle Plan — Preview</span>
        </div>
        <div className="glitch-hl" style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(28px,6vw,64px)",
        fontWeight: 900,
        letterSpacing: -2,
        background: "linear-gradient(135deg,#fff,rgba(255,180,80,.7))",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: .92,
        marginBottom: 16
      }}>YOUR PLAN<br />IS READY.</div>
        <p style={{
        fontSize: 14,
        color: "var(--text3)",
        lineHeight: 1.8,
        maxWidth: 480
      }}>SYNAPSE has built your personalized recovery protocol. Create an account to lock it in and begin Day 1.</p>
      </div>

      {/* Plan preview with fade lock */}
      <div style={{
      flex: 1,
      position: "relative",
      padding: "0 clamp(20px,6vw,80px)",
      maxWidth: 860,
      width: "100%",
      boxSizing: "border-box"
    }}>
        {loading ? <div style={{
        padding: "48px 0",
        display: "flex",
        alignItems: "center",
        gap: 16
      }}>
            <div style={{
          display: "flex",
          gap: 6
        }}>{[0, 1, 2].map(i => <div key={i} style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ff9500",
            animation: `dotBlink 1s ${i * .18}s infinite`
          }} />)}</div>
            <span style={{
          fontSize: 13,
          color: "var(--text3)"
        }}>Building your battle plan...</span>
          </div> : <div style={{
        position: "relative"
      }}>
            <div className="glass" style={{
          padding: "clamp(24px,4vw,40px)",
          borderRadius: 16,
          border: "1px solid rgba(255,140,0,.15)",
          maxHeight: 340,
          overflow: "hidden",
          position: "relative"
        }}>
              <div style={{
            fontSize: 13,
            lineHeight: 2.1,
            color: "var(--text2)",
            fontWeight: 300,
            whiteSpace: "pre-wrap"
          }}>
                {parseBold(displayed)}{!twDone && <span style={{
              color: "#ff8c00",
              animation: "blink 1s infinite"
            }}>|</span>}
              </div>
              {/* Gradient lock overlay */}
              <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 200,
            background: "linear-gradient(0deg,var(--bg) 0%,var(--bg) 40%,rgba(7,4,10,0) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 24
          }}>
                <div style={{
              fontSize: 22,
              marginBottom: 8
            }}>🔒</div>
                <div style={{
              fontSize: 11,
              color: "var(--text3)",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono',monospace"
            }}>Create account to unlock full plan</div>
              </div>
            </div>
          </div>}
      </div>

      {/* CTA */}
      <div style={{
      padding: "32px clamp(20px,6vw,80px) 48px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      maxWidth: 860,
      width: "100%",
      boxSizing: "border-box"
    }}>
        <button className="btn-primary" onClick={onAuth} style={{
        width: "100%",
        padding: "18px",
        fontSize: 14,
        letterSpacing: .5,
        justifyContent: "center",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 0 50px rgba(255,140,0,.35),0 8px 32px rgba(0,0,0,.5)"
      }}>
          🔥 Lock In My Protocol — Create Account
        </button>
        <button onClick={onBack} style={{
        width: "100%",
        padding: "13px",
        fontSize: 12,
        background: "transparent",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 12,
        color: "var(--text4)",
        cursor: "pointer"
      }}>
          ← Edit My Answers
        </button>
      </div>
    </div>;
}

/* ─── MILESTONE CELEBRATION ─────────────────────────────────────────────── */
function FeedbackSheet({
  theme,
  onClose
}) {
  const [rating, setRating] = useState(0);
  const [best, setBest] = useState("");
  const [improve, setImprove] = useState("");
  const [recommend, setRecommend] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    const user = JSON.parse(localStorage.getItem("syn_user") || "{}");
    // CRITICAL: uid must come from auth.currentUser, not localStorage.
    // Firestore rule is: request.resource.data.uid == request.auth.uid
    // If we use localStorage uid (which could be stale/wrong/undefined),
    // the write gets rejected silently. auth.currentUser.uid is always
    // the verified uid that Firestore checks against.
    const authUid = auth.currentUser?.uid || user.uid || "anonymous";
    const feedbackData = {
      uid: authUid,
      name: user.name || "",
      email: user.email || auth.currentUser?.email || "",
      rating,
      best,
      improve,
      recommend,
      streak: parseInt(localStorage.getItem("syn_streak") || 0),
      archetype: JSON.parse(localStorage.getItem("syn_archetype") || "{}").title || ""
    };

    // Bug fix: this used to fire-and-forget an addDoc() and, on any failure
    // (timeout, permission error, offline), just console.warn and silently
    // move on — the feedback vanished with zero trace, while the UI still
    // told the user "sent". That's why submitted feedback wasn't showing up
    // in the admin dashboard. Fixed by:
    //   1. ALWAYS saving a local copy first, unconditionally — so even in
    //      the worst case (Firestore is down, rules reject it) the feedback
    //      still exists somewhere and isn't lost the moment the tab closes.
    //   2. Using the same durableWrite() queue-and-retry system the rest of
    //      the app uses for checkins/profile — if the write fails now, it's
    //      automatically retried on next app load or reconnect via
    //      flushSyncQueue(), instead of being a one-shot attempt.
    try {
      const saved = JSON.parse(localStorage.getItem("syn_feedbacks") || "[]");
      saved.push({
        ...feedbackData,
        date: new Date().toISOString()
      });
      localStorage.setItem("syn_feedbacks", JSON.stringify(saved.slice(-50)));
    } catch (le) {
      console.warn("Local feedback save failed:", le);
    }

    // Local copy saved above. Now kick off Firestore write in the background —
    // don't await it. The user already has their local copy, and durableWrite's
    // retry queue will sync it automatically if this attempt fails. Awaiting it
    // was what caused the "Sending..." spinner to hang for several seconds
    // (durableWrite retries 3x with delays = up to ~18s with the new timeouts).
    try {
      if (db) {
        const feedbackId = `fb_${user.uid || "anon"}_${Date.now()}`;
        durableWrite(`feedback_${feedbackId}`, "feedbacks", feedbackId, {
          ...feedbackData,
          timestamp: serverTimestamp()
        }).catch(e => console.warn("Feedback sync failed, queued for retry:", e));
      }
    } catch (e) {
      console.warn("Feedback save:", e);
    }
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(onClose, 2500);
  };
  const inp = {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "12px 14px",
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
    fontFamily: "'Inter',sans-serif",
    resize: "none",
    boxSizing: "border-box",
    lineHeight: 1.6
  };
  return <>
      <div onClick={onClose} style={{
      position: "fixed",
      inset: 0,
      zIndex: 900,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(8px)"
    }} />
      <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 901,
      background: "#0d0b14",
      borderTop: "1px solid rgba(255,140,0,0.15)",
      borderRadius: "24px 24px 0 0",
      padding: "8px 0 40px",
      maxHeight: "92vh",
      overflowY: "auto",
      animation: "slideUp .35s cubic-bezier(.16,1,.3,1)"
    }}>
        <div style={{
        width: 40,
        height: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.15)",
        margin: "12px auto 24px"
      }} />

        {submitted ? <div style={{
        padding: "40px 24px",
        textAlign: "center"
      }}>
            <div style={{
          fontSize: 48,
          marginBottom: 16
        }}>🙏</div>
            <div style={{
          fontFamily: "'Orbitron',sans-serif",
          fontSize: 15,
          fontWeight: 700,
          color: "#ff9500",
          letterSpacing: 1,
          marginBottom: 8
        }}>Thank You</div>
            <div style={{
          fontSize: 13,
          color: "var(--text3)",
          lineHeight: 1.7
        }}>Your feedback shapes SYNAPSE.<br />We read every single one.</div>
          </div> : <div style={{
        padding: "0 24px"
      }}>
            {/* Header */}
            <div style={{
          marginBottom: 24
        }}>
              <div style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "#ff9500",
            letterSpacing: 1,
            marginBottom: 4
          }}>SHARE YOUR EXPERIENCE</div>
              <div style={{
            fontSize: 12,
            color: "var(--text3)",
            lineHeight: 1.6
          }}>Help us build the recovery tool you actually need. Takes 60 seconds.</div>
            </div>

            {/* Star rating */}
            <div style={{
          marginBottom: 20
        }}>
              <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 10,
            fontWeight: 500,
            letterSpacing: .5
          }}>How would you rate SYNAPSE so far?</div>
              <div style={{
            display: "flex",
            gap: 8
          }}>
                {[1, 2, 3, 4, 5].map(s => <div key={s} onClick={() => setRating(s)} style={{
              fontSize: 28,
              cursor: "pointer",
              filter: s <= rating ? "none" : "grayscale(1) opacity(0.3)",
              transition: "all .15s",
              transform: s <= rating ? "scale(1.1)" : "scale(1)"
            }}>⭐</div>)}
              </div>
            </div>

            {/* Q1 */}
            <div style={{
          marginBottom: 16
        }}>
              <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 8,
            fontWeight: 500,
            letterSpacing: .5
          }}>✅ What's working best for you so far?</div>
              <textarea value={best} onChange={e => setBest(e.target.value)} placeholder="The daily check-ins, the battle plan, the AI coach..." rows={3} style={inp} />
            </div>

            {/* Q2 */}
            <div style={{
          marginBottom: 16
        }}>
              <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 8,
            fontWeight: 500,
            letterSpacing: .5
          }}>🔧 What's one thing we should improve?</div>
              <textarea value={improve} onChange={e => setImprove(e.target.value)} placeholder="Be honest — we can handle it." rows={3} style={inp} />
            </div>

            {/* Q3 */}
            <div style={{
          marginBottom: 24
        }}>
              <div style={{
            fontSize: 11,
            color: "var(--text3)",
            marginBottom: 10,
            fontWeight: 500,
            letterSpacing: .5
          }}>💬 Would you recommend SYNAPSE to a friend?</div>
              <div style={{
            display: "flex",
            gap: 8
          }}>
                {["Absolutely 🔥", "Maybe 🤔", "Not yet ❌"].map(opt => <div key={opt} onClick={() => setRecommend(opt)} style={{
              flex: 1,
              padding: "10px 6px",
              borderRadius: 10,
              textAlign: "center",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all .2s",
              background: recommend === opt ? "rgba(255,140,0,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${recommend === opt ? "rgba(255,140,0,0.4)" : "rgba(255,255,255,0.08)"}`,
              color: recommend === opt ? "#ff9500" : "var(--text3)"
            }}>{opt}</div>)}
              </div>
            </div>

            {/* Submit */}
            <button onClick={handleSubmit} disabled={!rating || submitting} style={{
          width: "100%",
          padding: "14px",
          borderRadius: 14,
          background: !rating ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,#ff9500,#ff5000)",
          border: "none",
          color: !rating ? "var(--text4)" : "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: !rating ? "not-allowed" : "pointer",
          transition: "all .3s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8
        }}>
              {submitting ? <><div style={{
              width: 14,
              height: 14,
              border: "2px solid rgba(255,255,255,0.3)",
              borderTop: "2px solid #fff",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite"
            }} /> Sending...</> : "Send Feedback →"}
            </button>
            <button onClick={onClose} style={{
          width: "100%",
          padding: "12px",
          borderRadius: 14,
          background: "transparent",
          border: "none",
          color: "var(--text4)",
          fontSize: 12,
          cursor: "pointer",
          marginTop: 8
        }}>Maybe later</button>
          </div>}
      </div>
    </>;
}
function MilestoneCelebration({
  day,
  onClose
}) {
  const m = MILESTONE_DATA[day];
  const canvasRef = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    setTimeout(() => setVis(true), 60);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    const colors = [m.color, "#ff9500", "#ffcc00", "#ff5500", "#fff", "#ffb347"];
    const pts = Array.from({
      length: 130
    }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      vx: (Math.random() - .5) * 1.8,
      vy: Math.random() * 3 + 1,
      w: Math.random() * 8 + 3,
      h: Math.random() * 14 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      rv: (Math.random() - .5) * 5,
      op: Math.random() * .7 + .3
    }));
    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rv;
        if (p.y > canvas.height) {
          p.y = -10;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.globalAlpha = p.op;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [day]);
  return <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 960,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(7,4,10,0.93)",
    opacity: vis ? 1 : 0,
    transition: "opacity .5s ease"
  }}>
      <canvas ref={canvasRef} style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none"
    }} />
      <div style={{
      position: "relative",
      zIndex: 2,
      textAlign: "center",
      maxWidth: 520,
      padding: "clamp(36px,7vw,72px) clamp(24px,6vw,64px)",
      opacity: vis ? 1 : 0,
      transform: vis ? "translateY(0)" : "translateY(32px)",
      transition: "all .8s cubic-bezier(.16,1,.3,1) .1s"
    }}>
        <div style={{
        fontSize: 72,
        marginBottom: 12,
        filter: `drop-shadow(0 0 40px ${m.color})`
      }}>{m.emoji}</div>
        <div style={{
        fontSize: 10,
        letterSpacing: 5,
        color: `rgba(${m.rgb},.55)`,
        textTransform: "uppercase",
        marginBottom: 14,
        fontFamily: "'JetBrains Mono',monospace"
      }}>Day {day} Milestone Unlocked</div>
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(48px,12vw,108px)",
        fontWeight: 900,
        letterSpacing: -3,
        background: `linear-gradient(135deg,#fff,${m.color})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: .88,
        marginBottom: 10
      }}>{day}</div>
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: "clamp(16px,4vw,24px)",
        fontWeight: 800,
        color: m.color,
        letterSpacing: 4,
        marginBottom: 28,
        textTransform: "uppercase",
        textShadow: `0 0 30px ${m.color}66`
      }}>{m.name}</div>
        <p style={{
        fontSize: 14,
        lineHeight: 1.95,
        color: "var(--text2)",
        fontWeight: 300,
        marginBottom: 40,
        maxWidth: 420,
        marginLeft: "auto",
        marginRight: "auto"
      }}>{m.msg}</p>
        <button className="btn-primary" onClick={onClose} style={{
        fontSize: 13,
        letterSpacing: 1,
        padding: "16px 52px",
        background: `linear-gradient(135deg,${m.color},${m.color}99)`,
        boxShadow: `0 0 40px ${m.color}55,0 8px 32px rgba(0,0,0,.5)`
      }}>
          Continue The Mission →
        </button>
      </div>
    </div>;
}

/* ─── EMERGENCY OVERLAY ──────────────────────────────────────────────────── */
function EmergencyOverlay({
  savedPlan,
  streak,
  onClose,
  onCoach
}) {
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const {
    displayed,
    done: twDone
  } = useTypewriter(reply, 9);
  useEffect(() => {
    (async () => {
      try {
        let arch = "";
        try {
          const a = JSON.parse(ls.get("syn_archetype", "null"));
          if (a) arch = `\nArchetype: ${a.title} — ${a.sub}`;
        } catch {}
        const r = await callAI([{
          role: "user",
          content: `Day ${streak} of recovery.${arch}\n\nI'm struggling right now. Urge is hitting hard. Help me right now.`
        }], withTone(SYSTEM_EMERGENCY));
        setReply(r);
      } catch {
        setReply("This craving is a 90-second wave. It has no power over you — only a deadline.\n\nStand up right now. Walk to a different room. Drink cold water.\n\nYou chose recovery. That choice is still valid. It will always be valid.");
      }
      setLoading(false);
    })();
  }, []);
  return <div onClick={e => {
    if (e.target === e.currentTarget) onClose();
  }} style={{
    position: "fixed",
    inset: 0,
    zIndex: 950,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    background: "rgba(7,4,10,0.82)",
    backdropFilter: "blur(6px)",
    animation: "fadeIn .3s ease"
  }}>
      <div style={{
      width: "100%",
      maxWidth: 640,
      background: "linear-gradient(180deg,rgba(200,20,20,0.06) 0%,rgba(7,4,10,.99) 100%)",
      border: "1px solid rgba(255,70,70,0.22)",
      borderBottom: "none",
      borderRadius: "20px 20px 0 0",
      padding: "clamp(24px,5vw,44px) clamp(20px,5vw,48px)",
      maxHeight: "78vh",
      overflow: "auto",
      animation: "slideUp .4s cubic-bezier(.16,1,.3,1)"
    }}>
        {/* Header */}
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 28
      }}>
          <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12
        }}>
            <div style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#ff3333",
            boxShadow: "0 0 14px #ff3333",
            animation: "pulse 1s ease-in-out infinite"
          }} />
            <span style={{
            fontFamily: "'Orbitron',sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 3,
            color: "rgba(255,80,80,.85)",
            textTransform: "uppercase"
          }}>Emergency Mode</span>
          </div>
          <button onClick={onClose} style={{
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.1)",
          color: "var(--text3)",
          width: 32,
          height: 32,
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 15,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>✕</button>
        </div>
        {/* Response */}
        {loading ? <div style={{
        padding: "32px 0"
      }}><Dots label="Synapse locking in" /></div> : <div style={{
        fontSize: 15,
        lineHeight: 2.15,
        color: "var(--text)",
        fontWeight: 300,
        whiteSpace: "pre-wrap",
        borderLeft: "2px solid rgba(255,70,70,.3)",
        paddingLeft: 20
      }}>
            {parseBold(displayed)}{!twDone && <span style={{
          color: "#ff4444",
          animation: "blink 1s infinite"
        }}>|</span>}
          </div>}
        {!loading && twDone && <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 32
      }}>
            <button className="btn-primary" onClick={onClose} style={{
          width: "100%",
          padding: "15px",
          fontSize: 13,
          background: "linear-gradient(135deg,#cc2222,#992222)",
          boxShadow: "0 0 30px rgba(200,30,30,.4),0 6px 24px rgba(0,0,0,.5)"
        }}>
              I'm back. Keep going. →
            </button>
            <button onClick={() => {
          onClose();
          onCoach();
        }} style={{
          width: "100%",
          padding: "13px",
          fontSize: 12,
          background: "rgba(255,140,0,.06)",
          border: "1px solid rgba(255,140,0,.2)",
          borderRadius: 12,
          color: "rgba(255,180,80,.7)",
          cursor: "pointer",
          fontFamily: "'Orbitron',sans-serif",
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: "uppercase"
        }}>
              ⚡ Talk to Coach
            </button>
          </div>}
      </div>
    </div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMMAND MODE — a second, fully self-contained UI environment.
   Does NOT touch the original dark "Focus Mode" UI, its --bg/--text CSS
   vars, or the Nav/Boot/Checkin components above. Warm paper palette,
   entered via the ENVIRONMENT switch, with its own boot-in choreography:

   0ms    paper bg fades in
   150ms  gradient mesh appears
   300ms  neural network lines fade in
   450ms  floating particles appear
   600ms  Neural Core scales 0.96→1, fades in
   900ms  one soft neural pulse
   1050ms "Good Morning" fades
   1150ms name fades
   1250ms tagline fades
   1350ms Continue button fades
   1450ms Today's Focus card
   1525ms Recovery card
   1600ms Coach/stat cards
   1675ms charts animate
   1800ms everything interactive
──────────────────────────────────────────────────────────────────────────── */
const COMMAND_MODE_CSS = `
@keyframes cmPaperIn{from{opacity:0}to{opacity:1}}
@keyframes cmMeshIn{from{opacity:0}to{opacity:1}}
@keyframes cmNetIn{from{opacity:0}to{opacity:.5}}
@keyframes cmParticleIn{from{opacity:0}to{opacity:1}}
@keyframes cmCoreIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes cmPulse{0%{box-shadow:0 0 0 0 rgba(255,140,0,.35)}70%{box-shadow:0 0 0 40px rgba(255,140,0,0)}100%{box-shadow:0 0 0 0 rgba(255,140,0,0)}}
@keyframes cmFadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes cmFade{from{opacity:0}to{opacity:1}}
@keyframes cmDrawLine{from{stroke-dashoffset:240}to{stroke-dashoffset:0}}

.cm-root{opacity:0;animation:cmPaperIn .5s ease forwards}
.cm-mesh{opacity:0;animation:cmMeshIn .8s ease forwards;animation-delay:.15s}
.cm-net{opacity:0;animation:cmNetIn 1s ease forwards;animation-delay:.3s}
.cm-particles{opacity:0;animation:cmParticleIn .8s ease forwards;animation-delay:.45s}
.cm-core{opacity:0;animation:cmCoreIn .6s cubic-bezier(.16,1,.3,1) forwards;animation-delay:.6s}
.cm-core-pulse{animation:cmPulse 1.4s ease-out;animation-delay:.9s}
.cm-greet1{opacity:0;animation:cmFade .5s ease forwards;animation-delay:1.05s}
.cm-greet2{opacity:0;animation:cmFade .5s ease forwards;animation-delay:1.15s}
.cm-tagline{opacity:0;animation:cmFade .5s ease forwards;animation-delay:1.25s}
.cm-cta{opacity:0;animation:cmFadeUp .5s ease forwards;animation-delay:1.35s}
.cm-focus-card{opacity:0;animation:cmFadeUp .5s ease forwards;animation-delay:1.45s}
.cm-recovery-card{opacity:0;animation:cmFadeUp .5s ease forwards;animation-delay:1.525s}
.cm-coach-card{opacity:0;animation:cmFadeUp .5s ease forwards;animation-delay:1.6s}
.cm-charts{opacity:0;animation:cmFadeUp .5s ease forwards;animation-delay:1.675s}
.cm-sidebar{opacity:0;animation:cmFade .5s ease forwards;animation-delay:.1s}
.cm-topbar{opacity:0;animation:cmFade .5s ease forwards;animation-delay:1s}
`;

const CM_COLORS = {
  bg: "#f7f2ea",
  bgSoft: "#fbf8f3",
  card: "#ffffff",
  cardBorder: "rgba(60,40,20,.08)",
  text: "#2a1f14",
  text2: "rgba(42,31,20,.62)",
  text3: "rgba(42,31,20,.4)",
  accent: "#e0790f",
  accent2: "#ff9500",
  green: "#3fae5c",
  greenBg: "#eef8f0",
  amberBg: "#fdf3e3",
  redBg: "#fdeeee",
  red: "#d64545",
};

function CmCard({ children, className = "", style = {} }) {
  return <div className={className} style={{
    background: CM_COLORS.card,
    border: `1px solid ${CM_COLORS.cardBorder}`,
    borderRadius: 18,
    boxShadow: "0 2px 12px rgba(60,40,20,.04)",
    ...style
  }}>{children}</div>;
}

function CommandSidebar({ goTo, screen, onSwitchToFocus, userName }) {
  const items = [
    { id: "commandHome", label: "Home", icon: <User size={16} /> },
    { id: "commandCheckin", label: "Check-In", icon: <ClipboardList size={16} /> },
    { id: "plan", label: "My Plan", icon: <Target size={16} /> },
    { id: "chat", label: "AI Coach", icon: <Brain size={16} /> },
    { id: "report", label: "Progress", icon: <TrendingDown size={16} /> },
    { id: "history", label: "Journal", icon: <ClipboardList size={16} /> },
    { id: "urge", label: "Urge Log", icon: <Activity size={16} /> },
    { id: "report", label: "Report", icon: <BarChart2 size={16} /> },
    { id: "settings", label: "Settings", icon: <Settings size={16} /> },
  ];
  return <div className="cm-sidebar" style={{
    width: 240, flexShrink: 0, background: CM_COLORS.bgSoft,
    borderRight: `1px solid ${CM_COLORS.cardBorder}`, padding: "24px 16px",
    display: "flex", flexDirection: "column", gap: 4, minHeight: "100vh",
    boxSizing: "border-box", position: "sticky", top: 0
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 20px" }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: `radial-gradient(circle,${CM_COLORS.accent2},${CM_COLORS.accent})` }} />
      <div>
        <div style={{ fontFamily: "'Orbitron',sans-serif", fontWeight: 800, fontSize: 13, letterSpacing: 1, color: CM_COLORS.text }}>SYNAPSE</div>
        <div style={{ fontSize: 8, letterSpacing: 1.5, color: CM_COLORS.text3 }}>RESET · REWIRE · RECONQUER</div>
      </div>
    </div>
    {items.map((it, i) => <div key={it.label} onClick={() => goTo(it.id)} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500,
      color: screen === it.id ? CM_COLORS.accent : CM_COLORS.text2,
      background: screen === it.id ? CM_COLORS.amberBg : "transparent",
      transition: "all .2s"
    }}>{it.icon}{it.label}</div>)}

    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: CM_COLORS.text3, padding: "0 8px" }}>ENVIRONMENT</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", border: `1px solid ${CM_COLORS.cardBorder}`, borderRadius: 12 }}>
        <div onClick={onSwitchToFocus} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: CM_COLORS.text2, cursor: "pointer" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", border: `2px solid ${CM_COLORS.text3}` }} />Focus Mode
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: CM_COLORS.accent, fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: CM_COLORS.accent }} />Command Mode
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px" }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e4dccf", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: CM_COLORS.text }}>
          {(userName || "U")[0]}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: CM_COLORS.text }}>{userName || "User"}</div>
          <div style={{ fontSize: 10, color: CM_COLORS.text3 }}>View Profile</div>
        </div>
      </div>
    </div>
  </div>;
}

function CommandHome({ goTo, streak, savedPlan, userName, onSwitchToFocus }) {
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = COMMAND_MODE_CSS;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const displayName = userName || "there";
  const streakDays = streak || 0;

  return <div className="cm-root" style={{
    minHeight: "100vh", width: "100%", display: "flex",
    background: CM_COLORS.bg, fontFamily: "'Inter',sans-serif", color: CM_COLORS.text,
    position: "relative", overflow: "hidden"
  }}>
    {/* gradient mesh background layer */}
    <div className="cm-mesh" style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      background: "radial-gradient(circle at 30% 20%, rgba(255,180,90,.18), transparent 55%), radial-gradient(circle at 80% 60%, rgba(255,140,0,.10), transparent 50%)"
    }} />
    {/* faint neural network lines */}
    <svg className="cm-net" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <line x1="20%" y1="15%" x2="45%" y2="35%" stroke={CM_COLORS.accent} strokeWidth="1" opacity=".15" />
      <line x1="45%" y1="35%" x2="70%" y2="20%" stroke={CM_COLORS.accent} strokeWidth="1" opacity=".15" />
      <line x1="45%" y1="35%" x2="55%" y2="65%" stroke={CM_COLORS.accent} strokeWidth="1" opacity=".15" />
      <line x1="55%" y1="65%" x2="80%" y2="75%" stroke={CM_COLORS.accent} strokeWidth="1" opacity=".15" />
    </svg>
    {/* floating particles */}
    <div className="cm-particles" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {[...Array(10)].map((_, i) => <div key={i} style={{
        position: "absolute", width: 3, height: 3, borderRadius: "50%",
        background: CM_COLORS.accent2, opacity: .5,
        top: `${(i * 37) % 90 + 5}%`, left: `${(i * 53) % 90 + 5}%`
      }} />)}
    </div>

    <CommandSidebar goTo={goTo} screen="commandHome" onSwitchToFocus={onSwitchToFocus} userName={displayName} />

    <div style={{ flex: 1, padding: "28px clamp(16px,3vw,48px)", position: "relative", zIndex: 2, maxWidth: 1400, margin: "0 auto", boxSizing: "border-box" }}>
      {/* top bar */}
      <div className="cm-topbar" style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: CM_COLORS.card, border: `1px solid ${CM_COLORS.cardBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bell size={16} color={CM_COLORS.text2} />
        </div>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#e4dccf", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
          {displayName[0]}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
        {/* left: greeting + core */}
        <div>
          <div className="cm-greet1" style={{ fontSize: 22, color: CM_COLORS.text2, fontWeight: 400 }}>Good Morning,</div>
          <div className="cm-greet2" style={{ fontFamily: "'Georgia',serif", fontSize: 44, fontWeight: 400, color: CM_COLORS.text, lineHeight: 1.1, margin: "2px 0 14px" }}>{displayName}</div>
          <div className="cm-tagline" style={{ fontSize: 14, color: CM_COLORS.text2, lineHeight: 1.6, maxWidth: 320, marginBottom: 20 }}>
            You are becoming someone who keeps promises.
          </div>
          <button onClick={() => goTo("commandCheckin")} className="cm-cta" style={{
            background: "transparent", border: `1px solid ${CM_COLORS.accent}`, color: CM_COLORS.accent,
            padding: "11px 22px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 8
          }}>Continue Your Journey <ChevronRight size={14} /></button>

          {/* Today's Focus */}
          <CmCard className="cm-focus-card" style={{ marginTop: 28, padding: 20, maxWidth: 420 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 12 }}>TODAY'S FOCUS</div>
            {[
              { t: "Morning Routine", s: "Start your day with intention", time: "7:00 AM", done: true },
              { t: "Urge Surfing Practice", s: "5 minute mindful breathing", time: "12:00 PM" },
              { t: "No Social Media", s: "Protect your focus", time: "All Day" },
              { t: "Journal & Reflect", s: "End the day with clarity", time: "10:00 PM" },
            ].map((task, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${CM_COLORS.cardBorder}` : "none" }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                border: task.done ? "none" : `1.5px solid ${CM_COLORS.cardBorder}`,
                background: task.done ? CM_COLORS.accent2 : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>{task.done && <Check size={12} color="#fff" />}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{task.t}</div>
                <div style={{ fontSize: 11, color: CM_COLORS.text3 }}>{task.s}</div>
              </div>
              <div style={{ fontSize: 11, color: CM_COLORS.text3 }}>{task.time}</div>
            </div>)}
          </CmCard>
        </div>

        {/* right: neural core + streak */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div className="cm-core cm-core-pulse" style={{
            width: 220, height: 220, borderRadius: "50%",
            background: "radial-gradient(circle at 40% 30%, rgba(255,220,150,.9), rgba(255,180,90,.25) 60%, transparent 75%)",
            display: "flex", alignItems: "center", justifyContent: "center", position: "relative"
          }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: `radial-gradient(circle,${CM_COLORS.accent2},${CM_COLORS.accent})`, boxShadow: `0 0 40px ${CM_COLORS.accent2}` }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3 }}>YOUR NEURAL CORE</div>
            <div style={{ fontSize: 12, color: CM_COLORS.text2, marginTop: 2 }}>Every choice rewires your mind.</div>
          </div>

          <CmCard className="cm-recovery-card" style={{ width: "100%", padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 6 }}>YOUR RECOVERY PHASE</div>
            <div style={{ fontFamily: "'Georgia',serif", fontSize: 20, marginTop: 6 }}>Phase 1</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: CM_COLORS.accent, marginBottom: 6 }}>Foundation</div>
            <div style={{ fontSize: 11, color: CM_COLORS.text3, marginBottom: 12 }}>You are building your stability.</div>
            <div style={{ height: 5, borderRadius: 3, background: "#efe6d8", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (streakDays / 30) * 100)}%`, background: `linear-gradient(90deg,${CM_COLORS.accent2},${CM_COLORS.accent})`, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, color: CM_COLORS.text3, marginTop: 6, textAlign: "right" }}>{streakDays} / 30 days</div>
          </CmCard>
        </div>
      </div>

      {/* stat row */}
      <div className="cm-coach-card" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 24 }}>
        <CmCard style={{ padding: 18 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: CM_COLORS.text3, marginBottom: 6 }}>YOUR STREAK</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{streakDays} <span style={{ fontSize: 13, fontWeight: 400, color: CM_COLORS.text3 }}>days</span></div>
        </CmCard>
        <CmCard style={{ padding: 18, display: "flex", alignItems: "center", gap: 10 }}>
          <Heart size={18} color={CM_COLORS.green} />
          <div><div style={{ fontSize: 18, fontWeight: 700 }}>17</div><div style={{ fontSize: 10, color: CM_COLORS.text3 }}>Urges Managed</div></div>
        </CmCard>
        <CmCard style={{ padding: 18, display: "flex", alignItems: "center", gap: 10 }}>
          <ClipboardList size={18} color={CM_COLORS.accent} />
          <div><div style={{ fontSize: 18, fontWeight: 700 }}>12</div><div style={{ fontSize: 10, color: CM_COLORS.text3 }}>Check-ins</div></div>
        </CmCard>
      </div>

      {/* charts / insight row */}
      <div className="cm-charts" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16, marginTop: 24 }}>
        <CmCard style={{ padding: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 10 }}>TODAY'S NEURAL INSIGHT</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Discipline is choosing between what you want now and what you want most. Keep showing up. You're rewiring.</div>
        </CmCard>
        <CmCard style={{ padding: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 10 }}>WEEKLY PROGRESS</div>
          <svg width="100%" height="70" viewBox="0 0 260 70">
            <polyline points="0,55 35,45 70,50 105,30 140,35 175,15 210,20 245,5" fill="none" stroke={CM_COLORS.accent2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CmCard>
      </div>

      <div style={{ marginTop: 32, textAlign: "center", fontSize: 12, color: CM_COLORS.text3, fontStyle: "italic" }}>
        "It's okay to slip. What matters is you show up again. Reset. Learn. Rebuild. That's the SYNAPSE way."
      </div>
    </div>
  </div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMMAND MODE — CHECK-IN
   Full functional replacement for the old dark Checkin screen, rebuilt
   entirely inside the Command Mode visual language (CM_COLORS / CmCard).
   Same underlying data model & submit path as the original: per-addiction
   status/usage/triggers, deterministic WIN/MID/SLIP verdict, onCheckin(report,status).
──────────────────────────────────────────────────────────────────────────── */
const CM_TRIGGERS = [
  { id: "bored", label: "Bored" },
  { id: "stressed", label: "Stressed" },
  { id: "lonely", label: "Lonely" },
  { id: "alone_room", label: "Alone in room" },
  { id: "phone_bed", label: "Phone in bed" },
  { id: "after_argument", label: "After argument" },
  { id: "tired", label: "Tired / late night" },
  { id: "social_media", label: "Saw it on social media" },
];

const CM_STATUS_META = {
  clean: { label: "Clean", emoji: "✅", bg: CM_COLORS.greenBg, border: "rgba(63,174,92,.35)", text: CM_COLORS.green },
  partial: { label: "Partial", emoji: "🟡", bg: CM_COLORS.amberBg, border: "rgba(224,121,15,.35)", text: CM_COLORS.accent },
  slip: { label: "Reset Logged", emoji: "🔴", bg: CM_COLORS.redBg, border: "rgba(214,69,69,.35)", text: CM_COLORS.red },
};

function CmAddictionCard({ a, status, onStatus, usage, onUsage, triggers, onToggleTrigger }) {
  const maxVal = a.isFreq ? Math.max((a.value || 0) * 2, 10) : Math.max((a.value || 0) * 2, 12);
  const unit = a.isFreq ? "x" : "h";
  const meta = CM_STATUS_META[status];
  return <CmCard style={{ padding: 20 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>{a.emoji || "•"}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: CM_COLORS.text }}>{a.label}</div>
          <div style={{ fontSize: 10, color: CM_COLORS.text3 }}>{a.isFreq ? `Goal: 0x/week` : `Goal: 0h/day`}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: meta.text, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 999, padding: "4px 10px" }}>
        {meta.emoji} {meta.label}
      </div>
    </div>

    {/* status pills */}
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {["clean", "partial", "slip"].map(s => {
        const m = CM_STATUS_META[s];
        const active = status === s;
        return <button key={s} onClick={() => onStatus(s)} style={{
          flex: 1, padding: "9px 6px", borderRadius: 10, cursor: "pointer",
          fontSize: 11, fontWeight: 600, letterSpacing: .3,
          border: `1px solid ${active ? m.border : CM_COLORS.cardBorder}`,
          background: active ? m.bg : "#fff",
          color: active ? m.text : CM_COLORS.text3,
          transition: "all .2s"
        }}>{m.emoji} {m.label}</button>;
      })}
    </div>

    {/* intensity slider — only for partial/slip */}
    {(status === "partial" || status === "slip") && <div style={{ marginBottom: 14, padding: "12px 14px", background: CM_COLORS.bgSoft, borderRadius: 12, border: `1px solid ${CM_COLORS.cardBorder}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: CM_COLORS.text3 }}>How much today?</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: CM_COLORS.accent }}>{usage}{unit}</span>
      </div>
      <input type="range" min={0} max={maxVal} step={a.isFreq ? 1 : 0.5} value={usage}
        onChange={e => onUsage(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: CM_COLORS.accent }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: CM_COLORS.text3, marginTop: 4 }}>
        <span>0{unit}</span><span>{maxVal}{unit}</span>
      </div>

      {/* trigger chips */}
      <div style={{ fontSize: 10, color: CM_COLORS.text3, margin: "12px 0 8px" }}>What triggered it?</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {CM_TRIGGERS.map(t => {
          const on = triggers.includes(t.id);
          return <button key={t.id} onClick={() => onToggleTrigger(t.id)} style={{
            padding: "6px 12px", borderRadius: 999, fontSize: 11, cursor: "pointer",
            border: `1px solid ${on ? "rgba(224,121,15,.4)" : CM_COLORS.cardBorder}`,
            background: on ? CM_COLORS.amberBg : "#fff",
            color: on ? CM_COLORS.accent : CM_COLORS.text2,
            fontWeight: on ? 600 : 400, transition: "all .2s"
          }}>{t.label}</button>;
        })}
      </div>
    </div>}
  </CmCard>;
}

function CommandCheckin({ goTo, streak, savedPlan, lastCheckin, onCheckin, userName }) {
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = COMMAND_MODE_CSS;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const confessData = useMemo(() => {
    try { return JSON.parse(ls.get("syn_confess", "null")); } catch { return null; }
  }, []);
  const addictions = confessData?.addictions || [];

  const [adStatus, setAdStatus] = useState(() => Object.fromEntries(addictions.map(a => [a.id, "clean"])));
  const [adUsage, setAdUsage] = useState(() => Object.fromEntries(addictions.map(a => [a.id, 0])));
  const [adTriggers, setAdTriggers] = useState(() => Object.fromEntries(addictions.map(a => [a.id, []])));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");

  const today = new Date().toDateString();
  const done = lastCheckin === today;

  // Editable AI recovery-plan checklist, seeded from the plan text (one line
  // per checkbox item). Purely a UI convenience over the same savedPlan text
  // the old screen just dumped into coach context — nothing else reads this
  // checked state, so it's local-only and safe to keep simple.
  const planItems = useMemo(() => {
    if (!savedPlan) return [];
    return savedPlan.split("\n").map(l => l.replace(/^[-•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 8);
  }, [savedPlan]);
  const [planChecked, setPlanChecked] = useState(() => Object.fromEntries(planItems.map((_, i) => [i, false])));

  const computeStatus = () => {
    if (addictions.length === 0) return "WIN";
    const statuses = addictions.map(a => adStatus[a.id]);
    if (statuses.some(s => s === "slip")) return "SLIP";
    if (statuses.some(s => s === "partial")) return "MID";
    return "WIN";
  };
  const verdict = computeStatus();
  const VERDICT_META = {
    WIN: { label: "Excellent", sub: "You stayed strong across the board today.", color: CM_COLORS.green, bg: CM_COLORS.greenBg },
    MID: { label: "Mixed", sub: "Some wins, some struggles — that's still progress.", color: CM_COLORS.accent, bg: CM_COLORS.amberBg },
    SLIP: { label: "Needs Attention", sub: "A tough day. Tomorrow is a fresh page.", color: CM_COLORS.red, bg: CM_COLORS.redBg },
  };
  // "Good" sits between MID and WIN when everything is clean/partial but not
  // a perfect record — reuses the same three-state signal, just a nicer label.
  const vm = addictions.length && addictions.every((a, i) => adStatus[a.id] === "clean")
    ? VERDICT_META.WIN
    : verdict === "MID" ? { ...VERDICT_META.MID, label: "Good" } : VERDICT_META[verdict];

  const buildReport = () => {
    const adLines = addictions.map(a => {
      const s = adStatus[a.id];
      const usage = adUsage[a.id];
      const goal = a.isFreq ? `Goal: 0x/week` : `Goal: 0h/day`;
      const baseline = a.isFreq ? `Baseline: ${a.value}x/week` : `Baseline: ${a.value}h/day`;
      const usageStr = s === "clean" ? "0" : `${usage}${a.isFreq ? "x" : "h"} today`;
      const triggerStr = (adTriggers[a.id] || []).length ? ` | Triggers: ${(adTriggers[a.id] || []).map(id => CM_TRIGGERS.find(t => t.id === id)?.label || id).join(", ")}` : "";
      return `${a.emoji || ""} ${a.label}: ${s === "clean" ? "CLEAN ✓" : s === "partial" ? "PARTIAL ~" : "SLIPPED ✗"} (${usageStr}, ${goal}, ${baseline}${triggerStr})`;
    }).join("\n");
    const notesLine = notes.trim() ? `\nAdditional notes: ${notes.trim()}` : "";
    return `Day ${streak + 1} structured check-in:\n\n${adLines}${notesLine}`;
  };

  const submit = async () => {
    if (done) return;
    setLoading(true);
    const report = buildReport();
    const result = await onCheckin(report, computeStatus());
    setReply(result?.reply || "");
    setLoading(false);
  };

  const displayName = userName || "there";

  return <div className="cm-root" style={{ minHeight: "100vh", width: "100%", background: CM_COLORS.bg, fontFamily: "'Inter',sans-serif", color: CM_COLORS.text, display: "flex", position: "relative" }}>
    <div className="cm-mesh" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(circle at 25% 15%, rgba(255,180,90,.16), transparent 55%), radial-gradient(circle at 85% 65%, rgba(255,140,0,.09), transparent 50%)" }} />

    <CommandSidebar goTo={goTo} screen="commandCheckin" onSwitchToFocus={() => goTo("checkin")} userName={displayName} />

    <div style={{ flex: 1, padding: "28px clamp(16px,3vw,48px)", position: "relative", zIndex: 2, maxWidth: 1200, margin: "0 auto", boxSizing: "border-box" }}>

      <div className="cm-topbar" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="cm-greet1" style={{ fontFamily: "'Georgia',serif", fontSize: 34, fontWeight: 400 }}>Check-In</div>
          <div className="cm-tagline" style={{ fontSize: 13, color: CM_COLORS.text2, marginTop: 4 }}>Your honesty builds your transformation.</div>
        </div>
        <div className="cm-greet2" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3 }}>YOUR STREAK</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{streak} <span style={{ fontSize: 12, fontWeight: 400, color: CM_COLORS.text3 }}>days</span></div>
        </div>
      </div>

      {/* Today's Signal — inspirational quote card */}
      <CmCard className="cm-cta" style={{ padding: 24, marginBottom: 18, display: "flex", alignItems: "center", gap: 20, background: `linear-gradient(135deg, ${CM_COLORS.card}, ${CM_COLORS.bgSoft})` }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0, background: `radial-gradient(circle,${CM_COLORS.accent2},${CM_COLORS.accent})`, boxShadow: `0 0 24px rgba(255,140,0,.25)` }} />
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 6 }}>TODAY'S SIGNAL</div>
          <div style={{ fontFamily: "'Georgia',serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.5 }}>
            "Strength does not come from physical capacity. It comes from an indomitable will."
          </div>
        </div>
      </CmCard>

      {/* Check-in reminder */}
      <CmCard className="cm-focus-card" style={{ padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12, background: CM_COLORS.bgSoft }}>
        <Clock size={16} color={CM_COLORS.accent} />
        <div style={{ fontSize: 12, color: CM_COLORS.text2 }}>Check in before 7 PM to maintain today's recovery record.</div>
      </CmCard>

      {/* Per-addiction cards */}
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 12 }}>HOW DID TODAY GO?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16, marginBottom: 24 }}>
        {addictions.map(a => <CmAddictionCard key={a.id} a={a}
          status={adStatus[a.id]} onStatus={s => setAdStatus(p => ({ ...p, [a.id]: s }))}
          usage={adUsage[a.id]} onUsage={v => setAdUsage(p => ({ ...p, [a.id]: v }))}
          triggers={adTriggers[a.id] || []}
          onToggleTrigger={id => setAdTriggers(p => ({ ...p, [a.id]: p[a.id]?.includes(id) ? p[a.id].filter(x => x !== id) : [...(p[a.id] || []), id] }))}
        />)}
      </div>

      {/* Daily verdict */}
      <CmCard className="cm-recovery-card" style={{ padding: 24, marginBottom: 24, textAlign: "center", background: vm.bg }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 8 }}>TODAY'S RECOVERY</div>
        <div style={{ fontFamily: "'Georgia',serif", fontSize: 26, fontWeight: 400, color: vm.color, marginBottom: 6 }}>{vm.label}</div>
        <div style={{ fontSize: 12, color: CM_COLORS.text2 }}>{vm.sub}</div>
      </CmCard>

      {/* Reflection journal card */}
      <CmCard className="cm-coach-card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 10 }}>REFLECTION</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500}
          placeholder="What challenged you today? What helped? Any thoughts you'd like to remember?"
          style={{
            width: "100%", minHeight: 100, resize: "vertical", border: "none", outline: "none",
            fontFamily: "'Georgia',serif", fontSize: 14, lineHeight: 1.6, color: CM_COLORS.text,
            background: "transparent"
          }} />
        <div style={{ textAlign: "right", fontSize: 10, color: CM_COLORS.text3 }}>{notes.length}/500</div>
      </CmCard>

      {/* AI Recovery Plan — editable checklist */}
      {planItems.length > 0 && <CmCard className="cm-coach-card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: CM_COLORS.text3, marginBottom: 12 }}>MY RECOVERY PLAN</div>
        {planItems.map((item, i) => <div key={i} onClick={() => setPlanChecked(p => ({ ...p, [i]: !p[i] }))} style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0",
          borderTop: i ? `1px solid ${CM_COLORS.cardBorder}` : "none", cursor: "pointer"
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 6, flexShrink: 0, marginTop: 1,
            border: planChecked[i] ? "none" : `1.5px solid ${CM_COLORS.cardBorder}`,
            background: planChecked[i] ? CM_COLORS.accent2 : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>{planChecked[i] && <Check size={12} color="#fff" />}</div>
          <div style={{ fontSize: 13, color: planChecked[i] ? CM_COLORS.text3 : CM_COLORS.text, textDecoration: planChecked[i] ? "line-through" : "none" }}>{item}</div>
        </div>)}
      </CmCard>}

      {/* Submit */}
      <div className="cm-charts" style={{ textAlign: "center", marginBottom: 40 }}>
        {done ? <CmCard style={{ padding: 20, display: "inline-block" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: CM_COLORS.green }}>✓ Today's check-in is complete</div>
          {reply && <div style={{ fontSize: 12, color: CM_COLORS.text2, marginTop: 8, maxWidth: 420 }}>{reply}</div>}
        </CmCard> : <>
          <button onClick={submit} disabled={loading} style={{
            background: `linear-gradient(135deg,${CM_COLORS.accent2},${CM_COLORS.accent})`,
            border: "none", color: "#fff", padding: "16px 44px", borderRadius: 999,
            fontSize: 14, fontWeight: 700, letterSpacing: .3, cursor: loading ? "default" : "pointer",
            boxShadow: "0 8px 24px rgba(224,121,15,.28)", opacity: loading ? .7 : 1
          }}>{loading ? "Submitting…" : "Complete Today's Check-in"}</button>
          <div style={{ fontSize: 11, color: CM_COLORS.text3, marginTop: 10 }}>This takes less than two minutes and strengthens your recovery.</div>
        </>}
      </div>
    </div>
  </div>;
}

/* ─── ROOT ───────────────────────────────────────────────────────────────── */
function AppRoot() {
  const [screen, setScreen] = useState("boot");
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [plan, setPlan] = useState("");
  const [planLoading, setPL] = useState(false);
  const [pendingPlan, setPendingPlan] = useState("");
  const [pendingArch, setPendingArch] = useState(null);
  const [streak, setStreak] = useState(() => parseInt(ls.get("syn_streak", "0")));
  const [lastCI, setLastCI] = useState(() => ls.get("syn_last", null));
  const [savedPlan, setSP] = useState(() => ls.get("syn_plan", ""));
  const [planHistory, setPlanHist] = useState(() => {
    try {
      return JSON.parse(ls.get("syn_plan_history", "[]"));
    } catch {
      return [];
    }
  });
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(ls.get("syn_history", "[]"));
    } catch {
      return [];
    }
  });
  const [tr, setTr] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [milestone, setMilestone] = useState(null);
  const [toured, setToured] = useState(() => ls.get("syn_toured", "") !== "1");
  // Light UI removed — SYNAPSE is dark-only for now (a new theme system is
  // being built separately). Kept as a constant, not state, so nothing can
  // flip it at runtime and every downstream `theme==="light"` check stays false.
  const theme = "dark";
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [fcmToast, setFcmToast] = useState(null);
  // Monthly lifeline — one free pass per calendar month to forgive a missed
  // check-in day without resetting the streak. Stored as "YYYY-MM" of the
  // month it was last used; available again once the month rolls over.
  const [lifelineMonth, setLifelineMonth] = useState(() => ls.get("syn_lifeline_month", ""));
  const [showLifelinePrompt, setShowLifelinePrompt] = useState(false);
  const [missedDays, setMissedDays] = useState(0);
  const deferredInstallPrompt = useRef(null);
  const audioPlayRef = useRef(null);

  // Theme toggle removed along with light UI — no-op kept so existing
  // onThemeToggle props passed down the tree don't need to be ripped out.
  const handleThemeToggle = useCallback(() => {}, []);
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = G;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);
  useEffect(() => {
    "serviceWorker" in navigator && navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/"
    }).catch(() => {});
  }, []);

  // Capture PWA install prompt — also sync from module-level capture
  useEffect(() => {
    // Already captured at module level
    if (window.__installPrompt) deferredInstallPrompt.current = window.__installPrompt;
    const handler = e => {
      e.preventDefault();
      deferredInstallPrompt.current = e;
      window.__installPrompt = e;
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Notification permission — ask if not yet decided
  useEffect(() => {
    if (!authed) return;
    if (!("Notification" in window)) return;
    // If already granted — generate token silently
    if (Notification.permission === "granted") {
      generateFCMToken();
      return;
    }
    // If denied — do nothing
    if (Notification.permission === "denied") return;
    // If default — show prompt after 3s
    const t = setTimeout(() => setShowNotifPrompt(true), 3000);
    return () => clearTimeout(t);
  }, [authed]);

  // Shared token generation function
  const generateFCMToken = async () => {
    try {
      const {
        initializeApp,
        getApps
      } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const {
        getMessaging,
        getToken
      } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js");
      // Use same config as firebase.js — pulled from Vite env at build time
      const fcmConfig = {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID
      };
      const fcmApp = getApps().find(a => a.name === "fcm-token") || initializeApp(fcmConfig, "fcm-token");
      const fcmMsg = getMessaging(fcmApp);
      const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
        scope: "/"
      });
      const token = await getToken(fcmMsg, {
        vapidKey: "BMhfG52HfwVhnYK1aY0FmHGPI7tSDhB60etg8f-bvOYS0PFpmjk21RDqNS07W6MKScQm-W3w7RwA_SOwjjSQodc",
        serviceWorkerRegistration: swReg
      });
      if (token) {
        const stored = JSON.parse(localStorage.getItem("syn_user") || "{}");
        localStorage.setItem("syn_user", JSON.stringify({
          ...stored,
          fcmToken: token
        }));
        if (auth.currentUser?.uid && db) {
          try {
            await durableWrite(`fcmtoken_${auth.currentUser.uid}`, "users", auth.currentUser.uid, {
              fcmToken: token,
              lastSeen: serverTimestamp()
            });
          } catch (e) {
            console.warn("FCM token save failed:", e);
          }
        }
        console.log("✅ FCM token saved:", token.slice(0, 20) + "...");
      }
    } catch (e) {
      console.warn("FCM token gen:", e);
    }
  };

  // FCM token save after permission granted
  const requestNotifPermission = async () => {
    setShowNotifPrompt(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted" || permission === "denied") ls.set("syn_notif_asked", "1");
      if (permission !== "granted") return;
      await generateFCMToken();
      setFcmToast({
        title: "Notifications enabled ✓",
        body: "You'll get daily reminders and streak alerts."
      });
      setTimeout(() => setFcmToast(null), 4000);
    } catch (e) {
      console.warn("Notif permission:", e);
    }
  };

  // Foreground FCM messages — only if messaging available
  useEffect(() => {
    if (!authed || !messaging) return;
    try {
      const unsub = onMessage(messaging, payload => {
        const {
          title,
          body
        } = payload.notification || {};
        if (!title) return;
        setFcmToast({
          title,
          body: body || ""
        });
        setTimeout(() => setFcmToast(null), 5000);
      });
      return () => unsub();
    } catch (e) {
      console.warn("onMessage:", e);
    }
  }, [authed]);

  // Firebase auth state listener — restores session on page reload
  // PERF FIX: this used to `await` an identity write AND a streak getDoc
  // before ever calling setAuthLoading(false) — and authLoading gates the
  // ENTIRE app behind a full-screen spinner. So every signed-in user sat on
  // a blank spinner for two sequential Firestore round-trips (write + read)
  // before seeing any UI at all, while signed-out/incognito users hit the
  // `else` branch and got setAuthLoading(false) instantly. That's exactly
  // why incognito felt fast and signed-in felt slow — it wasn't the network
  // in general, it was this specific gate. Fix: resolve authLoading (and
  // render the app with whatever's already in localStorage) immediately,
  // then do the identity write + streak sync in the background and patch
  // state in when they resolve. Nothing about correctness changes — the
  // durable write queue already retries on failure — this only changes
  // WHEN the user is allowed to see the screen.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        const displayName = user.displayName || user.email?.split("@")[0] || "";
        ls.set("syn_user", JSON.stringify({
          email: user.email,
          name: displayName,
          uid: user.uid,
          photoURL: user.photoURL || ""
        }));
        setAuthed(true);
        setAuthLoading(false);
        // Land signed-in users on the home page too — they'll choose to
        // continue into the app via the Initialize/Begin button, which
        // routes them straight to check-in since they already have a plan.
        setScreen("boot");
        window.scrollTo(0, 0);
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        // Retry any Firestore writes that failed/got stuck in a previous session
        // (closed app mid-sync, was offline, auth wasn't ready yet, etc.)
        flushSyncQueue();

        // Everything below runs in the background — UI is already visible.
        (async () => {
          try {
            await durableWrite(`identity_${user.uid}`, "users", user.uid, {
              uid: user.uid,
              name: displayName,
              email: user.email || "",
              photoURL: user.photoURL || "",
              lastSeen: serverTimestamp()
            });
          } catch (e) {
            console.warn("Identity write failed:", e);
          }
          try {
            const snap = await getDoc(doc(db, "users", user.uid));
            if (snap.exists()) {
              const d = snap.data();
              if (typeof d.currentStreak === "number") {
                setStreak(d.currentStreak);
                ls.set("syn_streak", String(d.currentStreak));
              }
              if (d.lastCheckin) {
                setLastCI(d.lastCheckin);
                ls.set("syn_last", d.lastCheckin);
              }
            }
          } catch (e) {
            console.warn("Streak sync from Firestore failed:", e);
          }
        })();
      } else {
        setAuthed(false);
        setAuthLoading(false);
      }
    });
    return unsub;
  }, []);

  // Retry queued writes whenever the device regains connectivity — covers
  // the common case of a checkin/confess happening on patchy mobile data.
  useEffect(() => {
    const onOnline = () => flushSyncQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Periodically flush sync queue to ensure writes eventually reach Firestore
  useEffect(() => {
    const interval = setInterval(() => {
      flushSyncQueue();
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Play ambient on first any interaction — covers already-logged-in users
  useEffect(() => {
    const handler = () => {
      if (typeof window.__synapsePlayAmbient === "function") window.__synapsePlayAmbient();
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
    document.addEventListener("click", handler, {
      once: true
    });
    document.addEventListener("touchstart", handler, {
      once: true
    });
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);
  const topRef = useRef(null);
  const goTo = useCallback(s => {
    const forceTop = () => {
      document.documentElement.style.scrollBehavior = "auto";
      document.body.style.scrollBehavior = "auto";
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      // Body is the actual scrolling container in this app
      document.body.style.overflowY = "hidden";
      setTimeout(() => {
        document.body.style.overflowY = "auto";
      }, 300);
    };
    forceTop();
    setTr(true);
    setTimeout(() => {
      setScreen(s);
      setTr(false);
      document.body.style.overflow = "auto";
      document.body.style.overflowX = "hidden";
      forceTop();
      setTimeout(forceTop, 50);
      setTimeout(forceTop, 150);
    }, 260);
  }, []);
  const handleAuth = u => {
    ls.set("syn_user", JSON.stringify(u));
    if (pendingPlan) {
      setSP(pendingPlan);
      ls.set("syn_plan", pendingPlan);
    }
    if (pendingArch) {
      ls.set("syn_archetype", JSON.stringify(pendingArch));
    }
    setAuthed(true);
    setShowAuth(false);
    goTo(pendingPlan ? "checkin" : savedPlan ? "checkin" : "confess");
  };
  const handleBegin = () => {
    if (typeof window.__synapsePlayAmbient === "function") window.__synapsePlayAmbient();else if (audioPlayRef.current) audioPlayRef.current();
    goTo("confess");
  };
  const handleConfess = async (text, archData) => {
    const oldPlan = ls.get("syn_plan", "");
    if (oldPlan) {
      const ph = JSON.parse(ls.get("syn_plan_history", "[]"));
      ph.unshift({
        date: new Date().toISOString(),
        plan: oldPlan
      });
      const trimmed = ph.slice(0, 5);
      ls.set("syn_plan_history", JSON.stringify(trimmed));
      setPlanHist(trimmed);
    }
    if (archData) ls.set("syn_archetype", JSON.stringify(archData));
    setPL(true);
    setPlan("");
    goTo("plan");
    try {
      const reply = await callAI([{
        role: "user",
        content: text
      }], withTone(getConfessPrompt()));
      setPlan(reply);
      setSP(reply);
      ls.set("syn_plan", reply);
      // Save to Firestore — durable: queued + retried, never silently lost
      try {
        const uid = auth.currentUser?.uid;
        const u = JSON.parse(ls.get("syn_user", "{}"));
        const confessData = JSON.parse(ls.get("syn_confess", "{}"));
        if (uid) {
          await durableWrite(`user_${uid}`, "users", uid, {
            uid,
            name: u.name || "",
            email: u.email || "",
            photoURL: u.photoURL || auth.currentUser?.photoURL || "",
            archetype: archData?.title || "",
            addictions: confessData?.addictions || [],
            hoursPerDay: confessData?.hours || {},
            dob: u.dob || "",
            gender: u.gender || "",
            onboardedAt: serverTimestamp(),
            lastSeen: serverTimestamp()
          });
        }
      } catch (fe) {
        console.warn("Firestore write failed:", fe);
      }
    } catch (e) {
      setPlan(`Connection error: ${e.message}\n\nYour mission still stands. Show up every day.`);
    }
    setPL(false);
  };

  // Plan component calls this with the fresh plan string so we don't rely on async state
  const handleBeginDay1 = freshPlan => {
    if (freshPlan) {
      setSP(freshPlan);
      ls.set("syn_plan", freshPlan);
    }
    goTo("checkin");
  };
  const handleCheckin = async (msg, forcedStatus) => {
    if (detectCrisis(msg)) return {
      reply: CRISIS_RESPONSE,
      status: "CRISIS"
    };
    // AI safety classifier for indirect language (runs only if regex didn't catch it)
    const aiRisk = await checkSafetyRisk(msg);
    if (aiRisk) return {
      reply: CRISIS_RESPONSE,
      status: "CRISIS"
    };
    const today = new Date().toDateString();
    let rawReply = "";
    let aiFailed = false;
    try {
      // Archetype + recurring trigger pattern context — shared with the other
      // two coach entry points (Checkin.sendChat, Chat.send) so the AI has
      // identical "memory" everywhere, not just here.
      const coachCtx = getCoachContext();
      // If the caller computed a deterministic verdict from the user's own
      // structured answers (Checkin.computeStatus), tell the AI definitively
      // — it writes the coaching tone for that verdict, it doesn't get to
      // pick a different one. This is what actually drives the streak below.
      const verdictInstruction = forcedStatus ? `\n\n[OFFICIAL VERDICT: Today's outcome is ${forcedStatus}, based on the user's own structured report. Start your reply with "[STATUS:${forcedStatus}]" on its own line, then respond per your IF [STATUS:${forcedStatus}] instructions. This verdict is final — do not assign a different status.]` : "";
      rawReply = await callAI([{
        role: "user",
        content: savedPlan + coachCtx + verdictInstruction
      }, {
        role: "assistant",
        content: "Your mission begins now. Show up every day."
      }, {
        role: "user",
        content: `Day ${streak + 1} check-in: ${msg}`
      }], withTone(getCheckinPrompt()));
    } catch (e) {
      // The streak still updates correctly below (driven by forcedStatus, not
      // by this reply), but we note the failure so the fallback message can
      // match the real verdict instead of a fixed "you showed up" MID line.
      aiFailed = true;
      console.warn("Check-in coach reply failed:", e?.message || e);
    }

    // The deterministic verdict (from the user's own structured answers) is
    // the actual source of truth — NOT something parsed/guessed from the
    // AI's free-text reply. We still strip any [STATUS:...] tag from the
    // displayed text. Only falls back to AI-parsed status if no forcedStatus
    // was provided (defensive — current app always provides one).
    const statusMatch = rawReply.match(/\[STATUS:(WIN|SLIP|MID)\]/);
    const status = forcedStatus || (statusMatch ? statusMatch[1] : "MID");
    // If the coach call failed or returned nothing, fall back to a message that
    // MATCHES the real verdict. Previously the default was a fixed MID line
    // ("You showed up...") that got shown even under a SLIP "STREAK RESET" or
    // WIN banner — jarring and contradictory.
    if (aiFailed || !rawReply.trim()) {
      const FALLBACK = {
        WIN: "Day locked in. Couldn't reach the coach network just now — but your win still counts. Show up again tomorrow.",
        MID: "Logged. Couldn't reach the coach network just now, but showing up IS the fight. Back at it tomorrow.",
        SLIP: "Logged — the streak resets, but the mission doesn't. Couldn't reach the coach network just now; get back up tomorrow."
      };
      rawReply = `[STATUS:${status}]\n\n${FALLBACK[status] || FALLBACK.MID}`;
    }
    // Remove the tag from displayed reply
    const reply = rawReply.replace(/\[STATUS:(WIN|SLIP|MID)\]\n?/, "").trim();

    // Only increment streak on WIN or MID — SLIP resets to 0
    if (status === "SLIP") {
      setStreak(0);
      setLastCI(today);
      ls.set("syn_streak", "0");
      ls.set("syn_last", today);
      const nh = [{
        date: today,
        msg,
        streak: 0,
        status: "slip"
      }, ...history];
      setHistory(nh);
      ls.set("syn_history", JSON.stringify(nh));
    } else {
      const ns = streak + 1;
      setStreak(ns);
      setLastCI(today);
      ls.set("syn_streak", ns);
      ls.set("syn_last", today);
      const nh = [{
        date: today,
        msg,
        streak: ns,
        status: status.toLowerCase()
      }, ...history];
      setHistory(nh);
      ls.set("syn_history", JSON.stringify(nh));
      // Milestone celebration
      if ([7, 21, 30, 90].includes(ns)) {
        const seen = (() => {
          try {
            return JSON.parse(ls.get("syn_milestones", "[]"));
          } catch {
            return [];
          }
        })();
        if (!seen.includes(ns)) {
          ls.set("syn_milestones", JSON.stringify([...seen, ns]));
          setTimeout(() => setMilestone(ns), 1400);
        }
      }
    }

    // Firestore — save checkin + update user lastSeen/streak. Durable: queued
    // to localStorage first, retried with backoff, and re-attempted on next
    // app open if it fails now — so a network blip never silently drops
    // a day's progress from the admin dashboard / cross-device sync.
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        const checkinId = `${uid}_${today.replace(/\s/g, "_")}`;
        const finalStreak = status === "SLIP" ? 0 : streak + 1;
        await durableWrite(`checkin_${checkinId}`, "checkins", checkinId, {
          uid,
          date: today,
          status: status.toLowerCase(),
          streak: finalStreak,
          msg: msg.slice(0, 500),
          timestamp: serverTimestamp()
        });
        await durableWrite(`userstreak_${uid}`, "users", uid, {
          lastCheckin: today,
          lastSeen: serverTimestamp(),
          currentStreak: finalStreak
        });
      }
    } catch (fe) {
      console.warn("Firestore checkin write failed:", fe);
    }

    // Show PWA install prompt after check-in
    if (!ls.get("syn_pwa_prompted", "")) {
      setTimeout(() => setShowInstallPrompt(true), 1500);
    }

    // Show feedback after 3rd, 7th, 15th checkin
    const totalCI = history.length + 1;
    if ([3, 7, 15, 30].includes(totalCI)) {
      setTimeout(() => setShowFeedback(true), 3000);
    }
    return {
      reply,
      status
    };
  };

  /* ─── MISSED-DAY STREAK BREAK + MONTHLY LIFELINE ────────────────────────
     The app previously had no enforcement at all for missed days — if a
     user skipped check-ins for several days then came back, their streak
     just continued incrementing from wherever it was, completely ignoring
     the gap. This checks, once on load, whether more than one full
     calendar day has passed since the last check-in. If so:
       - If the monthly lifeline hasn't been used yet this month, ask the
         user whether to spend it to forgive the gap and keep the streak.
       - Otherwise (or if declined), the streak resets to 0, same as a SLIP.
     Calendar-day based (matches how "today"/"done" is computed everywhere
     else in this app via toDateString()), not a literal rolling 24h clock
     from the exact check-in timestamp — so a user who checks in at 11pm
     one day and 1am the next still counts as "checked in two days running".
  ──────────────────────────────────────────────────────────────────────── */
  const thisMonthKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }; // local calendar month, e.g. "2026-07" — was previously computed via toISOString() (UTC), which for positive-offset timezones (e.g. IST) reports the *previous* month for the first several hours of a new local month, occasionally denying a freshly-available lifeline right after a month rollover.

  const breakStreak = async missed => {
    const today = new Date().toDateString();
    setStreak(0);
    ls.set("syn_streak", "0");
    const nh = [{
      date: today,
      msg: `(missed ${missed} day${missed > 1 ? "s" : ""} — streak auto-reset)`,
      streak: 0,
      status: "slip",
      auto: true
    }, ...history];
    setHistory(nh);
    ls.set("syn_history", JSON.stringify(nh));
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await durableWrite(`userstreak_${uid}`, "users", uid, {
          currentStreak: 0,
          lastSeen: serverTimestamp()
        });
      } catch (e) {
        console.warn("Firestore breakStreak write failed:", e);
      }
    }
  };
  useEffect(() => {
    if (!lastCI || streak <= 0) return; // nothing to break for a brand-new or already-zero streak
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const lastStart = new Date(lastCI);
    lastStart.setHours(0, 0, 0, 0);
    const gapDays = Math.round((todayStart - lastStart) / 86400000);
    // gapDays 0 = checked in today already, 1 = checked in yesterday (fine).
    // 2+ = at least one full day was skipped entirely.
    if (gapDays >= 2) {
      const missed = gapDays - 1;
      if (lifelineMonth !== thisMonthKey()) {
        setMissedDays(missed);
        setShowLifelinePrompt(true);
      } else {
        breakStreak(missed);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount, against the initially-loaded streak/lastCI/lifeline values

  const useLifeline = () => {
    const month = thisMonthKey();
    const today = new Date().toDateString();
    ls.set("syn_lifeline_month", month);
    setLifelineMonth(month);
    setShowLifelinePrompt(false);
    // Forgive the gap: advance lastCI to today, same as a real check-in would.
    // BUGFIX: this used to be left untouched ("we deliberately don't touch
    // streak or lastCI here"), which meant the missed-day gap was still
    // sitting there unresolved. If the user closed the tab without checking
    // in right away and reopened the app later — even later the *same* day —
    // the mount effect above would run again, see the same stale gap, find
    // the lifeline already marked as used this month, and call breakStreak()
    // anyway. That's the exact "lifeline doesn't protect the streak" bug:
    // the streak silently reset on the very next reload after being "saved".
    // Advancing lastCI here closes the gap immediately so gapDays is 0/1 on
    // any later mount, and the streak count itself is untouched (still
    // forgiven, not incremented) — today's real check-in still increments
    // it normally through handleCheckin, exactly as before.
    setLastCI(today);
    ls.set("syn_last", today);
    const uid = auth.currentUser?.uid;
    if (uid) {
      durableWrite(`lifeline_${uid}_${month}`, "users", uid, {
        lastLifelineUsed: month,
        lastCheckin: today,
        lastSeen: serverTimestamp()
      });
    }
  };
  const declineLifeline = () => {
    setShowLifelinePrompt(false);
    breakStreak(missedDays);
  };
  const handleReset = () => {
    if (!confirm("Reset all progress? This cannot be undone.")) return;
    ["syn_streak", "syn_last", "syn_plan", "syn_plan_history", "syn_history", "syn_user", "syn_archetype", "syn_milestones", "syn_confess", "syn_trigger_log", "syn_chat_history"].forEach(k => ls.remove(k));
    setStreak(0);
    setLastCI(null);
    setSP("");
    setPlanHist([]);
    setHistory([]);
    setPlan("");
    setPendingPlan("");
    setPendingArch(null);
    setAuthed(false);
    setShowAuth(false);
    signOut(auth).catch(() => {});
    setScreen("boot");
    setTr(false);
    window.scrollTo({
      top: 0,
      behavior: "instant"
    });
  };
  return <div style={{
    background: "var(--bg)",
    minHeight: "100vh",
    width: "100%",
    overflowX: "hidden",
    color: "var(--text)",
    position: "relative"
  }}>
      {toured && <OnboardingTour onComplete={() => setToured(false)} />}
      <AmbientAudio onReady={fn => audioPlayRef.current = fn} />
      <CustomCursor />
      <SynapseBackground intensity={screen === "checkin" ? "heavy" : "normal"} />
      <FloatingNeurons />
      <div style={{
      position: "fixed",
      inset: 0,
      background: "var(--bg)",
      zIndex: 900,
      pointerEvents: "none",
      opacity: tr ? 1 : 0,
      transition: "opacity .26s ease"
    }} />

      {authLoading ? <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10
    }}>
          <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20
      }}>
            <NeuralMark size={56} />
            <div style={{
          display: "flex",
          gap: 6
        }}>{[0, 1, 2].map(i => <div key={i} style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ff9500",
            animation: `dotBlink 1s ${i * .2}s infinite`
          }} />)}</div>
          </div>
        </div> : authed ? <>
          {screen !== "boot" && screen !== "commandHome" && screen !== "commandCheckin" && <Nav screen={screen} goTo={goTo} savedPlan={savedPlan} onReset={handleReset} theme={theme} onThemeToggle={handleThemeToggle} onCommandMode={() => goTo("commandHome")} user={JSON.parse(ls.get("syn_user", "{}"))} />}
          <div key={screen} ref={topRef} style={{
        position: "relative",
        zIndex: 2,
        opacity: tr ? 0 : 1,
        transition: "opacity .26s ease"
      }}>
            {screen === "confess" && <Confess onSubmit={handleConfess} loading={planLoading} />}
            {screen === "plan" && <Plan plan={plan || savedPlan} loading={planLoading} onBegin={handleBeginDay1} onRetry={() => goTo("confess")} />}
            {screen === "checkin" && <Checkin streak={streak} savedPlan={savedPlan} lastCheckin={lastCI} onCheckin={handleCheckin} onGoChat={() => goTo("chat")} />}
            {screen === "commandHome" && <CommandHome goTo={goTo} streak={streak} savedPlan={savedPlan} userName={auth.currentUser?.displayName?.split(" ")[0]} onSwitchToFocus={() => goTo("checkin")} />}
            {screen === "commandCheckin" && <CommandCheckin goTo={goTo} streak={streak} savedPlan={savedPlan} lastCheckin={lastCI} onCheckin={handleCheckin} userName={auth.currentUser?.displayName?.split(" ")[0]} />}
            {screen === "history" && <History history={history} />}
            {screen === "urge" && <UrgeTimer streak={streak} savedPlan={savedPlan} />}
            {screen === "chat" && <Chat streak={streak} savedPlan={savedPlan} />}
            {screen === "report" && <Report history={history} savedPlan={savedPlan} streak={streak} planHistory={planHistory} />}
            {screen === "about" && <About onBegin={() => goTo(savedPlan ? "checkin" : "confess")} onBack={() => goTo(savedPlan ? "checkin" : "boot")} />}
            {screen === "boot" && <Boot onBegin={() => goTo(savedPlan ? "checkin" : "confess")} onLogin={null} hasPlan={!!savedPlan} theme={theme} onThemeToggle={handleThemeToggle} onAbout={() => goTo("about")} />}
          </div>
          {screen !== "boot" && <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 80,
        overflow: "hidden",
        width: "100%",
        maxWidth: "100%"
      }}><Marquee /></div>}
          {/* Emergency floating button — only on checkin screen */}
          {screen === "checkin" && <button className="sos-btn" onClick={() => setEmergency(true)} style={{
        position: "fixed",
        bottom: "clamp(20px,4vw,32px)",
        right: "clamp(12px,4vw,28px)",
        zIndex: 800,
        background: "linear-gradient(135deg,#cc1111,#8b0000)",
        border: "1px solid rgba(255,80,80,0.4)",
        borderRadius: 999,
        padding: "clamp(8px,1.5vw,13px) clamp(12px,2.5vw,22px)",
        color: "var(--text)",
        fontSize: "clamp(8px,1.8vw,11px)",
        fontWeight: 700,
        letterSpacing: "clamp(0.5px,0.3vw,1.5px)",
        textTransform: "uppercase",
        boxShadow: "0 0 20px rgba(255,30,30,0.35),0 6px 20px rgba(0,0,0,0.5)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "clamp(5px,1vw,9px)",
        fontFamily: "'Orbitron',sans-serif"
      }}>
              <span style={{
          fontSize: "clamp(11px,2.5vw,15px)"
        }}>🆘</span>
              <span>I'm Struggling</span>
            </button>}
          {emergency && <EmergencyOverlay savedPlan={savedPlan} streak={streak} onClose={() => setEmergency(false)} onCoach={() => {
        setEmergency(false);
        goTo("chat");
      }} />}
          {milestone && <MilestoneCelebration day={milestone} onClose={() => setMilestone(null)} />}
          <FcmToast toast={fcmToast} theme={theme} />
          {showLifelinePrompt && <LifelinePrompt theme={theme} missedDays={missedDays} onUse={useLifeline} onDecline={declineLifeline} />}
          {showNotifPrompt && <NotifPrompt theme={theme} onAllow={requestNotifPermission} onDismiss={() => setShowNotifPrompt(false)} />}
          {showFeedback && <FeedbackSheet theme={theme} onClose={() => setShowFeedback(false)} />}
          {showInstallPrompt && <InstallPrompt theme={theme} onDismiss={() => {
        setShowInstallPrompt(false);
        ls.set("syn_pwa_prompted", "1");
      }} onInstall={async () => {
        const prompt = deferredInstallPrompt.current || window.__installPrompt;
        if (prompt) {
          prompt.prompt();
          const {
            outcome
          } = await prompt.userChoice;
          deferredInstallPrompt.current = null;
          window.__installPrompt = null;
        }
        ls.set("syn_pwa_prompted", "1");
        setShowInstallPrompt(false);
      }} />}
          {screen !== "boot" && <div className="footer-wrap" style={{
        position: "relative",
        zIndex: 2,
        borderTop: "1px solid rgba(255,140,0,0.06)",
        padding: "28px clamp(16px,4vw,48px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: 16,
        background: "rgba(255,140,0,0.01)",
        boxSizing: "border-box",
        width: "100%"
      }}>
            <div style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}>
              <a href="mailto:synapserewire@gmail.com" style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11,
            color: "rgba(255,180,80,0.4)",
            letterSpacing: .5,
            textDecoration: "none",
            border: "1px solid rgba(255,140,0,0.12)",
            borderRadius: 999,
            padding: "7px 16px",
            transition: "all .3s",
            fontWeight: 500
          }} onMouseEnter={e => {
            e.currentTarget.style.color = "#ffb347";
            e.currentTarget.style.borderColor = "rgba(255,140,0,0.45)";
            e.currentTarget.style.background = "rgba(255,140,0,0.07)";
          }} onMouseLeave={e => {
            e.currentTarget.style.color = "rgba(255,180,80,0.4)";
            e.currentTarget.style.borderColor = "rgba(255,140,0,0.12)";
            e.currentTarget.style.background = "transparent;";
          }}><span>✉</span><span>synapserewire@gmail.com</span></a>
              
            </div>
          </div>}
        </> : showAuth ? <div style={{
      position: "relative",
      zIndex: 2
    }}>
          <Auth onAuth={handleAuth} context={pendingPlan ? "lock" : ""} />
        </div> : <div style={{
      position: "relative",
      zIndex: 2
    }}>
          {screen === "confess" && <Confess onSubmit={handleConfess} loading={planLoading} />}
          {screen === "plan" && <Plan plan={plan} loading={planLoading} onBegin={() => setShowAuth(true)} onRetry={() => goTo("confess")} />}
          {screen === "about" && <About onBegin={handleBegin} onBack={() => goTo("boot")} />}
          {screen === "boot" && <Boot onBegin={handleBegin} onLogin={() => setShowAuth(true)} hasPlan={false} theme={theme} onThemeToggle={handleThemeToggle} onAbout={() => goTo("about")} />}
        </div>}
    </div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   ERROR BOUNDARY — catches render crashes anywhere in the app
   React error boundaries MUST be class components — there is no hook
   equivalent for componentDidCatch/getDerivedStateFromError as of React 19.

   Without this, an uncaught error thrown during render ANYWHERE in this
   ~5,500-line single-file app (a bad API response shape, an unexpected
   null, a third-party lib edge case, etc.) unmounts the entire React tree
   and the user sees a blank white screen with zero explanation and no way
   back in short of manually clearing site data. This catches that, shows
   a real "something broke" screen with a reload button, and logs the
   actual error to the console (and localStorage, so it survives the
   reload if you ask the user to check it) so it's debuggable afterward.

   This does NOT touch or risk any user data — streak/history/plan are
   already persisted independently via localStorage + Firestore on every
   write, so a render crash after that point never loses saved progress.
──────────────────────────────────────────────────────────────────────────── */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error
    };
  }
  componentDidCatch(error, info) {
    console.error("SYNAPSE crashed:", error, info?.componentStack);
    // Keep a small trail of the last few crashes in localStorage so a
    // report from a user ("app broke, white screen") is actually
    // debuggable afterward instead of a total mystery.
    try {
      const log = JSON.parse(localStorage.getItem("syn_crash_log") || "[]");
      log.push({
        msg: error?.message || String(error),
        stack: (error?.stack || "").slice(0, 800),
        ts: Date.now()
      });
      localStorage.setItem("syn_crash_log", JSON.stringify(log.slice(-10)));
    } catch {}
  }
  handleReload = () => {
    this.setState({
      hasError: false,
      error: null
    });
    window.location.reload();
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    return <div style={{
      position: "fixed",
      inset: 0,
      background: "#07040a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px",
      textAlign: "center",
      fontFamily: "'Inter',sans-serif",
      zIndex: 99999
    }}>
        <div style={{
        fontSize: 40,
        marginBottom: 20,
        filter: "drop-shadow(0 0 20px rgba(255,140,0,0.4))"
      }}>⚡</div>
        <div style={{
        fontFamily: "'Orbitron',sans-serif",
        fontSize: 18,
        fontWeight: 800,
        color: "#fff",
        letterSpacing: .5,
        marginBottom: 12
      }}>Something broke</div>
        <div style={{
        fontSize: 13,
        color: "rgba(255,255,255,0.5)",
        lineHeight: 1.7,
        maxWidth: 380,
        marginBottom: 28
      }}>
          SYNAPSE hit an unexpected error. Your streak and progress are saved — reloading should fix this.
          If it keeps happening, email <span style={{
          color: "#ffb347"
        }}>synapserewire@gmail.com</span>.
        </div>
        <button onClick={this.handleReload} style={{
        background: "linear-gradient(135deg,#ff9500,#ff5000)",
        border: "none",
        color: "#fff",
        padding: "14px 36px",
        borderRadius: 999,
        fontFamily: "'Inter',sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: .3,
        cursor: "pointer",
        boxShadow: "0 0 40px rgba(255,140,0,0.35)"
      }}>
          Reload SYNAPSE
        </button>
      </div>;
  }
}
export default function App() {
  return <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>;
}