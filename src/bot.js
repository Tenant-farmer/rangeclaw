// RangeClaw - Telegram bot
// /status -> reads your live position + market context and replies with the
// Guardian verdict. Token lives in app/.env (gitignored); never committed.

import process from "node:process";
import { fileURLToPath } from "node:url";
import { Bot } from "grammy";
import { assess, formatGuardian } from "./guardian.js";
import { planRebalance, formatPlan } from "./rebalance.js";

// Load app/.env (Node >=20.12 / 24 supports process.loadEnvFile).
try { process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); } catch {}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN - copy .env.example to .env and set it.");
  process.exit(1);
}

const bot = new Bot(token);

bot.command("start", (ctx) =>
  ctx.reply("\u{1F985} RangeClaw online.\n/status — position + market-aware Guardian verdict\n/plan — preview the rebalance it would run (non-custodial)")
);

bot.command("status", async (ctx) => {
  console.log("/status from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Reading your position + market context…");
  try {
    const a = await assess();
    await ctx.reply(formatGuardian(a), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("⚠️ Error: " + e.message);
  }
});

bot.command("plan", async (ctx) => {
  console.log("/plan from", ctx.from?.username || ctx.from?.id);
  await ctx.reply("⏳ Computing rebalance plan…");
  try {
    const a = await assess();
    await ctx.reply(formatPlan(planRebalance(a)), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("⚠️ Error: " + e.message);
  }
});

bot.catch((err) => console.error("bot error:", err));
bot.start({ onStart: (i) => console.log("RangeClaw polling as @" + i.username) });
