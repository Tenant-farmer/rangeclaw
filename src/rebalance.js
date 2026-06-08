// RangeClaw - rebalance planner (v2: any stock position).
// planRebalance(row) recenters ANY xStock/USDC position (per-pool decimals) and
// emits non-custodial byreal-cli commands (--unsigned-tx, you sign). planAll()
// produces a plan for every position. No funds move here.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { portfolio } from "./portfolio.js";
import { dailyCloses, swapQuote } from "./byreal.js";
import { realizedVolDaily, volWidthPct } from "./strategy.js";
import { tickToPrice as t2p, priceToTick as p2t } from "./tickmath.js";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));

export function planRebalance(row, opts = {}) {
  const pool = row.pool;
  const decA = pool.token_a.decimals, decB = pool.token_b.decimals;
  const tickToPrice = (t) => t2p(t, decA, decB);
  const priceToTick = (p) => p2t(p, decA, decB);
  const widen = opts.widen ?? false;
  const widenFactor = widen ? (cfg.earningsWidenFactor || 1.5) : 1;
  const curTick = Math.round(priceToTick(row.price));

  let half;
  if (opts.targetWidthPct) {
    // volatility-sized: ±targetWidthPct around the current price (in ticks)
    const upperTick = priceToTick(row.price * (1 + opts.targetWidthPct * widenFactor));
    half = Math.max(1, Math.round(upperTick - curTick));
  } else {
    const width = Math.round((row.pos.tickUpper - row.pos.tickLower) * widenFactor);
    half = Math.round(width / 2);
  }
  const newLow = tickToPrice(curTick - half);
  const newHigh = tickToPrice(curTick + half);
  const owner = cfg.ownerWallet;
  const outMint = pool.token_b.mint; // USDC side
  const closeCmd = `byreal-cli positions close --nft-mint ${row.pos.nftMintAddress} --auto-swap --output-mint ${outMint} --unsigned-tx --wallet-address ${owner}`;
  const openCmd = `byreal-cli positions open --pool ${pool.id} --price-lower ${newLow.toFixed(2)} --price-upper ${newHigh.toFixed(2)} --base ${outMint} --amount <USDC_FROM_CLOSE> --auto-swap --unsigned-tx --wallet-address ${owner}`;
  return {
    pair: row.pair, widen, widthPct: opts.targetWidthPct ?? null,
    oldLow: tickToPrice(row.pos.tickLower), oldHigh: tickToPrice(row.pos.tickUpper),
    newLow, newHigh, price: row.price, liq: row.pos.liquidityUsdDisplay,
    closeCmd, openCmd,
  };
}

export async function planAll(owner = cfg.ownerWallet) {
  const { rows } = await portfolio(owner);
  const plans = [];
  for (const r of rows) {
    let targetWidthPct = null;
    try { targetWidthPct = volWidthPct(realizedVolDaily(await dailyCloses(r.pool.id, 60)), { horizonDays: cfg.volHorizonDays ?? 7, k: cfg.volK ?? 2 }); } catch {}
    const plan = planRebalance(r, { targetWidthPct });
    // validate the recenter against the live AMM: price impact of swapping the stock-side notional
    try {
      const stockAmt = ((parseFloat(r.pos.liquidityUsd) || 0) / 2) / r.price;
      if (stockAmt > 0) plan.quotedImpactPct = (await swapQuote(r.pool.token_a.mint, r.pool.token_b.mint, stockAmt.toFixed(4))).priceImpactPct;
    } catch {}
    plans.push(plan);
  }
  return plans;
}

export function formatPlan(p) {
  if (!p) return "No position to rebalance.";
  return [
    `<b>\u{1F501} ${p.pair} rebalance${p.widen ? " (WIDEN)" : ""}</b>`,
    `Current $${p.price.toFixed(2)} · old $${p.oldLow.toFixed(2)}–$${p.oldHigh.toFixed(2)}`,
    `→ new <b>$${p.newLow.toFixed(2)}–$${p.newHigh.toFixed(2)}</b> (recentered, ${p.liq})`,
    p.widthPct ? `\u{1F4CF} vol-sized ±${(p.widthPct * 100).toFixed(1)}% range` : "",
    `\u{1F4B5} closes ~${p.liq} · ~${cfg.backtestCostBps ?? 20}bps est. cost (slippage+gas)`,
    p.quotedImpactPct != null ? `\u{1F50E} live Byreal quote: ${p.quotedImpactPct.toFixed(2)}% price impact on the recenter swap` : "",
    `<i>non-custodial: emits an unsigned tx you sign</i>`,
  ].filter(Boolean).join("\n");
}

async function main() {
  const plans = await planAll();
  if (!plans.length) { console.log("No stock positions to plan."); return; }
  for (const p of plans) {
    console.log(`\n[${p.pair}] $${p.price.toFixed(2)}  old $${p.oldLow.toFixed(2)}-$${p.oldHigh.toFixed(2)} -> new $${p.newLow.toFixed(2)}-$${p.newHigh.toFixed(2)}${p.quotedImpactPct != null ? `  · quote ${p.quotedImpactPct.toFixed(2)}% impact` : ""}`);
    console.log(`  close: ${p.closeCmd}`);
    console.log(`  open : ${p.openCmd}`);
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
