# FIN 30600 · Investment Theory — Interactive Tools

Browser-based interactive explorers accompanying the FIN 30600 (Investment
Theory, University of Notre Dame — Christian Kontz) lecture decks. They cover
Portfolio Theory (Lecture 3) and CAPM (Lecture 4), and are meant to be driven
live on the classroom projector **and** used by students on their own laptops
(linked from Canvas).

This is a **static site with zero build step**: plain HTML + ES-module
JavaScript, no framework, no bundler, no npm install. The only third-party
dependency is [KaTeX](https://katex.org/), self-hosted in `vendor/`.

## The tools

| Tool | Lecture | What it does |
|------|---------|--------------|
| [`tools/two-asset/`](tools/two-asset/) | L3 §4 | Two-asset opportunity set as ρ and weight vary; minimum-variance portfolio. |
| [`tools/capital-allocation/`](tools/capital-allocation/) | L3 §2–3 | CAL from the risk-free asset through a risky portfolio; utility and optimal y*. |
| [`tools/efficient-frontier/`](tools/efficient-frontier/) | L3 §5 | N-asset minimum-variance frontier, global MVP, and max-Sharpe tangency. |
| [`tools/capm-sml/`](tools/capm-sml/) | L4 §2–3 | Security market line + alpha, and a simulated market-model OLS regression. |

The four tool folders are built by separate agents; the landing page
(`index.html`) links to all four whether or not they exist yet.

## Run locally

No install step. Serve the repo root over HTTP (ES modules and `fetch` need a
real origin — opening `index.html` as a `file://` URL will not work):

```bash
cd fin30600-tools
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Run the tests

Pure `node --test`, zero dependencies. Any of these work:

```bash
node --test                    # auto-discovers tests/
node --test tests/*.test.js    # explicit glob
node --test tests/finmath.test.js
```

`tests/finmath.test.js` checks the finance math against the lecture decks'
worked numbers (two-asset ρ=±0.2 example, CAL y*, the ρ=0/−1 MVP special
cases), a 3-asset MVP/tangency case cross-checked against an independent
numpy computation (the snippet + its output are pasted in the test file), a
hand-checked OLS sample, and the Cholesky positive-definite guard.

Syntax-check every module with:

```bash
for f in lib/*.js tests/*.js; do node --check "$f"; done
```

> Note: `node --test tests/` (bare directory with a trailing slash) is **not**
> reliable under Node 25 — it tries to load `tests` as a module. Use one of the
> forms above.

## Deploy

Hosted on GitHub Pages from `main`, served at the repo root. Deploy is just:

```bash
git push
```

Everything is relative-path linked, so it works from any base path (a project
Pages site under `/fin30600-tools/` or a user site at the root).

## Repo layout

```
fin30600-tools/
├── index.html              landing page (course header + one card per tool)
├── lib/
│   ├── style.css           house palette + layout skeleton + presenter mode
│   ├── chart.js            hand-rolled SVG chart helper (despined axes)
│   ├── finmath.js          ALL finance/numerical math (pure, unit-tested)
│   ├── ui.js               slider / number-input / toggle components
│   └── state.js            URL-hash state (bookmarkable configs)
├── vendor/katex/           self-hosted KaTeX 0.16.11 (css, js, fonts/)
├── tools/                  one folder per explorer (index.html + main.js)
├── tests/finmath.test.js   node --test, zero dependencies
└── docs/                   DESIGN.md, PLAN.md
```

## Conventions (for tool authors)

- **`lib/finmath.js` works in decimals everywhere** — 8% is `0.08`, never `8`.
  Only the UI formats decimals into whole-percent strings for display.
- **Import only `lib/*` and KaTeX.** Tools never import each other.
- **KaTeX is a global, not a module.** Load it with a `<script>`/`<link>` pair
  (see `vendor/katex/VERSION.txt`); it exposes `window.katex`. `lib/ui.js`
  exports a `renderTeX(host, tex)` convenience wrapper with a text fallback.
- **House palette** (CSS custom properties in `style.css`): BLUE `#0072B2`
  primary series, GOLD `#C99700` secondary, NAVY `#0A234B` chrome, dashed RED
  `#D62728` reference lines only, grey `#DDDDDD` grid.
- **Axis labels** (Christian's standing rules): the σ axis is labeled exactly
  **"Standard Deviation"**, the expected-return axis exactly **"Expected
  Return"** (singular, spelled out). Percent ticks are whole percents (`30%`,
  never `0.30` or `30.0%`) — use `pct` from `chart.js`.
- **Presenter mode**: adding `class="presenter"` to `<html>` (button toggle or
  `?present=1`) scales type, strokes, and point radii ~1.4× for the projector.
- **State in the URL hash**: every control serializes into `#key=val` pairs
  (debounced `replaceState`) via `lib/state.js`, so any configuration is a
  shareable, reload-stable link. All randomness runs through a seeded PRNG
  (`mulberry32`) whose seed is part of that state.
