# CLAUDE.md — fin30600-tools

Operating guide for Claude working in this repo. **Read [`MEMORY.md`](MEMORY.md)
next** — it is the living state log (what's shipped, recent decisions, open
threads) and you are expected to keep it current (see "Keep MEMORY.md updated"
below). For human-facing conventions and full detail, [`README.md`](README.md)
is the living reference; `docs/DESIGN.md` and `docs/PLAN.md` are dated,
superseded artifacts (they carry banners pointing back to the README).

## What this is

Static site of browser-based interactive explorers for **FIN 30600 Investment
Theory** (Notre Dame, Christian Kontz), accompanying the beamer lecture decks —
12 tools spanning Topics 1–8 (returns/fees, trading, portfolio theory, CAPM,
factor models, behavioral, fixed income, derivatives). Dual-purpose: driven live on the
classroom projector AND used by students on their laptops (Canvas links).

- **Live:** https://www.christiankontz.com/fin30600-tools/ (GitHub Pages custom
  domain on the `cg89x` account; repo `cg89x/fin30600-tools`).
- **Local clone lives OUTSIDE Dropbox** (`~/Github/fin30600-tools`) by design —
  git + Dropbox sync conflict. Course materials are in the Dropbox tree; this
  is a standalone repo.

## Architecture (invariants — do not break)

- **Zero build step.** Plain HTML + ES-module JS. No framework, no bundler, no
  npm install, no transpile. A tool = `tools/<name>/index.html` + `main.js`
  importing only `lib/*` and the MathJax global. Tools never import each other.
- **Hand-rolled SVG charts** via `lib/chart.js`. No chart library.
- **MathJax v3 is a GLOBAL, not a module** — the page sets `window.MathJax`
  then loads `vendor/mathjax/tex-svg-full.js` deferred. It MUST be the `-full`
  bundle; the base one autoloads extensions (`\textcolor`, …) over the network,
  which a self-hosted single file can't serve.
- **`lib/finmath.js` is decimals everywhere** (8% = `0.08`). All finance/matrix
  math lives here, pure and unit-tested. UI formats to whole-percent strings.
- **State in the URL hash** via `lib/state.js` (debounced `replaceState`), so
  every configuration is a shareable/QR-able link. Randomness → seeded
  `mulberry32`, seed is part of the state.
- **Hash values are untrusted.** Every tool passes a `BOUNDS` map (per-key
  `[min, max]` mirroring its controls) to `bindState(..., { bounds })`;
  `state.js` clamps on parse AND on every `set`/`patch`. Without it a crafted
  URL can freeze the tab (`#ny=1e9`), NaN the charts, or mark a wrong point as
  "optimal" — this class of bug shipped once across most tools.

## Conventions that bite if ignored

- **Never add a `stroke-width` rule for `.series`/`.refline` to `style.css`.** A
  stylesheet rule beats the SVG presentation attribute and silently pins every
  curve to one width. `chart.js` sets widths as inline `calc(<w>px *
  var(--stroke-scale, 1))`; scale a whole chart for the projector by setting
  `--stroke-scale` on its `.chart-box`. (This bug shipped once.)
- **Text sizes live in variables.** On-chart SVG text = `--chart-tick` /
  `--chart-title` / `--chart-label` / `--chart-tip` (15/16/15/13px, set in
  `lib/style.css` on 2026-09-14 for classroom legibility; body is 18px). A
  tool that pins chart text against `--stroke-scale` must write
  `font-size: var(--chart-tick)` etc., never a literal px, and the `chart.js`
  default margins (20/22/54/68) are sized for these — verify with the SVG
  overlap/clipping audit after touching sizes (README → Text sizes).
- **All labels are real typeset math**, never raw pseudo-math like `r_f (%)`.
  HTML labels: `renderLabel`/`hydrateLabels` (`$...$` → MathJax) from `ui.js`.
  On-chart SVG labels: `svgMathText` in `chart.js` (`_x` → tspan subscripts).
- **`%` inside any renderTeX/`$...$` string is a TeX comment — escape it `\%`**
  or the rest of the formula silently vanishes.
- **`\$` inside a `$...$` renderLabel segment breaks the delimiter split** —
  for a dollar sign inside math use `\unicode{x24}` (note `\mathdollar` and
  `\char` are NOT in tex-svg-full; they fail silently as red literal text).
- **The `hidden` attribute loses to any author `display:flex/grid` rule** —
  `lib/style.css` carries a global `[hidden]{display:none !important}` guard;
  don't remove it and don't re-add per-tool copies.
- **On-chart SVG text stays Arial** (`--font-chart`) to match the lecture
  *figures*; body text is Libertinus Sans, display titles Libertinus Serif
  (deck theme). Don't let chart text inherit the body font.
- **Axis labels** are exactly "Standard Deviation" / "Expected Return"; percent
  ticks are whole percents (`30%`, never `0.30`). Use `pct` from `chart.js`.
- **Palette:** BLUE `#0072B2` primary, GOLD `#C99700` secondary, NAVY `#0A234B`
  chrome, metallic gold `#AE9142` (`--goldmetal`) chrome accents, RED `#D62728`
  dashed references only.
- **Every tool is release-gated.** A new tool must (1) get an entry in
  `releases.js`, (2) `await gateTool('<folder>')` (from `lib/release.js`)
  right after the imports in its `main.js`, (3) ship its `<main>` with the
  `hidden` attribute (the gate un-hides it — kills the locked-page content
  flash), and (4) carry `data-tool="<folder>"` on its landing card plus the
  favicon link every page has. `#preview` in the URL bypasses the gate
  (instructor-only; state writes preserve it). Gating is a courtesy curtain,
  not security — the repo and the static HTML are public.

## Run / test / deploy

```bash
# preview (ES modules need a real origin — file:// won't work)
python3 -m http.server 8613   # then open http://localhost:8613/

# tests (NOT `node --test tests/` — the bare dir breaks on Node 25)
node --test tests/finmath.test.js

# deploy = push to main; Pages serves the repo root
git push
```

- **Local-preview cache gotcha:** `python3 -m http.server` sends no
  Cache-Control, so the browser can run hours-stale `lib/*.js` after an edit.
  Force fresh from the page: `fetch(url, {cache:'reload'})` per touched file,
  then reload. A hard refresh (⌘⇧R) is the manual equivalent.
- **New finmath function ⇒ add a test** in `tests/finmath.test.js`, checked
  against a deck number, workbook formula, or an inline numpy cross-check.

## Multi-session note

More than one Claude session may commit to `main` in this repo at once.
**`git fetch` and check `origin/main...HEAD` before pushing**; if a commit
appears that you didn't make, it's the other session — read it, don't revert
it without reason.

## Keep MEMORY.md updated

`MEMORY.md` is the running state of the project. **When you ship something that
changes that state — a new/removed tool, a convention or default, a resolved
gotcha, a design decision — update `MEMORY.md` in the same change** (add a
dated line to the changelog and edit the relevant "Current state" entry).
Prune entries that become wrong. Keep it a tight index, not a diary: one line
per fact, newest changelog entries on top.
