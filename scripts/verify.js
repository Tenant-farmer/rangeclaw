// Verify AgentJournal on Mantle's explorer via the Etherscan v2 unified API.
// mantlescan is Etherscan-powered, so ONE Etherscan API key works for chainId 5003.
//   1) Get a free key at https://etherscan.io/myapikey
//   2) PowerShell:  $env:ETHERSCAN_API_KEY="yourkey"; npm run verify
// No key? Verify manually in the mantlescan UI (this script prints the exact steps).
// Same source + solc + optimizer settings as deploy, so bytecode/metadata match.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import solc from "solc";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const source = readFileSync(join(root, "contracts", "AgentJournal.sol"), "utf8");

const ADDR = cfg.mantle.journalAddress;
const CHAINID = cfg.mantle.chainId;
const KEY = process.env.ETHERSCAN_API_KEY || process.env.MANTLESCAN_API_KEY;
const API = `https://api.etherscan.io/v2/api?chainid=${CHAINID}`;
const compilerversion = "v" + solc.version().split(".Emscripten")[0]; // e.g. v0.8.35+commit.47b9dedd

const standardInput = {
  language: "Solidity",
  sources: { "AgentJournal.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function printManualSteps() {
  console.log("\nManual verification (no API key needed) — mantlescan UI:");
  console.log(`  URL       : https://sepolia.mantlescan.xyz/verifyContract?a=${ADDR}`);
  console.log("  Type      : Solidity (Single file)");
  console.log(`  Compiler  : ${compilerversion}`);
  console.log("  Optimizer : Yes, 200 runs");
  console.log("  License   : MIT");
  console.log("  Contract  : AgentJournal   (no constructor arguments)");
  console.log("  Source    : paste the contents of app/contracts/AgentJournal.sol\n");
}

async function main() {
  if (!ADDR) throw new Error("No journalAddress in config - deploy first.");
  if (!KEY) {
    console.log("No ETHERSCAN_API_KEY / MANTLESCAN_API_KEY set.");
    printManualSteps();
    return;
  }
  console.log("Verifying", ADDR, "as AgentJournal, compiler", compilerversion, "chainId", CHAINID);
  const form = new URLSearchParams();
  form.set("chainid", String(CHAINID));
  form.set("module", "contract");
  form.set("action", "verifysourcecode");
  form.set("apikey", KEY);
  form.set("codeformat", "solidity-standard-json-input");
  form.set("contractaddress", ADDR);
  form.set("contractname", "AgentJournal.sol:AgentJournal");
  form.set("compilerversion", compilerversion);
  form.set("sourceCode", JSON.stringify(standardInput));
  form.set("optimizationUsed", "1");
  form.set("runs", "200");
  form.set("licenseType", "3"); // MIT

  let sub;
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    sub = await res.json();
  } catch (e) {
    console.log(`API unreachable (${e.message}).`);
    printManualSteps();
    return;
  }
  console.log("submit:", JSON.stringify(sub));
  if (String(sub.status) !== "1") {
    console.log("Not queued (maybe already verified, bad key, or rate-limited).");
    printManualSteps();
    return;
  }
  const guid = sub.result;
  for (let i = 0; i < 12; i++) {
    await sleep(3000);
    try {
      const r = await fetch(`${API}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${KEY}`);
      const st = await r.json();
      console.log("status:", JSON.stringify(st));
      if (/pass|verified/i.test(st.result || "") || String(st.status) === "1") break;
      if (/fail|error/i.test(st.result || "")) break;
    } catch (e) { console.log("poll error:", e.message); }
  }
  console.log("Check:", `https://sepolia.mantlescan.xyz/address/${ADDR}#code`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
