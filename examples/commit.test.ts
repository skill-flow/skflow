import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { transform } from "@ocmdx/transform";

const commitSrc = fs.readFileSync(path.join(__dirname, "commit.ts"), "utf-8");

describe("Commit Command Pilot (8.1–8.2)", () => {
  it("compiles commit.ts without errors", () => {
    const result = transform(commitSrc, "commit.ts");
    expect(result.errors).toEqual([]);
    expect(result.code).toContain("switch");
  });

  it("compiled output handles while + if/else + askUser", () => {
    const result = transform(commitSrc, "commit.ts");
    // Should contain ask-user yield type for askUser() calls
    expect(result.code).toContain("ask-user");
    // Should have a loop structure (continue back to loop test)
    expect(result.code).toContain("continue");
    // Should reference state.retries
    expect(result.code).toContain("state.retries");
    // Should reference state.title for the commit message
    expect(result.code).toContain("state.title");
  });

  it("state machine is runnable", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});
    expect(typeof mod.step).toBe("function");

    // Phase 0 should emit sh("git diff --cached --name-status")
    const r0 = mod.step({ phase: 0 });
    expect(r0._sh).toBeDefined();
    expect(r0._sh.cmd).toBe("git diff --cached --name-status");
  });

  it("no-staged-files path returns done immediately", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});

    // Phase 0: sh returns empty (no staged files)
    const r0 = mod.step({ phase: 0 });
    // Phase 1: receives empty sh result — staged is falsy
    const r1 = mod.step({ ...r0.next }, JSON.stringify({ stdout: "", stderr: "", code: 0 }));
    expect(r1.done).toBeDefined();
    expect(r1.done.summary).toBe("No staged files");
  });
});

describe("Commit E2E — happy path (8.4)", () => {
  it("sh → ask(title) → sh(commit) flow", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});

    // Phase 0: sh("git diff --cached --name-status")
    const state = { phase: 0 };
    const r0 = mod.step(state);
    expect(r0._sh.cmd).toBe("git diff --cached --name-status");

    // Phase 1: receive staged result (non-empty)
    const r1 = mod.step(
      { ...r0.next },
      JSON.stringify({ stdout: "M\tsrc/index.ts", stderr: "", code: 0 }),
    );
    expect(r1._sh.cmd).toBe("git diff --cached --stat");

    // Phase 2: receive stat result
    const r2 = mod.step(
      { ...r1.next },
      JSON.stringify({ stdout: "1 file changed", stderr: "", code: 0 }),
    );
    expect(r2._sh.cmd).toBe("git diff --cached");

    // Phase 3: receive diff result — now ask for title
    const r3 = mod.step(
      { ...r2.next },
      JSON.stringify({ stdout: "+new code", stderr: "", code: 0 }),
    );
    expect(r3.yield).toBeDefined();
    expect(r3.yield.prompt).toContain("commit title");

    // Phase 4: receive title answer — sh(git commit)
    const r4 = mod.step({ ...r3.next }, "feat: add new feature");
    expect(r4._sh.cmd).toContain("git commit");
    expect(r4._sh.cmd).toContain("feat: add new feature");
  });
});
