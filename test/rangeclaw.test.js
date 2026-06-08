// Golden unit tests for RangeClaw's load-bearing pure logic.  Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { tickToPrice, priceToTick } from "../src/tickmath.js";
import { realizedVolDaily, volWidthPct, rebalanceEV } from "../src/strategy.js";
import { backtest } from "../src/backtest.js";
import { marketSession, earningsContext } from "../src/equity.js";
import { decide } from "../src/guardian.js";

test("tickmath round-trips price<->tick (xStock 8 / USDC 6)", () => {
  for (const price of [50, 100, 404.33, 1000]) {
    const back = tickToPrice(Math.round(priceToTick(price, 8, 6)), 8, 6);
    assert.ok(Math.abs(back - price) / price < 0.001, `round-trip ${price} -> ${back}`);
  }
});

test("realizedVolDaily: 0 for flat, >0 for moving, null for too-short", () => {
  assert.equal(realizedVolDaily([100, 100, 100, 100]), 0);
  assert.ok(realizedVolDaily([100, 101, 99, 103, 98]) > 0);
  assert.equal(realizedVolDaily([100]), null);
});

test("volWidthPct: scales with vol, clamps to [min,max]", () => {
  assert.ok(volWidthPct(0.02, { k: 2, horizonDays: 7 }) > volWidthPct(0.005, { k: 2, horizonDays: 7 }));
  assert.equal(volWidthPct(1, { k: 2, horizonDays: 7, max: 0.25 }), 0.25);
  assert.equal(volWidthPct(0.0001, { min: 0.02 }), 0.02);
});

test("rebalanceEV: positive when fees beat cost, negative when they can't", () => {
  assert.ok(rebalanceEV(50, 20, 14).netBps > 0);
  assert.ok(rebalanceEV(1.3, 20, 14).netBps < 0);
});

test("backtest: flat -> 0 edge / 0 rebalances; steady uptrend -> active beats passive", () => {
  const flat = backtest(Array(120).fill(100), { aprPct: 40, widthPct: 0.05, periodsPerYear: 365 });
  assert.equal(flat.netEdgeBps, 0);
  assert.equal(flat.rebalances, 0);
  const up = backtest(Array.from({ length: 180 }, (_, i) => 100 * (1 + i * 0.01)), { aprPct: 40, widthPct: 0.05, periodsPerYear: 365 });
  assert.ok(up.rebalances > 0);
  assert.ok(up.netEdgeBps >= 0, `uptrend netEdge ${up.netEdgeBps} should be >= 0`);
});

test("marketSession: classifies OPEN / PRE / AFTER / WEEKEND / HOLIDAY (ET)", () => {
  assert.equal(marketSession(new Date("2026-06-10T18:00:00Z")).state, "OPEN");        // Wed 14:00 ET
  assert.equal(marketSession(new Date("2026-06-10T12:00:00Z")).state, "PRE_MARKET");  // 08:00 ET
  assert.equal(marketSession(new Date("2026-06-10T22:00:00Z")).state, "AFTER_HOURS"); // 18:00 ET
  assert.equal(marketSession(new Date("2026-06-13T18:00:00Z")).state, "WEEKEND");     // Sat
  assert.equal(marketSession(new Date("2026-01-01T17:00:00Z")).state, "HOLIDAY");     // New Year, 12:00 ET
});

test("earningsContext: imminence window + confirmed flag", () => {
  const now = new Date("2026-07-27T18:00:00Z");
  const soon = earningsContext("2026-07-29", 3, now, true);
  assert.ok(soon.imminent && soon.confirmed && soon.daysUntil > 0);
  const far = earningsContext("2026-12-01", 3, now, false);
  assert.ok(far.known && !far.imminent && !far.confirmed);
});

// Guardian decision table — fixed market-OPEN moment, synthetic positions.
const OPEN = new Date("2026-06-10T18:00:00Z");
const mkRow = (over = {}) => ({ pair: "TSLAx/USDC", ticker: "TSLA", price: 400, inRange: true, buffer: 10, pool: { total_apr: 40 }, pos: { tickLower: -100, tickUpper: 100 }, ...over });

test("decide: in-range healthy buffer -> HOLD", () => {
  assert.equal(decide(mkRow(), OPEN, { aprPct: 40 }).action, "HOLD");
});
test("decide: out of range, high APR -> REBALANCE", () => {
  assert.equal(decide(mkRow({ inRange: false }), OPEN, { aprPct: 40 }).action, "REBALANCE");
});
test("decide: out of range, low APR -> WATCH (EV gate vetoes the churn)", () => {
  assert.equal(decide(mkRow({ inRange: false, ticker: "MCD", pair: "MCDx/USDC" }), OPEN, { aprPct: 1.3 }).action, "WATCH");
});
test("decide: thin buffer, high APR -> REBALANCE", () => {
  assert.equal(decide(mkRow({ buffer: 2 }), OPEN, { aprPct: 40 }).action, "REBALANCE");
});
