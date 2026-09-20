# Finance surveillance pack

Routes bounded market-surveillance evidence to `observe`, `investigate`, or
`escalate`. It never emits `allow`, buy/sell/hold, order parameters, or an
execution capability. Trusted code must calculate numeric signals, enforce the
no-lookahead cutoff, validate freshness, and keep trading systems behind a
separate authorization boundary.
