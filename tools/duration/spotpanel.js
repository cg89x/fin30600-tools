// @ts-check
/**
 * Spot-curve / forward-rate panel for the duration & bond pricing explorer
 * (FIN 30600, Topic 7 §3, sec3_term.tex).
 *
 * Number inputs for the spot (zero-coupon) rates y_1..y_5; a table of the
 * implied one-year forward rates between adjacent years using the deck's
 * notation f_t^n (the n-period forward starting in t periods, so the 1-year
 * forward covering year t+1 is f_t^1); and an illustrative 5-year annual-
 * coupon bond priced OFF THE CURVE via bondPriceFromSpots, with its
 * curve-implied YTM recovered by bisection on bondPrice.
 *
 * Default spots 1%..5% for years 1..5 come from the course workbook
 * YieldCurve_ForwardRate_Examples.xlsx (column "yt").
 *
 * Self-contained: it shares the tool's single URL-hash store (keys s1..s5,
 * sc) but has its own controls and render cycle, so it never fights the main
 * bond controls.
 */

import { bondPrice, forwardRate, bondPriceFromSpots } from '../../lib/finmath.js';
import { numberInput, renderTeX, renderLabel } from '../../lib/ui.js';

const FACE = 1000;
const SPOT_KEYS = ['s1', 's2', 's3', 's4', 's5'];

/** Percent string with 2 decimals from a decimal: 0.0301 -> "3.01%". */
function pct2(v) {
  return `${(v * 100).toFixed(2)}%`;
}

/**
 * Curve-implied YTM: the flat yield at which bondPrice matches the price off
 * the spot curve. bondPrice is strictly decreasing in y, so plain bisection.
 * @param {number} couponRate decimal
 * @param {number} n years
 * @param {number} target price to match
 * @returns {number} YTM (decimal)
 */
function impliedYtm(couponRate, n, target) {
  let lo = 0.000001;
  let hi = 1.0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (bondPrice(couponRate, mid, n, FACE) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Build and wire the panel. Call once from main.js.
 * @param {{state: Record<string, number|boolean|string>, set: (k:string, v:number)=>void}} store
 */
export function initSpotPanel(store) {
  const S = store.state;

  /** Current spots as decimals. @returns {number[]} */
  const spots = () => SPOT_KEYS.map((k) => Number(S[k]) / 100);

  /* ------------------------------------------------------ static formula -- */
  renderTeX(
    /** @type {HTMLElement} */ (document.getElementById('spot-formula')),
    `(1+f_t^1) = \\frac{(1+y_{t+1})^{t+1}}{(1+y_t)^{t}}` +
    `\\qquad\\qquad P = \\sum_{t=1}^{5}\\frac{\\text{CF}_t}{(1+y_t)^{t}}`,
  );

  /* -------------------------------------------------------------- inputs -- */
  const inputHost = /** @type {HTMLElement} */ (document.getElementById('spot-inputs'));
  SPOT_KEYS.forEach((key, i) => {
    const ctrl = numberInput({
      label: `Spot rate $y_{${i + 1}}$ (%)`,
      value: Number(S[key]),
      min: 0, max: 15, step: 0.1,
      onChange: (v) => {
        if (!Number.isFinite(v)) return;
        store.set(key, Math.min(15, Math.max(0, v)));
        render();
      },
    });
    inputHost.appendChild(ctrl);
  });

  const couponCtrl = numberInput({
    label: 'Coupon of the 5-year bond (%)',
    value: Number(S.sc),
    min: 0, max: 15, step: 0.5,
    onChange: (v) => {
      if (!Number.isFinite(v)) return;
      store.set('sc', Math.min(15, Math.max(0, v)));
      render();
    },
  });
  /** @type {HTMLElement} */ (document.getElementById('spot-coupon')).appendChild(couponCtrl);

  /* ------------------------------------------------------- table + cards -- */
  const tableHost = /** @type {HTMLElement} */ (document.getElementById('fwd-table-host'));
  const readoutHost = /** @type {HTMLElement} */ (document.getElementById('spot-readouts'));

  function render() {
    const s = spots();

    // forward-rate table: year t | spot y_t | 1-yr forward f_{t-1}^1 into t
    const table = document.createElement('table');
    table.className = 'fwd-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const h of ['Year $t$', 'Spot $y_t$', 'Forward $f_{t-1}^{1}$']) {
      const th = document.createElement('th');
      renderLabel(th, h);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (let t = 1; t <= 5; t++) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = String(t);
      const td2 = document.createElement('td');
      td2.className = 'spot';
      td2.textContent = pct2(s[t - 1]);
      const td3 = document.createElement('td');
      if (t === 1) {
        td3.textContent = '—';
      } else {
        td3.className = 'fwd';
        td3.textContent = pct2(forwardRate(s[t - 2], t - 1, s[t - 1], t));
      }
      tr.append(td1, td2, td3);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableHost.replaceChildren(table);

    // price the illustrative 5-year bond off the curve + curve-implied YTM
    const cpn = Number(S.sc) / 100;
    const price = bondPriceFromSpots(cpn, s, FACE);
    const ytm = impliedYtm(cpn, 5, price);
    const rows = [
      ['Price off the curve $P$', `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'blue'],
      ['Curve-implied YTM', pct2(ytm), 'gold'],
    ];
    readoutHost.replaceChildren();
    for (const [k, v, cls] of rows) {
      const cell = document.createElement('div');
      cell.className = 'readout';
      const key = document.createElement('div');
      key.className = 'k';
      renderLabel(key, /** @type {string} */ (k));
      const val = document.createElement('div');
      val.className = `v ${cls}`;
      val.textContent = /** @type {string} */ (v);
      cell.append(key, val);
      readoutHost.appendChild(cell);
    }
  }

  render();
}
