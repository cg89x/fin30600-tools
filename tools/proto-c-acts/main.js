// @ts-check
/**
 * PROTOTYPE C — "Trading Costs & Orders, in four acts" (Lecture 2 §3).
 *
 * LOCAL-ONLY design prototype: the order-book tool's content restructured as
 * a sequential story page, one focal interaction per act, in the order the
 * lecture teaches. Not release-gated, no URL-hash state — plain local
 * variables. Never deployed.
 *
 *  Act I   — the quote card + the round-trip demo (buy 10, sell 10 → −$5.00
 *            = 10 × the $0.50 spread).
 *  Act II  — the deck quiz: sell/buy 10-20-30 chips, ladder + arithmetic
 *            panel revealed level by level (~320 ms/level).
 *  Act III — deck book vs thin book, "Sell 30 into both": $251.25 avg $8.375
 *            vs exhaustion after 11 shares ($83.25).
 *  Act IV  — resting orders against a moving price (./paths.js); default
 *            seed 212: a $54.50 stop-loss gaps and prints $53.90.
 *
 * ALL fill math comes from lib/finmath.js `walkBook` — no anchor is
 * hardcoded into the logic.
 */

import { Chart, fixed } from '../../lib/chart.js';
import { walkBook } from '../../lib/finmath.js';
import { renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { makePath, evalRestingOrder, PATH_OPTS } from './paths.js';

hydrateLabels();

/* ------------------------------------------------------------- the book -- */
// The deck's hypothetical book (sec3_trading.tex "Market order" frame),
// sorted best-first — the order walkBook expects.
const DECK_ASKS = [
  { price: 10.25, size: 15 }, { price: 11.50, size: 10 }, { price: 20.00, size: 10 },
];
const DECK_BIDS = [
  { price: 9.75, size: 15 }, { price: 9.50, size: 10 }, { price: 2.00, size: 10 },
];
// Same prices, sizes 5/3/3 — the "flash crash" book.
const THIN_ASKS = DECK_ASKS.map((l, i) => ({ price: l.price, size: [5, 3, 3][i] }));
const THIN_BIDS = DECK_BIDS.map((l, i) => ({ price: l.price, size: [5, 3, 3][i] }));

const BEST_BID = DECK_BIDS[0].price;
const BEST_ASK = DECK_ASKS[0].price;
const SPREAD = BEST_ASK - BEST_BID;

const STEP_MS = 320; // animation pace: one book level per ~320 ms

/* -------------------------------------------------------------- helpers -- */
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** "$9.50" — dollars with cents. @param {number} v */
const usd2 = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** Average prices keep up to 4 decimals, trimmed: 8.375 -> "$8.375". */
function usdAvg(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const [i, dRaw] = Math.abs(v).toFixed(4).split('.');
  let d = dRaw.replace(/0+$/, '');
  if (d.length < 2) d = (d + '00').slice(0, 2);
  return `${v < 0 ? '−' : ''}$${Number(i).toLocaleString('en-US')}.${d}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
/** @param {string} name @param {Record<string,string|number>} [attrs] */
function svgEl(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/** Reveal an act's takeaway sentence (once its interaction has produced a
 * result — the page-wide reveal rule). @param {string} id */
const revealTakeaway = (id) => $(id).classList.add('show');

/* ------------------------------------------------------ ladder renderer -- */
// Adapted from tools/order-book/main.js renderLadder: same geometry (the SVG
// scales via viewBox, so smaller display widths just shrink it), but
// parameterized by book + shown fills instead of reading tool state.
const LW = 640;       // ladder viewBox width
const ROW = 46;       // row height
const GAP = 46;       // spread band height
const X0 = 108;       // bars start
const BARMAX = 400;   // max bar length in px
const LH = 30 + 6 * ROW + GAP + 12; // 30 header + 6 rows + spread band

/**
 * Draw one book ladder. Asks stacked above (worst at top, best just above
 * the spread band), bids below (best first). Consumed shares (from `shown`
 * fills on the `side` being traded) render as hollow dashed "drained"
 * segments; the level being consumed right now gets a navy outline.
 * @param {HTMLElement} host
 * @param {object} cfg
 * @param {{price:number,size:number}[]} cfg.asks best-first
 * @param {{price:number,size:number}[]} cfg.bids best-first
 * @param {'buy'|'sell'} cfg.side which side a market order consumes
 * @param {{price:number,shares:number}[]} cfg.shown fills consumed so far
 * @param {boolean} cfg.animating highlight the level being eaten right now
 * @param {number} [cfg.displayWidth=LW] rendered width in px (shrink-only)
 */
function renderLadder(host, cfg) {
  const { asks, bids, side, shown, animating } = cfg;
  const displayWidth = cfg.displayWidth ?? LW;
  host.replaceChildren();
  const svg = svgEl('svg', {
    viewBox: `0 0 ${LW} ${LH}`,
    width: displayWidth,
    height: Math.round(displayWidth * (LH / LW)),
    class: 'ladder-svg',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.style.aspectRatio = `${LW} / ${LH}`;

  const maxSize = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const scale = BARMAX / maxSize;

  // column headers
  const h1 = svgEl('text', { x: X0 - 22, y: 18, 'text-anchor': 'end', class: 'colhead' });
  h1.textContent = 'Price';
  const h2 = svgEl('text', { x: X0, y: 18, class: 'colhead' });
  h2.textContent = 'Depth (shares)';
  svg.append(h1, h2);

  // map the shown fills onto the active side's level indices (walkBook
  // consumes the levels best-first, skipping empty ones)
  const levels = side === 'buy' ? asks : bids;
  const activeCons = new Array(levels.length).fill(0);
  const fillLevelIdx = [];
  {
    let fi = 0;
    for (let li = 0; li < levels.length && fi < shown.length; li++) {
      if (levels[li].size > 0 && shown[fi].price === levels[li].price) {
        activeCons[li] = shown[fi].shares;
        fillLevelIdx.push(li);
        fi++;
      }
    }
  }
  const zeros = (n) => new Array(n).fill(0);
  const askCons = side === 'buy' ? activeCons : zeros(asks.length);
  const bidCons = side === 'sell' ? activeCons : zeros(bids.length);
  const hotLevel = animating && fillLevelIdx.length
    ? fillLevelIdx[fillLevelIdx.length - 1] : -1;

  /**
   * One book level row. @param {number} yTop @param {{price:number,size:number}} l
   * @param {'ask'|'bid'} rowSide @param {number} cons shares consumed
   * @param {boolean} best @param {boolean} hot animating right now
   */
  const drawRow = (yTop, l, rowSide, cons, best, hot) => {
    const color = rowSide === 'ask' ? 'var(--gold)' : 'var(--blue)';
    const remain = Math.max(0, l.size - cons);
    const yBar = yTop + 8;
    const hBar = 30;
    const pt = svgEl('text', {
      x: X0 - 22, y: yTop + 27, 'text-anchor': 'end', class: `price ${rowSide}`,
    });
    pt.textContent = usd2(l.price);
    svg.appendChild(pt);
    if (best) {
      const cap = svgEl('text', {
        x: X0 - 22, y: yTop + 40, 'text-anchor': 'end', class: 'bestcap',
      });
      cap.textContent = rowSide === 'ask' ? 'best ask' : 'best bid';
      svg.appendChild(cap);
    }
    if (remain > 0) {
      svg.appendChild(svgEl('rect', {
        x: X0, y: yBar, width: remain * scale, height: hBar,
        fill: color, opacity: 0.88, rx: 2,
      }));
    }
    if (cons > 0) {
      svg.appendChild(svgEl('rect', {
        x: X0 + remain * scale, y: yBar, width: cons * scale, height: hBar,
        fill: color, 'fill-opacity': 0.14, rx: 2,
        stroke: hot ? 'var(--navy)' : color, 'stroke-dasharray': hot ? 'none' : '5 4',
        'stroke-width': hot ? 2.5 : 1.3,
      }));
    }
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
  for (let i = 0; i < asks.length; i++) {
    const rowFromTop = asks.length - 1 - i;
    const yTop = 30 + rowFromTop * ROW;
    drawRow(yTop, asks[i], 'ask', askCons[i], i === 0, side === 'buy' && i === hotLevel);
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
    class: 'spread-note',
  });
  spreadTxt.textContent = `bid–ask spread = ${usd2(asks[0].price - bids[0].price)}`;
  svg.appendChild(spreadTxt);
  // bids below: best (index 0) right under the spread band
  for (let i = 0; i < bids.length; i++) {
    const yTop = ySpread + GAP + i * ROW;
    drawRow(yTop, bids[i], 'bid', bidCons[i], i === 0, side === 'sell' && i === hotLevel);
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

/* ========================= ACT I — the round trip ========================= */

$('a1-bid').textContent = usd2(BEST_BID);
$('a1-ask').textContent = usd2(BEST_ASK);
$('a1-spread').textContent = usd2(SPREAD);

const a1Btn = /** @type {HTMLButtonElement} */ ($('a1-btn'));
let a1Timers = [];

a1Btn.addEventListener('click', () => {
  for (const t of a1Timers) clearTimeout(t);
  a1Timers = [];
  a1Btn.disabled = true;

  const buy = walkBook(DECK_ASKS, 10);   // 10 × $10.25 = $102.50 paid
  const sell = walkBook(DECK_BIDS, 10);  // 10 × $9.75  = $97.50 received
  const loss = buy.total - sell.total;   // $5.00 = 10 × the $0.50 spread

  const legsHost = $('a1-legs');
  legsHost.replaceChildren();
  const tally = $('a1-tally');
  tally.classList.remove('show');
  tally.replaceChildren();

  /** @param {'ask'|'bid'} tag @param {string} html */
  const makeLeg = (tag, html) => {
    const row = document.createElement('div');
    row.className = 'leg';
    const t = document.createElement('span');
    t.className = `leg-tag ${tag}`;
    t.textContent = tag.toUpperCase();
    const body = document.createElement('span');
    body.innerHTML = html;
    row.append(t, body);
    legsHost.appendChild(row);
    return row;
  };

  const f1 = buy.fills[0];
  const f2 = sell.fills[0];
  const legBuy = makeLeg('ask',
    `Leg 1 — market <b>buy ${f1.shares}</b> at the ask: `
    + `${f1.shares} × ${usd2(f1.price)} = <b>${usd2(buy.total)}</b> paid.`);
  const legSell = makeLeg('bid',
    `Leg 2 — market <b>sell ${f2.shares}</b> at the bid: `
    + `${f2.shares} × ${usd2(f2.price)} = <b>${usd2(sell.total)}</b> received.`);

  a1Timers.push(window.setTimeout(() => legBuy.classList.add('show'), 150));
  a1Timers.push(window.setTimeout(() => legSell.classList.add('show'), 150 + 3 * STEP_MS));
  a1Timers.push(window.setTimeout(() => {
    const line = document.createElement('div');
    line.innerHTML = `Paid <b>${usd2(buy.total)}</b> · received <b>${usd2(sell.total)}</b>`
      + ` → <span class="lost">lost ${usd2(loss)}</span> in seconds, with the price unchanged.`;
    const tex = document.createElement('div');
    tex.className = 'tally-tex';
    renderTeX(tex,
      `\\text{round-trip loss} = 10 \\times (\\text{ask} - \\text{bid})`
      + ` = 10 \\times \\$${SPREAD.toFixed(2)} = \\$${loss.toFixed(2)}`);
    tally.append(line, tex);
    tally.classList.add('show');
    revealTakeaway('tk1');
    a1Btn.disabled = false;
  }, 150 + 6 * STEP_MS));
});

/* ==================== ACT II — walk the book (the quiz) =================== */

const A2_ORDERS = [
  { side: 'sell', q: 10 }, { side: 'sell', q: 20 }, { side: 'sell', q: 30 },
  { side: 'buy', q: 10 }, { side: 'buy', q: 20 }, { side: 'buy', q: 30 },
];

/** @type {{timer:number|null, chip:HTMLButtonElement|null}} */
const a2 = { timer: null, chip: null };

const a2Chips = $('a2-chips');
A2_ORDERS.forEach((o, i) => {
  if (i === 3) { // visual gap between the sell and buy groups
    const gap = document.createElement('span');
    gap.className = 'chip-gap';
    a2Chips.appendChild(gap);
  }
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `chip ${o.side === 'sell' ? 'blue' : 'gold'}`;
  chip.textContent = `${o.side === 'sell' ? 'Sell' : 'Buy'} ${o.q}`;
  chip.addEventListener('click', () => a2Run(o.side === 'buy' ? 'buy' : 'sell', o.q, chip));
  a2Chips.appendChild(chip);
});

/** Redraw the Act-II ladder with `n` fills shown. */
function a2Ladder(side, fills, n, animating) {
  renderLadder($('a2-ladder'), {
    asks: DECK_ASKS, bids: DECK_BIDS, side,
    shown: fills.slice(0, n), animating,
    displayWidth: 620,
  });
}

/**
 * Run the deck quiz for one chip: reveal the arithmetic line by line
 * (~STEP_MS per level) while the ladder drains in sync, then total, then
 * average.
 * @param {'buy'|'sell'} side @param {number} q @param {HTMLButtonElement} chip
 */
function a2Run(side, q, chip) {
  if (a2.timer) clearTimeout(a2.timer);
  a2.timer = null;
  if (a2.chip) a2.chip.classList.remove('active');
  chip.classList.add('active');
  a2.chip = chip;

  const levels = side === 'buy' ? DECK_ASKS : DECK_BIDS;
  const walk = walkBook(levels, q);
  const verb = side === 'buy' ? 'Buy' : 'Sell';
  const what = side === 'buy' ? 'total cost' : 'total proceeds';

  // build all lines up front, hidden; the timer flips them to .show
  const mathHost = $('a2-math');
  mathHost.replaceChildren();
  /** @type {HTMLElement[]} */
  const lines = [];
  const addLine = (cls, html) => {
    const p = document.createElement('p');
    p.className = `mathline ${cls}`.trim();
    p.innerHTML = html;
    mathHost.appendChild(p);
    lines.push(p);
    return p;
  };
  const head = document.createElement('p');
  head.className = 'mathhint';
  head.innerHTML = `<b>${verb} ${q}</b> — a market order consumes the `
    + `${side === 'buy' ? 'asks' : 'bids'} from the best price outward:`;
  mathHost.appendChild(head);
  for (const f of walk.fills) {
    addLine('', `${f.shares} × ${usd2(f.price)} = <b>${usd2(f.shares * f.price)}</b>`);
  }
  addLine('total', `${what}: <b>${usd2(walk.total)}</b> for ${walk.sharesFilled} shares`);
  addLine('avg', `average price: ${usd2(walk.total)} / ${walk.sharesFilled}`
    + ` = <b>${usdAvg(walk.avgPrice)}</b>`);

  const totalSteps = walk.fills.length + 2; // fills, then total, then average
  let step = 0;
  a2Ladder(side, walk.fills, 0, true);
  const tick = () => {
    step++;
    if (step <= walk.fills.length) {
      lines[step - 1].classList.add('show');
      a2Ladder(side, walk.fills, step, step < walk.fills.length);
    } else {
      lines[step - 1].classList.add('show');
    }
    if (step < totalSteps) {
      a2.timer = window.setTimeout(tick, STEP_MS);
    } else {
      a2.timer = null;
      revealTakeaway('tk2');
    }
  };
  a2.timer = window.setTimeout(tick, STEP_MS);
}

// idle ladder on load (nothing consumed yet)
a2Ladder('sell', [], 0, false);

/* =================== ACT III — deck book vs thin book ==================== */

const A3_Q = 30;
/** @type {number|null} */
let a3Timer = null;

/** @param {'a3-left'|'a3-right'} host @param {object} books @param {any[]} fills @param {number} n @param {boolean} anim */
function a3Ladder(host, books, fills, n, anim) {
  renderLadder($(host), {
    asks: books.asks, bids: books.bids, side: 'sell',
    shown: fills.slice(0, n), animating: anim,
    displayWidth: 470,
  });
}

const A3_LEFT = { asks: DECK_ASKS, bids: DECK_BIDS };
const A3_RIGHT = { asks: THIN_ASKS, bids: THIN_BIDS };

$('a3-btn').addEventListener('click', () => {
  if (a3Timer) clearTimeout(a3Timer);
  a3Timer = null;
  $('a3-left-res').textContent = '';
  $('a3-right-res').textContent = '';

  const wL = walkBook(DECK_BIDS, A3_Q);
  const wR = walkBook(THIN_BIDS, A3_Q);
  const maxSteps = Math.max(wL.fills.length, wR.fills.length);
  let step = 0;
  a3Ladder('a3-left', A3_LEFT, wL.fills, 0, true);
  a3Ladder('a3-right', A3_RIGHT, wR.fills, 0, true);

  const tick = () => {
    step++;
    const done = step >= maxSteps;
    a3Ladder('a3-left', A3_LEFT, wL.fills, step, !done && step < wL.fills.length);
    a3Ladder('a3-right', A3_RIGHT, wR.fills, step, !done && step < wR.fills.length);
    if (!done) {
      a3Timer = window.setTimeout(tick, STEP_MS);
      return;
    }
    a3Timer = null;
    $('a3-left-res').innerHTML =
      `Sold <b>${wL.sharesFilled} shares</b> for <b>${usd2(wL.total)}</b> — `
      + `average price <b>${usdAvg(wL.avgPrice)}</b>.`;
    $('a3-right-res').innerHTML =
      `Sold ${wR.sharesFilled} shares for ${usd2(wR.total)}. `
      + `<span class="warn">Book exhausted after ${wR.sharesFilled} shares — `
      + `the remaining ${A3_Q - wR.sharesFilled} cannot fill at any price.</span>`;
    revealTakeaway('tk3');
  };
  a3Timer = window.setTimeout(tick, STEP_MS);
});

// idle ladders on load
a3Ladder('a3-left', A3_LEFT, [], 0, false);
a3Ladder('a3-right', A3_RIGHT, [], 0, false);

/* ================ ACT IV — resting orders on a moving price ============== */
// Ported from tools/order-book/main.js Part B, with plain local variables
// (no lib/state.js) — default = the seed-212 stop-loss gap story.

const a4 = {
  ob: /** @type {'lb'|'ls'|'sl'|'sb'} */ ('sl'),
  pb: 54.5,   // the deck's $54.50 stop-loss
  seed: 212,  // gaps from $55.13 THROUGH the stop at bar 30, prints $53.90
};

const pathChart = new Chart($('a4-chart'), {
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
  const type = a4.ob;
  const price = a4.pb;
  const path = makePath(a4.seed);
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

    // outcome sentence (kept verbatim from the order-book tool — gap-risk copy)
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
  $('a4-result').innerHTML = outcome;
  revealTakeaway('tk4'); // Act IV produces its result on load
}

/**
 * Minimal labeled <select> control (copied from the order-book tool —
 * ui.js has no select factory).
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
  return wrap;
}

$('a4-ob').appendChild(selectCtrl({
  label: 'Resting order',
  options: [
    { v: 'lb', label: 'limit buy' },
    { v: 'ls', label: 'limit sell' },
    { v: 'sl', label: 'stop-loss sell' },
    { v: 'sb', label: 'stop-buy' },
  ],
  value: a4.ob,
  onChange: (v) => {
    a4.ob = /** @type {'lb'|'ls'|'sl'|'sb'} */ (v);
    renderPathPanel();
  },
}));

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
  input.value = a4.pb.toFixed(2);
  input.addEventListener('input', () => {
    if (input.value.trim() === '') return; // mid-retype: '' would coerce to 0
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    a4.pb = Math.min(10000, Math.max(0, n)); // sane price range
    renderPathPanel();
  });
  wrap.append(lab, input);
  $('a4-pb').appendChild(wrap);
}

$('a4-btn').addEventListener('click', () => {
  a4.seed = (a4.seed + 1) >>> 0;
  renderPathPanel();
});

/* -------------------------------------------------------------- startup -- */
renderPathPanel();
