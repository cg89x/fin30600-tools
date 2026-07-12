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

/* ------------------------------------------------------------------------- *
 * Diversification vs. number of assets (Lecture 4 appendix; mirrors the
 * PortfolioVarianceAndDiversification.xlsx workbook). All asset variances are
 * normalized to 1, weights are equal (w = 1/N), so sigma_P is measured in
 * units of one asset's sigma.
 * ------------------------------------------------------------------------- */

/**
 * Case 1 — uncorrelated returns: sigma_P^2 = 1/N.
 * @param {number} n number of assets (>= 1)
 * @returns {number} portfolio variance
 */
export function ewVarUncorrelated(n) {
  return 1 / n;
}

/**
 * Cases 2 & 3 — common pairwise correlation rho (unit variances):
 * sigma_P^2 = 1/N + ((N-1)/N) rho. The CAPM single-factor case with
 * Var(R_i) = 1 is this formula at rho = beta^2 (Cov = beta_i beta_j sigma_M^2).
 * @param {number} n number of assets (>= 1)
 * @param {number} rho common pairwise correlation
 * @returns {number} portfolio variance
 */
export function ewVarCommonCorr(n, rho) {
  return 1 / n + ((n - 1) / n) * rho;
}

/* ============================================================= *
 *  OPTION PRICING — Black–Scholes (Lecture 8)                   *
 * ============================================================= */

/**
 * Standard normal CDF Φ(x), via the Hastings polynomial approximation
 * (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8) — the same approximation
 * classic spreadsheet NORMSDIST implementations use.
 * @param {number} x
 * @returns {number} P(Z <= x) for Z ~ N(0,1)
 */
export function normCdf(x) {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const phi = Math.exp(-0.5 * ax * ax) / Math.sqrt(2 * Math.PI); // standard normal pdf
  const tail = phi * poly; // P(Z > ax)
  return x >= 0 ? 1 - tail : tail;
}

/**
 * Black–Scholes d1 and d2 (with optional continuous dividend yield q).
 * d1 = [ln(S/X) + (r - q + sigma^2/2) T] / (sigma sqrt(T)), d2 = d1 - sigma sqrt(T).
 * @param {number} S spot price
 * @param {number} X strike price
 * @param {number} sigma volatility (decimal, annualized)
 * @param {number} r risk-free rate (decimal, continuously compounded)
 * @param {number} T time to expiration in years (> 0)
 * @param {number} [q=0] continuous dividend yield (decimal)
 * @returns {{d1:number, d2:number}}
 */
export function bsD1D2(S, X, sigma, r, T, q = 0) {
  const sqT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / X) + (r - q + 0.5 * sigma * sigma) * T) / sqT;
  return { d1, d2: d1 - sqT };
}

/**
 * Black–Scholes European call price.
 * C = S e^{-qT} N(d1) - X e^{-rT} N(d2). At T <= 0 or sigma <= 0 returns the
 * (discounted-strike) intrinsic limit so payoff plots degrade gracefully.
 * @param {number} S @param {number} X @param {number} sigma volatility (decimal)
 * @param {number} r risk-free rate (decimal) @param {number} T years
 * @param {number} [q=0] dividend yield (decimal)
 * @returns {number} call price
 */
export function bsCall(S, X, sigma, r, T, q = 0) {
  if (T <= 0 || sigma <= 0) {
    const tt = Math.max(T, 0);
    return Math.max(S * Math.exp(-q * tt) - X * Math.exp(-r * tt), 0);
  }
  const { d1, d2 } = bsD1D2(S, X, sigma, r, T, q);
  return S * Math.exp(-q * T) * normCdf(d1) - X * Math.exp(-r * T) * normCdf(d2);
}

/**
 * Black–Scholes European put price.
 * P = X e^{-rT} N(-d2) - S e^{-qT} N(-d1).
 * @param {number} S @param {number} X @param {number} sigma volatility (decimal)
 * @param {number} r risk-free rate (decimal) @param {number} T years
 * @param {number} [q=0] dividend yield (decimal)
 * @returns {number} put price
 */
export function bsPut(S, X, sigma, r, T, q = 0) {
  if (T <= 0 || sigma <= 0) {
    const tt = Math.max(T, 0);
    return Math.max(X * Math.exp(-r * tt) - S * Math.exp(-q * tt), 0);
  }
  const { d1, d2 } = bsD1D2(S, X, sigma, r, T, q);
  return X * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

/**
 * Black–Scholes call delta = e^{-qT} N(d1).
 * @param {number} S @param {number} X @param {number} sigma @param {number} r
 * @param {number} T @param {number} [q=0]
 * @returns {number} dC/dS in (0, 1)
 */
export function bsCallDelta(S, X, sigma, r, T, q = 0) {
  const { d1 } = bsD1D2(S, X, sigma, r, T, q);
  return Math.exp(-q * T) * normCdf(d1);
}

/**
 * Black–Scholes put delta = e^{-qT} (N(d1) - 1).
 * @param {number} S @param {number} X @param {number} sigma @param {number} r
 * @param {number} T @param {number} [q=0]
 * @returns {number} dP/dS in (-1, 0)
 */
export function bsPutDelta(S, X, sigma, r, T, q = 0) {
  const { d1 } = bsD1D2(S, X, sigma, r, T, q);
  return Math.exp(-q * T) * (normCdf(d1) - 1);
}

/**
 * Put–call parity in the DECK'S form (Lecture 8 §3), with a discrete
 * effective-annual risk-free rate: C = P + S - X / (1 + rf)^T.
 * (Note: Black–Scholes itself uses continuous discounting e^{-rT}; this
 * function reproduces the deck's arbitrage examples, which discount at an
 * effective annual yield.)
 * @param {number} P put price @param {number} S spot @param {number} X strike
 * @param {number} rf effective annual risk-free rate (decimal)
 * @param {number} T years to expiration
 * @returns {number} the parity-implied call price
 */
export function parityCall(P, S, X, rf, T) {
  return P + S - X / Math.pow(1 + rf, T);
}

/**
 * Put–call parity solved for the put: P = C - S + X / (1 + rf)^T.
 * @param {number} C call price @param {number} S spot @param {number} X strike
 * @param {number} rf effective annual risk-free rate (decimal)
 * @param {number} T years to expiration
 * @returns {number} the parity-implied put price
 */
export function parityPut(C, S, X, rf, T) {
  return C - S + X / Math.pow(1 + rf, T);
}

/* ============================================================= *
 *  FIXED INCOME — price, duration, forwards (Lecture 7)         *
 * ============================================================= */

/**
 * Price of a bond paying an annual coupon, discounted at a flat yield y.
 * B = sum_t cF/(1+y)^t + F/(1+y)^n (annual periods, coupon = couponRate * face).
 * @param {number} couponRate annual coupon rate (decimal, e.g. 0.10)
 * @param {number} y yield to maturity (decimal, effective annual)
 * @param {number} n years to maturity (integer >= 1)
 * @param {number} [face=1000] face value
 * @returns {number} bond price
 */
export function bondPrice(couponRate, y, n, face = 1000) {
  const c = couponRate * face;
  let price = 0;
  for (let t = 1; t <= n; t++) price += c / Math.pow(1 + y, t);
  return price + face / Math.pow(1 + y, n);
}

/**
 * Macaulay duration of an annual-coupon bond: the PV-weighted average time of
 * the cash flows, D = sum_t t * [CF_t/(1+y)^t] / B.
 * @param {number} couponRate annual coupon rate (decimal)
 * @param {number} y yield to maturity (decimal)
 * @param {number} n years to maturity (integer >= 1)
 * @param {number} [face=1000] face value
 * @returns {number} Macaulay duration in years
 */
export function macaulayDuration(couponRate, y, n, face = 1000) {
  const c = couponRate * face;
  let price = 0;
  let weighted = 0;
  for (let t = 1; t <= n; t++) {
    const cf = c + (t === n ? face : 0);
    const pv = cf / Math.pow(1 + y, t);
    price += pv;
    weighted += t * pv;
  }
  return weighted / price;
}

/**
 * Duration approximation to the relative price change (Lecture 7 §4):
 * DeltaB / B ≈ -D * Deltay / (1 + y), with D the MACAULAY duration and y the
 * starting yield. (Equivalently -D* Deltay with modified duration D* = D/(1+y).)
 * @param {number} D Macaulay duration (years)
 * @param {number} y starting yield (decimal)
 * @param {number} dy yield change (decimal, e.g. -0.005 for -50bp)
 * @returns {number} approximate relative price change (decimal)
 */
export function durationApproxRel(D, y, dy) {
  return (-D * dy) / (1 + y);
}

/**
 * Implied forward rate between t1 and t2 from two spot rates (annual comp.):
 * (1+y2)^{t2} = (1+y1)^{t1} (1+f)^{t2-t1}.
 * @param {number} y1 spot rate to t1 (decimal) @param {number} t1 shorter maturity
 * @param {number} y2 spot rate to t2 (decimal) @param {number} t2 longer maturity (> t1)
 * @returns {number} annualized forward rate between t1 and t2 (decimal)
 */
export function forwardRate(y1, t1, y2, t2) {
  const growth = Math.pow(1 + y2, t2) / Math.pow(1 + y1, t1);
  return Math.pow(growth, 1 / (t2 - t1)) - 1;
}

/**
 * Price a coupon bond off a spot (zero) curve: each cash flow discounted at
 * its own maturity's spot rate. spots[t-1] is the year-t spot (decimal); the
 * bond matures in spots.length years.
 * @param {number} couponRate annual coupon rate (decimal)
 * @param {number[]} spots spot rates for years 1..n (decimal)
 * @param {number} [face=1000] face value
 * @returns {number} bond price off the curve
 */
export function bondPriceFromSpots(couponRate, spots, face = 1000) {
  const n = spots.length;
  const c = couponRate * face;
  let price = 0;
  for (let t = 1; t <= n; t++) {
    const cf = c + (t === n ? face : 0);
    price += cf / Math.pow(1 + spots[t - 1], t);
  }
  return price;
}

/* =========================================================================
 * Returns, averages & fund fees (Lecture 1 §4, §6)
 * ========================================================================= */

/**
 * Arithmetic average of a return series: (R_1 + … + R_N) / N.
 * @param {number[]} rets period returns (decimal)
 * @returns {number} arithmetic mean (decimal)
 */
export function arithmeticMean(rets) {
  return rets.reduce((s, r) => s + r, 0) / rets.length;
}

/**
 * Geometric average of a return series: [(1+R_1)…(1+R_N)]^{1/N} − 1 — the
 * constant return that compounds to the same terminal wealth.
 * @param {number[]} rets period returns (decimal)
 * @returns {number} geometric mean (decimal)
 */
export function geometricMean(rets) {
  const growth = rets.reduce((p, r) => p * (1 + r), 1);
  return Math.pow(growth, 1 / rets.length) - 1;
}

/**
 * Normal-returns approximation R_G ≈ R_A − σ²/2 (the "volatility drag").
 * @param {number} ra arithmetic mean (decimal)
 * @param {number} sigma standard deviation of returns (decimal)
 * @returns {number} approximate geometric mean (decimal)
 */
export function geometricApprox(ra, sigma) {
  return ra - 0.5 * sigma * sigma;
}

/**
 * Terminal wealth of a fund investment net of fees (deck L1 §6):
 * X_T = X_0 (1 − frontLoad) (1 + r − annualFee)^T (1 − exitFee).
 * @param {number} x0 amount invested
 * @param {number} r gross annual return (decimal)
 * @param {number} T holding period in years
 * @param {{frontLoad?: number, annualFee?: number, exitFee?: number}} [fees]
 * @returns {number} terminal wealth after all fees
 */
export function feeWealth(x0, r, T, fees = {}) {
  const { frontLoad = 0, annualFee = 0, exitFee = 0 } = fees;
  return x0 * (1 - frontLoad) * Math.pow(1 + r - annualFee, T) * (1 - exitFee);
}

/**
 * Back-end load that declines with holding period (deck's Class B: 5%
 * redemption fee decreasing by 1% p.a., floored at zero).
 * @param {number} start initial exit fee (decimal)
 * @param {number} stepPerYear annual decline (decimal)
 * @param {number} T holding period in years
 * @returns {number} exit fee applying after T years (decimal, ≥ 0)
 */
export function decliningExitFee(start, stepPerYear, T) {
  return Math.max(0, start - stepPerYear * T);
}

/* =========================================================================
 * Limit order book (Lecture 2 §3)
 * ========================================================================= */

/**
 * Walk a market order through one side of a limit order book, filling level
 * by level from the best price. Levels must be sorted best-first (descending
 * prices for bids / a sell order, ascending for asks / a buy order); this
 * function consumes them in the order given.
 * @param {{price: number, size: number}[]} levels book side, best price first
 * @param {number} qty shares to trade
 * @returns {{fills: {price: number, shares: number}[], sharesFilled: number,
 *   total: number, avgPrice: number|null}} fills per level, shares actually
 *   filled (≤ qty if the book is exhausted), total dollars, and the average
 *   execution price (null if nothing filled)
 */
export function walkBook(levels, qty) {
  const fills = [];
  let remaining = qty;
  let total = 0;
  for (const { price, size } of levels) {
    if (remaining <= 0) break;
    const shares = Math.min(remaining, size);
    if (shares > 0) {
      fills.push({ price, shares });
      total += price * shares;
      remaining -= shares;
    }
  }
  const sharesFilled = qty - Math.max(0, remaining);
  return { fills, sharesFilled, total, avgPrice: sharesFilled > 0 ? total / sharesFilled : null };
}

/* =========================================================================
 * Buying on margin & short sales (Lecture 2 §4–5)
 * ========================================================================= */

/**
 * Maximum shares purchasable with `equity` of own cash at initial margin
 * rate `im`: im = equity / (N·P) ⇒ N = equity / (P·im).
 * @param {number} equity investor's own cash
 * @param {number} price share price
 * @param {number} im initial margin rate (decimal)
 * @returns {number} number of shares (not rounded)
 */
export function marginSharesMax(equity, price, im) {
  return equity / (price * im);
}

/**
 * Margin rate of a long levered position: (N·P − Loan) / (N·P).
 * @param {number} n shares held @param {number} p current price
 * @param {number} loan broker loan outstanding
 * @returns {number} margin rate (decimal; negative once equity is wiped out)
 */
export function longMarginRate(n, p, loan) {
  return (n * p - loan) / (n * p);
}

/**
 * Price that triggers a margin call on a long position:
 * mm = (N·P − Loan)/(N·P) ⇒ P = Loan / (N (1 − mm)).
 * @param {number} loan loan outstanding (incl. any accrued interest)
 * @param {number} n shares held @param {number} mm maintenance margin (decimal)
 * @returns {number} margin-call price
 */
export function longMarginCallPrice(loan, n, mm) {
  return loan / (n * (1 - mm));
}

/**
 * Return on equity of a long margin position: (N·P₁ − Loan − E₀) / E₀.
 * Pass the loan gross of any interest owed at the horizon.
 * @param {number} n shares @param {number} p1 end price
 * @param {number} loan loan repaid at the end @param {number} e0 initial equity
 * @returns {number} holding-period return on equity (decimal)
 */
export function longLeveredReturn(n, p1, loan, e0) {
  return (n * p1 - loan - e0) / e0;
}

/**
 * Cash a short seller must post at initial margin rate `im`:
 * im = C₀ / (N·P₀) ⇒ C₀ = im·N·P₀.
 * @param {number} n shares shorted @param {number} p0 sale price
 * @param {number} im initial margin rate (decimal)
 * @returns {number} required margin cash
 */
export function shortCashRequired(n, p0, im) {
  return im * n * p0;
}

/**
 * Margin rate of a short position: (C₀ + N·P₀ − N·P) / (N·P) — cash in plus
 * sale proceeds, less the cost of buying the shares back, over position value.
 * @param {number} c0 margin cash posted @param {number} n shares shorted
 * @param {number} p0 sale price @param {number} p current price
 * @returns {number} margin rate (decimal)
 */
export function shortMarginRate(c0, n, p0, p) {
  return (c0 + n * p0 - n * p) / (n * p);
}

/**
 * Price that triggers a margin call on a short position:
 * mm = (C₀ + N·P₀ − N·P)/(N·P) ⇒ P = (C₀ + N·P₀) / (N (1 + mm)).
 * @param {number} c0 margin cash posted @param {number} n shares shorted
 * @param {number} p0 sale price @param {number} mm maintenance margin (decimal)
 * @returns {number} margin-call price
 */
export function shortMarginCallPrice(c0, n, p0, mm) {
  return (c0 + n * p0) / (n * (1 + mm));
}

/**
 * Return on equity of a short position: E₁ = C₀ + N·P₀ − N·P₁, so
 * R = (E₁ − C₀)/C₀ = N(P₀ − P₁)/C₀ = −R_stock / im.
 * @param {number} c0 margin cash posted @param {number} n shares shorted
 * @param {number} p0 sale price @param {number} p1 end price
 * @returns {number} holding-period return on equity (decimal)
 */
export function shortReturn(c0, n, p0, p1) {
  return (n * (p0 - p1)) / c0;
}
