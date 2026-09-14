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

import { pct, svgMathText, setStrokeWidth, LabelPlacer } from '../../lib/chart.js';
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
 * @param {number} pointScale point-radius multiplier
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
  // Labels (MVP + asset names) go through LabelPlacer (white halo, spots
  // chosen to dodge the frontier, the markers and each other) — since
  // 2026-09-14, when the 15px names started colliding near the cluster.
  const lp = new LabelPlacer(chart);
  if (eff.length > 1) lp.avoidPath(eff.map(toXY));
  if (ineff.length > 1) lp.avoidPath(ineff.map(toXY));
  const mvpR = 6 * pointScale;
  chart.point(m.mvp.std, m.mvp.mean, {
    r: mvpR, fill: 'var(--gold)', stroke: '#fff', shape: 'diamond',
  });
  const assetR = 4.2 * pointScale;
  const assetBoxes = m.names.map((_, i) => lp.avoidPoint(m.sig[i], m.mu[i], assetR));
  const mvpBox = lp.avoidPoint(m.mvp.std, m.mvp.mean, mvpR);
  lp.label(m.mvp.std, m.mvp.mean, 'MVP', {
    r: mvpR, own: mvpBox, fill: 'var(--gold)', klass: 'lbl-strong', prefer: ['ll', 'ul', 'lr', 'ur'],
  });

  // (e) individual assets — navy dots + name labels.
  for (let i = 0; i < m.names.length; i++) {
    chart.point(m.sig[i], m.mu[i], { r: assetR, fill: 'var(--navy)' });
    lp.label(m.sig[i], m.mu[i], m.names[i], {
      r: assetR, own: assetBoxes[i], fill: 'var(--navy)', prefer: ['lr', 'r', 'ur', 'll'],
    });
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
  const t = m.tangency; // null when rf >= MVP mean (no tangency exists)

  if (t) {
    // CAL: from (0, rf) with slope = Sharpe, clipped to the plot box.
    const slope = t.sharpe; // (mean - rf) / std — positive whenever t exists
    let xEnd = chart.xHi;
    if (slope > 0) {
      const xAtTop = (chart.yHi - m.rf) / slope;
      xEnd = Math.min(chart.xHi, xAtTop);
    }
    const yEnd = m.rf + slope * xEnd;
    const cal = el('line', {
      x1: chart.sx(0), y1: chart.sy(m.rf), x2: chart.sx(xEnd), y2: chart.sy(yEnd),
      stroke: 'var(--blue)', 'stroke-linecap': 'round',
      class: 'cal-line',
    });
    setStrokeWidth(cal, 1.5 * pointScale);
    chart.overlayGroup.appendChild(cal);
    nodes.push(cal);
  }

  // rf intercept marker on the y-axis.
  const rfDot = el('circle', {
    cx: chart.sx(0), cy: chart.sy(m.rf), r: 3 * pointScale, fill: 'var(--navy)',
  });
  chart.overlayGroup.appendChild(rfDot);
  nodes.push(rfDot);
  const rfLbl = el('text', {
    x: chart.sx(0) + 6, y: chart.sy(m.rf) - 6, fill: 'var(--navy)', class: 'datalabel',
  });
  svgMathText(rfLbl, `r_f = ${(m.rf * 100).toFixed(2).replace(/\.?0+$/, '')}%`);
  chart.overlayGroup.appendChild(rfLbl);
  nodes.push(rfLbl);

  // Tangency portfolio — gold star (stands out against the blue CAL), labeled T.
  if (t) {
    const star = el('path', {
      d: starPath(chart.sx(t.std), chart.sy(t.mean), 9 * pointScale, 4 * pointScale, 5),
      fill: 'var(--gold)', stroke: '#fff', 'stroke-width': 1.2, class: 'tangency-star',
    });
    chart.overlayGroup.appendChild(star);
    nodes.push(star);
    const tLbl = el('text', {
      x: chart.sx(t.std) + 12, y: chart.sy(t.mean) - 9, fill: 'var(--gold)',
      class: 'datalabel lbl-strong',
    });
    tLbl.textContent = 'T';
    chart.overlayGroup.appendChild(tLbl);
    nodes.push(tLbl);
  }

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
  if (!weights) { // no tangency at this rf — nothing sensible to plot
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No tangency portfolio at this risk-free rate.';
    host.appendChild(p);
    return;
  }
  const n = names.length;
  const rowH = 44;
  const padTop = 14;
  const padBot = 26; // room for the axis labels under the bars
  const W = 560;
  const H = padTop + padBot + n * rowH;
  const labelW = 118;
  const x0 = labelW;
  const x1 = W - 16;
  // symmetric scale, padded so value labels never clip at the edge
  const maxAbs = Math.max(0.1, ...weights.map((w) => Math.abs(w))) * 1.35;
  const zero = x0 + (x1 - x0) / 2;
  const scale = (w) => (w / (2 * maxAbs)) * (x1 - x0);

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'weights-svg', preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    // Safari needs intrinsic dimensions + aspect-ratio (no auto height from viewBox).
    width: W, height: H,
  });
  svg.style.aspectRatio = `${W} / ${H}`;

  // light row separators + subtle vertical gridlines at ±50%, ±100%
  for (const g of [-1, -0.5, 0.5, 1]) {
    const gx = zero + scale(g);
    if (gx <= x0 || gx >= x1) continue;
    svg.appendChild(el('line', {
      x1: gx, y1: padTop, x2: gx, y2: H - padBot,
      stroke: 'var(--grid)', 'stroke-width': 1,
    }));
    const gl = el('text', { x: gx, y: H - padBot + 15, 'text-anchor': 'middle', class: 'w-axis' });
    gl.textContent = `${g > 0 ? '+' : ''}${Math.round(g * 100)}%`;
    svg.appendChild(gl);
  }
  // zero baseline (strong) + 0% label
  svg.appendChild(el('line', {
    x1: zero, y1: padTop - 4, x2: zero, y2: H - padBot,
    stroke: 'var(--axis)', 'stroke-width': 1.4,
  }));
  const zl = el('text', { x: zero, y: H - padBot + 15, 'text-anchor': 'middle', class: 'w-axis' });
  zl.textContent = '0%';
  svg.appendChild(zl);

  weights.forEach((w, i) => {
    const cy = padTop + i * rowH + rowH / 2 + 4;
    const barW = scale(w);
    const bx = w >= 0 ? zero : zero + barW;
    const bh = 20;
    // bar: BLUE = long, GOLD = short
    svg.appendChild(el('rect', {
      x: bx, y: cy - bh / 2, width: Math.max(1.5, Math.abs(barW)), height: bh, rx: 4,
      fill: w >= 0 ? 'var(--blue)' : 'var(--gold)',
    }));
    // asset name (left gutter)
    const nm = el('text', {
      x: labelW - 12, y: cy + 4, 'text-anchor': 'end', class: 'w-name',
    });
    nm.textContent = names[i];
    svg.appendChild(nm);
    // value label just past the bar tip
    const vx = w >= 0 ? zero + barW + 7 : zero + barW - 7;
    const val = el('text', {
      x: vx, y: cy + 4, 'text-anchor': w >= 0 ? 'start' : 'end',
      class: 'w-val', fill: w >= 0 ? 'var(--blue)' : 'var(--gold)',
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
  const t = m.tangency;
  tiles.tanEr.textContent = t ? pct1(t.mean) : '—';
  tiles.tanSd.textContent = t ? pct1(t.std) : '—';
  tiles.tanSharpe.textContent = t ? t.sharpe.toFixed(3) : '—';
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
  if (!m.tangency) {
    rowS.textContent = 'No tangency portfolio: r_f is at or above the global-MVP mean.';
    return;
  }
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
