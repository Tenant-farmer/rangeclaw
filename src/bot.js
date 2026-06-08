// RangeClaw - Telegram bot (v2.3: portfolio + universe + plans + alert opt-in).
//   /status  -> every stock-LP position + market-aware Guardian verdict
//   /stocks  -> all tokenized stocks on Byreal, by APR
//   /plan    -> non-custodial rebalance plan per position
//   /alerts  -> subscribe to push DMs when a position needs attention

import process from "node:process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { Bot } from "grammy";
import { assessPortfolio, formatPortfolio } from "./guardian.js";
import { planAll, formatPlan } from "./rebalance.js";
import { discoverStockPools } from "./portfolio.js";

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

bot.command("start", (ctx) =>
  ctx.reply("\u{1F985} RangeClaw online.\n/status — your stock-LP portfolio + Guardian\n/stocks — all tokenized stocks by APR\n/plan — non-custodial rebalance plans\n/alerts — DM me when a position needs attention")
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

bot.catch((err) => console.error("bot error:", err));
bot.start({ onStart: (i) => console.log("RangeClaw polling as @" + i.username) });
