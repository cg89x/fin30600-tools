// @ts-check
/**
 * Limit order book & order types explorer (FIN 30600, Lecture 2 §3).
 *
 * Panel 1 — the deck's hypothetical limit order book (sec3_trading.tex,
 * "Market order"): bids $9.75×15 / $9.50×10 / $2.00×10, asks $10.25×15 /
 * $11.50×10 / $20.00×10, all six levels editable. A market order walks the
 * book level by level (all fill math via lib/finmath.js `walkBook`, which is
 * unit-tested against the deck's Sell/Buy 10-20-30 anchors), with an animated
 * ladder and a depth-cost staircase (average execution price vs order size —
 * the "market depth" picture).
 *
 * Panel 2 — order types: (A) the deck's ABC quote example (bid $55.25 / ask
 * $55.50; market orders execute at the quote, the $55.62 limit sell and
 * $55.37 limit buy do NOT execute), and (B) one resting limit/stop order
 * against a seeded random-walk price path with occasional ±$1 jumps, so stop
 * orders' gap risk is visible (default seed 212: the price gaps from $55.13
 * through a $54.50 stop-loss and the market sell prints at $53.90).
 *
 * Model code for the path + order evaluation lives in ./paths.js (node-
 * testable); transient animation state stays OUT of the URL hash.
 */

import { Chart, fixed, niceTicks } from '../../lib/chart.js';
import { walkBook } from '../../lib/finmath.js';
import { slider, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';
import { makePath, evalRestingOrder, evalQuote, PATH_OPTS } from './paths.js';

import { gateTool } from '../../lib/release.js';
await gateTool('order-book');  // release gate — must run before anything below

hydrateLabels();

/* -------------------------------------------------------------- state ---- */
// The deck's hypothetical book (sec3_trading.tex "Market order" frame).
const DECK_BOOK = {
  ap1: 10.25, as1: 15, ap2: 11.50, as2: 10, ap3: 20.00, as3: 10,
  bp1: 9.75, bs1: 15, bp2: 9.50, bs2: 10, bp3: 2.00, bs3: 10,
};
// Same prices, sizes 5/3/3 per side — the "flash crash" book.
const THIN_SIZES = { as1: 5, as2: 3, as3: 3, bs1: 5, bs2: 3, bs3: 3 };

const QUOTE = { bid: 55.25, ask: 55.50 }; // Part A: the deck's ABC quote

const defaults = {
  ...DECK_BOOK,
  sd: 's',     // market-order side: 'b' buy | 's' sell
  q: 30,       // market-order size (shares)
  oa: 'lb',    // Part A order type (default = deck's limit-buy example)
  pa: 55.37,   // Part A limit/trigger price
  ob: 'sl',    // Part B resting order type
  pb: 54.5,    // Part B limit/trigger price
  seed: 212,   // Part B path seed — 212 gaps from $55.13 THROUGH the $54.50
               // stop at bar 30 and prints $53.90 (the gap-risk preset)
};
// Numeric ranges for hash/typed values (state.js clamps): prices and sizes
// stay sane, order size mirrors its slider.
const BOUNDS = {
  ap1: [0, 10000], ap2: [0, 10000], ap3: [0, 10000],
  bp1: [0, 10000], bp2: [0, 10000], bp3: [0, 10000],
  as1: [0, 9999], as2: [0, 9999], as3: [0, 9999],
  bs1: [0, 9999], bs2: [0, 9999], bs3: [0, 9999],
  q: [0, 40], pa: [0, 10000], pb: [0, 10000], seed: [0, 4294967295],
};
const store = bindState(defaults, () => {}, { debounce: 150, bounds: BOUNDS });
const S = store.state;

/* ------------------------------------------------------------ helpers ---- */
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** "$9.50" — dollars with cents (ticks, quotes, fills). @param {number} v */
const usd2 = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** Average prices keep up to 4 decimals, trimmed: 8.375 -> "$8.375". */
function usdAvg(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const [i, dRaw] = Math.abs(v).toFixed(4).split('.');
  let d = dRaw.replace(/0+$/, '');
  if (d.length < 2) d = (d + '00').slice(0, 2);
  return `${v < 0 ? '−' : ''}$${Number(i).toLocaleString('en-US')}.${d}`;
}

/** Signed dollar amount for the impact readout: -1.375 -> "−$1.375". */
const signedUsd = (v) => `${v >= 0 ? '+' : '−'}${usdAvg(Math.abs(v))}`;

/** Signed percent, one decimal: -0.141 -> "−14.1%". @param {number} v */
const signedPct1 = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/** TeX dollar amount (renderTeX only — \$ breaks renderLabel's splitting). */
const texUsd = (v) => `\\$${v.toFixed(2)}`;

const SVGNS = 'http://www.w3.org/2000/svg';
/** @param {string} name @param {Record<string,string|number>} [attrs] */
function svgEl(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/**
 * Minimal labeled <select> control (ui.js has no select factory).
 * @param {{label:string, options:{v:string,label:string}[], value:string,
 *          onChange:(v:string)=>void}} cfg
 */
function selectCtrl(cfg) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-number';
  const lab = document.createElement('label');
  lab.className = 'ctrl-label';
  renderLabel(lab, cfg.label);
  const sel = document.createElement('select');
  sel.className = 'ctrl-numinput ctrl-select';
  for (const o of cfg.options) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = cfg.value;
  sel.addEventListener('change', () => cfg.onChange(sel.value));
  wrap.append(lab, sel);
  // @ts-ignore augmenting
  wrap.set = (v) => { sel.value = v; };
  return wrap;
}

/* ----------------------------------------------------------- the book ---- */
/**
 * Current book from state: three levels a side, sanitized and sorted
 * best-first (asks ascending, bids descending) — the order walkBook expects.
 */
function book() {
  const lv = (p, s) => ({
    price: Math.max(0, Number(p) || 0),
    size: Math.max(0, Math.round(Number(s) || 0)),
  });
  const asks = [lv(S.ap1, S.as1), lv(S.ap2, S.as2), lv(S.ap3, S.as3)]
    .sort((a, b) => a.price - b.price);
  const bids = [lv(S.bp1, S.bs1), lv(S.bp2, S.bs2), lv(S.bp3, S.bs3)]
    .sort((a, b) => b.price - a.price);
  return { asks, bids };
}

/* market-order animation (transient — deliberately NOT in the URL hash) */
let anim = null; // {step: number, total: number, timer: number|null}
function cancelAnim() {
  if (anim && anim.timer) clearTimeout(anim.timer);
  anim = null;
}

/** One normalized snapshot of panel 1 (book + walk + animation progress). */
function view() {
  const b = book();
  const side = S.sd === 'b' ? 'buy' : 'sell';
  const q = Math.max(0, Math.min(40, Math.round(Number(S.q))));
  const levels = side === 'buy' ? b.asks : b.bids;
  const walk = walkBook(levels, q);
  const depth = levels.reduce((s, l) => s + l.size, 0);
  // Best quote = best PRICE WITH SIZE: a zeroed-out level is not a quote
  // (the walk already skips it; the spread/reference line must agree).
  const bestBid = (b.bids.find((l) => l.size > 0) || b.bids[0]).price;
  const bestAsk = (b.asks.find((l) => l.size > 0) || b.asks[0]).price;
  const nShown = anim ? Math.min(anim.step, walk.fills.length) : walk.fills.length;
  const shown = walk.fills.slice(0, nShown);
  return {
    ...b, side, q, levels, walk, depth, bestBid, bestAsk,
    spread: bestAsk - bestBid,
    best: side === 'buy' ? bestAsk : bestBid,
    shown,
    shownShares: shown.reduce((s, f) => s + f.shares, 0),
    shownTotal: shown.reduce((s, f) => s + f.price * f.shares, 0),
    animating: Boolean(anim),
  };
}

/* -------------------------------------------------------------- ladder --- */
const LW = 640;       // ladder viewBox width
const ROW = 46;       // row height
const GAP = 46;       // spread band height
const X0 = 108;       // bars start
const BARMAX = 400;   // max bar length in px
const LH = 30 + 6 * ROW + GAP + 12; // 30 header + 6 rows + spread band

/**
 * Redraw the price ladder. Asks stacked above (worst at top, best just above
 * the spread band), bids below (best first) — best bid/ask adjacent in the
 * middle. Consumed shares (from the shown fills) render as hollow dashed
 * "drained" segments; the level being consumed right now gets a navy outline.
 * @param {ReturnType<view>} v
 */
function renderLadder(v) {
  const host = $('ladder');
  host.replaceChildren();
  const svg = svgEl('svg', {
    viewBox: `0 0 ${LW} ${LH}`,
    width: LW,
    height: LH,
    class: 'ladder-svg',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.style.aspectRatio = `${LW} / ${LH}`;

  const maxSize = Math.max(1, ...v.asks.map((l) => l.size), ...v.bids.map((l) => l.size));
  const scale = BARMAX / maxSize;

  // column headers
  const h1 = svgEl('text', { x: X0 - 22, y: 18, 'text-anchor': 'end', class: 'colhead' });
  h1.textContent = 'Price';
  const h2 = svgEl('text', { x: X0, y: 18, class: 'colhead' });
  h2.textContent = 'Depth (shares)';
  svg.append(h1, h2);

  // map the shown fills onto the ACTIVE side's sorted-level indices
  // (walkBook consumes the levels best-first, skipping empty ones)
  const activeCons = new Array(v.levels.length).fill(0);
  const fillLevelIdx = []; // level index of each shown fill, in fill order
  {
    let fi = 0;
    for (let li = 0; li < v.levels.length && fi < v.shown.length; li++) {
      if (v.levels[li].size > 0 && v.shown[fi].price === v.levels[li].price) {
        activeCons[li] = v.shown[fi].shares;
        fillLevelIdx.push(li);
        fi++;
      }
    }
  }
  const zeros = (n) => new Array(n).fill(0);
  const askCons = v.side === 'buy' ? activeCons : zeros(v.asks.length);
  const bidCons = v.side === 'sell' ? activeCons : zeros(v.bids.length);
  // level index being consumed right now (animation highlight)
  const hotLevel = v.animating && fillLevelIdx.length
    ? fillLevelIdx[fillLevelIdx.length - 1] : -1;

  /**
   * One book level row. @param {number} yTop @param {{price:number,size:number}} l
   * @param {'ask'|'bid'} side @param {number} cons shares consumed
   * @param {boolean} best @param {boolean} hot animating right now
   */
  const drawRow = (yTop, l, side, cons, best, hot) => {
    const color = side === 'ask' ? 'var(--gold)' : 'var(--blue)';
    const remain = Math.max(0, l.size - cons);
    const yBar = yTop + 8;
    const hBar = 30;
    // price label (+ best-quote caption)
    const pt = svgEl('text', {
      x: X0 - 22, y: yTop + 27, 'text-anchor': 'end', class: `price ${side}`,
    });
    pt.textContent = usd2(l.price);
    svg.appendChild(pt);
    if (best) {
      const cap = svgEl('text', {
        x: X0 - 22, y: yTop + 40, 'text-anchor': 'end', class: 'bestcap',
      });
      cap.textContent = side === 'ask' ? 'best ask' : 'best bid';
      svg.appendChild(cap);
    }
    // remaining depth: solid bar
    if (remain > 0) {
      svg.appendChild(svgEl('rect', {
        x: X0, y: yBar, width: remain * scale, height: hBar,
        fill: color, opacity: 0.88, rx: 2,
      }));
    }
    // consumed depth: hollow, dashed outline (the drained part)
    if (cons > 0) {
      const rect = svgEl('rect', {
        x: X0 + remain * scale, y: yBar, width: cons * scale, height: hBar,
        fill: color, 'fill-opacity': 0.14, rx: 2,
        stroke: hot ? 'var(--navy)' : color, 'stroke-dasharray': hot ? 'none' : '5 4',
        'stroke-width': hot ? 2.5 : 1.3,
      });
      svg.appendChild(rect);
    }
    // size label at the bar end: "5 sh (−10)"
    const st = svgEl('text', { x: X0 + l.size * scale + 8, y: yTop + 27, class: 'sizelabel' });
    const t1 = document.createElementNS(SVGNS, 'tspan');
    t1.textContent = `${remain} sh`;
    st.appendChild(t1);
    if (cons > 0) {
      const t2 = document.createElementNS(SVGNS, 'tspan');
      t2.setAttribute('class', 'consumed');
      t2.textContent = `  −${cons}`;
      st.appendChild(t2);
    }
    svg.appendChild(st);
  };

  // asks above: worst at top, best (index 0) just above the spread band
  for (let i = 0; i < v.asks.length; i++) {
    const rowFromTop = v.asks.length - 1 - i; // i=0 (best) sits lowest
    const yTop = 30 + rowFromTop * ROW;
    drawRow(yTop, v.asks[i], 'ask', askCons[i], i === 0,
      v.side === 'buy' && i === hotLevel);
  }
  // spread band
  const ySpread = 30 + 3 * ROW;
  for (const yy of [ySpread + 4, ySpread + GAP - 4]) {
    svg.appendChild(svgEl('line', {
      x1: X0, y1: yy, x2: X0 + BARMAX, y2: yy,
      stroke: 'var(--grid)', 'stroke-dasharray': '4 4',
    }));
  }
  const spreadTxt = svgEl('text', {
    x: X0 + BARMAX / 2, y: ySpread + GAP / 2 + 5, 'text-anchor': 'middle',
    class: `spread-note${v.spread < 0 ? ' crossed' : ''}`,
  });
  spreadTxt.textContent = v.spread < 0
    ? `crossed book! spread = ${usd2(v.spread)}`
    : `bid–ask spread = ${usd2(v.spread)}`;
  svg.appendChild(spreadTxt);
  // bids below: best (index 0) right under the spread band
  for (let i = 0; i < v.bids.length; i++) {
    const yTop = ySpread + GAP + i * ROW;
    drawRow(yTop, v.bids[i], 'bid', bidCons[i], i === 0,
      v.side === 'sell' && i === hotLevel);
  }

  // rotated ASK / BID group captions
  const sideCap = (y, txt, color) => {
    const t = svgEl('text', {
      x: 14, y, 'text-anchor': 'middle', class: 'sidecap', fill: color,
      transform: `rotate(-90 14 ${y})`,
    });
    t.textContent = txt;
    svg.appendChild(t);
  };
  sideCap(30 + 1.5 * ROW, 'ASKS', 'var(--gold)');
  sideCap(ySpread + GAP + 1.5 * ROW, 'BIDS', 'var(--blue)');

  host.appendChild(svg);
}

/* ------------------------------------------------------ depth-cost chart - */
const depthChart = new Chart($('depth-chart'), {
  width: 480,
  height: 420,
  margin: { top: 18, right: 20, bottom: 48, left: 74 },
  xLabel: 'Order size (shares)',
  yLabel: 'Average execution price',
  xFmt: fixed(0),
  yFmt: usd2,
});

/**
 * Average-execution-price staircase for one side of the book: value at q
 * holds on [q, q+1) — shares are integers, so this is the honest step shape.
 * @param {{price:number,size:number}[]} levels sorted best-first
 * @param {number} maxQ
 */
function staircase(levels, maxQ) {
  const depth = levels.reduce((s, l) => s + l.size, 0);
  const end = Math.min(maxQ, depth);
  const pts = [];
  for (let q = 1; q <= end; q++) {
    const { avgPrice } = walkBook(levels, q);
    if (avgPrice == null) break;
    pts.push({ x: q, y: avgPrice });
    if (q < end) pts.push({ x: q + 1, y: avgPrice });
  }
  return pts;
}

let depthDomainKey = '';
/** @param {ReturnType<view>} v */
function renderDepthChart(v) {
  const buyPts = staircase(v.asks, 40);
  const sellPts = staircase(v.bids, 40);
  const ys = [v.bestBid, v.bestAsk,
    ...buyPts.map((p) => p.y), ...sellPts.map((p) => p.y)];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = Math.max(0.4, (hi - lo) * 0.08);
  const key = `${(lo - pad).toFixed(2)}|${(hi + pad).toFixed(2)}`;
  if (key !== depthDomainKey) {
    depthDomainKey = key;
    depthChart.setDomain(0, 41, lo - pad, hi + pad)
      .renderAxes({ xTicks: [0, 5, 10, 15, 20, 25, 30, 35, 40], yTickCount: 6 });
  }
  depthChart.clearData();

  // best-quote reference lines (dashed grey)
  depthChart.hline(v.bestAsk, { stroke: 'var(--axis)', dash: '6 5', width: 1.2, opacity: 0.8 });
  depthChart.hline(v.bestBid, { stroke: 'var(--axis)', dash: '6 5', width: 1.2, opacity: 0.8 });
  depthChart.text(40.5, v.bestAsk, `best ask ${usd2(v.bestAsk)}`, {
    anchor: 'end', dy: -6, fill: 'var(--muted)',
  });
  depthChart.text(40.5, v.bestBid, `best bid ${usd2(v.bestBid)}`, {
    anchor: 'end', dy: 14, fill: 'var(--muted)',
  });

  // buy side GOLD (rising), sell side BLUE (falling)
  if (buyPts.length) depthChart.path(buyPts, { stroke: 'var(--gold)', width: 2.6 });
  if (sellPts.length) depthChart.path(sellPts, { stroke: 'var(--blue)', width: 2.6 });

  // current selected quantity on the active side
  const qEff = Math.min(v.q, v.depth);
  if (qEff >= 1) {
    const { avgPrice } = walkBook(v.levels, qEff);
    if (avgPrice != null) {
      const color = v.side === 'buy' ? 'var(--gold)' : 'var(--blue)';
      depthChart.point(qEff, avgPrice, { r: 6, fill: color, stroke: '#fff' });
      depthChart.text(qEff, avgPrice, `${v.side === 'buy' ? 'buy' : 'sell'} ${qEff}: avg ${usdAvg(avgPrice)}`, {
        dx: qEff > 26 ? -10 : 10, dy: v.side === 'buy' ? -10 : 18,
        anchor: qEff > 26 ? 'end' : 'start', fill: color,
      });
    }
  }
}

/* ------------------------------------------------------------ readouts --- */
/** @param {ReturnType<view>} v */
function renderReadouts(v) {
  const filled = v.shownShares;
  const total = v.shownTotal;
  const avg = filled > 0 ? total / filled : null;
  const buying = v.side === 'buy';
  const impact = avg != null ? avg - v.best : null;
  const orderTxt = v.animating
    ? `${buying ? 'Buy' : 'Sell'} ${v.q} — filling…`
    : `${buying ? 'Buy' : 'Sell'} ${v.q} sh`;
  const rows = [
    ['Market order', orderTxt, ''],
    [buying ? 'Total cost' : 'Total proceeds', filled > 0 ? usd2(total) : '—', 'blue'],
    ['Average execution price', usdAvg(avg), 'blue'],
    ['Best quote', `${usd2(v.best)} ${buying ? 'ask' : 'bid'}`, ''],
    ['Price impact vs best',
      impact != null ? `${signedUsd(impact)} (${signedPct1(impact / v.best)})` : '—',
      'gold'],
    ['Book depth (this side)', `${v.depth} sh`, ''],
  ];
  const host = $('readouts');
  host.replaceChildren();
  for (const [k, val, cls] of rows) {
    const cell = document.createElement('div');
    cell.className = 'readout';
    const key = document.createElement('div');
    key.className = 'k';
    renderLabel(key, k);
    const vv = document.createElement('div');
    vv.className = `v ${cls}`;
    vv.textContent = val;
    cell.append(key, vv);
    host.appendChild(cell);
  }
}

/* -------------------------------------------------------- formula strip -- */
/** @param {ReturnType<view>} v */
function renderFormulas(v) {
  renderTeX($('f-spread'),
    `\\text{bid}\\unicode{x2013}\\text{ask spread} = \\text{best ask} - \\text{best bid}`
    + ` = ${texUsd(v.bestAsk)} - ${texUsd(v.bestBid)}`
    + ` = \\mathbf{${texUsd(v.spread)}}`);
  const verb = v.side === 'buy' ? 'Buy' : 'Sell';
  if (!v.walk.fills.length) {
    renderTeX($('f-walk'), `\\text{${verb} } ${v.q}\\text{: nothing to fill}`);
    return;
  }
  const terms = v.walk.fills
    .map((f) => `${f.shares}\\times${texUsd(f.price)}`)
    .join(' + ');
  const avg = v.walk.avgPrice;
  const avgTeX = avg != null ? `\\$${usdAvg(avg).replace(/^\$/, '')}` : '';
  const exhausted = v.walk.sharesFilled < v.q
    ? `\\;\\; \\textcolor{#D62728}{(\\text{book exhausted at } ${v.walk.sharesFilled})}` : '';
  renderTeX($('f-walk'),
    `\\text{${verb} } ${v.q}\\text{: } ${terms} = \\mathbf{${texUsd(v.walk.total)}}`
    + `\\;\\Rightarrow\\; \\bar{p} = ${avgTeX}${exhausted}`);
}

/* ---------------------------------------------------------- walk result -- */
/** @param {ReturnType<view>} v */
function renderWalkResult(v) {
  const host = $('walk-result');
  if (v.q === 0) {
    host.textContent = 'Set an order size and submit a market order to walk the book.';
    return;
  }
  if (v.animating) {
    const lvl = v.shown.length;
    host.innerHTML = lvl === 0
      ? 'Order in…'
      : `Filling level ${lvl}: <b>${v.shown[lvl - 1].shares} sh @ ${usd2(v.shown[lvl - 1].price)}</b>…`;
    return;
  }
  const w = v.walk;
  const fillsTxt = w.fills.map((f) => `${f.shares} @ ${usd2(f.price)}`).join(', ');
  const what = v.side === 'buy' ? 'costs' : 'brings in';
  let html = w.fills.length
    ? `${v.side === 'buy' ? 'Buying' : 'Selling'} <b>${w.sharesFilled} shares</b> `
      + `(${fillsTxt}) ${what} <b>${usd2(w.total)}</b> — `
      + `average price <b>${usdAvg(w.avgPrice)}</b>.`
    : 'Nothing filled — the book has no shares on this side.';
  if (w.sharesFilled < v.q) {
    html += ` <span class="warn">Book exhausted after ${w.sharesFilled} shares — `
      + `the remaining ${v.q - w.sharesFilled} cannot fill at any price.</span>`;
  }
  host.innerHTML = html;
}

/* --------------------------------------------------------- render cycle -- */
function renderPanel1() {
  const v = view();
  renderLadder(v);
  renderDepthChart(v);
  renderReadouts(v);
  renderFormulas(v);
  renderWalkResult(v);
}

/* --------------------------------------------------- panel 1: controls --- */
// six editable levels: label column + price/size number inputs (hash-backed)
/**
 * @param {HTMLElement} host @param {'a'|'b'} side
 */
function buildBookEditor(host, side) {
  const heads = ['', 'Price ($)', 'Size (sh)'];
  for (const h of heads) {
    const d = document.createElement('div');
    d.className = 'colhead';
    d.textContent = h;
    host.appendChild(d);
  }
  const tags = ['best', '2nd', '3rd'];
  for (let i = 1; i <= 3; i++) {
    const tag = document.createElement('div');
    tag.className = 'lvl';
    tag.textContent = tags[i - 1];
    host.appendChild(tag);
    for (const kind of ['p', 's']) {
      const key = `${side}${kind}${i}`;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'ctrl-numinput';
      input.min = '0';
      input.step = kind === 'p' ? '0.25' : '1';
      input.value = String(S[key]);
      input.id = `in-${key}`;
      input.addEventListener('input', () => {
        if (input.value.trim() === '') return; // mid-retype: '' would coerce to $0.00
        const n = Number(input.value);
        if (!Number.isFinite(n)) return;
        cancelAnim();
        store.set(key, n);
        renderPanel1();
      });
      host.appendChild(input);
    }
  }
}
buildBookEditor($('edit-asks'), 'a');
buildBookEditor($('edit-bids'), 'b');

/** Push a set of book values into both the store and the DOM inputs. */
function setBook(values) {
  cancelAnim();
  store.patch(values);
  for (const k in values) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`in-${k}`));
    if (input) input.value = String(values[k]);
  }
  renderPanel1();
}
$('btn-deck').addEventListener('click', () => setBook({ ...DECK_BOOK }));
// thin book: the deck's prices, but only 5/3/3 shares per side
$('btn-thin').addEventListener('click', () => setBook({ ...DECK_BOOK, ...THIN_SIZES }));

// side toggle (Buy / Sell)
const btnBuy = /** @type {HTMLButtonElement} */ ($('btn-buy'));
const btnSell = /** @type {HTMLButtonElement} */ ($('btn-sell'));
function syncSideButtons() {
  btnBuy.classList.toggle('active', S.sd === 'b');
  btnSell.classList.toggle('active', S.sd !== 'b');
}
function setSide(sd) {
  cancelAnim();
  store.set('sd', sd);
  syncSideButtons();
  renderPanel1();
}
btnBuy.addEventListener('click', () => setSide('b'));
btnSell.addEventListener('click', () => setSide('s'));
syncSideButtons();

const qCtrl = slider({
  label: 'Order size (shares)', min: 0, max: 40, step: 1,
  value: Math.max(0, Math.min(40, Math.round(Number(S.q)))),
  fmt: (v) => `${Math.round(v)} sh`,
  onChange: (v) => {
    cancelAnim(); // dragging shows the final state instantly
    store.set('q', Math.round(v));
    renderPanel1();
  },
});
$('ctrl-q').appendChild(qCtrl);

// submit: animate the walk level by level (~320 ms per level)
$('btn-submit').addEventListener('click', () => {
  cancelAnim();
  const v = view();
  if (!v.walk.fills.length) { renderPanel1(); return; }
  anim = { step: 0, total: v.walk.fills.length, timer: null };
  const tick = () => {
    if (!anim) return;
    anim.step += 1;
    if (anim.step >= anim.total) {
      anim = null; // final state
      renderPanel1();
      return;
    }
    renderPanel1();
    anim.timer = window.setTimeout(tick, 320);
  };
  renderPanel1(); // step 0: everything restored, order "in flight"
  anim.timer = window.setTimeout(tick, 320);
});

/* ===================== PANEL 2 — order types ============================= */

const TYPE_LABELS = {
  mb: 'market buy', ms: 'market sell',
  lb: 'limit buy', ls: 'limit sell',
  sl: 'stop-loss sell', sb: 'stop-buy',
};

/* ---------------------------- Part A: static quote ----------------------- */
$('qa-spread').textContent = `spread ${usd2(QUOTE.ask - QUOTE.bid)}`;

function renderQuoteResult() {
  const type = String(S.oa);
  const price = Number(S.pa);
  const r = evalQuote(/** @type {any} */ (type), price, QUOTE.bid, QUOTE.ask);
  const P = usd2(price);
  let html = '';
  switch (type) {
    case 'mb':
      html = `<span class="exec-yes">Executes immediately</span> at the ask price: <b>${usd2(QUOTE.ask)}</b>.`;
      break;
    case 'ms':
      html = `<span class="exec-yes">Executes immediately</span> at the bid price: <b>${usd2(QUOTE.bid)}</b>.`;
      break;
    case 'lb':
      html = r.executes
        ? `<span class="exec-yes">Executes</span>: the ask price (${usd2(QUOTE.ask)}) is at or below `
          + `the limit — you buy at <b>${usd2(r.exec ?? 0)}</b> (the limit price or better).`
        : `<span class="exec-no">The trade will not be executed</span>, because the ask price `
          + `(${usd2(QUOTE.ask)}) is greater than the price specified in the limit buy order `
          + `(<b>${P}</b>). The order rests in the book until the ask falls to ${P} or below.`;
      break;
    case 'ls':
      html = r.executes
        ? `<span class="exec-yes">Executes</span>: the bid price (${usd2(QUOTE.bid)}) is at or above `
          + `the limit — you sell at <b>${usd2(r.exec ?? 0)}</b> (the limit price or better).`
        : `<span class="exec-no">The trade will not be executed</span>, because the bid price `
          + `(${usd2(QUOTE.bid)}) is less than the price specified in the limit sell order `
          + `(<b>${P}</b>). The order rests in the book until the bid rises to ${P} or above.`;
      break;
    case 'sl':
      html = r.executes
        ? `<span class="exec-yes">Triggered</span>: the price is already at or below the trigger — `
          + `the order becomes a market sell and executes at the bid, <b>${usd2(QUOTE.bid)}</b>.`
        : `<span class="exec-no">Not triggered</span>: the price (${usd2(QUOTE.bid)} bid) is still `
          + `above the <b>${P}</b> trigger. If the price falls below ${P}, the order becomes a `
          + `market sell — at whatever the bid is then.`;
      break;
    case 'sb':
      html = r.executes
        ? `<span class="exec-yes">Triggered</span>: the price is already at or above the trigger — `
          + `the order becomes a market buy and executes at the ask, <b>${usd2(QUOTE.ask)}</b>.`
        : `<span class="exec-no">Not triggered</span>: the price (${usd2(QUOTE.ask)} ask) is still `
          + `below the <b>${P}</b> trigger. If the price rises above ${P}, the order becomes a `
          + `market buy — at whatever the ask is then.`;
      break;
    default:
      html = '';
  }
  $('qa-result').innerHTML = html;
}

const oaCtrl = selectCtrl({
  label: 'Order',
  options: Object.entries(TYPE_LABELS).map(([v, label]) => ({ v, label })),
  value: String(S.oa),
  onChange: (v) => {
    store.set('oa', v);
    $('ctrl-pa').hidden = v === 'mb' || v === 'ms'; // market orders have no price
    renderQuoteResult();
  },
});
$('ctrl-oa').appendChild(oaCtrl);

const paCtrl = document.createElement('div');
{
  const lab = document.createElement('label');
  lab.className = 'ctrl-label';
  lab.textContent = 'Limit / trigger price';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'ctrl-numinput';
  input.step = '0.01';
  input.min = '0';
  input.value = Number(S.pa).toFixed(2);
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    store.set('pa', n);
    renderQuoteResult();
  });
  paCtrl.className = 'ctrl ctrl-number';
  paCtrl.append(lab, input);
}
$('ctrl-pa').appendChild(paCtrl);
$('ctrl-pa').hidden = S.oa === 'mb' || S.oa === 'ms';

/* --------------------------- Part B: moving price ------------------------ */
const pathChart = new Chart($('path-chart'), {
  width: 980,
  height: 400,
  margin: { top: 18, right: 22, bottom: 48, left: 74 },
  xLabel: 'Time (bars)',
  yLabel: 'Price',
  xFmt: fixed(0),
  yFmt: usd2,
});

let pathDomainKey = '';
function renderPathPanel() {
  const type = /** @type {'lb'|'ls'|'sl'|'sb'} */ (String(S.ob));
  const price = Number(S.pb);
  const path = makePath(Number(S.seed));
  const res = evalRestingOrder(path, type, price);

  const lo = Math.min(...path, price) - 0.35;
  const hi = Math.max(...path, price) + 0.35;
  const key = `${lo.toFixed(2)}|${hi.toFixed(2)}`;
  if (key !== pathDomainKey) {
    pathDomainKey = key;
    pathChart.setDomain(0, PATH_OPTS.n, lo, hi)
      .renderAxes({ xTicks: [0, 15, 30, 45, 60, 75, 90], yTickCount: 6 });
  }
  pathChart.clearData();

  const isLimit = type === 'lb' || type === 'ls';
  const isSell = type === 'ls' || type === 'sl';

  // the order price: RED dashed refline
  pathChart.hline(price, { stroke: 'var(--red)', dash: '7 5', width: 1.8, opacity: 0.9 });
  pathChart.text(PATH_OPTS.n - 1, price, `${isLimit ? 'limit' : 'stop'} ${usd2(price)}`, {
    anchor: 'end', dy: isSell ? 16 : -8, fill: 'var(--red)',
  });

  // the price path: BLUE
  pathChart.path(path.map((p, t) => ({ x: t, y: p })), { stroke: 'var(--blue)', width: 2.2 });

  // first bar that executes: gold dot + label
  let outcome;
  if (res.hit) {
    const t = /** @type {number} */ (res.index);
    const exec = /** @type {number} */ (res.exec);
    pathChart.vline(t, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.5 });
    pathChart.point(t, exec, { r: 6.5, fill: 'var(--gold)', stroke: '#fff' });
    const right = t > PATH_OPTS.n * 0.62;
    const lblTxt = res.immediate
      ? `marketable now @ ${usd2(exec)}`
      : isLimit
        ? `filled @ ${usd2(exec)}`
        : `${type === 'sl' ? 'stopped out' : 'bought'} @ ${usd2(exec)}`;
    pathChart.text(t, exec, lblTxt, {
      dx: right ? -12 : 12, dy: isSell ? 20 : -10,
      anchor: right ? 'end' : 'start', fill: 'var(--gold)',
    });

    // outcome sentence
    const T = usd2(price);
    const X = usd2(exec);
    if (res.immediate) {
      outcome = `<b>Immediately marketable</b>: at bar 0 the price (${usd2(path[0])}) is already `
        + `at or past your ${isLimit ? 'limit' : 'trigger'} of ${T} — the order executes right `
        + `away at <b>${X}</b>. Move the price further from ${usd2(path[0])} to leave the order resting.`;
    } else if (isLimit) {
      outcome = `<span class="exec-yes">Filled at bar ${t}</span>: the price traded `
        + `${type === 'lb' ? 'down to' : 'up to'} your limit — you ${type === 'lb' ? 'buy' : 'sell'} `
        + `at <b>${X}</b>, the limit price or better. (Until that bar the order simply rested in the book.)`;
    } else {
      const gap = res.gap ?? 0;
      const worse = type === 'sl' ? 'below' : 'above';
      let gapTxt;
      if (gap > 0.3) { // a jump carried the price straight through the trigger
        gapTxt = ` The price <b>gapped through the trigger</b>: the market `
          + `${type === 'sl' ? 'sell' : 'buy'} executed ${usd2(gap)} ${worse} the trigger — `
          + `a stop caps nothing; it only fires a market order at whatever price comes next.`;
      } else if (gap > 0.005) {
        gapTxt = ` Execution came in ${usd2(gap)} ${worse} the trigger: a stop fires a `
          + `market order at the crossing price, not at the trigger itself.`;
      } else {
        gapTxt = ` Execution landed right at the trigger this time — no slippage.`;
      }
      outcome = type === 'sl'
        ? `<span class="exec-no">Stopped out at ${X}</span> on a ${T} stop (bar ${t}).${gapTxt}`
        : `<span class="exec-yes">Triggered at bar ${t}</span>: bought at <b>${X}</b> on a ${T} stop-buy.${gapTxt}`;
    }
  } else {
    outcome = `<b>Never executes</b> in this window: the price never `
      + `${isLimit ? 'reaches your limit' : 'crosses your trigger'} of ${usd2(price)}. `
      + `Limit and stop orders remove price uncertainty — but execution is not guaranteed.`;
  }
  $('qb-result').innerHTML = outcome;
}

const obCtrl = selectCtrl({
  label: 'Resting order',
  options: [
    { v: 'lb', label: 'limit buy' },
    { v: 'ls', label: 'limit sell' },
    { v: 'sl', label: 'stop-loss sell' },
    { v: 'sb', label: 'stop-buy' },
  ],
  value: String(S.ob),
  onChange: (v) => { store.set('ob', v); renderPathPanel(); },
});
$('ctrl-ob').appendChild(obCtrl);

{
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-number';
  const lab = document.createElement('label');
  lab.className = 'ctrl-label';
  lab.textContent = 'Limit / trigger price';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'ctrl-numinput';
  input.step = '0.05';
  input.min = '0';
  input.value = Number(S.pb).toFixed(2);
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    store.set('pb', n);
    renderPathPanel();
  });
  wrap.append(lab, input);
  $('ctrl-pb').appendChild(wrap);
}

$('btn-path').addEventListener('click', () => {
  store.set('seed', ((Number(S.seed) || 0) + 1) >>> 0);
  renderPathPanel();
});

/* ------------------------------------------------------------- startup --- */
renderPanel1();
renderQuoteResult();
renderPathPanel();
