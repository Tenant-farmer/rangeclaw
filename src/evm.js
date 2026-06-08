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
const KEYSTORE = join(WALLET_DIR, "evm-keypair.json"); // legacy plaintext
const ENC = join(WALLET_DIR, "evm-keystore.json");     // encrypted (preferred for hosting)
const cfg = JSON.parse(readFileSync(join(__dir, "..", "config.json"), "utf8"));

function save(w) {
  if (!existsSync(WALLET_DIR)) mkdirSync(WALLET_DIR, { recursive: true });
  writeFileSync(KEYSTORE, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2), { mode: 0o600 });
}

export function getProvider() {
  return new JsonRpcProvider(cfg.mantle.rpc, cfg.mantle.chainId);
}

// Prefer an encrypted keystore (needs RG_WALLET_PASS); fall back to legacy plaintext
// with a loud warning. Returns null if no key (or encrypted but no passphrase) — the
// caller then runs read-only.
export function loadWallet(provider) {
  let w = null;
  if (existsSync(ENC)) {
    const pass = process.env.RG_WALLET_PASS;
    if (!pass) { console.warn("evm: encrypted keystore present but RG_WALLET_PASS not set — running keyless."); return null; }
    w = Wallet.fromEncryptedJsonSync(readFileSync(ENC, "utf8"), pass);
  } else if (existsSync(KEYSTORE)) {
    console.warn("evm: ⚠️ loading PLAINTEXT key. Run `node src/evm.js encrypt` before hosting.");
    w = new Wallet(JSON.parse(readFileSync(KEYSTORE, "utf8")).privateKey);
  } else return null;
  return provider ? w.connect(provider) : w;
}

export function getAddress() {
  if (existsSync(ENC)) { const a = JSON.parse(readFileSync(ENC, "utf8")).address; return a ? "0x" + a.replace(/^0x/, "") : null; }
  if (existsSync(KEYSTORE)) return JSON.parse(readFileSync(KEYSTORE, "utf8")).address;
  return null;
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
  } else if (cmd === "encrypt") {
    if (!existsSync(KEYSTORE)) return console.log("No plaintext key to encrypt. Run generate/import first.");
    const w0 = new Wallet(JSON.parse(readFileSync(KEYSTORE, "utf8")).privateKey);
    const pass = (process.env.RG_WALLET_PASS || (await promptHidden("New passphrase: "))).trim();
    if (!pass) return console.log("Empty passphrase — aborted.");
    if (!existsSync(WALLET_DIR)) mkdirSync(WALLET_DIR, { recursive: true });
    writeFileSync(ENC, await w0.encrypt(pass), { mode: 0o600 });
    console.log("\n✅ Encrypted keystore written:", ENC);
    console.log("   Run the loop with RG_SIGN=1 and RG_WALLET_PASS set to sign; then delete the plaintext:", KEYSTORE, "\n");
  } else if (cmd === "address") {
    console.log(getAddress() || "No EVM wallet. Run: node src/evm.js generate");
  } else if (cmd === "balance") {
    const a = getAddress();
    if (!a) return console.log("No EVM wallet. Run: node src/evm.js generate");
    const bal = await getProvider().getBalance(a);
    console.log("Address:", a);
    console.log("Balance:", formatEther(bal), "MNT");
  } else {
    console.log("Usage: node src/evm.js <generate | import | encrypt | address | balance>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
