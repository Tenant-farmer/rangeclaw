# Deploying RangeClaw

## Smart contract (Mantle) — already deployed
AgentJournal is live at `0x09542c48b8708ed0CeB52a636193A2d932D9350E` (Mantle Sepolia).
Redeploy: `node src/evm.js generate` → fund at faucet.sepolia.mantle.xyz → `node scripts/deploy.js`.

## Static dashboard (simplest) — Netlify
Drag the `web/` folder onto https://app.netlify.com/drop. `data.json` is a snapshot
(re-run `npm run export` + redeploy to refresh). The on-chain journal is always live.

## Live dashboard (24/7 auto-refresh) — Docker / Render / Railway / Fly
`server.js` serves `web/` and re-runs the **read-only** exporter every few minutes
(Byreal reads only — **no private key needed**). The on-chain journal stays live in the browser.

**Render (from this GitHub repo):**
1. New → Web Service → connect `github.com/Tenant-farmer/rangeclaw`.
2. Runtime: **Docker** (uses the included `Dockerfile`). No env vars required.
3. Deploy → you get a public `…onrender.com` URL with always-fresh charts.

**Local Docker:**
```bash
docker build -t rangeclaw .
docker run -p 8080:8080 rangeclaw   # http://localhost:8080
```

**Optional — autonomous on-chain logging (needs a key):**
`scripts/agent-loop.js` logs decisions on change to Mantle. It needs the agent's
EVM key in `.wallet/` (set locally; never commit). Run it where you keep the key
(your machine, or a private worker) — not required for the public dashboard.
