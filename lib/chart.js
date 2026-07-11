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
 * Whole-percent tick formatter: 0.3 -> "30%", -0.05 -> "-5%". Rounds to the
 * nearest whole percent (Christian's standing axis rule — never "0.30" or
 * "30.0%").
 * @param {number} v value in decimals
 * @returns {string}
 */
export function pct(v) {
  return `${Math.round(v * 100)}%`;
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
  const ticks = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) {
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
    this.margin = opts.margin ?? { top: 18, right: 20, bottom: 48, left: 60 };
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
      const lbl = el('text', { x, y: a.y1 + 18, class: 'tick tick-x' });
      lbl.textContent = this.xFmt(t);
      this.axisGroup.appendChild(lbl);
    }
    for (const t of yTicks) {
      const y = this.sy(t);
      const lbl = el('text', { x: a.x0 - 8, y: y + 4, class: 'tick tick-y' });
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
      const cx = 16;
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
      'stroke-width': opts.width ?? 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      opacity: opts.opacity ?? 1,
      class: `series ${opts.klass ?? ''}`.trim(),
    });
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
    if (opts.stroke) { node.setAttribute('stroke', opts.stroke); node.setAttribute('stroke-width', '1.5'); }
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
   * @returns {SVGTextElement}
   */
  text(x, y, str, opts = {}) {
    const node = el('text', {
      x: this.sx(x) + (opts.dx ?? 0),
      y: this.sy(y) + (opts.dy ?? 0),
      'text-anchor': opts.anchor ?? 'start',
      fill: opts.fill ?? 'var(--label)',
      class: `datalabel ${opts.klass ?? ''}`.trim(),
    });
    node.textContent = str;
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
      'stroke-width': opts.width ?? 1.5,
      opacity: opts.opacity ?? 1,
      class: `refline ${opts.klass ?? ''}`.trim(),
    });
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
      'stroke-width': opts.width ?? 1.5,
      opacity: opts.opacity ?? 1,
      class: `refline ${opts.klass ?? ''}`.trim(),
    });
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
      'stroke-width': opts.width ?? 2,
      opacity: opts.opacity ?? 1,
      'stroke-linecap': 'round',
      class: `series ${opts.klass ?? ''}`.trim(),
    });
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
    this.svg.addEventListener('pointermove', move);
    this.svg.addEventListener('pointerleave', () => handler(null, null));
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
