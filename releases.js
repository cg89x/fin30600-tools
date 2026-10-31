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
 * private (since summer 2026) but the site is a public static page, so
 * treat gating as a courtesy curtain (a determined student can fetch this
 * file from the live site); it keeps honest students from spoiling class
 * demos, no more. Still: don't put preview links in Canvas or on slides.
 *
 * HIDE_LOCKED: false shows locked tools as greyed "unlocks in class" cards
 * on the landing page (students see what's coming); true removes them from
 * the landing page entirely.
 */

export const HIDE_LOCKED = false;

// RULE (Christian, 2026-09-02): every tool releases at 12:00am LOCAL on the
// FIRST class day of its topic per the syllabus — the same day the topic's
// Canvas module opens — never a later within-topic day. Fall 2026 first days:
// T1 Tu 8/25 · T2 Th 9/3 · T3 Th 9/10 · T4 Th 9/24 · T5 Th 10/15 ·
// T6 Th 10/29 · T7 Th 11/5 · T8 Tu 11/24.
const RELEASES = {
  'volatility-drag': true,          // T1 — released 2026-08-23 (Christian)
  'fee-drag': true,                 // T1 — released 2026-08-23 (Christian)
  'market-depth': '2026-09-03',     // T2 day 1 (Th 9/3); ex order-book, order-types tool to follow
  'margin-short': true,             // T2 — REMOVED from live 2026-07-12; folder kept locally (untracked), key kept TRUE so the local copy isn't lock-screened (if restored to live, gate it '2026-09-03')
  'two-asset': '2026-09-10',        // T3 day 1 (Th 9/10)
  'capital-allocation': '2026-09-10', // T3 day 1 (Th 9/10)
  'efficient-frontier': '2026-09-10', // T3 day 1 (Th 9/10)
  'capm-sml': '2026-09-24',         // T4 day 1 (Th 9/24)
  'diversification': '2026-09-24',  // T4 day 1 (Th 9/24)
  'anomaly-lab': '2026-10-15',      // T5 day 1 (Th 10/15)
  'beauty-contest': '2026-11-05',   // EXCEPTION to the rule (Christian 2026-10-31): pacing slipped — Tu 11/3 = end of T5 + EMH, Th 11/5 = Behavioral, where the game is played in class (was '2026-10-29')
  'duration': '2026-11-05',         // T7 day 1 (Th 11/5)
  'black-scholes': '2026-11-24',    // T8 day 1 (Tu 11/24)
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
