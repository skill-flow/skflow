import { describe, it, expect } from "vitest";
import { transform } from "./transform.js";

/** Helper to verify a transform compiles and the step function runs */
function compileAndRun(source: string) {
  const result = transform(source);
  if (result.errors.length > 0) {
    return { errors: result.errors, code: result.code };
  }

  // Evaluate the generated code — strip 'export' keyword for eval context
  const evalCode = result.code.replace(/^export /gm, "");
  const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
  const mod = fn({});
  return { code: result.code, step: mod.step as (state: any, input?: string) => any, errors: [] };
}

describe("transform — sequential (5.9)", () => {
  it("sh → sh → ask → sh → done", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  const a = await sh("echo step1");
  const b = await sh("echo step2");
  const title = await ask({ prompt: "title?", data: { a, b } });
  const c = await sh("echo done");
  return done({ summary: title });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // Phase 0: sh("echo step1")
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("echo step1");
    expect(r0.next.phase).toBe(1);

    // Phase 1: receives sh result, sh("echo step2")
    const r1 = r.step!({ ...r0.next }, JSON.stringify({ stdout: "s1", stderr: "", code: 0 }));
    expect(r1._sh.cmd).toBe("echo step2");

    // Phase 2: receives sh result, ask
    const r2 = r.step!({ ...r1.next }, JSON.stringify({ stdout: "s2", stderr: "", code: 0 }));
    expect(r2.yield).toBeDefined();
    expect(r2.yield.prompt).toBe("title?");

    // Phase 3: receives answer, sh("echo done")
    const r3 = r.step!({ ...r2.next }, "my title");
    expect(r3._sh.cmd).toBe("echo done");

    // Phase 4: receives sh result, done
    const r4 = r.step!({ ...r3.next }, JSON.stringify({ stdout: "d", stderr: "", code: 0 }));
    expect(r4.done.summary).toBe("my title");
  });
});

describe("transform — if/else (5.10)", () => {
  it("yield in one branch, done in other", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  const diff = await sh("git diff --cached");
  if (!diff) {
    return done({ summary: "no changes" });
  } else {
    const title = await ask({ prompt: "title?" });
    return done({ summary: title });
  }
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // Phase 0: sh
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
  });
});

describe("transform — while + yield (5.11)", () => {
  it("retry loop with ask inside", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  let retries = 0;
  while (retries < 2) {
    const strategy = await ask({ prompt: "fix?", data: { retry: retries } });
    const result = await sh("echo fixing");
    retries++;
  }
  return done({ summary: "done after retries" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("switch");

    // Start: retries = 0, enters loop test
    const r0 = r.step!({ phase: 0 });
    // Should eventually reach an ask yield through the loop
    // The exact phases depend on implementation, just verify it compiles and runs
    expect(r0).toBeDefined();
  });
});

describe("transform — nested if in while (5.12)", () => {
  it("both branches yield inside a loop", () => {
    const source = `
import { sh, ask, askUser, done } from "@skflow/runtime";
export async function main() {
  let count = 0;
  while (count < 3) {
    if (count === 0) {
      const x = await ask({ prompt: "first?" });
    } else {
      const y = await askUser({ question: "other?" });
    }
    count++;
  }
  return done({ summary: "done" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("ask-user");
  });
});

describe("transform — for loop (5.13)", () => {
  it("sh inside a for loop", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  for (let i = 0; i < 3; i++) {
    const r = await sh("echo " + i);
  }
  return done({ summary: "looped" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // Phase 0 should set up loop init
    const r0 = r.step!({ phase: 0 });
    expect(r0).toBeDefined();
  });
});

describe("transform — no yields (5.14)", () => {
  it("pure done script compiles to single useful case", () => {
    const source = `
import { done } from "@skflow/runtime";
export async function main() {
  return done({ summary: "instant" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0.done.summary).toBe("instant");
  });
});

describe("transform — sh() with options (stdin/timeout)", () => {
  it("sh with stdin option compiles to _sh with stdin field", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  const result = await sh("git commit -F -", { stdin: "feat: test" });
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // Phase 0: sh with stdin
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("git commit -F -");
    expect(r0._sh.stdin).toBe("feat: test");
  });

  it("sh with timeout option compiles to _sh with timeout field", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  const result = await sh("slow-cmd", { timeout: 120000 });
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("slow-cmd");
    expect(r0._sh.timeout).toBe(120000);
  });

  it("sh with both stdin and timeout", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  const result = await sh("cmd", { stdin: "data", timeout: 30000 });
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("cmd");
    expect(r0._sh.stdin).toBe("data");
    expect(r0._sh.timeout).toBe(30000);
  });

  it("sh without options still works (backward compatible)", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  const result = await sh("echo hello");
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("echo hello");
    expect(r0._sh.stdin).toBeUndefined();
    expect(r0._sh.timeout).toBeUndefined();
  });

  it("sh with stdin using state variable", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  const message = await ask({ prompt: "commit message?" });
  const result = await sh("git commit -F -", { stdin: message });
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    // Should compile without errors — the stdin references state.message at runtime
    expect(r.code).toContain("stdin");
    expect(r.code).toContain("state.message");
  });

  it("bare sh with options (no assignment)", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  await sh("git commit -F -", { stdin: "test message" });
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh.cmd).toBe("git commit -F -");
    expect(r0._sh.stdin).toBe("test message");
  });
});

describe("transform — unsupported patterns (5.15)", () => {
  it("try/catch across yield produces error", () => {
    const source = `
import { ask } from "@skflow/runtime";
export async function main() {
  try {
    const x = await ask({ prompt: "test" });
  } catch (e) {
    console.log(e);
  }
}`;
    const r = compileAndRun(source);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("try/catch");
  });

  it("yield in nested function produces error", () => {
    const source = `
import { ask } from "@skflow/runtime";
export async function main() {
  const fn = async () => {
    const x = await ask({ prompt: "inner" });
  };
}`;
    const r = compileAndRun(source);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("nested function");
  });

  it("no main function produces error", () => {
    const source = `export function helper() { return 1; }`;
    const r = compileAndRun(source);
    expect(r.errors[0]).toContain("main");
  });
});
