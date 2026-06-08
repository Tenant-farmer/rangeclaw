// RangeClaw - delta-hedge advisor (Byreal Perps CLI, Hyperliquid).
// An xStock LP is net-long the stock, so it loses when price falls. This suggests
// a short perp to neutralize that directional risk — sizing it to the position's
// stock-side exposure and emitting the Byreal Perps command. ADVISORY ONLY:
// it never places an order (perps trading needs your own account + signature).

import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { portfolio } from "./portfolio.js";

const pexec = promisify(exec);
async function perps(args) {
  const { stdout } = await pexec(`byreal-perps-cli -o json ${args}`, { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function hedgePlan(owner) {
  const { rows } = await portfolio(owner);
  const out = [];
  for (const r of rows) {
    const liq = parseFloat(r.pos.liquidityUsd) || 0;
    const deltaUsd = Math.round(liq / 2); // ~stock-side notional for a centered CLMM range
    let perp = null;
    try { perp = (await perps(`signal detail ${r.ticker}`)).data; } catch {}
    if (perp && perp.price) {
      const px = parseFloat(perp.price);
      const size = +(deltaUsd / px).toFixed(2);
      out.push({ pair: r.pair, ticker: r.ticker, deltaUsd, perp: perp.coin, perpPrice: px, size, funding: perp.fundingAnnualized, cmd: `byreal-perps-cli order market sell ${size} ${r.ticker}` });
    } else {
      out.push({ pair: r.pair, ticker: r.ticker, deltaUsd, perp: null });
    }
  }
  return out;
}

async function main() {
  const plans = await hedgePlan();
  if (!plans.length) { console.log("No stock LP positions to hedge."); return; }
  for (const h of plans) {
    console.log(`\n[${h.pair}] LP is long ~$${h.deltaUsd} ${h.ticker} (centered estimate)`);
    if (h.perp) {
      console.log(`  hedge: SHORT ${h.size} ${h.ticker}  (${h.perp} @ $${h.perpPrice}, funding ${h.funding}/yr)`);
      console.log(`  cmd  : ${h.cmd}   [advisory · non-custodial · you sign]`);
    } else {
      console.log(`  no Hyperliquid perp found for ${h.ticker} — hedge unavailable`);
    }
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
