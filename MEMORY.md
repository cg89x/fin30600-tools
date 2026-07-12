# MEMORY.md — living state of fin30600-tools

The running state of this project. Keep it current (see CLAUDE.md → "Keep
MEMORY.md updated"): when a change alters the state below, edit the relevant
entry and add a dated changelog line on top. One line per fact; not a diary.

## Current state

- **Eight tools** (`tools/<name>/` = `index.html` + `main.js`, plus extra
  tool-local modules where noted):
  1. `two-asset` — two-asset diversification, opportunity set vs ρ and weight
     (L3 §4). Deck example A 8/13, B 16/20; Rule 2 shown in correlation form.
  2. `capital-allocation` — CAL + utility, optimal allocation **w\*** (renamed
     from y\*), borrowing kink (L3 §2–3). Deck 7/15/22; w\* = 0.8264 at A = 2.
  3. `efficient-frontier` — N-asset frontier, global MVP, max-Sharpe tangency,
     tangency-weights bar (L3 §5). Defaults = 5 broad asset classes with
     realistic Sharpes (stocks 0.28–0.38, tangency ~0.47), NOT Jorion 1989.
  4. `capm-sml` — SML + alpha and a simulated market-model OLS regression, two
     side-by-side sections (L4 §2–3). Deck β = 1.45.
  5. `diversification` — equal-weight portfolio σ vs N for 3 cases
     (uncorrelated, common ρ, CAPM single-factor); β²=ρ coincide flag;
     variance-decomposition inset + share bar (L4 Appendix). Web version of
     `PortfolioVarianceAndDiversification.xlsx`. x-axis tracks the N slider;
     charts use `--stroke-scale: 1.5` (thick lines, base-size labels).
  6. `beauty-contest` — 2/3-of-the-average game (L6 §3). Instructor/projector
     page (histogram, close-round reveal of mean/target/winner, round-history
     convergence chart, level-k markers) + mobile student page `submit.html`
     reachable by QR (vendored qrcode-generator 1.4.4). Live channel =
     Firebase RTDB via plain REST/EventSource in tool-local `rtdb.js` (NO
     SDK); LIVE since 2026-07-11 — `config.js` committed, DB
     `ckontz-fin30600-default-rtdb.firebaseio.com` (Spark tier), rules
     published + verified end-to-end; seeded level-k SIMULATION mode remains
     as a toggle/fallback.
     Pure game logic in `game.js` (desk-checked vs Loudis's workbook:
     mean 33.179 → target 22.119).
  7. `duration` — price–yield curve with duration tangent vs exact repricing,
     PV cash-flow fulcrum at t = D, spot-curve/forward panel in `spotpanel.js`
     (L7 §3–4). Defaults = deck Example 1 (8% coupon, 6y, y=8% → B=$1,000,
     D=4.9927); deck slide prints ΔB≈$46.20 from rounded D, tool uses full
     precision ($46.23).
  8. `black-scholes` — BS call/put pricing (L8 §3–4): time-value band, delta
     tangent + deck-phrased hedging readout, σ/T comparative statics, parity
     card in the deck's discrete form (anchors $3.29 and deck Ex. 1 $0.35).
     Defaults = deck example S=100, X=95, σ=50%, r=10%, T=0.25 (C=13.695).
- **Theme matches the beamer deck** (`ndcollegiate.sty`): self-hosted
  Libertinus Sans body / Libertinus Serif navy display titles (`vendor/fonts/`,
  SIL OFL), white letterhead header (gold rule + grey eyebrow + serif title),
  metallic gold `#AE9142` chrome accents. On-chart text stays Arial.
- **No presenter mode** (removed 2026-07-11) — projector scaling is per-tool
  via `--stroke-scale` on `.chart-box`.
- **Landing page** = one card per tool, in lecture order.
- **Tests:** `node --test tests/finmath.test.js`, 25 passing (incl. BS,
  parity, bond price/duration, forward-rate anchor tests).
- **Deploy:** push to `main` → GitHub Pages → christiankontz.com/fin30600-tools.

## Key decisions / rulings (Christian)

- Pure explorers, no quiz/practice layer. Static site, zero build step.
- Every control state in the URL hash (slides QR-link presets).
- All labels typeset as real math — no raw `r_f (%)`.
- Repo lives outside Dropbox (git/Dropbox conflict).
- Rejected the Jorion 1989 frontier set (Sharpe too high); realistic classes.
- y\* → w\* for the optimal allocation label.

## Gotchas (learned the hard way)

- Stylesheet `stroke-width` on `.series` overrides the SVG attribute → every
  curve pinned to one width. Widths are now inline `calc(... * --stroke-scale)`;
  never re-add a `.series` stroke-width CSS rule.
- `%` in a TeX string is a comment → escape `\%`.
- `\textcolor{#hex}` fails in MathJax (`#` = param char) — `chart.js`/`ui.js`
  rewrite to `[RGB]{r,g,b}`; use tex-svg-**full** (base autoloads over network).
- Safari needs explicit width/height attrs + CSS aspect-ratio on SVG or the
  chart collapses.
- `python3 -m http.server` sends no Cache-Control → stale `lib/*.js` in the
  browser after edits; `fetch(url,{cache:'reload'})` + reload, or ⌘⇧R.
- `node --test tests/` (bare dir) breaks on Node 25 — name the file.
- `\$` inside a `$...$` renderLabel segment breaks the splitter; use
  `\unicode{x24}` (`\mathdollar`/`\char` are NOT in tex-svg-full — silent red
  text, no merror).
- Author `display:flex/grid` beats the `hidden` attribute — pages that toggle
  such elements need `[hidden]{display:none !important}`.
- Put–call parity: the DECK discounts at an effective annual rate
  (X/(1+r)^T, `parityCall`); Black–Scholes uses continuous e^{−rT}. Keep the
  two forms straight in any option UI.

## Open threads / backlog

- Stale beauty-contest sessions (write-once guesses) need occasional manual
  deletion from the Firebase console Data tab (see SETUP.md housekeeping).
- Repo is public; making it private needs GitHub Pro for private-repo Pages
  (Christian's call, not done).
- v2 ideas: link tools from Canvas; short-sale-constrained frontier (needs a QP
  solver); APT/multifactor tool tied to the Multifactor Model Project.
- More than one Claude session sometimes commits here — fetch before push.

## Changelog (newest first)

- 2026-07-11 — Beauty-contest classroom choreography (Christian): first name
  now REQUIRED on the student page (winner announced by name); in live mode
  the histogram is hidden while a round is open ("N submissions in —
  revealed when the round closes" placeholder; bars appear on close; sim
  keeps its streaming animation); the round-history panel is now the DEBRIEF
  — hidden until 3 rounds have closed (both modes), then shows the
  convergence chart + winners of each round + the equilibrium math
  (50→33.3→22.2→⋯→0 and g* = (2/3)g* ⇒ g* = 0 + Keynes line).

- 2026-07-11 — Beauty-contest polish (Christian's feedback): the iterated-
  reasoning 50→33.3→…→0 line was a strategy GIVEAWAY — now revealed only
  after close (with the mean/target); rules rewritten in plain student
  English + a worked micro-example; sim controls (class size/seed/note)
  hidden unless simulation mode is on; level-k markers were invisible
  6%-height axis ticks → now full-height dashed navy guides w/ white-halo
  labels ("L1 = 33.3"…); short typed join URL **christiankontz.com/play**
  (redirect page `play/index.html` in the cg89x.github.io repo, preserves
  #s=CODE; shown via config.shortJoinUrl — QR still deep-links).

- 2026-07-11 — Beauty-contest live polling ENABLED: Christian created Firebase
  project `ckontz-fin30600`, rules published; `config.js` committed. Verified
  end-to-end on the live site (session P8TT: two REST guesses streamed into
  the projector page, close-reveal mean 27.25 / target 18.17 / winner exact;
  invalid v=150 rejected; root read denied). Playground note: a `get` at `/`
  correctly shows "read denied" — test at `/beauty/<code>` instead.

- 2026-07-11 — Three new tools (parallel subagent build): `beauty-contest`
  (L6; Firebase-REST live polling + simulation fallback, QR student page,
  vendored qrcode-generator), `duration` (L7; tangent vs exact, fulcrum,
  spot/forward panel), `black-scholes` (L8; time value, delta hedge,
  comparative statics, parity). finmath grew normCdf/BS/parity/bond/forward
  functions; tests 17 → 25. New gotchas: `\unicode{x24}` for $ in math,
  `[hidden]` vs author display rules.
- 2026-07-11 — Added `CLAUDE.md` + this `MEMORY.md`.
- 2026-07-11 — Docs synced to shipped state (removed presenter-mode refs, added
  fonts/theme + `--stroke-scale` + 5th tool); README is now the living ref.
- 2026-07-11 — Diversification tool: case order 1→2→3, Case 1 formula row,
  thicker curves (`--stroke-scale: 1.5`, labels kept base size), x-axis tracks N.
- 2026-07-11 — Fixed site-wide stroke-width bug (CSS rule overrode per-path
  widths → all curves 2px); widths now inline, scaled by `--stroke-scale`.
- 2026-07-11 — New tool: Diversification & Systematic Risk (L4 appendix
  workbook); `ewVarUncorrelated`/`ewVarCommonCorr` added to finmath + tested.
- 2026-07-11 — Theme matched to the beamer deck (Libertinus webfonts,
  letterhead header, gold accents).
- 2026-07-10 — Initial four tools built (Fable plan + opus subagents), MathJax
  (swapped from KaTeX), presenter mode later removed, deployed live.
