// @ts-check
/**
 * main.js — UI for design prototype B "The Unified Ladder" (LOCAL ONLY).
 *
 * One ladder is the only stage. Three verbs act on it:
 *   1. SEND a market order  → one-shot animated walk (fill math cross-checked
 *      against lib/finmath.js walkBook, which is unit-tested on this book);
 *   2. REST a limit order   → it joins its level's FIFO queue (hatched tail);
 *   3. RUN the market       → 60 ticks of seeded crowd flow eat/replenish the
 *      book while the narrator tracks the user's orders.
 *
 * All model state lives in ./flow.js (pure, node-testable). This file is
 * DOM + animation only. No gateTool, no lib/state.js — plain local variables,
 * per the prototype brief.
 *
 * PRESET SEEDS (hunted 2026-07-12 with the throwaway script; deterministic):
 *  - seed 43, limit buy $9.50 × 5: the $9.75 level breaks at tick 18 and the
 *    order goes FIRST IN QUEUE; partial fill of 2 sh at tick 21; the last
 *    3 sh fill at tick 29 — all at $9.50, mid-run as required.
 *  - seed 1011, stop-sell trigger $9.40 × 10: at tick 39 a 13-share sell
 *    SWEEP prints 7 @ $9.50 then 6 @ $9.25 — through the trigger. The stop
 *    fires a market sell of 10 into what's left: 9 @ $9.25 + 1 @ $2.00 →
 *    avg $8.525, slippage $0.875 vs the trigger (≥ $0.20 required); the book
 *    stays two-sided for the rest of the run.
 */

import { Chart, fixed } from '../../lib/chart.js';
import { walkBook } from '../../lib/finmath.js';
import { slider, renderTeX, hydrateLabels } from '../../lib/ui.js';
import { createSim, HORIZON, snapTick } from './flow.js';

hydrateLabels();

/* ------------------------------------------------------------ helpers ---- */
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** "$9.50" @param {number} v */
const usd2 = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** Average prices keep up to 4 decimals, trimmed: 8.375 -> "$8.375". */
function usdAvg(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const [i, dRaw] = Math.abs(v).toFixed(4).split('.');
  let d = dRaw.replace(/0+$/, '');
  if (d.length < 2) d = (d + '00').slice(0, 2);
  return `${v < 0 ? '−' : ''}$${Number(i).toLocaleString('en-US')}.${d}`;
}

/** TeX dollar amount (renderTeX only — \$ breaks renderLabel's splitting). */
const texUsd = (v) => `\\$${v.toFixed(2)}`;

const SVGNS = 'http://www.w3.org/2000/svg';
/** @param {string} name @param {Record<string,string|number>} [attrs] */
function svgEl(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/* -------------------------------------------------------------- state ---- */
// Plain local variables by design (prototype brief): nothing in the URL hash.
const PRESET_LIMIT = { seed: 43, limit: { side: /** @type {'buy'} */ ('buy'), price: 9.50, qty: 5 } };
const PRESET_STOP = { seed: 1011, stop: { dir: /** @type {'sell'} */ ('sell'), trigger: 9.40, qty: 10 } };

let seed = PRESET_LIMIT.seed;
let sim = createSim(seed);
let curTick = 0;
let playing = false;
/** @type {number|null} */ let playTimer = null;
let speed = 1;
const SPEED_MS = { 0.5: 760, 1: 380, 2: 190 };

/** desired user orders, re-applied on every Reset */
/** @type {{side:'buy'|'sell', price:number, qty:number}|null} */ let limitCfg = null;
/** @type {{dir:'sell'|'buy', trigger:number, qty:number}|null} */ let stopCfg = null;

/** sparkline series: one entry per print batch {tick, last} */
/** @type {{tick:number, last:number}[]} */ let tradeSeries = [];

/** sticky narrator message (fill / stop / verdict) vs transient ticker */
/** @type {string|null} */ let narrSticky = null;
let narrLast = 'Fresh book — the deck\'s example. Send a market order, rest a limit order, or press <b>Play</b>.';

let sendSide = /** @type {'buy'|'sell'} */ ('sell');
let restSide = /** @type {'buy'|'sell'} */ ('buy');

/** send-animation state */
/** @type {{pre:any, fills:{price:number,shares:number}[], step:number, timer:number|null, side:'buy'|'sell'}|null} */
let sendAnim = null;
function cancelSendAnim() {
  if (sendAnim && sendAnim.timer != null) clearTimeout(sendAnim.timer);
  sendAnim = null;
}

/* -------------------------------------------------------------- ladder --- */
const NROWS = 5;            // displayed levels per side
const LW = 660;             // viewBox width
const ROW = 40;             // row height
const HEAD = 26;            // header band
const GAP = 46;             // spread band
const X0 = 126;             // bars start
const BARMAX = 372;         // max bar length
const LH = HEAD + 2 * NROWS * ROW + GAP + 14;

/**
 * Draw the hero ladder from a flow.js snapshot.
 * @param {any} snap sim.snapshot()
 * @param {{drain?:Map<number,number>, hot?:number|null, side?:'buy'|'sell'}} [anim]
 *   send-animation overlay: consumed shares per price on the taker's opposite
 *   side, and the level being eaten right now.
 */
function renderLadder(snap, anim) {
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

  // hatch pattern for the user's resting slice
  const defs = svgEl('defs');
  const pat = svgEl('pattern', {
    id: 'youhatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  pat.appendChild(svgEl('rect', { width: 6, height: 6, fill: '#fff', 'fill-opacity': 0.55 }));
  pat.appendChild(svgEl('rect', { width: 2.6, height: 6, fill: 'var(--navy)', 'fill-opacity': 0.6 }));
  defs.appendChild(pat);
  svg.appendChild(defs);

  const asks = snap.asks.slice(0, NROWS);
  const bids = snap.bids.slice(0, NROWS);
  const drain = anim && anim.drain ? anim.drain : null;
  const total = (l) => l.size + l.userQty;
  const maxSize = Math.max(1,
    ...asks.map(total), ...bids.map(total),
    ...(drain ? [...drain.entries()].map(([p, c]) => {
      const all = [...asks, ...bids];
      const lv = all.find((l) => l.price === p);
      return (lv ? total(lv) : 0) + c;
    }) : [0]));
  const scale = BARMAX / maxSize;

  // column headers
  const h1 = svgEl('text', { x: X0 - 22, y: 17, 'text-anchor': 'end', class: 'colhead' });
  h1.textContent = 'Price';
  const h2 = svgEl('text', { x: X0, y: 17, class: 'colhead' });
  h2.textContent = 'Depth (shares) — who is in the queue';
  svg.append(h1, h2);

  /**
   * One book level row.
   * @param {number} yTop @param {any} l dressed level @param {'ask'|'bid'} side
   * @param {boolean} best
   */
  const drawRow = (yTop, l, side, best) => {
    const color = side === 'ask' ? 'var(--gold)' : 'var(--blue)';
    const yBar = yTop + 7;
    const hBar = 26;
    const cons = drain ? (drain.get(l.price) || 0) : 0;
    const hot = anim && anim.hot === l.price;

    const pt = svgEl('text', {
      x: X0 - 22, y: yTop + 24, 'text-anchor': 'end', class: `price ${side}`,
    });
    pt.textContent = usd2(l.price);
    svg.appendChild(pt);
    if (best) {
      const cap = svgEl('text', {
        x: X0 - 22, y: yTop + 36, 'text-anchor': 'end', class: 'bestcap',
      });
      cap.textContent = side === 'ask' ? 'best ask' : 'best bid';
      svg.appendChild(cap);
    }

    // segments in queue order: crowd-ahead | you (hatched) | crowd-behind
    const segs = [];
    if (l.userQty > 0) {
      if (l.userAhead > 0) segs.push({ w: l.userAhead, kind: 'crowd' });
      segs.push({ w: l.userQty, kind: 'you' });
      if (l.userBehind > 0) segs.push({ w: l.userBehind, kind: 'behind' });
    } else if (l.size > 0) {
      segs.push({ w: l.size, kind: 'crowd' });
    }
    let x = X0;
    let youX = null;
    for (const s of segs) {
      const w = s.w * scale;
      if (s.kind === 'you') {
        youX = x;
        svg.appendChild(svgEl('rect', {
          x, y: yBar, width: Math.max(w, 3), height: hBar,
          fill: 'url(#youhatch)', stroke: 'var(--navy)', 'stroke-width': 2, rx: 2,
        }));
      } else {
        svg.appendChild(svgEl('rect', {
          x, y: yBar, width: w, height: hBar,
          fill: color, opacity: s.kind === 'behind' ? 0.5 : 0.88, rx: 2,
        }));
      }
      x += Math.max(w, s.kind === 'you' ? 3 : 0);
    }
    // send-animation drain: hollow dashed slab where shares just vanished
    if (cons > 0) {
      svg.appendChild(svgEl('rect', {
        x, y: yBar, width: cons * scale, height: hBar,
        fill: color, 'fill-opacity': 0.14, rx: 2,
        stroke: hot ? 'var(--navy)' : color,
        'stroke-dasharray': hot ? 'none' : '5 4',
        'stroke-width': hot ? 2.5 : 1.3,
      }));
    }

    // size label at the bar end
    const tot = total(l);
    const st = svgEl('text', {
      x: x + (cons > 0 ? cons * scale : 0) + 8, y: yTop + 24, class: 'sizelabel',
    });
    const t1 = document.createElementNS(SVGNS, 'tspan');
    t1.textContent = `${tot} sh`;
    st.appendChild(t1);
    if (cons > 0) {
      const t2 = document.createElementNS(SVGNS, 'tspan');
      t2.setAttribute('fill', 'var(--red)');
      t2.setAttribute('font-weight', '700');
      t2.textContent = `  −${cons}`;
      st.appendChild(t2);
    }
    svg.appendChild(st);

    // "you" label + queue caption on the user's slice
    if (l.userQty > 0 && youX != null) {
      const midX = youX + Math.max(l.userQty * scale, 3) / 2;
      const yt = svgEl('text', {
        x: midX, y: yBar - 2, 'text-anchor': 'middle', class: 'youcap',
      });
      yt.textContent = `you ×${l.userQty}`;
      svg.appendChild(yt);
      const bc = svgEl('text', {
        x: midX, y: yBar + hBar + 10, 'text-anchor': 'middle', class: 'behindcap',
      });
      bc.textContent = l.userAhead > 0 ? `behind ${l.userAhead} sh` : 'first in queue';
      svg.appendChild(bc);
    }
  };

  // asks above the spread: best (index 0) sits just above the band
  for (let i = 0; i < asks.length; i++) {
    const yTop = HEAD + (NROWS - 1 - i) * ROW;
    drawRow(yTop, asks[i], 'ask', i === 0);
  }
  if (snap.asks.length > NROWS) {
    const extra = snap.asks.slice(NROWS);
    const note = svgEl('text', { x: X0, y: HEAD + 12, class: 'overflow-note' });
    note.textContent = `…+${extra.length} deeper ask level${extra.length > 1 ? 's' : ''} `
      + `(${extra.reduce((s, l) => s + l.size + l.userQty, 0)} sh) not shown`;
    svg.appendChild(note);
  }

  // spread band
  const ySpread = HEAD + NROWS * ROW;
  for (const yy of [ySpread + 4, ySpread + GAP - 4]) {
    svg.appendChild(svgEl('line', {
      x1: X0, y1: yy, x2: X0 + BARMAX, y2: yy,
      stroke: 'var(--grid)', 'stroke-dasharray': '4 4',
    }));
  }
  const spread = snap.bestBid != null && snap.bestAsk != null
    ? snap.bestAsk - snap.bestBid : null;
  const spreadTxt = svgEl('text', {
    x: X0 + BARMAX / 2, y: ySpread + GAP / 2 + 5, 'text-anchor': 'middle',
    class: `spread-note${spread != null && spread < 0 ? ' crossed' : ''}`,
  });
  spreadTxt.textContent = spread == null
    ? 'one side of the book is empty'
    : `bid–ask spread = ${usd2(spread)}`;
  svg.appendChild(spreadTxt);

  // bids below the spread: best (index 0) right under the band
  for (let i = 0; i < bids.length; i++) {
    const yTop = ySpread + GAP + i * ROW;
    drawRow(yTop, bids[i], 'bid', i === 0);
  }
  if (snap.bids.length > NROWS) {
    const extra = snap.bids.slice(NROWS);
    const note = svgEl('text', { x: X0, y: LH - 4, class: 'overflow-note' });
    note.textContent = `…+${extra.length} deeper bid level${extra.length > 1 ? 's' : ''} `
      + `(${extra.reduce((s, l) => s + l.size + l.userQty, 0)} sh) not shown`;
    svg.appendChild(note);
  }

  // rotated side captions
  const sideCap = (y, txt, color) => {
    const t = svgEl('text', {
      x: 14, y, 'text-anchor': 'middle', class: 'sidecap', fill: color,
      transform: `rotate(-90 14 ${y})`,
    });
    t.textContent = txt;
    svg.appendChild(t);
  };
  sideCap(HEAD + (NROWS / 2) * ROW, 'ASKS', 'var(--gold)');
  sideCap(ySpread + GAP + (NROWS / 2) * ROW, 'BIDS', 'var(--blue)');

  // ---- the stop chip: pinned at its trigger's place in the price ladder ----
  const stop = snap.stop;
  if (stop) {
    // displayed rows top→bottom with their center prices
    const rows = [];
    for (let i = 0; i < asks.length; i++) {
      rows.push({ price: asks[i].price, yTop: HEAD + (NROWS - 1 - i) * ROW });
    }
    rows.sort((a, b) => a.yTop - b.yTop);
    for (let i = 0; i < bids.length; i++) {
      rows.push({ price: bids[i].price, yTop: ySpread + GAP + i * ROW });
    }
    // find the boundary y where the trigger price fits (prices descend downward)
    let yLine = LH - 12;
    let placed = false;
    for (const r of rows) {
      if (stop.trigger > r.price) { yLine = r.yTop - 1; placed = true; break; }
    }
    if (!placed && rows.length === 0) yLine = ySpread + GAP / 2;
    const fired = stop.fired;
    const lineCol = fired ? 'var(--axis)' : 'var(--red)';
    svg.appendChild(svgEl('line', {
      x1: X0, y1: yLine, x2: X0 + BARMAX, y2: yLine,
      stroke: lineCol, 'stroke-dasharray': '6 4', 'stroke-width': fired ? 1 : 1.6,
      opacity: fired ? 0.6 : 0.95,
    }));
    const chipW = 120;
    const chip = svgEl('rect', {
      x: 30, y: yLine - 9, width: chipW, height: 18, rx: 9,
      fill: fired ? 'var(--softgray)' : 'var(--red)',
      stroke: fired ? 'var(--axis)' : 'none',
    });
    svg.appendChild(chip);
    const ct = svgEl('text', {
      x: 30 + chipW / 2, y: yLine + 3.5, 'text-anchor': 'middle',
      class: `stopchip-text${fired ? ' fired' : ''}`,
    });
    ct.textContent = fired
      ? `stop fired · t${stop.firedTick}`
      : `STOP ${stop.dir} ${stop.qty} @ ${usd2(stop.trigger)}`;
    svg.appendChild(ct);
  }

  host.appendChild(svg);
}

/* ---------------------------------------------------------- sparkline ---- */
const spark = new Chart($('spark'), {
  width: 980,
  height: 250,
  margin: { top: 16, right: 22, bottom: 44, left: 74 },
  xLabel: 'Tick',
  yLabel: 'Price',
  xFmt: fixed(0),
  yFmt: usd2,
});
let sparkDomainKey = '';

function renderSpark() {
  const snap = sim.snapshot();
  const ys = tradeSeries.map((t) => t.last);
  if (limitCfg) ys.push(limitCfg.price);
  if (stopCfg) ys.push(stopCfg.trigger);
  if (snap.bestBid != null) ys.push(snap.bestBid);
  if (snap.bestAsk != null && snap.bestAsk < 15) ys.push(snap.bestAsk);
  if (!ys.length) ys.push(9.5, 10.25);
  const lo = Math.min(...ys) - 0.35;
  const hi = Math.max(...ys) + 0.35;
  const key = `${lo.toFixed(2)}|${hi.toFixed(2)}`;
  if (key !== sparkDomainKey) {
    sparkDomainKey = key;
    spark.setDomain(0, HORIZON, lo, hi)
      .renderAxes({ xTicks: [0, 10, 20, 30, 40, 50, 60], yTickCount: 6 });
  }
  spark.clearData();

  // user's resting prices: RED dashed reference lines
  if (limitCfg) {
    spark.hline(limitCfg.price, { stroke: 'var(--red)', dash: '7 5', width: 1.6, opacity: 0.9 });
    spark.text(HORIZON - 0.5, limitCfg.price, `your limit ${usd2(limitCfg.price)}`, {
      anchor: 'end', dy: limitCfg.side === 'buy' ? 14 : -6, fill: 'var(--red)',
    });
  }
  if (stopCfg) {
    spark.hline(stopCfg.trigger, { stroke: 'var(--red)', dash: '2 4', width: 1.6, opacity: 0.9 });
    spark.text(HORIZON - 0.5, stopCfg.trigger, `stop trigger ${usd2(stopCfg.trigger)}`, {
      anchor: 'end', dy: stopCfg.dir === 'sell' ? 14 : -6, fill: 'var(--red)',
    });
  }

  // last-trade path, drawn left→right as the run progresses
  const pts = tradeSeries.map((t) => ({ x: t.tick, y: t.last }));
  if (pts.length === 1) {
    spark.point(pts[0].x, pts[0].y, { r: 3, fill: 'var(--blue)' });
  } else if (pts.length > 1) {
    spark.path(pts, { stroke: 'var(--blue)', width: 2.2 });
  }

  // user's limit fills: gold dots
  if (snap.limit) {
    for (const f of snap.limit.fills) {
      spark.point(f.tick, f.price, { r: 5, fill: 'var(--gold)', stroke: '#fff' });
    }
  }
  // stop fire: red dot at the average execution price
  if (snap.stop && snap.stop.fired && snap.stop.avgPrice != null) {
    spark.point(snap.stop.firedTick, snap.stop.avgPrice, { r: 6, fill: 'var(--red)', stroke: '#fff' });
    spark.text(snap.stop.firedTick, snap.stop.avgPrice,
      `stop avg ${usdAvg(snap.stop.avgPrice)}`, {
        dx: snap.stop.firedTick > 42 ? -10 : 10, dy: 16,
        anchor: snap.stop.firedTick > 42 ? 'end' : 'start', fill: 'var(--red)',
      });
  }
}

/* ------------------------------------------------------------ readouts --- */
function renderReadouts(snap) {
  const spread = snap.bestBid != null && snap.bestAsk != null
    ? snap.bestAsk - snap.bestBid : null;
  const lastT = tradeSeries.length ? tradeSeries[tradeSeries.length - 1].last : null;
  let orderTxt = '—';
  if (snap.limit) {
    const L = snap.limit;
    orderTxt = L.done
      ? `limit ${L.side} filled ✓`
      : `limit ${L.side} ${usd2(L.price)} — ${L.queueAhead} sh ahead`;
  } else if (limitCfg) {
    orderTxt = 'limit executed';
  }
  const rows = [
    ['Tick', `${snap.tick} / ${HORIZON}`, ''],
    ['Best bid', snap.bestBid != null ? usd2(snap.bestBid) : '—', 'blue'],
    ['Best ask', snap.bestAsk != null ? usd2(snap.bestAsk) : '—', 'gold'],
    ['Spread', spread != null ? usd2(spread) : '—', ''],
    ['Last trade', lastT != null ? usd2(lastT) : '—', ''],
    ['Your resting order', orderTxt, 'blue'],
  ];
  const host = $('readouts');
  host.replaceChildren();
  for (const [k, val, cls] of rows) {
    const cell = document.createElement('div');
    cell.className = 'readout';
    const key = document.createElement('div');
    key.className = 'k';
    key.textContent = String(k);
    const vv = document.createElement('div');
    vv.className = `v ${cls}`;
    vv.textContent = String(val);
    cell.append(key, vv);
    host.appendChild(cell);
  }
}

/* ------------------------------------------------------------ narrator --- */
function paintNarrator() {
  $('narrator').innerHTML = narrSticky ?? narrLast;
}

/** derive narrator lines from one tick's record @param {any} rec @param {any} prevSnap */
function narrate(rec, prevSnap) {
  const t = rec.tick;
  const snap = rec.snapshot;

  // --- sticky events (they end a story) -----------------------------------
  const stopEv = rec.events.find((e) => e.type === 'stop-fired');
  if (stopEv && snap.stop) {
    const S = snap.stop;
    const filledTxt = S.filledQty < S.qty
      ? ` Only ${S.filledQty} of ${S.qty} sh could fill — the book ran out.`
      : '';
    narrSticky = `<span class="bad">Stop fired at tick ${t}</span>: trigger `
      + `${usd2(S.trigger)}, executed ${S.filledQty} sh at avg <b>${usdAvg(S.avgPrice)}</b>`
      + ` — slippage <b>${usdAvg(Math.abs(S.slippage ?? 0))}</b>.${filledTxt}`
      + ` A stop caps nothing; it fires a <b>market order</b> into whatever depth is left.`;
    return;
  }
  const L = snap.limit;
  const pL = prevSnap ? prevSnap.limit : null;
  if (L && L.done && (!pL || !pL.done)) {
    narrSticky = `<span class="good">Filled at tick ${t} ✓</span> — your limit `
      + `${L.side} of ${L.qty} sh executed at <b>${usd2(L.price)}</b>, the price `
      + `you named. The cost: you had to <b>wait in line</b> for the market to come to you.`;
    return;
  }
  if (narrSticky) return; // a finished story stays on screen

  // --- transient ticker ----------------------------------------------------
  const youFills = rec.trades.filter((x) => x.maker === 'you');
  if (youFills.length && L && !L.done) {
    const got = youFills.reduce((s, x) => s + x.size, 0);
    narrLast = `Tick ${t}: <span class="good">partial fill</span> — ${got} sh of your `
      + `limit ${L.side} traded at <b>${usd2(L.price)}</b>; ${L.qty - L.filled} sh still resting.`;
    return;
  }
  if (L && !L.done && pL && pL.queueAhead > 0 && L.queueAhead === 0) {
    const prevBest = L.side === 'buy' ? prevSnap.bestBid : prevSnap.bestAsk;
    const nowBest = L.side === 'buy' ? rec.bestBid : rec.bestAsk;
    const broke = prevBest != null && nowBest != null && prevBest !== nowBest
      ? `the ${usd2(prevBest)} level broke — ` : '';
    narrLast = `Tick ${t}: ${broke}your limit ${L.side} at ${usd2(L.price)} is now `
      + `<span class="good">first in queue</span>. The next market `
      + `${L.side === 'buy' ? 'sell' : 'buy'} is yours.`;
    return;
  }
  if (prevSnap && rec.bestBid != null && prevSnap.bestBid != null
    && rec.bestBid < prevSnap.bestBid) {
    narrLast = `Tick ${t}: the ${usd2(prevSnap.bestBid)} bid level broke — `
      + `best bid is now <b>${usd2(rec.bestBid)}</b>.`;
    return;
  }
  if (prevSnap && rec.bestAsk != null && prevSnap.bestAsk != null
    && rec.bestAsk > prevSnap.bestAsk) {
    narrLast = `Tick ${t}: the ${usd2(prevSnap.bestAsk)} ask level broke — `
      + `best ask is now <b>${usd2(rec.bestAsk)}</b>.`;
    return;
  }
  const mk = rec.events.find((e) => e.type === 'market');
  if (mk) {
    const px = rec.trades.length ? rec.trades[rec.trades.length - 1].price : null;
    narrLast = `Tick ${t}: <span class="dim">market ${mk.side} ${mk.size}`
      + `${mk.filled < mk.size ? ` (only ${mk.filled} filled)` : ''}`
      + `${px != null ? ` — last print ${usd2(px)}` : ''}.</span>`;
    return;
  }
  const ad = rec.events.find((e) => e.type === 'add');
  if (ad) {
    narrLast = `Tick ${t}: <span class="dim">+${ad.qty} sh rest at ${usd2(ad.price)} `
      + `(${ad.side} side) — someone else's limit order joins the book.</span>`;
  }
}

/** end-of-run verdicts (execution risk / stop never fired) */
function narrateEnd() {
  const snap = sim.snapshot();
  const L = snap.limit;
  if (L && !L.done) {
    const part = L.filled > 0 ? ` (${L.filled} of ${L.qty} sh did fill)` : '';
    narrSticky = `<span class="bad">Never filled in ${HORIZON} ticks</span>${part} — `
      + `the market never traded through ${usd2(L.price)} deep enough to reach you. `
      + `<b>Execution risk is real</b>: a limit order fixes the price, not the trade.`;
  } else if (snap.stop && !snap.stop.fired) {
    narrLast = `End of run: the stop at ${usd2(snap.stop.trigger)} never triggered `
      + `in ${HORIZON} ticks — no trade printed through it.`;
  } else if (!narrSticky) {
    narrLast = `End of run — ${HORIZON} ticks. Reset to replay this same market `
      + `(same seed), or draw a new seed.`;
  }
}

/* --------------------------------------------------------- render cycle -- */
function renderAll() {
  const snap = sim.snapshot();
  renderLadder(snap);
  renderSpark();
  renderReadouts(snap);
  paintNarrator();
  syncOrderStatus(snap);
}

function syncOrderStatus(snap) {
  const rs = $('rest-status');
  if (snap.limit) {
    const L = snap.limit;
    rs.innerHTML = L.done
      ? `<b>Filled ✓</b> — ${L.qty} sh at ${usd2(L.price)}.`
      : `Resting: limit ${L.side} <b>${usd2(L.price)} × ${L.qty - L.filled}</b> — `
        + `<b>${L.queueAhead} sh ahead</b> of you${L.filled ? `; ${L.filled} sh already filled` : ''}.`;
  } else if (limitCfg) {
    rs.innerHTML = 'Your limit order executed in full (marketable) — nothing resting.';
  } else {
    rs.innerHTML = 'Your order becomes part of the book — behind everyone already at that price.';
  }
  const ss = $('stop-status');
  if (snap.stop) {
    const S = snap.stop;
    ss.innerHTML = S.fired
      ? `<span class="warn">Fired at tick ${S.firedTick}</span> — ${S.filledQty} sh, `
        + `avg ${usdAvg(S.avgPrice)} (slippage ${usdAvg(Math.abs(S.slippage ?? 0))}).`
      : `Armed: ${S.dir === 'sell' ? 'sell' : 'buy'} <b>${S.qty} sh</b> if a trade prints `
        + `${S.dir === 'sell' ? 'at or below' : 'at or above'} <b>${usd2(S.trigger)}</b>. `
        + `Invisible to the market.`;
  } else {
    ss.innerHTML = 'A stop does <b>not</b> rest in the book — nobody sees it. '
      + 'When a trade prints through the trigger it fires a market order.';
  }
}

/* ------------------------------------------------------------ run logic -- */
function doStep() {
  cancelSendAnim();
  const prevSnap = sim.snapshot();
  const rec = sim.step();
  if (!rec) return;
  curTick = rec.tick;
  if (rec.lastTrade != null) tradeSeries.push({ tick: rec.tick, last: rec.lastTrade });
  narrate(rec, prevSnap);
  if (curTick >= sim.horizon) narrateEnd();
  renderAll();
}

function stopPlay() {
  playing = false;
  if (playTimer != null) { clearTimeout(playTimer); playTimer = null; }
  $('btn-play').innerHTML = '&#9654; Play';
}

function playLoop() {
  playTimer = window.setTimeout(() => {
    doStep();
    if (playing && curTick < sim.horizon) playLoop();
    else stopPlay();
  }, SPEED_MS[speed] ?? 380);
}

function play() {
  if (playing) { stopPlay(); return; }
  if (curTick >= sim.horizon) resetRun();
  playing = true;
  $('btn-play').innerHTML = '&#10073;&#10073; Pause';
  playLoop();
}

/** rebuild the sim from the current seed and re-apply the user's orders */
function resetRun() {
  stopPlay();
  cancelSendAnim();
  sim = createSim(seed);
  curTick = 0;
  tradeSeries = [];
  narrSticky = null;
  narrLast = 'Fresh book (same seed = same market). '
    + (limitCfg || stopCfg ? 'Your orders are re-placed at tick 0 — press <b>Play</b>.'
      : 'Send, rest, or press <b>Play</b>.');
  if (limitCfg) {
    const res = sim.restLimit(limitCfg.side, limitCfg.price, limitCfg.qty);
    if (res.marketable) handleMarketableRest(res, limitCfg.side, true);
  }
  if (stopCfg) sim.armStop(stopCfg.dir, stopCfg.trigger, stopCfg.qty);
  $('seed-val').textContent = String(seed);
  renderAll();
  renderSendFormula(null);
}

/* --------------------------------------------------- verb 1: SEND -------- */
const sendQ = slider({
  label: 'Order size (shares)', min: 0, max: 40, step: 1, value: 30,
  fmt: (v) => `${Math.round(v)} sh`,
  onChange: () => {},
});
$('ctrl-sendq').appendChild(sendQ);

function syncSendButtons() {
  $('btn-send-buy').classList.toggle('active', sendSide === 'buy');
  $('btn-send-sell').classList.toggle('active', sendSide === 'sell');
}
$('btn-send-buy').addEventListener('click', () => { sendSide = 'buy'; syncSendButtons(); });
$('btn-send-sell').addEventListener('click', () => { sendSide = 'sell'; syncSendButtons(); });
syncSendButtons();

/** the arithmetic line above the ladder @param {any} walk walkBook result */
function renderSendFormula(walk, side = 'sell', q = 0) {
  const host = $('f-send');
  $('f-send-strip').hidden = !walk;
  if (!walk) { host.textContent = ''; return; }
  const verb = side === 'buy' ? 'Buy' : 'Sell';
  if (!walk.fills.length) {
    renderTeX(host, `\\text{${verb} } ${q}\\text{: nothing to fill}`);
    return;
  }
  const terms = walk.fills.map((f) => `${f.shares}\\times${texUsd(f.price)}`).join(' + ');
  const avgTeX = walk.avgPrice != null ? `\\$${usdAvg(walk.avgPrice).replace(/^\$/, '')}` : '';
  const exhausted = walk.sharesFilled < q
    ? `\\;\\; \\textcolor{#D62728}{(\\text{book exhausted at } ${walk.sharesFilled})}` : '';
  renderTeX(host,
    `\\text{${verb} } ${q}\\text{: } ${terms} = \\mathbf{${texUsd(walk.total)}}`
    + `\\;\\Rightarrow\\; \\bar{p} = ${avgTeX}${exhausted}`);
}

$('btn-send').addEventListener('click', () => {
  cancelSendAnim();
  const q = Math.round(sendQ.value);
  if (q <= 0) { $('send-status').textContent = 'Set an order size first.'; return; }
  const pre = sim.snapshot();
  // cross-check with the unit-tested walkBook on the merged displayed depth
  const mergedLevels = (sendSide === 'buy' ? pre.asks : pre.bids)
    .map((l) => ({ price: l.price, size: l.size + l.userQty }));
  const walk = walkBook(mergedLevels, q);
  const res = sim.sendMarket(sendSide, q);
  // record the prints for the sparkline at the current tick
  if (res.trades.length) {
    tradeSeries.push({ tick: curTick, last: res.trades[res.trades.length - 1].price });
  }
  renderSendFormula(walk, sendSide, q);
  const what = sendSide === 'buy' ? 'costs' : 'brings in';
  const fillsTxt = res.own.map((f) => `${f.size} @ ${usd2(f.price)}`).join(', ');
  let html = res.own.length
    ? `${sendSide === 'buy' ? 'Bought' : 'Sold'} <b>${res.filled} sh</b> (${fillsTxt}) — `
      + `${what} <b>${usd2(res.total)}</b>, avg <b>${usdAvg(res.avgPrice)}</b>.`
    : 'Nothing filled — no depth on that side.';
  if (res.filled < q) {
    html += ` <span class="warn">Book exhausted after ${res.filled} sh.</span>`;
  }
  $('send-status').innerHTML = html;
  if (res.stopFills.length) {
    // the user's own market order tripped their own stop — tell the story
    const snap = sim.snapshot();
    narrate({ tick: curTick, events: [{ type: 'stop-fired' }], trades: res.trades, snapshot: snap, bestBid: snap.bestBid, bestAsk: snap.bestAsk }, pre);
  } else {
    narrLast = `You sent a market ${sendSide} of ${q} sh — it ate the book `
      + `level by level. The book is now ${res.filled} sh thinner.`;
  }
  // animate the walk on the PRE-action book, then settle on the real state
  const fills = res.own.map((f) => ({ price: f.price, shares: f.size }));
  // merge consecutive same-price fills (queue segments print separately)
  const merged = [];
  for (const f of fills) {
    const lastF = merged[merged.length - 1];
    if (lastF && lastF.price === f.price) lastF.shares += f.shares;
    else merged.push({ ...f });
  }
  if (!merged.length) { renderAll(); return; }
  sendAnim = { pre, fills: merged, step: 0, timer: null, side: sendSide };
  const tickAnim = () => {
    if (!sendAnim) return;
    sendAnim.step += 1;
    if (sendAnim.step > sendAnim.fills.length) {
      sendAnim = null;
      renderAll();
      return;
    }
    const drain = new Map();
    for (let i = 0; i < sendAnim.step; i++) {
      const f = sendAnim.fills[i];
      drain.set(f.price, (drain.get(f.price) || 0) + f.shares);
    }
    const hot = sendAnim.fills[sendAnim.step - 1].price;
    renderLadder(sendAnim.pre, { drain, hot, side: sendAnim.side });
    sendAnim.timer = window.setTimeout(tickAnim, 320);
  };
  renderLadder(pre, { drain: new Map(), hot: null, side: sendSide });
  sendAnim.timer = window.setTimeout(tickAnim, 320);
});

/* --------------------------------------------------- verb 2: REST -------- */
function syncRestButtons() {
  $('btn-rest-buy').classList.toggle('active', restSide === 'buy');
  $('btn-rest-sell').classList.toggle('active', restSide === 'sell');
}
$('btn-rest-buy').addEventListener('click', () => { restSide = 'buy'; syncRestButtons(); });
$('btn-rest-sell').addEventListener('click', () => { restSide = 'sell'; syncRestButtons(); });
syncRestButtons();

/** narrate a marketable rest (crossed the opposite best) @param {any} res */
function handleMarketableRest(res, side, quiet = false) {
  const own = res.trades.filter((x) => x.taker === 'you');
  const got = own.reduce((s, x) => s + x.size, 0);
  const total = own.reduce((s, x) => s + x.price * x.size, 0);
  if (res.trades.length) {
    tradeSeries.push({ tick: curTick, last: res.trades[res.trades.length - 1].price });
  }
  if (quiet) return;
  const restTxt = res.rested
    ? ` The remaining <b>${res.remaining} sh</b> now rest at ${usd2(res.price)}.`
    : '';
  narrLast = `Your ${side} limit at ${usd2(res.price)} <b>crosses the opposite best</b> — `
    + `it is marketable and executed immediately as a market order: ${got} sh at `
    + `avg <b>${usdAvg(got ? total / got : null)}</b>.${restTxt}`;
}

$('btn-rest').addEventListener('click', () => {
  cancelSendAnim();
  const priceIn = Number(/** @type {HTMLInputElement} */ ($('in-rest-price')).value);
  const qtyIn = Number(/** @type {HTMLInputElement} */ ($('in-rest-qty')).value);
  if (!Number.isFinite(priceIn) || priceIn <= 0 || !Number.isFinite(qtyIn) || qtyIn < 1) {
    $('rest-status').innerHTML = '<span class="warn">Enter a price and a quantity first.</span>';
    return;
  }
  const price = snapTick(priceIn);
  const qty = Math.max(1, Math.min(20, Math.round(qtyIn)));
  /** @type {HTMLInputElement} */ ($('in-rest-price')).value = price.toFixed(2);
  /** @type {HTMLInputElement} */ ($('in-rest-qty')).value = String(qty);
  const res = sim.restLimit(restSide, price, qty);
  limitCfg = { side: restSide, price, qty };
  narrSticky = null; // a new order starts a new story
  if (res.marketable) {
    handleMarketableRest(res, restSide);
  } else {
    narrLast = `Your limit ${restSide} <b>${usd2(price)} × ${qty}</b> joined the book — `
      + `<b>${res.queueAhead} sh</b> are ahead of you at that price. `
      + `Now <b>run the market</b> and wait your turn.`;
  }
  $('btn-rest').textContent = 'Replace resting order';
  renderAll();
});

$('btn-cancel-limit').addEventListener('click', () => {
  sim.cancelLimit();
  limitCfg = null;
  narrSticky = null;
  narrLast = 'Limit order cancelled — your shares left the queue.';
  $('btn-rest').textContent = 'Rest in the book';
  renderAll();
});

/* ----------------------------------------------------- stop controls ----- */
$('btn-arm').addEventListener('click', () => {
  const dir = /** @type {'sell'|'buy'} */ (/** @type {HTMLSelectElement} */ ($('sel-stop-dir')).value);
  const trig = Number(/** @type {HTMLInputElement} */ ($('in-stop-trig')).value);
  const qty = Number(/** @type {HTMLInputElement} */ ($('in-stop-qty')).value);
  if (!Number.isFinite(trig) || trig <= 0 || !Number.isFinite(qty) || qty < 1) {
    $('stop-status').innerHTML = '<span class="warn">Enter a trigger and a quantity first.</span>';
    return;
  }
  stopCfg = { dir, trigger: trig, qty: Math.max(1, Math.min(20, Math.round(qty))) };
  sim.armStop(stopCfg.dir, stopCfg.trigger, stopCfg.qty);
  narrSticky = null;
  narrLast = `Stop armed: ${dir} ${stopCfg.qty} sh if a trade prints `
    + `${dir === 'sell' ? 'at or below' : 'at or above'} <b>${usd2(trig)}</b>. `
    + `Note it does <b>not</b> appear in anyone's book.`;
  renderAll();
});

$('btn-disarm').addEventListener('click', () => {
  sim.disarmStop();
  stopCfg = null;
  narrLast = 'Stop disarmed.';
  renderAll();
});

/* --------------------------------------------------- verb 3: RUN --------- */
$('btn-play').addEventListener('click', play);
$('btn-step').addEventListener('click', () => { stopPlay(); doStep(); });
$('btn-reset').addEventListener('click', resetRun);
$('sel-speed').addEventListener('change', () => {
  speed = Number(/** @type {HTMLSelectElement} */ ($('sel-speed')).value) || 1;
});
$('btn-seed').addEventListener('click', () => {
  seed = 1 + Math.floor(Math.random() * 99999);
  resetRun();
});

/* -------------------------------------------------------------- presets -- */
/** sync the verb-card inputs so the preset's order is visible in the controls */
function syncControlsToPreset() {
  if (limitCfg) {
    restSide = limitCfg.side;
    /** @type {HTMLInputElement} */ ($('in-rest-price')).value = limitCfg.price.toFixed(2);
    /** @type {HTMLInputElement} */ ($('in-rest-qty')).value = String(limitCfg.qty);
    $('btn-rest').textContent = 'Replace resting order';
  }
  if (stopCfg) {
    /** @type {HTMLSelectElement} */ ($('sel-stop-dir')).value = stopCfg.dir;
    /** @type {HTMLInputElement} */ ($('in-stop-trig')).value = stopCfg.trigger.toFixed(2);
    /** @type {HTMLInputElement} */ ($('in-stop-qty')).value = String(stopCfg.qty);
  }
  syncRestButtons();
}

$('btn-preset-limit').addEventListener('click', () => {
  // seed 43: $9.75 breaks t18 → first in queue; 2 sh fill t21; done t29.
  stopPlay();
  seed = PRESET_LIMIT.seed;
  limitCfg = { ...PRESET_LIMIT.limit };
  stopCfg = null;
  syncControlsToPreset();
  resetRun();
  narrLast = `Preset: a limit buy <b>$9.50 × 5</b> rests behind the 10 sh already `
    + `quoted at $9.50. Will the market trade down through $9.75 — and then through `
    + `the queue ahead of you? Watch.`;
  paintNarrator();
  play();
});

$('btn-preset-stop').addEventListener('click', () => {
  // seed 1011: t39 a 13-sh sell sweep prints 7 @ $9.50 + 6 @ $9.25 (through
  // the $9.40 trigger); the stop's market sell gets 9 @ $9.25 + 1 @ $2.00 →
  // avg $8.525, slippage $0.875.
  stopPlay();
  seed = PRESET_STOP.seed;
  stopCfg = { ...PRESET_STOP.stop };
  limitCfg = null;
  syncControlsToPreset();
  resetRun();
  narrLast = `Preset: a stop-sell of <b>10 sh</b> is armed at trigger <b>$9.40</b>. `
    + `It is invisible to the market — until a big sell sweep prints through $9.40 `
    + `and the stop fires a market order into whatever depth is left.`;
  paintNarrator();
  play();
});

/* ------------------------------------------------------------- startup --- */
resetRun();
narrLast = 'Fresh book — the deck\'s example. Send a market order (try Sell 30), '
  + 'rest a limit order, or run a preset story.';
paintNarrator();
