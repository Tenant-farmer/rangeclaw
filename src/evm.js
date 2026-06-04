// RangeClaw - EVM wallet for Mantle (the agent's on-chain identity / decision signer).
// Used to deploy + call the AgentJournal contract on Mantle. Same security model as
// wallet.js: key stored ONLY in app/.wallet/ (gitignored), never printed/sent/logged.
// Testnet use - fund from https://faucet.sepolia.mantle.xyz

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";
import process from "node:process";
import { Wallet, JsonRpcProvider, formatEther } from "ethers";

const __dir = dirname(fileURLToPath(import.meta.url));
const WALLET_DIR = join(__dir, "..", ".wallet");
const KEYSTORE = join(WALLET_DIR, "evm-keypair.json");
const cfg = JSON.parse(readFileSync(join(__dir, "..", "config.json"), "utf8"));

function save(w) {
  if (!existsSync(WALLET_DIR)) mkdirSync(WALLET_DIR, { recursive: true });
  writeFileSync(KEYSTORE, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2), { mode: 0o600 });
}

export function getProvider() {
  return new JsonRpcProvider(cfg.mantle.rpc, cfg.mantle.chainId);
}

export function loadWallet(provider) {
  if (!existsSync(KEYSTORE)) return null;
  const { privateKey } = JSON.parse(readFileSync(KEYSTORE, "utf8"));
  const w = new Wallet(privateKey);
  return provider ? w.connect(provider) : w;
}

export function getAddress() {
  return existsSync(KEYSTORE) ? JSON.parse(readFileSync(KEYSTORE, "utf8")).address : null;
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); else if (s.includes("\n")) rl.output.write("\n"); };
    rl.question(query, (a) => { rl.close(); resolve(a); });
    muted = true;
  });
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "generate") {
    if (existsSync(KEYSTORE)) console.log("\n⚠️  EVM wallet already exists - overwriting replaces it.\n");
    const w = Wallet.createRandom();
    save(w);
    console.log("\n✅ EVM agent wallet (Mantle) created.");
    console.log("   Address        :", w.address);
    console.log("   Stored locally :", KEYSTORE, "(gitignored)");
    console.log("\n   ▶ Fund it with testnet MNT: https://faucet.sepolia.mantle.xyz");
    console.log("     (paste the address above), then run the deploy script.\n");
  } else if (cmd === "import") {
    console.log("\nPaste an EVM private key (0x...) OR a mnemonic. Hidden input, stored locally only.\n");
    const secret = (await promptHidden("secret: ")).trim();
    const w = secret.includes(" ") ? Wallet.fromPhrase(secret) : new Wallet(secret);
    save(w);
    console.log("\n✅ EVM wallet imported. Address:", w.address, "\n");
  } else if (cmd === "address") {
    console.log(getAddress() || "No EVM wallet. Run: node src/evm.js generate");
  } else if (cmd === "balance") {
    const a = getAddress();
    if (!a) return console.log("No EVM wallet. Run: node src/evm.js generate");
    const bal = await getProvider().getBalance(a);
    console.log("Address:", a);
    console.log("Balance:", formatEther(bal), "MNT");
  } else {
    console.log("Usage: node src/evm.js <generate | import | address | balance>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
