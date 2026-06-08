// RangeClaw - autonomous loop.
// Every INTERVAL: assess the whole stock portfolio, log any CHANGED decision
// on-chain (deduped via .state.json so the journal stays meaningful), and refresh
// web/data.json for the dashboard. First run establishes a baseline (no spam).
//   node scripts/agent-loop.js        (RG_INTERVAL_MIN=15 by default)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Contract } from "ethers";
import { getProvider, loadWallet } from "../src/evm.js";
import { assessPortfolio } from "../src/guardian.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(root, "contracts", "AgentJournal.abi.json"), "utf8"));
const STATE = join(root, ".state.json");
const INTERVAL_MIN = Number(process.env.RG_INTERVAL_MIN || 15);
const pexec = promisify(execFile);

const loadState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const refreshData = () => pexec(process.execPath, [join(root, "scripts", "export-data.js")]).catch((e) => console.error("export-data:", e.message));

async function tick() {
  const ts = new Date().toISOString();
  const p = await assessPortfolio();
  let state = loadState();
  const baseline = state === null; // first run: record actions, don't log
  state = state || {};

  if (!baseline) {
    const journal = new Contract(cfg.mantle.journalAddress, abi, loadWallet(getProvider()));
    for (const a of p.assessments) {
      if (state[a.row.pair] !== a.action) {
        const priceE6 = BigInt(Math.round(a.row.price * 1e6));
        const tx = await journal.logDecision(a.action, a.row.pos.tickLower, a.row.pos.tickUpper, priceE6, a.session.state, `[${a.row.pair}] ${a.rationale}`);
        await tx.wait();
        console.log(`${ts}  ${a.row.pair} ${state[a.row.pair] || "—"} -> ${a.action}  on-chain ${tx.hash.slice(0, 12)}…`);
      }
    }
  }
  for (const a of p.assessments) state[a.row.pair] = a.action;
  saveState(state);
  await refreshData();
  console.log(`${ts}  tick ${baseline ? "(baseline)" : "done"} · market ${p.session.state} · positions ${p.assessments.length}`);
}

console.log(`RangeClaw agent-loop · every ${INTERVAL_MIN}m · log-on-change`);
await tick();
setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), INTERVAL_MIN * 60 * 1000);
