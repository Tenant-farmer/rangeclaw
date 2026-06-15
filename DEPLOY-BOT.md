# Hosting the RangeClaw bot 24/7 (optional)

The **dashboard** (GitHub Pages), **AgentJournal contract** (Mantle), and **demo video** are already permanently live. This is only for keeping the **Telegram bot** reachable around the clock so judges can test `/status` themselves.

`src/bot.js` starts a tiny health server when `PORT` is set, so it runs on a free web-service tier. The Docker image already installs `byreal-cli` (the bot needs it for `/status` `/stocks` `/plan`). The bot is **read-only** — no wallet/private key required.

## Option A — Render (free) + uptime pinger  ·  recommended
1. https://render.com → **New → Blueprint** → connect `Tenant-farmer/rangeclaw` (it reads `render.yaml`).
2. Set the secret **`TELEGRAM_BOT_TOKEN`** = your BotFather token → **Apply / Deploy**.
3. Free web services sleep after ~15 min idle, so add a free pinger to keep it awake:
   - https://uptimerobot.com (or cron-job.org) → add an **HTTP monitor** on the Render service URL, interval **5 min**. The `/` health endpoint returns `200`, so the instance never sleeps and the bot keeps polling.

## Option B — Railway / Fly.io
- **Railway:** New project → Deploy from repo → start command `node src/bot.js` → add env `TELEGRAM_BOT_TOKEN`.
- **Fly.io:** `fly launch` (detects the Dockerfile) → `fly secrets set TELEGRAM_BOT_TOKEN=…` → set the process to `node src/bot.js` → `fly deploy`.

## Option C — your own machine  ·  simplest, free
In a terminal you keep open: `npm run bot`. Good for a known window (e.g. around Demo Day, Jul 2–3).

## ⚠️ Only ONE instance can poll the bot token
Two pollers (e.g. local + cloud) cause Telegram **409 conflicts** → neither responds.
Stop every local `npm run bot` before the cloud bot goes live, and close any old session that's still running it.
