// Range Guardian - Monitor
// Reads the live pool + your LP position (read-only, no private key) and computes
// in-range status + headroom. Exposes snapshot() and formatReport() for reuse by
// the Telegram bot; prints a console report when invoked directly.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { poolInfo, listPositions } from "./byreal.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, "..", "config.json"), "utf8"));

// CLMM tick <-> human price (token B per token A), adjusted for decimals.
const shift = 10 ** (cfg.decimalsA - cfg.decimalsB);
export const tickToPrice = (t) => Math.pow(1.0001, t) * shift;
export const priceToTick = (p) => Math.log(p / shift) / Math.log(1.0001);

export async function snapshot() {
  const pool = (await poolInfo(cfg.poolAddress)).data;
  const positions = (await listPositions(cfg.ownerWallet, cfg.poolAddress)).data.positions;
  const pos = positions.find((p) => p.nftMintAddress === cfg.positionNft) || positions[0];
  if (!pos) return { pool, pos: null };
  const price = pool.current_price;
  const curTick = priceToTick(price);
  const lo = tickToPrice(pos.tickLower);
  const hi = tickToPrice(pos.tickUpper);
  const inRange = curTick >= pos.tickLower && curTick <= pos.tickUpper;
  const downPct = ((price - lo) / price) * 100;
  const upPct = ((hi - price) / price) * 100;
  const buffer = Math.min(downPct, upPct);
  return { pool, pos, price, lo, hi, inRange, downPct, upPct, buffer };
}

// Telegram-friendly HTML report (emoji render fine in Telegram).
export function formatReport(s) {
  if (!s.pos) return "No active position found.";
  const dot = s.inRange ? "\u{1F7E2}" : "\u{1F534}";
  const guard = !s.inRange
    ? "\u{1F6A8} out of range — earning 0 fees, rebalance recommended"
    : s.buffer < cfg.rebalanceBufferPct
      ? "⚠️ near edge — rebalance soon"
      : "✅ healthy, holding";
  const lines = [
    `<b>\u{1F985} RangeClaw — ${cfg.pair}</b>`,
    ``,
    `Price: <b>${s.price.toFixed(2)}</b> USDC/${s.pool.token_a.symbol}  ·  APR ${s.pool.total_apr.toFixed(1)}%`,
    `Range: ${s.lo.toFixed(2)} ~ ${s.hi.toFixed(2)}`,
    `Position: liq ${s.pos.liquidityUsdDisplay} · fees ${s.pos.earnedUsdDisplay} · PnL ${s.pos.pnlUsdDisplay}`,
    ``,
    `${dot} <b>${s.inRange ? "IN RANGE" : "OUT OF RANGE"}</b>`,
  ];
  if (s.inRange) lines.push(`Headroom: down ${s.downPct.toFixed(1)}%  ·  up ${s.upPct.toFixed(1)}%`);
  lines.push(`Guardian: ${guard}`);
  return lines.join("\n");
}

async function main() {
  const s = await snapshot();
  if (!s.pos) { console.log("No active position found for", cfg.ownerWallet); return; }
  console.log(`\n=== Range Guardian | Monitor (${cfg.pair}) ===`);
  console.log(`Current price : ${s.price.toFixed(2)} USDC/${s.pool.token_a.symbol}   (APR ${s.pool.total_apr.toFixed(1)}%, TVL $${(s.pool.tvl_usd / 1000).toFixed(0)}K)`);
  console.log(`Your range    : ${s.lo.toFixed(2)}  ~  ${s.hi.toFixed(2)}   (ticks ${s.pos.tickLower}..${s.pos.tickUpper})`);
  console.log(`Position      : liq ${s.pos.liquidityUsdDisplay} | fees ${s.pos.earnedUsdDisplay} | PnL ${s.pos.pnlUsdDisplay}`);
  console.log(`Status        : ${s.inRange ? "IN RANGE" : "OUT OF RANGE"}`);
  if (s.inRange) {
    console.log(`Headroom      : down ${s.downPct.toFixed(1)}%  |  up ${s.upPct.toFixed(1)}%  (buffer ${s.buffer.toFixed(1)}%)`);
    console.log(`Guardian      : ${s.buffer < cfg.rebalanceBufferPct ? "WARN - near edge, rebalance soon" : "OK - healthy, holding"}`);
  } else {
    console.log(`Guardian      : ALERT - out of range, earning 0 fees. Rebalance recommended.`);
  }
  console.log("");
}

// Console report only when run directly (node src/monitor.js), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
