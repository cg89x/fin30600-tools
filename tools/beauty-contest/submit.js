// @ts-check
/**
 * Keynesian beauty contest — student phone page. Feather-light on purpose:
 * no MathJax, no chart.js; just the shared stylesheet, ./rtdb.js, and a form.
 *
 * Flow: read the session code from `#s=CODE` (or let the student type it),
 * live-subscribe to the session's `meta` (round number + open/closed), and
 * POST the guess to /beauty/CODE/rounds/R/guesses. One submission per round,
 * enforced client-side via localStorage (`bc-<session>-<round>`); the
 * database rules make each pushed guess write-once.
 */

import { rtdbClient } from './rtdb.js';

const config = await import('./config.js')
  .then((m) => (m && (m.default ?? m)) || null)
  .catch(() => null);

/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusLine = $('status-line');
const codeScreen = $('code-screen');
const codeInput = /** @type {HTMLInputElement} */ ($('code-input'));
const btnJoin = /** @type {HTMLButtonElement} */ ($('btn-join'));
const formScreen = $('form-screen');
const guessInput = /** @type {HTMLInputElement} */ ($('guess-input'));
const guessRange = /** @type {HTMLInputElement} */ ($('guess-range'));
const nameInput = /** @type {HTMLInputElement} */ ($('name-input'));
const errorLine = $('error-line');
const btnSubmit = /** @type {HTMLButtonElement} */ ($('btn-submit'));
const resultScreen = $('result-screen');

/** Show exactly one of the three screens. @param {HTMLElement|null} which */
function show(which) {
  for (const s of [codeScreen, formScreen, resultScreen]) s.hidden = s !== which;
}

/** @param {string} msg @param {string} [cls] */
function setStatus(msg, cls = '') {
  statusLine.textContent = msg;
  statusLine.className = `status-line ${cls}`.trim();
}

/** @param {string} html */
function showResult(html) {
  resultScreen.innerHTML = html;
  show(resultScreen);
}

// keep the number box and the slider in sync (decimals allowed in the box)
guessRange.addEventListener('input', () => { guessInput.value = guessRange.value; });
guessInput.addEventListener('input', () => {
  const v = Number(guessInput.value);
  if (Number.isFinite(v)) guessRange.value = String(Math.min(100, Math.max(0, v)));
});

/* ------------------------------------------------------------- startup --- */
const HAS_LIVE = Boolean(config && typeof config.databaseURL === 'string'
  && config.databaseURL.startsWith('https://')
  && !config.databaseURL.includes('YOUR-PROJECT'));

if (!HAS_LIVE) {
  setStatus('');
  showResult('This game isn’t configured for live play.' +
    '<span class="sub">Ask your instructor — the projector can still run it in simulation mode.</span>');
} else {
  const client = rtdbClient(/** @type {any} */ (config).databaseURL);
  const m = location.hash.match(/[#&]s=([A-Za-z0-9]{4})/);
  if (m) start(m[1].toUpperCase());
  else {
    show(codeScreen);
    setStatus('Enter the 4-character code shown on the screen.');
    const join = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) { setStatus('Codes are 4 letters/digits.', 'closed'); return; }
      location.hash = `s=${code}`;
      start(code);
    };
    btnJoin.addEventListener('click', join);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  }

  /** @param {string} code */
  function start(code) {
    let round = 0;
    let open = false;
    let sawData = false;
    setStatus('Connecting…');
    show(null);

    const lockKey = () => `bc-${code}-${round}`;

    function refresh() {
      if (!sawData) return;
      if (round === 0) { // meta === null → no such session
        setStatus('');
        showResult(`No session found for code <strong>${code}</strong>.` +
          '<span class="sub">Check the code on the screen (or scan the QR again).</span>');
        return;
      }
      if (localStorage.getItem(lockKey())) {
        setStatus(`Round ${round}`, 'open');
        showResult('✓ Got it — watch the screen.' +
          '<span class="sub">You’ll be able to guess again when the next round opens.</span>');
        return;
      }
      if (!open) {
        setStatus(`Round ${round} — closed`, 'closed');
        showResult('Round closed — wait for the next round.' +
          '<span class="sub">This page updates by itself when the round opens.</span>');
        return;
      }
      setStatus(`Round ${round} — open`, 'open');
      errorLine.textContent = '';
      btnSubmit.disabled = false;
      show(formScreen);
    }

    client.subscribe(`/beauty/${code}/meta`, (meta) => {
      sawData = true;
      if (meta && typeof meta === 'object') {
        round = Math.max(1, Math.round(Number(/** @type {any} */ (meta).round) || 1));
        open = Boolean(/** @type {any} */ (meta).open);
      } else {
        round = 0;
        open = false;
      }
      refresh();
    }, (status) => {
      if (status === 'error' && !sawData) setStatus('Connecting… (retrying)');
    });

    btnSubmit.addEventListener('click', async () => {
      const v = Number(guessInput.value);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        errorLine.textContent = 'Please enter a number between 0 and 100.';
        return;
      }
      const name = nameInput.value.trim().slice(0, 24);
      if (!name) {
        errorLine.textContent = 'Please enter your first name — the winner is announced by name.';
        nameInput.focus();
        return;
      }
      if (!open || round === 0) { refresh(); return; }
      btnSubmit.disabled = true;
      errorLine.textContent = '';
      const payload = { v, t: Date.now(), name };
      try {
        await client.post(`/beauty/${code}/rounds/${round}/guesses`, payload);
        localStorage.setItem(lockKey(), String(v));
        refresh();
      } catch (err) {
        btnSubmit.disabled = false;
        errorLine.textContent = 'Could not submit — check your connection and try again.';
      }
    });
  }
}
