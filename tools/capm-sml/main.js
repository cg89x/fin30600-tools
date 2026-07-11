// @ts-check
/**
 * CAPM / SML + Market Model explorer (FIN 30600, Lecture 4 §2–3).
 *
 * Two stacked sections, each controls-left / chart-right:
 *   1. Security Market Line + alpha (deck §2, the "CAPM implications" example).
 *   2. Market-model single-index regression: simulate n monthly excess returns
 *      from a known beta, estimate by OLS, decompose variance (deck §3).
 *
 * Slide fidelity (…/Lectures/Lecture 4/content/sec2_capm.tex,
 * sec3_marketmodel.tex):
 *  - SML defaults reproduce the deck's worked alpha example ("Example: CAPM
 *    implications"): r_f = 3.5%, E[r_M] = 11.5%, test asset β = 1.45,
 *    E[r] = 15.1% ⇒ α = 0 exactly (the slide computes α = 0). Move any control
 *    to create a visible mispricing gap.
 *  - Market-model equation & variance split R_i − R_f = α + β(R_M − R_f) + e,
 *    Var = β²σ_M² + σ_e², mirror sec3_marketmodel.tex.
 *
 * All finance math lives in ../../lib/finmath.js (decimals); this file formats
 * to whole/one-decimal percents for display per the house style.
 */

import { capmReturn, alpha as capmAlpha, ols, mulberry32, randn } from '../../lib/finmath.js';
import { Chart, pct, fixed } from '../../lib/chart.js';
import { slider, numberInput, renderTeX } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

/* ---- Fixed, documented market-model parameters (monthly) ------------------
 * The simulated market's excess return each month is drawn N(MKT_MEAN_EXCESS,
 * MKT_SIGMA²). These are plausible monthly-scaled figures: a ~0.5%/mo market
 * risk premium (≈6%/yr) and σ_M ≈ 4.5%/mo (≈15.6%/yr). The data-generating
 * process is R_i = β·R_M + e (true alpha = 0, consistent with the CAPM), so the
 * TRUE regression line passes through the origin. */
const MKT_MEAN_EXCESS = 0.005; // 0.5% per month
const MKT_SIGMA = 0.045;       // 4.5% per month

/* ---- state defaults (percents stored as percents for readable URLs) ------- */
const DEFAULTS = {
  // SML
  rf: 3.5,      // risk-free rate, %
  rm: 11.5,     // E[r_M], %
  beta: 1.45,   // test-asset beta
  er: 15.1,     // test-asset E[r], %
  // Market model
  tbeta: 1.2,   // true beta
  sigmae: 4,    // idiosyncratic σ_e, %/mo
  n: 60,        // sample size (months)
  seed: 20260710, // PRNG seed
};

const store = bindState(DEFAULTS);
const S = store.state;

/* ---- presenter mode (?present=1 or the button) ---------------------------- */
function applyPresent(on) {
  document.documentElement.classList.toggle('presenter', on);
  const q = new URLSearchParams(location.search);
  if (on) q.set('present', '1'); else q.delete('present');
  const search = q.toString();
  history.replaceState(null, '', `${location.pathname}${search ? '?' + search : ''}${location.hash}`);
}
const presentBtn = /** @type {HTMLButtonElement} */ (document.getElementById('presenterBtn'));
let presentOn = new URLSearchParams(location.search).get('present') === '1';
applyPresent(presentOn);
presentBtn.classList.toggle('active', presentOn);
presentBtn.addEventListener('click', () => {
  presentOn = !presentOn;
  applyPresent(presentOn);
  presentBtn.classList.toggle('active', presentOn);
  renderSML();
  renderMM();
});

/* ---- formatting helpers --------------------------------------------------- */
const pStr = (dec, d = 1) => `${(dec * 100).toFixed(d)}%`;       // decimal → "3.5%"
const pTeX = (dec, d = 1) => `${(dec * 100).toFixed(d)}\\%`;     // TeX-safe: % must be escaped in KaTeX
const pointScale = () =>
  Number(getComputedStyle(document.documentElement).getPropertyValue('--point-scale')) || 1;

function readout(k, v, cls = '') {
  return `<div class="readout"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
}

/* ==========================================================================
 *  SECTION 1 — SECURITY MARKET LINE + ALPHA
 * ======================================================================== */

const smlChart = new Chart(document.getElementById('sml-chart'), {
  xLabel: 'Beta (β)', yLabel: 'Expected Return',
  xFmt: fixed(1), yFmt: pct,
});
const BETA_LO = -0.5, BETA_HI = 2.5;

// Controls
const cRf = slider({
  label: 'Risk-free rate  r_f', min: 0, max: 8, step: 0.1, value: S.rf,
  fmt: (v) => `${v.toFixed(1)}%`, onChange: (v) => { store.set('rf', v); renderSML(); },
});
const cRm = slider({
  label: 'Market return  E[r_M]', min: 4, max: 14, step: 0.1, value: S.rm,
  fmt: (v) => `${v.toFixed(1)}%`, onChange: (v) => { store.set('rm', v); renderSML(); },
});
document.getElementById('sml-market-controls').append(cRf, cRm);

const cBeta = slider({
  label: 'Test-asset beta  β_i', min: BETA_LO, max: BETA_HI, step: 0.05, value: S.beta,
  fmt: (v) => v.toFixed(2), onChange: (v) => { store.set('beta', v); renderSML(); },
});
const cEr = numberInput({
  label: 'Test-asset E[r_i] (%)', min: -10, max: 40, step: 0.1, value: S.er,
  onChange: (v) => { store.set('er', v); renderSML(); },
});
document.getElementById('sml-asset-controls').append(cBeta, cEr);

function renderSML() {
  const rf = S.rf / 100, rm = S.rm / 100, beta = S.beta, er = S.er / 100;
  const req = capmReturn(beta, rf, rm);      // CAPM-required return at β
  const a = capmAlpha(er, beta, rf, rm);     // Jensen's alpha
  const ps = pointScale();

  // domain: β fixed, y spans the SML endpoints, the asset, r_f and E[r_M]
  const smlLo = capmReturn(BETA_LO, rf, rm);
  const smlHi = capmReturn(BETA_HI, rf, rm);
  const ys = [smlLo, smlHi, er, rf, rm];
  let yLo = Math.min(0, ...ys), yHi = Math.max(...ys);
  const padY = Math.max(0.01, (yHi - yLo) * 0.08);
  yLo -= padY; yHi += padY;
  smlChart.setDomain(BETA_LO, BETA_HI, yLo, yHi).renderAxes({ xTickCount: 7, yTickCount: 7 });
  smlChart.clearData();

  // SML line (BLUE) across the full beta range
  smlChart.path(
    [{ x: BETA_LO, y: smlLo }, { x: BETA_HI, y: smlHi }],
    { stroke: 'var(--blue)', width: 2.4 },
  );
  smlChart.text(BETA_HI, smlHi, 'SML', { dx: -4, dy: -8, anchor: 'end', fill: 'var(--blue)' });

  // market portfolio point M at (1, E[r_M]) — GOLD diamond
  smlChart.point(1, rm, { shape: 'diamond', r: 7 * ps, fill: 'var(--gold)' });
  smlChart.text(1, rm, 'M', { dx: 9, dy: -6, fill: 'var(--gold)' });

  // alpha gap: vertical segment from SML(β) up/down to the asset
  const eps = 0.0005; // 0.05pp tolerance for "on the line"
  if (Math.abs(a) >= eps) {
    const overpriced = a < 0;
    const col = overpriced ? 'var(--red)' : 'var(--blue)';
    smlChart.segment(beta, req, beta, er, {
      stroke: col, width: 2, dash: overpriced ? '5 4' : undefined,
    });
    const midY = (req + er) / 2;
    const label = overpriced ? 'α < 0 (overpriced)' : 'α > 0 (underpriced)';
    smlChart.text(beta, midY, label, {
      dx: 8, dy: 4, fill: col, anchor: beta > 1.8 ? 'end' : 'start',
    });
  }

  // test asset point (on top of the gap)
  smlChart.point(beta, er, { shape: 'circle', r: 6 * ps, fill: 'var(--navy)', stroke: '#fff' });
  smlChart.text(beta, er, 'i', { dx: 9, dy: overpricedDy(a), fill: 'var(--navy)' });

  // readouts
  document.getElementById('sml-readouts').innerHTML =
    readout('CAPM-required E[r]', pStr(req), 'blue') +
    readout('Actual E[r]', pStr(er)) +
    readout('Alpha (α)', (a >= 0 ? '+' : '') + pStr(a),
      Math.abs(a) < eps ? '' : (a < 0 ? '' : 'blue')) +
    readout('Verdict', mispricingVerdict(a, eps));

  // KaTeX strip with live numbers
  const tex =
    `E[r_i] = r_f + \\beta_i\\,(E[r_M] - r_f) = ${S.rf.toFixed(1)}\\% + ` +
    `${beta.toFixed(2)}\\,(${S.rm.toFixed(1)}\\% - ${S.rf.toFixed(1)}\\%) = ` +
    `${pTeX(req, 2)}\\quad\\Rightarrow\\quad \\alpha_i = ${pTeX(er, 2)} - ${pTeX(req, 2)} = ` +
    `${(a >= 0 ? '+' : '') + pTeX(a, 2)}`;
  renderTeX(document.getElementById('sml-formula'), tex, { displayMode: false });
}

function overpricedDy(a) { return a < 0 ? 16 : -8; }
function mispricingVerdict(a, eps) {
  if (Math.abs(a) < eps) return 'Fairly priced';
  return a > 0 ? 'Underpriced' : 'Overpriced';
}

/* ==========================================================================
 *  SECTION 2 — MARKET MODEL (single-index regression)
 * ======================================================================== */

const mmChart = new Chart(document.getElementById('mm-chart'), {
  xLabel: 'Market excess return', yLabel: 'Asset excess return',
  xFmt: pct, yFmt: pct,
});

const cTbeta = slider({
  label: 'True beta  β', min: BETA_LO, max: BETA_HI, step: 0.05, value: S.tbeta,
  fmt: (v) => v.toFixed(2), onChange: (v) => { store.set('tbeta', v); renderMM(); },
});
const cSigmae = slider({
  label: 'Idiosyncratic σ_e (per mo.)', min: 0, max: 10, step: 0.1, value: S.sigmae,
  fmt: (v) => `${v.toFixed(1)}%`, onChange: (v) => { store.set('sigmae', v); renderMM(); },
});
document.getElementById('mm-sim-controls').append(cTbeta, cSigmae);

// n selector (ui.js has no select — hand-rolled, matches control styling)
const nWrap = document.createElement('div');
nWrap.className = 'ctrl ctrl-select-wrap';
const nLabel = document.createElement('label');
nLabel.className = 'ctrl-label';
nLabel.textContent = 'Sample size  n (months)';
const nSelect = document.createElement('select');
for (const opt of [12, 36, 60, 120, 240]) {
  const o = document.createElement('option');
  o.value = String(opt); o.textContent = String(opt);
  if (opt === S.n) o.selected = true;
  nSelect.appendChild(o);
}
nSelect.addEventListener('change', () => { store.set('n', Number(nSelect.value)); renderMM(); });
nWrap.append(nLabel, nSelect);

// Resample button (new seed → stored in URL state)
const resampleBtn = document.createElement('button');
resampleBtn.type = 'button';
resampleBtn.className = 'btn resample';
resampleBtn.textContent = 'Resample';
resampleBtn.addEventListener('click', () => {
  store.set('seed', (Math.random() * 0xffffffff) >>> 0);
  renderMM();
});
document.getElementById('mm-sim-controls').append(nWrap, resampleBtn);

function simulate(tbeta, sigmaeDec, n, seed) {
  const rng = mulberry32(seed >>> 0);
  const mkt = new Array(n), asset = new Array(n);
  for (let t = 0; t < n; t++) {
    const rm = MKT_MEAN_EXCESS + MKT_SIGMA * randn(rng);
    const e = sigmaeDec * randn(rng);
    mkt[t] = rm;
    asset[t] = tbeta * rm + e; // R_i = β·R_M + e  (true α = 0)
  }
  return { mkt, asset };
}

function renderMM() {
  const tbeta = S.tbeta, sigmaeDec = S.sigmae / 100, n = S.n, seed = S.seed;
  const ps = pointScale();
  const { mkt, asset } = simulate(tbeta, sigmaeDec, n, seed);
  const fit = ols(mkt, asset);

  // domain from the data, padded and origin-inclusive
  const xExt = extent(mkt), yExt = extent(asset);
  const xPad = Math.max(0.01, (xExt.hi - xExt.lo) * 0.08);
  const yPad = Math.max(0.01, (yExt.hi - yExt.lo) * 0.08);
  const xLo = Math.min(0, xExt.lo) - xPad, xHi = Math.max(0, xExt.hi) + xPad;
  const yLo = Math.min(0, yExt.lo) - yPad, yHi = Math.max(0, yExt.hi) + yPad;
  mmChart.setDomain(xLo, xHi, yLo, yHi).renderAxes({ xTickCount: 6, yTickCount: 6 });
  mmChart.clearData();

  // scatter (small navy dots)
  for (let t = 0; t < n; t++) {
    mmChart.point(mkt[t], asset[t], { shape: 'circle', r: 2.6 * ps, fill: 'var(--navy)' });
  }

  // TRUE line β·x (GOLD, dashed/muted) then OLS fit (BLUE, solid) on top
  mmChart.path([{ x: xLo, y: tbeta * xLo }, { x: xHi, y: tbeta * xHi }],
    { stroke: 'var(--gold)', width: 2, dash: '6 4', opacity: 0.9 });
  mmChart.path(
    [{ x: xLo, y: fit.intercept + fit.slope * xLo }, { x: xHi, y: fit.intercept + fit.slope * xHi }],
    { stroke: 'var(--blue)', width: 2.4 });
  mmChart.text(xHi, fit.intercept + fit.slope * xHi, 'OLS fit', { dx: -4, dy: -6, anchor: 'end', fill: 'var(--blue)' });
  mmChart.text(xLo, tbeta * xLo, `true β=${tbeta.toFixed(2)}`, { dx: 4, dy: 14, anchor: 'start', fill: 'var(--gold)' });

  // readouts: β̂ (±SE), α̂ (±SE), R²
  document.getElementById('mm-readouts').innerHTML =
    readout('β̂ (± SE)', `${fit.slope.toFixed(3)} <small>± ${fit.seSlope.toFixed(3)}</small>`, 'blue') +
    readout('α̂ (± SE)', `${pStr(fit.intercept, 2)} <small>± ${pStr(fit.seIntercept, 2)}</small>`, 'gold') +
    readout('R²', fit.r2.toFixed(3)) +
    readout('n', String(n));

  // variance decomposition — uses the TRUE parameters (the population split the
  // regression is trying to recover), not the noisy sample estimates.
  const sys = tbeta * tbeta * MKT_SIGMA * MKT_SIGMA;
  const idio = sigmaeDec * sigmaeDec;
  const tot = sys + idio;
  const sysPct = tot > 0 ? (sys / tot) * 100 : 0;
  const idioPct = 100 - sysPct;
  const bar = document.getElementById('mm-vdbar');
  bar.innerHTML =
    `<div class="vd-seg sys" style="width:${sysPct}%" title="Systematic β²σ_M²">${sysPct >= 12 ? sysPct.toFixed(0) + '%' : ''}</div>` +
    `<div class="vd-seg idio" style="width:${idioPct}%" title="Idiosyncratic σ_e²">${idioPct >= 12 ? idioPct.toFixed(0) + '%' : ''}</div>`;

  // KaTeX strips
  renderTeX(document.getElementById('mm-formula-model'),
    `R_i - R_f = \\hat{\\alpha}_i + \\hat{\\beta}_i\\,(R_M - R_f) + \\varepsilon_i` +
    `\\;:\\; \\hat{\\beta}_i = ${fit.slope.toFixed(3)},\\; \\hat{\\alpha}_i = ${pTeX(fit.intercept, 2)},\\; R^2 = ${fit.r2.toFixed(3)}`,
    { displayMode: false });
  const sigM = pTeX(MKT_SIGMA, 1); // "4.5\%" — TeX-safe
  renderTeX(document.getElementById('mm-formula-r2'),
    `R^2 = \\dfrac{\\beta^2\\sigma_M^2}{\\beta^2\\sigma_M^2 + \\sigma_e^2} = ` +
    `\\dfrac{${tbeta.toFixed(2)}^2\\,(${sigM})^2}{${tbeta.toFixed(2)}^2\\,(${sigM})^2 + (${S.sigmae.toFixed(1)}\\%)^2} = ${(sysPct / 100).toFixed(3)}`,
    { displayMode: false });
}

function extent(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi };
}

/* ---- initial render (MathJax load-order handled inside renderTeX) --------- */
renderSML();
renderMM();
