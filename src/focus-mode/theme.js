/* ─────────────────────────────────────────────────────────────────────────
   FOCUS MODE — DESIGN TOKENS
   ─────────────────────────────────────────────────────────────────────────
   Single source of truth for every color, type, spacing, radius and shadow
   value used across Focus Mode. Every future Focus Mode screen should pull
   from `fm` (tokens) and the shared primitives in components.jsx instead of
   hardcoding values — that's what keeps 6+ screens visually identical.

   NAMESPACING: everything here is prefixed `--fm-*` and only ever applied
   inside an element carrying the `.focus-mode` class. Command Mode's own
   CSS variables (--text, --bg, --accent, etc., defined elsewhere in
   App.jsx) are completely untouched — the two systems never collide, so
   Focus Mode can be mounted alongside Command Mode with zero visual bleed.
──────────────────────────────────────────────────────────────────────── */

import { useState, useEffect } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   RESPONSIVE HOOK — single source of truth for layout breakpoints.
   Every page computes its own layout values (grid columns, flex direction,
   paddings that need to differ structurally, sidebar layout) directly from
   this hook instead of relying on injected CSS / media queries. Desktop and
   mobile literally render different values from component logic, so there
   is no CSS specificity or !important to fight.
   Breakpoint matches the project's original mobile boundary (≤768px).
──────────────────────────────────────────────────────────────────────── */
export function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export function useResponsive() {
  const width = useViewportWidth();
  return { width, isMobile: width <= 768, isTablet: width > 768 && width < 1024, isDesktop: width >= 1024 };
}

export const fm = {
  color: {
    // Warm ivory canvas + soft amber glow, matching the approved Home mock
    bg: "#F6F0E5",
    bgGlowAmber: "rgba(255,176,94,0.35)",
    bgGlowPeach: "rgba(255,208,168,0.28)",

    surface: "#FFFFFF",
    surfaceMuted: "#FBF7EF",
    surfaceSunken: "#F3ECE0",

    border: "rgba(60,42,20,0.08)",
    borderStrong: "rgba(60,42,20,0.14)",

    textPrimary: "#2A2016",
    textSecondary: "#8C7C67",
    textTertiary: "#B7A992",
    textInverse: "#FFF8EE",

    accent: "#DD7A31",
    accentDeep: "#C2601F",
    accentSoft: "#FCEAD3",
    accentSoftBorder: "rgba(221,122,49,0.28)",

    success: "#4E8F5B",
    successSoft: "#E6F3E7",
    successBorder: "rgba(78,143,91,0.28)",

    warning: "#C98A1F",
    warningSoft: "#FBF0D9",
    warningBorder: "rgba(201,138,31,0.28)",

    danger: "#D65C4A",
    dangerSoft: "#FBE3DE",
    dangerBorder: "rgba(214,92,74,0.28)",

    info: "#3E7FBD",
    infoSoft: "#E4EEF8",
  },

  radius: {
    sm: 10,
    md: 16,
    lg: 22,
    xl: 28,
    pill: 999,
  },

  space: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80],

  shadow: {
    card: "0 1px 2px rgba(42,32,20,0.04), 0 10px 28px rgba(42,32,20,0.06)",
    cardHover: "0 2px 4px rgba(42,32,20,0.05), 0 16px 36px rgba(42,32,20,0.09)",
    pop: "0 8px 24px rgba(221,122,49,0.22)",
  },

  font: {
    display: "'Fraunces', 'Iowan Old Style', Georgia, serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },

  // Recovery-phase colors, deliberately distinct from Command Mode's LEVELS
  // palette so Focus Mode reads as its own coherent surface while encoding
  // the exact same phase data.
  phase: [
    { min: 0, color: "#D65C4A" },
    { min: 3, color: "#DD7A31" },
    { min: 7, color: "#C98A1F" },
    { min: 14, color: "#4E8F5B" },
    { min: 30, color: "#3E7FBD" },
    { min: 60, color: "#8B5FBF" },
    { min: 90, color: "#2A2016" },
  ],
};

export function phaseColor(streak) {
  const list = [...fm.phase].reverse();
  return (list.find((p) => streak >= p.min) || fm.phase[0]).color;
}

let injected = false;

/** Injects the scoped Focus Mode stylesheet (fonts, resets, keyframes,
 *  CSS custom properties) exactly once per page load. Call from the
 *  Focus Mode root/shell component — never from individual screens. */
export function injectFocusModeStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.textContent = `
    /* Force full-bleed: some ancestor container (likely a max-width meant
       for the marketing/boot page) was constraining Focus Mode's width,
       showing as dark gutters on either side. This overrides it at the
       html/body/#root level the moment Focus Mode mounts. */
    html:has(.focus-mode), body:has(.focus-mode) {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    #root:has(.focus-mode) {
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .focus-mode {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      --fm-bg: ${fm.color.bg};
      --fm-surface: ${fm.color.surface};
      --fm-surface-muted: ${fm.color.surfaceMuted};
      --fm-border: ${fm.color.border};
      --fm-text: ${fm.color.textPrimary};
      --fm-text2: ${fm.color.textSecondary};
      --fm-text3: ${fm.color.textTertiary};
      --fm-accent: ${fm.color.accent};
      --fm-accent-soft: ${fm.color.accentSoft};
      font-family: ${fm.font.body};
      color: var(--fm-text);
      background: var(--fm-bg);
      min-height: 100vh;
      position: relative;
      -webkit-font-smoothing: antialiased;
    }
    .focus-mode *, .focus-mode *::before, .focus-mode *::after {
      box-sizing: border-box;
    }
    .focus-mode button {
      font-family: inherit;
      cursor: pointer;
    }
    .focus-mode ::selection {
      background: ${fm.color.accentSoft};
      color: ${fm.color.accentDeep};
    }
    .focus-mode a { color: inherit; text-decoration: none; }

    @keyframes fmFadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fmPulseGlow {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
    @keyframes fmFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    .fm-fade-up { animation: fmFadeUp .5s cubic-bezier(.16,1,.3,1) both; }
    .fm-icon-pop:hover { transform: scale(1.1); }
    .fm-reveal { opacity: 0; transform: translateY(16px); transition: opacity .5s ease-out, transform .5s ease-out; }
    .fm-reveal.fm-reveal-in { opacity: 1; transform: translateY(0); }
    .fm-hover-card { transition: transform .22s ease-out, box-shadow .22s ease-out, filter .22s ease-out; }
    .fm-hover-card:hover { transform: translateY(-3px); filter: brightness(1.015); }
    .fm-hover-card--primary:hover { box-shadow: 0 26px 64px -18px rgba(42,32,20,0.24); }
    .fm-hover-card--secondary:hover { box-shadow: 0 18px 44px -14px rgba(42,32,20,0.2); }
    .fm-hover-card--small:hover { box-shadow: 0 11px 27px -10px rgba(42,32,20,0.18); }
    .fm-heat-cell { transition: transform .15s ease-out, box-shadow .15s ease-out; cursor: pointer; }
    .fm-heat-cell:hover { transform: scale(1.12); box-shadow: 0 4px 10px -2px rgba(42,32,20,0.25); }
    .fm-row-hover { transition: background .18s ease-out; }
    .fm-row-hover:hover { background: #fffdf9; cursor: pointer; }

    @media (prefers-reduced-motion: reduce) {
      .focus-mode * { animation-duration: 0.001ms !important; }
    }
  `;
  document.head.appendChild(style);
}