// @ts-check
/**
 * Duration & bond pricing explorer (FIN 30600, Topic 7).
 *
 * Two linked views of one bond (annual coupons, face $1,000):
 *   (a) the price–yield curve B(y) with the DURATION TANGENT at the current
 *       yield (slope dB/dy = -D·B/(1+y)), showing the deck's approximation
 *       ΔB/B ≈ -D·Δy/(1+y) against exact repricing at y + Δy — the convexity
 *       gap between the tangent prediction and the curve (sec4_duration.tex,
 *       "Duration and interest rate risk");
 *   (b) the cash-flow timeline: PV bars of each cash flow with a fulcrum
 *       (balance point) at t = D — the deck's seesaw imagery.
 *
 * Defaults are the deck's worked Example 1 (sec4_duration.tex, also
 * DurationExample.xlsx): an 8% annual coupon, 6-year bond at y = 8%
 * (B = $1,000, D = 4.99 years). The "deck example" button additionally sets
 * Δy = -100bp to reproduce the slide's ΔB ≈ +$46.2 (duration) vs +$47.7
 * (exact).
 *
 * The spot-curve/forward-rate panel lives in ./spotpanel.js (shares the one
 * URL-hash store, since two bindState stores would clobber each other's hash).
 */

import { Chart, pct, fixed, niceTicks } from '../../lib/chart.js';
import { bondPrice, macaulayDuration, durationApproxRel } from '../../lib/finmath.js';
import { slider, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';
import { initSpotPanel } from './spotpanel.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('duration');

hydrateLabels();

/* ----------------------------------------------------------------- state -- */
const FACE = 1000;
const Y_MIN_CURVE = 0.001; // left end of the plotted price–yield curve
const Y_MAX_CURVE = 0.16;

const defaults = {
  c: 8,     // coupon rate, percent (deck Example 1)
  n: 6,     // years to maturity (deck Example 1)
  y: 8,     // yield to maturity, percent (deck Example 1)
  dy: -50,  // yield move, basis points
  // spot-curve panel (YieldCurve_ForwardRate_Examples.xlsx defaults)
  s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, // spot rates, percent
  sc: 5,    // illustrative 5-year bond's coupon, percent
};

// Numeric ranges mirror the controls; hash values clamp to these (state.js) —
// `#y=-150` (i.e. 1+y < 0) or `#n=1000` must not render garbage.
const BOUNDS = {
  c: [0, 15], n: [1, 30], y: [0, 15], dy: [-300, 300],
  s1: [0, 15], s2: [0, 15], s3: [0, 15], s4: [0, 15], s5: [0, 15], sc: [0, 15],
};
const store = bindState(defaults, () => {}, { debounce: 150, bounds: BOUNDS });
const S = store.state;

/* --------------------------------------------------------------- helpers -- */
/** Dollar tick/readout formatter: 1051.54 -> "$1,052". */
function usd0(v) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Dollar amount with cents: "$1,051.54" (readouts, not axis ticks). */
function usd2(v) {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Signed percent with 2 decimals: 0.0231 -> "+2.31%". */
function signedPct(v) {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}%`;
}

/** Same, as a TeX-safe string (escaped \%). */
function signedPctTeX(v) {
  return `${v >= 0 ? '+' : '-'}${Math.abs(v * 100).toFixed(2)}\\%`;
}

/** Signed dollar amount: 46.23 -> "+$46.23". */
function signedUsd(v) {
  return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;
}

/** Model quantities derived from the current state (decimals throughout). */
function model() {
  const c = Number(S.c) / 100;
  const n = Math.max(1, Math.round(Number(S.n)));
  const y = Number(S.y) / 100;
  const dy = Number(S.dy) / 10000; // bp -> decimal
  const B0 = bondPrice(c, y, n, FACE);
  const D = macaulayDuration(c, y, n, FACE);
  const Dstar = D / (1 + y);
  const slope = (-D * B0) / (1 + y); // dB/dy at the current yield
  const yNew = y + dy;
  const Bexact = bondPrice(c, yNew, n, FACE); // valid for yNew > -1 (incl. negative yields)
  const relApprox = durationApproxRel(D, y, dy); // -D·Δy/(1+y)
  const Bapprox = B0 * (1 + relApprox);          // tangent prediction
  const relExact = Bexact / B0 - 1;
  return { c, n, y, dy, B0, D, Dstar, slope, yNew, Bexact, Bapprox, relApprox, relExact };
}

/**
 * Filled shape helper: chart.path draws stroke-only; re-purpose it with a
 * closed point list and set fill (same trick as the diversification tool).
 */
function filled(chart, points, fill, opacity = 1) {
  const node = chart.path(points, { stroke: 'none' });
  node.setAttribute('fill', fill);
  node.setAttribute('opacity', String(opacity));
  return node;
}

/** Axis-aligned bar from y=0 to y=h, centered at x with half-width w. */
function bar(chart, x, y0, y1, w, fill, opacity = 1) {
  return filled(chart, [
    { x: x - w, y: y0 }, { x: x - w, y: y1 },
    { x: x + w, y: y1 }, { x: x + w, y: y0 },
  ], fill, opacity);
}

/* ---------------------------------------------------------------- charts -- */
const pyHost = /** @type {HTMLElement} */ (document.getElementById('py-chart'));
const cfHost = /** @type {HTMLElement} */ (document.getElementById('cf-chart'));

const pyChart = new Chart(pyHost, {
  width: 720,
  height: 480,
  margin: { top: 20, right: 22, bottom: 54, left: 82 },
  xLabel: 'Yield to Maturity',
  yLabel: 'Bond Price',
  xFmt: pct,
  yFmt: usd0,
});

const cfChart = new Chart(cfHost, {
  width: 480,
  height: 400,
  margin: { top: 18, right: 20, bottom: 52, left: 76 },
  xLabel: 'Year',
  yLabel: 'PV of Cash Flow',
  xFmt: fixed(0),
  yFmt: usd0,
});

/* --------------------------------------------- price–yield view (a) ------- */
let pyDomainKey = '';
function drawPriceYield(m) {
  // domain follows the bond (not the yield sliders): rebuild axes only when
  // coupon or maturity actually changes
  const bTop = bondPrice(m.c, Y_MIN_CURVE, m.n, FACE);
  const bBot = bondPrice(m.c, Y_MAX_CURVE, m.n, FACE);
  const key = `${m.c}|${m.n}`;
  if (key !== pyDomainKey) {
    pyDomainKey = key;
    const yHi = bTop * 1.03;
    const yLo = Math.max(0, bBot - (yHi - bBot) * 0.06);
    const xTicks = [0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16];
    pyChart.setDomain(0, Y_MAX_CURVE, yLo, yHi)
      .renderAxes({ xTicks, yTicks: niceTicks(yLo, yHi, 6) });
  }
  pyChart.clearData();

  // duration tangent through (y, B): L(x) = B + slope·(x - y), clipped to the
  // plot rectangle (slope < 0 always, but guard the flat case)
  const L = (x) => m.B0 + m.slope * (x - m.y);
  let xa = 0;
  let xb = Y_MAX_CURVE;
  if (m.slope < 0) {
    xa = Math.max(xa, m.y + (pyChart.yHi - m.B0) / m.slope);
    xb = Math.min(xb, m.y + (pyChart.yLo - m.B0) / m.slope);
  }
  if (xb > xa) {
    pyChart.segment(xa, L(xa), xb, L(xb), {
      stroke: 'var(--red)', dash: '7 5', width: 1.8, opacity: 0.9,
    });
  }

  // the convex price–yield curve
  const pts = [];
  const N_SAMPLES = 240;
  for (let i = 0; i <= N_SAMPLES; i++) {
    const x = Y_MIN_CURVE + ((Y_MAX_CURVE - Y_MIN_CURVE) * i) / N_SAMPLES;
    pts.push({ x, y: bondPrice(m.c, x, m.n, FACE) });
  }
  pyChart.path(pts, { stroke: 'var(--blue)', width: 3 });

  // the Δy move: guide line, convexity gap, exact vs tangent markers
  // (skipped when y + Δy falls left of the plot, i.e. below 0)
  if (Math.abs(m.dy) > 1e-9 && m.yNew >= 0) {
    pyChart.vline(m.yNew, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.55 });
    pyChart.segment(m.yNew, m.Bapprox, m.yNew, m.Bexact, {
      stroke: 'var(--navy)', width: 1.4, opacity: 0.7,
    });
    pyChart.point(m.yNew, m.Bapprox, { r: 4.5, fill: 'var(--navy)', shape: 'diamond' });
    pyChart.point(m.yNew, m.Bexact, { r: 5.5, fill: 'var(--gold)', stroke: '#fff' });
    // labels go on the gold point's side AWAY from the current (y, B) point,
    // so they never collide with the B label at small |Δy|
    let moveRight = m.dy > 0;
    if (m.yNew < 0.02) moveRight = true;
    if (m.yNew > 0.14) moveRight = false;
    // offsets follow the chart's phone text scale so the two labels stay apart
    const ts = pyChart.textScale;
    pyChart.text(m.yNew, m.Bexact, `exact ${usd0(m.Bexact)}`, {
      dx: (moveRight ? 12 : -12) * ts, dy: -8 * ts, anchor: moveRight ? 'start' : 'end', fill: 'var(--gold)',
    });
    pyChart.text(m.yNew, m.Bapprox, `tangent ${usd0(m.Bapprox)}`, {
      dx: (moveRight ? 12 : -12) * ts, dy: 16 * ts, anchor: moveRight ? 'start' : 'end', fill: 'var(--navy)',
    });
  }

  // current (y, B) point on top (label on the side away from the Δy markers)
  let bRight = m.dy <= 0;
  if (m.y < 0.02) bRight = true;
  if (m.y > 0.14) bRight = false;
  pyChart.point(m.y, m.B0, { r: 6, fill: 'var(--blue)', stroke: '#fff' });
  pyChart.text(m.y, m.B0, `B = ${usd0(m.B0)}`, {
    dx: (bRight ? 12 : -12) * pyChart.textScale, dy: -10 * pyChart.textScale, anchor: bRight ? 'start' : 'end', fill: 'var(--blue)',
  });
}

/* --------------------------------------- cash-flow / fulcrum view (b) ----- */
let cfDomainKey = '';
function drawCashFlows(m) {
  const coupon = m.c * FACE;
  const disc = (t) => Math.pow(1 + m.y, t);
  const pvCoupon = (t) => coupon / disc(t);
  const pvFace = FACE / disc(m.n);
  const maxPv = Math.max(pvCoupon(1), pvCoupon(m.n) + pvFace, 1);

  // rebuild axes only when the domain actually changes: snap the top to the
  // next "nice" tick step so slider drags don't rebuild every frame
  const probe = niceTicks(0, maxPv * 1.1, 5);
  const step = probe.length > 1 ? probe[1] - probe[0] : Math.max(maxPv, 1);
  const yHi = Math.max(step, Math.ceil((maxPv * 1.05) / step) * step);
  const key = `${m.n}|${yHi.toFixed(4)}`;
  if (key !== cfDomainKey) {
    cfDomainKey = key;
    const yLo = -0.14 * yHi; // room below the beam for the fulcrum triangle
    const xStep = m.n <= 12 ? 1 : m.n <= 20 ? 2 : 5;
    const xTicks = [];
    for (let t = xStep; t <= m.n; t += xStep) xTicks.push(t);
    if (xTicks[0] !== 1) xTicks.unshift(1);
    cfChart.setDomain(0.2, m.n + 0.8, yLo, yHi)
      .renderAxes({ xTicks, yTicks: niceTicks(0, yHi, 5).filter((v) => v >= 0) });
  }
  cfChart.clearData();

  // PV bars: coupons blue; year n stacks the face-value PV (gold) on top
  const w = Math.min(0.32, (m.n + 0.6) * 0.035 + 0.12);
  for (let t = 1; t <= m.n; t++) {
    if (m.c > 0) bar(cfChart, t, 0, pvCoupon(t), w, 'var(--blue)', 0.9);
    if (t === m.n) bar(cfChart, t, m.c > 0 ? pvCoupon(t) : 0, pvCoupon(t) + pvFace, w, 'var(--gold)', 0.9);
  }

  // the "beam" (time axis) and the fulcrum triangle at t = D
  cfChart.hline(0, { stroke: 'var(--navy)', width: 2 });
  const triW = (m.n + 0.6) * 0.028;
  filled(cfChart, [
    { x: m.D, y: 0 },
    { x: m.D - triW, y: cfChart.yLo * 0.82 },
    { x: m.D + triW, y: cfChart.yLo * 0.82 },
  ], 'var(--navy)');
  const anchorEnd = m.D > (m.n + 1) * 0.62;
  cfChart.text(m.D, cfChart.yLo * 0.55, `D = ${m.D.toFixed(2)} yr`, {
    dx: anchorEnd ? -12 : 12, anchor: anchorEnd ? 'end' : 'start', fill: 'var(--navy)',
  });
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(m) {
  const rows = [
    ['Bond price $B$', usd2(m.B0), 'blue'],
    ['Macaulay duration $D$', `${m.D.toFixed(4)} yr`, ''],
    ['Modified duration $D^{*} = D/(1+y)$', `${m.Dstar.toFixed(4)} yr`, ''],
    ['$\\Delta B/B$ — duration approx', signedPct(m.relApprox), ''],
    ['$\\Delta B/B$ — exact repricing', signedPct(m.relExact), 'gold'],
    ['Exact new price $B(y+\\Delta y)$', usd2(m.Bexact), 'gold'],
  ];
  const host = /** @type {HTMLElement} */ (document.getElementById('readouts'));
  host.replaceChildren();
  for (const [k, v, cls] of rows) {
    const cell = document.createElement('div');
    cell.className = 'readout';
    const key = document.createElement('div');
    key.className = 'k';
    renderLabel(key, k);
    const val = document.createElement('div');
    val.className = `v ${cls}`;
    val.textContent = v;
    cell.append(key, val);
    host.appendChild(cell);
  }
}

/* ------------------------------------------------------- formula strip ---- */
const BLUE = '\\textcolor{#0072B2}';
const GOLD = '\\textcolor{#C99700}';

function drawFormulas(m) {
  const dyStr = `${m.dy >= 0 ? '+' : '-'}${Math.abs(m.dy).toFixed(4)}`;
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-rel')),
    `\\frac{\\Delta B}{B} \\;\\approx\\; -D\\cdot\\frac{\\Delta y}{1+y}` +
    ` \\;=\\; -${BLUE}{${m.D.toFixed(4)}}\\cdot\\frac{${dyStr}}{${(1 + m.y).toFixed(4)}}` +
    ` \\;=\\; \\mathbf{${signedPctTeX(m.relApprox)}}` +
    ` \\qquad\\text{vs. exact repricing: } ${GOLD}{\\mathbf{${signedPctTeX(m.relExact)}}}`,
  );
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-dollar')),
    `\\Delta B \\;\\approx\\; -D\\cdot B\\cdot\\frac{\\Delta y}{1+y}` +
    ` \\;=\\; \\mathbf{${m.relApprox * m.B0 >= 0 ? '+' : '-'}\\$${Math.abs(m.relApprox * m.B0).toFixed(2)}}` +
    ` \\qquad\\text{vs. exact: } ${GOLD}{\\mathbf{${m.Bexact - m.B0 >= 0 ? '+' : '-'}\\$${Math.abs(m.Bexact - m.B0).toFixed(2)}}}`,
  );
}

/* ---------------------------------------------------------- render cycle -- */
function renderAll() {
  const m = model();
  drawPriceYield(m);
  drawCashFlows(m);
  drawReadouts(m);
  drawFormulas(m);
}

/* -------------------------------------------------------------- controls -- */
const cCtrl = slider({
  label: 'Coupon rate $c$', min: 0, max: 15, step: 0.5, value: Number(S.c),
  fmt: (v) => `${v.toFixed(1)}%`,
  onChange: (v) => { store.set('c', v); renderAll(); },
});
const nCtrl = slider({
  label: 'Maturity $n$ (years)', min: 1, max: 30, step: 1, value: Number(S.n),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('n', Math.round(v)); renderAll(); },
});
const yCtrl = slider({
  label: 'Yield to maturity $y$', min: 0, max: 15, step: 0.25, value: Number(S.y),
  fmt: (v) => `${v.toFixed(2)}%`,
  onChange: (v) => { store.set('y', v); renderAll(); },
});
const dyCtrl = slider({
  label: 'Yield move $\\Delta y$', min: -300, max: 300, step: 5, value: Number(S.dy),
  fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} bp`,
  onChange: (v) => { store.set('dy', v); renderAll(); },
});

document.getElementById('ctrl-c').appendChild(cCtrl);
document.getElementById('ctrl-n').appendChild(nCtrl);
document.getElementById('ctrl-y').appendChild(yCtrl);
document.getElementById('ctrl-dy').appendChild(dyCtrl);

// deck anchor (sec4_duration.tex "Example: duration and interest rate risk"):
// 8% coupon, 6 years, y = 8%, rates drop to 7% (Δy = -100bp)
document.getElementById('btn-deck').addEventListener('click', () => {
  store.patch({ c: 8, n: 6, y: 8, dy: -100 });
  cCtrl.set(8);
  nCtrl.set(6);
  yCtrl.set(8);
  dyCtrl.set(-100);
  renderAll();
});

/* ---------------------------------------------------- spot-curve panel ---- */
initSpotPanel(store);

renderAll();
