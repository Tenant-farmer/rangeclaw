// RangeClaw - autonomous loop (v2: log + alert on change).
// Every INTERVAL: assess the stock portfolio; for any CHANGED decision, log it
// on-chain (deduped via .state.json) AND push a Telegram alert to subscribers
// (.alerts.json, populated when someone messages the bot); then refresh data.json.
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
try { process.loadEnvFile(join(root, ".env")); } catch {}
const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(root, "contracts", "AgentJournal.abi.json"), "utf8"));
const STATE = join(root, ".state.json");
const ALERTS = join(root, ".alerts.json");
const TG = process.env.TELEGRAM_BOT_TOKEN;
const INTERVAL_MIN = Number(process.env.RG_INTERVAL_MIN || 15);
const pexec = promisify(execFile);

const loadState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const subs = () => { try { return JSON.parse(readFileSync(ALERTS, "utf8")); } catch { return []; } };
const refreshData = () => pexec(process.execPath, [join(root, "scripts", "export-data.js")]).catch((e) => console.error("export-data:", e.message));

async function alert(text) {
  if (!TG) return;
  for (const id of subs()) {
    try {
      await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
      });
    } catch {}
  }
}

async function tick() {
  const ts = new Date().toISOString();
  const p = await assessPortfolio();
  let state = loadState();
  const baseline = state === null; // first run: record actions, don't log/alert
  state = state || {};

  if (!baseline) {
    const journal = new Contract(cfg.mantle.journalAddress, abi, loadWallet(getProvider()));
    for (const a of p.assessments) {
      const prev = state[a.row.pair];
      if (prev !== a.action) {
        const priceE6 = BigInt(Math.round(a.row.price * 1e6));
        const tx = await journal.logDecision(a.action, a.row.pos.tickLower, a.row.pos.tickUpper, priceE6, a.session.state, `[${a.row.pair}] ${a.rationale}`);
        await tx.wait();
        await alert(`\u{1F985} <b>${a.row.pair}</b>  ${prev || "—"} → <b>${a.action}</b>\n$${a.row.price.toFixed(2)} · ${a.rationale}`);
        console.log(`${ts}  ${a.row.pair} ${prev || "—"} -> ${a.action}  on-chain ${tx.hash.slice(0, 12)}… + alert`);
      }
    }
  }
  for (const a of p.assessments) state[a.row.pair] = a.action;
  saveState(state);
  await refreshData();
  console.log(`${ts}  tick ${baseline ? "(baseline)" : "done"} · market ${p.session.state} · positions ${p.assessments.length} · subs ${subs().length}`);
}

console.log(`RangeClaw agent-loop · every ${INTERVAL_MIN}m · log + alert on change`);
await tick();
setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), INTERVAL_MIN * 60 * 1000);
