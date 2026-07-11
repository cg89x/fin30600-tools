// @ts-check
/**
 * rtdb.js — minimal Firebase Realtime Database client over the plain REST
 * interface. No Firebase SDK: reads/writes are `fetch` against
 * `<databaseURL>/<path>.json`, and live subscriptions use `EventSource` —
 * the RTDB REST API speaks server-sent events natively (the stream sends
 * `put` and `patch` events whose data is `{"path": "/...", "data": ...}`;
 * see https://firebase.google.com/docs/database/rest/retrieve-data#section-rest-streaming).
 *
 * The subscription maintains a local mirror of the subtree and hands the
 * whole (immutable-by-convention) tree to the callback after every event.
 * `applyPut` / `applyPatch` are exported so the event plumbing can be
 * desk-checked under node without a network.
 *
 * @module rtdb
 */

/** Normalize a database path: leading slash, no trailing slash. @param {string} p */
function norm(p) {
  return `/${String(p).split('/').filter(Boolean).join('/')}`;
}

/**
 * Apply a streamed `put` event to a local tree: replace the node at `path`
 * with `data` (null deletes). `path` is relative to the subscription root;
 * `"/"` replaces the whole tree.
 * @param {any} tree current local tree (may be null)
 * @param {string} path event path, e.g. "/" or "/rounds/1/guesses/-Nab12"
 * @param {any} data new value at that path (null = delete)
 * @returns {any} the updated tree
 */
export function applyPut(tree, path, data) {
  const keys = String(path).split('/').filter(Boolean);
  if (keys.length === 0) return data;
  const root = (tree && typeof tree === 'object') ? tree : {};
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!node[k] || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  const last = keys[keys.length - 1];
  if (data === null) delete node[last];
  else node[last] = data;
  return root;
}

/**
 * Apply a streamed `patch` event: merge each key of `data` as a child put
 * under `path`.
 * @param {any} tree @param {string} path @param {Record<string, any>} data
 * @returns {any} the updated tree
 */
export function applyPatch(tree, path, data) {
  let out = tree;
  const base = String(path).replace(/\/+$/, '');
  for (const k in data) out = applyPut(out, `${base}/${k}`, data[k]);
  return out;
}

/**
 * Create a tiny RTDB REST client bound to one database URL.
 * NB: requests deliberately send no Content-Type header so they stay
 * "simple" CORS requests (no preflight); the RTDB REST API parses the JSON
 * body regardless.
 * @param {string} databaseURL e.g. "https://myproj-default-rtdb.firebaseio.com"
 */
export function rtdbClient(databaseURL) {
  const base = String(databaseURL).replace(/\/+$/, '');

  /** @param {string} path @param {string} method @param {any} [body] */
  async function request(path, method, body) {
    const res = await fetch(`${base}${norm(path)}.json`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`RTDB ${method} ${path}: HTTP ${res.status}`);
    return res.json();
  }

  return {
    /** Read a node once. @param {string} path */
    get: (path) => request(path, 'GET'),
    /** Replace a node. @param {string} path @param {any} data */
    put: (path, data) => request(path, 'PUT', data),
    /** Merge children into a node. @param {string} path @param {any} data */
    patch: (path, data) => request(path, 'PATCH', data),
    /**
     * Append under a push id. Resolves to the new id (Firebase returns
     * `{"name": "-N..."}`).
     * @param {string} path @param {any} data @returns {Promise<string>}
     */
    post: async (path, data) => {
      const out = await request(path, 'POST', data);
      return out && out.name;
    },
    /**
     * Live-subscribe to a subtree via SSE. `onData(tree)` fires with the
     * full local mirror after every `put`/`patch` event (the first `put`
     * carries the whole subtree — `null` if it does not exist yet).
     * EventSource auto-reconnects on network blips; Firebase then resends a
     * full root `put`, so the mirror self-heals.
     * @param {string} path
     * @param {(tree:any)=>void} onData
     * @param {(status:'open'|'error'|'cancel')=>void} [onStatus]
     * @returns {{close:()=>void}}
     */
    subscribe(path, onData, onStatus) {
      const es = new EventSource(`${base}${norm(path)}.json`);
      let tree = null;
      /** @param {MessageEvent} ev @param {'put'|'patch'} type */
      const handle = (ev, type) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg || typeof msg.path !== 'string') return;
        tree = type === 'put'
          ? applyPut(tree, msg.path, msg.data)
          : applyPatch(tree, msg.path, msg.data);
        onData(tree);
      };
      es.addEventListener('put', (ev) => handle(/** @type {MessageEvent} */ (ev), 'put'));
      es.addEventListener('patch', (ev) => handle(/** @type {MessageEvent} */ (ev), 'patch'));
      // 'keep-alive' events carry null data — nothing to do.
      es.addEventListener('cancel', () => { if (onStatus) onStatus('cancel'); });
      es.addEventListener('auth_revoked', () => { es.close(); if (onStatus) onStatus('error'); });
      es.onopen = () => { if (onStatus) onStatus('open'); };
      es.onerror = () => { if (onStatus) onStatus('error'); };
      return { close: () => es.close() };
    },
  };
}
