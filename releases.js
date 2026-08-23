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
  'volatility-drag': true,          // L1 §4 — released 2026-08-23 (Christian)
  'fee-drag': true,                 // L1 §6 — released 2026-08-23 (Christian)
  'market-depth': '2026-09-03',     // L2 §3 — L2 day 1 (Th 9/3); ex order-book, order-types tool to follow
  'margin-short': true,             // L2 §4–5 — REMOVED from live 2026-07-12; folder kept locally (untracked), key kept TRUE so the local copy isn't lock-screened (if restored to live, gate it '2026-09-08')
  'two-asset': '2026-09-17',        // L3 §4 — L3 day 3 (Th 9/17)
  'capital-allocation': '2026-09-15', // L3 §2–3 — L3 day 2 (Tu 9/15)
  'efficient-frontier': '2026-09-22', // L3 §5 — L3 day 4 (Tu 9/22)
  'capm-sml': '2026-09-29',         // L4 §2–3 — L4 day 2 (Tu 9/29)
  'diversification': '2026-09-24',  // L4 appendix — L4 day 1 (Th 9/24)
  'anomaly-lab': '2026-10-15',      // L5 §1–2 — L5 day 1 (Th 10/15)
  'beauty-contest': '2026-11-03',   // L6 §3 — L6 day 2 (Tu 11/3, behavioral day; game is played IN class)
  'duration': '2026-11-10',         // L7 §3–4 — L7 day 2 (Tu 11/10)
  'black-scholes': '2026-12-01',    // L8 §3–4 — L8 day 2 (Tu 12/1, BKM 16.1 valuation day)
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
