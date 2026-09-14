// @ts-check
/**
 * chart.js — a minimal dependency-free SVG chart helper for the FIN 30600
 * tools. Matplotlib-like "despined" look: only the left and bottom axes are
 * drawn (no top/right border), a light grid, plain tick labels.
 *
 * Design goal: axes/grid are built ONCE (`renderAxes`), and the volatile data
 * layer can be cleared and redrawn many times a second during slider drags
 * (`clearData`, then `path`/`point`/... calls) WITHOUT rebuilding the axes.
 * Everything lives in two <g> groups: a static "axis" group and a "data" group.
 *
 * Coordinates: callers pass DATA coordinates (decimals). The chart maps them
 * through linear x/y scales into SVG pixels. The y axis is flipped so larger
 * values are higher on screen.
 *
 * @module chart
 */

const SVGNS = 'http://www.w3.org/2000/svg';

/** @param {string} name @param {Record<string,string|number>} [attrs] */
function el(name, attrs) {
  const node = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

/**
 * Set a stroke width that scales with --stroke-scale. Must be an inline
 * STYLE (not a presentation attribute): any stylesheet rule would override
 * the attribute, which is exactly the bug that once pinned every series to
 * 2px regardless of the width passed to path().
 * @param {SVGElement} node @param {number} w base width in px
 */
export function setStrokeWidth(node, w) {
  node.style.strokeWidth = `calc(${w}px * var(--stroke-scale, 1))`;
}

/**
 * Whole-percent tick formatter: 0.3 -> "30%", -0.05 -> "-5%". Rounds to the
 * nearest whole percent (Christian's standing axis rule — never "0.30" or
 * "30.0%").
 * @param {number} v value in decimals
 * @returns {string}
 */
export function pct(v) {
  return `${Math.round(v * 100)}%`;
}

/** Line height, in em, between the lines of a multi-line SVG label. */
export const LINE_EM = 1.15;

/**
 * Set an SVG <text> element's content, rendering `_x` / `_{xy}` suffixes as
 * true tspan subscripts so on-chart labels like "r_f = 3%" or "E[r_C]" read
 * as math instead of raw underscores. (MathJax cannot render inside SVG.)
 * A `\n` in `str` starts a new line (LINE_EM below, re-anchored at the
 * element's `x`, so text-anchor applies per line). Shifts are in em, so
 * they follow whatever font size the element ends up with.
 * @param {SVGTextElement} node
 * @param {string} str
 */
export function svgMathText(node, str) {
  node.textContent = '';
  const x = node.getAttribute('x');
  const re = /_(\{([^}]+)\}|[A-Za-z0-9]+)/g;
  let shifted = false;   // baseline currently lowered by a subscript tspan?
  let lineStart = false; // the next tspan opens a new line
  const put = (text, isSub) => {
    const t = document.createElementNS(SVGNS, 'tspan');
    let dy = 0; // in em of the tspan's OWN font size (subscripts are 75%)
    if (isSub) {
      if (!shifted) dy += 0.25 / 0.75; // drop 0.25 em of the base size
      shifted = true;
      t.setAttribute('font-size', '75%');
    } else if (shifted) {
      dy -= 0.25;                       // restore the baseline
      shifted = false;
    }
    if (lineStart) {
      dy += isSub ? LINE_EM / 0.75 : LINE_EM;
      if (x != null) t.setAttribute('x', x);
      lineStart = false;
    }
    if (dy) t.setAttribute('dy', `${+dy.toFixed(4)}em`);
    t.textContent = text;
    node.appendChild(t);
  };
  str.split('\n').forEach((line, li) => {
    if (li > 0) lineStart = true;
    let last = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) put(line.slice(last, m.index), false);
      put(m[2] ?? m[1], true);
      last = re.lastIndex;
    }
    if (last < line.length) put(line.slice(last), false);
    if (lineStart) put('​', false); // empty line: keep the line advance
  });
}

/**
 * Plain number formatter with a fixed number of decimals (default 1).
 * @param {number} d decimals to keep
 * @returns {(v:number)=>string}
 */
export function fixed(d = 1) {
  return (v) => v.toFixed(d);
}

/**
 * Generate "nice" evenly spaced tick values covering [lo, hi].
 * @param {number} lo
 * @param {number} hi
 * @param {number} [count=6] approximate number of ticks
 * @returns {number[]}
 */
export function niceTicks(lo, hi, count = 6) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [];
  if (lo === hi) return [lo];
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= mag;
  const start = Math.ceil(lo / step) * step;
  // Generate by INDEX, not by accumulating `v += step`: on a near-degenerate
  // range (hi − lo a few ulps) the step can be below half an ulp of `start`,
  // where `v += step` never advances and the loop spins forever.
  const n = Math.floor((hi + step * 1e-6 - start) / step);
  if (!Number.isFinite(n) || n < 0 || n > 500) return [lo];
  const ticks = [];
  for (let i = 0; i <= n; i++) {
    const v = start + i * step;
    // clean floating-point fuzz
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/**
 * A small SVG chart. Construct with a container element and options, then call
 * `setDomain`, `renderAxes`, and draw into the data layer.
 */
export class Chart {
  /**
   * @param {HTMLElement} container element to hold the <svg>
   * @param {object} [opts]
   * @param {number} [opts.width=640]
   * @param {number} [opts.height=440]
   * @param {{top:number,right:number,bottom:number,left:number}} [opts.margin]
   * @param {string} [opts.xLabel] x-axis title
   * @param {string} [opts.yLabel] y-axis title
   * @param {(v:number)=>string} [opts.xFmt] x tick formatter (default pct)
   * @param {(v:number)=>string} [opts.yFmt] y tick formatter (default pct)
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.width = opts.width ?? 640;
    this.height = opts.height ?? 440;
    // Default margins fit the 15/16px axis text (style.css --chart-tick /
    // --chart-title); they were 18/20/48/60 for the old 12/13px text.
    this.margin = opts.margin ?? { top: 20, right: 22, bottom: 54, left: 68 };
    this.xLabel = opts.xLabel ?? '';
    this.yLabel = opts.yLabel ?? '';
    this.xFmt = opts.xFmt ?? pct;
    this.yFmt = opts.yFmt ?? pct;
    // data domain (in data coords)
    this.xLo = 0; this.xHi = 1; this.yLo = 0; this.yHi = 1;

    this.svg = el('svg', {
      viewBox: `0 0 ${this.width} ${this.height}`,
      // Explicit intrinsic size + aspect-ratio: Safari does NOT derive an
      // auto height from the viewBox alone, which collapses the chart.
      width: this.width,
      height: this.height,
      class: 'finchart',
      preserveAspectRatio: 'xMidYMid meet',
    });
    this.svg.style.aspectRatio = `${this.width} / ${this.height}`;
    this.svg.setAttribute('role', 'img');
    this.axisGroup = el('g', { class: 'axis-layer' });
    this.dataGroup = el('g', { class: 'data-layer' });
    this.overlayGroup = el('g', { class: 'overlay-layer' });
    this.svg.appendChild(this.axisGroup);
    this.svg.appendChild(this.dataGroup);
    this.svg.appendChild(this.overlayGroup);
    container.appendChild(this.svg);

    /** @type {{x:number,y:number,data:any}[]} */
    this._hoverPoints = [];
    this._hoverHandler = null;
  }

  /** Inner plotting area in pixels. @returns {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} */
  plotArea() {
    const { top, right, bottom, left } = this.margin;
    return {
      x0: left,
      y0: top,
      x1: this.width - right,
      y1: this.height - bottom,
      w: this.width - left - right,
      h: this.height - top - bottom,
    };
  }

  /**
   * Set the data domain (x and y ranges, in data coordinates).
   * @param {number} xLo @param {number} xHi @param {number} yLo @param {number} yHi
   * @returns {this}
   */
  setDomain(xLo, xHi, yLo, yHi) {
    this.xLo = xLo; this.xHi = xHi; this.yLo = yLo; this.yHi = yHi;
    return this;
  }

  /** Map a data x to a pixel x. @param {number} x @returns {number} */
  sx(x) {
    const a = this.plotArea();
    return a.x0 + ((x - this.xLo) / (this.xHi - this.xLo)) * a.w;
  }

  /** Map a data y to a pixel y (flipped). @param {number} y @returns {number} */
  sy(y) {
    const a = this.plotArea();
    return a.y1 - ((y - this.yLo) / (this.yHi - this.yLo)) * a.h;
  }

  /**
   * Draw the static axis layer: grid, left + bottom spines, ticks, labels,
   * axis titles. Call once after `setDomain` (or again only when the domain
   * changes — not on every slider tick).
   * @param {object} [opts]
   * @param {number} [opts.xTickCount=6]
   * @param {number} [opts.yTickCount=6]
   * @param {number[]} [opts.xTicks] explicit x tick values (overrides count)
   * @param {number[]} [opts.yTicks] explicit y tick values (overrides count)
   * @returns {this}
   */
  renderAxes(opts = {}) {
    while (this.axisGroup.firstChild) this.axisGroup.removeChild(this.axisGroup.firstChild);
    const a = this.plotArea();
    const xTicks = opts.xTicks ?? niceTicks(this.xLo, this.xHi, opts.xTickCount ?? 6);
    const yTicks = opts.yTicks ?? niceTicks(this.yLo, this.yHi, opts.yTickCount ?? 6);

    // grid
    for (const t of yTicks) {
      const y = this.sy(t);
      this.axisGroup.appendChild(el('line', {
        x1: a.x0, y1: y, x2: a.x1, y2: y, class: 'grid',
      }));
    }
    for (const t of xTicks) {
      const x = this.sx(t);
      this.axisGroup.appendChild(el('line', {
        x1: x, y1: a.y0, x2: x, y2: a.y1, class: 'grid',
      }));
    }

    // spines (left + bottom only — despined look)
    this.axisGroup.appendChild(el('line', {
      x1: a.x0, y1: a.y0, x2: a.x0, y2: a.y1, class: 'spine',
    }));
    this.axisGroup.appendChild(el('line', {
      x1: a.x0, y1: a.y1, x2: a.x1, y2: a.y1, class: 'spine',
    }));

    // tick labels
    for (const t of xTicks) {
      const x = this.sx(t);
      const lbl = el('text', { x, y: a.y1 + 20, class: 'tick tick-x' });
      lbl.textContent = this.xFmt(t);
      this.axisGroup.appendChild(lbl);
    }
    for (const t of yTicks) {
      const y = this.sy(t);
      const lbl = el('text', { x: a.x0 - 9, y: y + 5, class: 'tick tick-y' });
      lbl.textContent = this.yFmt(t);
      this.axisGroup.appendChild(lbl);
    }

    // axis titles
    if (this.xLabel) {
      const t = el('text', {
        x: (a.x0 + a.x1) / 2, y: this.height - 8, class: 'axis-title axis-title-x',
      });
      t.textContent = this.xLabel;
      this.axisGroup.appendChild(t);
    }
    if (this.yLabel) {
      const cx = 18;
      const cy = (a.y0 + a.y1) / 2;
      const t = el('text', {
        x: cx, y: cy, class: 'axis-title axis-title-y',
        transform: `rotate(-90 ${cx} ${cy})`,
      });
      t.textContent = this.yLabel;
      this.axisGroup.appendChild(t);
    }
    return this;
  }

  /** Remove everything in the volatile data layer (fast re-render). @returns {this} */
  clearData() {
    while (this.dataGroup.firstChild) this.dataGroup.removeChild(this.dataGroup.firstChild);
    this._hoverPoints = [];
    return this;
  }

  /** Remove overlay-layer content (hover tooltips etc). @returns {this} */
  clearOverlay() {
    while (this.overlayGroup.firstChild) this.overlayGroup.removeChild(this.overlayGroup.firstChild);
    return this;
  }

  /** Alias for a full data-layer reset. @returns {this} */
  clear() { return this.clearData(); }

  /**
   * Draw a polyline/curve through data points.
   * @param {{x:number,y:number}[]|number[][]} points array of {x,y} or [x,y]
   * @param {object} [opts]
   * @param {string} [opts.stroke] CSS color (default var(--blue))
   * @param {number} [opts.width=2]
   * @param {string} [opts.dash] stroke-dasharray value
   * @param {string} [opts.klass] extra CSS class
   * @param {number} [opts.opacity=1]
   * @returns {SVGPathElement}
   */
  path(points, opts = {}) {
    const d = points.map((p, i) => {
      const x = Array.isArray(p) ? p[0] : p.x;
      const y = Array.isArray(p) ? p[1] : p.y;
      return `${i === 0 ? 'M' : 'L'}${this.sx(x).toFixed(2)},${this.sy(y).toFixed(2)}`;
    }).join(' ');
    const node = el('path', {
      d,
      fill: 'none',
      stroke: opts.stroke ?? 'var(--blue)',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      opacity: opts.opacity ?? 1,
      class: `series ${opts.klass ?? ''}`.trim(),
    });
    setStrokeWidth(node, opts.width ?? 2);
    if (opts.dash) node.setAttribute('stroke-dasharray', opts.dash);
    this.dataGroup.appendChild(node);
    return node;
  }

  /**
   * Draw a marker point. Registers it for nearest-point hover detection when
   * `opts.hoverData` is supplied.
   * @param {number} x data x
   * @param {number} y data y
   * @param {object} [opts]
   * @param {number} [opts.r=5] radius in px
   * @param {string} [opts.fill] fill color (default var(--blue))
   * @param {string} [opts.stroke]
   * @param {string} [opts.shape] "circle" (default) | "diamond" | "star"
   * @param {string} [opts.klass]
   * @param {any} [opts.hoverData] payload passed to the hover handler
   * @returns {SVGElement}
   */
  point(x, y, opts = {}) {
    const px = this.sx(x);
    const py = this.sy(y);
    const r = opts.r ?? 5;
    const fill = opts.fill ?? 'var(--blue)';
    let node;
    const shape = opts.shape ?? 'circle';
    if (shape === 'diamond') {
      node = el('path', {
        d: `M${px},${py - r} L${px + r},${py} L${px},${py + r} L${px - r},${py} Z`,
        fill,
      });
    } else if (shape === 'star') {
      node = el('path', { d: starPath(px, py, r, r * 0.45, 5), fill });
    } else {
      node = el('circle', { cx: px, cy: py, r, fill });
    }
    if (opts.stroke) { node.setAttribute('stroke', opts.stroke); setStrokeWidth(node, 1.5); }
    node.setAttribute('class', `marker ${opts.klass ?? ''}`.trim());
    this.dataGroup.appendChild(node);
    if (opts.hoverData !== undefined) this._hoverPoints.push({ x: px, y: py, data: opts.hoverData });
    return node;
  }

  /**
   * Draw a text label at a data coordinate.
   * @param {number} x data x
   * @param {number} y data y
   * @param {string} str text content
   * @param {object} [opts]
   * @param {number} [opts.dx=0] pixel x offset
   * @param {number} [opts.dy=0] pixel y offset
   * @param {string} [opts.anchor="start"] text-anchor
   * @param {string} [opts.fill] color (default var(--label))
   * @param {string} [opts.klass]
   * @param {boolean} [opts.halo=false] paint a white outline behind the glyphs
   *   (class "halo", see style.css) so the label stays legible where a curve
   *   runs behind it
   * @param {number} [opts.size] font size in px before --stroke-scale (inline;
   *   default = the 15px .datalabel stylesheet size, --chart-label). `str` may contain `\n`
   *   for a multi-line label (see svgMathText).
   * @returns {SVGTextElement}
   */
  text(x, y, str, opts = {}) {
    const node = el('text', {
      x: this.sx(x) + (opts.dx ?? 0),
      y: this.sy(y) + (opts.dy ?? 0),
      'text-anchor': opts.anchor ?? 'start',
      fill: opts.fill ?? 'var(--label)',
      class: `datalabel ${opts.halo ? 'halo ' : ''}${opts.klass ?? ''}`.trim(),
    });
    if (opts.size) node.style.fontSize = `calc(${opts.size}px * var(--stroke-scale, 1))`;
    svgMathText(node, str);
    this.dataGroup.appendChild(node);
    return node;
  }

  /**
   * Vertical reference line at data x, spanning the plot height.
   * @param {number} x data x
   * @param {object} [opts] {stroke, dash, width, klass, opacity}
   * @returns {SVGLineElement}
   */
  vline(x, opts = {}) {
    const a = this.plotArea();
    const px = this.sx(x);
    const node = el('line', {
      x1: px, y1: a.y0, x2: px, y2: a.y1,
      stroke: opts.stroke ?? 'var(--red)',
      opacity: opts.opacity ?? 1,
      class: `refline ${opts.klass ?? ''}`.trim(),
    });
    setStrokeWidth(node, opts.width ?? 1.5);
    if (opts.dash) node.setAttribute('stroke-dasharray', opts.dash);
    this.dataGroup.appendChild(node);
    return node;
  }

  /**
   * Horizontal reference line at data y, spanning the plot width.
   * @param {number} y data y
   * @param {object} [opts] {stroke, dash, width, klass, opacity}
   * @returns {SVGLineElement}
   */
  hline(y, opts = {}) {
    const a = this.plotArea();
    const py = this.sy(y);
    const node = el('line', {
      x1: a.x0, y1: py, x2: a.x1, y2: py,
      stroke: opts.stroke ?? 'var(--red)',
      opacity: opts.opacity ?? 1,
      class: `refline ${opts.klass ?? ''}`.trim(),
    });
    setStrokeWidth(node, opts.width ?? 1.5);
    if (opts.dash) node.setAttribute('stroke-dasharray', opts.dash);
    this.dataGroup.appendChild(node);
    return node;
  }

  /**
   * Draw a straight segment between two data points.
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   * @param {object} [opts] {stroke, dash, width, klass, opacity}
   * @returns {SVGLineElement}
   */
  segment(x1, y1, x2, y2, opts = {}) {
    const node = el('line', {
      x1: this.sx(x1), y1: this.sy(y1), x2: this.sx(x2), y2: this.sy(y2),
      stroke: opts.stroke ?? 'var(--blue)',
      opacity: opts.opacity ?? 1,
      'stroke-linecap': 'round',
      class: `series ${opts.klass ?? ''}`.trim(),
    });
    setStrokeWidth(node, opts.width ?? 2);
    if (opts.dash) node.setAttribute('stroke-dasharray', opts.dash);
    this.dataGroup.appendChild(node);
    return node;
  }

  /**
   * Install a nearest-point hover hook. The handler fires with the hovered
   * point's payload (from `point(..., {hoverData})`) and pixel position, or
   * with `null` when the pointer leaves all points' neighborhoods. Only points
   * drawn AFTER the most recent `clearData` are considered.
   * @param {(payload:any|null, info:{px:number,py:number,event:PointerEvent}|null)=>void} handler
   * @param {object} [opts]
   * @param {number} [opts.radius=24] pixel capture radius
   * @returns {this}
   */
  onHover(handler, opts = {}) {
    const radius = opts.radius ?? 24;
    // Re-installing replaces the previous hover hook instead of stacking
    // listeners (a tool that calls onHover on every render would otherwise
    // accumulate one pair per render).
    if (this._hoverListeners) {
      this.svg.removeEventListener('pointermove', this._hoverListeners.move);
      this.svg.removeEventListener('pointerleave', this._hoverListeners.leave);
    }
    this._hoverHandler = handler;
    const move = (event) => {
      const rect = this.svg.getBoundingClientRect();
      // account for viewBox scaling
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const mx = (event.clientX - rect.left) * scaleX;
      const my = (event.clientY - rect.top) * scaleY;
      let best = null;
      let bestD = radius * radius;
      for (const p of this._hoverPoints) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD) { bestD = d2; best = p; }
      }
      if (best) handler(best.data, { px: best.x, py: best.y, event });
      else handler(null, null);
    };
    const leave = () => handler(null, null);
    this._hoverListeners = { move, leave };
    this.svg.addEventListener('pointermove', move);
    this.svg.addEventListener('pointerleave', leave);
    return this;
  }
}

/**
 * SVG path string for an n-point star centered at (cx, cy).
 * @param {number} cx @param {number} cy @param {number} rOuter @param {number} rInner @param {number} n
 * @returns {string}
 */
function starPath(cx, cy, rOuter, rInner, n) {
  let d = '';
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const ang = (Math.PI / n) * i - Math.PI / 2;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

/* ------------------------------------------------------------------------ */
/* Collision-aware point labels                                             */
/* ------------------------------------------------------------------------ */

/**
 * Rough advance width of an SVG data label in px at a given font size —
 * Arial metrics by character class, with `_x` / `_{xy}` subscript markup
 * (as rendered by svgMathText) counted at 75%. An estimate, good enough to
 * keep labels apart; not pixel-exact.
 * @param {string} str @param {number} fontPx
 * @returns {number}
 */
export function estimateTextWidth(str, fontPx) {
  let w = 0;
  let inBrace = false;
  let inRun = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '_') {
      if (str[i + 1] === '{') { inBrace = true; i++; } else inRun = true;
      continue;
    }
    if (inBrace && ch === '}') { inBrace = false; continue; }
    if (inRun && !/[A-Za-z0-9]/.test(ch)) inRun = false;
    const scale = inBrace || inRun ? 0.75 : 1;
    let em;
    if (/[ .,:;'|!il\[\]()]/.test(ch)) em = 0.30;
    else if (/[%wmWM]/.test(ch)) em = 0.85;
    else if (/[A-Z0-9=σ*]/.test(ch)) em = 0.62;
    else em = 0.53;
    w += em * fontPx * scale;
  }
  return w;
}

/**
 * Collision-aware placement for point labels — one instance per render.
 *
 *   const lp = new LabelPlacer(chart);
 *   lp.avoidPath(curvePts);                       // polyline labels must not cross
 *   const mk = lp.avoidPoint(x, y, r);            // marker labels must not cover
 *   lp.label(x, y, 'C', { r, own: mk, fill, prefer: ['ul', 'lr'] });
 *
 * Each label tries the four diagonal quadrants of its point (default order
 * upper-left, lower-right, upper-right, lower-left), then the four cardinal
 * spots (b, t, r, l) and a farther ring of diagonals (UL, LR, UR, LL) for
 * cramped charts, and scores every spot: +1000 if it leaves the plot area,
 * +100 per label or marker box it overlaps, +11…20 per registered line
 * running through it (10 + the number of its segments inside, capped, so a
 * densely sampled curve does not outweigh a label overlap), +25 for the far
 * ring (a near spot with one curve behind the halo beats a detached label),
 * +index in the candidate order as the tie-break. The
 * lowest score wins, the text is drawn with a white halo (chart.text `halo`)
 * and its box becomes an obstacle for the labels placed after it — so place
 * the most important label first. Pick the `prefer` order from the geometry:
 * for a point on a curve rising to the right, upper-left and lower-right are
 * the line-free sides.
 */
export class LabelPlacer {
  /**
   * @param {Chart} chart
   * @param {object} [opts]
   * @param {number} [opts.fontPx=15] label font size in px BEFORE --stroke-scale
   *   (15 = the .datalabel stylesheet size, --chart-label); applied inline to every label
   *   this placer draws, so the boxes it estimates match what renders
   * @param {number} [opts.pad=3] breathing room around each label box, px
   */
  constructor(chart, opts = {}) {
    this.chart = chart;
    const scale = parseFloat(getComputedStyle(chart.svg).getPropertyValue('--stroke-scale')) || 1;
    this.basePx = opts.fontPx ?? 15;
    this.fontPx = this.basePx * scale;
    this.pad = opts.pad ?? 3;
    /** @type {number[][]} obstacle boxes [x0, y0, x1, y1] in px */
    this.boxes = [];
    /** @type {number[][][]} polylines in px */
    this.lines = [];
  }

  /**
   * Register a polyline (data coords, {x,y} or [x,y] points) labels must not cross.
   * @param {{x:number,y:number}[]|number[][]} points
   * @returns {this}
   */
  avoidPath(points) {
    const c = this.chart;
    this.lines.push(points.map((p) => (Array.isArray(p)
      ? [c.sx(p[0]), c.sy(p[1])]
      : [c.sx(p.x), c.sy(p.y)])));
    return this;
  }

  /**
   * Register a marker (data coords, radius in px) labels must not cover.
   * @param {number} x @param {number} y @param {number} r
   * @returns {number[]} the marker's box — pass it as `own` to that point's own label
   */
  avoidPoint(x, y, r) {
    const px = this.chart.sx(x);
    const py = this.chart.sy(y);
    const box = [px - r - 1, py - r - 1, px + r + 1, py + r + 1];
    this.boxes.push(box);
    return box;
  }

  /**
   * Place and draw a label next to the data point (x, y).
   * @param {number} x data x
   * @param {number} y data y
   * @param {string} str label text (svgMathText markup; `\n` = line break)
   * @param {object} [opts]
   * @param {number} [opts.r=5] the point's marker radius — sets the offset from the point
   * @param {number[]} [opts.own] this point's own marker box (from avoidPoint); ignored as an obstacle
   * @param {string[]} [opts.prefer] spots to try first, in order (default
   *   ['ul','lr','ur','ll']); every other candidate — the remaining diagonals,
   *   the cardinal spots 'b','t','r','l', the far ring 'UL','LR','UR','LL' —
   *   is appended automatically
   * @param {string} [opts.fill] text color
   * @param {string} [opts.klass] extra CSS class
   * @param {boolean} [opts.halo=true]
   * @returns {SVGTextElement}
   */
  label(x, y, str, opts = {}) {
    const c = this.chart;
    const px = c.sx(x);
    const py = c.sy(y);
    const h = this.fontPx;
    const lines = str.split('\n');
    const w = Math.max(...lines.map((l) => estimateTextWidth(l, h)));
    const extra = (lines.length - 1) * LINE_EM * h; // height of the further lines
    const gap1 = (opts.r ?? 5) + 5;
    const gap2 = gap1 + 1.2 * h; // the far ring
    const a = c.plotArea();
    const pad = this.pad;
    const order = [...(opts.prefer ?? ['ul', 'lr', 'ur', 'll'])];
    for (const k of Object.keys(CANDIDATES)) if (!order.includes(k)) order.push(k);
    let best = null;
    order.forEach((side, i) => {
      const [hx, vy, ring] = CANDIDATES[side];
      const g = ring === 2 ? gap2 : gap1;
      const tx = px + hx * g;
      // first-line baseline: block above / below the point, or centred on it
      const ty = vy < 0 ? py - g - 0.3 * h - extra
        : vy > 0 ? py + g + 0.8 * h
          : py + 0.35 * h - extra / 2;
      const anchor = hx < 0 ? 'end' : hx > 0 ? 'start' : 'middle';
      const x0 = hx < 0 ? tx - w : hx > 0 ? tx : tx - w / 2;
      const box = [x0 - pad, ty - 0.8 * h - pad, x0 + w + pad, ty + extra + 0.25 * h + pad];
      let score = i + (ring === 2 ? 25 : 0); // far ring: worse than a near spot crossing one line
      if (box[0] < a.x0 - 2 || box[2] > a.x1 + 2 || box[1] < a.y0 - 6 || box[3] > a.y1 + 2) score += 1000;
      for (const b of this.boxes) if (b !== opts.own && boxesOverlap(box, b)) score += 100;
      for (const L of this.lines) {
        const n = lineBoxCrossings(L, box); // per LINE: 11–20, not per segment
        if (n) score += 10 + Math.min(n, 10);
      }
      if (!best || score < best.score) best = { tx, ty, anchor, box, score };
    });
    const node = c.text(x, y, str, {
      dx: best.tx - px,
      dy: best.ty - py,
      anchor: best.anchor,
      fill: opts.fill,
      klass: opts.klass,
      halo: opts.halo ?? true,
      size: this.basePx,
    });
    this.boxes.push(best.box);
    return node;
  }
}

/** Candidate spots around a point: [horizontal side, vertical side, ring]. */
const CANDIDATES = {
  ul: [-1, -1, 1], lr: [1, 1, 1], ur: [1, -1, 1], ll: [-1, 1, 1],
  b: [0, 1, 1], t: [0, -1, 1], r: [1, 0, 1], l: [-1, 0, 1],
  UL: [-1, -1, 2], LR: [1, 1, 2], UR: [1, -1, 2], LL: [-1, 1, 2],
};

/** @param {number[]} a @param {number[]} b */
function boxesOverlap(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Number of segments of a pixel polyline that pass through a box. */
function lineBoxCrossings(line, box) {
  let n = 0;
  for (let i = 1; i < line.length; i++) {
    if (segmentHitsBox(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], box)) n++;
  }
  return n;
}

/** Liang–Barsky: does the segment (x1,y1)–(x2,y2) intersect the box? */
function segmentHitsBox(x1, y1, x2, y2, [bx0, by0, bx1, by1]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x1 - bx0) && clip(dx, bx1 - x1) && clip(-dy, y1 - by0) && clip(dy, by1 - y1);
}
