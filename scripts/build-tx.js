// RangeClaw - execution-ready tx builder (non-custodial).
// Generates the actual UNSIGNED Solana transaction(s) to close a held position
// (step 1 of a rebalance), via byreal-cli --unsigned-tx. You sign & submit with
// YOUR wallet — RangeClaw never holds a key and never submits.
//   node scripts/build-tx.js [TICKER]      (defaults to your first held position)

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { portfolio } from "../src/portfolio.js";

const pexec = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));

async function main() {
  const arg = (process.argv[2] || "").toUpperCase();
  const { rows } = await portfolio();
  const row = arg ? rows.find((r) => r.ticker.toUpperCase() === arg) : rows[0];
  if (!row) { console.log(`No matching held position${arg ? ` for ${arg}` : ""}.`); return; }

  const usdc = row.pool.token_b.mint;
  const cmd = `byreal-cli --non-interactive -o json positions close --nft-mint ${row.pos.nftMintAddress} --auto-swap --output-mint ${usdc} --unsigned-tx --wallet-address ${cfg.ownerWallet}`;
  console.log(`Building unsigned CLOSE tx for ${row.pair} (non-custodial — you sign & submit)…`);
  const { stdout } = await pexec(cmd, { maxBuffer: 32 * 1024 * 1024 });

  let parsed; try { parsed = JSON.parse(stdout); } catch {}
  if (parsed?.error) { console.log("error:", parsed.error.message); return; }
  const txs = parsed?.unsignedTransactions || [];
  const file = join(root, `unsigned-${row.ticker}-close.json`);
  writeFileSync(file, JSON.stringify({ pair: row.pair, step: "close→USDC", unsignedTransactions: txs }, null, 2));
  console.log(`✅ ${txs.length} unsigned transaction(s) → ${file}`);
  console.log(`   Sign & submit with your wallet to execute step 1 (close → USDC).`);
  console.log(`   Then open the new range (see "npm run rebalance" / the /plan command).`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
