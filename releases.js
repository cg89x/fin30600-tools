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
 * the URL already has a hash) — the lock screen is skipped. Students would
 * only know this if you show them this file, so don't share preview links.
 *
 * HIDE_LOCKED: false shows locked tools as greyed "unlocks in class" cards
 * on the landing page (students see what's coming); true removes them from
 * the landing page entirely.
 */

export const HIDE_LOCKED = false;

const RELEASES = {
  'volatility-drag': true,     // L1 §4
  'fee-drag': true,            // L1 §6
  'order-book': true,          // L2 §3
  'margin-short': true,        // L2 §4–5
  'two-asset': true,           // L3 §4
  'capital-allocation': true,  // L3 §2–3
  'efficient-frontier': true,  // L3 §5
  'capm-sml': true,            // L4 §2–3
  'diversification': true,     // L4 appendix
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
    if (y && m && d) return new Date() >= new Date(y, m - 1, d);
  }
  return false;
}

/** @param {string} hash @returns {boolean} the instructor #preview bypass */
export function hasPreviewFlag(hash) {
  return /(^#|[#&])preview(=|&|$)/.test(hash || '');
}
