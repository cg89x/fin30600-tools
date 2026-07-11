// @ts-check
/**
 * state.js — bookmarkable URL-hash state for the FIN 30600 tools.
 *
 * `bindState(defaults, onChange)` reads `location.hash` on load (values there
 * override the defaults), and returns a small store. Writing a value updates
 * the store and, debounced (150 ms), rewrites the hash with `replaceState`
 * (never `pushState` — we don't want every slider tick in the back-button
 * history). Any configuration is therefore a shareable/reloadable link.
 *
 * Encoding is a compact `key=val&key=val` string in the hash. Values are typed
 * by their default: numbers parse as numbers, booleans as `1`/`0`, everything
 * else stays a string. Presenter mode's `present` flag is handled by tools
 * directly (it is read from the query string per DESIGN), not here.
 *
 * @module state
 */

/**
 * @typedef {Record<string, number|boolean|string>} StateObject
 */

/**
 * Parse `location.hash` into a plain object, coercing each value to the type of
 * the matching default.
 * @param {StateObject} defaults
 * @param {string} hash raw hash string (with or without leading '#')
 * @returns {StateObject}
 */
export function parseHash(defaults, hash) {
  const out = { ...defaults };
  const raw = hash.replace(/^#/, '');
  if (!raw) return out;
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = decodeURIComponent(pair.slice(0, eq));
    const val = decodeURIComponent(pair.slice(eq + 1));
    if (!(key in defaults)) continue;
    const def = defaults[key];
    if (typeof def === 'number') {
      const n = Number(val);
      if (!Number.isNaN(n)) out[key] = n;
    } else if (typeof def === 'boolean') {
      out[key] = val === '1' || val === 'true';
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Serialize a state object into a compact hash string (no leading '#').
 * Only keys present in `defaults` are written, and values equal to their
 * default are omitted to keep shared URLs short.
 * @param {StateObject} state
 * @param {StateObject} defaults
 * @returns {string}
 */
export function encodeHash(state, defaults) {
  const parts = [];
  for (const key of Object.keys(defaults)) {
    const v = state[key];
    if (v === undefined || v === defaults[key]) continue;
    let s;
    if (typeof v === 'boolean') s = v ? '1' : '0';
    else s = String(v);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(s)}`);
  }
  return parts.join('&');
}

/**
 * Bind a debounced URL-hash-backed state store.
 * @param {StateObject} defaults default values (also define each key's type)
 * @param {(state:StateObject)=>void} [onChange] called after each `set`/`patch`
 * @param {object} [opts]
 * @param {number} [opts.debounce=150] ms to debounce the hash write
 * @returns {{
 *   state: StateObject,
 *   get: (k:string)=>number|boolean|string,
 *   set: (k:string, v:number|boolean|string)=>void,
 *   patch: (obj:Partial<StateObject>)=>void,
 *   flush: ()=>void
 * }}
 */
export function bindState(defaults, onChange, opts = {}) {
  const debounceMs = opts.debounce ?? 150;
  const hasWindow = typeof location !== 'undefined';
  const state = hasWindow ? parseHash(defaults, location.hash) : { ...defaults };
  let timer = null;

  function writeHash() {
    if (!hasWindow) return;
    const enc = encodeHash(state, defaults);
    const url = `${location.pathname}${location.search}${enc ? '#' + enc : '#'}`;
    history.replaceState(null, '', url);
  }

  function scheduleWrite() {
    if (!hasWindow) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; writeHash(); }, debounceMs);
  }

  function set(k, v) {
    if (!(k in defaults)) return;
    state[k] = v;
    if (onChange) onChange(state);
    scheduleWrite();
  }

  function patch(obj) {
    for (const k in obj) {
      if (k in defaults && obj[k] !== undefined) state[k] = /** @type {any} */ (obj[k]);
    }
    if (onChange) onChange(state);
    scheduleWrite();
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    writeHash();
  }

  return {
    state,
    get: (k) => state[k],
    set,
    patch,
    flush,
  };
}
