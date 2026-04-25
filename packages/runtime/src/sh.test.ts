import { describe, it, expect } from "vitest";
import { execSh } from "./sh.js";

describe("execSh", () => {
  it("captures stdout of successful command", () => {
    const result = execSh("echo hello");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
  });

  it("captures stderr and exit code of failed command", () => {
    const result = execSh("node -e \"process.stderr.write('err'); process.exit(2)\"");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("err");
  });

  it("returns code -1 on timeout", () => {
    const result = execSh('node -e "setTimeout(()=>{},10000)"', 500);
    // On timeout, either killed=true or signal=SIGTERM depending on platform
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("timeout");
  });

  it("handles command that writes to both stdout and stderr", () => {
    const result = execSh("node -e \"process.stdout.write('out'); process.stderr.write('err')\"");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("out");
  });
});
