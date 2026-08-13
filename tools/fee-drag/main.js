// @ts-check
/**
 * Fee Drag: mutual fund fees (FIN 30600, Topic 1 §6).
 *
 * X_T = X_0 (1 − f_entry)(1 + r − f_annual)^T (1 − f_exit).
 * Fund A (front-end load) vs Fund B (level load + exit fee — flat by
 * default; a toggle makes it decline 1 pp per year held, the deck's Class B
 * structure) against a no-fee reference; the plotted curve at year t is the
 * wealth IF YOU CASHED OUT in year t (the exit fee applies at the point of
 * sale). Deck anchors (declining toggle ON): T=4 → A $1,376.25 / B $1,423.28
 * (B wins); T=15 → A $3,926.61 / B $3,901.32 (A wins; slide rounds $3,901.3).
 *
 * Split out of the original two-column "compounding-drags" tool 2026-07-11
 * (Christian: separate tools); its sibling is tools/volatility-drag/.
 * All finance math lives in ../../lib/finmath.js (decimals); this file
 * formats for display. State serializes to the URL hash.
 */

import { feeWealth, decliningExitFee } from '../../lib/finmath.js';
import { Chart, fixed, niceTicks } from '../../lib/chart.js';
import { slider, numberInput, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

import { gateTool } from '../../lib/release.js';
await gateTool('fee-drag');  // release gate — must run before anything below

hydrateLabels();

/* ----------------------------------------------------------------- state -- */

const DEFAULTS = {
  x0: 1000,   // investment X_0, dollars
  r: 10,      // gross annual return, % (percents stored as percents for readable URLs)
  T: 15,      // horizon, years
  al: 6,      // Fund A front-end load, %
  af: 0,      // Fund A annual fee, %
  bl: 0,      // Fund B front-end load, %
  bf: 0.5,    // Fund B annual fee, %
  bxf: 5,     // Fund B exit fee, % (0 = none)
  bxd: 0,     // 1 = the exit fee declines 1 pp/yr of holding (toggle, default OFF
              // per Christian 2026-07-12 — a flat exit fee always shows in the math;
              // the deck preset turns declining ON to reproduce the slide anchors)
};

// Numeric ranges mirror the controls; hash values clamp to these (state.js) —
// negative fees or a `#T=1e9` horizon must not NaN the curves or hang the tab.
const BOUNDS = {
  x0: [1, 10000000], r: [0, 15], T: [1, 40],
  al: [0, 8], af: [0, 2], bl: [0, 8], bf: [0, 2], bxf: [0, 6], bxd: [0, 1],
};
const store = bindState(DEFAULTS, undefined, { bounds: BOUNDS });
const S = store.state;

/* ------------------------------------------------------------ formatting -- */

/** "$3,926.61" — readout money (full precision to the cent). */
function usd2(v) {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Adaptive dollar axis tick: "$1,000" / "$550k" / "$1.2M". */
function usdTick(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Decimal → TeX-safe "11.17\%" (% is a TeX comment char — must be escaped). */
function pctTeX(dec, d = 2) {
  return `${(dec * 100).toFixed(d)}\\%`;
}

/** Dollar amount as TeX math: \unicode{x24} for $, {,} for thousands commas. */
function texUsd(v, decimals = 2) {
  const s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `\\unicode{x24}${s.replace(/,/g, '{,}')}`;
}

/** One readout cell (key typeset via renderLabel). */
function readout(k, v, cls = '') {
  const cell = document.createElement('div');
  cell.className = 'readout';
  const key = document.createElement('div');
  key.className = 'k';
  renderLabel(key, k);
  const val = document.createElement('div');
  val.className = `v ${cls}`;
  val.textContent = v;
  cell.append(key, val);
  return cell;
}

const BLUE = '\\textcolor{#0072B2}';
const GOLD = '\\textcolor{#C99700}';

/* ------------------------------------------------------------------ chart -- */

const feeChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('fee-chart')), {
  width: 720, height: 440,
  margin: { top: 18, right: 26, bottom: 48, left: 80 },
  xLabel: 'Year', yLabel: 'Wealth if Cashed Out',
  xFmt: fixed(0), yFmt: usdTick,
});

/** Everything derived from the state (decimals throughout). */
function feeModel() {
  const x0 = Math.max(1, Number(S.x0) || 0); // guard: empty/0 input
  const r = Number(S.r) / 100;
  const T = Math.max(1, Math.round(Number(S.T)));
  const aLoad = Number(S.al) / 100;
  const aFee = Number(S.af) / 100;
  const bLoad = Number(S.bl) / 100;
  const bFee = Number(S.bf) / 100;
  const bExit0 = Number(S.bxf) / 100; // exit fee (0 = none)
  const bxDecl = Math.round(Number(S.bxd)) === 1; // declining-exit-fee toggle
  /** Fund B's exit fee AS OF a cash-out in year t (flat, or −1 pp/yr held). */
  const exitAt = bxDecl ? (t) => decliningExitFee(bExit0, 0.01, t) : () => bExit0;
  const wA = (t) => feeWealth(x0, r, t, { frontLoad: aLoad, annualFee: aFee });
  const wB = (t) => feeWealth(x0, r, t, { frontLoad: bLoad, annualFee: bFee, exitFee: exitAt(t) });
  const wFree = (t) => x0 * Math.pow(1 + r, t);
  return { x0, r, T, aLoad, aFee, bLoad, bFee, bExit0, exitAt, wA, wB, wFree };
}

/**
 * Sign changes of f on (0, T]: scan a fine grid, refine each bracket by
 * bisection. Returns at most 3 crossover times (there can be two when Fund
 * B's exit-fee kink at year 5 bends its curve).
 * @param {(t:number)=>number} f
 * @param {number} T
 * @returns {number[]}
 */
function findCrossovers(f, T, samples = 480) {
  const out = [];
  const minGap = T / samples; // dedupe: a sampled zero next to a sign flip is one crossing
  const push = (t) => {
    if (!out.length || t - out[out.length - 1] > minGap) out.push(t);
  };
  let prevT = 0;
  let prevD = f(0);
  for (let i = 1; i <= samples && out.length < 3; i++) {
    const t = (T * i) / samples;
    const d = f(t);
    if ((prevD < 0 && d > 0) || (prevD > 0 && d < 0)) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if ((f(mid) > 0) === (d > 0)) hi = mid; else lo = mid;
      }
      push((lo + hi) / 2);
    } else if (d === 0 && prevD !== 0) {
      push(t); // curves meet EXACTLY on a grid point — still a crossing
    }
    prevT = t;
    if (d !== 0) prevD = d; // hold the last nonzero sign across a sampled zero
  }
  return out;
}

function renderFee() {
  const m = feeModel();
  const T = m.T;

  // domain: the no-fee reference is always the upper envelope
  const yHi = m.wFree(T) * 1.04;
  const xStep = T <= 12 ? 1 : T <= 24 ? 2 : 5;
  const xTicks = [];
  for (let t = 0; t <= T; t += xStep) xTicks.push(t);
  feeChart.setDomain(0, T, 0, yHi)
    .renderAxes({ xTicks, yTicks: niceTicks(0, yHi, 6) });
  feeChart.clearData();

  // curves: each point = value if you cashed out in year t (exit fee as of t)
  const N = 240;
  const ptsA = [];
  const ptsB = [];
  const ptsF = [];
  for (let i = 0; i <= N; i++) {
    const t = (T * i) / N;
    ptsA.push({ x: t, y: m.wA(t) });
    ptsB.push({ x: t, y: m.wB(t) });
    ptsF.push({ x: t, y: m.wFree(t) });
  }
  feeChart.path(ptsF, { stroke: 'var(--axis)', width: 1.6, dash: '6 5', opacity: 0.8 });
  feeChart.path(ptsA, { stroke: 'var(--blue)', width: 2.6 });
  feeChart.path(ptsB, { stroke: 'var(--gold)', width: 2.6 });

  // crossover year(s): where B − A changes sign
  const crossings = findCrossovers((t) => m.wB(t) - m.wA(t), T);
  for (const xc of crossings) {
    feeChart.vline(xc, { dash: '6 4', width: 1.5, opacity: 0.85 });
  }
  if (crossings.length) {
    const xc = crossings[crossings.length - 1]; // label the decisive (last) one
    const nearTop = xc <= T * 0.55; // curves are low early, high late
    const atRight = xc > T * 0.78;
    feeChart.text(xc, nearTop ? yHi * 0.95 : yHi * 0.06, `crossover yr ${xc.toFixed(1)}`, {
      dx: atRight ? -8 : 8, anchor: atRight ? 'end' : 'start', fill: 'var(--red)',
    });
  }

  // terminal markers + labels (stacked away from each other when close)
  const aT = m.wA(T);
  const bT = m.wB(T);
  const aAbove = aT >= bT;
  feeChart.point(T, aT, { r: 5, fill: 'var(--blue)', stroke: '#fff' });
  feeChart.point(T, bT, { r: 5, fill: 'var(--gold)', stroke: '#fff' });
  feeChart.text(T, aT, `A ${usdTick(aT)}`, {
    dx: -10, dy: aAbove ? -10 : 18, anchor: 'end', fill: 'var(--blue)',
  });
  feeChart.text(T, bT, `B ${usdTick(bT)}`, {
    dx: -10, dy: aAbove ? 18 : -10, anchor: 'end', fill: 'var(--gold)',
  });

  // readouts
  const free = m.wFree(T);
  const diff = aT - bT;
  let winner;
  let winCls = '';
  let winW;
  if (Math.abs(diff) < 0.005) {
    winner = 'Dead heat';
    winW = aT;
  } else if (diff > 0) {
    winner = `Fund A by ${usd2(diff)}`;
    winCls = 'blue';
    winW = aT;
  } else {
    winner = `Fund B by ${usd2(-diff)}`;
    winCls = 'gold';
    winW = bT;
  }
  /** @type {HTMLElement} */ (document.getElementById('fee-readouts')).replaceChildren(
    readout('$W_A(T)$ — Fund A', usd2(aT), 'blue'),
    readout('$W_B(T)$ — Fund B', usd2(bT), 'gold'),
    readout('Winner at $T$', winner, winCls),
    readout('Fee cost vs no-fee (winner)', usd2(free - winW)),
  );

  // formula strip: the deck formula, then both funds instantiated
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('fee-f-generic')),
    'X_T \\;=\\; X_0\\,(1 - f_{\\text{entry}})\\,\\bigl[\\,1 + r - f_{\\text{annual}}\\,\\bigr]^{T}\\,(1 - f_{\\text{exit}})');
  const rTeX = pctTeX(m.r, 1);
  const x0TeX = texUsd(m.x0, Number.isInteger(m.x0) ? 0 : 2);
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('fee-f-a')),
    `${BLUE}{W_A = ${x0TeX}(1-${pctTeX(m.aLoad, 1)})(1+${rTeX}-${pctTeX(m.aFee, 2)})^{${T}}(1-0\\%) = ${texUsd(aT)}}`);
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('fee-f-b')),
    `${GOLD}{W_B = ${x0TeX}(1-${pctTeX(m.bLoad, 1)})(1+${rTeX}-${pctTeX(m.bFee, 2)})^{${T}}(1-${pctTeX(m.exitAt(T), 1)}) = ${texUsd(bT)}}`);
}

/* --------------------------------------------------------------- controls -- */

const cX0 = numberInput({
  label: 'Investment $X_0$', min: 1, step: 100, value: Number(S.x0),
  onChange: (v) => { store.set('x0', v); renderFee(); },
});
const cR = slider({
  label: 'Gross return $r$', min: 0, max: 15, step: 0.25, value: Number(S.r),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('r', v); renderFee(); },
});
const cT = slider({
  label: 'Horizon $T$ (years)', min: 1, max: 40, step: 1, value: Number(S.T),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('T', Math.round(v)); renderFee(); },
});
const cAl = slider({
  label: 'Front-end load', min: 0, max: 8, step: 0.25, value: Number(S.al),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('al', v); renderFee(); },
});
const cAf = slider({
  label: 'Annual fee', min: 0, max: 2, step: 0.01, value: Number(S.af),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('af', v); renderFee(); },
});
const cBl = slider({
  label: 'Front-end load', min: 0, max: 8, step: 0.25, value: Number(S.bl),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('bl', v); renderFee(); },
});
const cBf = slider({
  label: 'Annual fee', min: 0, max: 2, step: 0.01, value: Number(S.bf),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('bf', v); renderFee(); },
});
const cBxf = slider({
  label: 'Exit fee', min: 0, max: 6, step: 0.25, value: Number(S.bxf),
  fmt: (v) => (v === 0 ? 'none' : `${v.toFixed(2)}%`),
  onChange: (v) => { store.set('bxf', v); renderFee(); },
});
const cBxd = toggle({
  label: 'Exit fee declines 1 pp per year held',
  value: Math.round(Number(S.bxd)) === 1,
  onChange: (v) => { store.set('bxd', v ? 1 : 0); renderFee(); },
});

document.getElementById('ctrl-x0').appendChild(cX0);
document.getElementById('ctrl-r').appendChild(cR);
document.getElementById('ctrl-T').appendChild(cT);
document.getElementById('ctrl-al').appendChild(cAl);
document.getElementById('ctrl-af').appendChild(cAf);
document.getElementById('ctrl-bl').appendChild(cBl);
document.getElementById('ctrl-bf').appendChild(cBf);
document.getElementById('ctrl-bxf').appendChild(cBxf);
document.getElementById('ctrl-bxd').appendChild(cBxd);

/** Push a preset into the state AND the controls, then render. */
function applyFeePreset(p) {
  store.patch(p);
  cX0.set(p.x0); cR.set(p.r); cT.set(p.T);
  cAl.set(p.al); cAf.set(p.af);
  cBl.set(p.bl); cBf.set(p.bf); cBxf.set(p.bxf); cBxd.set(p.bxd === 1);
  renderFee();
}

// deck anchors (L1 §6): A $1,376.25 / B $1,423.28 at T=4;
// A $3,926.61 / B $3,901.32 at T=15 — the deck's Class B exit fee DECLINES,
// so this preset turns the toggle on.
document.getElementById('btn-fee-deck').addEventListener('click', () => {
  applyFeePreset({ x0: 1000, r: 10, T: 15, al: 6, af: 0, bl: 0, bf: 0.5, bxf: 5, bxd: 1 });
});
// active vs passive: gap ≈ $99,628 after 30 years
document.getElementById('btn-fee-active').addEventListener('click', () => {
  applyFeePreset({ x0: 100000, r: 6, T: 30, al: 0, af: 0.84, bl: 0, bf: 0.14, bxf: 0, bxd: 0 });
});

/* ------------------------------------------------------------ first paint -- */

renderFee();
