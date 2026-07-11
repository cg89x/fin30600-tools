// @ts-check
/**
 * finmath.js — all finance & numerical math for the FIN 30600 interactive tools.
 *
 * CONVENTION: every function works in DECIMALS, never percents. A return of
 * 8% is passed and returned as 0.08; a standard deviation of 20% is 0.20. The
 * UI layer (ui.js / each tool) is solely responsible for formatting decimals
 * into whole-percent strings for display. Nothing here multiplies by 100.
 *
 * All functions are PURE: they read their arguments and return new values,
 * never mutating inputs and never touching globals (the PRNG state is passed
 * explicitly as a closure returned by `mulberry32`).
 *
 * Vectors are plain `number[]`; matrices are `number[][]` (row-major, square
 * unless noted). Sizes are small (N <= 10) so dense O(N^3) methods are fine.
 *
 * @module finmath
 */

/* ============================================================= *
 *  TWO-ASSET PORTFOLIO (Lecture 3 §4)                           *
 * ============================================================= */

/**
 * Covariance of two assets implied by their standard deviations and correlation.
 * Cov(A,B) = rho * sigmaA * sigmaB.
 * @param {number} sigmaA standard deviation of asset A (decimal)
 * @param {number} sigmaB standard deviation of asset B (decimal)
 * @param {number} rho correlation coefficient in [-1, 1]
 * @returns {number} covariance (decimal, variance units)
 */
export function covFromCorr(sigmaA, sigmaB, rho) {
  return rho * sigmaA * sigmaB;
}

/**
 * Expected return of a two-asset portfolio (Rule 1).
 * E[R_P] = wA*muA + (1-wA)*muB.
 * @param {number} wA weight in asset A (may be <0 or >1 with short sales)
 * @param {number} muA expected return of A (decimal)
 * @param {number} muB expected return of B (decimal)
 * @returns {number} portfolio expected return (decimal)
 */
export function twoAssetMean(wA, muA, muB) {
  return wA * muA + (1 - wA) * muB;
}

/**
 * Variance of a two-asset portfolio (Rule 2).
 * sigma_P^2 = wA^2 sigmaA^2 + wB^2 sigmaB^2 + 2 wA wB Cov(A,B), wB = 1-wA.
 * @param {number} wA weight in asset A
 * @param {number} sigmaA std dev of A (decimal)
 * @param {number} sigmaB std dev of B (decimal)
 * @param {number} cov covariance of A and B (decimal, variance units)
 * @returns {number} portfolio variance (decimal)
 */
export function twoAssetVar(wA, sigmaA, sigmaB, cov) {
  const wB = 1 - wA;
  return wA * wA * sigmaA * sigmaA + wB * wB * sigmaB * sigmaB + 2 * wA * wB * cov;
}

/**
 * Standard deviation of a two-asset portfolio.
 * @param {number} wA weight in asset A
 * @param {number} sigmaA std dev of A (decimal)
 * @param {number} sigmaB std dev of B (decimal)
 * @param {number} cov covariance of A and B (decimal)
 * @returns {number} portfolio standard deviation (decimal)
 */
export function twoAssetStd(wA, sigmaA, sigmaB, cov) {
  return Math.sqrt(Math.max(0, twoAssetVar(wA, sigmaA, sigmaB, cov)));
}

/**
 * Minimum-variance portfolio weight in asset A (two-asset case).
 * wA_min = (sigmaB^2 - Cov) / (sigmaA^2 + sigmaB^2 - 2 Cov).
 * @param {number} sigmaA std dev of A (decimal)
 * @param {number} sigmaB std dev of B (decimal)
 * @param {number} cov covariance of A and B (decimal)
 * @returns {number} weight in A that minimizes portfolio variance
 */
export function mvpWeightTwoAsset(sigmaA, sigmaB, cov) {
  const denom = sigmaA * sigmaA + sigmaB * sigmaB - 2 * cov;
  return (sigmaB * sigmaB - cov) / denom;
}

/* ============================================================= *
 *  CAPITAL ALLOCATION & UTILITY (Lecture 3 §2–3)               *
 * ============================================================= */

/**
 * Sharpe (reward-to-variability) ratio of a risky portfolio.
 * S = (E[r_p] - rf) / sigma_p.
 * @param {number} rp expected return of the risky portfolio (decimal)
 * @param {number} rf risk-free rate (decimal)
 * @param {number} sigmaP std dev of the risky portfolio (decimal)
 * @returns {number} Sharpe ratio
 */
export function sharpe(rp, rf, sigmaP) {
  return (rp - rf) / sigmaP;
}

/**
 * Mean–variance utility. U = E[r] - 1/2 * A * sigma^2.
 * @param {number} er expected return (decimal)
 * @param {number} sigma standard deviation (decimal)
 * @param {number} A coefficient of risk aversion (>0)
 * @returns {number} utility (certainty-equivalent return, decimal)
 */
export function utility(er, sigma, A) {
  return er - 0.5 * A * sigma * sigma;
}

/**
 * Optimal allocation y* to the risky portfolio on a CAL (unconstrained).
 * y* = (E[r_p] - rf) / (A * sigma_p^2).
 * @param {number} rp expected return of the risky portfolio (decimal)
 * @param {number} rf risk-free rate (decimal)
 * @param {number} sigmaP std dev of the risky portfolio (decimal)
 * @param {number} A coefficient of risk aversion (>0)
 * @returns {number} optimal weight y* in the risky portfolio
 */
export function optimalY(rp, rf, sigmaP, A) {
  return (rp - rf) / (A * sigmaP * sigmaP);
}

/**
 * Complete-portfolio expected return for allocation y on a CAL.
 * E[r_C] = rf + y (E[r_p] - rf).
 * @param {number} y allocation to the risky portfolio
 * @param {number} rp risky expected return (decimal)
 * @param {number} rf risk-free rate (decimal)
 * @returns {number} complete-portfolio expected return (decimal)
 */
export function completeReturn(y, rp, rf) {
  return rf + y * (rp - rf);
}

/**
 * Complete-portfolio standard deviation for allocation y. sigma_C = |y| sigma_p.
 * @param {number} y allocation to the risky portfolio
 * @param {number} sigmaP risky std dev (decimal)
 * @returns {number} complete-portfolio standard deviation (decimal)
 */
export function completeStd(y, sigmaP) {
  return Math.abs(y) * sigmaP;
}

/* ============================================================= *
 *  DENSE LINEAR ALGEBRA (N <= 10)                              *
 * ============================================================= */

/** Deep-copy a matrix. @param {number[][]} A @returns {number[][]} */
function cloneMatrix(A) {
  return A.map((row) => row.slice());
}

/**
 * Solve the linear system A x = b by Gaussian elimination with partial
 * pivoting. Does not mutate its arguments.
 * @param {number[][]} A square coefficient matrix (n x n)
 * @param {number[]} b right-hand side (length n)
 * @returns {number[]} solution vector x (length n)
 * @throws {Error} if A is singular (or numerically so)
 */
export function solve(A, b) {
  const n = A.length;
  const M = cloneMatrix(A);
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    // partial pivot: largest magnitude in this column at/below the diagonal
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-14) throw new Error('solve: matrix is singular');
    if (piv !== col) {
      const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp;
      const tb = x[piv]; x[piv] = x[col]; x[col] = tb;
    }
    // eliminate below
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= factor * M[col][c];
      x[r] -= factor * x[col];
    }
  }
  // back substitution
  const out = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * out[c];
    out[r] = s / M[r][r];
  }
  return out;
}

/**
 * Solve A X = B for multiple right-hand sides (B given as an array of vectors).
 * @param {number[][]} A square matrix
 * @param {number[][]} columns array of RHS vectors
 * @returns {number[][]} array of solution vectors (same length as `columns`)
 */
export function solveMany(A, columns) {
  return columns.map((b) => solve(A, b));
}

/**
 * Invert a square matrix via repeated solves against identity columns.
 * @param {number[][]} A square matrix
 * @returns {number[][]} inverse of A
 * @throws {Error} if A is singular
 */
export function inverse(A) {
  const n = A.length;
  const cols = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    cols.push(solve(A, e));
  }
  // cols[j] is the j-th column of the inverse; transpose into row-major
  const inv = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) inv[i][j] = cols[j][i];
  return inv;
}

/**
 * Matrix–vector product A v.
 * @param {number[][]} A m x n matrix
 * @param {number[]} v length-n vector
 * @returns {number[]} length-m vector
 */
export function matVec(A, v) {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}

/**
 * Dot product of two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Quadratic form v' A v.
 * @param {number[]} v
 * @param {number[][]} A square matrix
 * @returns {number}
 */
export function quadForm(v, A) {
  return dot(v, matVec(A, v));
}

/**
 * Attempt a Cholesky factorization to test positive-definiteness.
 * Returns the lower-triangular factor L (A = L L') if A is symmetric positive
 * definite, otherwise `null`. Also used as the PD check for covariance /
 * correlation matrices.
 * @param {number[][]} A symmetric square matrix
 * @returns {number[][]|null} lower-triangular L, or null if not PD
 */
export function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null; // not positive definite
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/**
 * True iff A is symmetric positive definite (within tolerance).
 * @param {number[][]} A square matrix
 * @returns {boolean}
 */
export function isPositiveDefinite(A) {
  return cholesky(A) !== null;
}

/* ============================================================= *
 *  N-ASSET PORTFOLIO THEORY (Lecture 3 §5)                     *
 * ============================================================= */

/**
 * Build a covariance matrix Sigma from a vector of standard deviations and a
 * correlation matrix. Sigma_ij = sigma_i sigma_j rho_ij.
 * @param {number[]} sigmas length-n std devs (decimal)
 * @param {number[][]} corr n x n correlation matrix (unit diagonal)
 * @returns {number[][]} n x n covariance matrix
 */
export function covMatrix(sigmas, corr) {
  const n = sigmas.length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) S[i][j] = sigmas[i] * sigmas[j] * corr[i][j];
  return S;
}

/**
 * Expected return of a portfolio with weights w and mean vector mu.
 * @param {number[]} w weights
 * @param {number[]} mu expected returns (decimal)
 * @returns {number} portfolio expected return (decimal)
 */
export function portfolioMean(w, mu) {
  return dot(w, mu);
}

/**
 * Variance of a portfolio: w' Sigma w.
 * @param {number[]} w weights
 * @param {number[][]} Sigma covariance matrix
 * @returns {number} portfolio variance (decimal)
 */
export function portfolioVar(w, Sigma) {
  return quadForm(w, Sigma);
}

/**
 * Standard deviation of a portfolio.
 * @param {number[]} w weights
 * @param {number[][]} Sigma covariance matrix
 * @returns {number} portfolio std dev (decimal)
 */
export function portfolioStd(w, Sigma) {
  return Math.sqrt(Math.max(0, portfolioVar(w, Sigma)));
}

/**
 * Global minimum-variance portfolio weights (short sales allowed).
 * w proportional to Sigma^{-1} 1, normalized to sum to 1.
 * @param {number[][]} Sigma covariance matrix (must be invertible)
 * @returns {number[]} MVP weights (sum to 1)
 */
export function globalMVP(Sigma) {
  const n = Sigma.length;
  const one = new Array(n).fill(1);
  const z = solve(Sigma, one); // Sigma^{-1} 1
  const s = z.reduce((a, b) => a + b, 0);
  return z.map((v) => v / s);
}

/**
 * Tangency (maximum-Sharpe) portfolio weights.
 * w proportional to Sigma^{-1} (mu - rf 1), normalized to sum to 1.
 * @param {number[]} mu expected returns (decimal)
 * @param {number[][]} Sigma covariance matrix
 * @param {number} rf risk-free rate (decimal)
 * @returns {number[]} tangency weights (sum to 1)
 */
export function tangencyPortfolio(mu, Sigma, rf) {
  const excess = mu.map((m) => m - rf);
  const z = solve(Sigma, excess); // Sigma^{-1} (mu - rf 1)
  const s = z.reduce((a, b) => a + b, 0);
  return z.map((v) => v / s);
}

/**
 * The four efficient-set constants (Merton) for the unconstrained frontier.
 * A = 1' Sigma^{-1} mu, B = mu' Sigma^{-1} mu, C = 1' Sigma^{-1} 1,
 * D = B*C - A*A. With these, the minimum variance at a target mean m is
 * sigma^2(m) = (C m^2 - 2 A m + B) / D.
 * @param {number[]} mu expected returns (decimal)
 * @param {number[][]} Sigma covariance matrix
 * @returns {{A:number,B:number,C:number,D:number}}
 */
export function frontierConstants(mu, Sigma) {
  const n = mu.length;
  const one = new Array(n).fill(1);
  const invMu = solve(Sigma, mu); // Sigma^{-1} mu
  const invOne = solve(Sigma, one); // Sigma^{-1} 1
  const A = dot(one, invMu);
  const B = dot(mu, invMu);
  const C = dot(one, invOne);
  const D = B * C - A * A;
  return { A, B, C, D };
}

/**
 * Minimum portfolio standard deviation achievable at a target expected return,
 * along the unconstrained (short-sales-allowed) minimum-variance frontier.
 * @param {number} targetMean target expected return (decimal)
 * @param {number[]} mu expected returns (decimal)
 * @param {number[][]} Sigma covariance matrix
 * @returns {number} minimum std dev at that mean (decimal)
 */
export function frontierStdAtMean(targetMean, mu, Sigma) {
  const { A, B, C, D } = frontierConstants(mu, Sigma);
  const variance = (C * targetMean * targetMean - 2 * A * targetMean + B) / D;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Frontier weights at a target expected return, via the two-fund separation
 * theorem: any frontier portfolio is a linear combination of two frontier
 * portfolios. We use the global MVP and the "second fund" g = Sigma^{-1} mu
 * (normalized). Weights are affine in the target mean, so we blend the MVP
 * (mean m0) and the tangency-like fund (mean m1) to hit `targetMean`.
 * Short sales allowed.
 * @param {number} targetMean target expected return (decimal)
 * @param {number[]} mu expected returns (decimal)
 * @param {number[][]} Sigma covariance matrix
 * @returns {number[]} frontier weights (sum to 1)
 */
export function frontierWeightsAtMean(targetMean, mu, Sigma) {
  // Fund 1: global MVP.
  const w0 = globalMVP(Sigma);
  const m0 = dot(w0, mu);
  // Fund 2: normalized Sigma^{-1} mu (a distinct frontier portfolio).
  const g = solve(Sigma, mu);
  const gs = g.reduce((a, b) => a + b, 0);
  const w1 = g.map((v) => v / gs);
  const m1 = dot(w1, mu);
  // Blend: alpha*m1 + (1-alpha)*m0 = targetMean.
  const alpha = (targetMean - m0) / (m1 - m0);
  return w0.map((v, i) => (1 - alpha) * v + alpha * w1[i]);
}

/**
 * Trace the unconstrained minimum-variance frontier as an array of
 * {mean, std} points, spanning a range of target means. Handy for plotting.
 * @param {number[]} mu expected returns (decimal)
 * @param {number[][]} Sigma covariance matrix
 * @param {object} [opts]
 * @param {number} [opts.n=80] number of points
 * @param {number} [opts.loMean] lowest target mean (default min(mu) - pad)
 * @param {number} [opts.hiMean] highest target mean (default max(mu) + pad)
 * @returns {{mean:number,std:number}[]} frontier points, low mean to high mean
 */
export function traceFrontier(mu, Sigma, opts = {}) {
  const n = opts.n ?? 80;
  const lo = mu.reduce((a, b) => Math.min(a, b), Infinity);
  const hi = mu.reduce((a, b) => Math.max(a, b), -Infinity);
  const pad = (hi - lo) * 0.5 || 0.05;
  const loMean = opts.loMean ?? lo - pad;
  const hiMean = opts.hiMean ?? hi + pad;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const m = loMean + ((hiMean - loMean) * i) / (n - 1);
    pts.push({ mean: m, std: frontierStdAtMean(m, mu, Sigma) });
  }
  return pts;
}

/* ============================================================= *
 *  OLS REGRESSION (Lecture 4 §3 — market model)               *
 * ============================================================= */

/**
 * Simple ordinary-least-squares regression of y on x (single regressor plus
 * intercept). Returns slope (beta), intercept (alpha), their standard errors,
 * and R^2.
 * @param {number[]} x regressor (e.g. market excess returns)
 * @param {number[]} y response (e.g. asset excess returns)
 * @returns {{slope:number,intercept:number,seSlope:number,seIntercept:number,r2:number,n:number}}
 */
export function ols(x, y) {
  const n = x.length;
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xbar;
    const dy = y[i] - ybar;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  // residual sum of squares and error variance (n-2 dof)
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - (intercept + slope * x[i]);
    ssRes += e * e;
  }
  const s2 = n > 2 ? ssRes / (n - 2) : NaN;
  const seSlope = Math.sqrt(s2 / sxx);
  const seIntercept = Math.sqrt(s2 * (1 / n + (xbar * xbar) / sxx));
  const r2 = syy === 0 ? NaN : 1 - ssRes / syy;
  return { slope, intercept, seSlope, seIntercept, r2, n };
}

/* ============================================================= *
 *  CAPM / SML (Lecture 4 §2)                                   *
 * ============================================================= */

/**
 * CAPM required (equilibrium) expected return for a given beta.
 * E[r] = rf + beta (E[r_M] - rf).
 * @param {number} beta systematic risk
 * @param {number} rf risk-free rate (decimal)
 * @param {number} rm market expected return (decimal)
 * @returns {number} required return (decimal)
 */
export function capmReturn(beta, rf, rm) {
  return rf + beta * (rm - rf);
}

/**
 * Jensen's alpha: actual expected return minus the CAPM-required return.
 * alpha = E[r] - [rf + beta (E[r_M] - rf)]. Positive = underpriced.
 * @param {number} er asset's expected return (decimal)
 * @param {number} beta systematic risk
 * @param {number} rf risk-free rate (decimal)
 * @param {number} rm market expected return (decimal)
 * @returns {number} alpha (decimal)
 */
export function alpha(er, beta, rf, rm) {
  return er - capmReturn(beta, rf, rm);
}

/* ============================================================= *
 *  SEEDED RANDOMNESS                                            *
 * ============================================================= */

/**
 * mulberry32 — a tiny, fast, deterministic 32-bit PRNG. Returns a function
 * that yields the next uniform in [0, 1) each call. The same seed always
 * reproduces the same sequence (used so shared URLs reproduce the picture).
 * @param {number} seed 32-bit unsigned integer seed
 * @returns {() => number} generator returning uniforms in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw one standard normal deviate via the Box–Muller transform, using a
 * uniform generator (e.g. from `mulberry32`).
 * @param {() => number} rng uniform generator returning [0, 1)
 * @returns {number} a standard-normal sample
 */
export function randn(rng) {
  let u = 0;
  let v = 0;
  // avoid log(0)
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw a Dirichlet(alpha) sample — a random point on the simplex (weights that
 * are non-negative and sum to 1). Built from independent Gamma draws; for the
 * common symmetric case pass a scalar concentration and a dimension via
 * `alpha` being a number-filled array. Uses the Marsaglia–Tsang gamma method.
 * @param {number[]} alphas concentration parameters (length = # assets, all >0)
 * @param {() => number} rng uniform generator (e.g. from `mulberry32`)
 * @returns {number[]} weights that are >=0 and sum to 1
 */
export function dirichlet(alphas, rng) {
  const gammas = alphas.map((a) => gammaSample(a, rng));
  const sum = gammas.reduce((s, g) => s + g, 0);
  return gammas.map((g) => g / sum);
}

/**
 * Marsaglia–Tsang gamma sampler with shape k and scale 1 (internal helper for
 * `dirichlet`). Works for any k > 0 via the k<1 boosting trick.
 * @param {number} k shape parameter (> 0)
 * @param {() => number} rng uniform generator
 * @returns {number} a Gamma(k, 1) sample
 */
function gammaSample(k, rng) {
  if (k < 1) {
    // boost: Gamma(k) = Gamma(k+1) * U^{1/k}
    const u = rng();
    return gammaSample(k + 1, rng) * Math.pow(u === 0 ? Number.MIN_VALUE : u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x;
    let vv;
    do {
      x = randn(rng);
      vv = 1 + c * x;
    } while (vv <= 0);
    vv = vv * vv * vv;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * vv;
    if (Math.log(u) < 0.5 * x * x + d * (1 - vv + Math.log(vv))) return d * vv;
  }
}
