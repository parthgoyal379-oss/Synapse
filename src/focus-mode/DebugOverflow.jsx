/* ─────────────────────────────────────────────────────────────────────────
   TEMPORARY DEBUG TOOL — NOT PART OF THE PRODUCT UI
   ─────────────────────────────────────────────────────────────────────────
   Mount <DebugOverflow page="home" /> once near the top of a Focus Mode
   page. Inert unless the URL has ?debug=1 or ?debug=layout (or #debug,
   treated the same as ?debug=1). Safe to leave imported while testing on
   a real device. Two-step removal when done:
     1. delete this file
     2. remove the <DebugOverflow page="..." /> line + its import from each
        of the 4 page files

   ── ?debug=1 : overflow audit ──────────────────────────────────────────
     - Walks every element inside .focus-mode on the REAL rendered page
       (your real data, your real device, no mock/synthetic content).
     - Flags any element whose own rendered width exceeds its parent's
       clientWidth.
     - Draws a red outline on flagged elements (outline, not border, so it
       can't itself change layout/width).
     - For each flagged element, logs to console: computed styles (display,
       position, width, min-width, max-width, flex, flex-basis, overflow,
       overflow-x, white-space, grid-template-columns, transform),
       scrollWidth/clientWidth/boundingClientRect, and the full parent
       chain up to .focus-mode.
     - Within that chain, separately identifies and highlights (orange
       outline) the nearest ancestor matching any of: overflow:hidden,
       width > its own parent, min-width > its own parent, an explicit
       fixed pixel width set inline, or a translateX/scale transform — the
       concrete, checkable reasons an ancestor can cause clipping.
     - Briefly flashes the identified culprit element(s) so it's visually
       obvious which box on screen is the problem.
     - Floating panel (bottom-right): viewport width, .focus-mode width,
       main width, active page, and a "Copy Debug Report" button that
       copies viewport size, devicePixelRatio, user agent, route, and the
       full flagged-element + parent-chain + computed-style data as JSON.

   ── ?debug=layout : layout paint mode ───────────────────────────────────
     - Paints every flex/grid container inside .focus-mode with a distinct
       dashed outline colour and a floating label showing its display type
       and live computed width, so you can see the whole containment
       hierarchy at a glance instead of hunting one element at a time.
──────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState } from "react";

const STYLE_PROPS = ["display", "position", "width", "minWidth", "maxWidth", "flex", "flexBasis", "overflow", "overflowX", "whiteSpace", "gridTemplateColumns", "transform"];

function debugMode() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("debug");
  if (q === "1" || window.location.hash === "#debug") return "audit";
  if (q === "layout") return "layout";
  return null;
}

function pickStyles(el) {
  const cs = getComputedStyle(el);
  const out = {};
  STYLE_PROPS.forEach((p) => (out[p] = cs[p]));
  return out;
}

function describe(el) {
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    cls: typeof el.className === "string" ? el.className.slice(0, 40) : "",
    text: (el.textContent || "").trim().slice(0, 30),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), right: Math.round(r.right) },
    styles: pickStyles(el),
  };
}

// concrete, checkable reasons an ancestor link can be the actual cause
function clippingReasons(node, parent) {
  if (!parent) return [];
  const cs = getComputedStyle(node);
  const reasons = [];
  const pw = parent.clientWidth;
  const ew = Math.round(node.getBoundingClientRect().width);
  if (cs.overflow === "hidden" || cs.overflowX === "hidden") reasons.push("overflow:hidden");
  if (ew > pw + 1) reasons.push(`width(${ew}px) > parent(${pw}px)`);
  const inlineMinWidth = node.style.minWidth;
  if (inlineMinWidth && inlineMinWidth.endsWith("px")) {
    const mw = parseFloat(inlineMinWidth);
    if (mw > pw) reasons.push(`min-width(${mw}px) > parent(${pw}px)`);
  }
  const inlineWidth = node.style.width;
  if (inlineWidth && inlineWidth.endsWith("px")) reasons.push(`fixed inline width:${inlineWidth}`);
  if (node.style.transform && (node.style.transform.includes("translateX") || node.style.transform.includes("scale"))) {
    reasons.push(`transform:${node.style.transform}`);
  }
  return reasons;
}

function flashElement(el) {
  if (!el || !el.animate) return;
  el.animate(
    [
      { outlineColor: "#ff0000", backgroundColor: "rgba(255,0,0,0.25)" },
      { outlineColor: "#ff0000", backgroundColor: "rgba(255,0,0,0.05)" },
      { outlineColor: "#ff0000", backgroundColor: "rgba(255,0,0,0.25)" },
      { outlineColor: "#ff0000", backgroundColor: "rgba(255,0,0,0.05)" },
      { outlineColor: "#ff0000", backgroundColor: "transparent" },
    ],
    { duration: 1400, iterations: 1 }
  );
}

function auditOnce(pageLabel) {
  const root = document.querySelector(".focus-mode");
  if (!root) return { count: 0, report: null };

  root.querySelectorAll("[data-fm-debug-outline]").forEach((el) => {
    el.style.outline = "";
    el.removeAttribute("data-fm-debug-outline");
  });

  const all = root.querySelectorAll("*");
  const flagged = [];
  all.forEach((el) => {
    const parent = el.parentElement;
    if (!parent || !root.contains(parent)) return;
    const ew = Math.round(el.getBoundingClientRect().width);
    const pw = parent.clientWidth;
    if (ew > pw + 1 && ew > 0) flagged.push(el);
  });

  console.log(`%c[fm-debug] ${pageLabel}: scanned ${all.length} elements inside .focus-mode, found ${flagged.length} wider-than-parent`, "font-weight:bold;color:#c00");

  const flaggedReport = [];
  const culprits = [];

  flagged.forEach((el, i) => {
    el.style.outline = "2px solid #ff0000";
    el.style.outlineOffset = "-2px";
    el.setAttribute("data-fm-debug-outline", "1");

    const chain = [];
    let node = el;
    while (node && node !== root.parentElement) {
      const parent = node.parentElement;
      const pw = parent ? parent.clientWidth : null;
      const ew = Math.round(node.getBoundingClientRect().width);
      const overflowsParent = parent ? ew > pw + 1 : false;
      const reasons = clippingReasons(node, parent);
      chain.push({ node, ew, pw, overflowsParent, reasons, styles: pickStyles(node) });
      if (node === root) break;
      node = parent;
    }

    // "root cause" = outermost link (nearest .focus-mode) that already overflows its own parent
    let rootCause = null;
    for (let j = chain.length - 1; j >= 0; j--) {
      if (chain[j].overflowsParent) {
        rootCause = chain[j];
        break;
      }
    }
    // "suspect ancestor" = NEAREST ancestor (walking up from the element) with a concrete reason
    const suspect = chain.find((link, idx) => idx > 0 && link.reasons.length > 0) || null;
    if (suspect) {
      suspect.node.style.outline = "2px dashed #ff8800";
      suspect.node.style.outlineOffset = "-2px";
      suspect.node.setAttribute("data-fm-debug-outline", "1");
      culprits.push(suspect.node);
    }
    if (rootCause) culprits.push(rootCause.node);

    console.groupCollapsed(`[fm-debug] #${i + 1} flagged element`, describe(el));
    console.log("computed styles:", pickStyles(el));
    console.log("scrollWidth:", el.scrollWidth, "clientWidth:", el.clientWidth, "boundingClientRect:", el.getBoundingClientRect());
    console.log("parent chain (leaf → .focus-mode):");
    chain.forEach((link, idx) => {
      console.log(
        `${idx === 0 ? "  ↳ (flagged element itself)" : "  ↳ ancestor"} width=${link.ew}px vs parent.clientWidth=${link.pw}px  ${link.overflowsParent ? "⚠ OVERFLOWS ITS PARENT" : "ok"}${link.reasons.length ? "  reasons: " + link.reasons.join(", ") : ""}`,
        link.node
      );
    });
    if (rootCause) {
      console.log("%cROOT CAUSE (outermost broken link):", "font-weight:bold;color:#c00", rootCause.node, `width=${rootCause.ew}px > parent.clientWidth=${rootCause.pw}px`);
    }
    if (suspect) {
      console.log("%cSUSPECT ANCESTOR (nearest ancestor with a concrete cause):", "font-weight:bold;color:#e67300", suspect.node, suspect.reasons);
    }
    console.groupEnd();

    flaggedReport.push({
      element: describe(el),
      chain: chain.map((l) => ({ tag: l.node.tagName, cls: typeof l.node.className === "string" ? l.node.className.slice(0, 40) : "", width: l.ew, parentWidth: l.pw, overflowsParent: l.overflowsParent, reasons: l.reasons, styles: l.styles })),
      rootCause: rootCause ? { tag: rootCause.node.tagName, width: rootCause.ew, parentWidth: rootCause.pw } : null,
      suspectAncestor: suspect ? { tag: suspect.node.tagName, reasons: suspect.reasons } : null,
    });
  });

  culprits.forEach((el, i) => setTimeout(() => flashElement(el), i * 120));

  return { count: flagged.length, report: flaggedReport };
}

function paintLayoutOnce() {
  const root = document.querySelector(".focus-mode");
  if (!root) return 0;

  document.getElementById("fm-debug-layout-overlay")?.remove();
  root.querySelectorAll("[data-fm-debug-layout]").forEach((el) => {
    el.style.outline = "";
    el.removeAttribute("data-fm-debug-layout");
  });

  const palette = ["#ff5500", "#00a8ff", "#2ecc71", "#e91e8c", "#ffb300", "#8e44ad", "#00c2a0", "#e74c3c"];
  const overlay = document.createElement("div");
  overlay.id = "fm-debug-layout-overlay";
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:999998;";
  document.body.appendChild(overlay);

  const els = root.querySelectorAll("*");
  let n = 0;
  els.forEach((el) => {
    const cs = getComputedStyle(el);
    if (!/flex|grid/.test(cs.display)) return;
    const color = palette[n % palette.length];
    n++;
    el.style.outline = `2px dashed ${color}`;
    el.style.outlineOffset = "-1px";
    el.setAttribute("data-fm-debug-layout", "1");

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const label = document.createElement("div");
    label.textContent = `${cs.display} · ${Math.round(r.width)}px${cs.display.includes("grid") ? ` · ${cs.gridTemplateColumns.split(" ").length}col` : ""}`;
    label.style.cssText = `position:fixed;left:${Math.round(r.x)}px;top:${Math.max(0, Math.round(r.y))}px;background:${color};color:#fff;font:9px monospace;padding:1px 4px;border-radius:3px;white-space:nowrap;transform:translateY(-100%);`;
    overlay.appendChild(label);
  });
  return n;
}

export function DebugOverflow({ page }) {
  const [mode] = useState(debugMode);
  const [panel, setPanel] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const reportRef = useRef(null);

  useEffect(() => {
    if (!mode) return;

    function run() {
      const fm = document.querySelector(".focus-mode");
      const main = document.querySelector("main");
      setPanel({ viewport: window.innerWidth, focusMode: fm ? fm.clientWidth : null, main: main ? main.clientWidth : null });

      if (mode === "audit") {
        const { count, report } = auditOnce(page);
        setFlaggedCount(count);
        reportRef.current = report;
      } else if (mode === "layout") {
        const n = paintLayoutOnce();
        setFlaggedCount(n);
      }
    }

    const t1 = setTimeout(run, 300);
    const t2 = setTimeout(run, 1200);
    window.addEventListener("resize", run);
    window.addEventListener("orientationchange", run);
    if (mode === "layout") window.addEventListener("scroll", run, { passive: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", run);
      window.removeEventListener("orientationchange", run);
      window.removeEventListener("scroll", run);
    };
  }, [mode, page]);

  if (!mode) return null;

  async function copyReport() {
    const payload = {
      capturedAt: new Date().toISOString(),
      page,
      route: window.location.pathname + window.location.search,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      focusModeWidth: panel?.focusMode,
      mainWidth: panel?.main,
      flaggedCount,
      flaggedElements: reportRef.current || [],
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.log("[fm-debug] clipboard write failed, full report logged below instead:");
      console.log(text);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 10,
        right: 10,
        zIndex: 999999,
        background: "rgba(20,10,0,0.92)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.6,
        padding: "10px 12px",
        borderRadius: 8,
        border: flaggedCount > 0 ? "2px solid #ff3333" : "2px solid #33cc66",
        maxWidth: 230,
        pointerEvents: "auto",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>fm-debug · {page} · {mode}</div>
      <div>viewport: {panel?.viewport ?? "…"}px</div>
      <div>.focus-mode: {panel?.focusMode ?? "…"}px</div>
      <div>main: {panel?.main ?? "…"}px</div>
      <div style={{ marginTop: 4, marginBottom: 6, color: mode === "audit" ? (flaggedCount > 0 ? "#ff6666" : "#66ff99") : "#ffcc66" }}>
        {mode === "audit"
          ? flaggedCount > 0
            ? `${flaggedCount} element(s) overflow their parent — see console`
            : "no overflow detected"
          : `${flaggedCount} flex/grid container(s) painted`}
      </div>
      {mode === "audit" && (
        <button
          onClick={copyReport}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "none",
            background: copied ? "#33cc66" : "#ff5500",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 10.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {copied ? "✓ copied" : "Copy Debug Report"}
        </button>
      )}
    </div>
  );
}
