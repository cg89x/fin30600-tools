// @ts-check
/**
 * finmath.test.js — zero-dependency unit tests. Run with:  node --test tests/
 *
 * The check values come from the FIN 30600 lecture decks (Lecture 3 §3–4,
 * Lecture 4) plus one 3-asset frontier/tangency case computed independently
 * with python3 + numpy (the snippet + its printed output are pasted inline so
 * the expected numbers are reproducible).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fm from '../lib/finmath.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
function assertNear(a, b, tol, msg) {
  assert.ok(near(a, b, tol), `${msg ?? ''} expected ${b}, got ${a} (tol ${tol})`);
}

/* ---------------------------------------------------------------- two asset */

test('two-asset: deck example wA=0.6, rho=+0.2', () => {
  // Deck (sec4_tworisky.tex): A 8%/13%, B 16%/20%, cov 0.0052 (rho +0.2).
  const cov = fm.covFromCorr(0.13, 0.20, 0.2);
  assertNear(cov, 0.0052, 1e-9, 'cov from corr');
  const er = fm.twoAssetMean(0.6, 0.08, 0.16);
  assertNear(er, 0.112, 1e-12, 'E[R_P] = 11.2%');
  const sd = fm.twoAssetStd(0.6, 0.13, 0.20, cov);
  assertNear(sd, 0.1224, 5e-5, 'sigma_P = 12.24%');
  // exact variance from the deck: 0.01498
  assertNear(fm.twoAssetVar(0.6, 0.13, 0.20, cov), 0.01498, 1e-9, 'var 0.01498');
});

test('two-asset: rho=-0.2 lowers risk to 9.99%', () => {
  const cov = fm.covFromCorr(0.13, 0.20, -0.2); // -0.0052
  assertNear(cov, -0.0052, 1e-9);
  const sd = fm.twoAssetStd(0.6, 0.13, 0.20, cov);
  assertNear(sd, 0.0999, 5e-5, 'sigma_P = 9.99%');
});

test('two-asset MVP weight formulas (rho=0 and rho=-1 special cases)', () => {
  // rho=0 special case: wA = sigmaB^2 / (sigmaA^2+sigmaB^2)
  const cov0 = fm.covFromCorr(0.13, 0.20, 0);
  const w0 = fm.mvpWeightTwoAsset(0.13, 0.20, cov0);
  const expect0 = 0.20 ** 2 / (0.13 ** 2 + 0.20 ** 2);
  assertNear(w0, expect0, 1e-12, 'rho=0 MVP weight');
  assertNear(w0, 0.703, 1e-3, 'deck rho=0 MVP ~0.703');
  // rho=-1 special case: wA = sigmaB/(sigmaA+sigmaB); deck says 0.6061
  const covm1 = fm.covFromCorr(0.13, 0.20, -1);
  const wm1 = fm.mvpWeightTwoAsset(0.13, 0.20, covm1);
  const expectm1 = 0.20 / (0.13 + 0.20);
  assertNear(wm1, expectm1, 1e-12, 'rho=-1 MVP weight');
  assertNear(wm1, 0.6061, 1e-4, 'deck rho=-1 MVP 0.6061');
  // the perfect hedge has zero variance
  assertNear(fm.twoAssetStd(wm1, 0.13, 0.20, covm1), 0, 1e-7, 'perfect hedge sigma=0');
});

/* ------------------------------------------------------- capital allocation */

test('CAL / utility: deck example rf=7%, rp=15%, sigma_p=22%', () => {
  const rf = 0.07, rp = 0.15, sp = 0.22;
  // w=0.7 => E[R_C]=12.6%, sigma_C=15.4%
  assertNear(fm.completeReturn(0.7, rp, rf), 0.126, 1e-12, 'E[R_C]=12.6%');
  assertNear(fm.completeStd(0.7, sp), 0.154, 1e-12, 'sigma_C=15.4%');
  // Sharpe = (0.15-0.07)/0.22 = 0.3636...
  assertNear(fm.sharpe(rp, rf, sp), 0.08 / 0.22, 1e-12, 'Sharpe 0.3636');
  // Optimal y* with A=2 => 0.8264 (deck)
  const ystar = fm.optimalY(rp, rf, sp, 2);
  assertNear(ystar, 0.08 / (2 * 0.22 ** 2), 1e-12, 'y* formula');
  assertNear(ystar, 0.8264, 1e-4, 'deck y*=0.8264');
});

test('utility U = E[r] - 1/2 A sigma^2', () => {
  assertNear(fm.utility(0.10, 0.20, 3), 0.10 - 0.5 * 3 * 0.04, 1e-12);
  assertNear(fm.utility(0.10, 0.20, 3), 0.04, 1e-12);
});

/* --------------------------------------------------------- linear algebra */

test('solve + inverse round-trip on a small SPD matrix', () => {
  const A = [
    [4, 1, 2],
    [1, 3, 0],
    [2, 0, 5],
  ];
  const b = [1, 2, 3];
  const x = fm.solve(A, b);
  const Ax = fm.matVec(A, x);
  for (let i = 0; i < 3; i++) assertNear(Ax[i], b[i], 1e-10, `Ax[${i}]`);
  const inv = fm.inverse(A);
  const I = inv.map((_, i) => fm.matVec(A, inv.map((r) => r[i])));
  // I should be identity columns
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      assertNear(I[i][j], i === j ? 1 : 0, 1e-10, `I[${i}][${j}]`);
});

test('solve throws on a singular matrix', () => {
  const A = [[1, 2], [2, 4]]; // rank-deficient
  assert.throws(() => fm.solve(A, [1, 2]), /singular/);
});

test('Cholesky PD check accepts PD and rejects non-PD', () => {
  const pd = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]]; // classic SPD
  assert.ok(fm.isPositiveDefinite(pd), 'SPD accepted');
  assert.ok(fm.cholesky(pd) !== null, 'Cholesky factor returned');
  // A correlation matrix that is NOT PD (violates the triangle inequality):
  // rho_12 = 0.9, rho_13 = 0.9, rho_23 = -0.9 has a negative eigenvalue.
  const badCorr = [
    [1, 0.9, 0.9],
    [0.9, 1, -0.9],
    [0.9, -0.9, 1],
  ];
  assert.ok(!fm.isPositiveDefinite(badCorr), 'non-PD correlation rejected');
  assert.equal(fm.cholesky(badCorr), null, 'Cholesky returns null on non-PD');
});

/* --------------------------------------- N-asset MVP / tangency (numpy ref) */

/*
  Independently computed reference (python3 + numpy). Snippet:

    import numpy as np
    mu = np.array([0.08, 0.12, 0.15])
    sig = np.array([0.13, 0.20, 0.25])
    corr = np.array([[1,0.30,0.20],[0.30,1,0.50],[0.20,0.50,1]])
    Sigma = np.outer(sig, sig) * corr
    inv = np.linalg.inv(Sigma); one = np.ones(3); rf = 0.03
    w_mvp = inv@one / (one@inv@one)
    w_tan = inv@(mu-rf*one); w_tan /= w_tan.sum()
    print(w_mvp, mu@w_mvp, np.sqrt(w_mvp@Sigma@w_mvp))
    print(w_tan, mu@w_tan, np.sqrt(w_tan@Sigma@w_tan))

  Printed output:
    w_mvp = [0.7497879388 0.1601567234 0.0900553379]
    mu_mvp = 0.0927101425859353   sig_mvp = 0.12044084981230463
    w_tan = [0.4565173283 0.2447158321 0.2987668396]
    mu_tan = 0.11070231205495598  sig_tan = 0.13663057800412512
    sharpe = 0.5906606942153128
*/
test('3-asset global MVP matches numpy reference', () => {
  const sig = [0.13, 0.20, 0.25];
  const corr = [
    [1, 0.30, 0.20],
    [0.30, 1, 0.50],
    [0.20, 0.50, 1],
  ];
  const mu = [0.08, 0.12, 0.15];
  const Sigma = fm.covMatrix(sig, corr);
  const w = fm.globalMVP(Sigma);
  assertNear(w[0], 0.7497879388, 1e-8, 'w_mvp[0]');
  assertNear(w[1], 0.1601567234, 1e-8, 'w_mvp[1]');
  assertNear(w[2], 0.0900553379, 1e-8, 'w_mvp[2]');
  assertNear(w.reduce((a, b) => a + b, 0), 1, 1e-12, 'weights sum to 1');
  assertNear(fm.portfolioMean(w, mu), 0.0927101425859353, 1e-10, 'mu_mvp');
  assertNear(fm.portfolioStd(w, Sigma), 0.12044084981230463, 1e-10, 'sig_mvp');
});

test('3-asset tangency matches numpy reference', () => {
  const sig = [0.13, 0.20, 0.25];
  const corr = [
    [1, 0.30, 0.20],
    [0.30, 1, 0.50],
    [0.20, 0.50, 1],
  ];
  const mu = [0.08, 0.12, 0.15];
  const rf = 0.03;
  const Sigma = fm.covMatrix(sig, corr);
  const w = fm.tangencyPortfolio(mu, Sigma, rf);
  assertNear(w[0], 0.4565173283, 1e-8, 'w_tan[0]');
  assertNear(w[1], 0.2447158321, 1e-8, 'w_tan[1]');
  assertNear(w[2], 0.2987668396, 1e-8, 'w_tan[2]');
  const muT = fm.portfolioMean(w, mu);
  const sdT = fm.portfolioStd(w, Sigma);
  assertNear(muT, 0.11070231205495598, 1e-10, 'mu_tan');
  assertNear(sdT, 0.13663057800412512, 1e-10, 'sig_tan');
  assertNear((muT - rf) / sdT, 0.5906606942153128, 1e-9, 'tangency Sharpe');
});

test('frontier: MVP is the min-variance point; frontier passes through key portfolios', () => {
  const sig = [0.13, 0.20, 0.25];
  const corr = [[1, 0.30, 0.20], [0.30, 1, 0.50], [0.20, 0.50, 1]];
  const mu = [0.08, 0.12, 0.15];
  const Sigma = fm.covMatrix(sig, corr);
  const wMvp = fm.globalMVP(Sigma);
  const mMvp = fm.portfolioMean(wMvp, mu);
  const sMvp = fm.portfolioStd(wMvp, Sigma);
  // frontierStdAtMean at the MVP mean equals the MVP std
  assertNear(fm.frontierStdAtMean(mMvp, mu, Sigma), sMvp, 1e-9, 'frontier std at MVP mean');
  // no frontier point has lower std than the MVP
  for (const p of fm.traceFrontier(mu, Sigma, { n: 50 })) {
    assert.ok(p.std >= sMvp - 1e-9, `frontier std ${p.std} >= MVP std ${sMvp}`);
  }
  // frontierWeightsAtMean reproduces the target mean and lies on the frontier
  const target = 0.13;
  const wF = fm.frontierWeightsAtMean(target, mu, Sigma);
  assertNear(fm.portfolioMean(wF, mu), target, 1e-10, 'frontier weights hit target mean');
  assertNear(fm.portfolioStd(wF, Sigma), fm.frontierStdAtMean(target, mu, Sigma), 1e-9, 'weights std == closed form');
});

/* -------------------------------------------------------------------- OLS */

/*
  Hand/numpy-checked tiny sample. x=[1,2,3,4,5], y=[2,4,5,4,6].
  numpy: intercept=1.8, slope=0.8, se=[0.938083152, 0.2828427125], r2=0.7272727273
*/
test('OLS on a tiny hand-checked sample', () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 6];
  const r = fm.ols(x, y);
  assertNear(r.slope, 0.8, 1e-12, 'slope');
  assertNear(r.intercept, 1.8, 1e-12, 'intercept');
  assertNear(r.r2, 0.7272727272727273, 1e-12, 'R^2');
  assertNear(r.seIntercept, 0.938083152, 1e-8, 'se(intercept)');
  assertNear(r.seSlope, 0.2828427125, 1e-8, 'se(slope)');
});

/* ------------------------------------------------------------- CAPM / SML */

test('CAPM required return and alpha', () => {
  const rf = 0.03, rm = 0.10;
  // beta=1 sits on the market: required return = rm
  assertNear(fm.capmReturn(1, rf, rm), rm, 1e-12, 'beta=1 -> rm');
  // beta=1.5 => 0.03 + 1.5*0.07 = 0.135
  assertNear(fm.capmReturn(1.5, rf, rm), 0.135, 1e-12, 'beta=1.5');
  // asset returning 15% at beta 1.5 has alpha = 0.015 (underpriced)
  assertNear(fm.alpha(0.15, 1.5, rf, rm), 0.015, 1e-12, 'alpha positive');
  // asset returning 12% is overpriced (negative alpha)
  assert.ok(fm.alpha(0.12, 1.5, rf, rm) < 0, 'alpha negative');
});

/* -------------------------------------------------------- seeded randomness */

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = fm.mulberry32(12345);
  const b = fm.mulberry32(12345);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB, 'same seed -> same sequence');
  for (const v of seqA) assert.ok(v >= 0 && v < 1, 'uniform in [0,1)');
  // a different seed gives a different first draw
  assert.notEqual(fm.mulberry32(999)(), seqA[0]);
});

test('randn is roughly standard normal (seeded)', () => {
  const rng = fm.mulberry32(42);
  const n = 20000;
  let sum = 0, sumsq = 0;
  for (let i = 0; i < n; i++) { const z = fm.randn(rng); sum += z; sumsq += z * z; }
  const mean = sum / n;
  const varr = sumsq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `mean ~0, got ${mean}`);
  assert.ok(Math.abs(varr - 1) < 0.06, `var ~1, got ${varr}`);
});

test('dirichlet returns a valid simplex point (seeded)', () => {
  const rng = fm.mulberry32(7);
  for (let t = 0; t < 100; t++) {
    const w = fm.dirichlet([1, 1, 1, 1], rng);
    assert.equal(w.length, 4);
    let s = 0;
    for (const v of w) { assert.ok(v >= 0, 'nonneg weight'); s += v; }
    assertNear(s, 1, 1e-9, 'weights sum to 1');
  }
});

/* --------------------------------------------- diversification (L4 appendix) */

test('diversification: workbook PortfolioVarianceAndDiversification.xlsx', () => {
  // Case 1 (col B): =SQRT(1/N)
  assertNear(Math.sqrt(fm.ewVarUncorrelated(1)), 1, 1e-12, 'case1 N=1');
  assertNear(Math.sqrt(fm.ewVarUncorrelated(100)), 0.1, 1e-12, 'case1 N=100');
  // Case 2 (col C): =SQRT(1/N + (N-1)/N * 0.5)
  assertNear(Math.sqrt(fm.ewVarCommonCorr(2, 0.5)), Math.sqrt(0.75), 1e-12, 'case2 N=2');
  assertNear(Math.sqrt(fm.ewVarCommonCorr(100, 0.5)), Math.sqrt(0.505), 1e-12, 'case2 N=100');
  // Case 3 (col D): beta = SQRT(0.5) => identical to case 2 at rho = beta^2
  const beta = Math.sqrt(0.5);
  for (const n of [1, 5, 25, 100]) {
    assertNear(fm.ewVarCommonCorr(n, beta * beta), fm.ewVarCommonCorr(n, 0.5), 1e-12, `case3 N=${n}`);
  }
  // systematic floor: sigma_P -> sqrt(rho) as N grows
  assertNear(Math.sqrt(fm.ewVarCommonCorr(1e9, 0.5)), Math.sqrt(0.5), 1e-4, 'floor');
});
