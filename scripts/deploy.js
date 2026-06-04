// Deploy AgentJournal.sol to Mantle Sepolia using the local EVM agent wallet.
// Compiles with solc, deploys with ethers, saves the address into config.json.
// Prereqs:  1) node src/evm.js generate   2) fund it at faucet.sepolia.mantle.xyz
// Run:      node scripts/deploy.js

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import solc from "solc";
import { ContractFactory } from "ethers";
import { getProvider, loadWallet } from "../src/evm.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const cfgPath = join(root, "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

function compile() {
  const source = readFileSync(join(root, "contracts", "AgentJournal.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "AgentJournal.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) { errors.forEach((e) => console.error(e.formattedMessage)); throw new Error("Solidity compile failed"); }
  const c = out.contracts["AgentJournal.sol"]["AgentJournal"];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

async function main() {
  const provider = getProvider();
  const wallet = loadWallet(provider);
  if (!wallet) throw new Error("No EVM wallet. Run: node src/evm.js generate");
  const bal = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address);
  console.log("Balance :", bal.toString(), "wei");
  if (bal === 0n) throw new Error(`Deployer has 0 MNT. Fund ${wallet.address} at https://faucet.sepolia.mantle.xyz then retry.`);

  const { abi, bytecode } = compile();
  console.log("Compiled OK. Deploying AgentJournal to Mantle Sepolia (chainId " + cfg.mantle.chainId + ")...");
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  console.log("Tx sent, waiting for confirmation...");
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("\n✅ Deployed AgentJournal:", addr);
  console.log("   Explorer:", cfg.mantle.explorer + "/address/" + addr);

  cfg.mantle.journalAddress = addr;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  writeFileSync(join(root, "contracts", "AgentJournal.abi.json"), JSON.stringify(abi, null, 2));
  console.log("   Saved address -> config.json + ABI -> contracts/AgentJournal.abi.json\n");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
