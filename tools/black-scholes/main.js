// @ts-check
/**
 * Black–Scholes option pricing explorer (FIN 30600, Topic 8 §3–4).
 *
 * Mirrors the deck's worked example (content/sec4_pricing.tex: S=100, X=95,
 * r_f=0.10, dividend δ=0, T=0.25, σ=50% → d1=0.430, d2=0.180, C=13.695,
 * P=6.350, call Δ = N(d1) = 0.67) and the §3 put–call parity Example 1
 * (P=4.20, S=26, X=30, r=6% EAY, T=1/12 → C=0.35). The main chart is a live
 * version of the deck's l8_option_value.pdf figure: BS value vs intrinsic
 * value, the gap between them being time value, plus the delta tangent that
 * ties the picture to the hedge-ratio slides.
 *
 * All finance math lives in ../../lib/finmath.js; this file wires controls,
 * the three charts, readouts, the live MathJax strip, and the parity card.
 */

import { Chart, fixed, pct, svgMathText } from '../../lib/chart.js';
import {
  bsD1D2, bsCall, bsPut, bsCallDelta, bsPutDelta, normCdf, parityCall,
} from '../../lib/finmath.js';
import { slider, numberInput, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('black-scholes');

hydrateLabels();

/* ----------------------------------------------------------------- state -- */
const defaults = {
  s: 100,       // spot S_0 ($)
  x: 95,        // strike X ($)
  v: 50,        // volatility σ (whole %)
  r: 10,        // risk-free rate (whole %, continuously compounded in BS)
  t: 0.25,      // time to expiration (years)
  q: 0,         // dividend yield δ (whole %)
  opt: 'call',  // focused option for the main chart
  // put–call parity card (deck form, effective annual rate)
  pp: 3,        // put price
  ps: 10,       // spot
  px: 10,       // strike
  pr: 3,        // r_f (whole %, effective annual yield)
  pt: 1,        // T (years)
};
const PARITY_DECK = { pp: 4.2, ps: 26, px: 30, pr: 6, pt: 0.0833 }; // Example 1, T = 1/12

// Numeric ranges mirror the controls; hash values clamp to these (state.js) —
// σ and T floors keep bsD1D2's readouts finite (`#v=0` → d1 = Infinity).
const BOUNDS = {
  s: [20, 200], x: [20, 200], v: [5, 60], r: [0, 12], t: [0.05, 3], q: [0, 6],
  pp: [0, 1000], ps: [0.01, 10000], px: [0.01, 10000], pr: [0, 20], pt: [0.01, 3],
};
const store = bindState(defaults, () => {}, { debounce: 150, bounds: BOUNDS });
const S = store.state;

/* --------------------------------------------------------------- helpers -- */
/** Current model parameters, converted to finmath decimals. */
function params() {
  return {
    s: Number(S.s),
    x: Number(S.x),
    sig: Number(S.v) / 100,
    r: Number(S.r) / 100,
    t: Number(S.t),
    q: Number(S.q) / 100,
    opt: S.opt === 'put' ? 'put' : 'call',
  };
}

/** Money tick formatter: $50, or $2.5 below $20 for the mini charts. */
function money(v) {
  const a = Math.abs(v);
  const s = a >= 20 ? String(Math.round(a)) : String(+a.toFixed(1));
  return `${v < 0 ? '-$' : '$'}${s}`;
}

/** Trim a number to d decimals without trailing zeros ("0.25", "100"). */
const tv = (v, d = 2) => String(+v.toFixed(d));

/** {x, y} samples of f over [lo, hi]. */
function sample(f, lo, hi, n = 160) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const xx = lo + ((hi - lo) * i) / n;
    pts.push({ x: xx, y: f(xx) });
  }
  return pts;
}

/**
 * Filled area between two curves sharing x samples. chart.path draws
 * stroke-only; re-purpose it and set fill (as in the diversification tool).
 */
function area(chart, top, bottom, fill, opacity) {
  const node = chart.path([...top, ...bottom.slice().reverse()], { stroke: 'none' });
  node.setAttribute('fill', fill);
  node.setAttribute('opacity', String(opacity));
  return node;
}

/**
 * Axis titles are plain textContent in chart.js; re-render them through
 * svgMathText so "S_0" gets a true tspan subscript.
 */
function fixAxisTitleMath(chart) {
  for (const sel of ['.axis-title-x', '.axis-title-y']) {
    const node = chart.axisGroup.querySelector(sel);
    if (node) svgMathText(/** @type {SVGTextElement} */ (node), node.textContent || '');
  }
}

/* ---------------------------------------------------------------- charts -- */
const mainChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('main-chart')), {
  width: 760,
  height: 460,
  xLabel: 'Stock Price S_0',
  yLabel: 'Option Value',
  xFmt: money,
  yFmt: money,
});
const sigChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('sigma-chart')), {
  width: 460,
  height: 300,
  margin: { top: 16, right: 22, bottom: 50, left: 68 },
  xLabel: 'Volatility σ',
  yLabel: 'Option Price',
  xFmt: pct,
  yFmt: money,
});
const tChart = new Chart(/** @type {HTMLElement} */ (document.getElementById('t-chart')), {
  width: 460,
  height: 300,
  margin: { top: 16, right: 22, bottom: 50, left: 68 },
  xLabel: 'Time to Expiration T (years)',
  yLabel: 'Option Price',
  xFmt: fixed(1),
  yFmt: money,
});

/* ------------------------------------------------------- main chart ------- */
const SIG_LO = 0.005, SIG_HI = 0.60; // σ mini-chart range (0–60%)
const T_LO = 0.02, T_HI = 3;         // T mini-chart range (0–3y)

let mainSig = ''; // domain signature — axes rebuilt only when it changes
function drawMain(p) {
  const xLo = Math.min(0.4 * p.x, 0.8 * p.s);
  const xHi = Math.max(1.8 * p.x, 1.2 * p.s);
  const priceAt = (ss) => (p.opt === 'call'
    ? bsCall(ss, p.x, p.sig, p.r, p.t, p.q)
    : bsPut(ss, p.x, p.sig, p.r, p.t, p.q));
  const intrAt = (ss) => (p.opt === 'call' ? Math.max(ss - p.x, 0) : Math.max(p.x - ss, 0));

  const priceCurve = sample(priceAt, xLo, xHi);
  const intrCurve = sample(intrAt, xLo, xHi);
  const yHi = 1.08 * Math.max(...priceCurve.map((d) => d.y), ...intrCurve.map((d) => d.y), 1);

  const sig = `${xLo.toFixed(2)}|${xHi.toFixed(2)}|${yHi.toFixed(2)}`;
  if (sig !== mainSig) {
    mainChart.setDomain(xLo, xHi, 0, yHi).renderAxes();
    fixAxisTitleMath(mainChart);
    mainSig = sig;
  }
  mainChart.clearData();

  // strike marker
  mainChart.vline(p.x, { stroke: 'var(--axis)', dash: '2 4', width: 1, opacity: 0.55 });
  mainChart.text(p.x, yHi, `X = ${tv(p.x)}`, { dx: 5, dy: 12, fill: 'var(--muted)' });

  // time value = shaded band between the BS value and the intrinsic kink
  area(mainChart, priceCurve, intrCurve, 'var(--blue)', 0.14);
  mainChart.path(intrCurve, { stroke: 'var(--gold)', width: 2.6 });
  mainChart.path(priceCurve, { stroke: 'var(--blue)', width: 3 });

  // delta tangent at the current spot (dashed red reference)
  const price = priceAt(p.s);
  const delta = p.opt === 'call'
    ? bsCallDelta(p.s, p.x, p.sig, p.r, p.t, p.q)
    : bsPutDelta(p.s, p.x, p.sig, p.r, p.t, p.q);
  const seg = tangentSegment(p.s, price, delta, xLo, xHi, 0, yHi);
  if (seg) {
    mainChart.segment(seg[0], seg[1], seg[2], seg[3], {
      stroke: 'var(--red)', dash: '7 5', width: 1.6, klass: 'refline',
    });
    const labX = p.opt === 'call' ? seg[2] : seg[0];
    const labY = p.opt === 'call' ? seg[3] : seg[1];
    mainChart.text(labX, labY, `slope = Δ = ${delta.toFixed(2)}`, {
      dx: p.opt === 'call' ? -6 : 6, dy: -8,
      anchor: p.opt === 'call' ? 'end' : 'start',
      fill: 'var(--red)',
    });
  }

  // labeled time-value gap at the current spot
  const intr = intrAt(p.s);
  if (Math.abs(price - intr) > 0.04 * yHi) {
    mainChart.segment(p.s, intr, p.s, price, { stroke: 'var(--navy)', width: 1.6, opacity: 0.85 });
    mainChart.text(p.s, (intr + price) / 2, 'time value', { dx: 7, dy: 4, fill: 'var(--navy)' });
  }

  // current spot marker
  mainChart.point(p.s, price, { r: 5.5, fill: 'var(--blue)', stroke: '#fff' });
}

/**
 * Delta-tangent endpoints: y(x) = C + Δ(x − S), spanning ±0.45X around the
 * spot, clipped to the chart's x and y domain (chart.js does not clip paths).
 * @returns {[number,number,number,number]|null}
 */
function tangentSegment(s0, c0, delta, xLo, xHi, yLo, yHi) {
  let x1 = Math.max(xLo, s0 - 0.45 * (xHi - xLo));
  let x2 = Math.min(xHi, s0 + 0.45 * (xHi - xLo));
  if (Math.abs(delta) > 1e-9) {
    const xa = s0 + (yLo - c0) / delta;
    const xb = s0 + (yHi - c0) / delta;
    x1 = Math.max(x1, Math.min(xa, xb));
    x2 = Math.min(x2, Math.max(xa, xb));
  }
  if (x2 <= x1) return null;
  const y = (xx) => c0 + delta * (xx - s0);
  return [x1, y(x1), x2, y(x2)];
}

/* ------------------------------------- comparative-statics mini charts ---- */
let sigSig = '';
let tSig = '';
function drawMinis(p) {
  // (1) price vs σ, everything else at current values
  const callSig = sample((v) => bsCall(p.s, p.x, v, p.r, p.t, p.q), SIG_LO, SIG_HI, 120);
  const putSig = sample((v) => bsPut(p.s, p.x, v, p.r, p.t, p.q), SIG_LO, SIG_HI, 120);
  const yHiS = 1.1 * Math.max(...callSig.map((d) => d.y), ...putSig.map((d) => d.y), 0.5);
  const sSig = yHiS.toFixed(2);
  if (sSig !== sigSig) {
    sigChart.setDomain(0, SIG_HI, 0, yHiS).renderAxes({ xTicks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] });
    fixAxisTitleMath(sigChart);
    sigSig = sSig;
  }
  sigChart.clearData();
  sigChart.path(callSig, { stroke: 'var(--blue)', width: 2.6 });
  sigChart.path(putSig, { stroke: 'var(--gold)', width: 2.6 });
  sigChart.vline(p.sig, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.5 });
  sigChart.point(p.sig, bsCall(p.s, p.x, p.sig, p.r, p.t, p.q), { r: 4.5, fill: 'var(--blue)', stroke: '#fff' });
  sigChart.point(p.sig, bsPut(p.s, p.x, p.sig, p.r, p.t, p.q), { r: 4.5, fill: 'var(--gold)', stroke: '#fff' });

  // (2) price vs T, everything else at current values
  const callT = sample((tt) => bsCall(p.s, p.x, p.sig, p.r, tt, p.q), T_LO, T_HI, 120);
  const putT = sample((tt) => bsPut(p.s, p.x, p.sig, p.r, tt, p.q), T_LO, T_HI, 120);
  const yHiT = 1.1 * Math.max(...callT.map((d) => d.y), ...putT.map((d) => d.y), 0.5);
  const sT = yHiT.toFixed(2);
  if (sT !== tSig) {
    tChart.setDomain(0, T_HI, 0, yHiT).renderAxes({ xTicks: [0, 0.5, 1, 1.5, 2, 2.5, 3] });
    fixAxisTitleMath(tChart);
    tSig = sT;
  }
  tChart.clearData();
  tChart.path(callT, { stroke: 'var(--blue)', width: 2.6 });
  tChart.path(putT, { stroke: 'var(--gold)', width: 2.6 });
  tChart.vline(p.t, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.5 });
  tChart.point(p.t, bsCall(p.s, p.x, p.sig, p.r, p.t, p.q), { r: 4.5, fill: 'var(--blue)', stroke: '#fff' });
  tChart.point(p.t, bsPut(p.s, p.x, p.sig, p.r, p.t, p.q), { r: 4.5, fill: 'var(--gold)', stroke: '#fff' });
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(p, m) {
  const intr = p.opt === 'call' ? Math.max(p.s - p.x, 0) : Math.max(p.x - p.s, 0);
  const price = p.opt === 'call' ? m.call : m.put;
  const rows = [
    ['Call $C_0$', m.call.toFixed(3), 'blue'],
    ['Put $P_0$', m.put.toFixed(3), 'gold'],
    ['$d_1$', m.d1.toFixed(3), ''],
    ['$d_2$', m.d2.toFixed(3), ''],
    ['$N(d_1)$', m.nd1.toFixed(3), ''],
    ['$N(d_2)$', m.nd2.toFixed(3), ''],
    ['$\\Delta_{\\text{call}}$', m.dCall.toFixed(3), 'blue'],
    ['$\\Delta_{\\text{put}}$', m.dPut.toFixed(3), 'gold'],
    [`Time value (${p.opt})`, (price - intr).toFixed(3), ''],
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

function drawFormulas(p, m) {
  const fPrice = /** @type {HTMLElement} */ (document.getElementById('f-price'));
  const expQ = `e^{-${tv(p.q)}(${tv(p.t)})}`;
  const expR = `e^{-${tv(p.r)}(${tv(p.t)})}`;
  if (p.opt === 'call') {
    renderTeX(fPrice,
      `C_0 = S_0 e^{-\\delta T} N(d_1) - X e^{-rT} N(d_2)` +
      ` = ${tv(p.s)}\\,${expQ}\\,N(${m.d1.toFixed(3)}) - ${tv(p.x)}\\,${expR}\\,N(${m.d2.toFixed(3)})` +
      ` = ${BLUE}{\\mathbf{${m.call.toFixed(3)}}}`);
  } else {
    renderTeX(fPrice,
      `P_0 = X e^{-rT}\\bigl[1 - N(d_2)\\bigr] - S_0 e^{-\\delta T}\\bigl[1 - N(d_1)\\bigr]` +
      ` = ${tv(p.x)}\\,${expR}\\bigl[1 - N(${m.d2.toFixed(3)})\\bigr]` +
      ` - ${tv(p.s)}\\,${expQ}\\bigl[1 - N(${m.d1.toFixed(3)})\\bigr]` +
      ` = ${BLUE}{\\mathbf{${m.put.toFixed(3)}}}`);
  }
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('f-d')),
    `d_1 = \\frac{\\ln(S_0/X) + (r - \\delta + \\sigma^2/2)\\,T}{\\sigma\\sqrt{T}}` +
    ` = ${BLUE}{${m.d1.toFixed(3)}}, \\quad` +
    ` d_2 = d_1 - \\sigma\\sqrt{T} = ${BLUE}{${m.d2.toFixed(3)}}, \\quad` +
    ` N(d_1) = ${m.nd1.toFixed(3)}, \\; N(d_2) = ${m.nd2.toFixed(3)}`);
}

/* ------------------------------------------------------ delta/hedge card -- */
function drawDeltaCard(p, m) {
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('delta-tex')),
    `\\text{Calls:}\\;\\; \\Delta = \\frac{dC}{dS} = e^{-\\delta T} N(d_1) = ${BLUE}{${m.dCall.toFixed(3)}}` +
    `\\qquad \\text{Puts:}\\;\\; \\Delta = \\frac{dP}{dS} = e^{-\\delta T}\\bigl[N(d_1)-1\\bigr] = ${GOLD}{${m.dPut.toFixed(3)}}`);

  // NB: a literal "$" (even written "\$") inside a $...$ segment breaks
  // renderLabel's math-delimiter split — dollar amounts use \unicode{x24}
  // (\mathdollar and \char are NOT defined in MathJax's tex-svg-full).
  const dc = m.dCall.toFixed(2);
  const dpAbs = Math.abs(m.dPut).toFixed(2);
  renderLabel(/** @type {HTMLElement} */ (document.getElementById('hedge-call')),
    `To hedge writing a call ($\\Delta = ${dc}$): buy ${dc} shares of stock per call. ` +
    `If the stock rises by $\\unicode{x24}1$, the written call loses about $\\unicode{x24}${dc}$ — ` +
    `offset by the gain on your ${dc} shares.`);
  renderLabel(/** @type {HTMLElement} */ (document.getElementById('hedge-put')),
    `To hedge writing a put ($\\Delta = ${m.dPut.toFixed(2)}$): sell ${dpAbs} shares of stock per put. ` +
    `If the stock falls by $\\unicode{x24}1$, the put's value rises by about $\\unicode{x24}${dpAbs}$ against you, ` +
    `but your short ${dpAbs} shares gain $\\unicode{x24}${dpAbs}$ — delta neutral.`);
}

/* --------------------------------------------------------- parity card ---- */
function drawParity() {
  const P = Number(S.pp), s0 = Number(S.ps), X = Number(S.px);
  const rf = Number(S.pr) / 100, T = Number(S.pt);
  const C = parityCall(P, s0, X, rf, T);
  // deck writes T = 1/12 as a fraction; keep that display for n/12 inputs
  const twelfth = Math.round(T * 12);
  const expT = (twelfth >= 1 && twelfth < 12 && Math.abs(T * 12 - twelfth) < 1e-2)
    ? (twelfth === 1 ? '1/12' : `${twelfth}/12`)
    : tv(T, 4);
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('parity-tex')),
    `C(X) = P(X) + S_0 - \\frac{X}{(1+r_f)^T}` +
    ` = ${tv(P)} + ${tv(s0)} - \\frac{${tv(X)}}{(${tv(1 + rf, 4)})^{${expT}}}` +
    ` = ${BLUE}{\\mathbf{${C.toFixed(2)}}}`);
}

/* ---------------------------------------------------------- render cycle -- */
function renderAll() {
  const p = params();
  const { d1, d2 } = bsD1D2(p.s, p.x, p.sig, p.r, p.t, p.q);
  const m = {
    d1,
    d2,
    nd1: normCdf(d1),
    nd2: normCdf(d2),
    call: bsCall(p.s, p.x, p.sig, p.r, p.t, p.q),
    put: bsPut(p.s, p.x, p.sig, p.r, p.t, p.q),
    dCall: bsCallDelta(p.s, p.x, p.sig, p.r, p.t, p.q),
    dPut: bsPutDelta(p.s, p.x, p.sig, p.r, p.t, p.q),
  };
  drawMain(p);
  drawMinis(p);
  drawReadouts(p, m);
  drawFormulas(p, m);
  drawDeltaCard(p, m);
  syncFocusUi(p.opt);
}

function syncFocusUi(opt) {
  focusCallBtn.classList.toggle('active', opt === 'call');
  focusPutBtn.classList.toggle('active', opt === 'put');
  renderLabel(/** @type {HTMLElement} */ (document.getElementById('legend-value')),
    opt === 'call' ? 'Black–Scholes call value $C_0$' : 'Black–Scholes put value $P_0$');
  renderLabel(/** @type {HTMLElement} */ (document.getElementById('legend-intrinsic')),
    opt === 'call' ? 'Intrinsic value $\\max(S_0 - X,\\, 0)$' : 'Intrinsic value $\\max(X - S_0,\\, 0)$');
}

/* --------------------------------------------------------------- controls -- */
const sCtrl = slider({
  label: 'Stock price $S_0$', min: 20, max: 200, step: 1, value: Number(S.s),
  fmt: (v) => `$${Math.round(v)}`,
  onChange: (v) => { store.set('s', v); renderAll(); },
});
const xCtrl = slider({
  label: 'Strike price $X$', min: 20, max: 200, step: 1, value: Number(S.x),
  fmt: (v) => `$${Math.round(v)}`,
  onChange: (v) => { store.set('x', v); renderAll(); },
});
const vCtrl = slider({
  label: 'Volatility $\\sigma$', min: 5, max: 60, step: 1, value: Number(S.v),
  fmt: (v) => `${Math.round(v)}%`,
  onChange: (v) => { store.set('v', v); renderAll(); },
});
const rCtrl = slider({
  label: 'Risk-free rate $r$', min: 0, max: 12, step: 0.25, value: Number(S.r),
  fmt: (v) => `${+v.toFixed(2)}%`,
  onChange: (v) => { store.set('r', v); renderAll(); },
});
const tCtrl = slider({
  label: 'Time to expiration $T$', min: 0.05, max: 3, step: 0.01, value: Number(S.t),
  fmt: (v) => `${+v.toFixed(2)}y`,
  onChange: (v) => { store.set('t', v); renderAll(); },
});
const qCtrl = slider({
  label: 'Dividend yield $\\delta$', min: 0, max: 6, step: 0.25, value: Number(S.q),
  fmt: (v) => `${+v.toFixed(2)}%`,
  onChange: (v) => { store.set('q', v); renderAll(); },
});

/** @type {HTMLElement} */ (document.getElementById('ctrl-s')).appendChild(sCtrl);
/** @type {HTMLElement} */ (document.getElementById('ctrl-x')).appendChild(xCtrl);
/** @type {HTMLElement} */ (document.getElementById('ctrl-v')).appendChild(vCtrl);
/** @type {HTMLElement} */ (document.getElementById('ctrl-r')).appendChild(rCtrl);
/** @type {HTMLElement} */ (document.getElementById('ctrl-t')).appendChild(tCtrl);
/** @type {HTMLElement} */ (document.getElementById('ctrl-q')).appendChild(qCtrl);

const focusCallBtn = /** @type {HTMLButtonElement} */ (document.getElementById('focus-call'));
const focusPutBtn = /** @type {HTMLButtonElement} */ (document.getElementById('focus-put'));
focusCallBtn.addEventListener('click', () => { store.set('opt', 'call'); renderAll(); });
focusPutBtn.addEventListener('click', () => { store.set('opt', 'put'); renderAll(); });

/* ------------------------------------------------- parity card controls --- */
const parityHost = /** @type {HTMLElement} */ (document.getElementById('parity-inputs'));
const ppCtrl = numberInput({
  label: 'Put $P$', value: Number(S.pp), min: 0, step: 0.01,
  onChange: (v) => { store.set('pp', v); drawParity(); },
});
const psCtrl = numberInput({
  label: 'Stock $S_0$', value: Number(S.ps), min: 0.01, step: 0.5,
  onChange: (v) => { store.set('ps', v); drawParity(); },
});
const pxCtrl = numberInput({
  label: 'Strike $X$', value: Number(S.px), min: 0.01, step: 0.5,
  onChange: (v) => { store.set('px', v); drawParity(); },
});
const prCtrl = numberInput({
  label: '$r_f$ (% EAY)', value: Number(S.pr), min: 0, max: 20, step: 0.25,
  onChange: (v) => { store.set('pr', v); drawParity(); },
});
const ptCtrl = numberInput({
  label: '$T$ (years)', value: Number(S.pt), min: 0.01, max: 3, step: 0.01,
  onChange: (v) => { store.set('pt', v); drawParity(); },
});
parityHost.append(ppCtrl, psCtrl, pxCtrl, prCtrl, ptCtrl);

const parityCtrls = { pp: ppCtrl, ps: psCtrl, px: pxCtrl, pr: prCtrl, pt: ptCtrl };
function loadParity(values) {
  for (const [k, v] of Object.entries(values)) {
    store.set(k, v);
    parityCtrls[k].set(v);
  }
  drawParity();
}
/** @type {HTMLElement} */ (document.getElementById('parity-deck'))
  .addEventListener('click', () => loadParity(PARITY_DECK));
/** @type {HTMLElement} */ (document.getElementById('parity-reset'))
  .addEventListener('click', () => loadParity({
    pp: defaults.pp, ps: defaults.ps, px: defaults.px, pr: defaults.pr, pt: defaults.pt,
  }));

renderAll();
drawParity();
