# 🦅 RangeClaw — Autonomous Guardian for tokenized-stock liquidity

**Mantle Turing Test Hackathon 2026 · Agentic Wallets & Economy track (Byreal)**

> **Live dashboard:** https://tenant-farmer.github.io/rangeclaw/ (auto-deploys on push)
> **AgentJournal (Mantle Sepolia):** [`0x31A36C77c43DD8225775C9A3B31c66A001Bc2820`](https://explorer.sepolia.mantle.xyz/address/0x31A36C77c43DD8225775C9A3B31c66A001Bc2820)

An autonomous agent that manages a **portfolio of tokenized-stock LP positions** on Byreal, understands the **equity-market calendar**, and writes every decision **on-chain to Mantle**.

## The problem (I live it)
I'm a real tokenized-stock liquidity provider. Tokenized stocks trade **24/7 on-chain**, but the underlying equities only trade market hours — so concentrated LP ranges **gap over market closes, weekends, and earnings**. A generic 24/7 crypto bot gets caught on the wrong side of the gap.

## What it does (v2 — whole portfolio)
- **Discovers every xStock pool on Byreal** (15 pools — TSLAx, NVDAx, AAPLx, GOOGLx, METAx, AMZNx, COINx, HOODx, MSTRx, MCDx, CRCLx, …); new listings auto-included.
- **Monitors all your stock LP positions** and decides `HOLD / WATCH / WIDEN / REBALANCE` per position with a plain-language rationale.
- **Equity-aware:** shared US market-hours / weekend / holiday logic **+ per-ticker earnings** (widens the range before earnings, defers rebalances into closed-market gaps).
- **Non-custodial rebalancing** via the Byreal Skills CLI — builds an unsigned tx you sign; never holds your key.
- **On-chain decision journal** on Mantle (per-position, pair-tagged) — permanent, verifiable.
- **Autonomous loop** that logs decisions *on change* and refreshes the dashboard.

## Surfaces
- **Telegram bot:** `/status` (portfolio + market-aware verdicts) · `/stocks` (all stocks by APR) · `/plan` (rebalance preview) · `/hedge` (delta-hedge via Byreal Perps) · `/alerts` (DM me when a position changes).
- **Web dashboard (charts):** a price + range chart for **every** tokenized stock (held positions show the range band + a backtest "in-range %"), an **"Open a guarded position"** onboarding flow, and the **live on-chain decision journal** read straight from the Mantle contract.

## Architecture
```
 Byreal Skills CLI (Solana)         Guardian brain (per position)        Mantle
 discover xStock pools + your  ───▶ in-range? buffer? market open?  ───▶ AgentJournal
 positions (read-only, JSON)        earnings soon? → HOLD/WATCH/         (logDecision,
        ▲                           WIDEN/REBALANCE + rationale          verifiable)
        │ rebalance (unsigned tx)            │                                │
        └────── non-custodial sign ──────────┘                 charts dashboard + Telegram
```
Liquidity executes on **Solana** (Byreal CLMM, where the xStock pools live — the track allows *Mantle or Solana*); agent identity + decision journal live on **Mantle**.

## Components (`app/`)
| File | Role |
|---|---|
| `src/byreal.js` | Byreal Skills CLI JSON wrapper |
| `src/portfolio.js` | discover xStock pools + read all positions |
| `src/equity.js` | US market session + per-ticker earnings |
| `src/guardian.js` | portfolio decision brain |
| `src/rebalance.js` | non-custodial rebalance planner |
| `src/journal.js` | log decisions on-chain (per position) |
| `src/wallet.js` · `src/evm.js` | non-custodial wallets (Solana / Mantle) |
| `src/bot.js` | Telegram bot |
| `scripts/export-data.js` | build `web/data.json` for the charts |
| `scripts/agent-loop.js` | autonomous tick (log-on-change + refresh) |
| `scripts/deploy.js` · `verify.js` | contract deploy / verify |
| `contracts/AgentJournal.sol` | on-chain decision log (Mantle) |
| `web/index.html` | charted public dashboard |

## Run
```bash
npm install -g @byreal-io/byreal-cli
cd app && npm install

npm run portfolio   # discover stocks + your positions (read-only)
npm run guardian    # market-aware portfolio decisions
npm run export      # build dashboard data (web/data.json)
npm run bot         # Telegram bot (/status, /stocks, /plan, /hedge, /alerts)
npm run loop        # autonomous loop: log + alert on change, refresh data
npm run hedge       # delta-hedge advisor (Byreal Perps)
npm run build-tx    # generate an unsigned rebalance tx (you sign)
npm run serve       # host the live dashboard (web/ + auto-refresh)
```
Monitoring is fully read-only (no key). Execution & journaling are **non-custodial** — keys live only in `app/.wallet/` (gitignored), never transmitted.

## Tech
Node.js · Byreal Agent Skills (Solana CLMM) · ethers v6 · Solidity ^0.8 (Mantle Sepolia) · grammY (Telegram) · Chart.js · Tailwind.
