import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { transform } from "@skflow/transform";

const commitSrc = fs.readFileSync(path.join(__dirname, "commit.ts"), "utf-8");

describe("Commit Command — compilation", () => {
  it("compiles commit.ts without errors", () => {
    const result = transform(commitSrc, "commit.ts");
    expect(result.errors).toEqual([]);
    expect(result.code).toContain("switch");
  });

  it("compiled output contains stdin in sh yield", () => {
    const result = transform(commitSrc, "commit.ts");
    expect(result.code).toContain("stdin");
    expect(result.code).toContain("git commit -F -");
  });

  it("compiled output uses ask (not askUser) for LLM judgment", () => {
    const result = transform(commitSrc, "commit.ts");
    // ask() yields have type "text", askUser has "ask-user"
    // The new commit.ts should only use ask(), not askUser()
    expect(result.code).toContain('"text"');
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
});

describe("Commit — no staged files path", () => {
  it("returns done immediately when no staged files", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});

    // Phase 0: sh returns empty (no staged files)
    const r0 = mod.step({ phase: 0 });
    // Phase 1: receives empty sh result — staged.stdout is empty
    const r1 = mod.step({ ...r0.next }, JSON.stringify({ stdout: "", stderr: "", code: 0 }));
    expect(r1.done).toBeDefined();
    expect(r1.done.summary).toBe("No staged files");
  });
});

describe("Commit E2E — happy path", () => {
  it("diff → ask(message) → sh(commit with stdin) → done", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});

    // Phase 0: sh("git diff --cached --name-status")
    const r0 = mod.step({ phase: 0 });
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

    // Phase 3: receive diff result — now ask for commit message
    const r3 = mod.step(
      { ...r2.next },
      JSON.stringify({ stdout: "+new code", stderr: "", code: 0 }),
    );
    expect(r3.yield).toBeDefined();
    expect(r3.yield.type).toBe("text");
    expect(r3.yield.prompt).toContain("commit message");

    // Phase 4: receive message answer — sh(git commit -F - with stdin)
    const commitMsg = "feat: add new feature\n\n- Added login form component";
    const r4 = mod.step({ ...r3.next }, commitMsg);
    expect(r4._sh.cmd).toBe("git commit -F -");
    expect(r4._sh.stdin).toBe(commitMsg);

    // Phase 5: commit succeeds — done
    const r5 = mod.step(
      { ...r4.next },
      JSON.stringify({ stdout: "[main abc123] feat: add new feature", stderr: "", code: 0 }),
    );
    expect(r5.done).toBeDefined();
    expect(r5.done.summary).toBe("feat: add new feature");
  });
});

describe("Commit E2E — pre-commit failure path", () => {
  it("commit fails → ask(fix) → restage → retry → done", () => {
    const result = transform(commitSrc, "commit.ts");
    const evalCode = result.code.replace(/^export /gm, "");
    const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
    const mod = fn({});

    // Run through to the commit step (phases 0-4)
    const r0 = mod.step({ phase: 0 });
    const r1 = mod.step(
      { ...r0.next },
      JSON.stringify({ stdout: "M\tsrc/index.ts", stderr: "", code: 0 }),
    );
    const r2 = mod.step(
      { ...r1.next },
      JSON.stringify({ stdout: "1 file changed", stderr: "", code: 0 }),
    );
    const r3 = mod.step({ ...r2.next }, JSON.stringify({ stdout: "+code", stderr: "", code: 0 }));

    // Provide commit message
    const commitMsg = "feat: add feature\n\n- Details";
    const r4 = mod.step({ ...r3.next }, commitMsg);
    expect(r4._sh.cmd).toBe("git commit -F -");
    expect(r4._sh.stdin).toBe(commitMsg);

    // Commit FAILS (pre-commit hook error)
    const r5 = mod.step(
      { ...r4.next },
      JSON.stringify({
        stdout: "",
        stderr: "eslint: no-unused-vars error in src/index.ts",
        code: 1,
      }),
    );

    // Should enter the while(true) loop and yield ask() with error context
    expect(r5.yield).toBeDefined();
    expect(r5.yield.type).toBe("text");
    expect(r5.yield.prompt).toContain("Pre-commit hook failed");
    expect(r5.yield.prompt).toContain("eslint");

    // Claude Code fixes the code and resumes — script does git add -u
    const r6 = mod.step({ ...r5.next }, "fixed the eslint errors");
    expect(r6._sh.cmd).toBe("git add -u");

    // git add -u succeeds, then retry commit
    const r7 = mod.step({ ...r6.next }, JSON.stringify({ stdout: "", stderr: "", code: 0 }));
    expect(r7._sh.cmd).toBe("git commit -F -");
    expect(r7._sh.stdin).toBe(commitMsg);

    // Retry succeeds
    const r8 = mod.step(
      { ...r7.next },
      JSON.stringify({ stdout: "[main def456] feat: add feature", stderr: "", code: 0 }),
    );
    expect(r8.done).toBeDefined();
    expect(r8.done.summary).toBe("feat: add feature");
  });
});
