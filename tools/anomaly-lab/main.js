// @ts-check
/**
 * Anomaly Lab: The CAPM on Trial (FIN 30600, Lecture 5 §1–2).
 *
 * Portfolio sorts put the CAPM on trial: pick a sort (beta / size / B/M /
 * momentum), a factor model (CAPM / FF3 / Carhart), and a sample window; the
 * tool reruns the ten time-series regressions live and shows (i) the
 * empirical SML against the model's prediction (the "too flat" picture,
 * deck §1), (ii) the alphas the model leaves behind, (iii) the factor
 * loadings, and (iv) a scoreboard of RMS pricing errors across all sorts and
 * models (deck s23). Below the chart: the deck-s30 return decomposition for
 * D1 and D10, and the deck-s42 information-ratio card.
 *
 * All statistics live in ./model.js (pure, node-verifiable); the baked Ken
 * French data is ./data.js (percent/month). Everything shown here is an
 * ANNUAL-PERCENT NUMBER (×12) formatted with toFixed — lib pct() expects
 * decimals and is not used.
 */

import { Chart, fixed, niceTicks, setStrokeWidth } from '../../lib/chart.js';
import { slider, renderTeX, renderLabel, hydrateLabels } from '../../lib/ui.js';
import { bindState } from '../../lib/state.js';
import {
  SORT_KEYS, MODEL_KEYS, VIEW_KEYS, SORT_LABELS, MODEL_LABELS, MODEL_FACTORS,
  FACTOR_LABELS, windowIndices, ymOfIndex, mktPremium, factorPremia,
  decileStats, rms, scoreboard, crossFit, decompose, sharpeCombine,
} from './model.js';

// release gate: if this tool is unreleased (see /releases.js), swap in a
// lock screen and suspend here — nothing below runs. `#preview` bypasses.
import { gateTool } from '../../lib/release.js';
await gateTool('anomaly-lab');

hydrateLabels();

const SVGNS = 'http://www.w3.org/2000/svg';
const BLUE = '\\textcolor{#0072B2}';

/** House factor colors (Loadings view + decomposition bars). */
const FCOL = {
  mktrf: 'var(--blue)',   // #0072B2
  smb: 'var(--gold)',     // #C99700
  hml: 'var(--navy)',     // #0A234B
  wml: '#7A8699',         // grey-navy
};

/* ----------------------------------------------------------------- state -- */
const DEFAULTS = {
  s: 'beta',   // sort: beta | size | bm | mom
  m: 'capm',   // model: capm | ff3 | ff3c
  v: 'sml',    // view: sml | alphas | loadings | scoreboard
  y0: 1963,    // window start year (calendar, inclusive)
  y1: 2023,    // window end year (calendar, inclusive)
  // information-ratio card (annual %)
  irm: 8,      // E[R_M − R_f]
  irs: 16,     // σ_M
  ira: 3,      // fund α
  ire: 15,     // σ_ε
};

// Numeric ranges mirror the controls; hash values clamp to these (state.js).
const BOUNDS = {
  y0: [1963, 2015], y1: [1975, 2026],
  irm: [0, 20], irs: [1, 60], ira: [-10, 10], ire: [1, 60],
};

const store = bindState(DEFAULTS, () => {}, { bounds: BOUNDS });
const S = store.state;
// String keys from the hash are untrusted — snap anything outside the allowed
// sets back to the default (capm-sml's N_OPTIONS pattern).
if (!SORT_KEYS.includes(/** @type {string} */ (S.s))) store.set('s', DEFAULTS.s);
if (!MODEL_KEYS.includes(/** @type {string} */ (S.m))) store.set('m', DEFAULTS.m);
if (!VIEW_KEYS.includes(/** @type {string} */ (S.v))) store.set('v', DEFAULTS.v);

/** Effective window: calendar years, end clamped so y1 ≥ y0 + 5. */
function currentWindow() {
  const y0 = Number(S.y0);
  const y1 = Math.max(Number(S.y1), y0 + 5);
  return { y0, y1, ...windowIndices(y0, y1) };
}

/* --------------------------------------------------------------- helpers -- */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Signed fixed string for TeX ("+2.40" / "-0.72"). */
const sgn = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

function readoutCell(k, v, cls = '') {
  const cell = document.createElement('div');
  cell.className = 'readout';
  const key = document.createElement('div');
  key.className = 'k';
  renderLabel(key, k);
  const val = document.createElement('div');
  val.className = `v ${cls}`.trim();
  val.textContent = v;
  cell.append(key, val);
  return cell;
}

/** Blue open square marker at a data point (the lecture figures' style). */
function square(chart, x, y, r = 4.5) {
  const px = chart.sx(x);
  const py = chart.sy(y);
  const node = document.createElementNS(SVGNS, 'rect');
  node.setAttribute('x', String(px - r));
  node.setAttribute('y', String(py - r));
  node.setAttribute('width', String(2 * r));
  node.setAttribute('height', String(2 * r));
  node.setAttribute('fill', '#fff');
  node.setAttribute('stroke', 'var(--blue)');
  node.setAttribute('class', 'marker');
  setStrokeWidth(node, 2);
  chart.dataGroup.appendChild(node);
  return node;
}

/* ---------------------------------------------------------- scatter chart -- */
const scatter = new Chart($('main-chart'), {
  width: 760,
  height: 440,
  xLabel: 'Beta (β)',
  yLabel: 'Average Excess Return',
  xFmt: fixed(1),
  yFmt: (v) => `${v.toFixed(0)}%`,
});

/**
 * SML view (mirrors the lecture figures): deciles at (β_i, avg_i), grey
 * dashed cross-sectional OLS fit, gold through-origin model line with slope
 * = the window's market premium.
 */
function drawSML(stats, mkt) {
  const xs = stats.map((d) => d.beta);
  const ys = stats.map((d) => d.avg);
  const xLo = Math.min(0, ...xs) - 0.05;
  const xHi = Math.max(1.8, ...xs) + 0.2;
  const fit = crossFit(stats);
  const lineYs = [
    fit.intercept + fit.slope * xLo, fit.intercept + fit.slope * xHi,
    mkt * xLo, mkt * xHi,
  ];
  let yLo = Math.min(0, ...ys, ...lineYs);
  let yHi = Math.max(...ys, ...lineYs);
  const pad = Math.max(0.5, (yHi - yLo) * 0.08);
  yLo -= pad; yHi += pad;

  scatter.yLabel = 'Average Excess Return';
  scatter.setDomain(xLo, xHi, yLo, yHi).renderAxes({ xTickCount: 7 });
  scatter.clearData();

  // model line (GOLD, through the origin, slope = window mean mktrf ×12)
  scatter.path([{ x: xLo, y: mkt * xLo }, { x: xHi, y: mkt * xHi }],
    { stroke: 'var(--gold)', width: 2.4 });
  // cross-sectional OLS fit of the 10 points (grey DASHED — "too flat")
  scatter.path([
    { x: xLo, y: fit.intercept + fit.slope * xLo },
    { x: xHi, y: fit.intercept + fit.slope * xHi },
  ], { stroke: 'var(--axis)', width: 2, dash: '7 5' });

  drawDeciles(stats, (d) => d.avg);

  $('legend-reg').textContent =
    `Reg: Slope = ${fit.slope.toFixed(2)}%, Int. = ${fit.intercept.toFixed(2)}%`;
  $('legend-model').textContent = `Model: Slope = ${mkt.toFixed(2)}%, Int. = 0%`;
}

/** Alphas view: deciles at (β_i, α_i) around a red dashed zero line. */
function drawAlphas(stats) {
  const xs = stats.map((d) => d.beta);
  const ys = stats.map((d) => d.alpha);
  const xLo = Math.min(0, ...xs) - 0.05;
  const xHi = Math.max(1.8, ...xs) + 0.2;
  let yLo = Math.min(0, ...ys);
  let yHi = Math.max(0, ...ys);
  const pad = Math.max(0.5, (yHi - yLo) * 0.12);
  yLo -= pad; yHi += pad;

  scatter.yLabel = 'Alpha';
  scatter.setDomain(xLo, xHi, yLo, yHi).renderAxes({ xTickCount: 7 });
  scatter.clearData();
  scatter.hline(0, { stroke: 'var(--red)', dash: '7 5', width: 1.6, klass: 'refline' });
  drawDeciles(stats, (d) => d.alpha);
}

/** Blue path through the deciles in order + open squares + D1..D10 labels. */
function drawDeciles(stats, yOf) {
  scatter.path(stats.map((d) => ({ x: d.beta, y: yOf(d) })),
    { stroke: 'var(--blue)', width: 1.6, opacity: 0.8 });
  stats.forEach((d, i) => {
    square(scatter, d.beta, yOf(d));
    scatter.text(d.beta, yOf(d), `D${i + 1}`, { dx: 7, dy: -7, fill: 'var(--blue)' });
  });
}

/* --------------------------------------------------------- loadings chart -- */
/** Grouped bar chart of the current model's loadings, hand-rolled SVG. */
function drawLoadings(stats, modelKey) {
  const host = $('loadings-chart');
  host.replaceChildren();
  const W = 760;
  const H = 400;
  const m = { top: 16, right: 16, bottom: 46, left: 56 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const facs = MODEL_FACTORS[modelKey];
  const vals = stats.flatMap((d) => d.betas).filter(Number.isFinite);
  let yLo = Math.min(0, ...vals);
  let yHi = Math.max(0, ...vals);
  const pad = Math.max(0.1, (yHi - yLo) * 0.08);
  if (yLo < 0) yLo -= pad;
  yHi += pad;
  const sy = (v) => m.top + ((yHi - v) / (yHi - yLo)) * plotH;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('class', 'finchart');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Factor loadings by decile');
  svg.style.aspectRatio = `${W} / ${H}`;

  const add = (name, attrs, text) => {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs) node.setAttribute(k, String(attrs[k]));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  // grid + y ticks
  for (const t of niceTicks(yLo, yHi, 6)) {
    add('line', { x1: m.left, y1: sy(t), x2: W - m.right, y2: sy(t), class: 'grid' });
    add('text', { x: m.left - 8, y: sy(t) + 4, class: 'tick tick-y' }, (+t.toFixed(2)).toString());
  }
  // spines
  add('line', { x1: m.left, y1: m.top, x2: m.left, y2: m.top + plotH, class: 'spine' });
  add('line', { x1: m.left, y1: m.top + plotH, x2: W - m.right, y2: m.top + plotH, class: 'spine' });

  // bars: 10 groups × k factors
  const groupW = plotW / 10;
  const band = groupW * 0.76;
  const barW = band / facs.length;
  stats.forEach((d, i) => {
    const gx = m.left + i * groupW + (groupW - band) / 2;
    facs.forEach((f, j) => {
      const v = d.betas[j];
      if (!Number.isFinite(v)) return;
      const y0 = sy(Math.max(0, v));
      const h = Math.abs(sy(v) - sy(0));
      add('rect', {
        x: gx + j * barW, y: y0, width: Math.max(1, barW - 1.5), height: Math.max(0.5, h),
        fill: FCOL[f],
      });
    });
    add('text', {
      x: m.left + i * groupW + groupW / 2, y: m.top + plotH + 18, class: 'tick tick-x',
    }, `D${i + 1}`);
  });

  // zero line on top of the bars (loadings can be negative)
  const zero = add('line', {
    x1: m.left, y1: sy(0), x2: W - m.right, y2: sy(0),
    stroke: 'var(--axis)', class: 'refline',
  });
  setStrokeWidth(zero, 1.2);

  // axis titles
  add('text', { x: m.left + plotW / 2, y: H - 10, class: 'axis-title' }, 'Decile');
  const yt = add('text', {
    x: 16, y: m.top + plotH / 2, class: 'axis-title',
    transform: `rotate(-90 16 ${m.top + plotH / 2})`,
  }, 'Factor loading');
  yt.setAttribute('text-anchor', 'middle');

  host.appendChild(svg);

  // only the current model's factors appear in the legend
  $('ll-smb').hidden = !facs.includes('smb');
  $('ll-hml').hidden = !facs.includes('hml');
  $('ll-wml').hidden = !facs.includes('wml');
}

/* -------------------------------------------------------------- scoreboard -- */
const SCORE_COLS = /** @type {const} */ ([
  ['avg', 'RMS $E[R_i - R_f]$'],
  ['capm', 'RMS $\\alpha$ — CAPM'],
  ['ff3', 'RMS $\\alpha$ — FF3'],
  ['ff3c', 'RMS $\\alpha$ — Carhart'],
]);

function drawScoreboard(i0, i1) {
  const grid = scoreboard(i0, i1);
  const host = $('score-table');
  host.replaceChildren();
  const table = document.createElement('table');
  table.className = 'score-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'rowhead';
  corner.textContent = 'Sort';
  hr.appendChild(corner);
  for (const [key, label] of SCORE_COLS) {
    const th = document.createElement('th');
    renderLabel(th, label);
    if (key === S.m) th.classList.add('cur-model');
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const sk of SORT_KEYS) {
    const tr = document.createElement('tr');
    if (sk === S.s) tr.classList.add('cur-sort');
    const th = document.createElement('th');
    th.className = 'rowhead';
    th.textContent = SORT_LABELS[sk];
    tr.appendChild(th);
    for (const [key] of SCORE_COLS) {
      const td = document.createElement('td');
      const v = grid[sk][key];
      td.textContent = Number.isFinite(v) ? v.toFixed(2) : '—';
      if (key === S.m) td.classList.add('cur-model');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
}

/* ---------------------------------------------- return decomposition (s30) -- */
/**
 * One decile's decomposition bar: a cumulative walk of the factor
 * contributions β_j λ_j from zero, a hatched segment for the α remainder,
 * and a navy marker at the actual average excess return.
 * @param {HTMLElement} host @param {ReturnType<typeof decompose>} dec
 * @param {string[]} facs factor keys @param {[number, number]} domain
 * @param {string} uid unique pattern-id suffix
 */
function drawDecompBar(host, dec, facs, domain, uid) {
  host.replaceChildren();
  const W = 560;
  const H = 108;
  const m = { left: 12, right: 12 };
  const barY = 16;
  const barH = 38;
  const axisY = 82;
  const [lo, hi] = domain;
  const sx = (v) => m.left + ((v - lo) / (hi - lo)) * (W - m.left - m.right);

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('class', 'finchart');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.style.aspectRatio = `${W} / ${H}`;

  const add = (name, attrs, text) => {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs) node.setAttribute(k, String(attrs[k]));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  // hatch pattern for the alpha remainder (ids must be unique per <svg>)
  const defs = document.createElementNS(SVGNS, 'defs');
  const pat = document.createElementNS(SVGNS, 'pattern');
  const pid = `alab-hatch-${uid}`;
  pat.setAttribute('id', pid);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', '6');
  pat.setAttribute('height', '6');
  const pline = document.createElementNS(SVGNS, 'path');
  pline.setAttribute('d', 'M0,6 L6,0');
  pline.setAttribute('stroke', '#7A8699');
  pline.setAttribute('stroke-width', '1.2');
  pat.appendChild(pline);
  defs.appendChild(pat);
  svg.appendChild(defs);

  // axis with ticks
  add('line', { x1: m.left, y1: axisY, x2: W - m.right, y2: axisY, class: 'spine' });
  for (const t of niceTicks(lo, hi, 7)) {
    add('line', { x1: sx(t), y1: axisY, x2: sx(t), y2: axisY - 4, class: 'spine' });
    add('text', { x: sx(t), y: axisY + 16, class: 'tick tick-x' }, `${+t.toFixed(1)}%`);
  }
  // zero guide through the bar
  add('line', { x1: sx(0), y1: barY - 5, x2: sx(0), y2: axisY, class: 'grid' });

  // cumulative walk of the factor contributions
  let cum = 0;
  dec.contribs.forEach((c, j) => {
    const a = sx(Math.min(cum, cum + c));
    const w = Math.abs(sx(cum + c) - sx(cum));
    const r = add('rect', {
      x: a, y: barY, width: Math.max(0.5, w), height: barH, fill: FCOL[facs[j]],
    });
    if (c < 0) r.setAttribute('opacity', '0.65'); // walking back leftward
    cum += c;
  });
  // alpha remainder: hatched from the explained total to the actual mean
  const aFrom = sx(Math.min(cum, dec.actual));
  const aW = Math.abs(sx(dec.actual) - sx(cum));
  const hatch = add('rect', {
    x: aFrom, y: barY, width: Math.max(0.5, aW), height: barH, fill: `url(#${pid})`,
  });
  hatch.setAttribute('stroke', '#7A8699');
  setStrokeWidth(hatch, 1);

  // navy marker at the actual average excess return
  const mk = add('line', {
    x1: sx(dec.actual), y1: barY - 8, x2: sx(dec.actual), y2: barY + barH + 8,
    stroke: 'var(--navy)', class: 'refline',
  });
  setStrokeWidth(mk, 2.2);
  const lbl = add('text', {
    x: sx(dec.actual), y: barY - 12, class: 'datalabel', fill: 'var(--navy)',
  }, `${dec.actual.toFixed(2)}%`);
  lbl.setAttribute('text-anchor', 'middle');

  host.appendChild(svg);
}

/** The numbers written out like the slide, e.g. "0.60 × 6.86 = 4.1%; …". */
function decompTeX(host, modelKey, dLabel, stat, lambdas, dec) {
  const terms = stat.betas.map((b, j) => {
    const bs = b < 0 ? `(${b.toFixed(2)})` : b.toFixed(2);
    return `${bs} \\times ${lambdas[j].toFixed(2)}`;
  }).join(' + ');
  renderTeX(host,
    `\\text{${MODEL_LABELS[modelKey]} ${dLabel}: } ${terms} = ${dec.explained.toFixed(2)}\\%` +
    `;\\;\\; \\text{actual } ${dec.actual.toFixed(2)}\\%` +
    ` \\;\\Rightarrow\\; \\alpha = ${BLUE}{${sgn(dec.alpha)}\\%}`);
}

function drawDecomposition(stats, modelKey, lambdas) {
  const facs = MODEL_FACTORS[modelKey];
  const d1 = decompose(stats[0], lambdas);
  const d10 = decompose(stats[9], lambdas);
  // shared scale across both bars: every cumulative step + actuals + zero
  const pts = [0];
  for (const dec of [d1, d10]) {
    let cum = 0;
    for (const c of dec.contribs) { cum += c; pts.push(cum); }
    pts.push(dec.actual);
  }
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = Math.max(0.6, (hi - lo) * 0.07);
  /** @type {[number, number]} */
  const domain = [lo - pad, hi + pad];

  const sortName = SORT_LABELS[/** @type {string} */ (S.s)];
  $('decomp-d1-title').textContent = `D1 — lowest ${sortName} decile`;
  $('decomp-d10-title').textContent = `D10 — highest ${sortName} decile`;
  drawDecompBar($('decomp-d1-chart'), d1, facs, domain, 'd1');
  drawDecompBar($('decomp-d10-chart'), d10, facs, domain, 'd10');
  decompTeX($('decomp-d1-tex'), modelKey, 'D1', stats[0], lambdas, d1);
  decompTeX($('decomp-d10-tex'), modelKey, 'D10', stats[9], lambdas, d10);

  // only the current model's factors appear in the legend
  $('dl-smb').hidden = !facs.includes('smb');
  $('dl-hml').hidden = !facs.includes('hml');
  $('dl-wml').hidden = !facs.includes('wml');
}

/* -------------------------------------------------------- formula strip ---- */
const MODEL_TEX = {
  capm: 'R_{i,t} - R_{f,t} = \\alpha_i + \\beta_i\\,(R_{M,t} - R_{f,t}) + e_{i,t}',
  ff3: 'R_{i,t} - R_{f,t} = \\alpha_i + \\beta_i\\,(R_{M,t} - R_{f,t})'
    + ' + s_i\\,\\text{SMB}_t + h_i\\,\\text{HML}_t + e_{i,t}',
  ff3c: 'R_{i,t} - R_{f,t} = \\alpha_i + \\beta_i\\,(R_{M,t} - R_{f,t})'
    + ' + s_i\\,\\text{SMB}_t + h_i\\,\\text{HML}_t + m_i\\,\\text{WML}_t + e_{i,t}',
};

function drawFormulas(modelKey, lambdas) {
  renderTeX($('f-model'),
    `\\text{${SORT_LABELS[/** @type {string} */ (S.s)]} deciles, `
    + `${MODEL_LABELS[modelKey]}:}\\quad ${MODEL_TEX[modelKey]}`);
  const facs = MODEL_FACTORS[modelKey];
  const premia = facs.map((f, j) => {
    const name = f === 'mktrf' ? 'M' : `\\text{${FACTOR_LABELS[f]}}`;
    return `\\lambda_{${name}} = ${lambdas[j].toFixed(2)}\\%`;
  }).join(',\\;\\; ');
  renderTeX($('f-premia'), `\\text{Window factor premia (annualized):}\\quad ${premia}`);
}

/* -------------------------------------------------------------- readouts -- */
function drawReadouts(w, mkt, stats, rmsA) {
  const host = $('readouts');
  host.replaceChildren();
  const spread = stats[9].avg - stats[0].avg;
  host.append(
    readoutCell('Window', `${ymOfIndex(w.i0)} – ${ymOfIndex(w.i1 - 1)} · n=${w.i1 - w.i0}`),
    readoutCell('Mkt premium (ann.)', `${mkt.toFixed(2)}%`, 'gold'),
    readoutCell('$D_{10}\\!-\\!D_1$ avg spread', `${sgn(spread)}%`, 'blue'),
    readoutCell(
      `RMS $\\alpha$ (${SORT_LABELS[/** @type {string} */ (S.s)]} × ${MODEL_LABELS[/** @type {string} */ (S.m)]})`,
      `${rmsA.toFixed(2)}%`,
    ),
  );
}

/* ---------------------------------------------------------- render cycle -- */
function renderAll() {
  const w = currentWindow();
  const modelKey = /** @type {string} */ (S.m);
  const sortKey = /** @type {string} */ (S.s);
  const view = /** @type {string} */ (S.v);
  const stats = decileStats(sortKey, modelKey, w.i0, w.i1);
  const lambdas = factorPremia(modelKey, w.i0, w.i1);
  const mkt = mktPremium(w.i0, w.i1);
  const rmsA = rms(stats.map((d) => d.alpha));

  drawReadouts(w, mkt, stats, rmsA);
  drawFormulas(modelKey, lambdas);

  // view switching
  $('scatter-box').hidden = !(view === 'sml' || view === 'alphas');
  $('loadings-box').hidden = view !== 'loadings';
  $('score-box').hidden = view !== 'scoreboard';
  if (view === 'sml' || view === 'alphas') {
    const isSml = view === 'sml';
    $('scatter-title').textContent = isSml
      ? `Average excess return vs. market beta — ${SORT_LABELS[sortKey]} deciles, ${MODEL_LABELS[modelKey]} beta`
      : `${MODEL_LABELS[modelKey]} alpha vs. market beta — ${SORT_LABELS[sortKey]} deciles`;
    $('legend-reg-wrap').hidden = !isSml;
    $('legend-model-wrap').hidden = !isSml;
    $('legend-zero-wrap').hidden = isSml;
    if (isSml) drawSML(stats, mkt);
    else drawAlphas(stats);
  } else if (view === 'loadings') {
    drawLoadings(stats, modelKey);
  } else {
    drawScoreboard(w.i0, w.i1);
  }

  drawDecomposition(stats, modelKey, lambdas);
  syncButtons();
}

function syncButtons() {
  for (const b of document.querySelectorAll('[data-sort]')) {
    b.classList.toggle('active', b.getAttribute('data-sort') === S.s);
  }
  for (const b of document.querySelectorAll('[data-model]')) {
    b.classList.toggle('active', b.getAttribute('data-model') === S.m);
  }
  for (const b of document.querySelectorAll('[data-view]')) {
    b.classList.toggle('active', b.getAttribute('data-view') === S.v);
  }
}

/* --------------------------------------------------------------- controls -- */
for (const b of document.querySelectorAll('[data-sort]')) {
  b.addEventListener('click', () => { store.set('s', b.getAttribute('data-sort') || DEFAULTS.s); renderAll(); });
}
for (const b of document.querySelectorAll('[data-model]')) {
  b.addEventListener('click', () => { store.set('m', b.getAttribute('data-model') || DEFAULTS.m); renderAll(); });
}
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => { store.set('v', b.getAttribute('data-view') || DEFAULTS.v); renderAll(); });
}

const y0Ctrl = slider({
  label: 'Start year', min: 1963, max: 2015, step: 1, value: Number(S.y0),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('y0', v); renderAll(); },
});
const y1Ctrl = slider({
  label: 'End year', min: 1975, max: 2026, step: 1, value: Number(S.y1),
  fmt: (v) => String(Math.round(v)),
  onChange: (v) => { store.set('y1', v); renderAll(); },
});
$('ctrl-y0').appendChild(y0Ctrl);
$('ctrl-y1').appendChild(y1Ctrl);

function setWindow(y0, y1) {
  store.patch({ y0, y1 });
  /** @type {any} */ (y0Ctrl).set(y0);
  /** @type {any} */ (y1Ctrl).set(y1);
  renderAll();
}
$('preset-deck').addEventListener('click', () => setWindow(1963, 2023));
$('preset-full').addEventListener('click', () => setWindow(1963, 2026));

/* ------------------------------------------------ information-ratio card -- */
function renderIR() {
  const { srm, ir, srp } = sharpeCombine(Number(S.irm), Number(S.irs), Number(S.ira), Number(S.ire));
  const host = $('ir-readouts');
  host.replaceChildren();
  host.append(
    readoutCell('$SR_M = E[R_M - R_f]\\,/\\,\\sigma_M$', srm.toFixed(2), 'gold'),
    readoutCell('$IR = \\alpha\\,/\\,\\sigma_\\varepsilon$', ir.toFixed(2)),
    readoutCell('$SR_P$ (market + fund)', srp.toFixed(2), 'blue'),
  );
  renderTeX($('ir-tex'),
    `SR_P^2 = SR_M^2 + IR^2 = (${srm.toFixed(2)})^2 + (${ir.toFixed(2)})^2`
    + ` = ${(srm * srm + ir * ir).toFixed(3)}`
    + ` \\;\\Rightarrow\\; SR_P = ${BLUE}{\\mathbf{${srp.toFixed(2)}}}`);
}

const irmCtrl = slider({
  label: 'Market premium $E[R_M - R_f]$', min: 0, max: 20, step: 0.5, value: Number(S.irm),
  fmt: (v) => `${+v.toFixed(1)}%`,
  onChange: (v) => { store.set('irm', v); renderIR(); },
});
const irsCtrl = slider({
  label: 'Market volatility $\\sigma_M$', min: 1, max: 60, step: 1, value: Number(S.irs),
  fmt: (v) => `${Math.round(v)}%`,
  onChange: (v) => { store.set('irs', v); renderIR(); },
});
const iraCtrl = slider({
  label: 'Fund alpha $\\alpha$', min: -10, max: 10, step: 0.5, value: Number(S.ira),
  fmt: (v) => `${+v.toFixed(1)}%`,
  onChange: (v) => { store.set('ira', v); renderIR(); },
});
const ireCtrl = slider({
  label: 'Residual risk $\\sigma_\\varepsilon$', min: 1, max: 60, step: 1, value: Number(S.ire),
  fmt: (v) => `${Math.round(v)}%`,
  onChange: (v) => { store.set('ire', v); renderIR(); },
});
$('ctrl-irm').appendChild(irmCtrl);
$('ctrl-irs').appendChild(irsCtrl);
$('ctrl-ira').appendChild(iraCtrl);
$('ctrl-ire').appendChild(ireCtrl);

renderAll();
renderIR();
