// @ts-check
/**
 * anomaly-lab-data.test.js — sanity + anchor tests for the anomaly lab's
 * baked Ken French data module (tools/anomaly-lab/data.js, 202605 CRSP
 * vintage) run through lib/finmath.js olsMulti.
 *
 * Run with:  node --test tests/anomaly-lab-data.test.js
 *
 * Anchors: the Topic 5 deck tables are a ~202312 CRSP vintage; re-running
 * this data through 2023-12 reproduces them to vintage tolerance
 * (~0.1–0.3 pp on premia/alphas, ~0.01–0.03 on loadings). Expected values
 * below were computed independently with python3 + numpy from the same zips
 * (2026-07-12); deck-printed values in comments. If a future data refresh
 * shifts these slightly, widen tolerances only after re-verifying against a
 * fresh numpy run — do not chase the deck numbers themselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { olsMulti } from '../lib/finmath.js';
import { META, FACTORS, SORTS } from '../tools/anomaly-lab/data.js';

function assertNear(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg}: got ${actual}, want ${expected} ±${tol}`);
}

/** Index of a 'YYYY-MM' month in the aligned arrays. */
function monthIndex(ym) {
  const [y0, m0] = META.start.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  return (y - y0) * 12 + (m - m0);
}

const END_DECK = monthIndex('2023-12') + 1; // deck-vintage window length

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const excess = (dec, upTo) => dec.slice(0, upTo).map((r, t) => r - FACTORS.rf[t]);

test('data module is internally consistent', () => {
  assert.equal(META.start, '1963-07', 'sample starts with the BETA file');
  for (const key of ['mktrf', 'smb', 'hml', 'wml', 'rf']) {
    assert.equal(FACTORS[key].length, META.months, `FACTORS.${key} aligned`);
  }
  for (const sort of ['beta', 'size', 'bm', 'mom']) {
    assert.equal(SORTS[sort].length, 10, `${sort}: ten deciles`);
    for (const dec of SORTS[sort]) {
      assert.equal(dec.length, META.months, `${sort} decile aligned`);
    }
  }
  assert.equal(END_DECK, (2023 - 1963) * 12 + (12 - 7) + 1, 'index arithmetic');
  assert.ok(META.months >= END_DECK, 'sample reaches past 2023-12');
});

test('deck-window (1963-07..2023-12) anchors: market premium and beta sort', () => {
  // Deck: Mkt premium 6.75 (202312 vintage); this vintage: 6.86
  assertNear(mean(FACTORS.mktrf.slice(0, END_DECK)) * 12, 6.86, 0.01, 'Mkt premium');
  // Factor means (deck s29: SMB 2.06, HML 3.42, WML 7.30)
  assertNear(mean(FACTORS.smb.slice(0, END_DECK)) * 12, 2.071, 0.01, 'SMB mean');
  assertNear(mean(FACTORS.hml.slice(0, END_DECK)) * 12, 3.554, 0.01, 'HML mean');
  assertNear(mean(FACTORS.wml.slice(0, END_DECK)) * 12, 7.103, 0.01, 'WML mean');

  const mkt = [FACTORS.mktrf.slice(0, END_DECK)];
  // Beta-sort D1 (deck: avg 6.57, CAPM beta 0.60, alpha ~2.5)
  const d1 = olsMulti(mkt, excess(SORTS.beta[0], END_DECK));
  assertNear(mean(excess(SORTS.beta[0], END_DECK)) * 12, 6.546, 0.01, 'D1 avg');
  assertNear(d1.betas[0], 0.604, 0.005, 'D1 beta');
  assertNear(d1.alpha * 12, 2.403, 0.01, 'D1 alpha');
  // Beta-sort D10 (deck: avg 8.10, CAPM beta 1.60, alpha ~-2.7)
  const d10 = olsMulti(mkt, excess(SORTS.beta[9], END_DECK));
  assertNear(mean(excess(SORTS.beta[9], END_DECK)) * 12, 8.292, 0.01, 'D10 avg');
  assertNear(d10.betas[0], 1.599, 0.005, 'D10 beta');
  assertNear(d10.alpha * 12, -2.674, 0.01, 'D10 alpha');
});

test('deck-window FF3C loadings, beta-sort D10 (deck s28: 1.39, 0.75, -0.19, -0.19)', () => {
  const X = [FACTORS.mktrf, FACTORS.smb, FACTORS.hml, FACTORS.wml]
    .map((s) => s.slice(0, END_DECK));
  const f = olsMulti(X, excess(SORTS.beta[9], END_DECK));
  assertNear(f.betas[0], 1.390, 0.005, 'mkt loading');
  assertNear(f.betas[1], 0.754, 0.005, 'SMB loading');
  assertNear(f.betas[2], -0.197, 0.005, 'HML loading');
  assertNear(f.betas[3], -0.195, 0.005, 'WML loading');
  assertNear(f.alpha * 12, -0.723, 0.01, 'Carhart alpha');
  assertNear(f.r2, 0.8679, 5e-4, 'R2');
});

test('deck-window RMS alphas track the s23 table (vintage tolerance)', () => {
  // Deck s23 (alpha_CAPM / alpha_FF3C): Beta 1.50/0.83 · Size 0.87/0.64 ·
  // BM 1.81/0.98 · MOM 4.20/1.82. This vintage (numpy): see expected below.
  const MODELS = {
    capm: [FACTORS.mktrf],
    ff3c: [FACTORS.mktrf, FACTORS.smb, FACTORS.hml, FACTORS.wml],
  };
  const rms = (sort, model) => {
    const X = MODELS[model].map((s) => s.slice(0, END_DECK));
    let ss = 0;
    for (const dec of SORTS[sort]) {
      const a = olsMulti(X, excess(dec, END_DECK)).alpha * 12;
      ss += a * a;
    }
    return Math.sqrt(ss / 10);
  };
  assertNear(rms('beta', 'capm'), 1.40, 0.01, 'beta CAPM (deck 1.50)');
  assertNear(rms('beta', 'ff3c'), 0.69, 0.01, 'beta FF3C (deck 0.83)');
  assertNear(rms('size', 'capm'), 0.86, 0.01, 'size CAPM (deck 0.87)');
  assertNear(rms('bm', 'capm'), 1.83, 0.01, 'BM CAPM (deck 1.81)');
  assertNear(rms('mom', 'capm'), 4.12, 0.01, 'MOM CAPM (deck 4.20)');
  assertNear(rms('mom', 'ff3c'), 1.77, 0.01, 'MOM FF3C (deck 1.82)');
});
