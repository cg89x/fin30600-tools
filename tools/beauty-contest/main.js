// @ts-check
/**
 * Keynesian beauty contest — instructor / projector page (FIN 30600, L6 §3).
 *
 * The deck's game: everyone writes down a number between 0 and 100; the
 * person who guesses the number that is 2/3 of the class average wins a
 * prize. This page runs it live in class: students submit from their phones
 * (submit.html, joined via a QR code / 4-letter session code), the live
 * histogram fills in, and on "Close round" the mean, the 2/3 target, and the
 * winner are revealed. Until close the mean stays hidden — otherwise
 * students could chase the live average, which is the very reasoning the
 * game is about. Repeated rounds converge toward the Nash equilibrium at 0
 * (round-history chart).
 *
 * Live channel: Firebase Realtime Database over its plain REST/SSE interface
 * (./rtdb.js — no SDK). If ./config.js is absent the page runs in
 * SIMULATION mode: a seeded class of level-k reasoners (see ./game.js) whose
 * mixture shifts one level deeper each round.
 */

import { Chart, fixed } from '../../lib/chart.js';
import { mulberry32 } from '../../lib/finmath.js';
import { slider, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';
import {
  computeStats, pickWinners, histogram, guessList, makeSessionCode,
  simulateRound,
} from './game.js';
import { rtdbClient } from './rtdb.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('beauty-contest');

hydrateLabels();

/* ------------------------------------------------------------- config ---- */
// config.js IS committed (it holds only the public RTDB URL — safe by design,
// see SETUP.md). The dynamic import still degrades to simulation mode if the
// file is ever removed or left as the placeholder.
const config = await import('./config.js')
  .then((m) => (m && (m.default ?? m)) || null)
  .catch(() => null);
const HAS_LIVE = Boolean(config && typeof config.databaseURL === 'string'
  && config.databaseURL.startsWith('https://')
  && !config.databaseURL.includes('YOUR-PROJECT'));
const client = HAS_LIVE ? rtdbClient(config.databaseURL) : null;

/* -------------------------------------------------------------- state ---- */
const defaults = {
  s: '',                                    // live session code
  r: 1,                                     // sim round (live rounds live in meta)
  cl: false,                                // sim: current round closed?
  sim: !HAS_LIVE,                           // simulation mode
  seed: 20260811,                           // sim class seed
  n: 45,                                    // sim class size
};
const store = bindState(defaults, () => {}, {
  debounce: 150,
  // hash values clamp to these (state.js) — r/n also guard the sim loops
  bounds: { r: [1, 500], seed: [0, 4294967295], n: [2, 500] },
});
const S = store.state;
if (!HAS_LIVE) S.sim = true; // no config ⇒ simulation is the only mode

/* --------------------------------------------------------- DOM handles --- */
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = {
  simNotice: $('sim-notice'),
  simNoticeText: $('sim-notice-text'),
  simNoticeDismiss: $('sim-notice-dismiss'),
  simExtras: $('sim-extras'),
  fTarget: $('f-target'),
  fReveal: $('f-reveal'),
  historyPanel: $('history-panel'),
  roundWinners: $('round-winners'),
  joinCard: $('join-card'),
  studentUrl: $('student-url'),
  codeDisplay: $('code-display'),
  qrBox: $('qr-box'),
  roundLabel: $('round-label'),
  roundStatus: $('round-status'),
  nCount: $('n-count'),
  btnPlay: /** @type {HTMLButtonElement} */ ($('btn-play')),
  btnClose: /** @type {HTMLButtonElement} */ ($('btn-close')),
  btnNext: /** @type {HTMLButtonElement} */ ($('btn-next')),
  winnerCard: $('winner-card'),
  readouts: $('readouts'),
  liveStatus: $('live-status'),
};

/* ------------------------------------------------------------- charts ---- */
const histChart = new Chart($('hist-chart'), {
  width: 760,
  height: 440,
  xLabel: 'Guess',
  yLabel: 'Number of guesses',
  xFmt: fixed(0),
  yFmt: fixed(0),
});
const historyChart = new Chart($('history-chart'), {
  width: 480,
  height: 330,
  margin: { top: 16, right: 20, bottom: 44, left: 52 },
  xLabel: 'Round',
  yLabel: 'Value',
  xFmt: fixed(0),
  yFmt: fixed(0),
});

/** Filled bar drawn through chart.path (chart.js has no bar primitive). */
function bar(chart, x0, x1, h, fill, opacity) {
  const node = chart.path(
    [{ x: x0, y: 0 }, { x: x0, y: h }, { x: x1, y: h }, { x: x1, y: 0 }],
    { stroke: 'none' },
  );
  node.setAttribute('fill', fill);
  node.setAttribute('opacity', String(opacity));
  return node;
}

/* --------------------------------------------------------------- modes --- */
const isSim = () => Boolean(S.sim) || !HAS_LIVE;

/* sim runtime (not in the hash: replays reconstruct closed rounds from the
   seed; an OPEN round starts unplayed on reload) */
let simPlayed = Boolean(S.cl); // a closed round was necessarily played
let simShown = Infinity;       // how many sim guesses are revealed (animation)
let simTimer = null;

/** Deterministic guesses for a sim round (same seed ⇒ same class). */
function simGuessesFor(round) {
  const seed = (Number(S.seed) ^ Math.imul(round, 0x9E3779B9)) >>> 0;
  return simulateRound(Math.max(1, Math.round(Number(S.n))), round, mulberry32(seed));
}

/* live runtime */
let liveTree = null;
let liveSub = null;
let liveState = HAS_LIVE ? 'idle' : 'off';

function subscribeTo(code) {
  if (liveSub) { liveSub.close(); liveSub = null; }
  liveTree = null;
  if (!client || !code) { render(); return; }
  liveState = 'connecting';
  liveSub = client.subscribe(`/beauty/${code}`, (tree) => {
    liveTree = tree;
    liveState = 'live';
    render();
  }, (status) => {
    if (status === 'error' || status === 'cancel') liveState = 'error';
    renderStatusLine();
  });
  render();
}

/** Firebase may store /rounds as an array (dense integer keys) or object. */
function roundNode(tree, r) {
  const rounds = tree && tree.rounds;
  if (!rounds) return null;
  return rounds[r] ?? rounds[String(r)] ?? null;
}

/* ------------------------------------------------------------ view model - */
/**
 * One normalized snapshot of the game, whichever mode feeds it:
 * {round, open, guesses, history[], hasSession}
 */
function view() {
  if (isSim()) {
    const round = clampRound(Number(S.r));
    const closed = Boolean(S.cl);
    const all = simGuessesFor(round);
    let guesses;
    if (closed) guesses = all;
    else if (simPlayed) guesses = all.slice(0, Math.min(simShown, all.length));
    else guesses = [];
    const history = [];
    for (let k = 1; k < round; k++) history.push(historyEntry(k, simGuessesFor(k)));
    if (closed) history.push(historyEntry(round, all));
    return { round, open: !closed, guesses, history, hasSession: true };
  }
  // live
  const meta = liveTree && liveTree.meta;
  if (!S.s || !meta) {
    return { round: 1, open: false, guesses: [], history: [], hasSession: false };
  }
  const round = clampRound(Number(meta.round));
  const open = Boolean(meta.open);
  const guesses = guessList(roundNode(liveTree, round) && roundNode(liveTree, round).guesses);
  const history = [];
  const lastClosed = open ? round - 1 : round;
  // Iterate the round keys that actually EXIST in the mirror, never 1..round:
  // meta is world-writable, so a hostile `meta.round = 1e9` must not send the
  // projector into a billion-iteration loop on every SSE event.
  const roundsNode = (liveTree && liveTree.rounds) || {};
  const ks = Object.keys(roundsNode)
    .map(Number)
    .filter((k) => Number.isInteger(k) && k >= 1 && k <= lastClosed)
    .sort((a, b) => a - b);
  for (const k of ks) {
    const node = roundNode(liveTree, k);
    const list = guessList(node && node.guesses);
    if (list.length) history.push(historyEntry(k, list));
  }
  return { round, open, guesses, history, hasSession: true };
}

/** Round counters come from state or the (world-writable) live meta — clamp
 * to something a classroom can actually reach. */
function clampRound(n) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(500, Math.max(1, Math.round(n)));
}

/** A closed round's stats + its winners. @param {number} k @param {any[]} list */
function historyEntry(k, list) {
  const stats = computeStats(list);
  return { round: k, ...stats, winners: pickWinners(list, stats.target) };
}

/* -------------------------------------------------------- histogram ------ */
let lastHistYMax = 0;
function drawHistogram(v) {
  const closed = v.hasSession && !v.open;
  // LIVE mode: never show the distribution while the round is open — students
  // could chase it. The bars appear on Close round. (Sim keeps its streaming
  // animation: the data is fake, and it demos what close will look like.)
  if (!isSim() && v.hasSession && v.open) {
    if (lastHistYMax !== 5) {
      const xTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      histChart.setDomain(0, 100, 0, 5).renderAxes({ xTicks, yTickCount: 5 });
      lastHistYMax = 5;
    }
    histChart.clearData();
    const note = histChart.text(50, 2.5,
      `${v.guesses.length} submission${v.guesses.length === 1 ? '' : 's'} in — histogram revealed when the round closes`,
      { anchor: 'middle', fill: 'var(--muted)' });
    note.setAttribute('font-size', '15');
    return;
  }
  const values = v.guesses.map((g) => g.v);
  const bins = histogram(values, 5, 0, 100);
  const maxCount = Math.max(...bins, 0);
  const yMax = Math.max(5, Math.ceil(maxCount * 1.2));
  if (yMax !== lastHistYMax) {
    const xTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    histChart.setDomain(0, 100, 0, yMax).renderAxes({ xTicks, yTickCount: 5 });
    lastHistYMax = yMax;
  }
  histChart.clearData();

  // bars — BLUE, bin width 5, small gap
  for (let i = 0; i < bins.length; i++) {
    if (!bins[i]) continue;
    bar(histChart, i * 5 + 0.4, (i + 1) * 5 - 0.4, bins[i], 'var(--blue)', 0.85);
  }

  if (closed && values.length) {
    const { mean, target } = computeStats(v.guesses);
    // mean: GOLD solid; target: RED dashed (reveal — hidden while open)
    histChart.vline(mean, { stroke: 'var(--gold)', width: 2.5 });
    histChart.text(mean, yMax * 0.97, `mean = ${mean.toFixed(1)}`, {
      dx: 6, anchor: 'start', fill: 'var(--gold)',
    });
    histChart.vline(target, { stroke: 'var(--red)', dash: '7 5', width: 2 });
    histChart.text(target, yMax * 0.88, `2/3 × mean = ${target.toFixed(1)}`, {
      dx: target > mean ? 6 : -6, anchor: target > mean ? 'start' : 'end', fill: 'var(--red)',
    });
    // winning guess: gold star on the axis
    const winners = pickWinners(v.guesses, target);
    for (const w of winners) {
      histChart.point(w.v, yMax * 0.025, {
        shape: 'star', r: 10, fill: 'var(--gold)', stroke: 'var(--navy)',
      });
    }
  }
}

/* ---------------------------------------------------- round history ------ */
let lastHistoryKey = '';
function drawHistory(v) {
  const rounds = v.history;
  const xHi = Math.max(5, rounds.length + 1);
  const yHi = Math.max(50, Math.ceil(Math.max(0, ...rounds.map((h) => h.mean)) * 1.15));
  const key = `${xHi}|${yHi}`;
  if (key !== lastHistoryKey) {
    const xTicks = [];
    for (let k = 1; k <= xHi; k++) xTicks.push(k);
    historyChart.setDomain(0.5, xHi + 0.5, 0, yHi).renderAxes({ xTicks, yTickCount: 5 });
    lastHistoryKey = key;
  }
  historyChart.clearData();

  // Nash reference: RED dashed at 0
  historyChart.hline(0, { stroke: 'var(--red)', dash: '7 5', width: 1.6 });
  historyChart.text(xHi + 0.5, 0, 'Nash equilibrium = 0', {
    dx: -4, dy: -6, anchor: 'end', fill: 'var(--red)',
  });

  if (!rounds.length) return;
  const meanPts = rounds.map((h) => ({ x: h.round, y: h.mean }));
  const targetPts = rounds.map((h) => ({ x: h.round, y: h.target }));
  if (rounds.length > 1) {
    historyChart.path(meanPts, { stroke: 'var(--blue)', width: 2.5 });
    historyChart.path(targetPts, { stroke: 'var(--gold)', width: 2.5 });
  }
  for (const p of meanPts) historyChart.point(p.x, p.y, { r: 5, fill: 'var(--blue)', stroke: '#fff' });
  for (const p of targetPts) historyChart.point(p.x, p.y, { r: 5, fill: 'var(--gold)', stroke: '#fff' });
}

/* ------------------------------------------------------------ readouts --- */
function drawReadouts(v) {
  const closed = v.hasSession && !v.open;
  const stats = computeStats(v.guesses);
  const winners = closed ? pickWinners(v.guesses, stats.target) : [];
  const winTxt = winners.length
    ? winners.map((w) => `${w.name || 'anonymous'} (${w.v})`).join(', ')
    : '—';
  const rows = [
    ['Submissions $n$', String(stats.n), 'blue'],
    ['Class mean', closed && stats.n ? stats.mean.toFixed(2) : '—', 'gold'],
    ['Target $\\tfrac{2}{3}\\times$ mean', closed && stats.n ? stats.target.toFixed(2) : '—', ''],
    ['Winner', winTxt, 'gold'],
  ];
  el.readouts.replaceChildren();
  for (const [k, val, cls] of rows) {
    const cell = document.createElement('div');
    cell.className = 'readout';
    const key = document.createElement('div');
    key.className = 'k';
    renderLabel(key, k);
    const vv = document.createElement('div');
    vv.className = `v ${cls}`;
    vv.textContent = val;
    cell.append(key, vv);
    el.readouts.appendChild(cell);
  }
}

/* --------------------------------------------------------- winner card --- */
function drawWinner(v) {
  const closed = v.hasSession && !v.open;
  const stats = computeStats(v.guesses);
  if (!closed || !stats.n) { el.winnerCard.hidden = true; return; }
  const winners = pickWinners(v.guesses, stats.target);
  const names = winners.map((w) => `<span class="w-name">${escapeHtml(w.name || 'anonymous')}</span> (${w.v})`).join(', ');
  const dist = winners.length ? Math.abs(winners[0].v - stats.target) : NaN;
  el.winnerCard.innerHTML =
    `🏆 Winner${winners.length > 1 ? 's — tie' : ''}: ${names} ` +
    `<span class="w-detail">— target ${stats.target.toFixed(2)}, off by ${dist.toFixed(2)}</span>`;
  el.winnerCard.hidden = false;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  ));
}

/* ------------------------------------------------------- formula strip --- */
function drawFormulas(v) {
  const closed = v.hasSession && !v.open;
  const stats = computeStats(v.guesses);
  if (closed && stats.n) {
    renderTeX(el.fReveal,
      `\\bar{g} = ${stats.mean.toFixed(2)} \\;\\Rightarrow\\; ` +
      `\\tfrac{2}{3}\\times${stats.mean.toFixed(2)} = \\mathbf{${stats.target.toFixed(2)}}`);
    el.fReveal.hidden = false;
  } else {
    el.fReveal.hidden = true;
    el.fReveal.replaceChildren();
  }
}

/* --------------------------------------- history panel (round >= 3 debrief) */
let nashRendered = false;
function drawHistoryPanel(v) {
  // The panel is the DEBRIEF: it exposes the convergence and the equilibrium
  // math, so it stays hidden until three rounds have closed.
  const show = v.history.length >= 3;
  el.historyPanel.hidden = !show;
  if (!show) return;
  drawHistory(v);
  // winners of the closed rounds
  el.roundWinners.replaceChildren();
  for (const h of v.history) {
    const row = document.createElement('div');
    row.className = 'rw-row';
    const names = h.winners.map((w) => `${w.name || 'anonymous'} (${w.v})`).join(', ');
    row.innerHTML =
      `<span class="rw-round">Round ${h.round}</span>` +
      `<span class="rw-name">🏆 ${escapeHtml(names)}</span>` +
      `<span class="rw-detail">target ${h.target.toFixed(1)}</span>`;
    el.roundWinners.appendChild(row);
  }
  // equilibrium math (render once)
  if (!nashRendered) {
    renderTeX($('f-nash-iter'),
      '\\text{iterated reasoning: } 50 \\;\\to\\; \\tfrac{2}{3}\\cdot 50 = 33.3 '
      + '\\;\\to\\; 22.2 \\;\\to\\; 14.8 \\;\\to\\; \\cdots \\;\\to\\; 0');
    renderTeX($('f-nash-eq'),
      '\\text{equilibrium: } g^{*} = \\tfrac{2}{3}\\,g^{*} \\;\\Longrightarrow\\; g^{*} = 0');
    nashRendered = true;
  }
}

/* ------------------------------------------------------------ join card -- */
function studentUrlFor(code) {
  const u = new URL('./submit.html', location.href);
  u.hash = `s=${code}`;
  return u.href;
}

let lastQrCode = '';
function drawJoinCard() {
  const code = String(S.s || '');
  const show = !isSim() && Boolean(code);
  el.joinCard.hidden = !show;
  if (!show) { lastQrCode = ''; return; }
  el.codeDisplay.textContent = code.split('').join(' ');
  const url = studentUrlFor(code);
  // typed-in URL: prefer the short redirect (config.shortJoinUrl) — students
  // land on submit.html and type the session code. The QR deep-links w/ code.
  el.studentUrl.textContent = (config && config.shortJoinUrl) || url;
  if (code !== lastQrCode) {
    const qrFactory = /** @type {any} */ (globalThis).qrcode;
    if (typeof qrFactory === 'function') {
      const qr = qrFactory(0, 'M'); // type 0 = auto-size, medium error correction
      qr.addData(url);
      qr.make();
      el.qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2 });
      lastQrCode = code;
    } else {
      // qrcode.js is a deferred classic script; retry until it has loaded
      setTimeout(drawJoinCard, 80);
    }
  }
}

/* -------------------------------------------------------- round bar ------ */
function drawRoundBar(v) {
  el.roundLabel.textContent = `Round ${v.round}`;
  const open = v.hasSession && v.open;
  el.roundStatus.textContent = v.hasSession ? (open ? 'Open' : 'Closed') : 'No session';
  el.roundStatus.className = `round-status ${open ? 'open' : 'closed'}`;
  el.nCount.textContent = `n = ${v.guesses.length}`;

  const sim = isSim();
  el.btnPlay.hidden = !sim || !open || simPlayed;
  el.btnClose.hidden = !v.hasSession || !open;
  el.btnClose.disabled = v.guesses.length === 0;
  el.btnNext.hidden = !v.hasSession || open;
}

/* -------------------------------------------------------- status line ---- */
function renderStatusLine() {
  let txt;
  if (!HAS_LIVE) {
    txt = 'Live polling not configured — simulation only (see SETUP.md).';
  } else if (isSim()) {
    txt = 'Simulation mode — nothing is written to Firebase.';
  } else if (!S.s) {
    txt = 'Live mode ready. Create a session to get a join code + QR.';
  } else {
    const states = {
      connecting: 'connecting…', live: 'connected', error: 'connection lost — retrying…', idle: '',
    };
    txt = `Live session ${S.s} — ${states[liveState] ?? liveState}.`;
  }
  el.liveStatus.textContent = txt;
}

/* ------------------------------------------------------------ render ----- */
function render() {
  const v = view();
  el.simExtras.hidden = !isSim(); // class-size/seed only matter in sim mode
  drawJoinCard();
  drawRoundBar(v);
  drawHistogram(v);
  drawHistoryPanel(v);
  drawReadouts(v);
  drawWinner(v);
  drawFormulas(v);
  renderStatusLine();
}

/* -------------------------------------------------------- sim actions ---- */
function stopSimTimer() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
}

function playSimRound() {
  if (!isSim() || S.cl) return;
  stopSimTimer();
  const all = simGuessesFor(Math.max(1, Math.round(Number(S.r))));
  simPlayed = true;
  simShown = 0;
  render(); // hides the Play button immediately
  // theater: bars fill in over ~2s as if submissions were streaming in
  const stepMs = Math.max(16, 2000 / all.length);
  simTimer = setInterval(() => {
    simShown += 1;
    if (simShown >= all.length) { simShown = Infinity; stopSimTimer(); }
    render();
  }, stepMs);
}

function resetSimGame() {
  stopSimTimer();
  simPlayed = false;
  simShown = Infinity;
  store.patch({ r: 1, cl: false });
}

/* ------------------------------------------------------- live actions ---- */
async function newLiveSession() {
  if (!client) return;
  const code = makeSessionCode();
  try {
    await client.put(`/beauty/${code}/meta`, { round: 1, open: true, created: Date.now() });
    store.patch({ s: code, sim: false });
    subscribeTo(code);
  } catch (err) {
    liveState = 'error';
    el.liveStatus.textContent =
      `Could not reach the database (${err && err.message}) — check config.js and the rules in SETUP.md.`;
  }
}

async function closeRound() {
  if (isSim()) {
    stopSimTimer();
    simPlayed = true;
    simShown = Infinity;
    store.set('cl', true);
    render();
    return;
  }
  const meta = liveTree && liveTree.meta;
  if (!client || !meta) return;
  try { await client.patch(`/beauty/${S.s}/meta`, { open: false }); } catch { /* SSE will not confirm; leave UI */ }
}

async function nextRound() {
  if (isSim()) {
    stopSimTimer();
    simPlayed = false;
    simShown = Infinity;
    store.patch({ r: Math.max(1, Math.round(Number(S.r))) + 1, cl: false });
    render();
    return;
  }
  const meta = liveTree && liveTree.meta;
  if (!client || !meta) return;
  const r = Math.max(1, Math.round(Number(meta.round) || 1));
  try { await client.patch(`/beauty/${S.s}/meta`, { round: r + 1, open: true }); } catch { /* ignore */ }
}

/* ----------------------------------------------------------- controls ---- */
const sessionHost = $('ctrl-session');
const btnNew = document.createElement('button');
btnNew.className = 'btn';
btnNew.id = 'btn-new-session';
btnNew.textContent = HAS_LIVE ? 'New session' : 'New session (needs config.js)';
btnNew.disabled = !HAS_LIVE;
btnNew.addEventListener('click', newLiveSession);
sessionHost.appendChild(btnNew);

const simToggle = toggle({
  label: 'Simulation mode', value: isSim(),
  onChange: (on) => {
    if (!HAS_LIVE && !on) { simToggle.set(true); return; } // sim is all we have
    store.set('sim', on);
    if (on) {
      if (liveSub) { liveSub.close(); liveSub = null; }
      resetSimGame();
    } else if (S.s) {
      subscribeTo(String(S.s));
    }
    render();
  },
});
if (!HAS_LIVE) simToggle.input.disabled = true;
$('ctrl-sim').appendChild(simToggle);

const nCtrl = slider({
  label: 'class size $n$', min: 10, max: 100, step: 1, value: Number(S.n),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('n', Math.round(v)); resetSimGame(); render(); },
});
$('ctrl-simn').appendChild(nCtrl);

const seedHost = $('ctrl-seed');
const btnSeed = document.createElement('button');
btnSeed.className = 'btn';
btnSeed.id = 'btn-reseed';
btnSeed.title = 'Draw a new simulated class (restarts at round 1)';
btnSeed.textContent = '↻ Re-seed';
btnSeed.addEventListener('click', () => {
  store.set('seed', Math.floor(Math.random() * 2 ** 31));
  resetSimGame();
  render();
});
seedHost.appendChild(btnSeed);

el.btnPlay.addEventListener('click', playSimRound);
el.btnClose.addEventListener('click', closeRound);
el.btnNext.addEventListener('click', nextRound);
el.simNoticeDismiss.addEventListener('click', () => { el.simNotice.hidden = true; });

/* ----------------------------------------------------------- startup ----- */
renderTeX(el.fTarget,
  '\\text{target} = \\tfrac{2}{3}\\times\\text{class average}'
  + '\\qquad \\text{winner: closest guess to the target}');

if (!HAS_LIVE) {
  el.simNoticeText.textContent =
    'Live polling not configured — running in simulation mode (see SETUP.md in this tool’s folder).';
  el.simNotice.hidden = false;
}

if (!isSim() && S.s) subscribeTo(String(S.s));
render();
