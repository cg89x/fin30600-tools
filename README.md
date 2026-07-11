# FIN 30600 · Investment Theory — Interactive Tools

Browser-based interactive explorers accompanying the FIN 30600 (Investment
Theory, University of Notre Dame — Christian Kontz) lecture decks. They cover
Portfolio Theory (L3), CAPM (L4), Behavioral Finance (L6), Fixed Income (L7),
and Derivatives (L8), and are meant to be driven live on the classroom
projector **and** used by students on their own laptops (linked from Canvas).

This is a **static site with zero build step**: plain HTML + ES-module
JavaScript, no framework, no bundler, no npm install. The only third-party
dependency is [MathJax](https://www.mathjax.org/) v3 (tex-svg-full bundle), self-hosted in `vendor/`.

> Working on this repo with Claude? Start with [`CLAUDE.md`](CLAUDE.md)
> (operating guide + invariants) and [`MEMORY.md`](MEMORY.md) (living state log,
> kept current each change).

## The tools

| Tool | Lecture | What it does |
|------|---------|--------------|
| [`tools/two-asset/`](tools/two-asset/) | L3 §4 | Two-asset opportunity set as ρ and weight vary; minimum-variance portfolio. |
| [`tools/capital-allocation/`](tools/capital-allocation/) | L3 §2–3 | CAL from the risk-free asset through a risky portfolio; utility and optimal w*. |
| [`tools/efficient-frontier/`](tools/efficient-frontier/) | L3 §5 | N-asset minimum-variance frontier, global MVP, and max-Sharpe tangency. |
| [`tools/capm-sml/`](tools/capm-sml/) | L4 §2–3 | Security market line + alpha, and a simulated market-model OLS regression. |
| [`tools/diversification/`](tools/diversification/) | L4 App. | Equal-weight portfolio risk vs. N: the 1/N term vanishes, correlation sets the systematic floor (web version of PortfolioVarianceAndDiversification.xlsx). |
| [`tools/beauty-contest/`](tools/beauty-contest/) | L6 §3 | The 2/3-of-the-average game, live in class: students submit by QR code (Firebase RTDB via plain REST/SSE — see its SETUP.md), instructor screen reveals mean/target/winner per round; built-in simulation mode needs no backend. |
| [`tools/duration/`](tools/duration/) | L7 §3–4 | Price–yield curve with the duration tangent vs. exact repricing, the PV cash-flow fulcrum at t = D, and spot-curve/forward-rate pricing. |
| [`tools/black-scholes/`](tools/black-scholes/) | L8 §3–4 | Black–Scholes calls and puts: intrinsic vs. time value, delta hedge ratio, comparative statics in σ and T, put–call parity (deck's discrete-rate form). |

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
hand-checked OLS sample, the Cholesky positive-definite guard, the
diversification workbook formulas (`ewVarUncorrelated`/`ewVarCommonCorr`
against `PortfolioVarianceAndDiversification.xlsx`), Black–Scholes (the
10.4506/5.5735 textbook case, deck put–call parity anchors $3.29 and $0.35),
and the bond math (price/duration hand-computed case, the deck's −D·Δy/(1+y)
anchor of +1.16%, forward rates).

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
│   ├── style.css           house palette + deck-matched theme + layout skeleton
│   ├── chart.js            hand-rolled SVG chart helper (despined axes)
│   ├── finmath.js          ALL finance/numerical math (pure, unit-tested)
│   ├── ui.js               slider / number-input / toggle components + renderTeX
│   └── state.js            URL-hash state (bookmarkable configs)
├── vendor/
│   ├── mathjax/            self-hosted MathJax 3.2.2 (tex-svg-full.js, single file)
│   ├── fonts/              self-hosted Libertinus Sans/Serif woff2 (SIL OFL)
│   └── qrcode/             qrcode-generator 1.4.4 (MIT) — beauty-contest QR codes
├── tools/                  one folder per explorer (index.html + main.js)
├── tests/finmath.test.js   node --test, zero dependencies
└── docs/                   DESIGN.md, PLAN.md
```

## Conventions (for tool authors)

- **`lib/finmath.js` works in decimals everywhere** — 8% is `0.08`, never `8`.
  Only the UI formats decimals into whole-percent strings for display.
- **Import only `lib/*` and MathJax.** Tools never import each other.
- **MathJax is a global, not a module.** Each tool page sets `window.MathJax`
  (config: `startup.typeset:false`, `svg.fontCache:'local'`) then loads
  `vendor/mathjax/tex-svg-full.js` deferred (the FULL bundle — the base bundle
  autoloads extensions like `	extcolor` over the network, which a self-hosted
  single file cannot serve). `lib/ui.js`
  exports a `renderTeX(host, tex)` convenience wrapper with a text fallback.
- **House palette** (CSS custom properties in `style.css`): BLUE `#0072B2`
  primary series, GOLD `#C99700` secondary, NAVY `#0A234B` chrome, metallic
  gold `#AE9142` (`--goldmetal`) for chrome accents (formula-strip rule, card
  tops, section rules), dashed RED `#D62728` reference lines only, grey
  `#DDDDDD` grid.
- **Deck-matched theme**: the site mirrors the beamer lecture template
  (`ndcollegiate.sty`). Body text is **Libertinus Sans** and display titles
  are **Libertinus Serif** navy (self-hosted woff2 in `vendor/fonts/`, SIL
  OFL); the page header is a white letterhead (gold vertical rule + grey
  letterspaced eyebrow + serif title). **Chart/SVG text stays Arial**
  (`--font-chart`) to match the lecture *figures* — never the body font.
- **Axis labels** (Christian's standing rules): the σ axis is labeled exactly
  **"Standard Deviation"**, the expected-return axis exactly **"Expected
  Return"** (singular, spelled out). Percent ticks are whole percents (`30%`,
  never `0.30` or `30.0%`) — use `pct` from `chart.js`.
- **Line & label scaling** — `chart.js` sets every stroke width as an inline
  style `calc(<w>px * var(--stroke-scale, 1))`, and tick/axis-title/datalabel
  font sizes also carry the `--stroke-scale` factor. Scale a whole chart up
  for the projector by setting `--stroke-scale` on its `.chart-box` (e.g. the
  diversification tool uses `1.5`); override the per-element `font-size` back
  if you want thicker lines but base-size labels.
  **Never add a `stroke-width` rule for `.series`/`.refline` to `style.css`** —
  a stylesheet rule beats the inline attribute and silently pins every curve
  to one width (this bug shipped once; that's why widths are inline styles now).
- **State in the URL hash**: every control serializes into `#key=val` pairs
  (debounced `replaceState`) via `lib/state.js`, so any configuration is a
  shareable, reload-stable link. All randomness runs through a seeded PRNG
  (`mulberry32`) whose seed is part of that state.
