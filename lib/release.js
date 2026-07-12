// @ts-check
/**
 * release.js — per-tool release gate (see ../releases.js for the schedule).
 *
 * Usage, at the top of a tool's main.js right after the imports:
 *
 *   import { gateTool } from '../../lib/release.js';
 *   await gateTool('two-asset');
 *
 * If the tool is released (or the URL carries the instructor `#preview`
 * flag) this resolves immediately and the tool runs. If not, it swaps the
 * page for a lock screen and returns a promise that NEVER resolves — the
 * module suspends right there, so none of the tool's code RUNS.
 *
 * Honest scope: this is a courtesy curtain, not security. The tool's static
 * HTML is still served (view-source / JS-off shows it), and the repo is
 * public. Each tool page ships its <main> with the `hidden` attribute so a
 * locked page doesn't even FLASH content before this gate runs; the gate
 * un-hides it when the tool is allowed to start.
 */

import { isReleased, hasPreviewFlag } from '../releases.js';

/** @param {string} key the tool's folder name @returns {Promise<void>} */
export function gateTool(key) {
  if (isReleased(key) || hasPreviewFlag(location.hash)) {
    // Reveal the statically-hidden page body (see docstring).
    const main = document.querySelector('main');
    if (main) main.removeAttribute('hidden');
    return Promise.resolve();
  }

  document.title = 'FIN 30600 · Not released yet';
  document.body.innerHTML = `
    <header class="app-header">
      <div class="titles">
        <h1>Not released yet</h1>
        <p class="subtitle">FIN 30600 · Investment Theory — Interactive Tools</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="../../">&larr; Back to all tools</a>
      </div>
    </header>
    <main class="landing" style="text-align:center; padding-top:3.5rem;">
      <p style="font-size:3rem; margin:0;">🔒</p>
      <p style="font-size:1.2rem; color:var(--navy); margin:0.8rem 0 0.3rem;">
        This tool unlocks when we cover the topic in class.</p>
      <p style="color:var(--muted); margin:0;">Check back after the lecture —
        or ask in class if you think it should be open already.</p>
    </main>
    <footer class="app-footer">
      <span>FIN 30600 Investment Theory · Mendoza College of Business</span>
    </footer>`;
  return new Promise(() => {}); // suspend the calling module forever
}
