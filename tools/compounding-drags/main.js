// @ts-check
/**
 * Compounding Drags: fees & volatility (FIN 30600, Lecture 1 §4 & §6).
 *
 * Two side-by-side columns (stacking on narrow screens), each
 * controls-left / chart-right:
 *   1. FEE DRAG (deck §6): X_T = X_0 (1 − f_entry)(1 + r − f_annual)^T (1 − f_exit).
 *      Fund A (front-end load) vs Fund B (level load + declining exit fee)
 *      against a no-fee reference; the plotted curve at year t is the wealth
 *      IF YOU CASHED OUT in year t (the exit fee applies at the point of
 *      sale). Deck anchors: T=4 → A $1,376.25 / B $1,423.28 (B wins);
 *      T=15 → A $3,926.61 / B $3,901.32 (A wins; the slide rounds to $3,901.3).
 *   2. VOLATILITY DRAG (deck §4): arithmetic vs geometric averages,
 *      R_G ≈ R_A − ½σ². 25 seeded wealth paths of R_t = μ + σz_t against the
 *      "arithmetic promise" (1+μ)^t and the geometric expectation
 *      (1+μ−½σ²)^t. Presets = the deck's 1991–2025 annual-returns table.
 *
 * All finance math lives in ../../lib/finmath.js (decimals); this file
 * formats for display. State (incl. the PRNG seed) serializes to the URL
 * hash — one shared store, since two bindState stores would clobber each
 * other's hash (same pattern as tools/duration).
 */

import {
  feeWealth, decliningExitFee,
  arithmeticMean, geometricMean, geometricApprox,
  mulberry32, randn,
} from '../../lib/finmath.js';
import { Chart, fixed, niceTicks } from '../../lib/chart.js';
import { slider, numberInput, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

import { gateTool } from '../../lib/release.js';
await gateTool('compounding-drags');  // release gate — must run before anything below

hydrateLabels();

/* ----------------------------------------------------------------- state -- */

const DEFAULTS = {
  // fee column (percents stored as percents for readable URLs)
  x0: 1000,   // investment X_0, dollars
  r: 10,      // gross annual return, %
  T: 15,      // horizon, years
  al: 6,      // Fund A front-end load, %
  af: 0,      // Fund A annual fee, %
  bl: 0,      // Fund B front-end load, %
  bf: 0.5,    // Fund B annual fee, %
  bx: true,   // Fund B declining exit fee (5% − 1%/yr) on/off
  // volatility column
  mu: 12.83,  // arithmetic mean μ, %
  sg: 18.22,  // standard deviation σ, %
  ny: 35,     // years N
  seed: 20260711, // PRNG seed (URL-shareable → reproducible picture)
};

const store = bindState(DEFAULTS);
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

/** Growth-of-$1 axis tick: "$40", "$0.50". */
function usdGrowthTick(v) {
  if (v >= 20) return `$${Math.round(v).toLocaleString('en-US')}`;
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** Decimal → "11.17%". */
function pctS(dec, d = 2) {
  return `${(dec * 100).toFixed(d)}%`;
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

/* ==========================================================================
 *  LEFT COLUMN — FEE DRAG (Lecture 1 §6)
 * ======================================================================== */

const feeChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('fee-chart')), {
  width: 540, height: 430,
  margin: { top: 18, right: 22, bottom: 48, left: 76 },
  xLabel: 'Year', yLabel: 'Wealth if Cashed Out',
  xFmt: fixed(0), yFmt: usdTick,
});

/** Everything derived from the fee-column state (decimals throughout). */
function feeModel() {
  const x0 = Math.max(1, Number(S.x0) || 0); // guard: empty/0 input
  const r = Number(S.r) / 100;
  const T = Math.max(1, Math.round(Number(S.T)));
  const aLoad = Number(S.al) / 100;
  const aFee = Number(S.af) / 100;
  const bLoad = Number(S.bl) / 100;
  const bFee = Number(S.bf) / 100;
  const bDecl = Boolean(S.bx);
  /** Fund B's exit fee AS OF a cash-out in year t (0 when toggled off). */
  const exitAt = (t) => (bDecl ? decliningExitFee(0.05, 0.01, t) : 0);
  const wA = (t) => feeWealth(x0, r, t, { frontLoad: aLoad, annualFee: aFee });
  const wB = (t) => feeWealth(x0, r, t, { frontLoad: bLoad, annualFee: bFee, exitFee: exitAt(t) });
  const wFree = (t) => x0 * Math.pow(1 + r, t);
  return { x0, r, T, aLoad, aFee, bLoad, bFee, bDecl, exitAt, wA, wB, wFree };
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
      out.push((lo + hi) / 2);
    }
    prevT = t;
    prevD = d;
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

/* --------------------------------------------------------- fee controls --- */

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
const cBx = toggle({
  label: 'Declining exit fee (5% − 1% per yr)', value: Boolean(S.bx),
  onChange: (v) => { store.set('bx', v); renderFee(); },
});

document.getElementById('ctrl-x0').appendChild(cX0);
document.getElementById('ctrl-r').appendChild(cR);
document.getElementById('ctrl-T').appendChild(cT);
document.getElementById('ctrl-al').appendChild(cAl);
document.getElementById('ctrl-af').appendChild(cAf);
document.getElementById('ctrl-bl').appendChild(cBl);
document.getElementById('ctrl-bf').appendChild(cBf);
document.getElementById('ctrl-bx').appendChild(cBx);

/** Push a fee-column preset into the state AND the controls, then render. */
function applyFeePreset(p) {
  store.patch(p);
  cX0.set(p.x0); cR.set(p.r); cT.set(p.T);
  cAl.set(p.al); cAf.set(p.af);
  cBl.set(p.bl); cBf.set(p.bf); cBx.set(p.bx);
  renderFee();
}

// deck anchors (L1 §6): A $1,376.25 / B $1,423.28 at T=4;
// A $3,926.61 / B $3,901.32 at T=15
document.getElementById('btn-fee-deck').addEventListener('click', () => {
  applyFeePreset({ x0: 1000, r: 10, T: 15, al: 6, af: 0, bl: 0, bf: 0.5, bx: true });
});
// active vs passive: gap ≈ $99,628 after 30 years
document.getElementById('btn-fee-active').addEventListener('click', () => {
  applyFeePreset({ x0: 100000, r: 6, T: 30, al: 0, af: 0.84, bl: 0, bf: 0.14, bx: false });
});

/* ==========================================================================
 *  RIGHT COLUMN — VOLATILITY DRAG (Lecture 1 §4)
 * ======================================================================== */

const NPATHS = 25;

const volChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('vol-chart')), {
  width: 540, height: 430,
  margin: { top: 18, right: 22, bottom: 48, left: 64 },
  xLabel: 'Year', yLabel: 'Growth of $1',
  xFmt: fixed(0), yFmt: usdGrowthTick,
});

// clip the data layer to the plot rectangle: with the y axis capped, lucky
// paths would otherwise draw straight through the margins (chart.js itself
// never clips because normal tools size the domain to the data)
{
  const SVGNS = 'http://www.w3.org/2000/svg';
  const a = volChart.plotArea();
  const defs = document.createElementNS(SVGNS, 'defs');
  const cp = document.createElementNS(SVGNS, 'clipPath');
  cp.setAttribute('id', 'vol-plot-clip');
  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('x', String(a.x0));
  rect.setAttribute('y', String(a.y0));
  rect.setAttribute('width', String(a.w));
  rect.setAttribute('height', String(a.h));
  cp.appendChild(rect);
  defs.appendChild(cp);
  volChart.svg.insertBefore(defs, volChart.svg.firstChild);
  volChart.dataGroup.setAttribute('clip-path', 'url(#vol-plot-clip)');
}

// deck's 1991–2025 annual-returns table (L1 "Annual Risk and Return"):
// arithmetic mean, sample SD, and the table's ACTUAL geometric mean (%)
const VOL_PRESETS = [
  { btn: 'btn-small', name: 'Small U.S. stocks', mu: 14.19, sg: 25.20, actual: 11.43 },
  { btn: 'btn-large', name: 'Large U.S. stocks', mu: 12.83, sg: 18.22, actual: 11.22 },
  { btn: 'btn-dev', name: 'Developed markets', mu: 10.39, sg: 17.05, actual: 8.91 },
];

/**
 * Draw NPATHS wealth paths of N annual returns R_t = μ + σ·z_t, z ~ N(0,1)
 * via the seeded PRNG (path k gets seed + k, so the whole fan is
 * reproducible from one URL-hash seed). Each R_t is clamped at −99%.
 */
function simPaths(mu, sg, N, seed) {
  const paths = [];
  for (let k = 0; k < NPATHS; k++) {
    const rng = mulberry32((seed + k) >>> 0);
    const rets = [];
    const w = [1];
    for (let t = 1; t <= N; t++) {
      const R = Math.max(-0.99, mu + sg * randn(rng));
      rets.push(R);
      w.push(w[t - 1] * (1 + R));
    }
    paths.push({ rets, w });
  }
  return paths;
}

/** Linear-interpolated quantile of an array. */
function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function renderVol() {
  const mu = Number(S.mu) / 100;
  const sg = Number(S.sg) / 100;
  const N = Math.max(2, Math.round(Number(S.ny)));
  const seed = Number(S.seed) >>> 0;
  const g = geometricApprox(mu, sg); // μ − σ²/2

  const paths = simPaths(mu, sg, N, seed);
  const arith = (t) => Math.pow(1 + mu, t);
  const geom = (t) => Math.pow(1 + g, t);

  // y cap: always show the arithmetic-promise curve in full, but never let
  // one lucky path set the scale — cap at the 80th-percentile path maximum
  const maxima = paths.map((p) => Math.max(...p.w));
  const yHi = Math.max(arith(N) * 1.08, quantile(maxima, 0.8), 1.5);
  const clipped = maxima.filter((mx) => mx > yHi).length;

  const xStep = N <= 12 ? 1 : N <= 30 ? 5 : 10;
  const xTicks = [];
  for (let t = 0; t <= N; t += xStep) xTicks.push(t);
  volChart.setDomain(0, N, 0, yHi)
    .renderAxes({ xTicks, yTicks: niceTicks(0, yHi, 6) });
  volChart.clearData();

  // 24 faint paths first, then the reference curves, bold path on top
  for (let k = 1; k < NPATHS; k++) {
    volChart.path(paths[k].w.map((v, t) => ({ x: t, y: v })), {
      stroke: 'var(--blue)', width: 1, opacity: 0.16,
    });
  }
  const CURVE_N = 160;
  const ptsA = [];
  const ptsG = [];
  for (let i = 0; i <= CURVE_N; i++) {
    const t = (N * i) / CURVE_N;
    ptsA.push({ x: t, y: arith(t) });
    ptsG.push({ x: t, y: geom(t) });
  }
  volChart.path(ptsA, { stroke: 'var(--axis)', width: 1.8, dash: '6 5', opacity: 0.9 });
  volChart.path(ptsG, { stroke: 'var(--gold)', width: 2.4 });
  volChart.path(paths[0].w.map((v, t) => ({ x: t, y: v })), {
    stroke: 'var(--blue)', width: 2.8,
  });

  // readouts: the bold path's SAMPLE means vs the theoretical drag ...
  const ra = arithmeticMean(paths[0].rets);
  const rg = geometricMean(paths[0].rets);
  /** @type {HTMLElement} */ (document.getElementById('vol-readouts')).replaceChildren(
    readout('Sample $\\bar{R}_A$ (bold path)', pctS(ra), 'blue'),
    readout('Sample $\\bar{R}_G$ (bold path)', pctS(rg), 'blue'),
    readout('Sample drag $\\bar{R}_A - \\bar{R}_G$', pctS(ra - rg)),
    readout('Theoretical drag $\\tfrac{1}{2}\\sigma^2$', pctS(0.5 * sg * sg)),
  );
  // ... and the population inputs
  /** @type {HTMLElement} */ (document.getElementById('vol-readouts2')).replaceChildren(
    readout('Arithmetic input $\\mu$', pctS(mu)),
    readout('Prediction $\\mu - \\tfrac{1}{2}\\sigma^2$', pctS(g), 'gold'),
  );

  // formula strip
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('vol-f-defs')),
    '\\bar{R}_A = \\frac{R_1 + \\dots + R_N}{N}' +
    ' \\qquad \\bar{R}_G = \\bigl[(1+R_1)\\cdots(1+R_N)\\bigr]^{1/N} - 1');
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('vol-f-approx')),
    `R_G \\;\\approx\\; R_A - \\tfrac{1}{2}\\sigma^2 \\;=\\; ${pctTeX(mu)}` +
    ` - \\tfrac{1}{2}\\,(${pctTeX(sg)})^2 \\;=\\; ${GOLD}{\\mathbf{${pctTeX(g)}}}`);

  // caption: axis-cap note (+ how many paths run off the top)
  const cap = /** @type {HTMLElement} */ (document.getElementById('vol-caption'));
  renderLabel(cap,
    (clipped > 0
      ? `${clipped} of ${NPATHS} paths run off the top of the chart — the `
      : 'The ')
    + 'vertical axis is capped at the 80th-percentile path so one lucky draw '
    + "doesn't squash the rest. In the long run each path compounds at its "
    + 'geometric mean — the gold curve, not the grey dashed arithmetic promise.');

  // preset note: predicted μ − ½σ² vs the deck table's ACTUAL geometric mean
  const note = /** @type {HTMLElement} */ (document.getElementById('vol-preset-note'));
  const active = VOL_PRESETS.find(
    (p) => Math.abs(Number(S.mu) - p.mu) < 0.005 && Math.abs(Number(S.sg) - p.sg) < 0.005,
  );
  for (const p of VOL_PRESETS) {
    document.getElementById(p.btn).classList.toggle('active', p === active);
  }
  if (active) {
    note.hidden = false;
    renderLabel(note,
      `${active.name}, 1991–2025: predicted $\\bar{R}_G \\approx ${active.mu.toFixed(2)}\\%`
      + ` - \\tfrac{1}{2}(${active.sg.toFixed(2)}\\%)^2 = ${pctTeX(geometricApprox(active.mu / 100, active.sg / 100))}$`
      + ` vs actual $${active.actual.toFixed(2)}\\%$ in the deck's table.`);
  } else {
    note.hidden = true;
  }
}

// the static +100%/−50% hook card (deck §4): arithmetic 25%, geometric 0%.
// renderLabel (not renderTeX) so the line can WRAP between math segments —
// the half-width column is too narrow for one unbroken formula.
renderLabel(/** @type {HTMLElement} */ (document.getElementById('deck-hook')),
  '$R_1 = +100\\%$, $R_2 = -50\\%$: '
  + 'arithmetic $\\bar{R}_A = \\tfrac{100\\% - 50\\%}{2} = \\mathbf{25\\%}$ '
  + 'but geometric $\\bar{R}_G = \\bigl[(1{+}1)(1{-}\\tfrac{1}{2})\\bigr]^{1/2} - 1 = \\mathbf{0\\%}$');

/* --------------------------------------------------------- vol controls --- */

const cMu = slider({
  label: 'Arithmetic mean $\\mu$', min: 0, max: 20, step: 0.01, value: Number(S.mu),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('mu', v); renderVol(); },
});
const cSg = slider({
  label: 'Volatility $\\sigma$', min: 0, max: 40, step: 0.01, value: Number(S.sg),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('sg', v); renderVol(); },
});
const cNy = slider({
  label: 'Years $N$', min: 5, max: 50, step: 1, value: Number(S.ny),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('ny', Math.round(v)); renderVol(); },
});

document.getElementById('ctrl-mu').appendChild(cMu);
document.getElementById('ctrl-sg').appendChild(cSg);
document.getElementById('ctrl-ny').appendChild(cNy);

// ↻ re-draw: bump the seed (stored in the URL state)
document.getElementById('btn-redraw').addEventListener('click', () => {
  store.set('seed', (Math.random() * 0xffffffff) >>> 0);
  renderVol();
});

for (const p of VOL_PRESETS) {
  document.getElementById(p.btn).addEventListener('click', () => {
    store.patch({ mu: p.mu, sg: p.sg });
    cMu.set(p.mu);
    cSg.set(p.sg);
    renderVol();
  });
}

/* ---------------------------------------------------------- first paint -- */

renderFee();
renderVol();
