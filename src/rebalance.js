// RangeClaw - rebalance planner (v2: any stock position).
// planRebalance(row) recenters ANY xStock/USDC position (per-pool decimals) and
// emits non-custodial byreal-cli commands (--unsigned-tx, you sign). planAll()
// produces a plan for every position. No funds move here.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { portfolio } from "./portfolio.js";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));

export function planRebalance(row, opts = {}) {
  const pool = row.pool;
  const shift = 10 ** (pool.token_a.decimals - pool.token_b.decimals);
  const tickToPrice = (t) => Math.pow(1.0001, t) * shift;
  const priceToTick = (p) => Math.log(p / shift) / Math.log(1.0001);
  const widen = opts.widen ?? false;
  const width = Math.round((row.pos.tickUpper - row.pos.tickLower) * (widen ? (cfg.earningsWidenFactor || 1.5) : 1));
  const half = Math.round(width / 2);
  const curTick = Math.round(priceToTick(row.price));
  const newLow = tickToPrice(curTick - half);
  const newHigh = tickToPrice(curTick + half);
  const owner = cfg.ownerWallet;
  const outMint = pool.token_b.mint; // USDC side
  const closeCmd = `byreal-cli positions close --nft-mint ${row.pos.nftMintAddress} --auto-swap --output-mint ${outMint} --unsigned-tx --wallet-address ${owner}`;
  const openCmd = `byreal-cli positions open --pool ${pool.id} --price-lower ${newLow.toFixed(2)} --price-upper ${newHigh.toFixed(2)} --base ${outMint} --amount <USDC_FROM_CLOSE> --auto-swap --unsigned-tx --wallet-address ${owner}`;
  return {
    pair: row.pair, widen,
    oldLow: tickToPrice(row.pos.tickLower), oldHigh: tickToPrice(row.pos.tickUpper),
    newLow, newHigh, price: row.price, liq: row.pos.liquidityUsdDisplay,
    closeCmd, openCmd,
  };
}

export async function planAll(owner = cfg.ownerWallet) {
  const { rows } = await portfolio(owner);
  return rows.map((r) => planRebalance(r));
}

export function formatPlan(p) {
  if (!p) return "No position to rebalance.";
  return [
    `<b>\u{1F501} ${p.pair} rebalance${p.widen ? " (WIDEN)" : ""}</b>`,
    `Current $${p.price.toFixed(2)} · old $${p.oldLow.toFixed(2)}–$${p.oldHigh.toFixed(2)}`,
    `→ new <b>$${p.newLow.toFixed(2)}–$${p.newHigh.toFixed(2)}</b> (recentered, ${p.liq})`,
    `<i>non-custodial: emits an unsigned tx you sign</i>`,
  ].join("\n");
}

async function main() {
  const plans = await planAll();
  if (!plans.length) { console.log("No stock positions to plan."); return; }
  for (const p of plans) {
    console.log(`\n[${p.pair}] $${p.price.toFixed(2)}  old $${p.oldLow.toFixed(2)}-$${p.oldHigh.toFixed(2)} -> new $${p.newLow.toFixed(2)}-$${p.newHigh.toFixed(2)}`);
    console.log(`  close: ${p.closeCmd}`);
    console.log(`  open : ${p.openCmd}`);
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
