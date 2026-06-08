// RangeClaw v2 - multi-stock portfolio layer.
// Dynamically discovers ALL tokenized-stock (xStock) pools on Byreal and reads the
// user's LP positions across every one of them. Generalizes the single-TSLAx MVP
// into a whole equity-LP portfolio.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { byreal } from "./byreal.js";

const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config.json"), "utf8"));

// xStocks (Backed) all use the "Xs..." vanity mint prefix on Solana.
const isStockToken = (t) => (t?.mint || "").startsWith("Xs");

const tickToPrice = (t, shift) => Math.pow(1.0001, t) * shift;
const priceToTick = (p, shift) => Math.log(p / shift) / Math.log(1.0001);

// Discover every xStock pool on Byreal (paged), newest stocks included automatically.
export async function discoverStockPools() {
  let all = [], page = 1, total = 0;
  do {
    const d = (await byreal(`pools list --page ${page} --page-size 100`)).data;
    all = all.concat(d.pools || []);
    total = d.total; page++;
  } while (all.length < total && page <= 10);
  return all.filter((p) => isStockToken(p.token_a) || isStockToken(p.token_b));
}

// Ticker symbol from an xStock pool (e.g. "TSLAx/USDC" -> "TSLA").
export function tickerOf(pool) {
  const s = isStockToken(pool.token_a) ? pool.token_a.symbol : pool.token_b.symbol;
  return s.replace(/x$/, "");
}

// The user's LP positions that sit in xStock pools, enriched with live pool data.
export async function portfolio(owner = cfg.ownerWallet) {
  const stocks = await discoverStockPools();
  const byId = new Map(stocks.map((p) => [p.id, p]));
  const positions = (await byreal(`positions list --user ${owner}`)).data.positions || [];
  const rows = positions
    .filter((pos) => byId.has(pos.poolAddress))
    .map((pos) => {
      const pool = byId.get(pos.poolAddress);
      const shift = 10 ** (pool.token_a.decimals - pool.token_b.decimals);
      const price = pool.current_price;
      const curTick = priceToTick(price, shift);
      const lo = tickToPrice(pos.tickLower, shift);
      const hi = tickToPrice(pos.tickUpper, shift);
      const inRange = curTick >= pos.tickLower && curTick <= pos.tickUpper;
      const buffer = inRange ? Math.min((price - lo) / price, (hi - price) / price) * 100 : 0;
      return { pair: pos.pair, ticker: tickerOf(pool), price, lo, hi, inRange, buffer, pos, pool };
    });
  return { stocks, rows };
}

async function main() {
  const { stocks, rows } = await portfolio();
  const usdc = stocks.filter((p) => p.token_b.symbol === "USDC").sort((a, b) => b.total_apr - a.total_apr);
  console.log(`\n=== Byreal xStock universe: ${stocks.length} pools (${usdc.length} vs USDC) ===`);
  usdc.forEach((p) => console.log(`  ${p.token_a.symbol.padEnd(8)} APR ${p.total_apr.toFixed(1).padStart(5)}%  px $${p.current_price.toFixed(2)}  TVL $${Math.round(p.tvl_usd).toLocaleString()}`));
  console.log(`\n=== Your stock LP positions: ${rows.length} ===`);
  if (!rows.length) console.log("  (none in stock pools yet)");
  rows.forEach((r) => console.log(`  ${r.pair.padEnd(12)} ${r.inRange ? "IN RANGE " : "OUT      "} px $${r.price.toFixed(2)}  range $${r.lo.toFixed(2)}-$${r.hi.toFixed(2)}  liq ${r.pos.liquidityUsdDisplay}  fees ${r.pos.earnedUsdDisplay}${r.inRange ? `  buffer ${r.buffer.toFixed(1)}%` : ""}`));
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
