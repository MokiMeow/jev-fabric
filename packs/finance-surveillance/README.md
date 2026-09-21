# Finance surveillance pack

Routes bounded market-surveillance evidence to `observe`, `investigate`, or
`escalate`. It never emits `allow`, buy/sell/hold, order parameters, or an
execution capability. Trusted code must calculate numeric signals, enforce the
no-lookahead cutoff, validate freshness, and keep trading systems behind a
separate authorization boundary.

Financial-text classification uses a closed vocabulary with both `none` and
`unclear`. `none` means the excerpt clearly fits no supported claim category;
`unclear` means the excerpt is insufficient or genuinely ambiguous between
categories. `unclear` always routes to `investigate`. The vocabulary change is
versioned as pack `0.2.0`; discard policies, caches, and calibrated thresholds
bound to the `0.1.0` question contract. The exported canonical question-set
hash covers base, uncited-claim, and cited-claim shapes, allowing retained runs
to reject stale contracts before provider execution.
