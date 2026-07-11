# Implementation plan — executed by opus subagents, orchestrated by Fable

> **Historical build plan (2026-07-10).** This is the one-time task breakdown
> used to build the initial four tools in parallel; it is kept for provenance
> and is **not** maintained. For current conventions see the **README**; for
> the design spec see `DESIGN.md`. References here to "presenter mode" and
> "the four tools" reflect the original build, not the shipped state (presenter
> mode was later removed; a 5th tool, diversification, was added).

Read `docs/DESIGN.md` first; it is the spec. This file assigns tasks.

## Task 0 — Scaffold (runs FIRST, alone)

Build everything the four tool agents depend on:

1. `lib/style.css` — house palette as CSS custom properties (`--blue:#0072B2;
   --gold:#C99700; --navy:#0A234B; --red:#D62728; --grid:#DDDDDD;
   --axis:#666666; --label:#333333`), layout skeleton (header/controls/chart/
   formula strip/footer per DESIGN), presenter-mode class (`html.presenter`)
   scaling type & strokes ~1.4×, responsive stacking under 900 px.
   Font stack: `'Linux Biolinum O', Arial, Helvetica, sans-serif` (webfont
   optional — do NOT block on it; Arial fallback is acceptable).
2. `lib/chart.js` — ES module exporting a `Chart` class: create SVG in a
   container; linear x/y scales; despined axes (left+bottom only) with tick
   labels via formatter callbacks (percent formatter = whole percents); light
   grid; methods: `path(points, opts)`, `point(x, y, opts)`, `text`, `vline/
   hline`, `clear/layer` for cheap re-render, and a simple nearest-point hover
   hook. Keep it ~300 lines, no dependencies.
3. `lib/finmath.js` — every function in DESIGN “Math” section, JSDoc'd,
   decimals convention. Include `mulberry32(seed)`, `randn`, `dirichlet`.
4. `lib/ui.js` — `slider({label, min, max, step, value, fmt, onChange})`
   returning an element with live readout; `numberInput`; `toggle`; small and
   dependency-free.
5. `lib/state.js` — `bindState(defaults, onChange)`: read `location.hash` on
   load, write (debounced 150 ms) on change, `replaceState` not `pushState`.
6. `vendor/katex/` — download a pinned KaTeX release (e.g. 0.16.x) from jsDelivr:
   `katex.min.css`, `katex.min.js`, and the `fonts/` folder. Record version +
   URL + date in `vendor/katex/VERSION.txt`.
7. `index.html` — landing page: navy header “FIN 30600 · Investment Theory —
   Interactive Tools”, subtitle (Notre Dame, Christian Kontz), 4 cards linking
   to the tools (title + one-line description + lecture reference).
8. `tests/finmath.test.js` — `node --test`; MUST include the deck check values
   (two-asset: w=0.6, ρ=+0.2 ⇒ 11.2%, 12.24%; ρ=−0.2 ⇒ 9.99%), y* by hand,
   a 3-asset tangency/MVP case verified against an independently computed
   reference (compute it once with python3+numpy in your sandbox and hard-code
   the expected numbers with a comment showing the numpy snippet), OLS on a
   tiny hand-checked sample, PD check rejects a non-PD matrix.
9. `README.md` — what this is, how to run locally (`python3 -m http.server`),
   how to deploy (push to main), repo conventions.
10. Verify: `node --test tests/` all green; `node --check` every JS file.

## Tasks 1–4 — Tools (run in PARALLEL after Task 0)

Each agent: read `docs/DESIGN.md` (your tool's section + house style +
cross-cutting behaviors), read the actual `lib/*.js` source before coding
against it, and read the relevant lecture content file(s) for slide fidelity:

- Task 1 `tools/two-asset/` — read
  `…/FIN30600 - Investments/Lectures/Lecture 3/content/sec4_tworisky.tex`
- Task 2 `tools/capital-allocation/` — read `sec2_riskpref.tex` +
  `sec3_capalloc.tex` (same folder); take slide default numbers from there.
- Task 3 `tools/efficient-frontier/` — read `sec5_manyassets.tex`; use its
  example assets if present, else DESIGN's presets.
- Task 4 `tools/capm-sml/` — read
  `…/Lectures/Lecture 4/content/sec2_capm.tex` + `sec3_marketmodel.tex`.

Lecture tree root:
`/Users/ChristianKontz/Library/CloudStorage/Dropbox/Teaching/Notre Dame/FIN30600 - Investments/`
(READ-ONLY — never write there.)

Deliverables per tool: `index.html` + `main.js` (split further only if a file
would exceed ~400 lines), wired to lib components, URL-hash state, presenter
mode, KaTeX formula strip with live-substituted numbers, house axis labels.
If a lib function is missing/buggy, fix it in `lib/` AND extend
`tests/finmath.test.js`; keep changes additive (other agents run in parallel —
do not rename or change signatures of existing lib exports).
Verify: `node --check` your JS; `node --test tests/` still green; then render
your page with a headless sanity check if available, else desk-check the DOM
wiring carefully. Report: what you built, slide numbers used, any lib changes,
anything you could not verify.

## Task 5 — QA + deploy (Fable, main session)

Serve locally, browser-QA all four tools against DESIGN's verification list,
fix or dispatch fixes, then: commit history tidy, `gh repo create
fin30600-tools --public`, push, enable Pages (deploy from `main`, root),
smoke-test the live URLs, add pointers to course CLAUDE.md + memory.
