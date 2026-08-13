// @ts-check
/**
 * game.js — pure game math + simulation for the Keynesian beauty contest
 * (FIN 30600, Topic 6 §3 Behavioral Finance).
 *
 * The game, as the deck states it: everyone writes down a number between
 * 0 and 100; the person who guesses the number that is 2/3 of the class
 * average wins a prize. Iterated reasoning ("level-k") walks the winning
 * guess down 50 → 33.3 → 22.2 → … → 0, the Nash equilibrium.
 *
 * Everything in this module is pure and dependency-free so it can be
 * imported and desk-checked directly under node:
 *   node -e "import('./game.js').then(g => ...)"  (from the tool folder)
 *
 * @module game
 */

/** Unambiguous session-code alphabet (no 0/O, 1/I/L). */
export const SESSION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a 4-character session code from the unambiguous alphabet.
 * @param {() => number} [rng] uniform generator in [0,1) (default Math.random)
 * @returns {string}
 */
export function makeSessionCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += SESSION_ALPHABET[Math.floor(rng() * SESSION_ALPHABET.length)];
  }
  return code;
}

/**
 * Flatten a Firebase `guesses` node ({pushId: {v, name?, t?}}) into a clean,
 * time-ordered array. Invalid entries (missing/non-finite/out-of-range v)
 * are dropped — the security rules should prevent them, but never trust the
 * wire. Also accepts an already-flat array (pass-through cleaning).
 * @param {object|Array|null|undefined} node
 * @returns {{v:number, name:string, t:number}[]}
 */
export function guessList(node) {
  if (!node) return [];
  const raw = Array.isArray(node) ? node : Object.values(node);
  const out = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const v = Number(/** @type {any} */ (g).v);
    if (!Number.isFinite(v) || v < 0 || v > 100) continue;
    const name = typeof (/** @type {any} */ (g).name) === 'string'
      ? (/** @type {any} */ (g).name).trim().slice(0, 24) : '';
    const t = Number(/** @type {any} */ (g).t) || 0;
    out.push({ v, name, t });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Round statistics: count, mean, and the 2/3-of-the-mean target.
 * @param {({v:number}|number)[]} guesses guess objects or bare numbers
 * @returns {{n:number, mean:number, target:number}} NaN mean/target when empty
 */
export function computeStats(guesses) {
  const vals = [];
  for (const g of guesses) {
    const v = typeof g === 'number' ? g : Number(g && g.v);
    if (Number.isFinite(v)) vals.push(v);
  }
  const n = vals.length;
  if (n === 0) return { n: 0, mean: NaN, target: NaN };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  return { n, mean, target: (2 / 3) * mean };
}

/**
 * All guesses at the minimum distance from the target (ties → every winner).
 * @param {{v:number, name?:string}[]} guesses
 * @param {number} target
 * @returns {{v:number, name?:string}[]}
 */
export function pickWinners(guesses, target) {
  if (!Number.isFinite(target)) return [];
  let best = Infinity;
  for (const g of guesses) {
    const d = Math.abs(g.v - target);
    if (d < best) best = d;
  }
  if (!Number.isFinite(best)) return [];
  return guesses.filter((g) => Math.abs(g.v - target) <= best + 1e-9);
}

/**
 * Fixed-width histogram counts over [lo, hi]; the top edge is inclusive
 * (a guess of exactly 100 lands in the last bin).
 * @param {number[]} values
 * @param {number} [binWidth=5]
 * @param {number} [lo=0]
 * @param {number} [hi=100]
 * @returns {number[]} counts, length (hi-lo)/binWidth
 */
export function histogram(values, binWidth = 5, lo = 0, hi = 100) {
  const nBins = Math.max(1, Math.round((hi - lo) / binWidth));
  const bins = new Array(nBins).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    bins[Math.min(nBins - 1, Math.floor((v - lo) / binWidth))] += 1;
  }
  return bins;
}

/**
 * Level-k reference marks for the histogram axis: level 1 = 2/3·50 = 33.3,
 * level 2 = 22.2, level 3 = 14.8, and the Nash equilibrium at 0.
 * @type {{v:number, label:string}[]}
 */
export const LEVEL_MARKS = [
  { v: 50 * (2 / 3), label: 'L1' },
  { v: 50 * (2 / 3) ** 2, label: 'L2' },
  { v: 50 * (2 / 3) ** 3, label: 'L3' },
  { v: 0, label: 'Nash' },
];

/** One standard-normal deviate (Box–Muller). @param {() => number} rng */
function gauss(rng) {
  let u = 0;
  let w = 0;
  while (u === 0) u = rng();
  while (w === 0) w = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

/** First names for simulated students (theater for the winner reveal). */
const SIM_NAMES = [
  'Ava', 'Ben', 'Clara', 'Diego', 'Emma', 'Finn', 'Grace', 'Henry', 'Isla',
  'Jack', 'Kate', 'Liam', 'Maya', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rosa',
  'Sam', 'Tess', 'Uma', 'Victor', 'Wes', 'Ximena', 'Yara', 'Zach', 'Aiden',
  'Bella', 'Carlos', 'Dana', 'Eli', 'Fiona', 'Gus', 'Hana', 'Ian', 'Jade',
  'Kai', 'Lena', 'Marco', 'Nina', 'Owen', 'Pia', 'Rory', 'Sofia', 'Theo',
  'Vera', 'Will', 'Zoe', 'Amir', 'Bree',
];

/**
 * Base level-k mixture for simulated round 1:
 * 20% level-0 (uniform), 45% level-1 (≈33), 25% level-2 (≈22), 10% level-3+.
 */
const MIX = [0.20, 0.45, 0.25, 0.10];
const MAX_LEVEL = 10;

/**
 * Simulate one round of guesses from a class of level-k reasoners. Each
 * subsequent round shifts the whole mixture one level deeper (learning), so
 * repeated play converges toward the Nash equilibrium at 0. Deterministic
 * given the rng — seed it per round so replays reproduce the same class.
 * @param {number} n class size
 * @param {number} round 1-based round number
 * @param {() => number} rng uniform generator in [0,1)
 * @returns {{v:number, name:string, t:number}[]}
 */
export function simulateRound(n, round, rng) {
  const shift = Math.max(0, Math.round(round) - 1);
  const guesses = [];
  for (let i = 0; i < n; i++) {
    // draw a base level from the mixture, then shift it by (round - 1)
    const u = rng();
    let k = MIX.length - 1;
    let acc = 0;
    for (let j = 0; j < MIX.length; j++) {
      acc += MIX[j];
      if (u <= acc) { k = j; break; }
    }
    const level = Math.min(MAX_LEVEL, k + shift);
    let v;
    if (level === 0) {
      v = rng() * 100; // level-0: uniform on [0, 100]
    } else {
      const m = 50 * (2 / 3) ** level; // level-k best response to level-(k-1)
      const sd = Math.max(1.5, 0.25 * m);
      v = m + gauss(rng) * sd;
    }
    v = Math.min(100, Math.max(0, Math.round(v * 10) / 10));
    guesses.push({ v, name: i < SIM_NAMES.length ? SIM_NAMES[i] : `Student ${i + 1}`, t: i });
  }
  return guesses;
}
