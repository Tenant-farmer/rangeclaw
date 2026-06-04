// RangeClaw - Guardian brain.
// Combines the read-only position snapshot with equity-market context (market
// hours, weekends, earnings) into one decision + plain-language rationale.
// This is the "risk-check" step (Plutus-style: verify before acting) folded into
// a single function -- the project's core differentiator vs a generic LP bot.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { snapshot } from "./monitor.js";
import { marketSession, earningsContext } from "./equity.js";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));

// action: HOLD | WATCH | WIDEN | REBALANCE | NONE
export async function assess(now = new Date()) {
  const s = await snapshot();
  const session = marketSession(now);
  const earnings = earningsContext(cfg.nextEarnings, cfg.earningsWindowDays, now);
  const reasons = [];
  let action = "HOLD";

  if (!s.pos) {
    return { s, session, earnings, action: "NONE", reasons: ["no active position"], rationale: "No active position to manage." };
  }

  // 1) Range health
  if (!s.inRange) {
    action = "REBALANCE";
    reasons.push("position is OUT OF RANGE (earning 0 fees)");
  } else if (s.buffer < cfg.rebalanceBufferPct) {
    action = "REBALANCE";
    reasons.push(`thin buffer (${s.buffer.toFixed(1)}%) to a range edge`);
  } else {
    reasons.push(`in range, healthy buffer (${s.buffer.toFixed(1)}%)`);
  }

  // 2) Equity-quirk layer (the differentiator)
  if (earnings.imminent) {
    reasons.push(`TSLA earnings in ${earnings.daysUntil.toFixed(1)}d -> expect a gap`);
    if (action === "HOLD") action = "WIDEN"; // proactively widen even if currently healthy
  }
  if (session.isClosed) {
    if (action === "REBALANCE" && s.inRange) {
      action = "WATCH"; // not urgent: defer acting on thin/stale price while market is closed
      reasons.push(`market ${session.state} -> defer non-urgent rebalance (gap / thin-liquidity risk)`);
    } else if (action === "REBALANCE") {
      reasons.push(`market ${session.state} -> out of range; rebalance with extra slippage guard`);
    } else if (action === "WIDEN") {
      reasons.push(`market ${session.state} -> widening range now to survive the gap at open`);
    } else {
      reasons.push(`market ${session.state} -> holding, no rebalance while market closed`);
    }
  } else if (session.minsToClose !== null && session.minsToClose <= 30) {
    reasons.push(`market closes in ${session.minsToClose}m -> watch for after-hours gap`);
  }

  return { s, session, earnings, action, reasons, rationale: reasons.join("; ") };
}

const ACTION_EMOJI = { HOLD: "✅", WATCH: "\u{1F440}", WIDEN: "↔\u{FE0F}", REBALANCE: "\u{1F501}", NONE: "—" };

// Telegram HTML report.
export function formatGuardian(a) {
  const { s, session, earnings } = a;
  if (!s.pos) return "No active position found.";
  const dot = s.inRange ? "\u{1F7E2}" : "\u{1F534}";

  const lines = [];
  lines.push(`<b>\u{1F985} RangeClaw — ${cfg.pair}</b>`);
  lines.push("");
  lines.push(`Price: <b>${s.price.toFixed(2)}</b> USDC/${s.pool.token_a.symbol} · APR ${s.pool.total_apr.toFixed(1)}%`);
  lines.push(`Range: ${s.lo.toFixed(2)} ~ ${s.hi.toFixed(2)}`);
  lines.push(`Position: liq ${s.pos.liquidityUsdDisplay} · fees ${s.pos.earnedUsdDisplay} · PnL ${s.pos.pnlUsdDisplay}`);
  lines.push("");
  lines.push(s.inRange ? `${dot} IN RANGE · Headroom ↓${s.downPct.toFixed(0)}% ↑${s.upPct.toFixed(0)}%` : `${dot} OUT OF RANGE`);
  lines.push(session.isOpen
    ? `\u{1F3DB}\u{FE0F} Market: OPEN${session.minsToClose <= 60 ? ` (closes in ${session.minsToClose}m)` : ""}`
    : `\u{1F3DB}\u{FE0F} Market: ${session.state} — TSLA closed`);
  if (earnings.known) {
    lines.push(earnings.imminent
      ? `\u{1F4C5} Earnings: in ${earnings.daysUntil.toFixed(1)}d ⚠️ gap risk`
      : `\u{1F4C5} Earnings: in ${Math.round(earnings.daysUntil)}d (clear)`);
  }
  lines.push("");
  lines.push(`${ACTION_EMOJI[a.action] || ""} <b>Guardian: ${a.action}</b>`);
  for (const r of a.reasons) lines.push(`• ${r}`);
  return lines.join("\n");
}

async function main() {
  const a = await assess();
  console.log(`\n=== Guardian assessment ===`);
  console.log(`Market  : ${a.session.etTime} | ${a.session.state}`);
  console.log(`Earnings: ${a.earnings.known ? a.earnings.daysUntil.toFixed(1) + "d" + (a.earnings.imminent ? " (IMMINENT)" : "") : "unknown"}`);
  console.log(`Action  : ${a.action}`);
  for (const r of a.reasons) console.log(`  - ${r}`);
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
