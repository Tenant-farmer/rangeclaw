// RangeClaw - Rebalance planner.
// Computes the NEW range for a rebalance (recenter on current price, preserve
// width; widen ahead of earnings) and emits the exact byreal-cli commands.
// It does NOT move funds. Execution uses byreal-cli's NON-CUSTODIAL path:
//   --unsigned-tx --wallet-address <you>  -> outputs an unsigned tx YOU sign,
// or --dry-run to preview. RangeClaw never holds your private key.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { tickToPrice, priceToTick } from "./monitor.js";
import { assess } from "./guardian.js";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));

export function planRebalance(a) {
  const { s, action } = a;
  if (!s.pos) return null;
  const curWidth = s.pos.tickUpper - s.pos.tickLower;
  const widen = action === "WIDEN";
  const width = Math.round(curWidth * (widen ? (cfg.earningsWidenFactor || 1.5) : 1));
  const half = Math.round(width / 2);
  const curTick = Math.round(priceToTick(s.price));
  const newTickLower = curTick - half;
  const newTickUpper = curTick + half;
  const newLow = tickToPrice(newTickLower);
  const newHigh = tickToPrice(newTickUpper);
  const owner = cfg.ownerWallet;

  // Step 1: close current position, collapse to USDC (non-custodial unsigned tx).
  const closeCmd = `byreal-cli positions close --nft-mint ${cfg.positionNft} --auto-swap --output-mint ${cfg.tokenBMint} --unsigned-tx --wallet-address ${owner}`;
  // Step 2: open the new range, depositing that USDC via auto-swap.
  const openCmd = `byreal-cli positions open --pool ${cfg.poolAddress} --price-lower ${newLow.toFixed(2)} --price-upper ${newHigh.toFixed(2)} --base ${cfg.tokenBMint} --amount <USDC_FROM_CLOSE> --auto-swap --unsigned-tx --wallet-address ${owner}`;

  return {
    action, widen,
    oldLow: tickToPrice(s.pos.tickLower), oldHigh: tickToPrice(s.pos.tickUpper),
    newLow, newHigh, newTickLower, newTickUpper, widthTicks: width,
    price: s.price, liqUsd: s.pos.liquidityUsdDisplay,
    closeCmd, openCmd,
  };
}

export function formatPlan(p) {
  if (!p) return "No position to rebalance.";
  return [
    `<b>\u{1F501} Rebalance plan${p.widen ? " — WIDEN for earnings" : ""}</b>`,
    ``,
    `Current price: ${p.price.toFixed(2)}`,
    `Old range: ${p.oldLow.toFixed(2)} ~ ${p.oldHigh.toFixed(2)}`,
    `New range: <b>${p.newLow.toFixed(2)} ~ ${p.newHigh.toFixed(2)}</b> (recentered)`,
    `Liquidity ${p.liqUsd} → redeployed via auto-swap`,
    ``,
    `<i>Non-custodial: outputs an unsigned tx you sign. RangeClaw never holds your key.</i>`,
  ].join("\n");
}

async function main() {
  const a = await assess();
  const p = planRebalance(a);
  console.log(`\n=== Rebalance plan (current Guardian action: ${a.action}) ===`);
  if (!p) { console.log("No position."); return; }
  console.log(`Current price : ${p.price.toFixed(2)}`);
  console.log(`Old range     : ${p.oldLow.toFixed(2)} ~ ${p.oldHigh.toFixed(2)}`);
  console.log(`New range     : ${p.newLow.toFixed(2)} ~ ${p.newHigh.toFixed(2)}   (width ${p.widthTicks} ticks${p.widen ? ", WIDENED" : ""})`);
  console.log(`\nStep 1 (close → USDC, non-custodial unsigned tx):\n  ${p.closeCmd}`);
  console.log(`\nStep 2 (open new range):\n  ${p.openCmd}`);
  console.log(`\nNote: swap --unsigned-tx for --dry-run to preview, or --confirm to execute (needs YOUR wallet set locally).`);
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
