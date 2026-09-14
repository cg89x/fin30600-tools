// @ts-check
/**
 * paths.js — tool-local model code for the order-book explorer (Lecture 2 §3).
 *
 * Kept separate from main.js so the seeded price path and the resting-order
 * evaluation can be exercised in plain node during development:
 *
 *   node --input-type=module -e "
 *     const m = await import('file://.../tools/order-book/paths.js');
 *     console.log(m.evalRestingOrder(m.makePath(1234), 'sl', 54.5));"
 *
 * All fill math for the BOOK panel lives in lib/finmath.js `walkBook` — this
 * module only owns Part 2's price path and the trigger/fill logic of resting
 * orders (limit + stop) against that path and against a static quote.
 */

import { mulberry32, randn } from '../../lib/finmath.js';

/**
 * Default random-walk parameters for the Part-B price path: ~90 bars starting
 * at the deck quote's midpoint ($55.375 between the $55.25 bid and $55.50
 * ask), Gaussian steps of σ ≈ $0.15, and an occasional ±$1 jump so stop-order
 * gap risk actually shows up on screen.
 */
export const PATH_OPTS = { n: 90, start: 55.375, sigma: 0.15, jumpProb: 0.04, jumpSize: 1.0 };

/**
 * Build a seeded random-walk price path (deterministic: same seed, same path,
 * so a shared URL reproduces the exact picture). Prices rounded to cents.
 * @param {number} seed 32-bit seed for mulberry32
 * @param {object} [opts] overrides for PATH_OPTS
 * @returns {number[]} path of length n+1, path[0] = start
 */
export function makePath(seed, opts = {}) {
  const o = { ...PATH_OPTS, ...opts };
  const rng = mulberry32(Number(seed) >>> 0);
  const path = [o.start];
  let p = o.start;
  for (let t = 1; t <= o.n; t++) {
    let step = o.sigma * randn(rng);
    if (rng() < o.jumpProb) step += (rng() < 0.5 ? -1 : 1) * o.jumpSize;
    p = Math.max(0.25, p + step);
    p = Math.round(p * 100) / 100;
    path.push(p);
  }
  return path;
}

/**
 * Evaluate ONE resting order against a price path (Part B).
 *
 * Types: 'lb' limit buy (buy at or below the limit), 'ls' limit sell (sell at
 * or above), 'sl' stop-loss sell (sell if the price falls to/below the
 * trigger), 'sb' stop-buy (buy if the price rises to/above the trigger).
 *
 * Execution rules (the point of the exercise):
 *  - a LIMIT order fills at the limit price (or better) — it IS the standing
 *    quote, so when the market trades through it, it fills at `price`;
 *  - a STOP order only TRIGGERS a market order at the first crossing bar, so
 *    it executes at that bar's price — on a gap, materially worse than the
 *    trigger.
 *
 * @param {number[]} path price path (path[0] = price when the order is placed)
 * @param {'lb'|'ls'|'sl'|'sb'} type
 * @param {number} price limit / trigger price
 * @returns {{hit: boolean, index?: number, exec?: number, immediate?: boolean,
 *   gap?: number}} first bar that executes; `gap` = |exec − trigger| for
 *   stops (0 for limits); `immediate` = already marketable at bar 0
 */
export function evalRestingOrder(path, type, price) {
  const cond = {
    lb: (p) => p <= price,
    ls: (p) => p >= price,
    sl: (p) => p <= price,
    sb: (p) => p >= price,
  }[type];
  if (!cond || !Number.isFinite(price)) return { hit: false };
  if (cond(path[0])) {
    // already marketable / already through the trigger when placed:
    // everything executes at the current price
    return { hit: true, index: 0, exec: path[0], immediate: true, gap: 0 };
  }
  const isLimit = type === 'lb' || type === 'ls';
  for (let t = 1; t < path.length; t++) {
    if (cond(path[t])) {
      const exec = isLimit ? price : path[t];
      const gap = isLimit ? 0 : Math.abs(path[t] - price);
      return { hit: true, index: t, exec, immediate: false, gap };
    }
  }
  return { hit: false };
}

/**
 * Evaluate an order against a static bid/ask quote (Part A — the deck's ABC
 * example: bid $55.25 / ask $55.50). Returns a structured verdict; the UI
 * phrases it in the deck's language.
 * @param {'mb'|'ms'|'lb'|'ls'|'sl'|'sb'} type
 * @param {number} price limit / trigger price (ignored for market orders)
 * @param {number} bid @param {number} ask
 * @returns {{executes: boolean, exec?: number}}
 */
export function evalQuote(type, price, bid, ask) {
  switch (type) {
    case 'mb': return { executes: true, exec: ask };
    case 'ms': return { executes: true, exec: bid };
    case 'lb': return ask <= price ? { executes: true, exec: ask } : { executes: false };
    case 'ls': return bid >= price ? { executes: true, exec: bid } : { executes: false };
    case 'sl': return bid <= price ? { executes: true, exec: bid } : { executes: false };
    case 'sb': return ask >= price ? { executes: true, exec: ask } : { executes: false };
    default: return { executes: false };
  }
}
