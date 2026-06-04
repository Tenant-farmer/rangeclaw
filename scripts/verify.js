// Verify AgentJournal on Mantle's Blockscout explorer (Etherscan-compatible API,
// standard-json-input). Uses the SAME source + solc + optimizer settings as deploy,
// so the bytecode/metadata match. Run after deploy:  node scripts/verify.js
// If the explorer API is down (503), just retry later - verification is not blocking.

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
const API = cfg.mantle.explorer + "/api";
const compilerversion = "v" + solc.version().split(".Emscripten")[0]; // e.g. v0.8.35+commit.47b9dedd

const standardInput = {
  language: "Solidity",
  sources: { "AgentJournal.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!ADDR) throw new Error("No journalAddress in config - deploy first.");
  console.log("Verifying", ADDR, "as AgentJournal, compiler", compilerversion);

  const form = new URLSearchParams();
  form.set("module", "contract");
  form.set("action", "verifysourcecode");
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
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    sub = await res.json();
  } catch (e) {
    throw new Error(`Explorer API unreachable (${e.message}). It may be temporarily down (503) - retry later, or verify via the explorer UI (Standard-JSON-Input, ${compilerversion}, optimizer 200 runs, MIT).`);
  }
  console.log("submit:", JSON.stringify(sub));
  if (String(sub.status) !== "1") {
    console.log("Not queued. If it says already verified, you're done. Otherwise retry, or use the UI.");
    return;
  }
  const guid = sub.result;
  for (let i = 0; i < 12; i++) {
    await sleep(3000);
    try {
      const r = await fetch(`${API}?module=contract&action=checkverifystatus&guid=${guid}`);
      const st = await r.json();
      console.log("status:", JSON.stringify(st));
      if (/pass|verified/i.test(st.result || "") || String(st.status) === "1") break;
      if (/fail|error/i.test(st.result || "")) break;
    } catch (e) { console.log("poll error:", e.message); }
  }
  console.log("Code page:", `${cfg.mantle.explorer}/address/${ADDR}#code`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
