// @ts-check
/**
 * Option strategies explorer (FIN 30600, Topic 8 §2 "Combinations of Options").
 *
 * Payoff and profit at expiration for combinations of calls, puts, stock and
 * a zero-coupon bond. The four deck presets carry the deck's own numbers
 * (content/sec2_combinations.tex) and reproduce its tables row for row:
 *   covered call   stock $30, write C(40) at $5       cost 25, BE 25
 *   protective put stock $30, buy P(20) at $5          cost 35, BE 35
 *   straddle       C(30) + P(30), $5 each              cost 10, BE 20 / 40
 *   bull spread    +C(20) at $7, −C(30) at $4          cost 3,  BE 23
 * The BKM §15.3 presets (collar, strip, strap, bear spread, strangle,
 * butterfly, iron condor) use round illustrative premiums; the collar uses
 * BKM Example 15.5's strikes ($60 put, $80 call on a $70 stock).
 *
 * Optional Black–Scholes pricing replaces the typed premiums with model
 * prices at S_0, σ, r, T and adds the position's value today (profit if
 * closed now), the smooth curve that converges to the kinked payoff at T.
 *
 * All finance math lives in ../../lib/finmath.js (strategy* + bs*).
 */

import { Chart, LabelPlacer, estimateTextWidth, svgMathText } from '../../lib/chart.js';
import {
  bsCall, bsPut, strategyPayoff, strategyStats, strategyValueBS,
} from '../../lib/finmath.js';
import { slider, toggle, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('option-strategies');

hydrateLabels();

/* ---------------------------------------------------------------- presets -- */
/**
 * Leg codes: k = c (call) | p (put) | s (stock) | b (bond) ; q = signed
 * quantity ; x = strike / face ; p = price paid per unit.
 * @typedef {{k:string, q:number, x:number, p:number}} RawLeg
 * @typedef {{key:string, group:string, name:string, blurb:string, s0:number,
 *   xh:number, legs:RawLeg[]}} Preset
 */
/** @type {Preset[]} */
const PRESETS = [
  {
    key: 'covered', group: 'deck', name: 'Covered call', s0: 30, xh: 60,
    blurb: 'Write a call and buy a share of the stock. The obligation to deliver the stock if the '
      + 'call is exercised is covered by the share you hold. You earn the call premium but give up '
      + 'any gain above the strike. Deck Example 1: stock at $30, call with X = $40 at $5.',
    legs: [{ k: 's', q: 1, x: 30, p: 30 }, { k: 'c', q: -1, x: 40, p: 5 }],
  },
  {
    key: 'protective', group: 'deck', name: 'Protective put', s0: 30, xh: 60,
    blurb: 'Buy a put and buy a share of the stock. The put sets a floor: you can always sell the '
      + 'share at the strike. The price of that insurance is the put premium. Deck Example 2: '
      + 'stock at $30, put with X = $20 at $5.',
    legs: [{ k: 's', q: 1, x: 30, p: 30 }, { k: 'p', q: 1, x: 20, p: 5 }],
  },
  {
    key: 'straddle', group: 'deck', name: 'Straddle', s0: 30, xh: 60,
    blurb: 'Buy a call and a put with the same strike and expiration. The position profits from a '
      + 'large price change in either direction, so it is a bet on volatility. Deck Example 3: '
      + 'X = $30, C = P = $5.',
    legs: [{ k: 'c', q: 1, x: 30, p: 5 }, { k: 'p', q: 1, x: 30, p: 5 }],
  },
  {
    key: 'bull', group: 'deck', name: 'Bull spread', s0: 30, xh: 60,
    blurb: 'Buy a call with a low strike and write a call with a higher strike. The written call '
      + 'gives up the upside above the higher strike and pays for part of the bought call. Deck '
      + 'Example 4: buy X = $20 at $7, write X = $30 at $4.',
    legs: [{ k: 'c', q: 1, x: 20, p: 7 }, { k: 'c', q: -1, x: 30, p: 4 }],
  },
  {
    key: 'collar', group: 'book', name: 'Collar', s0: 70, xh: 120,
    blurb: 'Hold the stock, buy a put and write a call. The value of the position stays between the '
      + 'put strike and the call strike. When the two premiums are equal, the options cost nothing '
      + 'net. Strikes from BKM Example 15.5: $60 put and $80 call on a $70 stock (premiums '
      + 'illustrative).',
    legs: [{ k: 's', q: 1, x: 70, p: 70 }, { k: 'p', q: 1, x: 60, p: 3 }, { k: 'c', q: -1, x: 80, p: 3 }],
  },
  {
    key: 'strip', group: 'book', name: 'Strip', s0: 30, xh: 60,
    blurb: 'Two puts and one call with the same strike and expiration: a straddle that pays more if '
      + 'the price falls than if it rises (BKM §15.3). Premiums as in the deck straddle.',
    legs: [{ k: 'p', q: 2, x: 30, p: 5 }, { k: 'c', q: 1, x: 30, p: 5 }],
  },
  {
    key: 'strap', group: 'book', name: 'Strap', s0: 30, xh: 60,
    blurb: 'Two calls and one put with the same strike and expiration: a straddle that pays more if '
      + 'the price rises than if it falls (BKM §15.3). Premiums as in the deck straddle.',
    legs: [{ k: 'c', q: 2, x: 30, p: 5 }, { k: 'p', q: 1, x: 30, p: 5 }],
  },
  {
    key: 'bear', group: 'book', name: 'Bear spread', s0: 30, xh: 60,
    blurb: 'Buy a put with a high strike and write a put with a lower strike. The position profits '
      + 'if the price falls, and the gain is capped at the lower strike. Premiums illustrative.',
    legs: [{ k: 'p', q: 1, x: 30, p: 5 }, { k: 'p', q: -1, x: 20, p: 1 }],
  },
  {
    key: 'strangle', group: 'book', name: 'Strangle', s0: 30, xh: 60,
    blurb: 'Buy a put and a call with different strikes. It costs less than a straddle, but the '
      + 'price must move further before the position makes money. Premiums illustrative.',
    legs: [{ k: 'p', q: 1, x: 25, p: 3 }, { k: 'c', q: 1, x: 35, p: 3 }],
  },
  {
    key: 'butterfly', group: 'book', name: 'Butterfly', s0: 30, xh: 60,
    blurb: 'Buy one call with a low strike and one with a high strike, and write two calls with the '
      + 'middle strike. The position profits if the price stays near the middle strike '
      + '(Homework 8). Premiums illustrative.',
    legs: [{ k: 'c', q: 1, x: 20, p: 11 }, { k: 'c', q: -2, x: 30, p: 5 }, { k: 'c', q: 1, x: 40, p: 2 }],
  },
  {
    key: 'condor', group: 'book', name: 'Iron condor', s0: 30, xh: 60,
    blurb: 'Write a put and a call around the current price and buy a put and a call further out. '
      + 'The position collects a premium if the price stays in a range; the bought options cap the '
      + 'loss. The strategy in the Additional Readings story on "Captain Condor". Premiums '
      + 'illustrative.',
    legs: [
      { k: 'p', q: 1, x: 20, p: 1 }, { k: 'p', q: -1, x: 25, p: 2 },
      { k: 'c', q: -1, x: 35, p: 2 }, { k: 'c', q: 1, x: 40, p: 1 },
    ],
  },
  {
    key: 'lcall', group: 'single', name: 'Long call', s0: 30, xh: 60,
    blurb: 'Buy a call: the right to buy the stock at the strike. The loss is limited to the premium.',
    legs: [{ k: 'c', q: 1, x: 30, p: 5 }],
  },
  {
    key: 'scall', group: 'single', name: 'Short call', s0: 30, xh: 60,
    blurb: 'Write a call: collect the premium and take on the obligation to sell at the strike. '
      + 'The loss has no upper limit.',
    legs: [{ k: 'c', q: -1, x: 30, p: 5 }],
  },
  {
    key: 'lput', group: 'single', name: 'Long put', s0: 30, xh: 60,
    blurb: 'Buy a put: the right to sell the stock at the strike. The loss is limited to the premium.',
    legs: [{ k: 'p', q: 1, x: 30, p: 5 }],
  },
  {
    key: 'sput', group: 'single', name: 'Short put', s0: 30, xh: 60,
    blurb: 'Write a put: collect the premium and take on the obligation to buy at the strike. The '
      + 'largest loss occurs if the stock becomes worthless.',
    legs: [{ k: 'p', q: -1, x: 30, p: 5 }],
  },
];
const PRESET_BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
const MAX_LEGS = 4;
const KINDS = { c: 'call', p: 'put', s: 'stock', b: 'bond' };

/* ----------------------------------------------------------------- state -- */
/** @type {Record<string, number|boolean|string>} */
const defaults = {
  st: 'covered', // preset key, or 'custom'
  bs: false,     // price the options with Black–Scholes
  s: 30,         // S_0 for Black–Scholes pricing ($)
  v: 30,         // σ (whole %)
  r: 5,          // r (whole %, continuous)
  t: 0.25,       // T (years)
  xh: 60,        // S_T axis upper end ($)
  lg: true,      // draw each position's profit line
};
for (let i = 1; i <= MAX_LEGS; i++) {
  const leg = PRESETS[0].legs[i - 1];
  defaults[`k${i}`] = leg ? leg.k : 'n';
  defaults[`q${i}`] = leg ? leg.q : 1;
  defaults[`x${i}`] = leg ? leg.x : 30;
  defaults[`p${i}`] = leg ? leg.p : 5;
}
// Numeric ranges mirror the controls; hash values clamp to these (state.js).
/** @type {Record<string, [number, number]>} */
const BOUNDS = { s: [5, 300], v: [5, 80], r: [0, 12], t: [0.02, 2], xh: [20, 400] };
for (let i = 1; i <= MAX_LEGS; i++) {
  BOUNDS[`q${i}`] = [-3, 3];
  BOUNDS[`x${i}`] = [0, 300];
  BOUNDS[`p${i}`] = [0, 300];
}
const store = bindState(defaults, () => {}, { debounce: 150, bounds: BOUNDS });
const S = store.state;
if (S.st !== 'custom' && !(String(S.st) in PRESET_BY_KEY)) store.set('st', 'custom');

/* --------------------------------------------------------------- helpers -- */
/** Model inputs as finmath decimals. */
function model() {
  return {
    bs: Boolean(S.bs),
    s: Number(S.s),
    sig: Number(S.v) / 100,
    r: Number(S.r) / 100,
    t: Number(S.t),
  };
}

/** Raw legs from the state, sanitized (bad kinds dropped, q a nonzero integer). */
function rawLegs() {
  /** @type {(RawLeg & {i:number})[]} */
  const out = [];
  for (let i = 1; i <= MAX_LEGS; i++) {
    const k = String(S[`k${i}`]);
    if (!(k in KINDS)) continue;
    const q = Math.round(Number(S[`q${i}`])) || 1;
    out.push({ i, k, q, x: Number(S[`x${i}`]), p: Number(S[`p${i}`]) });
  }
  return out;
}

/** Price of one unit of a leg: typed, or Black–Scholes at S_0. */
function legPrice(leg, m) {
  if (!m.bs) return leg.p;
  if (leg.k === 'c') return bsCall(m.s, leg.x, m.sig, m.r, m.t);
  if (leg.k === 'p') return bsPut(m.s, leg.x, m.sig, m.r, m.t);
  if (leg.k === 's') return m.s;
  return leg.x * Math.exp(-m.r * m.t); // bond paying X at T
}

/** finmath legs (kind/q/x/price) with prices resolved. */
function finLegs(raw, m) {
  return raw.map((l) => ({
    kind: /** @type {'call'|'put'|'stock'|'bond'} */ (KINDS[l.k]),
    q: l.q,
    x: l.x,
    price: legPrice(l, m),
  }));
}

const MINUS = '−';
/** "25", "2.50", "−3" — whole numbers without decimals, else 2 decimals. */
function num(v) {
  const r = Math.round(v);
  const s = Math.abs(v - r) < 1e-9 ? String(Math.abs(r)) : Math.abs(v).toFixed(2);
  return v < -1e-9 ? `${MINUS}${s}` : s;
}
/** "$25", "−$3". */
function money(v) {
  return v < -1e-9 ? `${MINUS}$${num(-v)}` : `$${num(v)}`;
}

/** Short name of a leg: "−C(40)", "+2P(30)", "+S", "+B(50)". */
function legName(l) {
  const sign = l.q < 0 ? MINUS : '+';
  const n = Math.abs(l.q) === 1 ? '' : String(Math.abs(l.q));
  if (l.k === 's') return `${sign}${n}S`;
  const letter = l.k === 'c' ? 'C' : l.k === 'p' ? 'P' : 'B';
  return `${sign}${n}${letter}(${num(l.x)})`;
}

/** TeX term list joined with signs; first term loses its "+". */
function texSum(terms) {
  return terms.map(([sign, body], i) => (i === 0 ? (sign === '-' ? '-' : '') : ` ${sign} `) + body)
    .join('') || '0';
}

/** Nice step for the payoff table: ≈ 6–8 rows from 0 to xh. */
function tableStep(xh) {
  for (const c of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) if (xh / c <= 8) return c;
  return 100;
}

/** {x, y} samples of f over [lo, hi], with the kinks inserted exactly. */
function sample(f, lo, hi, kinks, n = 240) {
  const xs = new Set();
  for (let i = 0; i <= n; i++) xs.add(lo + ((hi - lo) * i) / n);
  for (const k of kinks) if (k > lo && k < hi) xs.add(k);
  return [...xs].sort((a, b) => a - b).map((x) => ({ x, y: f(x) }));
}

/** Round the axis end up to a multiple of 10 (or 20 above 200). */
function ceilAxis(v) {
  const step = v > 200 ? 20 : 10;
  return Math.ceil(v / step) * step;
}

/* ---------------------------------------------------------------- chart -- */
const chart = new Chart(/** @type {HTMLElement} */ (document.getElementById('main-chart')), {
  width: 760,
  height: 460,
  xLabel: 'Stock Price at Expiration S_T',
  yLabel: 'Payoff and Profit',
  xFmt: (v) => `$${Math.round(v)}`,
  yFmt: (v) => money(v),
});

/** Axis titles are plain text in chart.js; re-render so S_T gets a subscript. */
function fixAxisTitleMath() {
  for (const sel of ['.axis-title-x', '.axis-title-y']) {
    const node = chart.axisGroup.querySelector(sel);
    if (node) svgMathText(/** @type {SVGTextElement} */ (node), node.textContent || '');
  }
}

let axisSig = '';
function drawChart(raw, legs, stats, m) {
  const xh = Number(S.xh);
  const strikes = [...new Set(raw.filter((l) => l.k === 'c' || l.k === 'p').map((l) => l.x))]
    .filter((x) => x > 0 && x < xh)
    .sort((a, b) => a - b);
  const profit = sample((s) => strategyPayoff(legs, s) - stats.cost, 0, xh, strikes);
  const payoff = sample((s) => strategyPayoff(legs, s), 0, xh, strikes);
  const legLines = legs.map((l) => sample(
    (s) => strategyPayoff([l], s) - l.q * l.price, 0, xh, strikes, 60,
  ));
  const today = m.bs
    ? sample((s) => strategyValueBS(legs, Math.max(s, 1e-6), m.sig, m.r, m.t) - stats.cost, 0, xh, [], 160)
    : null;

  const ys = [0, ...profit.map((d) => d.y), ...payoff.map((d) => d.y)];
  if (S.lg) for (const L of legLines) ys.push(...L.map((d) => d.y));
  if (today) ys.push(...today.map((d) => d.y));
  let yLo = Math.min(...ys), yHi = Math.max(...ys);
  const pad = Math.max(0.08 * (yHi - yLo), 1);
  yLo -= pad; yHi += pad;

  const sig = `${xh}|${yLo.toFixed(3)}|${yHi.toFixed(3)}`;
  if (sig !== axisSig) {
    chart.setDomain(0, xh, yLo, yHi).renderAxes();
    fixAxisTitleMath();
    axisSig = sig;
  }
  chart.clearData();
  const ts = chart.textScale;
  // fontPx is given BEFORE --stroke-scale (1.5 here): 10 → 15px on screen,
  // the same size as the .datalabel text this page pins (see index.html)
  const placer = new LabelPlacer(chart, { fontPx: 10 });
  const fpx = 15 * ts;

  // zero line and strike markers; strike labels stagger onto a second row
  // when they would touch, and are registered as obstacles for the placer
  chart.hline(0, { stroke: 'var(--axis)', width: 1.2, opacity: 0.8 });
  let lastRight = -Infinity, row = 0;
  for (const x of strikes) {
    chart.vline(x, { stroke: 'var(--axis)', dash: '2 4', width: 1, opacity: 0.5 });
    const str = `X = ${num(x)}`;
    const tx = chart.sx(x) + 4 * ts;
    row = tx < lastRight + 6 * ts ? 1 - row : 0;
    const ty = chart.sy(yHi) + (13 + row * 17) * ts;
    const w = estimateTextWidth(str, fpx);
    if (row === 0 || tx >= lastRight) lastRight = tx + w;
    else lastRight = Math.max(lastRight, tx + w);
    chart.text(x, yHi, str, { dx: 4 * ts, dy: (13 + row * 17) * ts, fill: 'var(--muted)' });
    placer.boxes.push([tx - 2, ty - 0.8 * fpx - 2, tx + w + 2, ty + 0.25 * fpx + 2]);
  }

  // each position's own profit line (thin, grey, dotted)
  if (S.lg && legs.length > 1) {
    legLines.forEach((L) => {
      chart.path(L, { stroke: 'var(--muted)', width: 1.4, dash: '2 4', opacity: 0.9 });
      placer.avoidPath(L);
    });
  }
  chart.path(payoff, { stroke: 'var(--gold)', width: 2.6, dash: '8 5' });
  if (today) chart.path(today, { stroke: 'var(--navy)', width: 2.2 });
  chart.path(profit, { stroke: 'var(--blue)', width: 3.2 });
  placer.avoidPath(profit).avoidPath(payoff);
  if (today) placer.avoidPath(today);

  // leg labels at the right edge (dropped on phones, where they crowd the
  // plot; the positions table and legend name the lines there)
  if (S.lg && legs.length > 1 && ts <= 1.25) {
    raw.forEach((l, j) => {
      const L = legLines[j];
      const end = L[L.length - 1];
      placer.label(end.x, end.y, legName(l), { r: 2, prefer: ['ul', 'll', 'l'], fill: 'var(--muted)' });
    });
  }

  // break-even points on the zero line
  for (const be of stats.breakevens) {
    if (be < 0 || be > xh) continue;
    const own = placer.avoidPoint(be, 0, 5.5);
    chart.point(be, 0, { r: 5.5, fill: 'var(--blue)', stroke: '#fff' });
    placer.label(be, 0, `BE ${num(be)}`, { r: 5.5, own, prefer: ['lr', 'll', 'ur', 'ul'], fill: 'var(--navy)' });
  }

  // current price marker (Black–Scholes mode)
  if (today && m.s <= xh) {
    chart.vline(m.s, { stroke: 'var(--navy)', dash: '3 3', width: 1, opacity: 0.6 });
    placer.label(m.s, yLo, `S_0 = ${num(m.s)}`, { r: 1, prefer: ['ur', 'ul'], fill: 'var(--navy)' });
  }
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(stats) {
  const cost = stats.cost;
  const be = stats.zeroRange
    ? `${money(stats.zeroRange[0])} to ${Number.isFinite(stats.zeroRange[1]) ? money(stats.zeroRange[1]) : '∞'}`
    : stats.breakevens.length ? stats.breakevens.map(money).join(', ') : 'none';
  const rows = [
    [cost >= 0 ? 'Cost to enter' : 'Cost to enter (net credit)', money(cost), ''],
    ['Max profit', stats.maxProfit === Infinity ? 'unlimited' : money(stats.maxProfit), 'blue'],
    ['Max loss', stats.minProfit === -Infinity ? 'unlimited'
      : stats.minProfit >= 0 ? 'none' : money(-stats.minProfit), 'blue'],
    [stats.breakevens.length > 1 ? 'Break-evens $S_T$' : 'Break-even $S_T$', be, ''],
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

function drawFormulas(raw, legs, stats) {
  // position and cost to enter
  const posTerms = raw.map((l) => {
    const n = Math.abs(l.q) === 1 ? '' : String(Math.abs(l.q));
    const body = l.k === 's' ? `${n}S_0`
      : `${n}${l.k === 'c' ? 'C' : l.k === 'p' ? 'P' : 'B'}(${num(l.x)})`;
    return [l.q < 0 ? '-' : '+', body];
  });
  const costTerms = legs.map((l) => {
    const n = Math.abs(l.q) === 1 ? '' : `${Math.abs(l.q)}\\times `;
    return [l.q < 0 ? '-' : '+', `${n}${num(l.price).replace(MINUS, '-')}`];
  });
  const cost = num(stats.cost).replace(MINUS, '-');
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('f-position')),
    `\\text{Cost to enter} = ${texSum(posTerms)} = ${texSum(costTerms)} = ${BLUE}{\\mathbf{${cost}}}`);

  // payoff and profit as functions of S_T
  const payTerms = raw.map((l) => {
    const n = Math.abs(l.q) === 1 ? '' : String(Math.abs(l.q));
    const x = num(l.x);
    const body = l.k === 's' ? `${n}S_T`
      : l.k === 'c' ? `${n}\\max(S_T - ${x},\\, 0)`
        : l.k === 'p' ? `${n}\\max(${x} - S_T,\\, 0)`
          : `${n ? `${n}\\times ` : ''}${x}`;
    return [l.q < 0 ? '-' : '+', body];
  });
  const costSign = stats.cost < 0 ? '+' : '-';
  renderTeX(/** @type {HTMLElement} */ (document.getElementById('f-payoff')),
    `\\text{Payoff} = ${texSum(payTerms)}, \\qquad \\text{Profit} = \\text{Payoff} ${costSign} ${num(Math.abs(stats.cost))}`);
}

/* ---------------------------------------------------------- payoff table -- */
function drawTable(raw, legs, stats) {
  const xh = Number(S.xh);
  const step = tableStep(xh);
  const table = /** @type {HTMLTableElement} */ (document.getElementById('payoff-table'));
  table.replaceChildren();
  const thead = table.createTHead();
  const hr = thead.insertRow();
  const th = (text, cls = '') => {
    const c = document.createElement('th');
    if (cls) c.className = cls;
    renderLabel(c, text);
    hr.appendChild(c);
  };
  th('$S_T$');
  for (const l of raw) th(legName(l));
  th('Total payoff', 'total');
  th('Profit', 'total');
  const tb = table.createTBody();
  for (let s = 0; s <= xh + 1e-9; s += step) {
    const tr = tb.insertRow();
    const td = (text, cls = '') => {
      const c = tr.insertCell();
      c.textContent = text;
      if (cls) c.className = cls;
    };
    td(num(s));
    for (const l of legs) td(num(strategyPayoff([l], s)));
    const pay = strategyPayoff(legs, s);
    td(num(pay), 'payoff');
    td(num(pay - stats.cost), 'profit');
  }
}

/* ----------------------------------------------------------- leg editor -- */
const legsBody = /** @type {HTMLElement} */ (document.getElementById('legs-body'));
const addBtn = /** @type {HTMLButtonElement} */ (document.getElementById('add-leg'));
/** @type {Record<number, HTMLInputElement>} price inputs, so BS mode can refresh them */
let priceInputs = {};

/** Edits switch the menu to "custom". */
function markCustom() {
  if (S.st !== 'custom') {
    store.set('st', 'custom');
    syncPresetUi();
  }
}

function makeSelect(options, value, onChange) {
  const sel = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeNumber(value, { min, max, step, cls = '' }, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = String(value);
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.inputMode = 'decimal';
  if (cls) inp.className = cls;
  const fire = () => {
    if (inp.value.trim() === '') return;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    onChange(Math.min(max, Math.max(min, v)));
  };
  inp.addEventListener('input', fire);
  inp.addEventListener('change', () => { fire(); inp.value = String(S[inp.dataset.key ?? ''] ?? inp.value); });
  return inp;
}

/** Rebuild the leg editor from the state (on load, preset, add, remove). */
function buildEditor() {
  legsBody.replaceChildren();
  priceInputs = {};
  const raw = rawLegs();
  for (const l of raw) {
    const i = l.i;
    const tr = document.createElement('tr');
    const cell = (node) => { const td = document.createElement('td'); if (node) td.appendChild(node); tr.appendChild(td); return td; };

    cell(makeSelect([['1', 'Long'], ['-1', 'Short']], l.q < 0 ? '-1' : '1', (v) => {
      store.set(`q${i}`, Number(v) * Math.abs(Number(S[`q${i}`]) || 1));
      markCustom(); renderAll();
    }));
    const qty = makeNumber(Math.abs(l.q), { min: 1, max: 3, step: 1, cls: 'qty' }, (v) => {
      const sign = Number(S[`q${i}`]) < 0 ? -1 : 1;
      store.set(`q${i}`, sign * Math.max(1, Math.round(v)));
      markCustom(); renderAll();
    });
    qty.setAttribute('aria-label', `Quantity, position ${i}`);
    cell(qty);
    cell(makeSelect([['c', 'Call'], ['p', 'Put'], ['s', 'Stock'], ['b', 'Bond']], l.k, (v) => {
      store.set(`k${i}`, v);
      markCustom(); buildEditor(); renderAll();
    }));
    if (l.k === 's') {
      const td = cell(null);
      td.className = 'na';
      td.textContent = '—';
    } else {
      const x = makeNumber(l.x, { min: 0, max: 300, step: 1 }, (v) => {
        store.set(`x${i}`, v); markCustom(); renderAll();
      });
      x.dataset.key = `x${i}`;
      x.setAttribute('aria-label', `${l.k === 'b' ? 'Face value' : 'Strike'}, position ${i}`);
      cell(x);
    }
    const p = makeNumber(l.p, { min: 0, max: 300, step: 0.5 }, (v) => {
      store.set(`p${i}`, v); markCustom(); renderAll();
    });
    p.dataset.key = `p${i}`;
    p.setAttribute('aria-label', `Price, position ${i}`);
    priceInputs[i] = p;
    cell(p);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.textContent = '×';
    rm.title = 'Remove this position';
    rm.setAttribute('aria-label', `Remove position ${i}`);
    rm.disabled = raw.length <= 1;
    rm.addEventListener('click', () => removeLeg(i));
    cell(rm);
    legsBody.appendChild(tr);
  }
  addBtn.disabled = raw.length >= MAX_LEGS;
}

/** Compact the legs after a removal so slots 1..n stay filled in order. */
function removeLeg(i) {
  const kept = rawLegs().filter((l) => l.i !== i);
  writeLegs(kept);
  markCustom(); buildEditor(); renderAll();
}

function writeLegs(legs) {
  /** @type {Record<string, number|string>} */
  const patch = {};
  for (let j = 1; j <= MAX_LEGS; j++) {
    const l = legs[j - 1];
    patch[`k${j}`] = l ? l.k : 'n';
    patch[`q${j}`] = l ? l.q : 1;
    patch[`x${j}`] = l ? l.x : 30;
    patch[`p${j}`] = l ? l.p : 5;
  }
  store.patch(patch);
}

addBtn.addEventListener('click', () => {
  const legs = rawLegs();
  if (legs.length >= MAX_LEGS) return;
  const x = Math.round(Number(S.xh) / 2);
  legs.push({ i: 0, k: 'c', q: 1, x, p: 5 });
  writeLegs(legs);
  markCustom(); buildEditor(); renderAll();
});

/** In Black–Scholes mode the price boxes show model prices and lock. */
function syncPriceInputs(raw, m) {
  for (const l of raw) {
    const inp = priceInputs[l.i];
    if (!inp) continue;
    inp.disabled = m.bs;
    if (m.bs) inp.value = legPrice(l, m).toFixed(2);
    else if (document.activeElement !== inp) inp.value = String(l.p);
  }
}

/* ---------------------------------------------------------- strategy menu -- */
/** @type {Record<string, HTMLButtonElement>} */
const presetBtns = {};
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = p.name;
  b.addEventListener('click', () => loadPreset(p.key));
  presetBtns[p.key] = b;
  const host = document.getElementById(`presets-${p.group}`);
  if (host) host.appendChild(b);
}

function loadPreset(key) {
  const p = PRESET_BY_KEY[key];
  if (!p) return;
  writeLegs(p.legs.map((l) => ({ ...l, i: 0 })));
  store.patch({ st: key, xh: p.xh, s: p.s0 });
  xhCtrl.set(p.xh);
  sCtrl.set(p.s0);
  syncPresetUi();
  buildEditor();
  renderAll();
}

function syncPresetUi() {
  const st = String(S.st);
  for (const [k, b] of Object.entries(presetBtns)) b.classList.toggle('active', k === st);
  /** @type {HTMLElement} */ (document.getElementById('custom-flag')).hidden = st !== 'custom';
  const p = PRESET_BY_KEY[st];
  /** @type {HTMLElement} */ (document.getElementById('strategy-name')).textContent = p ? p.name : 'Custom position';
  /** @type {HTMLElement} */ (document.getElementById('strategy-blurb')).textContent = p ? p.blurb
    : 'Your own combination. Edit the positions below; pick a strategy on the left to start over.';
}

/* --------------------------------------------------------------- controls -- */
const bsCtrl = toggle({
  label: 'Price the options with Black–Scholes',
  value: Boolean(S.bs),
  onChange: (v) => { store.set('bs', v); renderAll(); },
});
const sCtrl = slider({
  label: 'Stock price today $S_0$', min: 5, max: 300, step: 1, value: Number(S.s),
  fmt: (v) => `$${Math.round(v)}`,
  onChange: (v) => { store.set('s', v); renderAll(); },
});
const vCtrl = slider({
  label: 'Volatility $\\sigma$', min: 5, max: 80, step: 1, value: Number(S.v),
  fmt: (v) => `${Math.round(v)}%`,
  onChange: (v) => { store.set('v', v); renderAll(); },
});
const rCtrl = slider({
  label: 'Risk-free rate $r$', min: 0, max: 12, step: 0.25, value: Number(S.r),
  fmt: (v) => `${+v.toFixed(2)}%`,
  onChange: (v) => { store.set('r', v); renderAll(); },
});
const tCtrl = slider({
  label: 'Time to expiration $T$', min: 0.02, max: 2, step: 0.01, value: Number(S.t),
  fmt: (v) => `${+v.toFixed(2)}y`,
  onChange: (v) => { store.set('t', v); renderAll(); },
});
const xhCtrl = slider({
  label: 'Axis: $S_T$ up to', min: 20, max: 400, step: 10, value: Number(S.xh),
  fmt: (v) => `$${Math.round(v)}`,
  onChange: (v) => { store.set('xh', v); renderAll(); },
});
const lgCtrl = toggle({
  label: 'Show each position',
  value: Boolean(S.lg),
  onChange: (v) => { store.set('lg', v); renderAll(); },
});
const mount = (id, node) => /** @type {HTMLElement} */ (document.getElementById(id)).appendChild(node);
mount('ctrl-bs', bsCtrl);
mount('ctrl-s', sCtrl);
mount('ctrl-v', vCtrl);
mount('ctrl-r', rCtrl);
mount('ctrl-t', tCtrl);
mount('ctrl-xh', xhCtrl);
mount('ctrl-lg', lgCtrl);

/* ---------------------------------------------------------- render cycle -- */
function renderAll() {
  const m = model();
  const raw = rawLegs();

  // widen the axis (never shrink it) when a strike or price leaves the view
  const refs = raw.map((l) => (l.k === 's' ? (m.bs ? m.s : l.p) : l.x));
  if (m.bs) refs.push(m.s);
  const maxRef = Math.max(0, ...refs);
  if (maxRef > 0.85 * Number(S.xh)) {
    const xh = Math.min(400, ceilAxis(1.5 * maxRef));
    store.set('xh', xh);
    xhCtrl.set(xh);
  }

  const legs = finLegs(raw, m);
  const stats = strategyStats(legs);
  drawChart(raw, legs, stats, m);
  drawReadouts(stats);
  drawFormulas(raw, legs, stats);
  drawTable(raw, legs, stats);
  syncPriceInputs(raw, m);

  /** @type {HTMLElement} */ (document.getElementById('bs-controls')).hidden = !m.bs;
  /** @type {HTMLElement} */ (document.getElementById('legend-today')).hidden = !m.bs;
  /** @type {HTMLElement} */ (document.getElementById('legend-legs')).hidden = !(S.lg && legs.length > 1);
  if (m.bs) {
    renderLabel(/** @type {HTMLElement} */ (document.getElementById('legend-today-text')),
      `Profit if closed today, $T = ${+m.t.toFixed(2)}$ years before expiration`);
  }
  renderLabel(/** @type {HTMLElement} */ (document.getElementById('price-note')), m.bs
    ? 'Prices come from Black–Scholes (European options, no dividends) at today’s stock price $S_0$. '
      + 'The stock costs $S_0$ and the bond costs $Xe^{-rT}$. Turn the toggle off to type the prices.'
    : 'Prices are the premiums typed in the Positions table, as in the deck and BKM examples.');
}

syncPresetUi();
buildEditor();
renderAll();
