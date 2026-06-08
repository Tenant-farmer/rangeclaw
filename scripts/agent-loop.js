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
const SIGN = process.env.RG_SIGN === "1"; // loop is READ-ONLY unless RG_SIGN=1 (safe to host keyless)
const INTERVAL_MIN = Number(process.env.RG_INTERVAL_MIN || 15);
const pexec = promisify(execFile);

const loadState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const subs = () => { try { return JSON.parse(readFileSync(ALERTS, "utf8")); } catch { return []; } };
const refreshData = () => pexec(process.execPath, [join(root, "scripts", "export-data.js")]).catch((e) => console.error("export-data:", e.message));
const num = (s) => { const m = String(s ?? "").replace(/[$,]/g, "").match(/-?[\d.]+/); return m ? parseFloat(m[0]) : 0; };

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

// send a tx with a wait-timeout + one retry, so a stuck RPC can't hang the loop
async function send(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      const tx = await fn();
      await Promise.race([tx.wait(), new Promise((_, rej) => setTimeout(() => rej(new Error("tx.wait timeout")), 90000))]);
      return tx;
    } catch (e) {
      if (attempt >= 2) throw e;
      console.warn(`${new Date().toISOString()}  tx retry (${e.message})`);
    }
  }
}

async function tick() {
  const ts = new Date().toISOString();
  const p = await assessPortfolio();
  let state = loadState();
  const baseline = state === null; // first run: record actions, don't log/alert
  state = state || {};

  // READ-ONLY unless RG_SIGN=1 with a loadable wallet — a hosted loop can observe + refresh keyless.
  const w = (!baseline && SIGN) ? loadWallet(getProvider()) : null;
  const journal = w ? new Contract(cfg.mantle.journalAddress, abi, w) : null;
  for (const a of p.assessments) {
    const r = a.row;
    const changed = !baseline && state[r.pair] !== a.action;
    // alert on decision change (no key needed)
    if (changed) await alert(`\u{1F985} <b>${r.pair}</b>  ${state[r.pair] || "—"} → <b>${a.action}</b>\n$${r.price.toFixed(2)} · ${a.rationale}`);
    // log decision on-chain (only when signing)
    if (journal && changed) {
      const priceE6 = BigInt(Math.round(r.price * 1e6));
      const tx = await send(() => journal.logDecision(a.action, r.pos.tickLower, r.pos.tickUpper, priceE6, a.session.state, `[${r.pair}] ${a.rationale}`));
      console.log(`${ts}  ${r.pair} ${state[r.pair] || "—"} -> ${a.action}  decision ${tx.hash.slice(0, 12)}…`);
    }
    state[r.pair] = a.action;

    // realized outcome change -> log fees + PnL on-chain (proves OUTCOMES, not just actions)
    const feesUsd = num(r.pos.earnedUsdDisplay), pnlUsd = num(r.pos.pnlUsdDisplay);
    const okey = `${r.pair}#out`, cur = `${feesUsd.toFixed(2)}|${pnlUsd.toFixed(2)}`;
    if (journal && state[okey] !== undefined && state[okey] !== cur) {
      const tx = await send(() => journal.logOutcome(r.pair, BigInt(Math.round(feesUsd * 1e6)), BigInt(Math.round(pnlUsd * 1e6))));
      console.log(`${ts}  ${r.pair} outcome fees $${feesUsd} pnl $${pnlUsd}  ${tx.hash.slice(0, 12)}…`);
    }
    state[okey] = cur;
  }
  saveState(state);
  await refreshData();
  console.log(`${ts}  tick ${baseline ? "(baseline)" : "done"} · market ${p.session.state} · positions ${p.assessments.length} · subs ${subs().length}`);
}

console.log(`RangeClaw agent-loop · every ${INTERVAL_MIN}m · ${SIGN ? "SIGNING on-chain" : "observe-only (set RG_SIGN=1 to write)"}`);
await tick();
setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), INTERVAL_MIN * 60 * 1000);
