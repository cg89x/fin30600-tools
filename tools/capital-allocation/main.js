// @ts-check
/**
 * Capital allocation + utility explorer (FIN 30600, Topic 3 §2–3).
 *
 * Combines one risky portfolio P with the risk-free asset along the Capital
 * Allocation Line (CAL); shows how mean–variance utility and risk aversion A
 * pick the optimal allocation y*. Deck defaults (from
 * Lectures/Topic 3/content/sec3_capalloc.tex): r_f = 7%, E[r_p] = 15%,
 * σ_p = 22%; the worked example y = 0.70 ⇒ E[r_C] = 12.6%, σ_C = 15.4%; the
 * optimal-allocation example uses A = 2 ⇒ y* = 0.8264. Utility form
 * U = E[r] − ½ A σ² is from sec2_riskpref.tex.
 *
 * All finance math lives in ../../lib/finmath.js (decimals everywhere); this
 * file only wires controls, chart, readouts, and the live KaTeX strip.
 */

import { Chart, LabelPlacer, pct, fixed } from '../../lib/chart.js';
import { sharpe, utility, optimalY, completeReturn, completeStd } from '../../lib/finmath.js';
import { slider, numberInput, toggle, renderTeX, renderLabel } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('capital-allocation');

/* ----------------------------------------------------------------- state -- */
// Percentages (rf, erp, sp, rB) are stored as whole percents for a readable
// URL hash; converted to decimals for the math. A and y are unitless.
const defaults = {
  rf: 7,        // risk-free rate (%)
  erp: 15,      // E[r_p], risky portfolio expected return (%)
  sp: 22,       // σ_p, risky portfolio std dev (%)
  A: 2,         // coefficient of risk aversion (deck's y* example)
  y: 0.7,       // allocation to the risky portfolio (deck's worked example)
  borrow: false, // borrowing rate > r_f?
  rB: 9,         // borrowing rate (%), default r_f + 2pp
};

// Numeric ranges mirror the controls; hash values clamp to these (state.js) —
// `#A=-3` (convex "utility") would otherwise mark the utility MINIMUM as w*.
const BOUNDS = {
  rf: [0, 20], erp: [0, 40], sp: [1, 60], A: [1, 10], y: [0, 2], rB: [0, 25],
};
const store = bindState(defaults, () => {}, { debounce: 150, bounds: BOUNDS });
const S = store.state;

const pscale = () => 1; // point-radius scale factor (fixed)

/* --------------------------------------------------------------- helpers -- */
const dec = (p) => p / 100;                 // percent -> decimal
const fpct1 = (d) => `${(d * 100).toFixed(1)}%`; // decimal -> "12.6%"

/** Model quantities derived from the current state (all decimals). */
function model() {
  const rf = dec(S.rf);
  const erp = dec(S.erp);
  const sp = dec(S.sp);
  const A = Number(S.A);
  const y = Number(S.y);
  const borrow = Boolean(S.borrow);
  const rB = dec(S.rB);
  const S_P = sharpe(erp, rf, sp);          // Sharpe of P (lending Sharpe)
  return { rf, erp, sp, A, y, borrow, rB, S_P };
}

/**
 * Complete-portfolio expected return at allocation w, honoring a borrowing
 * kink: for w > 1 with borrowing on, the funding rate is r_B (> r_f).
 */
function completeReturnKinked(w, m) {
  if (m.borrow && w > 1) return m.rB + w * (m.erp - m.rB);
  return completeReturn(w, m.erp, m.rf);
}

/**
 * Optimal allocation y* with the borrowing kink.
 * Returns { y, pinned } — pinned=true when the optimum sits exactly at the
 * kink (y = 1) because the lending optimum wants > 1 but the (flatter)
 * borrowing CAL wants < 1.
 */
function optimalYKinked(m) {
  const yLend = optimalY(m.erp, m.rf, m.sp, m.A);
  if (!m.borrow) return { y: yLend, pinned: false };
  if (yLend <= 1) return { y: yLend, pinned: false };
  const yBorrow = optimalY(m.erp, m.rB, m.sp, m.A);
  if (yBorrow >= 1) return { y: yBorrow, pinned: false };
  return { y: 1, pinned: true }; // optimum trapped at the kink
}

/* ---------------------------------------------------------------- charts -- */
const mainHost = /** @type {HTMLElement} */ (document.getElementById('main-chart'));
const insetHost = /** @type {HTMLElement} */ (document.getElementById('inset-chart'));

const mainChart = new Chart(mainHost, {
  width: 720,
  height: 480,
  xLabel: 'Standard Deviation',
  yLabel: 'Expected Return',
  xFmt: pct,
  yFmt: pct,
});

const insetChart = new Chart(insetHost, {
  width: 480,
  height: 320,
  margin: { top: 14, right: 20, bottom: 44, left: 60 },
  xLabel: 'w (fraction in risky portfolio)',
  yLabel: 'Utility',
  xFmt: fixed(1),
  yFmt: pct,
});

/** Round up to a "nice" whole-percent-ish ceiling for a clean axis top. */
function niceCeil(v, step = 0.05) {
  return Math.ceil(v / step - 1e-9) * step;
}

/** Compute the main-chart data domain from the current model. */
function mainDomain(m) {
  const xHi = Math.max(0.05, niceCeil(2 * m.sp * 1.12));
  const calTop = completeReturnKinked(2, m);
  const yHi = Math.max(0.05, niceCeil(Math.max(calTop, m.erp) * 1.22));
  return { xLo: 0, xHi, yLo: 0, yHi };
}

/** Compute the inset (utility-vs-y) domain from the current model. */
function insetDomain(m) {
  let uMin = Infinity;
  let uMax = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const w = (2 * i) / 40;
    const u = utility(completeReturnKinked(w, m), completeStd(w, m.sp), m.A);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  }
  const pad = Math.max(0.01, (uMax - uMin) * 0.12);
  return { xLo: 0, xHi: 2, yLo: uMin - pad, yHi: uMax + pad };
}

/** Points of the indifference curve E = U + ½ A σ², clipped to the domain. */
function indiffCurve(U, m, dom, n = 90) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = (dom.xHi * i) / n;
    const e = U + 0.5 * m.A * s * s;
    if (e > dom.yHi) break;         // stop at the top edge — no drawing in margins
    if (e < dom.yLo) continue;      // enter from below without painting the margin
    pts.push({ x: s, y: e });
  }
  return pts;
}

/* --------------------------------------------------- draw the main chart -- */
function drawMain(m, dom) {
  const ps = pscale();
  mainChart.clearData();

  // geometry: CAL (kinked at P when borrowing is on), optimum w*, current C
  const calTop = completeReturnKinked(2, m);
  const calPts = m.borrow
    ? [{ x: 0, y: m.rf }, { x: m.sp, y: m.erp }, { x: 2 * m.sp, y: calTop }]
    : [{ x: 0, y: m.rf }, { x: 2 * m.sp, y: calTop }];
  const opt = optimalYKinked(m);
  const optS = completeStd(opt.y, m.sp);
  const optE = completeReturnKinked(opt.y, m);
  const optCurve = indiffCurve(utility(optE, optS, m.A), m, dom);
  const cS = completeStd(m.y, m.sp);
  const cE = completeReturnKinked(m.y, m);
  const cCurve = indiffCurve(utility(cE, cS, m.A), m, dom);

  // lines: CAL (blue), the tangent indifference curve at w* (muted dashed
  // gold), the indifference curve through the current C (solid gold)
  mainChart.path(calPts, { stroke: 'var(--blue)', width: 2.5 });
  mainChart.path(optCurve, { stroke: 'var(--gold)', width: 1.8, dash: '5 4', opacity: 0.6 });
  mainChart.path(cCurve, { stroke: 'var(--gold)', width: 2 });

  // markers: r_f, risky portfolio P, optimum (gold star), current C
  const rRf = 4 * ps;
  const rP = 5.5 * ps;
  const rOpt = 7 * ps;
  const rC = 6 * ps;
  mainChart.point(0, m.rf, { r: rRf, fill: 'var(--blue)' });
  mainChart.point(m.sp, m.erp, { r: rP, fill: 'var(--blue)' });
  mainChart.point(optS, optE, { r: rOpt, shape: 'star', fill: 'var(--gold)' });
  mainChart.point(cS, cE, { r: rC, fill: 'var(--blue)', stroke: '#fff' });

  // labels — collision-aware (LabelPlacer, 2026-09-08: the fixed offsets put
  // "C: …" and "w* = …" straight onto the CAL). Every labelled point sits on
  // the CAL, which rises to the right, and the indifference curves through C
  // and w* rise to the right too, so a point's upper-left and lower-right
  // quadrants are the line-free ones: the placer prefers those, skips spots
  // that overlap another label or marker, cross a curve, or leave the plot,
  // and draws each label with a white halo so it reads regardless. C goes
  // first (longest, most important), then w*, P, r_f. Labels are 18px, 50%
  // above the 12px .datalabel size (Christian 2026-09-08), so C's readout is
  // split over two lines to keep it inside the plot.
  const lp = new LabelPlacer(mainChart, { fontPx: 18 });
  lp.avoidPath(calPts).avoidPath(optCurve).avoidPath(cCurve);
  const mkRf = lp.avoidPoint(0, m.rf, rRf);
  const mkP = lp.avoidPoint(m.sp, m.erp, rP);
  const mkOpt = lp.avoidPoint(optS, optE, rOpt);
  const mkC = lp.avoidPoint(cS, cE, rC);
  // At w = 1 the complete portfolio IS P: one label says so instead of two
  // labels competing for the same point.
  const cIsP = Math.abs(m.y - 1) < 1e-9;
  lp.label(cS, cE, `${cIsP ? 'C = P' : 'C'}: E[r_C] = ${fpct1(cE)}\nσ_C = ${fpct1(cS)}`, { r: rC, own: mkC, fill: 'var(--blue)' });
  lp.label(optS, optE, `w* = ${opt.y.toFixed(3)}`, { r: rOpt, own: mkOpt, fill: 'var(--gold)' });
  if (!cIsP) lp.label(m.sp, m.erp, 'P', { r: rP, own: mkP, fill: 'var(--blue)', prefer: ['lr', 'ul', 'ur', 'll'] });
  lp.label(0, m.rf, 'r_f', { r: rRf, own: mkRf, fill: 'var(--muted)', prefer: ['lr', 'ur'] });
}

/* -------------------------------------------------- draw the utility inset -- */
function drawInset(m, dom) {
  const ps = pscale();
  insetChart.clearData();
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const w = (2 * i) / 120;
    pts.push({ x: w, y: utility(completeReturnKinked(w, m), completeStd(w, m.sp), m.A) });
  }
  insetChart.path(pts, { stroke: 'var(--blue)', width: 2.5 });

  // peak at y*
  const opt = optimalYKinked(m);
  const yStar = Math.min(2, Math.max(0, opt.y));
  const uStar = utility(completeReturnKinked(yStar, m), completeStd(yStar, m.sp), m.A);
  insetChart.vline(yStar, { stroke: 'var(--gold)', dash: '4 4', width: 1.4 });
  insetChart.point(yStar, uStar, { r: 6.5 * ps, shape: 'star', fill: 'var(--gold)' });

  // current allocation marker
  const uCur = utility(completeReturnKinked(m.y, m), completeStd(m.y, m.sp), m.A);
  insetChart.point(m.y, uCur, { r: 5 * ps, fill: 'var(--blue)', stroke: '#fff' });
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(m) {
  const opt = optimalYKinked(m);
  const cE = completeReturnKinked(m.y, m);
  const cS = completeStd(m.y, m.sp);
  const uCur = utility(cE, cS, m.A);
  const optS = completeStd(opt.y, m.sp);
  const optE = completeReturnKinked(opt.y, m);
  const uOpt = utility(optE, optS, m.A);

  const rows = [
    ['Sharpe of $P$', m.S_P.toFixed(4), 'blue'],
    ['$w^*$ (optimal)', opt.y.toFixed(4) + (opt.pinned ? ' (kink)' : ''), 'gold'],
    ['$E[r_C]$ (current)', fpct1(cE), 'blue'],
    ['$\\sigma_C$ (current)', fpct1(cS), 'blue'],
    ['$U$ (current)', uCur.toFixed(4), ''],
    ['$U$ (at $w^*$)', uOpt.toFixed(4), 'gold'],
  ];
  const host = /** @type {HTMLElement} */ (document.getElementById('readouts'));
  host.innerHTML = '';
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

  const flag = /** @type {HTMLElement} */ (document.getElementById('pin-flag'));
  flag.classList.toggle('on', opt.pinned);
}

/* --------------------------------------------------- KaTeX formula strip -- */
function drawFormulas(m) {
  const cE = completeReturnKinked(m.y, m);
  const cS = completeStd(m.y, m.sp);
  const uCur = utility(cE, cS, m.A);
  const opt = optimalYKinked(m);

  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-utility')),
    `U = E[r] - \\tfrac{1}{2}A\\,\\sigma^2 = ${cE.toFixed(4)} - \\tfrac{1}{2}(${m.A})(${cS.toFixed(4)})^2 = \\mathbf{${uCur.toFixed(4)}}`,
  );
  const denom = m.A * m.sp * m.sp;
  const yLend = optimalY(m.erp, m.rf, m.sp, m.A);
  let tail = `= \\frac{${m.erp.toFixed(4)} - ${m.rf.toFixed(4)}}{(${m.A})(${m.sp.toFixed(4)})^2} = \\mathbf{${yLend.toFixed(4)}}`;
  if (opt.pinned) tail += `\\;\\Rightarrow\\; \\text{pinned at the kink } w^* = 1`;
  else if (m.borrow && Math.abs(opt.y - yLend) > 1e-9) {
    tail += `\\;\\Rightarrow\\; \\text{(borrowing) } w^* = ${opt.y.toFixed(4)}`;
  }
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('f-ystar')),
    `w^* = \\frac{E[r_p] - r_f}{A\\,\\sigma_p^2} ${tail}`,
  );
}

/* ---------------------------------------------------------- render cycle -- */
let lastDomKey = '';
function domainKey(dom) {
  return `${dom.xLo}|${dom.xHi}|${dom.yLo}|${dom.yHi}`;
}

/**
 * Full render. `rebuildAxes` forces the axis layer to be rebuilt; otherwise it
 * is rebuilt only when the computed domain actually changed. Slider drags of
 * y (and A, whose main-chart domain is stable) go through the data layer only.
 */
function renderAll(rebuildAxes = false) {
  const m = model();
  const mDom = mainDomain(m);
  const iDom = insetDomain(m);
  const key = domainKey(mDom) + '#' + domainKey(iDom);
  if (rebuildAxes || key !== lastDomKey) {
    mainChart.setDomain(mDom.xLo, mDom.xHi, mDom.yLo, mDom.yHi).renderAxes({ xTickCount: 7, yTickCount: 7 });
    insetChart.setDomain(iDom.xLo, iDom.xHi, iDom.yLo, iDom.yHi).renderAxes({
      xTicks: [0, 0.5, 1, 1.5, 2], yTickCount: 5,
    });
    lastDomKey = key;
  }
  drawMain(m, mDom);
  drawInset(m, iDom);
  drawReadouts(m);
  drawFormulas(m);
}

/* --------------------------------------------------------------- controls -- */
const rbWrap = /** @type {HTMLElement} */ (document.getElementById('rb-wrap'));

const rfCtrl = numberInput({
  label: '$r_f$ (%)', value: S.rf, min: 0, max: 20, step: 0.5,
  onChange: (v) => { store.set('rf', v); renderAll(); },
});
const erpCtrl = numberInput({
  label: '$E[r_p]$ (%)', value: S.erp, min: 0, max: 40, step: 0.5,
  onChange: (v) => { store.set('erp', v); renderAll(); },
});
const spCtrl = numberInput({
  label: '$\\sigma_p$ (%)', value: S.sp, min: 1, max: 60, step: 0.5,
  onChange: (v) => { store.set('sp', v); renderAll(); },
});
const aCtrl = slider({
  label: 'Risk aversion $A$', min: 1, max: 10, step: 0.5, value: S.A,
  fmt: (v) => v.toFixed(1),
  onChange: (v) => { store.set('A', v); renderAll(); },
});
const yCtrl = slider({
  label: 'Allocation $w$ (risky share)', min: 0, max: 2, step: 0.01, value: S.y,
  fmt: (v) => v.toFixed(2),
  onChange: (v) => { store.set('y', v); renderAll(); },
});
const rbCtrl = numberInput({
  label: '$r_B$ (%)', value: S.rB, min: 0, max: 25, step: 0.5,
  onChange: (v) => { store.set('rB', v); renderAll(); },
});
const borrowCtrl = toggle({
  label: 'Borrowing rate $> r_f$', value: S.borrow,
  onChange: (v) => {
    store.set('borrow', v);
    rbWrap.classList.toggle('on', v);
    if (v) {
      // default r_B = r_f + 2pp on activation
      const rbDefault = Number(S.rf) + 2;
      rbCtrl.set(rbDefault);
      store.set('rB', rbDefault);
    }
    renderAll();
  },
});

document.getElementById('ctrl-rf').appendChild(rfCtrl);
document.getElementById('ctrl-erp').appendChild(erpCtrl);
document.getElementById('ctrl-sp').appendChild(spCtrl);
document.getElementById('ctrl-A').appendChild(aCtrl);
document.getElementById('ctrl-y').appendChild(yCtrl);
document.getElementById('ctrl-borrow').appendChild(borrowCtrl);
document.getElementById('ctrl-rB').appendChild(rbCtrl);

// reflect initial borrow state (e.g. from a shared URL)
if (S.borrow) rbWrap.classList.add('on');

renderAll(true);
