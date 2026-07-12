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
 * else stays a string.
 *
 * Numeric values coming from the hash are UNTRUSTED (URLs are shared and
 * hand-edited): they are required to be finite and, when the tool passes
 * `bounds`, clamped to the control's range — a crafted `#ny=1e9` must never
 * freeze a student's tab or mark a wrong point as "optimal".
 *
 * @module state
 */

/** Same pattern releases.js uses for the instructor bypass flag. */
const PREVIEW_RE = /(^#|[#&])preview(=|&|$)/;

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

/**
 * @typedef {Record<string, number|boolean|string>} StateObject
 */

/**
 * Clamp a numeric value into a tool-declared `[min, max]` range (either end
 * may be omitted / non-finite to leave that side open).
 * @param {number} n
 * @param {[number, number]|undefined} range
 * @returns {number}
 */
function clampTo(n, range) {
  if (!range) return n;
  const [lo, hi] = range;
  if (Number.isFinite(lo) && n < lo) return lo;
  if (Number.isFinite(hi) && n > hi) return hi;
  return n;
}

/**
 * Parse `location.hash` into a plain object, coercing each value to the type of
 * the matching default. Malformed percent-escapes, non-finite numbers, and
 * empty values fall back to the default instead of throwing or poisoning the
 * state; numeric values clamp to `bounds` when provided.
 * @param {StateObject} defaults
 * @param {string} hash raw hash string (with or without leading '#')
 * @param {Record<string, [number, number]>} [bounds] per-key numeric ranges
 * @returns {StateObject}
 */
export function parseHash(defaults, hash, bounds = {}) {
  const out = { ...defaults };
  const raw = hash.replace(/^#/, '');
  if (!raw) return out;
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = safeDecode(pair.slice(0, eq));
    if (key === null || !(key in defaults)) continue;
    const val = safeDecode(pair.slice(eq + 1));
    if (val === null || val === '') continue;
    const def = defaults[key];
    if (typeof def === 'number') {
      const n = Number(val);
      if (Number.isFinite(n)) out[key] = clampTo(n, bounds[key]);
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
 * @param {Record<string, [number, number]>} [opts.bounds] per-key numeric
 *   ranges (mirror each control's min/max) — enforced on hash parse AND on
 *   every `set`/`patch`, so neither a crafted URL nor a typed-in number can
 *   push a key outside its control's range
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
  const bounds = opts.bounds ?? {};
  const hasWindow = typeof location !== 'undefined';
  const state = hasWindow ? parseHash(defaults, location.hash, bounds) : { ...defaults };
  let timer = null;
  // The instructor `#preview` bypass (releases.js) must survive state writes:
  // without this, the first slider tick rewrites the hash without it and a
  // reload mid-class hits the lock screen.
  const keepPreview = hasWindow && PREVIEW_RE.test(location.hash);

  function sanitize(k, v) {
    if (typeof defaults[k] !== 'number') return v;
    const n = Number(v);
    return Number.isFinite(n) ? clampTo(n, bounds[k]) : defaults[k];
  }

  function writeHash() {
    if (!hasWindow) return;
    let enc = encodeHash(state, defaults);
    if (keepPreview) enc = enc ? `${enc}&preview` : 'preview';
    const url = `${location.pathname}${location.search}${enc ? '#' + enc : ''}`;
    history.replaceState(null, '', url);
  }

  function scheduleWrite() {
    if (!hasWindow) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; writeHash(); }, debounceMs);
  }

  function set(k, v) {
    if (!(k in defaults)) return;
    state[k] = sanitize(k, v);
    if (onChange) onChange(state);
    scheduleWrite();
  }

  function patch(obj) {
    for (const k in obj) {
      if (k in defaults && obj[k] !== undefined) state[k] = /** @type {any} */ (sanitize(k, obj[k]));
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
