// @ts-check
/**
 * ui.js — tiny, dependency-free control components for the FIN 30600 tools.
 * Each factory returns a DOM element (a labeled wrapper) and wires an
 * `onChange` callback. No framework, no virtual DOM — just `document.create*`.
 *
 * All components carry a `.value` getter/setter and a `.set(v)` method so a
 * tool can push state back into a control (e.g. after reading the URL hash)
 * without firing the change callback.
 *
 * @module ui
 */

/** Unique ids so each control's <label> is programmatically tied to its
 * <input> (screen readers announce the label; clicking it focuses the input). */
let uid = 0;
const nextId = () => `fin-ctrl-${++uid}`;

/**
 * Labeled range slider with a live numeric readout.
 * @param {object} cfg
 * @param {string} cfg.label control label
 * @param {number} cfg.min
 * @param {number} cfg.max
 * @param {number} cfg.step
 * @param {number} cfg.value initial value
 * @param {(v:number)=>string} [cfg.fmt] readout formatter (default: String)
 * @param {(v:number)=>void} [cfg.onChange] fired on input with the new value
 * @returns {HTMLDivElement & {value:number, set:(v:number,silent?:boolean)=>void, input:HTMLInputElement}}
 */
export function slider(cfg) {
  const fmt = cfg.fmt ?? ((v) => String(v));
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-slider';

  const head = document.createElement('div');
  head.className = 'ctrl-head';
  const label = document.createElement('label');
  label.className = 'ctrl-label';
  renderLabel(label, cfg.label);
  const readout = document.createElement('span');
  readout.className = 'ctrl-readout';
  readout.textContent = fmt(cfg.value);
  head.appendChild(label);
  head.appendChild(readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(cfg.min);
  input.max = String(cfg.max);
  input.step = String(cfg.step);
  input.value = String(cfg.value);
  input.className = 'ctrl-range';
  input.id = nextId();
  label.htmlFor = input.id;

  input.addEventListener('input', () => {
    const v = Number(input.value);
    readout.textContent = fmt(v);
    if (cfg.onChange) cfg.onChange(v);
  });

  wrap.appendChild(head);
  wrap.appendChild(input);

  Object.defineProperty(wrap, 'value', { get: () => Number(input.value) });
  // @ts-ignore augmenting the element
  wrap.input = input;
  // @ts-ignore
  wrap.set = (v, silent = true) => {
    input.value = String(v);
    readout.textContent = fmt(Number(v));
    if (!silent && cfg.onChange) cfg.onChange(Number(v));
  };
  // @ts-ignore
  return wrap;
}

/**
 * Labeled numeric input box.
 * @param {object} cfg
 * @param {string} cfg.label
 * @param {number} cfg.value
 * @param {number} [cfg.min]
 * @param {number} [cfg.max]
 * @param {number} [cfg.step]
 * @param {(v:number)=>void} [cfg.onChange] fired on change with the new value
 * @returns {HTMLDivElement & {value:number, set:(v:number,silent?:boolean)=>void, input:HTMLInputElement}}
 */
export function numberInput(cfg) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-number';
  const label = document.createElement('label');
  label.className = 'ctrl-label';
  renderLabel(label, cfg.label);
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(cfg.value);
  if (cfg.min !== undefined) input.min = String(cfg.min);
  if (cfg.max !== undefined) input.max = String(cfg.max);
  if (cfg.step !== undefined) input.step = String(cfg.step);
  input.className = 'ctrl-numinput';
  input.id = nextId();
  label.htmlFor = input.id;

  // Fire only on a real, finite, NEW value: an emptied/mid-edit box must not
  // push a transient 0 into the tool ('' coerces to 0), and input+change must
  // not double-fire the same commit.
  let last = cfg.value;
  const fire = () => {
    if (input.value.trim() === '') return;
    const v = Number(input.value);
    if (!Number.isFinite(v) || v === last) return;
    last = v;
    if (cfg.onChange) cfg.onChange(v);
  };
  input.addEventListener('change', fire);
  input.addEventListener('input', fire);

  wrap.appendChild(label);
  wrap.appendChild(input);

  Object.defineProperty(wrap, 'value', { get: () => Number(input.value) });
  // @ts-ignore
  wrap.input = input;
  // @ts-ignore
  wrap.set = (v, silent = true) => {
    input.value = String(v);
    last = Number(v);
    if (!silent && cfg.onChange) cfg.onChange(Number(v));
  };
  // @ts-ignore
  return wrap;
}

/**
 * Labeled on/off toggle (a styled checkbox).
 * @param {object} cfg
 * @param {string} cfg.label
 * @param {boolean} [cfg.value=false] initial checked state
 * @param {(v:boolean)=>void} [cfg.onChange] fired on toggle with the new state
 * @returns {HTMLLabelElement & {value:boolean, set:(v:boolean,silent?:boolean)=>void, input:HTMLInputElement}}
 */
export function toggle(cfg) {
  const wrap = document.createElement('label');
  wrap.className = 'ctrl ctrl-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(cfg.value);
  input.className = 'ctrl-checkbox';
  const span = document.createElement('span');
  span.className = 'ctrl-toggle-label';
  renderLabel(span, cfg.label);

  input.addEventListener('change', () => {
    if (cfg.onChange) cfg.onChange(input.checked);
  });

  wrap.appendChild(input);
  wrap.appendChild(span);

  Object.defineProperty(wrap, 'value', { get: () => input.checked });
  // @ts-ignore
  wrap.input = input;
  // @ts-ignore
  wrap.set = (v, silent = true) => {
    input.checked = Boolean(v);
    if (!silent && cfg.onChange) cfg.onChange(input.checked);
  };
  // @ts-ignore
  return wrap;
}

/**
 * Convenience: render a TeX string into an element via the global `MathJax`
 * (v3 tex-svg bundle, loaded via <script> from vendor/mathjax/). Uses the
 * synchronous MathJax.tex2svg once the library is ready; if a tool renders
 * before the (deferred) 2 MB bundle finishes loading, the call is queued and
 * replayed once ui.js's own readiness poll (`armTeXFlush` below) sees MathJax
 * settle. Kept here so tools share one call site.
 * NB: % is a TeX comment character — escape it as \% in `tex`.
 * @param {HTMLElement} host element to render into
 * @param {string} tex TeX source
 * @param {object} [opts] { displayMode?: boolean } (KaTeX-compatible name)
 */
export function renderTeX(host, tex, opts = {}) {
  const g = /** @type {any} */ (globalThis);
  const display = Boolean(/** @type {any} */ (opts).displayMode);
  // MathJax (unlike KaTeX) rejects raw hex in \textcolor{#RRGGBB} — '#' is a
  // macro parameter character. Rewrite to the [RGB]{r,g,b} color model.
  const mjTex = tex.replace(/\\textcolor\{#([0-9a-fA-F]{6})\}/g, (_, h) =>
    `\\textcolor[RGB]{${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}}`);
  const paint = () => host.replaceChildren(g.MathJax.tex2svg(mjTex, { display }));
  if (g.__mjxSettled) {
    paint();
  } else {
    // MathJax not fully settled yet: show raw TeX, remember the LATEST call
    // per host, and repaint once MathJax is ready. NB: tex2svg silently emits
    // BLANK output when called in the same tick MathJax finishes its startup,
    // so the flusher waits one extra tick past readiness before painting.
    host.textContent = tex;
    if (!g.__texQueue) g.__texQueue = new Map();
    g.__texQueue.set(host, paint);
    armTeXFlush();
  }
}

/**
 * Render a mixed text/math label: plain text with inline `$...$` segments
 * typeset by MathJax, e.g. "Risk-free rate $r_f$ (%)". Used for every control
 * label, readout key, and group title so no hand-written pseudo-math
 * ("r_f", "sigma_p") ever reaches the screen.
 * @param {HTMLElement} host
 * @param {string} text label with optional $...$ math segments
 */
export function renderLabel(host, text) {
  const parts = String(text).split(/\$([^$]+)\$/);
  host.replaceChildren();
  parts.forEach((p, i) => {
    if (i % 2 === 0) {
      if (p) host.appendChild(document.createTextNode(p));
    } else {
      const span = document.createElement('span');
      span.className = 'tex-label';
      host.appendChild(span);
      renderTeX(span, p);
    }
  });
}

/**
 * Typeset every element carrying a `data-label` attribute (static HTML
 * readout keys, group titles, table headers). Call once from each tool's
 * main.js after imports.
 */
export function hydrateLabels(root = document) {
  for (const el of root.querySelectorAll('[data-label]')) {
    renderLabel(/** @type {HTMLElement} */ (el), el.getAttribute('data-label') || '');
  }
}

// NB: standalone tex2svg does not inject MathJax's stylesheet; the small
// amount of CSS it needs (hiding the duplicate assistive MathML, container
// display) is shipped statically in lib/style.css instead.

/** Poll for MathJax readiness, then flush queued renderTeX paints. */
function armTeXFlush() {
  const g = /** @type {any} */ (globalThis);
  if (g.__mjxFlushArmed) return;
  g.__mjxFlushArmed = true;
  const tick = () => {
    if (g.MathJax && typeof g.MathJax.tex2svg === 'function') {
      setTimeout(() => { // the extra settle tick — see note above
        g.__mjxSettled = true;
        g.__mjxFlushArmed = false;
        const q = g.__texQueue;
        g.__texQueue = undefined;
        if (q) for (const fn of q.values()) { try { fn(); } catch { /* host gone */ } }
      }, 0);
    } else {
      setTimeout(tick, 40);
    }
  };
  setTimeout(tick, 40);
}
