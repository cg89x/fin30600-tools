# FIN 30600 · Investment Theory — Interactive Tools

Browser-based interactive explorers accompanying the FIN 30600 (Investment
Theory, University of Notre Dame — Christian Kontz) lecture decks. They cover
Returns & Fees (L1), Securities Trading (L2), Portfolio Theory (L3), CAPM
(L4), Factor Models (L5), Behavioral Finance (L6), Fixed Income (L7), and
Derivatives (L8), and
are meant to be driven live on the classroom projector **and** used by
students on their own laptops (linked from Canvas).

This is a **static site with zero build step**: plain HTML + ES-module
JavaScript, no framework, no bundler, no npm install. The only third-party
code is [MathJax](https://www.mathjax.org/) v3 (tex-svg-full bundle, Apache-2.0)
and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4
(MIT), both self-hosted in `vendor/` alongside the Libertinus webfonts (SIL
OFL 1.1); license texts sit next to each. The beauty-contest tool optionally
talks to a Firebase Realtime Database (plain REST/SSE, no SDK).

> Working on this repo with Claude? Start with [`CLAUDE.md`](CLAUDE.md)
> (operating guide + invariants) and [`MEMORY.md`](MEMORY.md) (living state log,
> kept current each change).

## The tools

| Tool | Topic | What it does |
|------|---------|--------------|
| [`tools/volatility-drag/`](tools/volatility-drag/) | L1 §4 | Volatility drag: arithmetic vs. geometric average, R_G ≈ R_A − ½σ², simulated wealth paths vs. the "arithmetic promise," 1991–2025 table presets. |
| [`tools/fee-drag/`](tools/fee-drag/) | L1 §6 | Fund-fee drag: Class A front load vs. Class B level load + declining exit fee, crossover horizon, active-vs-passive preset ($99,628 gap). |
| [`tools/market-depth/`](tools/market-depth/) | L2 §3 | Market depth & price impact: the deck quiz ("at what price can you sell 30?") animates a market order eating a four-level book while the arithmetic reveals line by line; depth-cost curve at the ladder's size; editable book behind a disclosure. Redesign of the order-book tool's depth half. |
| [`tools/two-asset/`](tools/two-asset/) | L3 §4 | Two-asset opportunity set as ρ and weight vary; minimum-variance portfolio. |
| [`tools/capital-allocation/`](tools/capital-allocation/) | L3 §2–3 | CAL from the risk-free asset through a risky portfolio; utility and optimal w*. |
| [`tools/efficient-frontier/`](tools/efficient-frontier/) | L3 §5 | N-asset minimum-variance frontier, global MVP, and max-Sharpe tangency. |
| [`tools/capm-sml/`](tools/capm-sml/) | L4 §2–3 | Security market line + alpha, and a simulated market-model OLS regression. |
| [`tools/diversification/`](tools/diversification/) | L4 App. | Equal-weight portfolio risk vs. N: the 1/N term vanishes, correlation sets the systematic floor (web version of PortfolioVarianceAndDiversification.xlsx). |
| [`tools/anomaly-lab/`](tools/anomaly-lab/) | L5 §1–2 | Anomaly lab: live CAPM / FF3 / Carhart time-series regressions on 10 value-weighted decile portfolios per sort (beta, size, book-to-market, momentum) over an adjustable 1963–2026 window — SML scatter, alpha plots, factor loadings, RMS-alpha scoreboard, return decomposition, information-ratio card. Data baked from the Ken French library (`data.js`, regenerate with `code/make_data.py`). |
| [`tools/beauty-contest/`](tools/beauty-contest/) | L6 §3 | The 2/3-of-the-average game, live in class: students submit by QR code (Firebase RTDB via plain REST/SSE — see its SETUP.md), instructor screen reveals mean/target/winner per round; built-in simulation mode needs no backend. |
| [`tools/duration/`](tools/duration/) | L7 §3–4 | Price–yield curve with the duration tangent vs. exact repricing, the PV cash-flow fulcrum at t = D, and spot-curve/forward-rate pricing. |
| [`tools/black-scholes/`](tools/black-scholes/) | L8 §3–4 | Black–Scholes calls and puts: intrinsic vs. time value, delta hedge ratio, comparative statics in σ and T, put–call parity (deck's discrete-rate form). |

## Releasing tools to students

[`releases.js`](releases.js) (repo root) controls which tools students can
see — set each tool to `true`, `false`, or an auto-release date
`'YYYY-MM-DD'` (the lecture date), then `git push`. Locked tools show a
greyed-out "unlocks in class" card on the landing page (or disappear
entirely with `HIDE_LOCKED = true`) and a lock screen at their URL.
Instructor bypass: append `#preview` to any tool URL.

## Run locally

No install step. Serve the repo root over HTTP (ES modules and `fetch` need a
real origin — opening `index.html` as a `file://` URL will not work):

```bash
cd fin30600-tools
python3 -m http.server 8613   # same port .claude/launch.json uses
# then open http://localhost:8613/
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
the bond math (price/duration hand-computed case, the deck's −D·Δy/(1+y)
anchor of +1.16%, forward rates), the L1 fee/average math (Class A vs. B
share-class anchors, the +100%/−50% arithmetic-vs-geometric example), and the
L2 trading math (order-book walks — sell 30 → $251.25, margin magnification
±36.36%, margin-call prices $75/$82.50 and $57.69, short return −12%), and
the multi-factor OLS engine against a pasted numpy cross-check.
`tests/anomaly-lab-data.test.js` re-runs the anomaly lab's baked Ken French
data through the deck's 1963–2023 window and checks the Topic 5 anchor
numbers (market premium, beta-sort alphas, Carhart loadings, RMS-alpha
table) to data-vintage tolerance.

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
│   ├── chart.js            hand-rolled SVG chart helper (despined axes, halo labels, LabelPlacer)
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
- **Point labels near curves** — don't hard-code a `dx/dy` for a label whose
  point sits ON a line (that is how "C: …" and "w* = …" ended up printed across
  the CAL in the capital-allocation tool). Use `LabelPlacer` from `chart.js`:
  register the curves with `avoidPath`, the markers with `avoidPoint`, then
  `label()` each point with a `prefer` quadrant order — upper-left and
  lower-right are the line-free sides of a point on a curve rising to the
  right. It scores the four diagonal spots (leaves the plot / overlaps a
  label or marker / crosses a curve) and draws the winner with a white halo
  (`text({halo: true})`, CSS `.datalabel.halo`) so the label reads even
  where a curve runs behind it. Capital-allocation uses it since 2026-09-08;
  the other tools still use fixed offsets (opt-in).
- **State in the URL hash**: every control serializes into `#key=val` pairs
  (debounced `replaceState`) via `lib/state.js`, so any configuration is a
  shareable, reload-stable link. All randomness runs through a seeded PRNG
  (`mulberry32`) whose seed is part of that state.
