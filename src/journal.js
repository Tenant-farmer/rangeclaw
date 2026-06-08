// RangeClaw - on-chain journal writer (v2: whole portfolio).
// Logs EACH stock position's current Guardian decision to the AgentJournal
// contract on Mantle, tagging the rationale with the pair so multiple stocks'
// decisions are distinguishable on-chain and in the dashboard.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { Contract } from "ethers";
import { getProvider, loadWallet } from "./evm.js";
import { assess, assessPortfolio } from "./guardian.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(root, "contracts", "AgentJournal.abi.json"), "utf8"));

function journalWith(conn) {
  if (!cfg.mantle.journalAddress) throw new Error("No journalAddress in config - deploy first.");
  return new Contract(cfg.mantle.journalAddress, abi, conn);
}

async function logDecision(journal, { pair, price, pos, action, market, rationale }) {
  const priceE6 = BigInt(Math.round(price * 1e6));
  return journal.logDecision(action, pos.tickLower, pos.tickUpper, priceE6, market, `[${pair}] ${rationale}`);
}

// Log every stock-LP position's current decision on-chain.
export async function logPortfolio() {
  const wallet = loadWallet(getProvider());
  if (!wallet) throw new Error("No EVM wallet - run: node src/evm.js generate");
  const journal = journalWith(wallet);
  const p = await assessPortfolio();
  const out = [];
  for (const a of p.assessments) {
    const tx = await logDecision(journal, {
      pair: a.row.pair, price: a.row.price, pos: a.row.pos,
      action: a.action, market: a.session.state, rationale: a.rationale,
    });
    console.log(`  ${a.row.pair} ${a.action} -> ${tx.hash}`);
    await tx.wait();
    out.push({ pair: a.row.pair, action: a.action, tx: tx.hash });
  }
  return out;
}

// Backward-compat single-position log (TSLAx via assess()).
export async function logCurrentDecision() {
  const a = await assess();
  if (!a.s.pos) throw new Error("No active position to log.");
  const journal = journalWith(loadWallet(getProvider()));
  const tx = await logDecision(journal, { pair: cfg.pair, price: a.s.price, pos: a.s.pos, action: a.action, market: a.session.state, rationale: a.rationale });
  return { a, tx };
}

async function main() {
  console.log("Logging portfolio decisions on-chain (Mantle Sepolia)...");
  const results = await logPortfolio();
  if (!results.length) { console.log("No stock positions to log."); return; }
  const count = await journalWith(getProvider()).count();
  console.log(`\n✅ Logged ${results.length} decision(s). On-chain total: ${count.toString()}`);
  console.log(`   Explorer: ${cfg.mantle.explorer}/address/${cfg.mantle.journalAddress}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
