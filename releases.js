// @ts-check
/**
 * releases.js — WHICH TOOLS STUDENTS CAN SEE. Edit this file, `git push`,
 * done (the Pages CDN can take up to ~10 minutes to pick it up).
 *
 * Value per tool:
 *   true          released (visible + usable)
 *   false         locked (landing card greyed out, tool page shows a lock
 *                 screen instead of the tool)
 *   'YYYY-MM-DD'  auto-releases at midnight LOCAL time on that date — set it
 *                 to the lecture date and forget about it.
 *
 * Instructor bypass: append `#preview` to any tool URL (or `&preview=1` if
 * the URL already has a hash) — the lock screen is skipped. The repo is
 * public, so treat gating as a courtesy curtain (a determined student can
 * read this file); it keeps honest students from spoiling class demos, no
 * more. Still: don't put preview links in Canvas or on slides.
 *
 * HIDE_LOCKED: false shows locked tools as greyed "unlocks in class" cards
 * on the landing page (students see what's coming); true removes them from
 * the landing page entirely.
 */

export const HIDE_LOCKED = false;

const RELEASES = {
  'volatility-drag': true,     // L1 §4
  'fee-drag': true,            // L1 §6
  'market-depth': true,        // L2 §3 (order-book redesign, depth half)
  'order-book': true,          // L2 §3 — retires once the order-types half ships
  'margin-short': true,        // L2 §4–5
  'two-asset': true,           // L3 §4
  'capital-allocation': true,  // L3 §2–3
  'efficient-frontier': true,  // L3 §5
  'capm-sml': true,            // L4 §2–3
  'diversification': true,     // L4 appendix
  'anomaly-lab': true,         // L5 §1–2
  'beauty-contest': true,      // L6 §3
  'duration': true,             // L7 §3–4
  'black-scholes': true,       // L8 §3–4
};
export default RELEASES;

/* ------------- helpers (used by index.html + lib/release.js) ------------- */

/** @param {string} key tool folder name @returns {boolean} */
export function isReleased(key) {
  const v = RELEASES[key];
  if (v === true) return true;
  if (typeof v === 'string') {
    const [y, m, d] = v.split('-').map(Number);
    // Reject dates JS would silently roll over ('2026-13-05' → Jan 2027):
    // a malformed date must fail CLOSED (locked), not release in the wrong month.
    if (y && m && d) {
      const dt = new Date(y, m - 1, d);
      const valid = dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
      return valid && new Date() >= dt;
    }
  }
  return false;
}

/** @param {string} hash @returns {boolean} the instructor #preview bypass */
export function hasPreviewFlag(hash) {
  return /(^#|[#&])preview(=|&|$)/.test(hash || '');
}
