// @ts-check
/**
 * anomaly-lab-data.test.js — sanity + anchor tests for the anomaly lab's
 * baked Ken French data module (tools/anomaly-lab/data.js, 202608 CRSP
 * vintage, 1963-07..2026-08) run through lib/finmath.js olsMulti.
 *
 * Run with:  node --test tests/anomaly-lab-data.test.js
 *
 * Anchors: since 2026-10-07 the Topic 5 deck tables are computed from the
 * SAME data over the full sample (course tree: Topics/Topic 5/code/
 * make_l5_tables.py), so the full-sample values below are the deck's
 * printed numbers (2 dp). Expected values were computed independently with
 * python3 + numpy from the same zips (2026-10-07). After a data refresh,
 * recompute them with numpy and update both this file and the deck.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { olsMulti } from '../lib/finmath.js';
import { META, FACTORS, SORTS } from '../tools/anomaly-lab/data.js';

function assertNear(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg}: got ${actual}, want ${expected} ±${tol}`);
}

const N = META.months; // full sample

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const excess = (dec, upTo) => dec.slice(0, upTo).map((r, t) => r - FACTORS.rf[t]);

test('data module is internally consistent', () => {
  assert.equal(META.start, '1963-07', 'sample starts with the BETA file');
  assert.equal(META.end, '2026-08', 'sample ends with the 202608 vintage');
  assert.equal(N, (2026 - 1963) * 12 + (8 - 7) + 1, 'month count');
  for (const key of ['mktrf', 'smb', 'hml', 'wml', 'rf']) {
    assert.equal(FACTORS[key].length, N, `FACTORS.${key} aligned`);
  }
  for (const sort of ['beta', 'size', 'bm', 'mom']) {
    assert.equal(SORTS[sort].length, 10, `${sort}: ten deciles`);
    for (const dec of SORTS[sort]) {
      assert.equal(dec.length, N, `${sort} decile aligned`);
    }
  }
});

test('full-sample anchors: factor premia and beta sort (deck s28-s29)', () => {
  // Deck: Mkt 7.22, SMB 1.77, HML 3.53, WML 7.16
  assertNear(mean(FACTORS.mktrf) * 12, 7.221, 0.01, 'Mkt premium');
  assertNear(mean(FACTORS.smb) * 12, 1.769, 0.01, 'SMB mean');
  assertNear(mean(FACTORS.hml) * 12, 3.527, 0.01, 'HML mean');
  assertNear(mean(FACTORS.wml) * 12, 7.156, 0.01, 'WML mean');

  const mkt = [FACTORS.mktrf];
  // Beta-sort D1 (deck: avg 6.80, CAPM beta 0.59, alpha +2.5)
  const d1 = olsMulti(mkt, excess(SORTS.beta[0], N));
  assertNear(mean(excess(SORTS.beta[0], N)) * 12, 6.799, 0.01, 'D1 avg');
  assertNear(d1.betas[0], 0.594, 0.005, 'D1 beta');
  assertNear(d1.alpha * 12, 2.509, 0.01, 'D1 alpha');
  // Beta-sort D10 (deck: avg 8.67, CAPM beta 1.60, alpha -2.9)
  const d10 = olsMulti(mkt, excess(SORTS.beta[9], N));
  assertNear(mean(excess(SORTS.beta[9], N)) * 12, 8.668, 0.01, 'D10 avg');
  assertNear(d10.betas[0], 1.604, 0.005, 'D10 beta');
  assertNear(d10.alpha * 12, -2.917, 0.01, 'D10 alpha');
});

test('full-sample FF3C loadings, beta-sort D10 (deck: 1.39, 0.77, -0.23, -0.18)', () => {
  const X = [FACTORS.mktrf, FACTORS.smb, FACTORS.hml, FACTORS.wml];
  const f = olsMulti(X, excess(SORTS.beta[9], N));
  assertNear(f.betas[0], 1.392, 0.005, 'mkt loading');
  assertNear(f.betas[1], 0.775, 0.005, 'SMB loading');
  assertNear(f.betas[2], -0.227, 0.005, 'HML loading');
  assertNear(f.betas[3], -0.181, 0.005, 'WML loading');
  assertNear(f.alpha * 12, -0.658, 0.01, 'Carhart alpha');
  assertNear(f.r2, 0.846, 5e-3, 'R2');
});

test('full-sample RMS alphas = the deck RMS table', () => {
  const MODELS = {
    capm: [FACTORS.mktrf],
    ff3c: [FACTORS.mktrf, FACTORS.smb, FACTORS.hml, FACTORS.wml],
  };
  const rms = (sort, model) => {
    let ss = 0;
    for (const dec of SORTS[sort]) {
      const a = olsMulti(MODELS[model], excess(dec, N)).alpha * 12;
      ss += a * a;
    }
    return Math.sqrt(ss / 10);
  };
  assertNear(rms('beta', 'capm'), 1.426, 0.01, 'beta CAPM (deck 1.43)');
  assertNear(rms('beta', 'ff3c'), 0.769, 0.01, 'beta FF3C (deck 0.77)');
  assertNear(rms('size', 'capm'), 0.666, 0.01, 'size CAPM (deck 0.67)');
  assertNear(rms('bm', 'capm'), 1.941, 0.01, 'BM CAPM (deck 1.94)');
  assertNear(rms('mom', 'capm'), 4.160, 0.01, 'MOM CAPM (deck 4.16)');
  assertNear(rms('mom', 'ff3c'), 1.730, 0.01, 'MOM FF3C (deck 1.73)');
});
