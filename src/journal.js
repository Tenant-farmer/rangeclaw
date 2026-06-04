// RangeClaw - on-chain journal writer.
// Writes the current Guardian decision to the AgentJournal contract on Mantle
// (logDecision = "inference result written on-chain"). This is the AI-powered,
// on-chain-callable function the 20 Project Deployment Award requires.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { Contract } from "ethers";
import { getProvider, loadWallet } from "./evm.js";
import { assess } from "./guardian.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(root, "contracts", "AgentJournal.abi.json"), "utf8"));

function journalWith(connection) {
  if (!cfg.mantle.journalAddress) throw new Error("No journalAddress in config - deploy first.");
  return new Contract(cfg.mantle.journalAddress, abi, connection);
}

// Record the current Guardian decision on-chain. Returns the sent tx + assessment.
export async function logCurrentDecision() {
  const a = await assess();
  if (!a.s.pos) throw new Error("No active position to log.");
  const wallet = loadWallet(getProvider());
  if (!wallet) throw new Error("No EVM wallet - run: node src/evm.js generate");
  const journal = journalWith(wallet);
  const priceE6 = BigInt(Math.round(a.s.price * 1e6));
  const tx = await journal.logDecision(
    a.action,
    a.s.pos.tickLower,
    a.s.pos.tickUpper,
    priceE6,
    a.session.state,
    a.rationale
  );
  return { a, tx };
}

async function main() {
  console.log("Logging current Guardian decision on-chain (Mantle Sepolia)...");
  const { a, tx } = await logCurrentDecision();
  console.log(`Decision : ${a.action} | market ${a.session.state} | price ${a.s.price.toFixed(2)}`);
  console.log(`Rationale: ${a.rationale}`);
  console.log(`Tx sent  : ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`\n✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   Tx       : ${cfg.mantle.explorer}/tx/${tx.hash}`);
  const count = await journalWith(getProvider()).count();
  console.log(`   On-chain decisions logged so far: ${count.toString()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
