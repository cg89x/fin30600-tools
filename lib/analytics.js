// @ts-check
/**
 * analytics.js — anonymous visit counts via GoatCounter (goatcounter.com).
 *
 * Every page loads this module (a <script type="module"> tag in its <head>).
 * GoatCounter sets no cookies and stores no personal data: it counts page
 * views and unique visitors per path, with the referrer (Canvas, QR code …),
 * browser, screen size and country. The URL hash — where the tools keep their
 * control state — is never sent, so all views of one tool count as one page.
 *
 * Not counted: local previews (localhost — count.js skips them itself) and
 * the instructor's `#preview` bypass.
 *
 * Dashboard: https://<GOATCOUNTER_CODE>.goatcounter.com (Christian's account).
 * Set GOATCOUNTER_CODE to '' to switch tracking off.
 */

export const GOATCOUNTER_CODE = '';

const PREVIEW_RE = /(^#|[#&])preview(=|&|$)/; // same test as releases.js

if (GOATCOUNTER_CODE && !PREVIEW_RE.test(location.hash)) {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  document.head.appendChild(s);
}
