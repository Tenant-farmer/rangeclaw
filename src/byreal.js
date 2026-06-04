// Thin wrapper around the global `byreal-cli` (Byreal Agent Skills, Solana CLMM).
// Always runs with --non-interactive -o json so output is machine-parseable.
// READ-ONLY by design here; write commands (open/close) are added later behind
// an explicit dry-run -> confirm flow.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(exec);

/**
 * Run a byreal-cli subcommand and return parsed JSON.
 * @param {string} argString e.g. `pools info <POOL>` or `positions list --user <W> --pool <P>`
 */
export async function byreal(argString) {
  const cmd = `byreal-cli --non-interactive -o json ${argString}`;
  const { stdout } = await pexec(cmd, { maxBuffer: 16 * 1024 * 1024 });
  const json = JSON.parse(stdout);
  if (json && json.success === false) {
    const e = json.error || {};
    throw new Error(`byreal-cli ${e.code || "ERROR"}: ${e.message || "unknown error"}`);
  }
  return json;
}

export const poolInfo = (pool) => byreal(`pools info ${pool}`);
export const listPositions = (owner, pool) =>
  byreal(`positions list --user ${owner} --pool ${pool}`);
