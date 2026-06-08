// RangeClaw - log a decision + realized outcome for every held position, on-chain, now.
// A manual one-shot of what agent-loop does each tick (handy to seed/refresh the
// journal). Signs with the local EVM agent wallet.  node scripts/snapshot.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { Contract } from "ethers";
import { getProvider, loadWallet } from "../src/evm.js";
import { assessPortfolio } from "../src/guardian.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(root, "contracts", "AgentJournal.abi.json"), "utf8"));
const num = (s) => { const m = String(s ?? "").replace(/[$,]/g, "").match(/-?[\d.]+/); return m ? parseFloat(m[0]) : 0; };

async function main() {
  const p = await assessPortfolio();
  const j = new Contract(cfg.mantle.journalAddress, abi, loadWallet(getProvider()));
  for (const a of p.assessments) {
    const r = a.row;
    const tx1 = await j.logDecision(a.action, r.pos.tickLower, r.pos.tickUpper, BigInt(Math.round(r.price * 1e6)), a.session.state, `[${r.pair}] ${a.rationale}`);
    await tx1.wait();
    console.log(`decision ${r.pair} ${a.action}  ${tx1.hash}`);
    const fees = num(r.pos.earnedUsdDisplay), pnl = num(r.pos.pnlUsdDisplay);
    const tx2 = await j.logOutcome(r.pair, BigInt(Math.round(fees * 1e6)), BigInt(Math.round(pnl * 1e6)));
    await tx2.wait();
    console.log(`outcome  ${r.pair} fees $${fees} pnl $${pnl}  ${tx2.hash}`);
  }
  console.log(`\ncount=${(await j.count()).toString()} outcomes=${(await j.outcomeCount()).toString()} @ ${cfg.mantle.journalAddress}`);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
