import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * Build-time prerender of the homepage.
 *
 * SYNAPSE is a client-rendered SPA: the shipped index.html contains only an
 * empty <div id="root"></div>, so crawlers that don't execute JS (Bing, social
 * scrapers, most AI/LLM crawlers) index a blank page. This plugin injects a
 * static, semantic snapshot of the landing page into #root at build time.
 *
 * This is NOT SSR and does NOT touch the app: main.jsx mounts with
 * createRoot().render(), which clears #root and renders the real interactive
 * app on load. So the static markup is purely for the no-JS / first-paint case
 * and is replaced the instant React mounts — UI, auth, and behavior are
 * unchanged. Content below faithfully mirrors the real landing page (no
 * cloaking): same product, tagline, features, and recovery levels the app shows.
 */
const PRERENDER_HOME = `
  <div id="ssr-home" style="min-height:100vh;background:#07040a;color:#f4ece2;font-family:'Space Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:48px 24px;">
    <main style="max-width:760px;width:100%;text-align:center;">
      <p style="font-size:13px;letter-spacing:4px;text-transform:uppercase;color:#ffab5e;margin:0 0 20px;">AI Dopamine Recovery &middot; Habit Tracker</p>
      <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(40px,9vw,72px);line-height:1;letter-spacing:6px;margin:0 0 18px;background:linear-gradient(135deg,#ffffff,#ffcc00 60%,#ff9500);-webkit-background-clip:text;background-clip:text;color:transparent;">SYNAPSE</h1>
      <p style="font-size:22px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#fff6ea;margin:0 0 28px;">Reset. Rewire. Rise.</p>
      <p style="font-size:17px;line-height:1.7;color:#c9bcae;margin:0 auto 36px;max-width:640px;">SYNAPSE is an AI-powered dopamine recovery and habit tracker that helps you quit compulsive habits &mdash; porn, social media, reels, gaming, junk food and more &mdash; one day at a time. Reset your brain, rewire your habits, and rise above addiction.</p>

      <section style="text-align:left;max-width:560px;margin:0 auto 32px;">
        <h2 style="font-family:'Orbitron',sans-serif;font-size:20px;letter-spacing:2px;color:#ffab5e;margin:0 0 14px;">What you get</h2>
        <ul style="font-size:16px;line-height:1.8;color:#c9bcae;padding-left:20px;margin:0;">
          <li>AI check-ins that adapt to your language &mdash; English, Hindi, Hinglish, and more</li>
          <li>Personalized recovery battle plans generated from your specific struggles</li>
          <li>Streak tracking across 7 levels: Compromised, Awakening, Stabilizing, Rewiring, Recalibrated, Optimized, Synapsed</li>
          <li>Emergency support for urge and relapse moments</li>
          <li>Private and secure, installable as a PWA that works offline</li>
        </ul>
      </section>

      <section style="text-align:left;max-width:560px;margin:0 auto 36px;">
        <h2 style="font-family:'Orbitron',sans-serif;font-size:20px;letter-spacing:2px;color:#ffab5e;margin:0 0 14px;">How it works</h2>
        <ol style="font-size:16px;line-height:1.8;color:#c9bcae;padding-left:20px;margin:0;">
          <li>Confess your battle &mdash; tell SYNAPSE exactly what you are fighting</li>
          <li>Get your plan &mdash; the AI forges a custom recovery mission for you</li>
          <li>Check in daily &mdash; build streaks and rewire your brain over time</li>
        </ol>
      </section>

      <p style="font-size:16px;color:#f4ece2;margin:0;">Start your recovery at <a href="https://www.synapserewire.site/" style="color:#ff9500;text-decoration:none;font-weight:600;">synapserewire.site</a></p>
    </main>

    <article aria-label="About SYNAPSE" style="max-width:820px;margin:0 auto;padding:24px;text-align:left;color:#c9bcae;line-height:1.75;">
      <h2 style="font-family:'Orbitron',sans-serif;font-size:28px;letter-spacing:2px;color:#ffab5e;margin:48px 0 16px;">About SYNAPSE</h2>
      <p style="font-size:18px;color:#fff6ea;font-weight:600;margin:0 0 14px;">Break the habit today, or stay in the loop tomorrow.</p>
      <p style="margin:0 0 16px;">SYNAPSE is an AI-powered accountability and habit-building platform that helps people overcome addictive habits &mdash; including doomscrolling, social media addiction, pornography, gaming, caffeine, junk food and gambling &mdash; through personalized guidance, real-time interventions, and intelligent behavior change. Reset &middot; Rewire &middot; Reconquer.</p>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">The problem: habits are built quietly</h3>
      <p style="margin:0 0 12px;">Addictive habits rarely begin with a lack of ambition. They begin with small decisions repeated every day &mdash; one more scroll, one more game, one more excuse. Over time those moments become patterns, and those patterns quietly shape our attention, our decisions, and the lives we live.</p>
      <p style="margin:0 0 12px;">Millions of people recognise the issue and want to change, yet most don't have the right system to help them stay consistent when it matters most. Blockers remove access but rarely change behavior; generic habit trackers provide data without meaningful guidance; most solutions stop at tracking progress instead of helping users navigate moments of temptation.</p>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">The insight: it was never about willpower</h3>
      <p style="margin:0 0 12px;">Breaking a habit isn't about having stronger willpower &mdash; it's about having the right support at the right moment. Real behavior change happens when people understand their patterns, receive personalized guidance, and build systems that make better choices easier over time. Most existing solutions focus on restricting behavior; we believe lasting change comes from understanding behavior, adapting to the individual, and creating accountability that evolves with them.</p>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">The solution: SYNAPSE adapts to you</h3>
      <p style="margin:0 0 12px;">Whether someone is trying to quit doomscrolling, reduce screen time, stop gambling, overcome pornography addiction, or build healthier routines, SYNAPSE adapts to their individual journey instead of offering one-size-fits-all advice. It combines AI-powered accountability, dopamine and addiction recovery, an AI coach, adaptive habit systems, and real-time guidance to help people understand why habits occur and build healthier ones.</p>
      <ul style="margin:0 0 12px;padding-left:20px;">
        <li><strong>Understand</strong> &mdash; SYNAPSE learns your addictions, habits, goals, routines, and the situations that lead to unhealthy decisions.</li>
        <li><strong>Guide</strong> &mdash; it delivers personalized support, practical interventions, and adaptive recommendations when they're needed most.</li>
        <li><strong>Grow</strong> &mdash; as you progress, it continuously adapts to your journey, helping you build stronger habits and lasting discipline.</li>
      </ul>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">Mission &amp; vision</h3>
      <p style="margin:0 0 12px;"><strong>Mission:</strong> to empower people to overcome addictive habits by combining intelligent technology with personalized accountability, making lasting behavior change more accessible to everyone.</p>
      <p style="margin:0 0 12px;"><strong>Vision:</strong> a future where overcoming addictive habits is no longer limited by willpower alone, but supported by intelligent systems that help people make better decisions every day &mdash; building the world's most trusted AI platform for lasting behavior change.</p>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">Founders</h3>
      <p style="margin:0 0 12px;"><strong>Parth Goyal</strong> &mdash; Co-Founder &amp; CEO. Focus: engineering, AI systems, technical strategy, and product development. Built the first prototype of SYNAPSE and leads the platform's technical architecture, engineering, and AI development.</p>
      <p style="margin:0 0 12px;"><strong>Sandali Tiwari</strong> &mdash; Co-Founder &amp; COO. Focus: product management, marketing, operations, and growth. Leads product strategy, user research, marketing, branding, partnerships, and company operations to ensure SYNAPSE is built around real user needs.</p>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">Our values</h3>
      <ul style="margin:0 0 12px;padding-left:20px;">
        <li><strong>Discipline over motivation</strong> &mdash; sustainable systems outperform temporary inspiration.</li>
        <li><strong>People before metrics</strong> &mdash; every decision begins with understanding the people we serve.</li>
        <li><strong>Continuous improvement</strong> &mdash; small, consistent progress creates meaningful change.</li>
        <li><strong>Build with purpose</strong> &mdash; technology should empower people, not compete for their attention.</li>
      </ul>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">Traditional solutions vs SYNAPSE</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:1px solid rgba(255,140,0,0.2);color:#8a7040;">Traditional solutions</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid rgba(255,140,0,0.2);color:#f5a000;">SYNAPSE</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:7px;">Restricts behavior</td><td style="padding:7px;">Helps build better behavior</td></tr>
          <tr><td style="padding:7px;">Generic advice</td><td style="padding:7px;">Personalized AI guidance</td></tr>
          <tr><td style="padding:7px;">Static habit trackers</td><td style="padding:7px;">Adaptive accountability</td></tr>
          <tr><td style="padding:7px;">Depends on willpower</td><td style="padding:7px;">Builds sustainable lasting systems</td></tr>
          <tr><td style="padding:7px;">Reactive after relapse</td><td style="padding:7px;">Proactive, real-time interventions</td></tr>
          <tr><td style="padding:7px;">One-size-fits-all plans</td><td style="padding:7px;">Personalized behavior-change journeys</td></tr>
          <tr><td style="padding:7px;">Focus on blocking distractions</td><td style="padding:7px;">Focus on understanding and replacing habits</td></tr>
          <tr><td style="padding:7px;">Data without context</td><td style="padding:7px;">Insights with actionable guidance</td></tr>
        </tbody>
      </table>

      <h3 style="font-family:'Orbitron',sans-serif;font-size:19px;color:#ffab5e;margin:34px 0 12px;">How we build</h3>
      <p style="margin:0 0 12px;">We build alongside our users, not ahead of them. Every feature begins with a real problem, is shaped through user feedback, and is refined through continuous iteration. Our goal isn't to maximize screen time &mdash; it's to help people spend less time fighting compulsive habits and more time living intentionally.</p>

      <p style="margin:24px 0 0;color:#8a7861;font-size:14px;">SYNAPSE is a self-help habit-recovery tool, not medical or clinical treatment.</p>
    </article>

    <footer style="max-width:820px;margin:0 auto;padding:32px 24px 8px;border-top:1px solid rgba(255,140,0,0.15);text-align:left;color:#8a7861;font-size:14px;">
      <p style="margin:0 0 8px;"><strong style="color:#a9998a;font-weight:600;">Guides:</strong> <a href="/quit/reels" style="color:#ff9500;text-decoration:none;">How to stop watching reels</a> &middot; <a href="/quit/porn" style="color:#ff9500;text-decoration:none;">Stop watching porn</a> &middot; <a href="/quit/social-media" style="color:#ff9500;text-decoration:none;">Quit social media</a> &middot; <a href="/quit/gaming" style="color:#ff9500;text-decoration:none;">Stop compulsive gaming</a> &middot; <a href="/quit/gambling" style="color:#ff9500;text-decoration:none;">Stop gambling</a> &middot; <a href="/quit/junk-food" style="color:#ff9500;text-decoration:none;">Stop eating junk food</a> &middot; <a href="/quit/doomscrolling" style="color:#ff9500;text-decoration:none;">Stop doomscrolling</a></p>
      <p style="margin:0 0 8px;">Contact: <a href="mailto:synapserewire@gmail.com" style="color:#ff9500;text-decoration:none;">synapserewire@gmail.com</a></p>
      <p style="margin:0;">
        <a href="/privacy" style="color:#ff9500;text-decoration:none;margin-right:20px;">Privacy Policy</a>
        <a href="/terms" style="color:#ff9500;text-decoration:none;">Terms of Service</a>
      </p>
    </footer>
  </div>
`.trim()

// Injects the prerendered homepage into the built index.html (#root).
function prerenderHome() {
  return {
    name: 'synapse-prerender-home',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          '<div id="root"></div>',
          `<div id="root">${PRERENDER_HOME}</div>`,
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), prerenderHome()],
  build: {
    // SYNAPSE ships as a single large App.jsx (5800+ lines) — raise the warning
    // threshold so the build doesn't spam chunk-size warnings on every deploy.
    // Real fix for bundle size is code-splitting AdminDashboard via React.lazy()
    // which requires extracting it to its own file (pending task).
    chunkSizeWarningLimit: 1500,
  },
})
