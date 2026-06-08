// RangeClaw - dashboard host (for 24/7 live charts).
// Serves web/ and refreshes web/data.json every RG_REFRESH_MIN minutes by running
// the READ-ONLY exporter (Byreal pool/position reads — NO private key needed).
// The on-chain decision journal is read live by the browser from Mantle.
// Deploy to Render / Railway / Fly via the Dockerfile (no secrets required).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = dirname(fileURLToPath(import.meta.url)); // app/
const WEB = join(root, "web");
const PORT = process.env.PORT || 8080;
const REFRESH_MIN = Number(process.env.RG_REFRESH_MIN || 10);
const pexec = promisify(execFile);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

async function refresh() {
  try { await pexec(process.execPath, [join(root, "scripts", "export-data.js")]); console.log(new Date().toISOString(), "data.json refreshed"); }
  catch (e) { console.error("refresh failed:", e.message); }
}

http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = join(WEB, p);
  if (!file.startsWith(WEB) || !existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch { res.writeHead(500); res.end("error"); }
}).listen(PORT, () => console.log(`RangeClaw dashboard on :${PORT} · data refresh every ${REFRESH_MIN}m`));

refresh();
setInterval(refresh, REFRESH_MIN * 60 * 1000);
