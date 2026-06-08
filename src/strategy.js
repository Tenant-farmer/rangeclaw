// RangeClaw - quantitative strategy helpers (pure functions).
// Turns the Guardian's if-ladder into a cost-aware, volatility-sized strategy:
//  - realizedVolDaily: daily stdev of log returns from a price series
//  - volWidthPct:      range half-width = k * sigma * sqrt(horizon), clamped
//  - rebalanceEV:      expected fees over a horizon vs the rebalance cost (the gate)

export function realizedVolDaily(closes) {
  const p = (closes || []).filter((x) => x > 0);
  if (p.length < 3) return null;
  const rets = [];
  for (let i = 1; i < p.length; i++) rets.push(Math.log(p[i] / p[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varc); // daily stdev of log returns
}

// Range half-width as a fraction of price: k * sigma * sqrt(horizonDays), clamped to [min,max].
export function volWidthPct(sigmaDaily, { horizonDays = 7, k = 2, min = 0.02, max = 0.25 } = {}) {
  if (!sigmaDaily) return null;
  const w = k * sigmaDaily * Math.sqrt(horizonDays);
  return Math.min(max, Math.max(min, w));
}

// EV of rebalancing now: fees still earnable over the horizon (if re-entered) minus cost.
export function rebalanceEV(aprPct, costBps = 20, horizonDays = 14) {
  const feePerDayBps = (aprPct / 100 / 365) * 1e4;
  const feeBps = feePerDayBps * horizonDays;
  return { feeBps, costBps, horizonDays, netBps: feeBps - costBps };
}
