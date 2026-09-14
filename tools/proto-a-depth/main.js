// @ts-check
/**
 * PROTOTYPE A1 — Market Depth & Price Impact (Direction A: Split & Focus).
 * LOCAL-ONLY design prototype: no release gate, no URL-hash state — plain
 * local variables. Adapted from tools/order-book/main.js (panel 1 only).
 *
 * Four levels a side. Default book (Christian 2026-07-12): asks $10.25×4 /
 * $10.75×10 / $11.60×5 / $13.00×15, bids $9.75×5 / $9.30×9 / $8.50×6 /
 * $7.25×12 — a similar-but-not-mirrored depth curve. The deck's 3-level book
 * (sec3_trading.tex "Market order") remains as the "Deck example" preset.
 * All fill math via lib/finmath.js `walkBook`. The page leads with the quiz
 * ("At what price can you sell 30?"), animates the walk (~400 ms/level), and
 * reveals the arithmetic line by line in sync — nothing is preprinted.
 */

import { Chart, fixed } from '../../lib/chart.js';
import { walkBook } from '../../lib/finmath.js';
import { slider, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';

hydrateLabels();

/* -------------------------------------------------------------- state ---- */
// Default book (four levels a side; small at the touch, deep further out).
const DEFAULT_BOOK = {
  ap1: 10.25, as1: 4, ap2: 10.75, as2: 10, ap3: 11.60, as3: 5, ap4: 13.00, as4: 15,
  bp1: 9.75, bs1: 5, bp2: 9.30, bs2: 9, bp3: 8.50, bs3: 6, bp4: 7.25, bs4: 12,
};
// The deck's hypothetical 3-level book (sec3_trading.tex "Market order"
// frame) as a preset; the 4th level is parked empty at the worst price.
const DECK_BOOK = {
  ap1: 10.25, as1: 15, ap2: 11.50, as2: 10, ap3: 20.00, as3: 10, ap4: 20.00, as4: 0,
  bp1: 9.75, bs1: 15, bp2: 9.50, bs2: 10, bp3: 2.00, bs3: 10, bp4: 2.00, bs4: 0,
};

// Plain local state (prototype: deliberately NOT hash-backed).
const S = { ...DEFAULT_BOOK, sd: 's', q: 30 };
let hasRun = false;      // arithmetic panel stays empty until an order runs

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

/** TeX average price with trimmed decimals: 8.375 -> "\$8.375". */
const texUsdAvg = (v) => `\\$${usdAvg(v).replace(/^\$/, '')}`;

const SVGNS = 'http://www.w3.org/2000/svg';
/** @param {string} name @param {Record<string,string|number>} [attrs] */
function svgEl(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/* ----------------------------------------------------------- the book ---- */
const N_LEVELS = 4;

/**
 * Current book from state: four levels a side, sanitized and sorted
 * best-first (asks ascending, bids descending) — the order walkBook expects.
 */
function book() {
  const lv = (p, s) => ({
    price: Math.max(0, Number(p) || 0),
    size: Math.max(0, Math.round(Number(s) || 0)),
  });
  const asks = [1, 2, 3, 4].map((i) => lv(S[`ap${i}`], S[`as${i}`]))
    .sort((a, b) => a.price - b.price);
  const bids = [1, 2, 3, 4].map((i) => lv(S[`bp${i}`], S[`bs${i}`]))
    .sort((a, b) => b.price - a.price);
  return { asks, bids };
}

/* market-order animation (transient) */
let anim = null; // {step: number, total: number, timer: number|null}
function cancelAnim() {
  if (anim && anim.timer) clearTimeout(anim.timer);
  anim = null;
}

/** One normalized snapshot of the book + walk + animation progress. */
function view() {
  const b = book();
  const side = S.sd === 'b' ? 'buy' : 'sell';
  const q = Math.max(0, Math.min(40, Math.round(Number(S.q))));
  const levels = side === 'buy' ? b.asks : b.bids;
  const walk = walkBook(levels, q);
  const depth = levels.reduce((s, l) => s + l.size, 0);
  // Best quote = best PRICE WITH SIZE: a zeroed-out level is not a quote.
  const bestBid = (b.bids.find((l) => l.size > 0) || b.bids[0]).price;
  const bestAsk = (b.asks.find((l) => l.size > 0) || b.asks[0]).price;
  // Before any order has run, nothing is consumed (the quiz reveal).
  const nShown = anim
    ? Math.min(anim.step, walk.fills.length)
    : (hasRun ? walk.fills.length : 0);
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
const LH = 30 + 2 * N_LEVELS * ROW + GAP + 12; // header + 8 rows + spread band

/**
 * Redraw the price ladder (hero). Asks stacked above, bids below, best
 * bid/ask adjacent in the middle. Consumed shares render as hollow dashed
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
    if (remain > 0) {
      svg.appendChild(svgEl('rect', {
        x: X0, y: yBar, width: remain * scale, height: hBar,
        fill: color, opacity: 0.88, rx: 2,
      }));
    }
    if (cons > 0) {
      const rect = svgEl('rect', {
        x: X0 + remain * scale, y: yBar, width: cons * scale, height: hBar,
        fill: color, 'fill-opacity': 0.14, rx: 2,
        stroke: hot ? 'var(--navy)' : color, 'stroke-dasharray': hot ? 'none' : '5 4',
        'stroke-width': hot ? 2.5 : 1.3,
      });
      svg.appendChild(rect);
    }
    const st = svgEl('text', { x: X0 + l.size * scale + 8, y: yTop + 27, class: 'sizelabel' });
    const t1 = document.createElementNS(SVGNS, 'tspan');
    t1.textContent = `${remain} shares`;
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
    const rowFromTop = v.asks.length - 1 - i;
    const yTop = 30 + rowFromTop * ROW;
    drawRow(yTop, v.asks[i], 'ask', askCons[i], i === 0,
      v.side === 'buy' && i === hotLevel);
  }
  // spread band
  const ySpread = 30 + N_LEVELS * ROW;
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
  sideCap(30 + (N_LEVELS / 2) * ROW, 'ASKS', 'var(--gold)');
  sideCap(ySpread + GAP + (N_LEVELS / 2) * ROW, 'BIDS', 'var(--blue)');

  host.appendChild(svg);
}

/* --------------------------------------------- arithmetic (revealed) ----- */
/**
 * The arithmetic panel: EMPTY until an order runs, then one line per fill
 * ("15 × $9.75 = $146.25"), revealed in sync with the ladder animation, then
 * a rule and the total ⇒ average line.
 * @param {ReturnType<view>} v
 */
function renderArithmetic(v) {
  const host = $('arith');
  host.replaceChildren();
  if (!hasRun && !v.animating) {
    const hint = document.createElement('p');
    hint.className = 'arith-hint';
    hint.textContent = 'Tap a quiz chip — or submit a custom order — and the '
      + 'fill arithmetic appears here, level by level.';
    host.appendChild(hint);
    return;
  }
  // headline: what the trade IS, in a few words — "SELL 30 · market order"
  const verb = document.createElement('div');
  verb.className = 'arith-verb';
  verb.textContent = `${v.side === 'buy' ? 'Buy' : 'Sell'} ${v.q} · market order — `
    + `${v.side === 'buy' ? 'lifting the asks' : 'hitting the bids'}, best price first`;
  host.appendChild(verb);
  if (v.q === 0 || !v.walk.fills.length) {
    const hint = document.createElement('p');
    hint.className = 'arith-hint';
    hint.textContent = v.q === 0
      ? 'Order size is zero — nothing to fill.'
      : 'Nothing filled — the book has no shares on this side.';
    host.appendChild(hint);
    return;
  }
  for (const f of v.shown) {
    const line = document.createElement('div');
    line.className = 'arith-line';
    renderTeX(line,
      `${f.shares} \\times ${texUsd(f.price)} = ${texUsd(f.shares * f.price)}`);
    host.appendChild(line);
  }
  if (v.animating) return; // totals only once the walk completes
  const rule = document.createElement('hr');
  rule.className = 'arith-rule';
  host.appendChild(rule);
  const total = document.createElement('div');
  total.className = 'arith-total';
  renderTeX(total,
    `\\text{total } \\mathbf{${texUsd(v.walk.total)}}`
    + `\\;\\Rightarrow\\; \\text{avg } \\mathbf{${texUsdAvg(v.walk.avgPrice)}}`);
  host.appendChild(total);
  if (v.walk.sharesFilled < v.q) {
    const warn = document.createElement('p');
    warn.className = 'arith-warn';
    warn.textContent = `Book exhausted after ${v.walk.sharesFilled} shares — `
      + `the remaining ${v.q - v.walk.sharesFilled} cannot fill at any price.`;
    host.appendChild(warn);
  }
}

/* ------------------------------------------------------ depth-cost chart - */
// Sized to match the ladder exactly (same viewBox footprint: 640 × LH).
const depthChart = new Chart($('depth-chart'), {
  width: LW,
  height: LH,
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
/** Trimmed readout row — exactly four tiles. @param {ReturnType<view>} v */
function renderReadouts(v) {
  const buying = v.side === 'buy';
  // Before any run, the tiles describe the QUOTE, not a walk.
  const ran = hasRun || v.animating;
  const filled = v.shownShares;
  const total = v.shownTotal;
  const avg = filled > 0 ? total / filled : null;
  const impact = ran && avg != null ? avg - v.best : null;
  const rows = [
    [buying ? 'Total cost' : 'Total proceeds', ran && filled > 0 ? usd2(total) : '—', 'blue'],
    ['Average execution price', ran ? usdAvg(avg) : '—', 'blue'],
    ['Best quote', `${usd2(v.best)} ${buying ? 'ask' : 'bid'}`, ''],
    ['Price impact vs best',
      impact != null ? `${signedUsd(impact)} (${signedPct1(impact / v.best)})` : '—',
      'gold'],
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

/* ---------------------------------------------------------- walk result -- */
/** @param {ReturnType<view>} v */
function renderWalkResult(v) {
  const host = $('walk-result');
  if (!hasRun && !v.animating) {
    host.textContent = 'Tap a quiz chip above to walk a market order through this book.';
    return;
  }
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
function renderAll() {
  const v = view();
  renderLadder(v);
  renderArithmetic(v);
  renderDepthChart(v);
  renderReadouts(v);
  renderWalkResult(v);
}

/* ------------------------------------------------------- the deck quiz --- */
const chips = /** @type {HTMLButtonElement[]} */ (
  [...document.querySelectorAll('.quiz-strip .chip')]);
function syncChips() {
  for (const c of chips) {
    c.classList.toggle('active',
      hasRun && c.dataset.sd === S.sd && Number(c.dataset.q) === Number(S.q));
  }
}
for (const c of chips) {
  c.addEventListener('click', () => {
    S.sd = c.dataset.sd === 'b' ? 'b' : 's';
    S.q = Number(c.dataset.q);
    qCtrl.set(S.q);
    syncSideButtons();
    syncChips();
    runOrder();
  });
}

/* ------------------------------------------------------- custom ticket --- */
const btnBuy = /** @type {HTMLButtonElement} */ ($('btn-buy'));
const btnSell = /** @type {HTMLButtonElement} */ ($('btn-sell'));
function syncSideButtons() {
  btnBuy.classList.toggle('active', S.sd === 'b');
  btnSell.classList.toggle('active', S.sd !== 'b');
}
function setSide(sd) {
  cancelAnim();
  S.sd = sd;
  syncSideButtons();
  syncChips();
  renderAll();
}
btnBuy.addEventListener('click', () => setSide('b'));
btnSell.addEventListener('click', () => setSide('s'));
syncSideButtons();

const qCtrl = slider({
  label: 'Order size (shares)', min: 0, max: 40, step: 1,
  value: S.q,
  fmt: (v) => `${Math.round(v)} shares`,
  onChange: (v) => {
    cancelAnim(); // dragging shows the final state instantly (once run)
    S.q = Math.round(v);
    syncChips();
    renderAll();
  },
});
$('ctrl-q').appendChild(qCtrl);

// Animation pace fixed at 555 ms/level (Christian 2026-07-12).
const STEP_MS = 555;

/** Animate the walk level by level (~555 ms per level). Chips + ticket both
 * land here — same machinery. */
function runOrder() {
  cancelAnim();
  hasRun = true;
  const v = view();
  if (!v.walk.fills.length) { renderAll(); return; }
  anim = { step: 0, total: v.walk.fills.length, timer: null };
  const tick = () => {
    if (!anim) return;
    anim.step += 1;
    if (anim.step >= anim.total) {
      anim = null; // final state (totals + average revealed)
      renderAll();
      return;
    }
    renderAll();
    anim.timer = window.setTimeout(tick, STEP_MS);
  };
  renderAll(); // step 0: everything restored, order "in flight"
  anim.timer = window.setTimeout(tick, STEP_MS);
}
$('btn-submit').addEventListener('click', runOrder);

/* -------------------------------------------------------- book editor ---- */
// six editable levels: label column + price/size number inputs
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
  const tags = ['best', '2nd', '3rd', '4th'];
  for (let i = 1; i <= N_LEVELS; i++) {
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
        S[key] = n;
        renderAll();
      });
      host.appendChild(input);
    }
  }
}
buildBookEditor($('edit-asks'), 'a');
buildBookEditor($('edit-bids'), 'b');

/** Push a set of book values into both the state and the DOM inputs. */
function setBook(values) {
  cancelAnim();
  Object.assign(S, values);
  for (const k in values) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`in-${k}`));
    if (input) input.value = String(values[k]);
  }
  renderAll();
}
$('btn-default').addEventListener('click', () => setBook({ ...DEFAULT_BOOK }));
$('btn-deck').addEventListener('click', () => setBook({ ...DECK_BOOK }));

/* ------------------------------------------------------------- startup --- */
syncChips();
renderAll();
