// @ts-check
/**
 * model.js — pure computation layer for the Anomaly Lab (Lecture 5 §1–2).
 *
 * No DOM: importable from node for numeric verification. Wraps the baked Ken
 * French monthly data (./data.js, percent/month, 1963-07..2026-05) and
 * lib/finmath's olsMulti into the per-decile statistics the tool plots:
 * average excess returns, time-series alphas, and factor loadings for CAPM /
 * Fama–French 3-factor / Carhart 4-factor regressions over an arbitrary
 * calendar-year window.
 *
 * UNITS: the data module is percent per month; every mean/alpha returned here
 * is annualized by ×12 and is therefore an ANNUAL-PERCENT NUMBER (6.86 means
 * 6.86%/yr). Loadings (betas) are unitless. Format with toFixed — never lib
 * chart.js's pct(), which expects decimals.
 */

import { olsMulti, ols } from '../../lib/finmath.js';
import { META, FACTORS, SORTS } from './data.js';

/* ------------------------------------------------------------- key sets -- */
export const SORT_KEYS = ['beta', 'size', 'bm', 'mom'];
export const MODEL_KEYS = ['capm', 'ff3', 'ff3c'];
export const VIEW_KEYS = ['sml', 'alphas', 'loadings', 'scoreboard'];

export const SORT_LABELS = {
  beta: 'Beta', size: 'Size', bm: 'Value (B/M)', mom: 'Momentum',
};
export const MODEL_LABELS = { capm: 'CAPM', ff3: 'FF3', ff3c: 'Carhart' };
/** Regressors per model, in order (betas[0] is always the market loading). */
export const MODEL_FACTORS = {
  capm: ['mktrf'],
  ff3: ['mktrf', 'smb', 'hml'],
  ff3c: ['mktrf', 'smb', 'hml', 'wml'],
};
export const FACTOR_LABELS = { mktrf: 'Mkt', smb: 'SMB', hml: 'HML', wml: 'WML' };

const START_Y = 1963;
const START_M = 7; // data begins 1963-07

export { META };

/* ------------------------------------------------------- window helpers -- */
/**
 * [i0, i1) month-index range covering calendar years y0..y1 inclusive,
 * clamped to the available sample (which simply starts at July 1963).
 * @param {number} y0 first calendar year
 * @param {number} y1 last calendar year
 * @returns {{i0:number, i1:number}}
 */
export function windowIndices(y0, y1) {
  const i0 = Math.max(0, (y0 - START_Y) * 12 + (1 - START_M));
  const i1 = Math.min(META.months, (y1 - START_Y) * 12 + (12 - START_M) + 1);
  return { i0, i1 };
}

/** 'YYYY-MM' label of an aligned month index. @param {number} i */
export function ymOfIndex(i) {
  const y = START_Y + Math.floor((i + START_M - 1) / 12);
  const m = ((i + START_M - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ statistics -- */
/** Mean over finite entries of arr[i0..i1). @param {(number|null)[]} arr */
function meanFinite(arr, i0, i1) {
  let s = 0;
  let n = 0;
  for (let t = i0; t < i1; t++) {
    const v = arr[t];
    if (Number.isFinite(v)) { s += /** @type {number} */ (v); n += 1; }
  }
  return n > 0 ? s / n : NaN;
}

/** Annualized market premium over the window (mean mktrf ×12, %/yr). */
export function mktPremium(i0, i1) {
  return meanFinite(FACTORS.mktrf, i0, i1) * 12;
}

/**
 * Annualized factor premia λ_j (window means ×12, %/yr) for a model's
 * regressors, in MODEL_FACTORS order.
 * @param {string} modelKey @param {number} i0 @param {number} i1
 * @returns {number[]}
 */
export function factorPremia(modelKey, i0, i1) {
  return MODEL_FACTORS[modelKey].map((f) => meanFinite(FACTORS[f], i0, i1) * 12);
}

/**
 * @typedef {{avg:number, alpha:number, beta:number, betas:number[],
 *            seAlpha:number, r2:number, n:number}} DecileStat
 * avg / alpha / seAlpha annualized %/yr; beta = market loading (betas[0]).
 */

/**
 * Run the model's time-series regression for each of the sort's ten decile
 * portfolios over [i0, i1). Dependent variable is ALWAYS the decile return
 * minus rf, month by month.
 * @param {string} sortKey @param {string} modelKey
 * @param {number} i0 @param {number} i1
 * @returns {DecileStat[]}
 */
export function decileStats(sortKey, modelKey, i0, i1) {
  const X = MODEL_FACTORS[modelKey].map((f) => FACTORS[f].slice(i0, i1));
  const rf = FACTORS.rf;
  return SORTS[sortKey].map((dec) => {
    const y = new Array(i1 - i0);
    for (let t = i0; t < i1; t++) {
      const d = dec[t];
      const r = rf[t];
      y[t - i0] = (Number.isFinite(d) && Number.isFinite(r))
        ? /** @type {number} */ (d) - /** @type {number} */ (r)
        : NaN;
    }
    const avg = meanFinite(y, 0, y.length) * 12;
    const fit = olsMulti(X, y);
    if (!fit) {
      return { avg, alpha: NaN, beta: NaN, betas: [], seAlpha: NaN, r2: NaN, n: 0 };
    }
    return {
      avg,
      alpha: fit.alpha * 12,
      beta: fit.betas[0],
      betas: fit.betas,
      seAlpha: fit.seAlpha * 12,
      r2: fit.r2,
      n: fit.n,
    };
  });
}

/** Root-mean-square of a list (NaNs propagate — callers pass clean lists). */
export function rms(vals) {
  return Math.sqrt(vals.reduce((s, v) => s + v * v, 0) / vals.length);
}

/** RMS annualized alpha across the ten deciles of sort × model. */
export function rmsAlpha(sortKey, modelKey, i0, i1) {
  return rms(decileStats(sortKey, modelKey, i0, i1).map((d) => d.alpha));
}

/**
 * The scoreboard grid: for every sort, RMS average excess return and RMS
 * alpha under each model, all over [i0, i1). 120 regressions of ≤755 obs —
 * cheap enough to run live.
 * @param {number} i0 @param {number} i1
 * @returns {Record<string, {avg:number, capm:number, ff3:number, ff3c:number}>}
 */
export function scoreboard(i0, i1) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const s of SORT_KEYS) {
    const row = { avg: NaN, capm: NaN, ff3: NaN, ff3c: NaN };
    for (const m of MODEL_KEYS) {
      const stats = decileStats(s, m, i0, i1);
      row[m] = rms(stats.map((d) => d.alpha));
      if (m === 'capm') row.avg = rms(stats.map((d) => d.avg)); // model-free
    }
    out[s] = row;
  }
  return out;
}

/**
 * Cross-sectional OLS fit of the ten (beta, avg) decile points — the grey
 * dashed "SML is too flat" line. Returns slope and intercept in %/yr.
 * @param {DecileStat[]} stats
 * @returns {{slope:number, intercept:number}}
 */
export function crossFit(stats) {
  const fit = ols(stats.map((d) => d.beta), stats.map((d) => d.avg));
  return { slope: fit.slope, intercept: fit.intercept };
}

/**
 * Return decomposition for one decile (deck s30): contribution of each
 * factor beta_j × λ_j plus the alpha remainder, all %/yr.
 * @param {DecileStat} stat @param {number[]} lambdas annualized premia
 * @returns {{contribs:number[], explained:number, alpha:number, actual:number}}
 */
export function decompose(stat, lambdas) {
  const contribs = stat.betas.map((b, j) => b * lambdas[j]);
  const explained = contribs.reduce((s, c) => s + c, 0);
  return { contribs, explained, alpha: stat.avg - explained, actual: stat.avg };
}

/* ------------------------------------------- information ratio (deck s42) -- */
/**
 * Sharpe-ratio arithmetic for the IR card: SR_P² = SR_M² + IR².
 * Inputs are annual percents (E[R_M−R_f], σ_M, α, σ_ε).
 * @param {number} erm @param {number} sm @param {number} a @param {number} se
 * @returns {{srm:number, ir:number, srp:number}}
 */
export function sharpeCombine(erm, sm, a, se) {
  const srm = erm / sm;
  const ir = a / se;
  return { srm, ir, srp: Math.hypot(srm, ir) };
}
