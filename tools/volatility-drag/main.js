// @ts-check
/**
 * Volatility Drag: arithmetic vs geometric averages (FIN 30600, Topic 1 §4).
 *
 * R_G ≈ R_A − ½σ². 25 seeded wealth paths of R_t = μ + σz_t against the
 * "arithmetic promise" (1+μ)^t and the geometric expectation (1+μ−½σ²)^t.
 * Presets = the deck's 1991–2025 annual-returns table; the static hook card
 * is the deck's +100%/−50% example (arithmetic 25%, geometric 0%).
 *
 * Split out of the original two-column "compounding-drags" tool 2026-07-11
 * (Christian: separate tools); its sibling is tools/fee-drag/.
 * All finance math lives in ../../lib/finmath.js (decimals); this file
 * formats for display. State (incl. the PRNG seed) serializes to the URL hash.
 */

import {
  arithmeticMean, geometricMean, geometricApprox,
  mulberry32, randn,
} from '../../lib/finmath.js';
import { Chart, fixed, niceTicks } from '../../lib/chart.js';
import { slider, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

import { gateTool } from '../../lib/release.js';
await gateTool('volatility-drag');  // release gate — must run before anything below

hydrateLabels();

/* ----------------------------------------------------------------- state -- */

const DEFAULTS = {
  mu: 12.83,  // arithmetic mean μ, % (percents stored as percents for readable URLs)
  sg: 18.22,  // standard deviation σ, %
  ny: 35,     // years N
  seed: 20260711, // PRNG seed (URL-shareable → reproducible picture)
};

// Numeric ranges mirror the sliders; hash values clamp to these (state.js) —
// a shared `#ny=1e9` must not run 25 billion-step simulations.
const BOUNDS = { mu: [0, 20], sg: [0, 40], ny: [5, 50], seed: [0, 4294967295] };
const store = bindState(DEFAULTS, undefined, { bounds: BOUNDS });
const S = store.state;

/* ------------------------------------------------------------ formatting -- */

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

const GOLD = '\\textcolor{#C99700}';

/* ------------------------------------------------------------------ chart -- */

const NPATHS = 25;

const volChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('vol-chart')), {
  width: 720, height: 440,
  margin: { top: 18, right: 26, bottom: 48, left: 68 },
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

/* --------------------------------------------------------------- controls -- */

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

/* ------------------------------------------------------------ first paint -- */

renderVol();
