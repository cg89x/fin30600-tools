// @ts-check
/**
 * Diversification & systematic risk explorer (FIN 30600, Lecture 4 appendix).
 *
 * Web version of Archive/Lectures (pptx)/Lecture 4/Additional Materials/
 * PortfolioVarianceAndDiversification.xlsx and the deck's appendix
 * (content/app_diversification.tex): the risk of an equal-weight portfolio of
 * N unit-variance assets under three cases —
 *   1. uncorrelated returns:            σ_P² = 1/N
 *   2. common pairwise correlation ρ:   σ_P² = 1/N + ((N−1)/N)ρ
 *   3. CAPM single factor, common β:    σ_P² = 1/N + ((N−1)/N)β²
 * Case 3 keeps Var(R_i) = 1 by setting σ_ε² = 1 − β² (the deck's numbers:
 * β = 1/√2, σ_ε² = ½), so it coincides with Case 2 exactly when β² = ρ —
 * the workbook's punchline, surfaced live via the coincide flag.
 *
 * All finance math lives in ../../lib/finmath.js; this file wires controls,
 * the σ_P-vs-N chart, the variance-decomposition inset, readouts, and the
 * live MathJax strip.
 */

import { Chart, fixed } from '../../lib/chart.js';
import { ewVarUncorrelated, ewVarCommonCorr } from '../../lib/finmath.js';
import { slider, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

hydrateLabels();

/* ----------------------------------------------------------------- state -- */
const N_MAX = 100; // the workbook runs N = 1..100

const defaults = {
  n: 20,          // number of assets highlighted
  rho: 0.5,       // Case 2 common correlation (workbook C2)
  beta: 0.707,    // Case 3 common beta (deck: 1/sqrt(2))
  c1: true,       // show Case 1
  c2: true,       // show Case 2
  c3: true,       // show Case 3
};

const store = bindState(defaults, () => {}, { debounce: 150 });
const S = store.state;

/* --------------------------------------------------------------- helpers -- */
/** Model quantities derived from the current state. */
function model() {
  const n = Math.max(1, Math.round(Number(S.n)));
  const rho = Number(S.rho);
  const beta = Number(S.beta);
  return {
    n, rho, beta,
    c1: Boolean(S.c1), c2: Boolean(S.c2), c3: Boolean(S.c3),
    var1: ewVarUncorrelated(n),
    var2: ewVarCommonCorr(n, rho),
    var3: ewVarCommonCorr(n, beta * beta),
  };
}

/** σ_P(N) samples for a case (sqrt of the variance function), N = 1..N_MAX. */
function curve(varAt) {
  return samples((n) => Math.sqrt(varAt(n)));
}

/** Raw {x: n, y: f(n)} samples, N = 1..N_MAX. */
function samples(f) {
  const pts = [];
  for (let n = 1; n <= N_MAX; n++) pts.push({ x: n, y: f(n) });
  return pts;
}

/**
 * Filled area between two curves sharing x samples (top and bottom given as
 * point arrays). chart.path draws stroke-only; we re-purpose it and set fill.
 */
function area(chart, top, bottom, fill, opacity) {
  const node = chart.path([...top, ...bottom.slice().reverse()], { stroke: 'none' });
  node.setAttribute('fill', fill);
  node.setAttribute('opacity', String(opacity));
  return node;
}

/* ---------------------------------------------------------------- charts -- */
const mainHost = /** @type {HTMLElement} */ (document.getElementById('main-chart'));
const insetHost = /** @type {HTMLElement} */ (document.getElementById('inset-chart'));

const mainChart = new Chart(mainHost, {
  width: 720,
  height: 480,
  xLabel: 'Number of Assets (N)',
  yLabel: 'Portfolio Standard Deviation',
  xFmt: fixed(0),
  yFmt: fixed(1),
});
mainChart.setDomain(1, N_MAX, 0, 1.05).renderAxes({
  xTicks: [1, 20, 40, 60, 80, 100],
  yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
});

const insetChart = new Chart(insetHost, {
  width: 480,
  height: 320,
  margin: { top: 14, right: 20, bottom: 44, left: 60 },
  xLabel: 'Number of Assets (N)',
  yLabel: 'Portfolio Variance',
  xFmt: fixed(0),
  yFmt: fixed(1),
});
insetChart.setDomain(1, N_MAX, 0, 1.05).renderAxes({
  xTicks: [1, 25, 50, 75, 100],
  yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
});

/* --------------------------------------------------- draw the main chart -- */
function drawMain(m) {
  mainChart.clearData();

  // systematic floors (asymptotes), drawn under the curves
  if (m.c2 && m.rho > 0) {
    const floor = Math.sqrt(m.rho);
    mainChart.hline(floor, { stroke: 'var(--gold)', dash: '6 5', width: 1.4, opacity: 0.9 });
    mainChart.text(N_MAX, floor, 'systematic risk √ρ', {
      dx: -4, dy: 14, anchor: 'end', fill: 'var(--gold)',
    });
  }
  if (m.c3 && m.beta > 0 && Math.abs(m.beta * m.beta - m.rho) > 5e-3) {
    mainChart.hline(m.beta, { stroke: 'var(--navy)', dash: '2 4', width: 1.3, opacity: 0.8 });
    mainChart.text(N_MAX, m.beta, 'β', { dx: -4, dy: -6, anchor: 'end', fill: 'var(--navy)' });
  }

  // the three curves (Case 3 dashed so a coinciding Case 2 stays visible)
  if (m.c1) mainChart.path(curve(ewVarUncorrelated), { stroke: 'var(--blue)', width: 3.75 });
  if (m.c2) mainChart.path(curve((n) => ewVarCommonCorr(n, m.rho)), { stroke: 'var(--gold)', width: 3.75 });
  if (m.c3) {
    mainChart.path(curve((n) => ewVarCommonCorr(n, m.beta * m.beta)), {
      stroke: 'var(--navy)', width: 3.3, dash: '7 5',
    });
  }

  // markers at the current N
  mainChart.vline(m.n, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.55 });
  if (m.c1) mainChart.point(m.n, Math.sqrt(m.var1), { r: 5, fill: 'var(--blue)', stroke: '#fff' });
  if (m.c2) mainChart.point(m.n, Math.sqrt(m.var2), { r: 5, fill: 'var(--gold)', stroke: '#fff' });
  if (m.c3) mainChart.point(m.n, Math.sqrt(m.var3), { r: 5, fill: 'var(--navy)', stroke: '#fff' });
}

/* ------------------------------------- draw the variance-source inset ----- */
function drawInset(m) {
  insetChart.clearData();

  // VARIANCE units on this chart (not σ) — the two stacked terms sum to σ_P²
  const sys = samples((n) => ((n - 1) / n) * m.rho);
  const total = samples((n) => ewVarCommonCorr(n, m.rho));
  const base = [{ x: 1, y: 0 }, { x: N_MAX, y: 0 }];

  // stacked variance components: covariance (systematic) term below,
  // 1/N variance term as the band on top; their sum is σ_P².
  area(insetChart, sys, base, 'var(--gold)', 0.45);
  area(insetChart, total, sys, 'var(--blue)', 0.35);
  insetChart.path(total, { stroke: 'var(--gold)', width: 3 });
  if (m.rho > 0) {
    insetChart.hline(m.rho, { stroke: 'var(--gold)', dash: '6 5', width: 1.2, opacity: 0.9 });
    insetChart.text(N_MAX, m.rho, 'ρ', { dx: -4, dy: -5, anchor: 'end', fill: 'var(--gold)' });
  }
  insetChart.vline(m.n, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.55 });
  insetChart.point(m.n, m.var2, { r: 4.5, fill: 'var(--gold)', stroke: '#fff' });
}

/* ------------------------------------------------ variance-share bar ------ */
function drawVdBar(m) {
  const sysVar = ((m.n - 1) / m.n) * m.rho;
  const idioVar = 1 / m.n;
  const total = sysVar + idioVar;
  const sysShare = total > 0 ? sysVar / total : 0;
  const idioShare = 1 - sysShare;

  const bar = /** @type {HTMLElement} */ (document.getElementById('vd-bar'));
  bar.replaceChildren();
  const seg = (cls, share) => {
    const d = document.createElement('div');
    d.className = `vd-seg ${cls}`;
    d.style.flex = `${Math.max(share, 0.0001)} 1 0`;
    if (share >= 0.09) d.textContent = `${Math.round(share * 100)}%`;
    return d;
  };
  bar.append(seg('idio', idioShare), seg('sys', sysShare));

  renderLabel(
    /** @type {HTMLElement} */ (document.getElementById('vd-title')),
    `Share of $\\sigma_P^2$ at $N = ${m.n}$ (Case 2)`,
  );
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(m) {
  const rows = [
    ['$\\sigma_P$ — Case 1', Math.sqrt(m.var1).toFixed(4), 'blue'],
    ['$\\sigma_P$ — Case 2', Math.sqrt(m.var2).toFixed(4), 'gold'],
    ['$\\sigma_P$ — Case 3', Math.sqrt(m.var3).toFixed(4), ''],
    ['Floor $\\sqrt{\\rho}$ ($N \\to \\infty$)', Math.sqrt(m.rho).toFixed(4), 'gold'],
    ['$\\beta^2$ (implied $\\rho$)', (m.beta * m.beta).toFixed(4), ''],
    ['Variance term $1/N$ gone', `${((1 - 1 / m.n) * 100).toFixed(0)}%`, 'blue'],
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
  // the deck's decomposition: diagonal (variance) terms + off-diagonal
  // (covariance) terms, with w_i = 1/N and Var(R_i) = 1
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-general')),
    `\\sigma_P^2 \\;=\\; ${BLUE}{\\sum_{i=1}^{N} w_i^2\\,\\mathrm{Var}(R_i)}` +
    ` \\;+\\; ${GOLD}{\\sum_{i=1}^{N}\\sum_{j \\neq i} w_i w_j\\,\\mathrm{Cov}(R_i,R_j)}` +
    `\\qquad w_i = \\tfrac{1}{N},\\; \\mathrm{Var}(R_i) = 1`,
  );
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-case1')),
    `\\textbf{Case 1:}\\;\\; \\sigma_P^2 = ${BLUE}{\\tfrac{1}{N}}` +
    ` = ${BLUE}{${m.var1.toFixed(4)}} \\;\\Rightarrow\\; \\sigma_P = \\mathbf{${Math.sqrt(m.var1).toFixed(4)}}`,
  );
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-case2')),
    `\\textbf{Case 2:}\\;\\; \\sigma_P^2 = ${BLUE}{\\tfrac{1}{N}} + ${GOLD}{\\tfrac{N-1}{N}\\,\\rho}` +
    ` = ${BLUE}{${m.var1.toFixed(4)}} + ${GOLD}{${(m.var2 - m.var1).toFixed(4)}}` +
    ` = ${m.var2.toFixed(4)} \\;\\Rightarrow\\; \\sigma_P = \\mathbf{${Math.sqrt(m.var2).toFixed(4)}}`,
  );
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-case3')),
    `\\textbf{Case 3:}\\;\\; R_i = \\beta R_M + \\varepsilon_i \\;\\Rightarrow\\;` +
    ` \\sigma_P^2 = ${BLUE}{\\tfrac{1}{N}} + ${GOLD}{\\tfrac{N-1}{N}\\,\\beta^2}` +
    ` = ${m.var3.toFixed(4)} \\;\\Rightarrow\\; \\sigma_P = \\mathbf{${Math.sqrt(m.var3).toFixed(4)}}`,
  );

  const flag = /** @type {HTMLElement} */ (document.getElementById('coincide-flag'));
  const coincide = m.c2 && m.c3 && Math.abs(m.beta * m.beta - m.rho) < 5e-3;
  flag.classList.toggle('on', coincide);
  if (coincide) {
    renderLabel(flag,
      `$\\beta^2 = ${(m.beta * m.beta).toFixed(3)} = \\rho$ — Case 3 coincides with ` +
      `Case 2: market exposure induces exactly that correlation (systematic risk).`);
  }
}

/* ---------------------------------------------------------- render cycle -- */
function renderAll() {
  const m = model();
  drawMain(m);
  drawInset(m);
  drawVdBar(m);
  drawReadouts(m);
  drawFormulas(m);
}

/* --------------------------------------------------------------- controls -- */
const nCtrl = slider({
  label: 'Number of assets $N$', min: 1, max: N_MAX, step: 1, value: Number(S.n),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('n', Math.round(v)); renderAll(); },
});
const rhoCtrl = slider({
  label: 'Correlation $\\rho$', min: 0, max: 0.95, step: 0.01, value: Number(S.rho),
  fmt: (v) => v.toFixed(2),
  onChange: (v) => { store.set('rho', v); renderAll(); },
});
const betaCtrl = slider({
  label: 'Beta $\\beta$', min: 0, max: 0.98, step: 0.001, value: Number(S.beta),
  fmt: (v) => v.toFixed(3),
  onChange: (v) => { store.set('beta', v); renderAll(); },
});
const c1Ctrl = toggle({
  label: 'Show Case 1', value: Boolean(S.c1),
  onChange: (v) => { store.set('c1', v); renderAll(); },
});
const c2Ctrl = toggle({
  label: 'Show Case 2', value: Boolean(S.c2),
  onChange: (v) => { store.set('c2', v); renderAll(); },
});
const c3Ctrl = toggle({
  label: 'Show Case 3', value: Boolean(S.c3),
  onChange: (v) => { store.set('c3', v); renderAll(); },
});

document.getElementById('ctrl-n').appendChild(nCtrl);
document.getElementById('ctrl-rho').appendChild(rhoCtrl);
document.getElementById('ctrl-beta').appendChild(betaCtrl);
document.getElementById('ctrl-c1').appendChild(c1Ctrl);
document.getElementById('ctrl-c2').appendChild(c2Ctrl);
document.getElementById('ctrl-c3').appendChild(c3Ctrl);

renderAll();
