import { execSync } from "node:child_process";
import type { ShResult } from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface ExecShOptions {
  stdin?: string;
  timeout?: number;
}

export function execSh(cmd: string, opts?: ExecShOptions): ShResult {
  const timeoutMs = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      input: opts?.stdin,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: any) {
    if (err.killed || err.signal === "SIGTERM") {
      return { stdout: "", stderr: "timeout", code: -1 };
    }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      code: err.status ?? 1,
    };
  }
}

// Placeholder for script-author API — actual execution happens in the runtime loop
export async function sh(
  _cmd: string,
  _opts?: { stdin?: string; timeout?: number },
): Promise<ShResult> {
  throw new Error(
    "sh() cannot be called directly. It is transformed into a state machine yield point at compile time.",
  );
}
