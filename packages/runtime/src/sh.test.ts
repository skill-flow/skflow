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
    const result = execSh('node -e "setTimeout(()=>{},10000)"', { timeout: 500 });
    // On timeout, either killed=true or signal=SIGTERM depending on platform
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("timeout");
  });

  it("handles command that writes to both stdout and stderr", () => {
    const result = execSh("node -e \"process.stdout.write('out'); process.stderr.write('err')\"");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("out");
  });

  it("pipes stdin content to command", () => {
    const result = execSh(
      "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))\"",
      {
        stdin: "hello from stdin",
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello from stdin");
  });

  it("pipes empty stdin to command", () => {
    const result = execSh(
      "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write('len:'+d.length))\"",
      {
        stdin: "",
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("len:0");
  });

  it("pipes stdin to a command that fails", () => {
    const result = execSh(
      "node -e \"process.stdin.resume();process.stderr.write('bad input');process.exit(1)\"",
      {
        stdin: "some content",
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("bad input");
  });

  it("pipes multi-line stdin content", () => {
    const multiLine = "line1\nline2\nline3";
    const result = execSh(
      "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))\"",
      {
        stdin: multiLine,
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(multiLine);
  });
});
