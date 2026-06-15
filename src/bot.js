// RangeClaw - Telegram bot (v2.3: portfolio + universe + plans + alert opt-in).
//   /status  -> every stock-LP position + market-aware Guardian verdict
//   /stocks  -> all tokenized stocks on Byreal, by APR
//   /plan    -> non-custodial rebalance plan per position
//   /alerts  -> subscribe to push DMs when a position needs attention

import process from "node:process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { Bot } from "grammy";
import { assessPortfolio, formatPortfolio } from "./guardian.js";
import { planAll, formatPlan } from "./rebalance.js";
import { discoverStockPools } from "./portfolio.js";
import { hedgePlan } from "./hedge.js";

try { process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); } catch {}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error("Missing TELEGRAM_BOT_TOKEN - set it in app/.env."); process.exit(1); }

const ALERTS = fileURLToPath(new URL("../.alerts.json", import.meta.url));
function subscribe(id) {
  let s = []; try { s = JSON.parse(readFileSync(ALERTS, "utf8")); } catch {}
  if (!s.includes(id)) { s.push(id); writeFileSync(ALERTS, JSON.stringify(s)); }
}

const bot = new Bot(token);
bot.use((ctx, next) => { if (ctx.chat?.id) subscribe(ctx.chat.id); return next(); }); // anyone who talks to the bot gets alerts

const HELP = [
  "\u{1F985} <b>RangeClaw — how to use</b>",
  "",
  "I'm an autonomous guardian for your tokenized-stock LP positions on Byreal. Tokenized stocks trade 24/7 but the real equities don't — I watch the market calendar, size ranges by volatility, and only rebalance when fees beat the cost. Every decision is logged on Mantle.",
  "",
  "<b>Commands</b>",
  "/status — your positions + a market-aware verdict (HOLD / WATCH / WIDEN / REBALANCE) with the reasoning",
  "/stocks — every tokenized stock on Byreal, ranked by APR",
  "/plan — a non-custodial rebalance plan (vol-sized range, live price-impact quote, est. cost) → an unsigned tx you sign",
  "/hedge — a delta-hedge suggestion via Byreal Perps (advisory)",
  "/alerts — subscribe: I'll DM you when a position's verdict changes",
  "/help — this message",
  "",
  "<b>Dashboard</b> (charts + live on-chain journal):",
  "https://tenant-farmer.github.io/rangeclaw/",
  "",
  "<i>Non-custodial — I never hold your keys or move funds. Rebalances are unsigned transactions you approve.</i>",
].join("\n");

bot.command(["start", "help"], (ctx) =>
  ctx.reply(HELP, { parse_mode: "HTML", disable_web_page_preview: true })
);

bot.command("alerts", (ctx) =>
  ctx.reply("\u{1F514} Alerts ON. I'll DM you here whenever a position changes to WATCH / WIDEN / REBALANCE.")
);

bot.command("status", async (ctx) => {
  console.log("/status from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Reading your portfolio + market context…");
  try { const p = await assessPortfolio(); await ctx.reply(formatPortfolio(p), { parse_mode: "HTML" }); }
  catch (e) { await ctx.reply("⚠️ Error: " + e.message); }
});

bot.command("stocks", async (ctx) => {
  console.log("/stocks from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Scanning Byreal xStock pools…");
  try {
    const stocks = (await discoverStockPools()).filter((p) => p.token_b.symbol === "USDC").sort((a, b) => b.total_apr - a.total_apr);
    const lines = ["<b>\u{1F985} Byreal tokenized stocks — by APR</b>", ""];
    for (const p of stocks) lines.push(`<b>${p.token_a.symbol}</b>  ${p.total_apr.toFixed(1)}% APR · $${p.current_price.toFixed(2)} · TVL $${(p.tvl_usd / 1000).toFixed(0)}K`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) { await ctx.reply("⚠️ Error: " + e.message); }
});

bot.command("plan", async (ctx) => {
  console.log("/plan from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Computing rebalance plans…");
  try {
    const plans = await planAll();
    if (!plans.length) return ctx.reply("No stock LP positions to plan.");
    await ctx.reply(plans.map(formatPlan).join("\n\n"), { parse_mode: "HTML" });
  } catch (e) { await ctx.reply("⚠️ Error: " + e.message); }
});

bot.command("hedge", async (ctx) => {
  console.log("/hedge from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Computing delta hedges (Byreal Perps)…");
  try {
    const plans = await hedgePlan();
    if (!plans.length) return ctx.reply("No stock LP positions to hedge.");
    const lines = ["<b>\u{1F6E1}\u{FE0F} Delta hedge (advisory)</b>", ""];
    for (const h of plans) {
      if (h.perp) lines.push(`<b>${h.pair}</b> — LP long ~$${h.deltaUsd} ${h.ticker}\n  short <b>${h.size} ${h.ticker}</b> ($${h.perpPrice}, funding ${h.funding}/yr)\n  <code>byreal-perps-cli order market sell ${h.size} ${h.ticker}</code>`);
      else lines.push(`<b>${h.pair}</b> — no Hyperliquid perp for ${h.ticker}`);
    }
    lines.push("\n<i>advisory · non-custodial · needs your own perps account</i>");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) { await ctx.reply("⚠️ Error: " + e.message); }
});

bot.catch((err) => console.error("bot error:", err));

bot.api.setMyCommands([
  { command: "status", description: "Your positions + Guardian verdict" },
  { command: "stocks", description: "All tokenized stocks by APR" },
  { command: "plan", description: "Non-custodial rebalance plan" },
  { command: "hedge", description: "Delta-hedge suggestion (Byreal Perps)" },
  { command: "alerts", description: "DM me when a position changes" },
  { command: "help", description: "How to use RangeClaw" },
]).catch((e) => console.error("setMyCommands:", e.message));

// Health server — only when PORT is set (Render/Railway). Lets the bot run on a
// free web-service tier and stay awake via an uptime pinger; Telegram updates
// still arrive via polling. Locally (no PORT) this is skipped.
if (process.env.PORT) {
  http
    .createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("RangeClaw bot ok\n"); })
    .listen(process.env.PORT, () => console.log("health server on :" + process.env.PORT));
}

bot.start({ onStart: (i) => console.log("RangeClaw polling as @" + i.username) });
