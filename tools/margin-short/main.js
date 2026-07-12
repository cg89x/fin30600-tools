// @ts-check
/**
 * Buying on margin & short sales explorer (FIN 30600, Lecture 2 §4–5).
 *
 * Two full-width sections stacked on one page, deliberately parallel so the
 * mirror-image geometry is visible:
 *   1. Buying on margin — the deck's SpaceX example (sec4_margin.tex):
 *      $5,500 own cash, P₀ = $100, initial margin 55%, maintenance 40%
 *      ⇒ N = 100, Loan = $4,500, M = 1/0.55 = 1.8182, margin call at $75.00
 *      (or $82.50 after one year of 10% call-loan interest); P₁ = 120 → +36.36%,
 *      P₁ = 80 → −36.36%.
 *   2. Short sales — the deck's ATT example (sec5_short.tex):
 *      short 100 @ $50, initial margin 50%, maintenance 30%
 *      ⇒ C₀ = $2,500, margin call at $57.69; P₁ = 53 → equity $2,200,
 *      R = −12% = (−6%) × (1/0.5).
 *
 * Per section: controls left; formula strip + readouts + a chart row of
 *   (A) the ACCOUNT as one stacked balance bar with a dashed red margin-call
 *       refline on a companion per-share price scale (long: loan below, equity
 *       above, danger DOWN; short: fixed assets, liability grows with the
 *       price, danger UP), plus a constant-height status strip that flashes
 *       MARGIN CALL with the shortfall, and
 *   (B) the magnification line R vs R_stock (levered blue with slope
 *       ±1/margin, unlevered 45° grey dashed, deck anchor dots, current gold
 *       dot, shaded margin-call region).
 *
 * ALL margin math comes from ../../lib/finmath.js (unit-tested against the
 * deck); this file only formats and draws.
 */

import {
  marginSharesMax, longMarginRate, longMarginCallPrice, longLeveredReturn,
  shortCashRequired, shortMarginRate, shortMarginCallPrice, shortReturn,
} from '../../lib/finmath.js';
import { Chart, pct, niceTicks } from '../../lib/chart.js';
import { slider, numberInput, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('margin-short'); // release gate — must run before anything below

hydrateLabels();

/* ---- state (percents stored as percents for readable URLs) --------------- */
const DEFAULTS = {
  // Section 1 — buying on margin (deck SpaceX example)
  e0: 5500,   // own cash E₀
  p0: 100,    // purchase price P₀
  im: 55,     // initial margin used, %
  mm: 40,     // maintenance margin, %
  c: 10,      // call-loan rate, %/yr
  intr: false, // accrue 1 year of loan interest?
  p1: 100,    // current price P₁ (the star control)
  // Section 2 — short sale (deck ATT example)
  sn: 100,    // shares shorted
  sp0: 50,    // sale price P₀
  sim: 50,    // initial margin, %
  smm: 30,    // maintenance margin, %
  sp1: 53,    // current price P₁
};
// Numeric ranges mirror the sliders; hash values clamp to these (state.js) —
// e.g. `#im=0` must not produce N = ∞ shares and Infinity readouts.
const BOUNDS = {
  e0: [100, 1000000], p0: [1, 10000], im: [50, 100], mm: [25, 50],
  c: [0, 12], p1: [40, 160],
  sn: [1, 100000], sp0: [1, 10000], sim: [50, 100], smm: [25, 50], sp1: [20, 80],
};
const store = bindState(DEFAULTS, undefined, { bounds: BOUNDS });
const S = store.state;

const P1_MIN = 40, P1_MAX = 160;   // long P₁ slider range
const SP1_MIN = 20, SP1_MAX = 80;  // short P₁ slider range
const R_LO = -0.5, R_HI = 0.5;     // stock-return axis on the magnification charts

/* ---- formatting helpers --------------------------------------------------- */
/** "$1,234" (minus sign in front of the $ for negatives). */
function usd0(v) {
  return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}
/** "$1,234.56". */
function usd2(v) {
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Whole dollars when the amount is whole, cents otherwise. */
function usdSmart(v) {
  return Math.abs(v - Math.round(v)) < 0.005 ? usd0(v) : usd2(v);
}
/** Signed percent, 2 decimals: 0.3636 → "+36.36%". */
function signedPct(v, d = 2) {
  return `${v < 0 ? '−' : '+'}${(Math.abs(v) * 100).toFixed(d)}%`;
}
/** Same, TeX-safe (escaped \%). */
function signedPctTeX(v, d = 1) {
  return `${v < 0 ? '-' : '+'}${(Math.abs(v) * 100).toFixed(d)}\\%`;
}
/** Dollars inside TeX: comma groups wrapped {,} so spacing stays tight. */
function texUsd(v) {
  const a = Math.abs(v);
  const cents = Math.abs(a - Math.round(a)) >= 0.005;
  const s = a.toLocaleString('en-US', cents
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
  return `${v < 0 ? '-' : ''}\\$${s.replace(/,/g, '{,}')}`;
}
/** Share count: whole when whole (deck: 100), else 2 decimals. */
function fmtShares(n) {
  return Math.abs(n - Math.round(n)) < 1e-9
    ? Math.round(n).toLocaleString('en-US')
    : n.toFixed(2);
}
/** One readout cell (house pattern: renderLabel key + value). */
function readout(k, v, cls = '') {
  const cell = document.createElement('div');
  cell.className = 'readout';
  const key = document.createElement('div');
  key.className = 'k';
  renderLabel(key, k);
  const val = document.createElement('div');
  val.className = `v ${cls}`;
  val.innerHTML = v;
  cell.append(key, val);
  return cell;
}
/** @param {string} id @returns {HTMLElement} */
function el(id) { return /** @type {HTMLElement} */ (document.getElementById(id)); }

/* ---- filled-shape helpers (chart.path is stroke-only; same trick as the
 *      duration/diversification tools) -------------------------------------- */
function filled(chart, points, fill, opacity = 1) {
  const node = chart.path(points, { stroke: 'none' });
  node.setAttribute('fill', fill);
  node.setAttribute('opacity', String(opacity));
  return node;
}
function bar(chart, x, y0, y1, hw, fill, opacity = 1) {
  return filled(chart, [
    { x: x - hw, y: y0 }, { x: x - hw, y: y1 },
    { x: x + hw, y: y1 }, { x: x + hw, y: y0 },
  ], fill, opacity);
}
/** Label a bar segment (name + amount) in white, only if it is tall enough. */
function segLabel(chart, x, y0, y1, name, amount) {
  const hpx = Math.abs(chart.sy(y1) - chart.sy(y0));
  if (hpx < 18) return;
  const mid = (y0 + y1) / 2;
  if (hpx >= 36) {
    chart.text(x, mid, name, { dy: -3, anchor: 'middle', fill: '#fff', klass: 'seglabel' });
    chart.text(x, mid, amount, { dy: 13, anchor: 'middle', fill: '#fff', klass: 'seglabel' });
  } else {
    chart.text(x, mid, amount, { dy: 4, anchor: 'middle', fill: '#fff', klass: 'seglabel' });
  }
}
/** Companion per-share price scale on the right edge of a balance-bar chart. */
function priceScale(chart, n) {
  for (const p of niceTicks(0, chart.yHi / n, 6)) {
    if (p <= 0) continue;
    chart.text(chart.xHi, p * n, usd0(p), { dx: 8, dy: 4, fill: 'var(--muted)' });
  }
}
/** Margin-call status strip: quiet when safe, flashing red with the shortfall. */
function mcStrip(host, m, mmPct) {
  if (m.call) {
    host.className = 'mc-strip call';
    host.innerHTML =
      `<span class="mc-flag">MARGIN CALL</span><span>equity ${usdSmart(m.equity)} ` +
      `is <b>${usdSmart(m.shortfall)}</b> short of the ${mmPct}% maintenance ` +
      `requirement (${usdSmart(m.reqEq)})</span>`;
  } else {
    host.className = 'mc-strip ok';
    host.innerHTML =
      `margin rate ${(m.mRate * 100).toFixed(1)}% ≥ maintenance ${mmPct}% — no margin call`;
  }
}

/* ==========================================================================
 *  SECTION 1 — BUYING ON MARGIN (deck SpaceX example)
 * ======================================================================== */

const longBar = new Chart(el('long-bar'), {
  width: 380, height: 440,
  margin: { top: 20, right: 64, bottom: 26, left: 76 },
  xLabel: '', yLabel: 'Position Value',
  xFmt: () => '', yFmt: usd0,
});
const longMag = new Chart(el('long-mag'), {
  width: 640, height: 440,
  margin: { top: 18, right: 24, bottom: 48, left: 66 },
  xLabel: 'Stock return', yLabel: 'Return on equity',
  xFmt: pct, yFmt: pct,
});

/** All Section-1 quantities (decimals), straight from lib/finmath.js. */
function longModel() {
  const e0 = Math.max(1, Number(S.e0) || 0);
  const p0 = Math.max(0.01, Number(S.p0) || 0);
  const im = Number(S.im) / 100;
  const mm = Number(S.mm) / 100;
  const c = Number(S.c) / 100;
  const withInt = Boolean(S.intr);
  const p1 = Number(S.p1);
  const n = marginSharesMax(e0, p0, im);          // deck: 100 shares
  const loan = n * p0 - e0;                       // deck: $4,500
  const loanG = withInt ? loan * (1 + c) : loan;  // grossed up when interest accrues
  const M = 1 / im;                               // deck: 1.8182
  const callP = longMarginCallPrice(loanG, n, mm); // deck: $75.00 / $82.50
  const value = n * p1;
  const equity = value - loanG;
  const ret = longLeveredReturn(n, p1, loanG, e0);
  const mRate = longMarginRate(n, p1, loanG);
  const rStock = p1 / p0 - 1;
  const rCall = callP / p0 - 1;                   // stock return at the call trigger
  const call = p1 < callP - 1e-9;
  const reqEq = mm * value;
  const shortfall = reqEq - equity;
  /** Return on equity at a given stock return (the levered line). */
  const lev = (R) => longLeveredReturn(n, p0 * (1 + R), loanG, e0);
  return {
    e0, p0, im, mm, c, withInt, p1, n, loan, loanG, M, callP,
    value, equity, ret, mRate, rStock, rCall, call, reqEq, shortfall, lev,
  };
}

/* ---- chart A: the account (stacked balance bar) --------------------------- */
let longBarKey = '';
function drawLongBar(m) {
  const yHi = m.n * P1_MAX * 1.04;
  const key = yHi.toFixed(2);
  if (key !== longBarKey) {
    longBarKey = key;
    longBar.setDomain(0, 1, 0, yHi)
      .renderAxes({ xTicks: [], yTicks: niceTicks(0, yHi, 6) });
  }
  longBar.clearData();
  priceScale(longBar, m.n);

  const bx = 0.42, hw = 0.17;
  // gold = the broker's loan claim (bottom), blue = your equity (top)
  bar(longBar, bx, 0, Math.min(m.loanG, m.value), hw, 'var(--gold)', 0.92);
  if (m.equity > 0) bar(longBar, bx, m.loanG, m.value, hw, 'var(--blue)', 0.92);
  segLabel(longBar, bx, 0, Math.min(m.loanG, m.value), 'Loan', usd0(m.loanG));
  if (m.equity > 0) segLabel(longBar, bx, m.loanG, m.value, 'Equity', usd0(m.equity));

  // fixed loan balance (grey dashed) — the bar top diving below it = wiped out
  longBar.hline(m.loanG, { stroke: 'var(--axis)', dash: '4 4', width: 1.2, opacity: 0.7 });
  longBar.text(0.02, m.loanG, m.withInt ? 'loan + interest' : 'loan',
    { dy: -5, fill: 'var(--muted)' });

  // margin-call price on the companion price scale (RED dashed)
  const callLevel = m.callP * m.n;
  if (callLevel < longBar.yHi) {
    longBar.hline(callLevel, { stroke: 'var(--red)', dash: '6 4', width: 1.8 });
    longBar.text(0.02, callLevel, `margin call  P = ${usd2(m.callP)}`,
      { dy: -6, fill: 'var(--red)' });
  }

  // moving bar top = the position value at P₁
  longBar.text(bx, m.value, `P_1 = ${usdSmart(m.p1)}`,
    { dy: -8, anchor: 'middle', fill: 'var(--navy)' });
}

/* ---- chart B: the magnification line -------------------------------------- */
let longMagKey = '';
function drawLongMag(m) {
  const ys = [m.lev(R_LO), m.lev(R_HI), R_LO, R_HI];
  let yLo = Math.min(...ys), yHi = Math.max(...ys);
  const pad = Math.max(0.02, (yHi - yLo) * 0.07);
  yLo -= pad; yHi += pad;
  const key = `${yLo.toFixed(3)}|${yHi.toFixed(3)}`;
  if (key !== longMagKey) {
    longMagKey = key;
    longMag.setDomain(R_LO, R_HI, yLo, yHi)
      .renderAxes({ xTicks: [-0.5, -0.25, 0, 0.25, 0.5], yTicks: niceTicks(yLo, yHi, 7) });
  }
  longMag.clearData();

  // margin-call region: stock returns below R_call (price under the trigger)
  if (m.rCall > R_LO) {
    const x2 = Math.min(m.rCall, R_HI);
    filled(longMag, [
      { x: R_LO, y: yLo }, { x: R_LO, y: yHi }, { x: x2, y: yHi }, { x: x2, y: yLo },
    ], 'var(--red)', 0.06);
    if (m.rCall <= R_HI) {
      longMag.vline(m.rCall, { stroke: 'var(--red)', dash: '6 4', width: 1.6 });
      longMag.text(m.rCall, yHi, 'margin call', {
        dx: m.rCall > 0.22 ? -6 : 6, dy: 14,
        anchor: m.rCall > 0.22 ? 'end' : 'start', fill: 'var(--red)',
      });
    }
  }

  // unlevered 45° reference (grey dashed), then the levered line (BLUE) on top
  longMag.path([{ x: R_LO, y: R_LO }, { x: R_HI, y: R_HI }],
    { stroke: 'var(--axis)', dash: '6 4', width: 1.8, opacity: 0.85 });
  longMag.text(R_HI, R_HI, 'unlevered', { dx: -6, dy: 14, anchor: 'end', fill: 'var(--muted)' });
  longMag.path([{ x: R_LO, y: m.lev(R_LO) }, { x: R_HI, y: m.lev(R_HI) }],
    { stroke: 'var(--blue)', width: 2.6 });
  longMag.text(R_HI, m.lev(R_HI), `levered, M = ${m.M.toFixed(2)}`,
    { dx: -6, dy: -8, anchor: 'end', fill: 'var(--blue)' });

  // deck anchor scenarios at ±20% (defaults: ±36.36%)
  for (const R of [-0.2, 0.2]) {
    const y = m.lev(R);
    longMag.point(R, y, { shape: 'diamond', r: 5.5, fill: 'var(--navy)' });
    longMag.text(R, y, signedPct(y), {
      dx: R > 0 ? -9 : 9, dy: R > 0 ? -9 : 15,
      anchor: R > 0 ? 'end' : 'start', fill: 'var(--navy)',
    });
  }

  // the current P₁-implied point (GOLD)
  if (m.rStock >= R_LO - 1e-9 && m.rStock <= R_HI + 1e-9) {
    longMag.point(m.rStock, m.ret, { r: 6, fill: 'var(--gold)', stroke: '#fff' });
    longMag.text(m.rStock, m.ret, `current ${signedPct(m.ret)}`,
      { dx: 10, dy: 16, fill: 'var(--gold)' });
  }
}

/* ---- readouts / formulas / status ----------------------------------------- */
function drawLongReadouts(m) {
  el('long-readouts').replaceChildren(
    readout('Shares bought $N$', fmtShares(m.n), 'blue'),
    readout('Broker loan', usdSmart(m.loan) +
      (m.withInt ? ` <small>→ ${usdSmart(m.loanG)} w/ interest</small>` : ''), 'gold'),
    readout('Magnification $M = 1/\\text{margin}$', `${m.M.toFixed(4)}×`, ''),
    readout('Margin-call price', usd2(m.callP), 'red'),
    readout('Equity at $P_1$', usdSmart(m.equity), ''),
    readout('Return on equity', signedPct(m.ret), m.ret < 0 ? 'red' : 'blue'),
  );
  mcStrip(el('long-mc'), m, Number(S.mm));
}

function drawLongFormulas(m) {
  renderTeX(el('long-f1'),
    `\\text{Margin Rate} \\;=\\; \\frac{\\textcolor{#0072B2}{\\text{Equity in Account}}}` +
    `{\\textcolor{#C99700}{\\text{Market Value of Position}}}` +
    ` \\;=\\; \\frac{N\\,P - \\text{Loan}}{N\\,P}` +
    ` \\;=\\; \\frac{${fmtShares(m.n)} \\times ${texUsd(m.p1)} - ${texUsd(m.loanG)}}` +
    `{${fmtShares(m.n)} \\times ${texUsd(m.p1)}}` +
    ` \\;=\\; ${(m.mRate * 100).toFixed(1)}\\%`);
  const im2 = (m.im).toFixed(2);
  let f2 =
    `M \\;=\\; \\frac{1}{\\text{margin used}} \\;=\\; \\frac{1}{${im2}} \\;=\\; ${m.M.toFixed(4)}` +
    `\\qquad R \\;=\\; M \\times R_{\\text{stock}}`;
  if (m.withInt) f2 += ` \\;-\\; \\frac{\\text{Loan} \\times c}{E_0}`;
  f2 += ` \\;=\\; ${m.M.toFixed(4)} \\times (${signedPctTeX(m.rStock, 1)})`;
  if (m.withInt) f2 += ` \\;-\\; ${((m.loan * m.c / m.e0) * 100).toFixed(2)}\\%`;
  f2 += ` \\;=\\; ${signedPctTeX(m.ret, 2)}`;
  renderTeX(el('long-f2'), f2);
}

function renderLong() {
  const m = longModel();
  drawLongBar(m);
  drawLongMag(m);
  drawLongReadouts(m);
  drawLongFormulas(m);
}

/* ---- controls -------------------------------------------------------------- */
el('long-position').append(
  numberInput({
    label: 'Own cash $E_0$', min: 100, max: 1000000, step: 100, value: Number(S.e0),
    onChange: (v) => { store.set('e0', v); renderLong(); },
  }),
  numberInput({
    label: 'Purchase price $P_0$', min: 1, max: 10000, step: 1, value: Number(S.p0),
    onChange: (v) => { store.set('p0', v); renderLong(); },
  }),
);
el('long-margin').append(
  slider({
    label: 'Initial margin used', min: 50, max: 100, step: 1, value: Number(S.im),
    fmt: (v) => `${v.toFixed(0)}%`,
    onChange: (v) => { store.set('im', v); renderLong(); },
  }),
  slider({
    label: 'Maintenance margin', min: 25, max: 50, step: 1, value: Number(S.mm),
    fmt: (v) => `${v.toFixed(0)}%`,
    onChange: (v) => { store.set('mm', v); renderLong(); },
  }),
  slider({
    label: 'Call-loan rate $c$', min: 0, max: 12, step: 0.5, value: Number(S.c),
    fmt: (v) => `${v.toFixed(1)}%`,
    onChange: (v) => { store.set('c', v); renderLong(); },
  }),
  toggle({
    label: 'Accrue 1 year of loan interest', value: Boolean(S.intr),
    onChange: (v) => { store.set('intr', v); renderLong(); },
  }),
);
el('long-scenario').append(
  slider({
    label: 'Current price $P_1$', min: P1_MIN, max: P1_MAX, step: 1, value: Number(S.p1),
    fmt: (v) => usdSmart(v),
    onChange: (v) => { store.set('p1', v); renderLong(); },
  }),
);

/* ==========================================================================
 *  SECTION 2 — SHORT SALES (deck ATT example)
 * ======================================================================== */

const shortBar = new Chart(el('short-bar'), {
  width: 380, height: 440,
  margin: { top: 20, right: 64, bottom: 26, left: 76 },
  xLabel: '', yLabel: 'Account Value',
  xFmt: () => '', yFmt: usd0,
});
const shortMag = new Chart(el('short-mag'), {
  width: 640, height: 440,
  margin: { top: 18, right: 24, bottom: 48, left: 66 },
  xLabel: 'Stock return', yLabel: 'Return on equity',
  xFmt: pct, yFmt: pct,
});

/** All Section-2 quantities (decimals), straight from lib/finmath.js. */
function shortModel() {
  const n = Math.max(1, Number(S.sn) || 0);
  const p0 = Math.max(0.01, Number(S.sp0) || 0);
  const im = Number(S.sim) / 100;
  const mm = Number(S.smm) / 100;
  const p1 = Number(S.sp1);
  const c0 = shortCashRequired(n, p0, im);          // deck: $2,500
  const assets = c0 + n * p0;                       // cash + sale proceeds, FIXED
  const callP = shortMarginCallPrice(c0, n, p0, mm); // deck: $57.69
  const owed = n * p1;                              // liability: shares owed at market
  const equity = assets - owed;                     // deck at 53: $2,200
  const ret = shortReturn(c0, n, p0, p1);           // deck: −12%
  const mRate = shortMarginRate(c0, n, p0, p1);
  const M = -1 / im;                                // deck: −2.0
  const rStock = p1 / p0 - 1;
  const rCall = callP / p0 - 1;
  const call = p1 > callP + 1e-9;
  const reqEq = mm * owed;
  const shortfall = reqEq - equity;
  /** Return on equity at a given stock return (the short levered line). */
  const lev = (R) => shortReturn(c0, n, p0, p0 * (1 + R));
  return {
    n, p0, im, mm, p1, c0, assets, callP, owed, equity, ret, mRate, M,
    rStock, rCall, call, reqEq, shortfall, lev,
  };
}

/* ---- chart A: the account, mirrored (fixed assets, growing liability) ----- */
let shortBarKey = '';
function drawShortBar(m) {
  const yHi = Math.max(m.assets, m.n * SP1_MAX) * 1.06;
  const key = yHi.toFixed(2);
  if (key !== shortBarKey) {
    shortBarKey = key;
    shortBar.setDomain(0, 1, 0, yHi)
      .renderAxes({ xTicks: [], yTicks: niceTicks(0, yHi, 6) });
  }
  shortBar.clearData();
  priceScale(shortBar, m.n);

  const bx = 0.42, hw = 0.17;
  // gold = shares owed (grows UPWARD as the price rises), blue = equity on top
  bar(shortBar, bx, 0, m.owed, hw, 'var(--gold)', 0.92);
  if (m.equity > 0) bar(shortBar, bx, m.owed, m.assets, hw, 'var(--blue)', 0.92);
  segLabel(shortBar, bx, 0, m.owed, 'Owed', usd0(m.owed));
  if (m.equity > 0) segLabel(shortBar, bx, m.owed, m.assets, 'Equity', usd0(m.equity));

  // fixed assets line (NAVY): margin cash + sale proceeds
  shortBar.hline(m.assets, { stroke: 'var(--navy)', width: 2 });
  shortBar.text(0.02, m.assets, `assets ${usd0(m.assets)}`, { dy: -6, fill: 'var(--navy)' });

  // margin-call price (RED dashed) — ABOVE the current price: danger is up
  const callLevel = m.callP * m.n;
  if (callLevel < shortBar.yHi) {
    shortBar.hline(callLevel, { stroke: 'var(--red)', dash: '6 4', width: 1.8 });
    shortBar.text(0.02, callLevel, `margin call  P = ${usd2(m.callP)}`,
      { dy: 14, fill: 'var(--red)' });
  }

  // moving liability edge = the buy-back cost at P₁
  shortBar.text(bx + hw, m.owed, `P_1 = ${usdSmart(m.p1)}`,
    { dx: 7, dy: 4, fill: 'var(--navy)' });
}

/* ---- chart B: the mirrored magnification line ----------------------------- */
let shortMagKey = '';
function drawShortMag(m) {
  const ys = [m.lev(R_LO), m.lev(R_HI), R_LO, R_HI];
  let yLo = Math.min(...ys), yHi = Math.max(...ys);
  const pad = Math.max(0.02, (yHi - yLo) * 0.07);
  yLo -= pad; yHi += pad;
  const key = `${yLo.toFixed(3)}|${yHi.toFixed(3)}`;
  if (key !== shortMagKey) {
    shortMagKey = key;
    shortMag.setDomain(R_LO, R_HI, yLo, yHi)
      .renderAxes({ xTicks: [-0.5, -0.25, 0, 0.25, 0.5], yTicks: niceTicks(yLo, yHi, 7) });
  }
  shortMag.clearData();

  // margin-call region: stock returns ABOVE R_call (price over the trigger)
  if (m.rCall < R_HI) {
    const x1 = Math.max(m.rCall, R_LO);
    filled(shortMag, [
      { x: x1, y: yLo }, { x: x1, y: yHi }, { x: R_HI, y: yHi }, { x: R_HI, y: yLo },
    ], 'var(--red)', 0.06);
    if (m.rCall >= R_LO) {
      shortMag.vline(m.rCall, { stroke: 'var(--red)', dash: '6 4', width: 1.6 });
      shortMag.text(m.rCall, yHi, 'margin call', {
        dx: m.rCall > 0.22 ? -6 : 6, dy: 14,
        anchor: m.rCall > 0.22 ? 'end' : 'start', fill: 'var(--red)',
      });
    }
  }

  // long-unlevered 45° reference for contrast, then the short line (BLUE)
  shortMag.path([{ x: R_LO, y: R_LO }, { x: R_HI, y: R_HI }],
    { stroke: 'var(--axis)', dash: '6 4', width: 1.8, opacity: 0.85 });
  shortMag.text(R_HI, R_HI, 'long, unlevered', { dx: -6, dy: 14, anchor: 'end', fill: 'var(--muted)' });
  shortMag.path([{ x: R_LO, y: m.lev(R_LO) }, { x: R_HI, y: m.lev(R_HI) }],
    { stroke: 'var(--blue)', width: 2.6 });
  shortMag.text(R_LO, m.lev(R_LO), `short, slope −${Math.abs(m.M).toFixed(2)}`,
    { dx: 6, dy: -8, anchor: 'start', fill: 'var(--blue)' });

  // deck anchor scenario: the stock rises 6% (defaults: −12%)
  {
    const R = 0.06;
    const y = m.lev(R);
    shortMag.point(R, y, { shape: 'diamond', r: 5.5, fill: 'var(--navy)' });
    shortMag.text(R, y, signedPct(y), { dx: 9, dy: 14, anchor: 'start', fill: 'var(--navy)' });
  }

  // the current P₁-implied point (GOLD)
  if (m.rStock >= R_LO - 1e-9 && m.rStock <= R_HI + 1e-9) {
    shortMag.point(m.rStock, m.ret, { r: 6, fill: 'var(--gold)', stroke: '#fff' });
    shortMag.text(m.rStock, m.ret, `current ${signedPct(m.ret)}`,
      { dx: -10, dy: -10, anchor: 'end', fill: 'var(--gold)' });
  }
}

/* ---- readouts / formulas / status ----------------------------------------- */
function drawShortReadouts(m) {
  el('short-readouts').replaceChildren(
    readout('Required cash $C_0$', usdSmart(m.c0), 'blue'),
    readout('Margin-call price', usd2(m.callP), 'red'),
    readout('Equity at $P_1$', usdSmart(m.equity), ''),
    readout('Return on equity', signedPct(m.ret), m.ret < 0 ? 'red' : 'blue'),
    readout('Magnification $-1/\\text{margin}$', `−${Math.abs(m.M).toFixed(2)}×`, ''),
  );
  mcStrip(el('short-mc'), m, Number(S.smm));
}

function drawShortFormulas(m) {
  renderTeX(el('short-f1'),
    `\\text{Margin Rate} \\;=\\; \\frac{\\textcolor{#0072B2}{C_0 + N P_0 - N P}}` +
    `{\\textcolor{#C99700}{N P}}` +
    ` \\;=\\; \\frac{${texUsd(m.c0)} + ${texUsd(m.n * m.p0)} - ${texUsd(m.owed)}}` +
    `{${texUsd(m.owed)}}` +
    ` \\;=\\; ${(m.mRate * 100).toFixed(1)}\\%`);
  renderTeX(el('short-f2'),
    `R \\;=\\; -R_{\\text{stock}} \\times \\frac{1}{\\text{margin}}` +
    ` \\;=\\; (${signedPctTeX(-m.rStock, 1)}) \\times \\frac{1}{${m.im.toFixed(2)}}` +
    ` \\;=\\; ${signedPctTeX(m.ret, 2)}`);
}

function renderShort() {
  const m = shortModel();
  drawShortBar(m);
  drawShortMag(m);
  drawShortReadouts(m);
  drawShortFormulas(m);
}

/* ---- controls -------------------------------------------------------------- */
el('short-position').append(
  numberInput({
    label: 'Shares shorted $N$', min: 1, max: 100000, step: 1, value: Number(S.sn),
    onChange: (v) => { store.set('sn', v); renderShort(); },
  }),
  numberInput({
    label: 'Sale price $P_0$', min: 1, max: 10000, step: 1, value: Number(S.sp0),
    onChange: (v) => { store.set('sp0', v); renderShort(); },
  }),
);
el('short-margin').append(
  slider({
    label: 'Initial margin', min: 50, max: 100, step: 1, value: Number(S.sim),
    fmt: (v) => `${v.toFixed(0)}%`,
    onChange: (v) => { store.set('sim', v); renderShort(); },
  }),
  slider({
    label: 'Maintenance margin', min: 25, max: 50, step: 1, value: Number(S.smm),
    fmt: (v) => `${v.toFixed(0)}%`,
    onChange: (v) => { store.set('smm', v); renderShort(); },
  }),
);
el('short-scenario').append(
  slider({
    label: 'Current price $P_1$', min: SP1_MIN, max: SP1_MAX, step: 1, value: Number(S.sp1),
    fmt: (v) => usdSmart(v),
    onChange: (v) => { store.set('sp1', v); renderShort(); },
  }),
);

/* ---- initial render (MathJax load-order handled inside renderTeX) --------- */
renderLong();
renderShort();
