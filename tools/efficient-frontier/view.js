// @ts-check
/**
 * view.js — rendering helpers for the Efficient Frontier + Tangency tool.
 *
 * Split out of main.js to keep each file under ~400 lines. Everything here is
 * DOM/SVG rendering against a pre-computed model; no finance math lives here
 * (that is all in ../../lib/finmath.js). Colors come from the house CSS
 * custom properties in ../../lib/style.css.
 *
 * @module efficient-frontier/view
 */

import { pct } from '../../lib/chart.js';
import { renderTeX } from '../../lib/ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';

/** @param {string} name @param {Record<string,string|number>} [attrs] */
function el(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/** Percent with one decimal, e.g. 0.1852 -> "18.5%". @param {number} v */
export function pct1(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/** Signed whole-percent, e.g. -0.05 -> "-5%", 0.2 -> "+20%". @param {number} v */
function pctSigned(v) {
  const p = Math.round(v * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
}

/**
 * Draw the rf-independent base layer: cloud, frontier (efficient solid +
 * inefficient dashed), global MVP, and the individual assets. Rebuilt only when
 * assets / correlations / seed change (NOT on an rf drag).
 * @param {import('../../lib/chart.js').Chart} chart
 * @param {object} m computed model
 * @param {number} pointScale presenter-mode radius multiplier
 */
export function renderBase(chart, m, pointScale) {
  chart.clearData();

  // (a) cloud of feasible long-only portfolios — small, subtle grey dots.
  for (const p of m.cloud) {
    chart.point(p.std, p.mean, {
      r: 1.5 * pointScale, fill: '#c3c9d2', klass: 'cloud-dot',
    });
  }

  // (b) minimum-variance frontier, split at the global MVP mean.
  const toXY = (p) => ({ x: p.std, y: p.mean });
  // Clip the traced frontier to the plot domain so the dashed inefficient
  // branch doesn't spill past the axes.
  const inDomain = (p) => p.mean >= chart.yLo && p.mean <= chart.yHi
    && p.std >= chart.xLo && p.std <= chart.xHi;
  const eff = m.frontier.filter((p) => p.mean >= m.mvp.mean - 1e-9 && inDomain(p));
  const ineff = m.frontier.filter((p) => p.mean <= m.mvp.mean + 1e-9 && inDomain(p));
  if (ineff.length > 1) {
    chart.path(ineff.map(toXY), { stroke: 'var(--blue)', width: 2, dash: '6 5', opacity: 0.85 });
  }
  if (eff.length > 1) {
    chart.path(eff.map(toXY), { stroke: 'var(--blue)', width: 2.6 });
  }

  // Invisible hover anchors along the whole frontier -> weights tooltip.
  for (const p of m.frontier.filter(inDomain)) {
    chart.point(p.std, p.mean, {
      r: 5, fill: 'rgba(0,0,0,0)',
      hoverData: { kind: 'frontier', mean: p.mean, std: p.std, weights: p.weights },
    });
  }

  // (c) global minimum-variance portfolio — gold diamond, labeled.
  chart.point(m.mvp.std, m.mvp.mean, {
    r: 6 * pointScale, fill: 'var(--gold)', stroke: '#fff', shape: 'diamond',
  });
  chart.text(m.mvp.std, m.mvp.mean, 'MVP', {
    dx: 9, dy: -7, fill: 'var(--gold)', klass: 'lbl-strong',
  });

  // (e) individual assets — navy dots + name labels.
  for (let i = 0; i < m.names.length; i++) {
    chart.point(m.sig[i], m.mu[i], { r: 4.2 * pointScale, fill: 'var(--navy)' });
    chart.text(m.sig[i], m.mu[i], m.names[i], { dx: 7, dy: 4, fill: 'var(--navy)' });
  }
}

/**
 * Draw / redraw the rf-dependent overlay: the capital allocation line from
 * (0, rf) through the tangency portfolio, the tangency star, and the rf
 * intercept marker. Tracked separately from the hover tooltip so an rf drag
 * never clobbers a showing tooltip.
 * @param {import('../../lib/chart.js').Chart} chart
 * @param {object} m computed model
 * @param {number} pointScale
 * @param {SVGElement[]} prevNodes overlay nodes from the last call (removed here)
 * @returns {SVGElement[]} the new overlay nodes (pass back next time)
 */
export function renderOverlay(chart, m, pointScale, prevNodes) {
  for (const n of prevNodes) n.remove();
  const nodes = [];
  const t = m.tangency;

  // CAL: from (0, rf) with slope = Sharpe, clipped to the plot box.
  const slope = t.sharpe; // (mean - rf) / std
  let xEnd = chart.xHi;
  if (slope > 0) {
    const xAtTop = (chart.yHi - m.rf) / slope;
    xEnd = Math.min(chart.xHi, xAtTop);
  }
  const yEnd = m.rf + slope * xEnd;
  const cal = el('line', {
    x1: chart.sx(0), y1: chart.sy(m.rf), x2: chart.sx(xEnd), y2: chart.sy(yEnd),
    stroke: 'var(--blue)', 'stroke-width': 1.5 * pointScale, 'stroke-linecap': 'round',
    class: 'cal-line',
  });
  chart.overlayGroup.appendChild(cal);
  nodes.push(cal);

  // rf intercept marker on the y-axis.
  const rfDot = el('circle', {
    cx: chart.sx(0), cy: chart.sy(m.rf), r: 3 * pointScale, fill: 'var(--navy)',
  });
  chart.overlayGroup.appendChild(rfDot);
  nodes.push(rfDot);
  const rfLbl = el('text', {
    x: chart.sx(0) + 6, y: chart.sy(m.rf) - 6, fill: 'var(--navy)', class: 'datalabel',
  });
  rfLbl.textContent = `r_f = ${(m.rf * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  chart.overlayGroup.appendChild(rfLbl);
  nodes.push(rfLbl);

  // Tangency portfolio — blue star, labeled T.
  const star = el('path', {
    d: starPath(chart.sx(t.std), chart.sy(t.mean), 8 * pointScale, 3.6 * pointScale, 5),
    fill: 'var(--blue)', stroke: 'var(--navy)', 'stroke-width': 1.2, class: 'tangency-star',
  });
  chart.overlayGroup.appendChild(star);
  nodes.push(star);
  const tLbl = el('text', {
    x: chart.sx(t.std) + 11, y: chart.sy(t.mean) - 8, fill: 'var(--blue)',
    class: 'datalabel lbl-strong',
  });
  tLbl.textContent = 'T';
  chart.overlayGroup.appendChild(tLbl);
  nodes.push(tLbl);

  return nodes;
}

/** SVG path string for an n-point star. */
function starPath(cx, cy, rO, rI, n) {
  let d = '';
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? rO : rI;
    const a = (Math.PI / n) * i - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)} `;
  }
  return `${d}Z`;
}

/**
 * Hover-tooltip manager for the frontier. Returns a function to call with the
 * hover payload (or null to hide). Keeps its own node so the CAL overlay is
 * untouched.
 * @param {import('../../lib/chart.js').Chart} chart
 * @param {() => string[]} getNames current asset names
 * @returns {(payload:any, info:any)=>void}
 */
export function makeHoverTip(chart, getNames) {
  let tip = null;
  return function (payload, info) {
    if (tip) { tip.remove(); tip = null; }
    if (!payload || payload.kind !== 'frontier' || !info) return;
    const names = getNames();
    const lines = [
      `E[r] = ${pct1(payload.mean)}    σ = ${pct1(payload.std)}`,
      ...payload.weights.map((w, i) => `${names[i]}:  ${pctSigned(w)}`),
    ];
    const g = el('g', { class: 'ef-tip' });
    const padX = 8;
    const lineH = 15;
    const w = 168;
    const h = lineH * lines.length + 10;
    let tx = info.px + 14;
    let ty = info.py - h - 8;
    if (tx + w > chart.width) tx = info.px - w - 14;
    if (ty < chart.margin.top) ty = info.py + 14;
    g.appendChild(el('rect', {
      x: tx, y: ty, width: w, height: h, rx: 5,
      fill: '#ffffff', stroke: 'var(--panel-border)', 'stroke-width': 1,
      opacity: 0.97,
    }));
    lines.forEach((ln, i) => {
      const t = el('text', {
        x: tx + padX, y: ty + 15 + i * lineH,
        fill: i === 0 ? 'var(--navy)' : 'var(--label)',
        class: 'ef-tip-text', 'font-weight': i === 0 ? 700 : 400,
      });
      t.textContent = ln;
      g.appendChild(t);
    });
    chart.overlayGroup.appendChild(g);
    tip = g;
  };
}

/**
 * Horizontal bar chart of the tangency-portfolio weights. Negative weights
 * (short positions) extend left of a zero baseline. Plain SVG.
 * @param {HTMLElement} host container element
 * @param {string[]} names
 * @param {number[]} weights
 * @param {number} pointScale
 */
export function renderWeights(host, names, weights, pointScale) {
  host.replaceChildren();
  const n = names.length;
  const rowH = 30 * pointScale;
  const padTop = 10;
  const padBot = 10;
  const W = 640;
  const H = padTop + padBot + n * rowH;
  const labelW = 128;
  const valueW = 54;
  const x0 = labelW;
  const x1 = W - valueW - 12;
  const maxAbs = Math.max(0.05, ...weights.map((w) => Math.abs(w)));
  const zero = x0 + ((0 - -maxAbs) / (maxAbs - -maxAbs)) * (x1 - x0);
  const scale = (w) => ((w) / (2 * maxAbs)) * (x1 - x0);

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'weights-svg', preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // zero baseline
  svg.appendChild(el('line', {
    x1: zero, y1: padTop - 2, x2: zero, y2: H - padBot + 2,
    stroke: 'var(--axis)', 'stroke-width': 1,
  }));

  weights.forEach((w, i) => {
    const cy = padTop + i * rowH + rowH / 2;
    const barW = scale(w);
    const bx = w >= 0 ? zero : zero + barW;
    const bh = rowH * 0.52;
    // bar
    svg.appendChild(el('rect', {
      x: bx, y: cy - bh / 2, width: Math.max(1, Math.abs(barW)), height: bh, rx: 2,
      fill: w >= 0 ? 'var(--blue)' : '#8fb8d6',
    }));
    // asset name (left gutter)
    const nm = el('text', {
      x: labelW - 10, y: cy + 4, 'text-anchor': 'end', class: 'w-name',
    });
    nm.textContent = names[i];
    svg.appendChild(nm);
    // value label at the bar tip
    const vx = w >= 0 ? zero + barW + 6 : zero + barW - 6;
    const val = el('text', {
      x: vx, y: cy + 4, 'text-anchor': w >= 0 ? 'start' : 'end', class: 'w-val',
    });
    val.textContent = pctSigned(w);
    svg.appendChild(val);
  });

  host.appendChild(svg);
}

/**
 * Fill the numeric readout tiles.
 * @param {Record<string,HTMLElement>} tiles map of id -> value <span>
 * @param {object} m computed model
 */
export function renderReadouts(tiles, m) {
  tiles.tanEr.textContent = pct1(m.tangency.mean);
  tiles.tanSd.textContent = pct1(m.tangency.std);
  tiles.tanSharpe.textContent = m.tangency.sharpe.toFixed(3);
  tiles.mvpEr.textContent = pct1(m.mvp.mean);
  tiles.mvpSd.textContent = pct1(m.mvp.std);
}

/**
 * Render the live KaTeX formula strip: the tangency weight rule and the Sharpe
 * ratio with current tangency numbers substituted.
 * @param {HTMLElement} rowW host for the weight rule
 * @param {HTMLElement} rowS host for the Sharpe line
 * @param {object} m computed model
 */
export function renderFormula(rowW, rowS, m) {
  renderTeX(rowW,
    'w_{\\text{tan}} \\;\\propto\\; \\Sigma^{-1}\\,(\\mu - r_f\\,\\mathbf{1})',
    { displayMode: false });
  const S = m.tangency.sharpe;
  // NB: % must be escaped as \% in KaTeX (comment character otherwise).
  const texPct = (v, d = 1) => `${(v * 100).toFixed(d).replace(/\.?0+$/, '')}\\%`;
  const er = texPct(m.tangency.mean);
  const sd = texPct(m.tangency.std);
  const rf = texPct(m.rf, 2);
  renderTeX(rowS,
    `S_T \\;=\\; \\frac{E[r_T]-r_f}{\\sigma_T} \\;=\\; \\frac{${er}-${rf}}{${sd}} \\;=\\; ${S.toFixed(3)}`,
    { displayMode: false });
}
