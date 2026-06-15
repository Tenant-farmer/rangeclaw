// Generate web/data.json for the dashboard charts.
// Includes EVERY xStock/USDC pool (price history + APR/TVL); held positions also
// carry their range + Guardian action so the chart shows the band (like TSLAx).
//   node scripts/export-data.js   (re-run + redeploy, or let server.js refresh)

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { byreal } from "../src/byreal.js";
import { portfolio } from "../src/portfolio.js";
import { decide } from "../src/guardian.js";
import { marketSession, earningsContext } from "../src/equity.js";
import { backtest } from "../src/backtest.js";
import { realizedVolDaily, volWidthPct } from "../src/strategy.js";
import { JsonRpcProvider, Contract } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));

const JOURNAL_ABI = [
  "event DecisionLogged(uint256 indexed id, address indexed agent, string action, int24 tickLower, int24 tickUpper, uint256 priceE6, string market, string rationale, uint64 timestamp)",
  "event OutcomeLogged(uint256 indexed id, string pair, int256 feesE6, int256 pnlE6, uint64 timestamp)",
  "function count() view returns (uint256)",
];
const jsleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read the on-chain journal server-side (retry/backoff on rate-limit) so the
// dashboard renders it from data.json instead of hammering the public RPC from
// every visitor's browser (which was hitting -32016 rate-limit errors).
async function readJournal() {
  const provider = new JsonRpcProvider(cfg.mantle.rpc, cfg.mantle.chainId);
  const c = new Contract(cfg.mantle.journalAddress, JOURNAL_ABI, provider);
  const latest = await provider.getBlockNumber();
  const getAll = async (filter) => {
    const acc = []; let from = cfg.mantle.fromBlock || Math.max(0, latest - 9000);
    while (from <= latest) {
      const to = Math.min(from + 9000, latest);
      for (let attempt = 0; ; attempt++) {
        try { acc.push(...(await c.queryFilter(filter, from, to))); break; }
        catch (e) { if (attempt >= 5) throw e; await jsleep(1500 * (attempt + 1)); }
      }
      from = to + 1; await jsleep(300);
    }
    return acc;
  };
  let count = 0; try { count = Number(await c.count()); } catch {}
  const dec = await getAll(c.filters.DecisionLogged());
  const out = await getAll(c.filters.OutcomeLogged());
  return {
    count,
    decisions: dec.map((e) => ({ action: e.args.action, priceE6: e.args.priceE6.toString(), market: e.args.market, rationale: e.args.rationale, tx: e.transactionHash })),
    outcomes: out.map((e) => ({ pair: e.args.pair, feesE6: e.args.feesE6.toString(), pnlE6: e.args.pnlE6.toString(), tx: e.transactionHash })),
  };
}

async function klines(poolId) {
  try {
    const k = (await byreal(`pools klines ${poolId} --interval 1h`)).data.klines || [];
    return k.map((x) => ({ t: x.timestamp, c: +Number(x.close).toFixed(2) })).sort((a, b) => a.t - b.t).slice(-60);
  } catch { return []; }
}

async function klinesDaily(poolId) {
  // ~180 daily closes for the backtest (chart uses the 60h hourly series above)
  try {
    const start = Math.floor(Date.now() / 1000) - 180 * 86400;
    const k = (await byreal(`pools klines ${poolId} --interval 1d --start ${start}`)).data.klines || [];
    return k.map((x) => ({ t: x.timestamp, c: +Number(x.close).toFixed(2) })).sort((a, b) => a.t - b.t).map((x) => x.c).filter((p) => p > 0);
  } catch { return []; }
}

async function main() {
  const now = new Date();
  const { stocks: pools, rows } = await portfolio();
  const session = marketSession(now);
  const heldByPool = new Map(rows.map((r) => [r.pool.id, r]));

  const usdc = pools.filter((p) => p.token_b.symbol === "USDC").sort((a, b) => b.total_apr - a.total_apr);
  const stocks = [];
  for (const p of usdc) {
    const entry = {
      symbol: p.token_a.symbol, ticker: p.token_a.symbol.replace(/x$/, ""),
      poolId: p.id, mintB: p.token_b.mint,
      apr: +p.total_apr.toFixed(1), price: +p.current_price.toFixed(2), tvl: Math.round(p.tvl_usd),
      mcap: cfg.marketCaps?.[p.token_a.symbol.replace(/x$/, "")] ?? 0,
      held: false, klines: await klines(p.id),
    };
    const r = heldByPool.get(p.id);
    if (r) {
      const d = decide(r, now);
      const kl = entry.klines;
      const inRangePct = kl.length ? Math.round((kl.filter((k) => k.c >= r.lo && k.c <= r.hi).length / kl.length) * 100) : null;
      Object.assign(entry, {
        held: true, lo: +r.lo.toFixed(2), hi: +r.hi.toFixed(2),
        inRange: r.inRange, buffer: +r.buffer.toFixed(1), action: d.action, rationale: d.rationale,
        liq: r.pos.liquidityUsdDisplay, fees: r.pos.earnedUsdDisplay, pnl: r.pos.pnlUsdDisplay,
        inRangePct,
      });
    }
    const eDate = cfg.earnings?.[entry.ticker];
    if (eDate) {
      const ec = earningsContext(eDate, cfg.earningsWindowDays, now, (cfg.earningsConfirmed || []).includes(entry.ticker));
      entry.earnings = { date: eDate, daysUntil: Math.round(ec.daysUntil), confirmed: ec.confirmed, imminent: ec.imminent };
    }

    const daily = await klinesDaily(p.id);
    const sigma = realizedVolDaily(daily);
    const widthPct = volWidthPct(sigma, { horizonDays: cfg.volHorizonDays ?? 7, k: cfg.volK ?? 2 }) ?? (cfg.defaultWidthPct ?? 0.05);
    const bt = backtest(daily, { aprPct: entry.apr, widthPct, costBps: cfg.backtestCostBps ?? 20, periodsPerYear: 365 });
    if (bt) { entry.bt = bt; entry.sigmaPct = sigma ? +(sigma * 100).toFixed(1) : null; entry.widthPct = +(widthPct * 100).toFixed(1); }
    stocks.push(entry);
  }
  stocks.sort((a, b) => (b.mcap - a.mcap) || (b.apr - a.apr)); // market cap desc

  let journal = null;
  try { journal = await readJournal(); }
  catch (e) {
    console.error("journal read failed (keeping previous snapshot):", e.message);
    try { journal = JSON.parse(readFileSync(join(root, "web", "data.json"), "utf8")).journal || null; } catch {}
  }

  const out = {
    generatedAt: now.toISOString(),
    market: { state: session.state, isOpen: session.isOpen, etTime: session.etTime },
    mantle: { journal: cfg.mantle.journalAddress, explorer: cfg.mantle.explorer, chainId: cfg.mantle.chainId, rpc: cfg.mantle.rpc, fromBlock: cfg.mantle.fromBlock ?? 0 },
    journal: journal || { count: 0, decisions: [], outcomes: [] },
    stocks,
  };
  writeFileSync(join(root, "web", "data.json"), JSON.stringify(out));
  console.log(`Wrote data.json · market=${session.state} · stocks=${stocks.length} · held=${rows.length} · journal=${out.journal.decisions.length} decisions/${out.journal.outcomes.length} outcomes (count=${out.journal.count})`);
  stocks.forEach((s) => console.log(`  ${s.symbol.padEnd(7)} σ${s.sigmaPct ?? "-"}% ±${s.widthPct ?? "-"}% APR ${s.apr}% · netEdge ${s.bt ? s.bt.netEdgeBps : "-"}bps (${s.bt ? s.bt.rebalances : "-"} rebal)`));
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
