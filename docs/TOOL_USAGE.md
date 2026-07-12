# How to use each tool (≤100 words apiece)

Written 2026-07-12 at Christian's request. One entry per tool, student-facing
voice — usable verbatim as Canvas blurbs or on-page "How to use" leads.
The old `order-book` tool was removed 2026-07-12, replaced by two focused
tools: `market-depth` (live) and the order-types tool (prototype
`proto-a-types`, local, ships next).

## Volatility drag (L1 §4)

Set an arithmetic average return and a volatility, then compare the smooth
"arithmetic promise" with simulated wealth paths that earn that average — but
bumpily. The gap that opens up is volatility drag: R_G ≈ R_A − ½σ². Drag σ up
and watch the median path fall further behind; use the 1991–2025 presets to
see the drag in real asset classes. "New draw" re-rolls the paths; the
horizon slider shows the drag compounding. The punchline: you eat geometric
returns, not arithmetic ones.

## Fee drag (L1 §6)

Compare two share classes of the same fund: Class A pays a front load once,
Class B pays a higher annual fee plus a declining exit fee. Drag the horizon
and watch the cheaper class flip — B wins early, A wins if you stay put (the
crossover is marked). Set the year-1 exit-fee slider to see how exit charges
change the picture. Then load the active-vs-passive preset: a ~1% fee
difference compounds into a six-figure gap over a career.

## Market depth & price impact (L2 §3 — `market-depth`, live 2026-07-12)

Tap a quiz chip ("sell 30") and watch the market order eat the book level by
level while the arithmetic builds beside it — total, then average price.
Compare that average to the best quote: the gap is your price impact. Use
the ticket for any side and size; the depth-cost curve below shows the whole
schedule at once — the bigger the order, the worse the price. Open "Edit the
book" to thin out the depth and rerun.

## Order types (L2 §3 — prototype A2)

Pick a resting order type (limit buy/sell, stop-loss, stop-buy), set its
limit or trigger price, and read the price path left to right: the red
dashed line is your order, the gold dot the first bar it executes — if it
ever does. "New path" redraws the market. The trade-off on display: market
orders execute for sure at an uncertain price; limit and stop orders name a
price but may never fill — and a stop that's gapped through can execute far
below its trigger.

## Margin & short sales (L2 §4–5 — removed from live 2026-07-12, kept locally)

Two mirror-image panels. In the margin panel, buy stock with borrowed money,
then drag the price: the balance-sheet bar shows your equity shrinking twice
as fast as the price, and the margin-call prices mark where the broker steps
in. In the short panel the mirror flips — you profit when the price falls,
and danger is UP: drag the price higher and watch equity vanish with no
floor. Compare the two return readouts to see leverage magnifying both ways.

## Two-asset diversification (L3 §4)

Move the portfolio weight and watch the risk–return point slide along the
opportunity set of two risky assets. Then drag the correlation ρ: the curve
bows left as ρ falls — same assets, less risk — and at ρ = −1 risk can hit
zero. The minimum-variance portfolio is marked. The lesson: portfolio risk
depends not just on the assets you hold but on how they move together.

## Capital allocation & utility (L3 §2–3)

Split your wealth between a risk-free asset and a risky portfolio by dragging
the weight along the capital allocation line. Set your risk aversion A and
the indifference curves shift; the tangency point marks your optimal w* —
where the CAL's trade-off equals your personal one. Push the weight past
100% to borrow and note the kink when the borrowing rate exceeds the lending
rate. Change A to see conservative and aggressive investors choose different
points on the same line.

## Efficient frontier & tangency (L3 §5)

Five asset classes with realistic means, volatilities, and correlations —
all editable. The tool draws the minimum-variance frontier, marks the global
MVP, and finds the tangency portfolio that maximizes the Sharpe ratio from
the risk-free rate you set. Drag r_f and watch the tangency slide along the
frontier; edit a correlation and watch the whole frontier reshape. The
weights panel shows what the optimal portfolio actually holds — including
short positions.

## CAPM & the security market line (L4 §2–3)

Left panel: place an asset by its beta, set the risk-free rate and market
premium, and read its CAPM-required return off the SML; the vertical gap to
the return you assume is alpha — above the line is cheap, below is rich.
Right panel: simulate the market model. Draw N months of returns for a stock
with true beta and alpha, run the regression, and compare the estimate to
the truth. Increase N and watch the estimate tighten — beta is measured, not
known.

## Diversification & systematic risk (L4 appendix)

Drag N, the number of equal-weighted stocks, and watch portfolio volatility
fall — fast at first, then barely at all. Three cases: uncorrelated stocks
(risk → 0), a common correlation (risk → a floor), and the β-driven version.
The inset decomposes variance into the 1/N idiosyncratic part that
diversifies away and the covariance part that doesn't. The floor is
systematic risk: no amount of diversification removes it, which is why only
covariance with the market is priced.

## Anomaly lab (L5 §1–2)

Pick a sort (beta, size, value, momentum), a model (CAPM, FF3, Carhart), and
a sample window on real Ken French data, and the tool runs all ten decile
regressions live. The SML view shows the too-flat line; Alphas and Loadings
show what each model absorbs; the Scoreboard compares RMS alphas across all
sorts. Use the deck-window preset (1963–2023) to reproduce the lecture
tables, then drag the window: which anomalies survive out of sample? The
decomposition and information-ratio cards mirror the worked slide examples.

## Keynesian beauty contest (L6 §3)

The 2/3-of-the-average game, live. Students scan the QR code, submit a
number 0–100, and the projector reveals the distribution, the average, and
the winner — closest to 2/3 of the mean. Run a second round: submissions
collapse toward zero as everyone reasons about everyone else's reasoning.
That regress — pricing what others think others think — is Keynes's point
about markets. No students handy? Simulation mode plays a synthetic
classroom with one click.

## Duration & bond pricing (L7 §3–4)

Set coupon, maturity, and yield: the price–yield curve appears with the
duration tangent at your yield. Nudge Δy and compare the tangent's
prediction with exact repricing — close for small moves, off for big ones
(convexity). The cash-flow panel shows PV bars balancing on a fulcrum at
t = D: duration is literally where the bond's value sits in time. The
spot/forward panel prices the same bond off a curve instead of a single
yield.

## Black–Scholes (L8 §3–4)

Price a call or put: set S, X, σ, r, and T, and the tool draws the BS value
over the payoff, splitting it into intrinsic and time value. The delta
readout is the hedge ratio — shares per option to stay hedged. The statics
panels show the price rising in σ and (for calls) in T: more uncertainty,
more option value, never less. The parity card checks C − P against
S − X/(1+r)^T in the deck's discrete form. Deck anchor: S=100, X=95, σ=50%,
T=0.25 → C=13.695.
