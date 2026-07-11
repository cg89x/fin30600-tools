// @ts-check
/**
 * Two-Asset Diversification Explorer (FIN 30600, Lecture 3 §4).
 *
 * Mirrors the deck `Lecture 3/content/sec4_tworisky.tex`: the σ–E[r] opportunity
 * set of two risky securities, Rule 1 / Rule 2, the ρ = +1 / 0 / −1 cases, and
 * the minimum-variance portfolio. Defaults reproduce the slide example
 * (A: 8%/13%, B: 16%/20%, w_A = 0.6, ρ = +0.2 ⇒ E[r_P] = 11.2%, σ_P = 12.24%).
 *
 * finmath works in DECIMALS; the number inputs and readouts here work in whole
 * percents and convert at the boundary.
 */

import {
  covFromCorr, twoAssetMean, twoAssetStd, twoAssetVar, mvpWeightTwoAsset,
} from '../../lib/finmath.js';
import { Chart, pct } from '../../lib/chart.js';
import { slider, numberInput, toggle, renderTeX } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

/* ------------------------------------------------------------------ state -- */
// Stored values are in the units the user sees: μ/σ in percent, ρ and w_A as
// decimals, toggles as booleans. Math converts percents to decimals on use.
const DEFAULTS = {
  muA: 8, sigA: 13, muB: 16, sigB: 20,
  rho: 0.2, wA: 0.6, shorts: false, refs: false,
};
const store = bindState(DEFAULTS);
const S = store.state;

/* --------------------------------------------------------------- helpers -- */
const pctS = (v, dp = 2) => `${(v * 100).toFixed(dp)}%`;     // decimal -> "12.24%"
const wLo = () => (S.shorts ? -0.5 : 0);
const wHi = () => (S.shorts ? 1.5 : 1);

/** Decimals derived from the current (percent-denominated) state. */
function assets() {
  return {
    muA: Number(S.muA) / 100, sigA: Number(S.sigA) / 100,
    muB: Number(S.muB) / 100, sigB: Number(S.sigB) / 100,
    rho: Number(S.rho), wA: Number(S.wA),
  };
}

/** {σ,E} sample points of the opportunity set for one correlation. */
function curve(rho, n = 141) {
  const a = assets();
  const cov = covFromCorr(a.sigA, a.sigB, rho);
  const lo = wLo();
  const hi = wHi();
  const pts = [];
  for (let i = 0; i < n; i++) {
    const w = lo + ((hi - lo) * i) / (n - 1);
    pts.push({ x: twoAssetStd(w, a.sigA, a.sigB, cov), y: twoAssetMean(w, a.muA, a.muB) });
  }
  return pts;
}

/* ------------------------------------------------------------------ chart -- */
const chartBox = /** @type {HTMLElement} */ (document.getElementById('chart-box'));
const chart = new Chart(chartBox, {
  width: 660, height: 460,
  xLabel: 'Standard Deviation', yLabel: 'Expected Return',
  xFmt: pct, yFmt: pct,
});

/** Presenter scaling factor for point radii (font/strokes come from CSS vars). */
const scale = () => (document.documentElement.classList.contains('presenter') ? 1.4 : 1);

/**
 * Domain depends only on the asset inputs and the short-sales range — NOT on ρ
 * or w_A — because the ρ = ±1 curves bound every intermediate ρ. So dragging
 * the ρ / w_A sliders never rebuilds the axes (smooth re-render).
 */
function computeDomain() {
  const a = assets();
  let maxSig = Math.max(a.sigA, a.sigB, 1e-6);
  let minE = Math.min(a.muA, a.muB);
  let maxE = Math.max(a.muA, a.muB);
  for (const rho of [-1, 1]) {
    for (const p of curve(rho, 61)) {
      if (p.x > maxSig) maxSig = p.x;
      if (p.y < minE) minE = p.y;
      if (p.y > maxE) maxE = p.y;
    }
  }
  const ePad = (maxE - minE) * 0.12 || 0.02;
  return { xLo: 0, xHi: maxSig * 1.08, yLo: minE - ePad, yHi: maxE + ePad };
}

/* ------------------------------------------------------------- rendering -- */
function drawData() {
  const a = assets();
  const cov = covFromCorr(a.sigA, a.sigB, a.rho);
  chart.clearData();

  // Reference curves ρ = +1, 0, −1 (muted grey, dashed) with small labels.
  if (S.refs) {
    const refs = [
      { rho: 1, label: 'ρ = +1' },
      { rho: 0, label: 'ρ = 0' },
      { rho: -1, label: 'ρ = −1' },
    ];
    for (const r of refs) {
      const pts = curve(r.rho);
      chart.path(pts, { stroke: '#9aa3ad', width: 1.4, dash: '5 4', opacity: 0.9 });
      const end = pts[pts.length - 1]; // high-w_A end (low return)
      chart.text(end.x, end.y, r.label, { dx: 6, dy: 4, anchor: 'start', fill: '#7a828c', klass: 'ref-label' });
    }
  }

  // Opportunity-set curve for the current ρ (BLUE).
  chart.path(curve(a.rho), { stroke: 'var(--blue)', width: 2.4 });

  // Assets A and B.
  const r = 5 * scale();
  chart.point(a.sigA, a.muA, { r, fill: 'var(--navy)' });
  chart.text(a.sigA, a.muA, 'A', { dx: 8, dy: -6, fill: 'var(--navy)' });
  chart.point(a.sigB, a.muB, { r, fill: 'var(--navy)' });
  chart.text(a.sigB, a.muB, 'B', { dx: 8, dy: -6, fill: 'var(--navy)' });

  // Minimum-variance portfolio (GOLD diamond).
  const wMvp = mvpWeightTwoAsset(a.sigA, a.sigB, cov);
  let mvpErr = false;
  if (Number.isFinite(wMvp)) {
    const sMvp = twoAssetStd(wMvp, a.sigA, a.sigB, cov);
    const eMvp = twoAssetMean(wMvp, a.muA, a.muB);
    chart.point(sMvp, eMvp, { r: 6 * scale(), fill: 'var(--gold)', shape: 'diamond', stroke: '#fff' });
    chart.text(sMvp, eMvp, 'MVP', { dx: -6, dy: 18, anchor: 'end', fill: 'var(--gold)' });
  } else {
    mvpErr = true;
  }

  // Current portfolio (BLUE dot, labeled with its values).
  const sP = twoAssetStd(a.wA, a.sigA, a.sigB, cov);
  const eP = twoAssetMean(a.wA, a.muA, a.muB);
  chart.point(sP, eP, { r: 6.5 * scale(), fill: 'var(--blue)', stroke: '#fff' });
  chart.text(sP, eP, `(${pctS(sP, 1)}, ${pctS(eP, 1)})`, { dx: 10, dy: -8, fill: 'var(--blue)', klass: 'p-label' });

  updateReadouts(a, cov, sP, eP, wMvp, mvpErr);
  updateFormulas(a, cov, eP, sP);
}

function updateReadouts(a, cov, sP, eP, wMvp, mvpErr) {
  document.getElementById('out-er').textContent = pctS(eP);
  document.getElementById('out-sd').textContent = pctS(sP);
  document.getElementById('out-cov').textContent = cov.toFixed(4);
  document.getElementById('out-mvp').textContent = mvpErr ? '—' : wMvp.toFixed(3);
}

/* ----------------------------------------------------------- formula strip -- */
function updateFormulas(a, cov, eP, sP) {
  const wA = a.wA;
  const wB = 1 - wA;
  const varP = twoAssetVar(wA, a.sigA, a.sigB, cov);
  const f = (x, d = 2) => x.toFixed(d);
  // '%' is a comment char in (Ka)TeX — escape it, then colorize.
  const tp = (v) => pctS(v).replace('%', '\\%');
  const blue = (s) => `\\textcolor{#0072B2}{${s}}`;

  renderTeX(document.getElementById('f-r1-sym'),
    '\\textbf{Rule 1:}\\quad \\mathbb{E}[R_P] = w_A\\,\\mathbb{E}[R_A] + w_B\\,\\mathbb{E}[R_B]');
  renderTeX(document.getElementById('f-r1-num'),
    `= (${f(wA)})(${f(a.muA, 3)}) + (${f(wB)})(${f(a.muB, 3)}) = ${blue(tp(eP))}`);

  renderTeX(document.getElementById('f-r2-sym'),
    '\\textbf{Rule 2:}\\quad \\sigma_P^2 = w_A^2\\sigma_A^2 + w_B^2\\sigma_B^2 + 2\\,w_A w_B\\,\\mathrm{Cov}(R_A,R_B)');
  renderTeX(document.getElementById('f-r2-num'),
    `= (${f(wA)})^2(${f(a.sigA, 2)})^2 + (${f(wB)})^2(${f(a.sigB, 2)})^2 + 2(${f(wA)})(${f(wB)})(${f(cov, 4)}) ` +
    `= ${f(varP, 5)}\\;\\Rightarrow\\; \\sigma_P = ${blue(tp(sP))}`);
}

function fullRender() {
  const d = computeDomain();
  chart.setDomain(d.xLo, d.xHi, d.yLo, d.yHi);
  chart.renderAxes();
  drawData();
}

/* ------------------------------------------------------------- controls --- */
const muA = numberInput({ label: 'E[r] (%)', value: S.muA, step: 0.5,
  onChange: (v) => { store.set('muA', v); fullRender(); } });
const sigA = numberInput({ label: 'σ (%)', value: S.sigA, min: 0, step: 0.5,
  onChange: (v) => { store.set('sigA', v); fullRender(); } });
const muB = numberInput({ label: 'E[r] (%)', value: S.muB, step: 0.5,
  onChange: (v) => { store.set('muB', v); fullRender(); } });
const sigB = numberInput({ label: 'σ (%)', value: S.sigB, min: 0, step: 0.5,
  onChange: (v) => { store.set('sigB', v); fullRender(); } });

const rho = slider({ label: 'Correlation ρ', min: -1, max: 1, step: 0.05, value: S.rho,
  fmt: (v) => v.toFixed(2), onChange: (v) => { store.set('rho', v); drawData(); } });

const wA = slider({ label: 'Weight in A  (w_A)', min: -0.5, max: 1.5, step: 0.01, value: S.wA,
  fmt: (v) => v.toFixed(2), onChange: (v) => { store.set('wA', v); drawData(); } });

const shorts = toggle({ label: 'Allow short sales', value: S.shorts,
  onChange: (v) => {
    store.set('shorts', v);
    applyShortRange();
    fullRender();
  } });

const refs = toggle({ label: 'Show ρ = +1, 0, −1 reference curves', value: S.refs,
  onChange: (v) => { store.set('refs', v); drawData(); } });

/** Limit the w_A slider to [0,1] when short sales are off, clamping the value. */
function applyShortRange() {
  wA.input.min = String(wLo());
  wA.input.max = String(wHi());
  let v = Number(S.wA);
  if (!S.shorts) v = Math.min(1, Math.max(0, v));
  wA.set(v);           // silent: updates input + readout only
  store.set('wA', v);  // persist any clamp to the hash
}

document.getElementById('ctrl-muA').appendChild(muA);
document.getElementById('ctrl-sigA').appendChild(sigA);
document.getElementById('ctrl-muB').appendChild(muB);
document.getElementById('ctrl-sigB').appendChild(sigB);
document.getElementById('ctrl-rho').appendChild(rho);
document.getElementById('ctrl-wA').appendChild(wA);
document.getElementById('ctrl-shorts').appendChild(shorts);
document.getElementById('ctrl-refs').appendChild(refs);

/* ------------------------------------------------------------- presenter -- */
const presenterBtn = /** @type {HTMLButtonElement} */ (document.getElementById('presenter-btn'));
function setPresenter(on) {
  document.documentElement.classList.toggle('presenter', on);
  presenterBtn.classList.toggle('active', on);
  fullRender(); // re-scale point radii
}
presenterBtn.addEventListener('click', () => setPresenter(!document.documentElement.classList.contains('presenter')));
if (new URLSearchParams(location.search).get('present') === '1') setPresenter(true);

/* ------------------------------------------------------------------- init -- */
applyShortRange(); // sync slider bounds to the loaded short-sales state
fullRender();
// KaTeX (a deferred classic script) may not have defined window.katex yet when
// this module first runs; re-render the data layer once everything has loaded
// so the formula strip is typeset rather than left as raw TeX text.
if (!(/** @type {any} */ (globalThis).katex)) window.addEventListener('load', drawData);
