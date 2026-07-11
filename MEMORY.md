# MEMORY.md — living state of fin30600-tools

The running state of this project. Keep it current (see CLAUDE.md → "Keep
MEMORY.md updated"): when a change alters the state below, edit the relevant
entry and add a dated changelog line on top. One line per fact; not a diary.

## Current state

- **Five tools** (`tools/<name>/` = `index.html` + `main.js`):
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
- **Theme matches the beamer deck** (`ndcollegiate.sty`): self-hosted
  Libertinus Sans body / Libertinus Serif navy display titles (`vendor/fonts/`,
  SIL OFL), white letterhead header (gold rule + grey eyebrow + serif title),
  metallic gold `#AE9142` chrome accents. On-chart text stays Arial.
- **No presenter mode** (removed 2026-07-11) — projector scaling is per-tool
  via `--stroke-scale` on `.chart-box`.
- **Landing page** = one card per tool, 4-up grid (5th wraps).
- **Tests:** `node --test tests/finmath.test.js`, 17 passing.
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

## Open threads / backlog

- Repo is public; making it private needs GitHub Pro for private-repo Pages
  (Christian's call, not done).
- v2 ideas: link tools from Canvas; short-sale-constrained frontier (needs a QP
  solver); APT/multifactor tool tied to the Multifactor Model Project.
- More than one Claude session sometimes commits here — fetch before push.

## Changelog (newest first)

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
