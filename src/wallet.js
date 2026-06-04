// RangeClaw - Wallet manager (LOCAL ONLY, NON-CUSTODIAL).
//
// SECURITY (read this):
//  - Keys are generated/stored ONLY on this machine, in app/.wallet/ (gitignored).
//  - The secret is NEVER printed, logged, transmitted, or sent to any chat/server.
//  - NEVER paste a private key or mnemonic into Telegram or to an AI assistant.
//    Run import in YOUR OWN terminal; the input is hidden:
//        node src/wallet.js import
//
// Two modes:
//  - generate : create a FRESH dedicated agent wallet (recommended). It will only
//               manage NEW positions you open with it; your main wallet and your
//               existing position stay completely untouched. Fund it small.
//  - import   : use an existing wallet via private key (base58 / JSON array) or a
//               12/24-word mnemonic. Higher risk: the agent can move those funds.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";
import process from "node:process";
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";

const __dir = dirname(fileURLToPath(import.meta.url));
const WALLET_DIR = join(__dir, "..", ".wallet");
const KEYSTORE = join(WALLET_DIR, "keypair.json");
const cfg = JSON.parse(readFileSync(join(__dir, "..", "config.json"), "utf8"));
const RPC = cfg.solanaRpc || "https://api.mainnet-beta.solana.com";

function saveKeypair(kp) {
  if (!existsSync(WALLET_DIR)) mkdirSync(WALLET_DIR, { recursive: true });
  writeFileSync(KEYSTORE, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
}

export function loadKeypair() {
  if (!existsSync(KEYSTORE)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYSTORE, "utf8"))));
}

export function getPublicKey() {
  const kp = loadKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

// Accept base58 secret key, Solana JSON array, or a BIP39 mnemonic.
function keypairFromInput(secret) {
  secret = secret.trim();
  if (secret.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  }
  const words = secret.split(/\s+/);
  if (words.length >= 12 && bip39.validateMnemonic(secret)) {
    const seed = bip39.mnemonicToSeedSync(secret); // 64 bytes
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key; // Phantom path
    return Keypair.fromSeed(derived);
  }
  const decoded = bs58.decode(secret);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error("Unrecognized format. Expected base58 key, JSON array, or 12/24-word mnemonic.");
}

// Hidden terminal prompt (input not echoed). Local TTY only.
function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); else if (s.includes("\n")) rl.output.write("\n"); };
    rl.question(query, (a) => { rl.close(); resolve(a); });
    muted = true;
  });
}

async function getBalance(pubkey) {
  try {
    const lamports = await new Connection(RPC, "confirmed").getBalance(new PublicKey(pubkey));
    return (lamports / LAMPORTS_PER_SOL).toFixed(4) + " SOL";
  } catch {
    return "(balance unavailable - check on solscan.io)";
  }
}

function warnExisting() {
  if (existsSync(KEYSTORE)) {
    console.log("\n⚠️  An agent wallet already exists at .wallet/keypair.json.");
    console.log("    Overwriting REPLACES it - back up first if it holds funds.\n");
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "generate") {
    warnExisting();
    const kp = Keypair.generate();
    saveKeypair(kp);
    console.log("\n✅ New dedicated agent wallet created.");
    console.log("   Public address :", kp.publicKey.toBase58());
    console.log("   Stored locally :", KEYSTORE, "(gitignored, never shared)");
    console.log("\n   Next: send a little SOL (gas) + the capital you want the agent to manage.");
    console.log("   Your MAIN wallet and existing position stay untouched.\n");
  } else if (cmd === "import") {
    warnExisting();
    console.log("\nPaste a private key (base58 / JSON array) OR a 12/24-word mnemonic.");
    console.log("Input is HIDDEN and stored ONLY on this machine. Never share it with anyone.\n");
    const secret = await promptHidden("secret: ");
    const kp = keypairFromInput(secret);
    saveKeypair(kp);
    console.log("\n✅ Wallet imported.");
    console.log("   Public address :", kp.publicKey.toBase58());
    console.log("   Stored locally :", KEYSTORE, "(gitignored)\n");
  } else if (cmd === "address") {
    console.log(getPublicKey() || "No agent wallet yet. Run: node src/wallet.js generate");
  } else if (cmd === "balance") {
    const pk = getPublicKey();
    if (!pk) return console.log("No agent wallet. Run: node src/wallet.js generate");
    console.log("Address:", pk);
    console.log("Balance:", await getBalance(pk));
  } else {
    console.log("Usage: node src/wallet.js <generate | import | address | balance>");
    console.log("  generate  create a fresh dedicated agent wallet (recommended)");
    console.log("  import    import existing wallet (privkey / JSON / mnemonic) - hidden input");
    console.log("  address   print the agent wallet public address");
    console.log("  balance   print SOL balance");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
