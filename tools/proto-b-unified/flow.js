// @ts-check
/**
 * flow.js — pure order-flow model for design prototype B "The Unified Ladder"
 * (FIN 30600, Lecture 2 §3). LOCAL PROTOTYPE — not deployed.
 *
 * NO DOM anywhere in this file: it is importable in plain node for tests and
 * seed hunting.
 *
 * One ladder, every order — the didactic contract this model enforces:
 *  1. the book IS other people's resting limit orders;
 *  2. the user's limit order joins its level's FIFO queue as a tagged tail —
 *     `queueAhead` crowd shares fill first, crowd shares added later line up
 *     BEHIND the user;
 *  3. market orders (the seeded crowd flow, the user's own sends, and stop
 *     fires) eat the opposite side of the book best-first;
 *  4. a stop order does NOT rest in the book — nobody sees it. When a trade
 *     prints at/through the trigger it fires a market order into whatever
 *     depth is left at that moment: gap risk from mechanism, not assertion.
 *
 * Determinism: one mulberry32 stream per sim. Same seed + same user actions
 * at the same ticks → bit-identical history (the presets rely on this).
 */

import { mulberry32 } from '../../lib/finmath.js';

export const TICK = 0.25;
export const HORIZON = 60;

/** The deck's hypothetical book (Lecture 2, sec3_trading "Market order"). */
export const START_BOOK = {
  bids: [{ price: 9.75, size: 15 }, { price: 9.50, size: 10 }, { price: 2.00, size: 10 }],
  asks: [{ price: 10.25, size: 15 }, { price: 11.50, size: 10 }, { price: 20.00, size: 10 }],
};

/**
 * Event-mix constants. Tuned (via the throwaway seed hunt, 2026-07-12) so
 * both preset narratives exist: a mid-run limit fill AND a stop-sell that
 * fires with visible slippage. Roughly 65% market orders / 35% liquidity adds.
 */
export const MIX = {
  pMarket: 0.62,      // else: liquidity add (≈62/38 keeps eat ≈ replenish —
                      // at 65/35 with 2–6-share adds the whole book starved
                      // to empty by ~tick 50 on most seeds)
  pSweep: 0.07,       // big sweep, size 10–14 — this is where gaps come from
  baseMax: 8,         // ordinary market-order size 1–8, skewed small
  addMin: 3,
  addMax: 7,
  pAddExisting: 0.55, // add 3–7 sh to a random existing level ...
  pAddInside: 0.25,   // ... or a new level one tick INSIDE the best ...
                      // ... else a new level one tick BEYOND the best
};

/** Snap a price to the $0.25 grid (exact in binary floating point). */
export const snapTick = (p) => Math.round(p * 4) / 4;

/** @param {{bids:{price:number,size:number}[], asks:{price:number,size:number}[]}} b */
function cloneBook(b) {
  return { bids: b.bids.map((l) => ({ ...l })), asks: b.asks.map((l) => ({ ...l })) };
}

/**
 * Create a stepping simulation. The returned object mutates its own private
 * state; call `snapshot()` for immutable copies to keep/render.
 *
 * @param {number} seed mulberry32 seed
 * @param {object} [opts]
 * @param {number} [opts.ticks=HORIZON] run horizon
 * @param {{bids:{price:number,size:number}[], asks:{price:number,size:number}[]}} [opts.book]
 */
export function createSim(seed, opts = {}) {
  const rng = mulberry32(Number(seed) >>> 0);
  const horizon = opts.ticks ?? HORIZON;
  const book = cloneBook(opts.book ?? START_BOOK);
  let tick = 0;

  /**
   * The user's ONE resting limit order (the tagged tail of its level) or null.
   * @type {{side:'buy'|'sell', price:number, qty:number, reqQty:number,
   *   filled:number, queueAhead:number, fills:{tick:number,price:number,size:number}[],
   *   done:boolean, doneTick?:number, restTick:number} | null}
   */
  let limit = null;

  /**
   * The user's ONE stop order or null. NOT part of the book.
   * @type {{dir:'sell'|'buy', trigger:number, qty:number, fired:boolean,
   *   firedTick?:number, fills:{price:number,size:number}[], filledQty?:number,
   *   avgPrice?:number|null, slippage?:number|null} | null}
   */
  let stop = null;

  const stats = { adds: 0, printed: 0 };
  /** last price any trade printed at (reference for rebuilding an empty side) */
  let lastPrint = /** @type {number|null} */ (null);

  /** levels a limit order of `side` rests on: buys rest among the bids */
  const restLevels = (side) => (side === 'buy' ? book.bids : book.asks);

  const remainingQty = () => (limit ? limit.qty - limit.filled : 0);
  /** is the user's live limit resting at this side+price? @param {'buy'|'sell'} side @param {number} price */
  const userAt = (side, price) =>
    !!limit && !limit.done && limit.side === side && limit.price === price && remainingQty() > 0;

  /**
   * Best quoted price on a side, INCLUDING the user's resting order (a level
   * whose only depth is the user is still a real quote).
   * @param {'bid'|'ask'} sideName @returns {number|null}
   */
  function best(sideName) {
    const side = sideName === 'bid' ? 'buy' : 'sell';
    for (const l of (sideName === 'bid' ? book.bids : book.asks)) {
      if (l.size > 0 || userAt(side, l.price)) return l.price;
    }
    return null;
  }

  /** insert a new empty level, keeping best-first order (bids desc, asks asc) */
  function insertLevel(levels, side, price) {
    const isBetter = side === 'buy'
      ? (a, b) => a > b   // bids: higher price is better
      : (a, b) => a < b;  // asks: lower price is better
    let i = 0;
    while (i < levels.length && isBetter(levels[i].price, price)) i++;
    const lvl = { price, size: 0 };
    levels.splice(i, 0, lvl);
    return lvl;
  }

  /** drop carrier levels with no crowd depth and no live user order */
  function sweepEmpty(levels, side) {
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i].size === 0 && !userAt(side, levels[i].price)) levels.splice(i, 1);
    }
  }

  /**
   * A market order consumes the opposite side best-first. FIFO at the user's
   * level: `queueAhead` crowd shares fill first, then the user, then crowd
   * shares that arrived after the user (invariant: queueAhead ≤ level.size).
   * @param {'buy'|'sell'} side taker side ('buy' eats asks)
   * @param {number} qty shares
   * @param {'crowd'|'you'|'you-stop'} taker who sent the order
   * @param {number|null} [limitPrice] marketable-limit cap: stop at worse prices
   * @returns {{price:number,size:number,maker:'crowd'|'you',taker:string,tick:number}[]}
   */
  function executeMarket(side, qty, taker, limitPrice = null) {
    const levels = side === 'buy' ? book.asks : book.bids;
    const makerSide = side === 'buy' ? 'sell' : 'buy';
    let rem = Math.max(0, Math.round(qty));
    const trades = [];
    while (rem > 0 && levels.length) {
      const lvl = levels[0];
      if (limitPrice != null
        && (side === 'buy' ? lvl.price > limitPrice : lvl.price < limitPrice)) break;
      const hasUser = userAt(makerSide, lvl.price);
      // 1) crowd shares AHEAD of the user in the queue
      const ahead = hasUser && limit ? Math.min(limit.queueAhead, lvl.size) : lvl.size;
      const take1 = Math.min(rem, ahead);
      if (take1 > 0) {
        lvl.size -= take1;
        if (hasUser && limit) limit.queueAhead -= take1;
        trades.push({ price: lvl.price, size: take1, maker: 'crowd', taker, tick });
        rem -= take1;
      }
      // 2) the user's resting order (only once the queue ahead is exhausted)
      if (rem > 0 && hasUser && limit && limit.queueAhead === 0) {
        const take2 = Math.min(rem, remainingQty());
        if (take2 > 0) {
          limit.filled += take2;
          limit.fills.push({ tick, price: lvl.price, size: take2 });
          trades.push({ price: lvl.price, size: take2, maker: 'you', taker, tick });
          rem -= take2;
          if (limit.filled >= limit.qty) { limit.done = true; limit.doneTick = tick; }
        }
      }
      // 3) crowd shares that lined up BEHIND the user
      if (rem > 0 && lvl.size > 0 && (!hasUser || (limit && limit.queueAhead === 0))) {
        const take3 = Math.min(rem, lvl.size);
        lvl.size -= take3;
        trades.push({ price: lvl.price, size: take3, maker: 'crowd', taker, tick });
        rem -= take3;
      }
      if (lvl.size === 0 && !userAt(makerSide, lvl.price)) { levels.shift(); continue; }
      break; // residual depth remains ⇒ the order is done (rem === 0)
    }
    stats.printed += trades.reduce((s, t) => s + t.size, 0);
    if (trades.length) lastPrint = trades[trades.length - 1].price;
    return trades;
  }

  /**
   * After any batch of prints, check the stop: if a trade crossed the trigger
   * (≤ for stop-sell, ≥ for stop-buy) the stop fires a market order into the
   * CURRENT book — i.e. into whatever the crossing flow left behind.
   * @param {{price:number,size:number}[]} newTrades
   * @returns {ReturnType<executeMarket>|null} the stop's own fills, or null
   */
  function fireStopIfHit(newTrades) {
    if (!stop || stop.fired || !newTrades.length) return null;
    const s = stop;
    const hit = newTrades.some((t) =>
      (s.dir === 'sell' ? t.price <= s.trigger : t.price >= s.trigger));
    if (!hit) return null;
    s.fired = true;
    s.firedTick = tick;
    const fills = executeMarket(s.dir, s.qty, 'you-stop');
    const filled = fills.reduce((a, t) => a + t.size, 0);
    const total = fills.reduce((a, t) => a + t.price * t.size, 0);
    s.fills = fills.map((t) => ({ price: t.price, size: t.size }));
    s.filledQty = filled;
    s.avgPrice = filled ? total / filled : null;
    s.slippage = filled
      ? (s.dir === 'sell' ? s.trigger - /** @type {number} */ (s.avgPrice) : /** @type {number} */ (s.avgPrice) - s.trigger)
      : null;
    return fills;
  }

  function addLiquidity(sideName, price, qty) {
    const side = sideName === 'bid' ? 'buy' : 'sell';
    const levels = sideName === 'bid' ? book.bids : book.asks;
    let lvl = levels.find((l) => l.price === price);
    if (!lvl) lvl = insertLevel(levels, side, price);
    lvl.size += qty;
    stats.adds += qty;
  }

  /** immutable snapshot for the UI / history */
  function snapshot() {
    const dress = (levels, side) => levels.map((l) => {
      const u = userAt(side, l.price);
      return {
        price: l.price,
        size: l.size,
        userAhead: u && limit ? limit.queueAhead : 0,
        userQty: u && limit ? limit.qty - limit.filled : 0,
        userBehind: u && limit ? l.size - limit.queueAhead : 0,
      };
    });
    return {
      tick,
      bids: dress(book.bids, 'buy'),
      asks: dress(book.asks, 'sell'),
      bestBid: best('bid'),
      bestAsk: best('ask'),
      limit: limit ? { ...limit, fills: limit.fills.map((f) => ({ ...f })) } : null,
      stop: stop ? { ...stop, fills: (stop.fills || []).map((f) => ({ ...f })) } : null,
    };
  }

  /** wrap one tick's outcome into the history record shape */
  function record(events, trades) {
    const bestBid = best('bid');
    const bestAsk = best('ask');
    return {
      tick,
      events,
      trades,
      lastTrade: trades.length ? trades[trades.length - 1].price : null,
      bestBid,
      bestAsk,
      mid: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
      snapshot: snapshot(),
    };
  }

  /** advance one tick (one seeded event + any stop it trips); null past horizon */
  function step() {
    if (tick >= horizon) return null;
    tick += 1;
    const events = [];
    let trades = [];
    if (rng() < MIX.pMarket) {
      // ---- a market order arrives -------------------------------------
      const side = rng() < 0.5 ? 'buy' : 'sell';
      let size;
      if (rng() < MIX.pSweep) size = 10 + Math.floor(rng() * 5);         // 10–14 sweep
      else size = 1 + Math.floor(rng() * rng() * MIX.baseMax);           // 1–8, skew small
      const t = executeMarket(side, size, 'crowd');
      trades = trades.concat(t);
      events.push({ type: 'market', side, size, filled: t.reduce((s, x) => s + x.size, 0) });
    } else {
      // ---- liquidity arrives ------------------------------------------
      const sideName = rng() < 0.5 ? 'bid' : 'ask';
      const qty = MIX.addMin + Math.floor(rng() * (MIX.addMax - MIX.addMin + 1));
      const levels = sideName === 'bid' ? book.bids : book.asks;
      const m = rng();
      let price = null;
      if (levels.length === 0) {
        // side is empty: a fresh quote steps in two ticks off the other side
        // (or off the last print, so a fully-emptied book can come back)
        const ob = best(sideName === 'bid' ? 'ask' : 'bid') ?? lastPrint;
        if (ob != null) {
          const cand = snapTick(sideName === 'bid' ? ob - 2 * TICK : ob + 2 * TICK);
          if (cand > 0) price = cand;
        }
      } else if (m < MIX.pAddExisting) {
        price = levels[Math.floor(rng() * levels.length)].price;
      } else {
        const bp = levels[0].price;
        const inside = m < MIX.pAddExisting + MIX.pAddInside;
        let cand = snapTick(sideName === 'bid'
          ? bp + (inside ? TICK : -TICK)
          : bp + (inside ? -TICK : TICK));
        if (inside) {
          // an "inside" quote must not cross or touch the opposite best
          const ob = best(sideName === 'bid' ? 'ask' : 'bid');
          if (ob != null && (sideName === 'bid' ? cand >= ob : cand <= ob)) cand = bp;
        }
        if (cand > 0) price = cand;
      }
      if (price != null) {
        addLiquidity(sideName, price, qty);
        events.push({ type: 'add', side: sideName, price, qty });
      } else {
        events.push({ type: 'noop' });
      }
    }
    const stopFills = fireStopIfHit(trades);
    if (stopFills) {
      trades = trades.concat(stopFills);
      events.push({ type: 'stop-fired', filled: stopFills.reduce((s, t) => s + t.size, 0) });
    }
    return record(events, trades);
  }

  /**
   * Rest the user's ONE limit order (replaces any previous one). If the price
   * crosses the opposite best it is MARKETABLE: it executes immediately up to
   * the limit price and any remainder rests at the limit — the honest
   * behavior, not an error.
   * @param {'buy'|'sell'} side @param {number} priceIn @param {number} qtyIn
   */
  function restLimit(side, priceIn, qtyIn) {
    cancelLimit();
    const price = snapTick(priceIn);
    const qty = Math.max(1, Math.round(qtyIn));
    const ob = best(side === 'buy' ? 'ask' : 'bid');
    let marketableTrades = [];
    let remaining = qty;
    if (ob != null && (side === 'buy' ? price >= ob : price <= ob)) {
      const t = executeMarket(side, qty, 'you', price);
      remaining = qty - t.reduce((s, x) => s + x.size, 0);
      const st = fireStopIfHit(t);
      marketableTrades = st ? t.concat(st) : t;
    }
    let queueAhead = 0;
    if (remaining > 0) {
      const levels = restLevels(side);
      let lvl = levels.find((l) => l.price === price);
      if (!lvl) lvl = insertLevel(levels, side, price);
      queueAhead = lvl.size;
      limit = {
        side, price, qty: remaining, reqQty: qty, filled: 0,
        queueAhead, fills: [], done: false, restTick: tick,
      };
    }
    return {
      price,
      rested: remaining > 0,
      remaining,
      queueAhead,
      marketable: marketableTrades.length > 0,
      trades: marketableTrades,
    };
  }

  function cancelLimit() {
    if (!limit) return;
    const levels = restLevels(limit.side);
    const side = limit.side;
    limit = null;
    sweepEmpty(levels, side);
  }

  /** arm the user's ONE stop order (replaces any previous one) */
  function armStop(dir, trigger, qty) {
    stop = {
      dir, trigger: Number(trigger), qty: Math.max(1, Math.round(qty)),
      fired: false, fills: [],
    };
  }

  function disarmStop() { stop = null; }

  /**
   * The user sends a one-shot market order NOW (verb 1). May trip the user's
   * own stop. Returns the fills split into the user's own vs. stop-fired.
   * @param {'buy'|'sell'} side @param {number} qty
   */
  function sendMarket(side, qty) {
    const own = executeMarket(side, qty, 'you');
    const stopFills = fireStopIfHit(own) || [];
    const filled = own.reduce((s, t) => s + t.size, 0);
    const total = own.reduce((s, t) => s + t.price * t.size, 0);
    return {
      trades: own.concat(stopFills),
      own,
      stopFills,
      filled,
      total,
      avgPrice: filled ? total / filled : null,
    };
  }

  /** total crowd depth in the book (user's resting qty NOT included) */
  const depth = () =>
    book.bids.reduce((s, l) => s + l.size, 0) + book.asks.reduce((s, l) => s + l.size, 0);

  return {
    step, snapshot, restLimit, cancelLimit, armStop, disarmStop, sendMarket, depth,
    get tick() { return tick; },
    get horizon() { return horizon; },
    get limit() { return limit; },
    get stop() { return stop; },
    get stats() { return { ...stats }; },
  };
}

/**
 * Run a full simulation: rest/arm the user's orders at tick 0, step to the
 * horizon, and return the tick-by-tick history plus a summary (this is what
 * the seed hunt and the QA assertions consume; the UI uses createSim live).
 *
 * @param {number} seed
 * @param {object} [opts]
 * @param {number} [opts.ticks]
 * @param {{side:'buy'|'sell', price:number, qty:number}} [opts.limit]
 * @param {{dir:'sell'|'buy', trigger:number, qty:number}} [opts.stop]
 * @param {{bids:{price:number,size:number}[], asks:{price:number,size:number}[]}} [opts.book]
 */
export function simulate(seed, opts = {}) {
  const sim = createSim(seed, opts);
  const initialDepth = sim.depth();
  let restRes = null;
  if (opts.limit) restRes = sim.restLimit(opts.limit.side, opts.limit.price, opts.limit.qty);
  if (opts.stop) sim.armStop(opts.stop.dir, opts.stop.trigger, opts.stop.qty);

  const records = [];
  let rec;
  while ((rec = sim.step()) != null) records.push(rec);

  const allTrades = (restRes ? restRes.trades : []).concat(records.flatMap((r) => r.trades));
  const makerYouShares = allTrades
    .filter((t) => t.maker === 'you')
    .reduce((s, t) => s + t.size, 0);

  const L = sim.limit;
  const S = sim.stop;
  const summary = {
    ticks: records.length,
    printed: sim.stats.printed,
    adds: sim.stats.adds,
    initialDepth,
    finalDepth: sim.depth(),
    makerYouShares,
    limitMarketable: restRes ? restRes.marketable : false,
    limit: L ? {
      side: L.side,
      price: L.price,
      qty: L.qty,
      filled: L.filled,
      done: L.done,
      doneTick: L.doneTick ?? null,
      firstFillTick: L.fills.length ? L.fills[0].tick : null,
      avgPrice: L.filled
        ? L.fills.reduce((s, f) => s + f.price * f.size, 0) / L.filled
        : null,
      queueAhead: L.queueAhead,
    } : null,
    stop: S ? {
      dir: S.dir,
      trigger: S.trigger,
      qty: S.qty,
      fired: S.fired,
      firedTick: S.firedTick ?? null,
      filledQty: S.filledQty ?? 0,
      avgPrice: S.avgPrice ?? null,
      slippage: S.slippage ?? null,
    } : null,
  };
  return { records, summary };
}
