# 🦅 RangeClaw — Autonomous Guardian for Tokenized-Stock Liquidity

**Mantle Turing Test Hackathon 2026 · Agentic Wallets & Economy track (sponsored by Byreal)**
Track path: *DeFi Deep Dive → "Automated portfolio rebalancing with on-chain execution."*

> **Live dashboard:** https://euphonious-cannoli-72b96c.netlify.app/
> **AgentJournal (Mantle Sepolia):** [`0x09542c48b8708ed0CeB52a636193A2d932D9350E`](https://explorer.sepolia.mantle.xyz/address/0x09542c48b8708ed0CeB52a636193A2d932D9350E)

---

## The problem (from a real LP)

I run an actual **TSLAx/USDC** concentrated-liquidity position on Byreal. Tokenized stocks trade **24/7 on-chain**, but the underlying equity only trades NYSE/Nasdaq hours — so the position gaps over **market closes, weekends, and earnings**. A generic "AI yield" bot treats it like any crypto pair and gets wrecked by those gaps. Managing it by hand means waking up at 2am.

**RangeClaw** is an autonomous agent that watches the position, *understands equity-market context*, rebalances via the Byreal Skills CLI, and writes **every decision on-chain to Mantle** so its judgment is permanently verifiable — exactly the hackathon's thesis: *autonomous agents creating verifiable, on-chain value.*

## What makes it different
- **Equity-aware Guardian** (the moat): knows market hours / weekends / NYSE holidays / earnings proximity and adjusts — e.g. *"market closed → defer rebalance to avoid the gap"*, *"earnings in 1.6d → widen range now."* A 24/7 crypto bot can't do this.
- **Risk-check before acting** (Plutus-style verification folded into one step): slippage, range buffer, anti-churn, market state.
- **Non-custodial**: the agent never holds your key. Execution produces an **unsigned transaction you sign** (`--unsigned-tx`), or runs through a dedicated wallet you control.
- **On-chain verifiability**: each decision (`HOLD/WATCH/WIDEN/REBALANCE` + price, range, market, rationale) is logged to the AgentJournal contract on Mantle.

## Architecture
```
 Byreal Skills CLI (Solana)          Guardian brain                 Mantle
 ┌───────────────────┐   JSON   ┌──────────────────────┐   logDecision   ┌──────────────┐
 │ pools / positions │ ───────▶ │ in-range? buffer?    │ ──────────────▶ │ AgentJournal │
 │ (read-only)       │          │ market open/closed?  │                 │ (verifiable) │
 └───────────────────┘          │ earnings soon?       │                 └──────┬───────┘
        ▲                       │  → decision+rationale│                        │
        │ rebalance (close+open │  → HOLD/WIDEN/REBAL  │                        ▼
        │ --auto-swap, unsigned)└──────────┬───────────┘            public web dashboard
        └──────────────────────────────────┤                       + Telegram /status /plan
                                  non-custodial signing
```
- **Liquidity execution** runs on **Solana** via Byreal Agent Skills (where the TSLAx CLMM pool lives) — the track allows *"Deploy on Mantle or Solana."*
- **Identity + decision journal** live on **Mantle** (the submission contract + the AI-powered on-chain function).

## On-chain proof (Mantle Sepolia)
The agent has already written decisions on-chain:
| Action | Price | Market | Tx |
|---|---|---|---|
| `HOLD` | $419.51 | PRE_MARKET | [`0x74b258…82856a`](https://explorer.sepolia.mantle.xyz/tx/0x74b258e0f376c23790d5b28da1bdb3a58312a422273f4b46a4e183d86182856a) |
| `WIDEN` | $419.60 | PRE_MARKET (earnings in 1.6d) | [`0x6b87d4…918f05`](https://explorer.sepolia.mantle.xyz/tx/0x6b87d430e30283d66f3279c83aabecdaf9b8ff9ae828b236fcfded8e79918f05) |

## Components (`app/`)
| File | Role |
|---|---|
| `src/byreal.js` | Byreal Skills CLI JSON wrapper (read-only) |
| `src/monitor.js` | Position snapshot + in-range / headroom |
| `src/equity.js` | US market session + earnings awareness ⭐ |
| `src/guardian.js` | Decision brain (HOLD/WATCH/WIDEN/REBALANCE + rationale) ⭐ |
| `src/rebalance.js` | Recenter plan + non-custodial close/open commands |
| `src/journal.js` | Writes decisions on-chain (`logDecision`) |
| `src/wallet.js` / `src/evm.js` | Non-custodial wallets (Solana / Mantle), local keystore |
| `src/bot.js` | Telegram bot (`/status`, `/plan`) |
| `contracts/AgentJournal.sol` | On-chain decision log (Mantle) |
| `scripts/deploy.js` · `verify.js` | Compile + deploy + verify |
| `web/index.html` | Public dashboard reading the journal live from Mantle |

## Run it
Requires Node 18+.
```bash
npm install -g @byreal-io/byreal-cli
cd app && npm install

npm run monitor          # read your live position (read-only, no key)
node src/guardian.js     # see the market-aware decision + rationale
node src/journal.js      # write the current decision on-chain (Mantle)
npm run bot              # Telegram bot (set TELEGRAM_BOT_TOKEN in .env)
```
Monitoring is **fully read-only** (no private key). See `.env.example`.

## Security
RangeClaw **never reads or stores your private key in plaintext anywhere it's transmitted**. Keys live only in `app/.wallet/` (gitignored). Execution is non-custodial: byreal-cli signs with a keypair you set locally, or RangeClaw emits an unsigned transaction you sign yourself.

## Tech
Node.js · Byreal Agent Skills (Solana CLMM) · ethers v6 · Solidity ^0.8 · Mantle Sepolia · grammY (Telegram) · Tailwind.
