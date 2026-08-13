# FIN 30600 Interactive Tools — Design

**Date:** 2026-07-10 · **Author:** Christian Kontz (with Claude Fable)
**Purpose:** Browser-based interactive explorers accompanying the FIN 30600
(Investment Theory, Notre Dame) lecture decks, starting with Portfolio Theory
(Topic 3) and CAPM (Topic 4).

> **This file is the original spec (2026-07-10). Since then:** a 5th tool
> (diversification, §5 below) shipped; **presenter mode was removed** and
> replaced by per-tool `--stroke-scale` (see README "Line & label scaling");
> the theme was matched to the beamer deck (self-hosted Libertinus fonts in
> `vendor/fonts/`, white letterhead header). The **README** is the current
> living reference for conventions — prefer it where the two disagree.

## Decisions (locked with Christian, 2026-07-10)

- **Dual-purpose**: driven live on the classroom projector AND used by students
  on their own laptops (linked from Canvas).
- **Pure explorers** — interactive visualizations only. No practice-problem or
  quiz layer in v1.
- **Static site, zero build step**: plain HTML + ES-module JavaScript, no
  framework, no bundler, no server. Hosted on GitHub Pages from `main` of the
  public repo `fin30600-tools` (account `cg89x`). Deploy = `git push`.
- Charts are **hand-rolled SVG** via a small shared helper — no chart library.
  MathJax v3 (self-hosted tex-svg-full bundle in `vendor/`) is the only third-party dependency.

## Repo layout

```
fin30600-tools/
├── index.html              landing page: course header + one card per tool
├── lib/
│   ├── style.css           house style + deck-matched theme + layout skeleton
│   ├── chart.js            SVG chart helper (axes, grid, curves, points, labels)
│   ├── finmath.js          ALL finance math (pure functions, unit-tested)
│   ├── ui.js               slider-with-readout, number input, toggle components
│   └── state.js            URL-hash state encode/decode (bookmarkable configs)
├── vendor/
│   ├── mathjax/            self-hosted MathJax 3.2.2 (tex-svg-full.js)
│   └── fonts/              self-hosted Libertinus Sans/Serif woff2 (SIL OFL)
├── tools/
│   ├── two-asset/          index.html + main.js  (Topic 3 §4)
│   ├── capital-allocation/ index.html + main.js  (Topic 3 §2–3)
│   ├── efficient-frontier/ index.html + main.js  (Topic 3 §5)
│   ├── capm-sml/           index.html + main.js  (Topic 4 §2–3)
│   └── diversification/    index.html + main.js  (Topic 4 Appendix)
├── tests/finmath.test.js   plain `node --test`, zero dependencies
└── docs/                   DESIGN.md (this file), PLAN.md
```

Each tool imports only `lib/*` and MathJax — tools are fully independent of each
other. No cross-tool imports, ever.

## House style (match the lecture figures)

- **Palette**: BLUE `#0072B2` = primary series; GOLD `#C99700` = secondary;
  NAVY `#0A234B` = chrome/headers (ND identity); dashed red `#D62728` only for
  reference lines. Muted grey `#DDDDDD` grid, `#666666`/`#333333` axis
  edge/label colors. No top/right chart borders (matplotlib despined look).
- **Typography** *(shipped 2026-07-11, matching the beamer deck)*: body text
  is **Libertinus Sans** and display titles **Libertinus Serif** navy —
  self-hosted woff2 in `vendor/fonts/` (SIL OFL), `Arial, Helvetica` fallback.
  **On-chart SVG text stays Arial** (`--font-chart`) to match the lecture
  figures. Formula rendering via MathJax (SVG output).
- **Axis conventions** (Christian's standing rules): σ axis labeled exactly
  **“Standard Deviation”**, expected-return axis exactly **“Expected Return”**
  (singular, spelled out). Percent ticks are whole percents (`30%`, never
  `0.30` or `30.0%`). β/α/other axes keep their own names.
- **Layout skeleton** (same for every tool): header bar (navy) with tool title
  + course name; controls panel left (~300 px), chart right (flex), live
  formula strip below the chart (MathJax with current numbers substituted);
  footer with a link back to the tool index. On narrow screens the panel
  stacks above the chart.

## Cross-cutting behaviors (in `lib/`)

- ~~**Presenter mode**~~ **(removed 2026-07-11)**: the button/`?present=1`
  toggle is gone. Projector scaling is now per-tool: set `--stroke-scale` on a
  `.chart-box` and `chart.js` multiplies every stroke and chart-text size by
  it (see README "Line & label scaling").
- **State in URL hash**: every control's value serializes into `#…` (compact
  `key=val` pairs) on change (debounced); on load, hash values override
  defaults. Any configuration is a shareable/bookmarkable link — slides can QR
  a tool pre-set to that slide's example.
- **Determinism**: all randomness through a seeded PRNG (mulberry32) in
  `finmath.js`; the seed is part of the URL state. Reloading a shared link
  reproduces the exact same picture.

## The tools

### 1. Two-asset diversification explorer (`tools/two-asset/`, L3 §4)

Inputs: E[r] and σ for Securities A and B (defaults = the deck's example:
A: 8%, 13%; B: 16%, 20%), correlation slider ρ ∈ [−1, 1] (default +0.2, step
0.05), weight slider w_A ∈ [−0.5, 1.5] (default 0.6), "allow short sales"
toggle (off ⇒ clamp w_A to [0, 1]).
Chart (σ–E[r] plane): opportunity-set curve for current ρ; current portfolio
as a live BLUE dot with (σ_P, E[r_P]) label; minimum-variance portfolio marked
(GOLD diamond); A and B marked and labeled. Toggle "show ρ = +1, 0, −1
reference curves" overlays the three cases in muted strokes (the slides' Case
A/B/C picture).
Readouts: E[r_P], σ_P, Cov(A,B), MVP weight w_A^min. Formula strip: Rule 1 and
Rule 2 from the deck with the current numbers substituted live.
Check values (from the deck): w_A = 0.6, ρ = +0.2 ⇒ E[r_P] = 11.2%,
σ_P = 12.24%; ρ = −0.2 ⇒ σ_P = 9.99%.

### 2. Capital allocation + utility (`tools/capital-allocation/`, L3 §2–3)

Inputs: r_f, E[r_p], σ_p (defaults from the deck's CAL example — the building
agent reads `sec3_capalloc.tex` and uses the slide numbers; if none, use
r_f = 3%, E[r_p] = 10%, σ_p = 20%), risk-aversion slider A ∈ [1, 10], and
allocation slider y ∈ [0, 2].
Chart: CAL from (0, r_f) through P; complete-portfolio dot at
(yσ_p, r_f + y(E[r_p] − r_f)); the indifference curve through the current
point (U = E[r] − ½Aσ², plotted as E[r] = U + ½Aσ² over the σ range);
optimal y* = (E[r_p] − r_f)/(A σ_p²) marked on the CAL (GOLD star) with its
indifference curve (tangent) shown muted.
Secondary inset or panel: U as a function of y with the peak at y* (whichever
reads better; a small inline SVG under the readouts is fine).
Toggle: borrowing rate r_B > r_f (default off; when on, default r_B = r_f + 2pp)
kinks the CAL at y = 1 — matches the deck's kinked-CAL slide.
Readouts: Sharpe ratio of P, y*, E[r_C], σ_C, U(current), U(y*).

### 3. Efficient frontier + tangency (`tools/efficient-frontier/`, L3 §5)

Data: an editable table of N assets (name, E[r], σ) + pairwise correlations;
default = the example used in `sec5_manyassets.tex` if it has one, otherwise
5 plausible presets (e.g. US large, US small, intl equity, bonds, REITs) with
a sensible correlation matrix. Editing any cell recomputes everything.
Chart (σ–E[r] plane): (a) cloud of ~2,000 random feasible long-only portfolios
(seeded Dirichlet weights, small grey dots, colored by Sharpe ratio if cheap);
(b) the analytic minimum-variance frontier (short sales allowed, closed-form
via matrix ops); (c) the global MVP (GOLD diamond); (d) the tangency /
max-Sharpe portfolio (BLUE star) and the CAL from (0, r_f) through it;
(e) individual assets marked. Slider for r_f ∈ [0%, 8%] moves the tangency
point. Hovering the frontier shows the frontier portfolio's weights at that
point (tooltip); a horizontal bar chart below shows tangency weights
(negative bars allowed = short positions).
Explicitly OUT of scope for v1: the short-sale-constrained frontier (needs a
QP solver; the analytic frontier + long-only cloud tells the story).
Numerical guards: reject a non-positive-definite correlation matrix with a
clear inline message (check via Cholesky); clamp inputs.

### 4. CAPM/SML + market model (`tools/capm-sml/`, L4 §2–3)

Two panels (tabs or stacked sections — building agent's call, favor stacked).
**SML panel**: sliders r_f ∈ [0, 8]%, E[r_M] ∈ [4, 14]%; test asset with β
slider ∈ [−0.5, 2.5] and its own E[r] input. Chart (β–E[r] plane): SML line,
market point at β = 1, test asset plotted; vertical gap = α, drawn and labeled
(BLUE if α > 0 "underpriced", red dashed leader if α < 0 "overpriced").
Readouts: CAPM-required return, α.
**Market-model panel**: simulate n monthly excess returns (sliders: true β,
idiosyncratic σ_e, n ∈ {12, 36, 60, 120, 240}; market: fixed plausible
E[r_M − r_f], σ_M ≈ 4.5%/mo... use monthly-scaled values documented in the
code). Scatter of asset vs market excess returns, OLS fitted line, plus the
TRUE line in muted GOLD. Readouts: β̂, α̂ (with SEs), R², and a horizontal
stacked variance-decomposition bar: systematic β²σ_M² vs idiosyncratic σ_e².
"Resample" button draws a new seed (updates URL state) — estimation noise
becomes visceral, especially at small n. Axis labels here: "Market excess
return" / "Asset excess return" (SCL convention — NOT the σ/E[r] labels).

### 5. Diversification & systematic risk (`tools/diversification/`, L4 Appendix)

Web version of `Archive/Lectures (pptx)/Lecture 4/Additional Materials/
PortfolioVarianceAndDiversification.xlsx` and the deck appendix
(`app_diversification.tex`). Equal-weight portfolio of N unit-variance assets,
N = 1..100:

- **Case 1** (uncorrelated, blue): sigma_P^2 = 1/N.
- **Case 2** (common pairwise rho, gold; slider 0-0.95, default 0.5):
  sigma_P^2 = 1/N + ((N-1)/N) rho, dashed gold floor at sqrt(rho).
- **Case 3** (CAPM single factor, navy DASHED so a coinciding Case 2 stays
  visible; beta slider, default 0.707 = 1/sqrt(2)): sigma_eps^2 = 1 - beta^2
  keeps Var(R_i) = 1, so sigma_P^2 = 1/N + ((N-1)/N) beta^2. A gold
  "coincide flag" fires when |beta^2 - rho| < 0.005 — the workbook's
  punchline that market exposure *is* the correlation.
- Right column: stacked-area variance decomposition vs N (covariance term
  swells to rho, 1/N band vanishes) + a capm-sml-style share bar at the
  current N. Readouts include "variance term 1/N gone: 1 - 1/N".
- Both charts' x-axis upper limit tracks the N slider (up to N_MAX = 100)
  so low-N cases aren't squeezed against the axis. Charts use
  `--stroke-scale: 1.5` for thicker projector lines (labels kept base size).
- State keys: `n, rho, beta, c1, c2, c3`.

## Math (all in `lib/finmath.js`, pure, unit-tested)

Two-asset: portfolio mean/σ, covariance from ρ, MVP weight
w_A^min = (σ_B² − σ_AB)/(σ_A² + σ_B² − 2σ_AB). CAL/utility: y*, U, Sharpe.
Frontier: mean vector μ, covariance Σ from σs and correlations; global MVP
w ∝ Σ⁻¹1; tangency w ∝ Σ⁻¹(μ − r_f 1) normalized; frontier traced by
combining MVP and tangency (two-fund separation), or the standard A/B/C/D
efficient-set constants. Matrix ops: small dense Gaussian-elimination solve +
Cholesky PD check (N ≤ 10, no numerics library). OLS: slope/intercept, SEs,
R². PRNG: mulberry32 + Box–Muller normal + Dirichlet via exponentials.
Percent-vs-decimal convention: **finmath works in decimals everywhere**; the
UI layer formats to whole percents.

## Testing & verification

- `node --test tests/` — finmath tested against the deck's worked numbers
  (two-asset checks above; y* by hand; frontier/tangency cross-checked against
  a reference computed independently, e.g. a numpy one-off during development;
  OLS against a hand-computed small sample).
- Browser QA on every tool: default view matches the corresponding slide
  example; legible at 1280×720 (projector); no console errors; no horizontal
  scroll; URL state round-trips (set sliders → copy URL → open fresh tab →
  same picture).

## Out of scope for v1

Practice/quiz layer; short-sale-constrained frontier; APT/multifactor tool
(natural v2 companion to the Multifactor Model Project); real-data feeds
(everything is analytic or seeded-simulated); mobile-phone optimization
(laptop/projector are the targets; graceful stacking is enough).
