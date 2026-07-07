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
