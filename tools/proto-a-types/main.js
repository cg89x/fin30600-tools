// @ts-check
/**
 * PROTOTYPE A2 — Order Types: price certainty vs execution certainty
 * (Direction A: Split & Focus). LOCAL-ONLY design prototype: no release
 * gate, no URL-hash state — plain local variables. Adapted from
 * tools/order-book/main.js (panel 2 only); ./paths.js is a verbatim copy of
 * tools/order-book/paths.js (tools never import each other).
 *
 * One resting limit/stop order against a seeded random-walk price path with
 * occasional ±$1 jumps (default seed 212: the price gaps from $55.13 through
 * a $54.50 stop-loss and the market sell prints at $53.90). The static-quote
 * Part A was removed at Christian's request (2026-07-12).
 */

import { Chart, fixed } from '../../lib/chart.js';
import { renderLabel, hydrateLabels } from '../../lib/ui.js';
import { makePath, evalRestingOrder, PATH_OPTS } from './paths.js';

hydrateLabels();

/* -------------------------------------------------------------- state ---- */
// Plain local state (prototype: deliberately NOT hash-backed).
const S = {
  ob: 'sl',    // resting order type
  pb: 54.5,    // limit/trigger price
  seed: 212,   // path seed — 212 gaps from $55.13 THROUGH the $54.50
               // stop at bar 30 and prints $53.90 (the gap-risk preset)
};

/* ------------------------------------------------------------ helpers ---- */
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** "$55.25" — dollars with cents. @param {number} v */
const usd2 = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/**
 * Minimal labeled <select> control (ui.js has no select factory).
 * @param {{label:string, options:{v:string,label:string}[], value:string,
 *          onChange:(v:string)=>void}} cfg
 */
function selectCtrl(cfg) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-number';
  const lab = document.createElement('label');
  lab.className = 'ctrl-label';
  renderLabel(lab, cfg.label);
  const sel = document.createElement('select');
  sel.className = 'ctrl-numinput ctrl-select';
  for (const o of cfg.options) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = cfg.value;
  sel.addEventListener('change', () => cfg.onChange(sel.value));
  wrap.append(lab, sel);
  // @ts-ignore augmenting
  wrap.set = (v) => { sel.value = v; };
  return wrap;
}

/* ------------------------------ moving price ----------------------------- */
const pathChart = new Chart($('path-chart'), {
  width: 980,
  height: 400,
  margin: { top: 18, right: 22, bottom: 48, left: 74 },
  xLabel: 'Time (bars)',
  yLabel: 'Price',
  xFmt: fixed(0),
  yFmt: usd2,
});

let pathDomainKey = '';
function renderPathPanel() {
  const type = /** @type {'lb'|'ls'|'sl'|'sb'} */ (String(S.ob));
  const price = Number(S.pb);
  const path = makePath(Number(S.seed));
  const res = evalRestingOrder(path, type, price);

  const lo = Math.min(...path, price) - 0.35;
  const hi = Math.max(...path, price) + 0.35;
  const key = `${lo.toFixed(2)}|${hi.toFixed(2)}`;
  if (key !== pathDomainKey) {
    pathDomainKey = key;
    pathChart.setDomain(0, PATH_OPTS.n, lo, hi)
      .renderAxes({ xTicks: [0, 15, 30, 45, 60, 75, 90], yTickCount: 6 });
  }
  pathChart.clearData();

  const isLimit = type === 'lb' || type === 'ls';
  const isSell = type === 'ls' || type === 'sl';

  // the order price: RED dashed refline
  pathChart.hline(price, { stroke: 'var(--red)', dash: '7 5', width: 1.8, opacity: 0.9 });
  pathChart.text(PATH_OPTS.n - 1, price, `${isLimit ? 'limit' : 'stop'} ${usd2(price)}`, {
    anchor: 'end', dy: isSell ? 16 : -8, fill: 'var(--red)',
  });

  // the price path: BLUE
  pathChart.path(path.map((p, t) => ({ x: t, y: p })), { stroke: 'var(--blue)', width: 2.2 });

  // first bar that executes: gold dot + label
  let outcome;
  if (res.hit) {
    const t = /** @type {number} */ (res.index);
    const exec = /** @type {number} */ (res.exec);
    pathChart.vline(t, { stroke: 'var(--axis)', dash: '3 4', width: 1, opacity: 0.5 });
    pathChart.point(t, exec, { r: 6.5, fill: 'var(--gold)', stroke: '#fff' });
    const right = t > PATH_OPTS.n * 0.62;
    const lblTxt = res.immediate
      ? `marketable now @ ${usd2(exec)}`
      : isLimit
        ? `filled @ ${usd2(exec)}`
        : `${type === 'sl' ? 'stopped out' : 'bought'} @ ${usd2(exec)}`;
    pathChart.text(t, exec, lblTxt, {
      dx: right ? -12 : 12, dy: isSell ? 20 : -10,
      anchor: right ? 'end' : 'start', fill: 'var(--gold)',
    });

    // outcome sentence
    const T = usd2(price);
    const X = usd2(exec);
    if (res.immediate) {
      outcome = `<b>Immediately marketable</b>: at bar 0 the price (${usd2(path[0])}) is already `
        + `at or past your ${isLimit ? 'limit' : 'trigger'} of ${T} — the order executes right `
        + `away at <b>${X}</b>. Move the price further from ${usd2(path[0])} to leave the order resting.`;
    } else if (isLimit) {
      outcome = `<span class="exec-yes">Filled at bar ${t}</span>: the price traded `
        + `${type === 'lb' ? 'down to' : 'up to'} your limit — you ${type === 'lb' ? 'buy' : 'sell'} `
        + `at <b>${X}</b>, the limit price or better. (Until that bar the order simply rested in the book.)`;
    } else {
      const gap = res.gap ?? 0;
      const worse = type === 'sl' ? 'below' : 'above';
      let gapTxt;
      if (gap > 0.3) { // a jump carried the price straight through the trigger
        gapTxt = ` The price <b>gapped through the trigger</b>: the market `
          + `${type === 'sl' ? 'sell' : 'buy'} executed ${usd2(gap)} ${worse} the trigger — `
          + `a stop caps nothing; it only fires a market order at whatever price comes next.`;
      } else if (gap > 0.005) {
        gapTxt = ` Execution came in ${usd2(gap)} ${worse} the trigger: a stop fires a `
          + `market order at the crossing price, not at the trigger itself.`;
      } else {
        gapTxt = ` Execution landed right at the trigger this time — no slippage.`;
      }
      outcome = type === 'sl'
        ? `<span class="exec-no">Stopped out at ${X}</span> on a ${T} stop (bar ${t}).${gapTxt}`
        : `<span class="exec-yes">Triggered at bar ${t}</span>: bought at <b>${X}</b> on a ${T} stop-buy.${gapTxt}`;
    }
  } else {
    outcome = `<b>Never executes</b> in this window: the price never `
      + `${isLimit ? 'reaches your limit' : 'crosses your trigger'} of ${usd2(price)}. `
      + `Limit and stop orders remove price uncertainty — but execution is not guaranteed.`;
  }
  $('qb-result').innerHTML = outcome;
}

const obCtrl = selectCtrl({
  label: 'Resting order',
  options: [
    { v: 'lb', label: 'limit buy' },
    { v: 'ls', label: 'limit sell' },
    { v: 'sl', label: 'stop-loss sell' },
    { v: 'sb', label: 'stop-buy' },
  ],
  value: String(S.ob),
  onChange: (v) => { S.ob = v; renderPathPanel(); },
});
$('ctrl-ob').appendChild(obCtrl);

{
  const wrap = document.createElement('div');
  wrap.className = 'ctrl ctrl-number';
  const lab = document.createElement('label');
  lab.className = 'ctrl-label';
  lab.textContent = 'Limit / trigger price';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'ctrl-numinput';
  input.step = '0.05';
  input.min = '0';
  input.value = Number(S.pb).toFixed(2);
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    S.pb = n;
    renderPathPanel();
  });
  wrap.append(lab, input);
  $('ctrl-pb').appendChild(wrap);
}

$('btn-path').addEventListener('click', () => {
  S.seed = ((Number(S.seed) || 0) + 1) >>> 0;
  renderPathPanel();
});

/* ------------------------------------------------------------- startup --- */
renderPathPanel();
