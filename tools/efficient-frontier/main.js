// @ts-check
/**
 * main.js — Efficient Frontier + Tangency explorer (FIN 30600, Topic 3 §5).
 *
 * Editable N=5 asset table + pairwise correlation editor drive an analytic
 * minimum-variance frontier (short sales allowed), the global MVP, and the
 * max-Sharpe tangency portfolio with its CAL. A seeded cloud of ~2,000
 * long-only random portfolios fills the feasible region. All finance math is
 * in ../../lib/finmath.js; rendering is in ./view.js.
 *
 * Default asset set = five broad asset classes with plausible long-run
 * moments and Sharpe ratios (see DEFAULT_ASSETS below).
 *
 * Performance contract (DESIGN): the random cloud is recomputed only when
 * assets / correlations / seed change, never on an r_f drag.
 *
 * @module efficient-frontier/main
 */

import {
  covMatrix, isPositiveDefinite, globalMVP, tangencyPortfolio,
  portfolioMean, portfolioStd, sharpe, traceFrontier, frontierWeightsAtMean,
  mulberry32, dirichlet,
} from '../../lib/finmath.js';
import { Chart, pct } from '../../lib/chart.js';
import { slider, numberInput, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';
import {
  renderBase, renderOverlay, renderReadouts, renderFormula,
  renderWeights, makeHoverTip,
} from './view.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('efficient-frontier');

/* --------------------------------------------------------- defaults ------- */

const N = 5;
/**
 * @type {{name:string,er:number,sd:number}[]} Broad asset classes with
 * REASONABLE long-run Sharpe ratios (all < 1 at r_f = 3%: stocks ≈ 0.3–0.4,
 * bonds ≈ 0.3). Correlations verified positive definite (min eigenvalue 0.18);
 * tangency Sharpe ≈ 0.47 (numpy cross-check 2026-07-10).
 */
const DEFAULT_ASSETS = [
  { name: 'U.S. Stocks', er: 0.090, sd: 0.160 },
  { name: 'Intl Stocks', er: 0.085, sd: 0.170 },
  { name: 'EM Stocks', er: 0.100, sd: 0.220 },
  { name: 'U.S. Bonds', er: 0.045, sd: 0.050 },
  { name: 'Real Estate', er: 0.080, sd: 0.180 },
];
const DEFAULT_CORR = [
  [1.00, 0.80, 0.70, 0.10, 0.70],
  [0.80, 1.00, 0.75, 0.10, 0.60],
  [0.70, 0.75, 1.00, 0.05, 0.55],
  [0.10, 0.10, 0.05, 1.00, 0.20],
  [0.70, 0.60, 0.55, 0.20, 1.00],
];
const DEFAULT_RF = 0.03;
const DEFAULT_SEED = 12345;
const CLOUD_N = 2000;

/** Upper-triangle index pairs (i<j) in a fixed order for state keys. */
const PAIRS = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) PAIRS.push([i, j]);

/** Build the flat state-defaults object (defines each key's type for state.js). */
function buildDefaults() {
  /** @type {Record<string, number|string>} */
  const d = { rf: DEFAULT_RF, seed: DEFAULT_SEED };
  DEFAULT_ASSETS.forEach((a, i) => {
    d['n' + i] = a.name; d['m' + i] = a.er; d['s' + i] = a.sd;
  });
  PAIRS.forEach(([i, j]) => { d['c' + i + j] = DEFAULT_CORR[i][j]; });
  return d;
}

/** Numeric ranges per state key — hash values and edits clamp to these
 * (state.js), so a crafted URL can't inject σ ≤ 0, |ρ| > 1, etc. */
function buildBounds() {
  /** @type {Record<string, [number, number]>} */
  const b = { rf: [0, 0.08], seed: [0, 4294967295] };
  DEFAULT_ASSETS.forEach((_, i) => { b['m' + i] = [-0.5, 1]; b['s' + i] = [0.0001, 2]; });
  PAIRS.forEach(([i, j]) => { b['c' + i + j] = [-0.99, 0.99]; });
  return b;
}

/* ------------------------------------------------------- model + math ----- */

/** Assemble names / mu / sigma / corr from the flat state object. */
function readModel(st) {
  const names = []; const mu = []; const sig = [];
  for (let i = 0; i < N; i++) {
    names.push(String(st['n' + i]));
    mu.push(Number(st['m' + i]));
    sig.push(Number(st['s' + i]));
  }
  const corr = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (i === j ? 1 : 0)));
  PAIRS.forEach(([i, j]) => { const v = Number(st['c' + i + j]); corr[i][j] = v; corr[j][i] = v; });
  return { names, mu, sig, corr };
}

/** Random long-only cloud (seeded). Depends on assets+seed, not on rf. */
function buildCloud(mu, Sigma, seed) {
  const rng = mulberry32(seed >>> 0);
  const alphas = new Array(N).fill(1); // uniform over the simplex
  const pts = [];
  for (let k = 0; k < CLOUD_N; k++) {
    const w = dirichlet(alphas, rng);
    pts.push({ std: portfolioStd(w, Sigma), mean: portfolioMean(w, mu) });
  }
  return pts;
}

/**
 * Full recompute from a raw model (assets + correlations) at a given rf/seed.
 * Returns null if the covariance matrix is not positive definite.
 */
function computeAll(raw, rf, seed) {
  const Sigma = covMatrix(raw.sig, raw.corr);
  if (!isPositiveDefinite(Sigma)) return null;

  const wMVP = globalMVP(Sigma);
  const mvp = { mean: portfolioMean(wMVP, raw.mu), std: portfolioStd(wMVP, Sigma), w: wMVP };

  // Frontier trace with weights at each point (for the hover tooltip).
  const maxMean = Math.max(...raw.mu);
  const loMean = mvp.mean - (maxMean - mvp.mean) * 0.55;
  const hiMean = maxMean + (maxMean - mvp.mean) * 0.12;
  const base = traceFrontier(raw.mu, Sigma, { n: 140, loMean, hiMean });
  const frontier = base.map((p) => ({
    mean: p.mean, std: p.std, weights: frontierWeightsAtMean(p.mean, raw.mu, Sigma),
  }));

  const cloud = buildCloud(raw.mu, Sigma, seed);

  const model = { ...raw, Sigma, mvp, frontier, cloud, rf };
  attachTangency(model, rf);
  return model;
}

/** (Re)compute the tangency portfolio + Sharpe on an existing model for rf.
 * When rf >= the global-MVP mean no tangency exists (tangencyPortfolio
 * returns null) — model.tangency is set to null and the UI explains. */
function attachTangency(model, rf) {
  model.rf = rf;
  const wT = tangencyPortfolio(model.mu, model.Sigma, rf);
  if (!wT) {
    model.tangency = null;
    return model;
  }
  const mean = portfolioMean(wT, model.mu);
  const std = portfolioStd(wT, model.Sigma);
  model.tangency = { w: wT, mean, std, sharpe: sharpe(mean, rf, std) };
  return model;
}

/* -------------------------------------------------------- app bootstrap --- */

function main() {
  const defaults = buildDefaults();
  const pointScale = () => 1; // point-radius scale factor (fixed)

  // Chart.
  const chartHost = /** @type {HTMLElement} */ (document.getElementById('chart'));
  const chart = new Chart(chartHost, {
    width: 680, height: 460,
    xLabel: 'Standard Deviation', yLabel: 'Expected Return',
    xFmt: pct, yFmt: pct,
  });

  const weightsHost = /** @type {HTMLElement} */ (document.getElementById('weights'));
  const warnBox = /** @type {HTMLElement} */ (document.getElementById('pd-warning'));
  const corrGrid = /** @type {HTMLElement} */ (document.getElementById('corr-grid'));
  const tiles = {
    tanEr: rq('ro-tan-er'), tanSd: rq('ro-tan-sd'), tanSharpe: rq('ro-tan-sh'),
    mvpEr: rq('ro-mvp-er'), mvpSd: rq('ro-mvp-sd'),
  };
  const fRowW = rq('formula-w');
  const fRowS = rq('formula-s');

  /** last positive-definite computed model actually on screen */
  let lastValid = null;
  /** overlay nodes (CAL + star) to remove on the next overlay redraw */
  let overlayNodes = [];

  const store = bindState(defaults, undefined, { bounds: buildBounds() });

  const hoverTip = makeHoverTip(chart, () => (lastValid ? lastValid.names : DEFAULT_ASSETS.map((a) => a.name)));
  chart.onHover(hoverTip, { radius: 18 });

  /* ---- render pipeline ---- */

  function setDomainFor(raw) {
    const maxSd = Math.max(...raw.sig, lastValid ? lastValid.mvp.std : 0);
    const maxEr = Math.max(...raw.mu);
    const xHi = niceCeil(maxSd * 1.18);
    const yHi = niceCeil(Math.max(maxEr * 1.1, Number(store.get('rf')) + 0.01));
    chart.setDomain(0, xHi, 0, yHi);
    chart.renderAxes({ xTickCount: 6, yTickCount: 6 });
  }

  // Full recompute: assets / correlations / seed changed. Rebuilds the cloud.
  function recomputeAll() {
    const raw = readModel(store.state);
    const model = computeAll(raw, Number(store.get('rf')), Number(store.get('seed')));
    if (!model) {
      flagNotPD(true);
      // First load with a bad hash: still draw the axes so the chart area
      // isn't a blank white rectangle next to the warning.
      if (!lastValid) setDomainFor(raw);
      return;
    }
    flagNotPD(false);
    lastValid = model;
    setDomainFor(raw);
    renderBase(chart, model, pointScale());
    // pass the previous overlay nodes so the old CAL/star are removed —
    // an empty array here leaves ghost stars behind on every asset edit
    overlayNodes = renderOverlay(chart, model, pointScale(), overlayNodes);
    flagNoTan(!model.tangency);
    renderWeights(weightsHost, model.names, model.tangency ? model.tangency.w : null, pointScale());
    renderReadouts(tiles, model);
    renderFormula(fRowW, fRowS, model);
  }

  // Light recompute: only rf changed. Cloud/frontier/MVP untouched.
  function recomputeRf() {
    if (!lastValid) return;
    attachTangency(lastValid, Number(store.get('rf')));
    // rf can shift yHi only marginally; keep the domain stable during a drag.
    overlayNodes = renderOverlay(chart, lastValid, pointScale(), overlayNodes);
    flagNoTan(!lastValid.tangency);
    renderWeights(weightsHost, lastValid.names, lastValid.tangency ? lastValid.tangency.w : null, pointScale());
    renderReadouts(tiles, lastValid);
    renderFormula(fRowW, fRowS, lastValid);
  }

  function flagNotPD(bad) {
    warnBox.hidden = !bad;
    corrGrid.classList.toggle('corr-invalid', bad);
  }

  // "No tangency" notice: rf at/above the global-MVP mean means the CAL has
  // no tangent point on the efficient branch — the naive formula would mark
  // a MINIMUM-Sharpe portfolio, so we hide the star/CAL and say why.
  const tanWarn = document.getElementById('tan-warning');
  function flagNoTan(bad) {
    if (tanWarn) tanWarn.hidden = !bad;
  }

  /* ---- controls ---- */

  // r_f slider — light re-render only.
  const rfSlider = slider({
    label: 'Risk-free rate $r_f$', min: 0, max: 0.08, step: 0.0025,
    value: Number(store.get('rf')), fmt: (v) => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`,
    onChange: (v) => { store.set('rf', v); recomputeRf(); },
  });
  rq('rf-slot').appendChild(rfSlider);

  // Seed control + reshuffle button — full re-render (new cloud).
  const seedInput = numberInput({
    label: 'Cloud seed', value: Number(store.get('seed')), min: 0, step: 1,
    onChange: (v) => { store.set('seed', Math.max(0, Math.round(v))); recomputeAll(); },
  });
  rq('seed-slot').appendChild(seedInput);
  rq('reshuffle-btn').addEventListener('click', () => {
    const s = (Number(store.get('seed')) + 1) >>> 0;
    store.set('seed', s);
    seedInput.set(s);
    recomputeAll();
  });

  buildAssetTable(store, recomputeAll);
  buildCorrEditor(store, corrGrid, recomputeAll);

  // Reset button.
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      location.hash = '';
      location.reload();
    });
  }

  hydrateLabels(); // typeset static data-label readout keys / group titles
  recomputeAll();
}

/* --------------------------------------------------------- control DOM ---- */

/** Editable N-row asset table (name / E[r] / σ). Edits -> full recompute. */
function buildAssetTable(store, onEdit) {
  const tbody = rq('asset-tbody');
  for (let i = 0; i < N; i++) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'cell-name';
    nameIn.value = String(store.get('n' + i));
    nameIn.addEventListener('input', () => { store.set('n' + i, nameIn.value); onEdit(); });
    nameTd.appendChild(nameIn);

    const erTd = document.createElement('td');
    const erIn = pctCell(Number(store.get('m' + i)));
    erIn.addEventListener('input', () => {
      store.set('m' + i, toDec(erIn.value)); onEdit();
    });
    erTd.appendChild(erIn); erTd.appendChild(pctSuffix());

    const sdTd = document.createElement('td');
    const sdIn = pctCell(Number(store.get('s' + i)));
    sdIn.addEventListener('input', () => {
      store.set('s' + i, Math.max(0.0001, toDec(sdIn.value))); onEdit();
    });
    sdTd.appendChild(sdIn); sdTd.appendChild(pctSuffix());

    tr.appendChild(nameTd); tr.appendChild(erTd); tr.appendChild(sdTd);
    tbody.appendChild(tr);
  }
}

/** N×N correlation grid; upper triangle editable, diagonal fixed 1, mirror. */
function buildCorrEditor(store, host, onEdit) {
  const names = [];
  for (let i = 0; i < N; i++) names.push(shortName(String(store.get('n' + i))));

  const table = document.createElement('table');
  table.className = 'corr-table';
  // header row
  const thead = document.createElement('tr');
  thead.appendChild(document.createElement('th'));
  for (let j = 0; j < N; j++) {
    const th = document.createElement('th');
    th.textContent = names[j];
    thead.appendChild(th);
  }
  table.appendChild(thead);

  /** live handles to lower-triangle mirror cells so we can update them. */
  const mirror = {};

  for (let i = 0; i < N; i++) {
    const tr = document.createElement('tr');
    const rowh = document.createElement('th');
    rowh.textContent = names[i];
    tr.appendChild(rowh);
    for (let j = 0; j < N; j++) {
      const td = document.createElement('td');
      if (i === j) {
        td.textContent = '1';
        td.className = 'corr-diag';
      } else if (i < j) {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '0.05'; inp.min = '-0.99'; inp.max = '0.99';
        inp.className = 'corr-cell';
        inp.value = String(Number(store.get('c' + i + j)));
        inp.addEventListener('input', () => {
          let v = Number(inp.value);
          if (!Number.isFinite(v)) return;
          v = Math.max(-0.99, Math.min(0.99, v));
          store.set('c' + i + j, v);
          if (mirror[j + '_' + i]) mirror[j + '_' + i].textContent = fmtCorr(v);
          onEdit();
        });
        td.appendChild(inp);
      } else {
        // lower triangle: read-only mirror
        td.className = 'corr-mirror';
        td.textContent = fmtCorr(Number(store.get('c' + j + i)));
        mirror[i + '_' + j] = td;
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  host.replaceChildren(table);
}

/* --------------------------------------------------------- small helpers -- */

function rq(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error('missing element #' + id);
  return e;
}

/** A percent-valued numeric input (shows whole/one-decimal percent). */
function pctCell(dec) {
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = '0.1'; inp.className = 'cell-num';
  inp.value = trimNum(dec * 100);
  return inp;
}
function pctSuffix() { const s = document.createElement('span'); s.className = 'pct-suffix'; s.textContent = '%'; return s; }
function toDec(v) { const n = Number(v); return Number.isFinite(n) ? n / 100 : 0; }
function trimNum(x) { return String(Math.round(x * 100) / 100); }
function fmtCorr(v) { return (Math.round(v * 100) / 100).toFixed(2); }
function shortName(s) { return s.length <= 8 ? s : s.slice(0, 7) + '…'; }

/** Round a value up to a "nice" axis bound (5% grid). */
function niceCeil(x) {
  const step = 0.05;
  return Math.ceil(x / step) * step;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
}
