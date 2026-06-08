// Generate web/data.json for the dashboard charts:
//   - market session
//   - xStock universe (APRs)
//   - the user's stock positions + Guardian action + price history (klines) + range
// Re-run this and redeploy web/ to refresh the live snapshot.
//   node scripts/export-data.js

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { byreal } from "../src/byreal.js";
import { portfolio } from "../src/portfolio.js";
import { decide } from "../src/guardian.js";
import { marketSession } from "../src/equity.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function klines(poolId) {
  try {
    const k = (await byreal(`pools klines ${poolId} --interval 1h`)).data.klines || [];
    return k.map((x) => ({ t: x.timestamp, c: +Number(x.close).toFixed(2) }))
      .sort((a, b) => a.t - b.t)
      .slice(-60);
  } catch { return []; }
}

async function main() {
  const now = new Date();
  const { stocks, rows } = await portfolio();
  const session = marketSession(now);

  const universe = stocks
    .filter((p) => p.token_b.symbol === "USDC")
    .sort((a, b) => b.total_apr - a.total_apr)
    .map((p) => ({ symbol: p.token_a.symbol, apr: +p.total_apr.toFixed(1), price: +p.current_price.toFixed(2), tvl: Math.round(p.tvl_usd) }));

  const positions = [];
  for (const r of rows) {
    const d = decide(r, now);
    positions.push({
      pair: r.pair, ticker: r.ticker,
      price: +r.price.toFixed(2), lo: +r.lo.toFixed(2), hi: +r.hi.toFixed(2),
      inRange: r.inRange, buffer: +r.buffer.toFixed(1),
      action: d.action, rationale: d.rationale,
      liq: r.pos.liquidityUsdDisplay, fees: r.pos.earnedUsdDisplay, pnl: r.pos.pnlUsdDisplay,
      klines: await klines(r.pool.id),
    });
  }

  const out = {
    generatedAt: now.toISOString(),
    market: { state: session.state, isOpen: session.isOpen, etTime: session.etTime },
    universe,
    positions,
  };
  const path = join(root, "web", "data.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`Wrote ${path}`);
  console.log(`market=${session.state} · universe=${universe.length} · positions=${positions.length}`);
  positions.forEach((p) => console.log(`  ${p.pair} ${p.action} px $${p.price} · klines ${p.klines.length}pts`));
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
