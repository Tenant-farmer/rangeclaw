// RangeClaw - Guardian brain (v2: portfolio-aware, per-ticker earnings).
// decide(row) judges one position; assessPortfolio() judges every stock LP the
// user holds. Market-hours logic is shared across all US equities; earnings is
// per-ticker (cfg.earnings map). assess()/formatGuardian() kept for journal.js.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { snapshot } from "./monitor.js";
import { portfolio } from "./portfolio.js";
import { marketSession, earningsContext } from "./equity.js";
import { dailyCloses } from "./byreal.js";
import { realizedVolDaily, volWidthPct, rebalanceEV } from "./strategy.js";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config.json", import.meta.url)), "utf8"));
const ACTION_EMOJI = { HOLD: "✅", WATCH: "\u{1F440}", WIDEN: "↔\u{FE0F}", REBALANCE: "\u{1F501}", NONE: "—" };

// Apply the shared decision rules to a position + market/earnings context.
function rules(inRange, buffer, ticker, session, earnings) {
  const reasons = [];
  let action = "HOLD";
  if (!inRange) { action = "REBALANCE"; reasons.push("OUT OF RANGE (earning 0 fees)"); }
  else if (buffer < cfg.rebalanceBufferPct) { action = "REBALANCE"; reasons.push(`thin buffer (${buffer.toFixed(1)}%) to a range edge`); }
  else reasons.push(`in range, healthy buffer (${buffer.toFixed(1)}%)`);

  if (earnings.imminent) {
    reasons.push(`${ticker} earnings in ${earnings.daysUntil.toFixed(1)}d -> expect a gap`);
    if (action === "HOLD") action = "WIDEN";
  }
  if (session.isClosed) {
    if (action === "REBALANCE" && inRange) { action = "WATCH"; reasons.push(`market ${session.state} -> defer non-urgent rebalance (gap/thin-liquidity risk)`); }
    else if (action === "WIDEN") reasons.push(`market ${session.state} -> widening range now to survive the gap at open`);
    else if (action === "REBALANCE") reasons.push(`market ${session.state} -> out of range; rebalance with extra slippage guard`);
    else reasons.push(`market ${session.state} -> holding, no rebalance while market closed`);
  } else if (session.minsToClose !== null && session.minsToClose <= 30) {
    reasons.push(`market closes in ${session.minsToClose}m -> watch for after-hours gap`);
  }
  return { action, reasons, rationale: reasons.join("; ") };
}

// Decide for one portfolio row (from portfolio.js).
// ctx may carry { aprPct, sigmaDaily } so the EV gate + vol-sizing can run.
export function decide(row, now = new Date(), ctx = {}) {
  const session = marketSession(now);
  const earnings = earningsContext(cfg.earnings?.[row.ticker], cfg.earningsWindowDays, now);
  const base = rules(row.inRange, row.buffer, row.ticker, session, earnings);
  let action = base.action;
  const reasons = [...base.reasons];

  // EV gate — veto a rebalance whose expected fee recovery can't cover its cost.
  const aprPct = ctx.aprPct ?? row.pool?.total_apr;
  if (action === "REBALANCE" && aprPct) {
    const ev = rebalanceEV(aprPct, cfg.backtestCostBps ?? 20, cfg.evHorizonDays ?? 14);
    if (ev.netBps < 0) {
      action = "WATCH";
      reasons.push(`rebalance EV-negative (~${ev.feeBps.toFixed(0)}bps fees/${ev.horizonDays}d < ${ev.costBps}bps cost) -> hold`);
    } else {
      reasons.push(`rebalance EV +${ev.netBps.toFixed(0)}bps net of cost -> worth it`);
    }
  }

  // Volatility-sized target range (used by the rebalance planner; shown for transparency).
  let targetWidthPct = null;
  if (ctx.sigmaDaily) {
    targetWidthPct = volWidthPct(ctx.sigmaDaily, { horizonDays: cfg.volHorizonDays ?? 7, k: cfg.volK ?? 2 });
    if (targetWidthPct) reasons.push(`σ ${(ctx.sigmaDaily * 100).toFixed(1)}%/d -> target range ±${(targetWidthPct * 100).toFixed(1)}%`);
  }

  return { row, session, earnings, action, reasons, rationale: reasons.join("; "), targetWidthPct, sigmaDaily: ctx.sigmaDaily ?? null };
}

// Judge the whole stock-LP portfolio (fetches per-position realized vol for the EV gate + sizing).
export async function assessPortfolio(owner = cfg.ownerWallet, now = new Date()) {
  const { stocks, rows } = await portfolio(owner);
  const assessments = [];
  for (const r of rows) {
    let sigmaDaily = null;
    try { sigmaDaily = realizedVolDaily(await dailyCloses(r.pool.id, 60)); } catch {}
    assessments.push(decide(r, now, { aprPct: r.pool.total_apr, sigmaDaily }));
  }
  return { stocks, session: marketSession(now), assessments };
}

// Telegram HTML for the whole portfolio.
export function formatPortfolio(p) {
  const mkt = p.session.isOpen ? "\u{1F7E2} OPEN" : `\u{1F534} ${p.session.state}`;
  const lines = [`<b>\u{1F985} RangeClaw — portfolio</b>`, `\u{1F3DB}\u{FE0F} US market: ${mkt}`, ``];
  if (!p.assessments.length) {
    lines.push("No stock LP positions yet. Open one in any xStock/USDC pool and I'll guard it.");
    return lines.join("\n");
  }
  for (const a of p.assessments) {
    const r = a.row;
    const sdot = r.inRange ? "\u{1F7E2}" : "\u{1F534}";
    lines.push(`${ACTION_EMOJI[a.action] || ""} <b>${r.pair}</b> ${sdot} $${r.price.toFixed(2)} — <b>${a.action}</b>`);
    lines.push(`   ${r.inRange ? `buffer ${r.buffer.toFixed(1)}% · range $${r.lo.toFixed(0)}–$${r.hi.toFixed(0)}` : "out of range"} · liq ${r.pos.liquidityUsdDisplay} · fees ${r.pos.earnedUsdDisplay}`);
    if (a.earnings.imminent) lines.push(`   ⚠️ ${r.ticker} earnings in ${a.earnings.daysUntil.toFixed(1)}d`);
  }
  return lines.join("\n");
}

// ---- backward-compat single-position path (used by journal.js) ----
export async function assess(now = new Date()) {
  const s = await snapshot();
  const session = marketSession(now);
  const earnings = earningsContext(cfg.earnings?.TSLA || cfg.nextEarnings, cfg.earningsWindowDays, now);
  if (!s.pos) return { s, session, earnings, action: "NONE", reasons: ["no active position"], rationale: "No active position." };
  const { action, reasons, rationale } = rules(s.inRange, s.buffer, "TSLA", session, earnings);
  return { s, session, earnings, action, reasons, rationale };
}

export function formatGuardian(a) {
  const { s, session, earnings } = a;
  if (!s.pos) return "No active position found.";
  const dot = s.inRange ? "\u{1F7E2}" : "\u{1F534}";
  const lines = [
    `<b>\u{1F985} RangeClaw — ${cfg.pair}</b>`, ``,
    `Price: <b>${s.price.toFixed(2)}</b> USDC/${s.pool.token_a.symbol} · APR ${s.pool.total_apr.toFixed(1)}%`,
    `Range: ${s.lo.toFixed(2)} ~ ${s.hi.toFixed(2)}`,
    `Position: liq ${s.pos.liquidityUsdDisplay} · fees ${s.pos.earnedUsdDisplay} · PnL ${s.pos.pnlUsdDisplay}`, ``,
    s.inRange ? `${dot} IN RANGE · Headroom ↓${s.downPct.toFixed(0)}% ↑${s.upPct.toFixed(0)}%` : `${dot} OUT OF RANGE`,
  ];
  lines.push(session.isOpen ? `\u{1F3DB}\u{FE0F} Market: OPEN` : `\u{1F3DB}\u{FE0F} Market: ${session.state} — TSLA closed`);
  if (earnings.known) lines.push(earnings.imminent ? `\u{1F4C5} Earnings: in ${earnings.daysUntil.toFixed(1)}d ⚠️` : `\u{1F4C5} Earnings: in ${Math.round(earnings.daysUntil)}d (clear)`);
  lines.push(``, `${ACTION_EMOJI[a.action] || ""} <b>Guardian: ${a.action}</b>`);
  for (const r of a.reasons) lines.push(`• ${r}`);
  return lines.join("\n");
}

async function main() {
  const p = await assessPortfolio();
  console.log(`\n=== RangeClaw portfolio · US market ${p.session.state} (${p.session.etTime}) ===`);
  console.log(`xStock universe: ${p.stocks.length} pools · your positions: ${p.assessments.length}`);
  for (const a of p.assessments) {
    const r = a.row;
    console.log(`\n[${r.pair}] $${r.price.toFixed(2)} ${r.inRange ? `IN (buffer ${r.buffer.toFixed(1)}%)` : "OUT"} -> ${a.action}`);
    for (const reason of a.reasons) console.log(`   - ${reason}`);
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
