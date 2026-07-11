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
  label.textContent = cfg.label;
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
  label.textContent = cfg.label;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(cfg.value);
  if (cfg.min !== undefined) input.min = String(cfg.min);
  if (cfg.max !== undefined) input.max = String(cfg.max);
  if (cfg.step !== undefined) input.step = String(cfg.step);
  input.className = 'ctrl-numinput';

  const fire = () => { if (cfg.onChange) cfg.onChange(Number(input.value)); };
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
  span.textContent = cfg.label;

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
 * Convenience: render a KaTeX string into an element using the global `katex`
 * (loaded via <script> from vendor/). No-op with a plain-text fallback if
 * KaTeX has not loaded. Kept here so tools share one call site.
 * @param {HTMLElement} host element to render into
 * @param {string} tex TeX source
 * @param {object} [opts] passed to katex.render (displayMode etc.)
 */
export function renderTeX(host, tex, opts = {}) {
  const g = /** @type {any} */ (globalThis);
  if (g.katex && typeof g.katex.render === 'function') {
    g.katex.render(tex, host, { throwOnError: false, ...opts });
  } else {
    host.textContent = tex;
  }
}
