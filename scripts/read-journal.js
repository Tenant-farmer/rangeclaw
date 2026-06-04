// Read the AgentJournal from Mantle exactly like the web dashboard does
// (count + DecisionLogged events). Confirms the frontend's data path works.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JsonRpcProvider, Contract } from "ethers";

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, "..", "config.json"), "utf8"));
const ABI = [
  "event DecisionLogged(uint256 indexed id, address indexed agent, string action, int24 tickLower, int24 tickUpper, uint256 priceE6, string market, string rationale, uint64 timestamp)",
  "function count() view returns (uint256)",
];
const provider = new JsonRpcProvider(cfg.mantle.rpc, cfg.mantle.chainId);
const c = new Contract(cfg.mantle.journalAddress, ABI, provider);

console.log("Journal:", cfg.mantle.journalAddress);
console.log("count   :", (await c.count()).toString());
const events = await c.queryFilter(c.filters.DecisionLogged(), 39510000, "latest");
console.log("events  :", events.length);
for (const e of events) {
  const d = e.args;
  console.log(`  [${d.action}] $${(Number(d.priceE6) / 1e6).toFixed(2)} ${d.market} | ${d.rationale} | tx ${e.transactionHash.slice(0, 12)}…`);
}
