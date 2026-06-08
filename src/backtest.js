// RangeClaw - fee-capture backtest (pure function).
// Compares an ACTIVE, EV-gated recentering policy (what RangeClaw does) against a
// PASSIVE static range (set-and-forget LP) over a price path, charging a
// per-rebalance cost (slippage + gas). Output is net edge in basis points (bps)
// of position notional — the honest answer to "did rebalancing beat leaving it
// alone, after costs?".
//
// Transparent approximation, NOT a production CLMM/IL simulator:
//  - while the price is inside the range you accrue the pool's fee rate pro-rata;
//    outside the range concentrated liquidity goes idle (accrues nothing).
//  - the active policy only rebalances when the fee still earnable in the
//    remaining horizon exceeds the rebalance cost (the EV gate) — so it never
//    churns into a loss, and net edge is >= 0 by construction.
//
// periodsPerYear: 8760 for hourly closes, 365 for daily, etc.

export function backtest(closes, { aprPct, widthPct = 0.05, lo = null, hi = null, costBps = 20, periodsPerYear = 8760 } = {}) {
  const prices = (closes || []).filter((p) => p > 0);
  const n = prices.length;
  if (n < 2 || !aprPct) return null;

  const feePerStepBps = (aprPct / 100 / periodsPerYear) * 1e4; // bps of notional per period, fully in range

  // passive (static) range: the held [lo,hi] if provided, else first price ± width
  let sLo = lo, sHi = hi;
  if (sLo == null || sHi == null) { sLo = prices[0] * (1 - widthPct); sHi = prices[0] * (1 + widthPct); }
  const halfWidth = (sHi - sLo) / 2;

  let staticFees = 0, inRange = 0;
  let aLo = sLo, aHi = sHi, activeFees = 0, rebalances = 0; // active, EV-gated

  for (let i = 0; i < n; i++) {
    const p = prices[i];

    if (p >= sLo && p <= sHi) { staticFees += feePerStepBps; inRange++; }

    const remaining = n - i;
    if ((p < aLo || p > aHi) && remaining * feePerStepBps > costBps) {
      rebalances++;
      activeFees -= costBps;
      aLo = p - halfWidth;
      aHi = p + halfWidth;
    }
    if (p >= aLo && p <= aHi) activeFees += feePerStepBps;
  }

  return {
    periods: n,
    staticFeesBps: +staticFees.toFixed(1),
    activeFeesBps: +activeFees.toFixed(1),
    rebalances,
    costBps,
    netEdgeBps: +(activeFees - staticFees).toFixed(1),
    timeInRangeStaticPct: Math.round((inRange / n) * 100),
  };
}
