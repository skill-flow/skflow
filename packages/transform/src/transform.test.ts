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
  it("try/catch across yield compiles successfully", () => {
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
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("_tries");
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

describe("transform — object literal keys are not rewritten", () => {
  it("named keys in data object stay as-is", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  const stat = await sh("git diff --stat");
  const nameStatus = await sh("git diff --name-status");
  const generated = await ask({
    prompt: "Generate PR title",
    data: {
      stat: stat.stdout,
      nameStatus: nameStatus.stdout,
    },
  });
  return done({ summary: generated });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    // Object keys must NOT be prefixed with state.
    expect(r.code).not.toContain("state.stat:");
    expect(r.code).not.toContain("state.nameStatus:");
    // Values should reference state
    expect(r.code).toContain("state.stat.stdout");
    expect(r.code).toContain("state.nameStatus.stdout");

    // Run through to the ask yield and verify data keys
    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!({ ...r0.next }, JSON.stringify({ stdout: "s1", stderr: "", code: 0 }));
    const r2 = r.step!({ ...r1.next }, JSON.stringify({ stdout: "s2", stderr: "", code: 0 }));
    expect(r2.yield).toBeDefined();
    expect(r2.yield.data).toHaveProperty("stat", "s1");
    expect(r2.yield.data).toHaveProperty("nameStatus", "s2");
  });
});

describe("transform — top-level declarations are preserved", () => {
  it("top-level constants and helper functions are emitted", () => {
    const source = `
import { sh, done } from "@skflow/runtime";

const REPO = "my-org/my-repo";
const TARGET = "main";

function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\\\''") + "'";
}

export async function main() {
  const result = await sh("echo " + shQuote(REPO));
  return done({ summary: REPO + " " + TARGET });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain('const REPO = "my-org/my-repo"');
    expect(r.code).toContain('const TARGET = "main"');
    expect(r.code).toContain("function shQuote");
  });
});

// ─── Try/Catch/Finally Tests ─────────────────────────────────────────

/** Helper: simulate step execution through the state machine with error injection */
function runSteps(
  step: (state: any, input?: string) => any,
  inputs: Array<{ input?: string; throwError?: any }>,
): any {
  let state = { phase: 0 };
  let result: any;
  for (const { input, throwError } of inputs) {
    result = step(state, input);
    if (result.done) return result;
    if (result.yield) return result;
    if (result._sh) {
      // For _sh results, runner would call again with sh result
      state = result.next;
    } else {
      state = result.next;
    }
  }
  return result;
}

describe("transform — try/catch with yields", () => {
  it("try body with sh() — normal path skips catch", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let result = "init";
  try {
    const x = await sh("echo hello");
    result = "try-done";
  } catch (e) {
    result = "caught";
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("_tries");

    // Normal path: sh succeeds, catch skipped
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "hello", stderr: "", code: 0 }));
    // r1 should eventually reach done
    const state = r1.next ?? r1;
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("try-done");
  });

  it("try body with ask() — normal path skips catch", () => {
    const source = `
import { ask, done } from "@skflow/runtime";
export async function main() {
  let result = "init";
  try {
    const x = await ask({ prompt: "name?" });
    result = x;
  } catch (e) {
    result = "caught";
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0.yield).toBeDefined();
    expect(r0.yield.prompt).toBe("name?");
    const r1 = r.step!(r0.next, "Alice");
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("Alice");
  });

  it("multiple yields in try body", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  let out = "";
  try {
    const a = await sh("echo 1");
    const b = await ask({ prompt: "next?" });
    const c = await sh("echo 2");
    out = a.stdout + "," + b + "," + c.stdout;
  } catch (e) {
    out = "caught";
  }
  return done({ summary: out });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // sh → ask → sh → done
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "one", stderr: "", code: 0 }));
    expect(r1.yield).toBeDefined();
    expect(r1.yield.prompt).toBe("next?");
    const r2 = r.step!(r1.next, "two");
    expect(r2._sh).toBeDefined();
    const r3 = r.step!(r2.next, JSON.stringify({ stdout: "three", stderr: "", code: 0 }));
    let result = r3;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("one,two,three");
  });

  it("sh throws in try body — caught by catch", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let result = "init";
  try {
    const x = await sh("failing-cmd");
    result = "try-done";
  } catch (e) {
    result = "caught:" + e.code;
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    // sh returns non-zero → throw → catch
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "fail", code: 1 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("caught:1");
  });

  it("yield inside catch body", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let result = "init";
  try {
    const x = await sh("will-fail");
    result = "try-done";
  } catch (e) {
    const msg = await ask({ prompt: "Error occurred: " + e.stderr });
    result = "caught:" + msg;
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // sh fails → enters catch → ask → done
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "oops", code: 1 }));
    // Should now be in catch, asking
    let result = r1;
    while (result.next && !result.done && !result.yield) {
      result = r.step!(result.next);
    }
    expect(result.yield).toBeDefined();
    const r2 = r.step!(result.next, "acknowledged");
    result = r2;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("caught:acknowledged");
  });

  it("code after try/catch block executes", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let result = "";
  try {
    const x = await sh("echo hello");
    result = "try";
  } catch (e) {
    result = "catch";
  }
  const after = await sh("echo after");
  result = result + "+" + after.stdout;
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "hi", stderr: "", code: 0 }));
    // Should continue after try/catch to second sh
    let result = r1;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    const r2 = r.step!(result.next, JSON.stringify({ stdout: "post", stderr: "", code: 0 }));
    result = r2;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("try+post");
  });
});

describe("transform — try/finally with yields", () => {
  it("try-finally normal path — finally executes", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let result = "";
  try {
    const x = await sh("echo hello");
    result = "try";
  } finally {
    result = result + "+finally";
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "hi", stderr: "", code: 0 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("try+finally");
  });

  it("try-finally with error — finally executes then error propagates", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    const x = await sh("will-fail");
    log = "try-done";
  } finally {
    log = log + "+finally";
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    // sh fails → throw → finally → re-throw (all within one step call)
    let threw = false;
    try {
      const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "err", code: 1 }));
      let result = r1;
      while (result.next && !result.done) {
        result = r.step!(result.next);
      }
    } catch (e: any) {
      threw = true;
      expect(e.code).toBe(1);
    }
    expect(threw).toBe(true);
  });

  it("yield inside finally body", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  let result = "";
  try {
    const x = await sh("echo hello");
    result = "try";
  } finally {
    const cleanup = await sh("echo cleanup");
    result = result + "+" + cleanup.stdout;
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "hi", stderr: "", code: 0 }));
    // Should proceed into finally which has an sh()
    let result = r1;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    expect(result._sh.cmd).toBe("echo cleanup");
    const r2 = r.step!(result.next, JSON.stringify({ stdout: "cleaned", stderr: "", code: 0 }));
    result = r2;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("try+cleaned");
  });

  it("return done() inside try routes through finally", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let log = "";
  try {
    const x = await sh("echo hello");
    log = "returning";
    return done({ summary: log });
  } finally {
    log = log + "+finally";
  }
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "hi", stderr: "", code: 0 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    // The return goes through finally, which sets log, then the original done is returned
    expect(result.done).toBeDefined();
    expect(result.done.summary).toBe("returning");
  });
});

describe("transform — try/catch/finally combined", () => {
  it("normal path: try → finally (catch skipped)", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let log = "";
  try {
    const x = await sh("echo ok");
    log = "try";
  } catch (e) {
    log = "catch";
  } finally {
    log = log + "+finally";
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "ok", stderr: "", code: 0 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("try+finally");
  });

  it("error path: try → catch → finally", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    const x = await sh("bad-cmd");
    log = "try";
  } catch (e) {
    log = "catch:" + e.code;
  } finally {
    log = log + "+finally";
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "err", code: 2 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("catch:2+finally");
  });

  it("yield in catch and finally bodies", () => {
    const source = `
import { sh, ask, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    const x = await sh("bad-cmd");
    log = "try";
  } catch (e) {
    const msg = await ask({ prompt: "handle error" });
    log = "catch:" + msg;
  } finally {
    const cleanup = await sh("echo cleanup");
    log = log + "+finally:" + cleanup.stdout;
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // sh fails → catch → ask → finally → sh → done
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "err", code: 1 }));
    // Should land in catch which does ask
    let result = r1;
    while (result.next && !result.done && !result.yield) {
      result = r.step!(result.next);
    }
    expect(result.yield).toBeDefined();
    expect(result.yield.prompt).toBe("handle error");
    const r2 = r.step!(result.next, "handled");
    // Now should be in finally which does sh
    result = r2;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    expect(result._sh.cmd).toBe("echo cleanup");
    const r3 = r.step!(result.next, JSON.stringify({ stdout: "done", stderr: "", code: 0 }));
    result = r3;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("catch:handled+finally:done");
  });

  it("error in catch body routes to finally then re-throws", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    const x = await sh("fail1");
    log = "try";
  } catch (e) {
    const y = await sh("fail2");
    log = "catch";
  } finally {
    log = log + "+finally";
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // first sh fails → catch → second sh fails in catch → finally → re-throw
    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "e1", code: 1 }));
    // Now in catch, which calls sh
    let result = r1;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    // second sh also fails → throw in catch → routes to finally → re-throw
    let threw = false;
    try {
      const r2 = r.step!(result.next, JSON.stringify({ stdout: "", stderr: "e2", code: 3 }));
      result = r2;
      while (result.next && !result.done) {
        result = r.step!(result.next);
      }
    } catch (e: any) {
      threw = true;
      expect(e.code).toBe(3);
    }
    expect(threw).toBe(true);
  });
});

describe("transform — nested try and try in loops", () => {
  it("nested try/catch", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    try {
      const x = await sh("inner-fail");
      log = "inner-try";
    } catch (e) {
      log = "inner-catch:" + e.code;
    }
    const y = await sh("echo outer");
    log = log + "+outer:" + y.stdout;
  } catch (e) {
    log = "outer-catch";
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // inner sh fails → inner catch → outer sh succeeds → done
    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "e", code: 5 }));
    // Inner catch handles it, then outer sh runs
    let result = r1;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    expect(result._sh.cmd).toBe("echo outer");
    const r2 = r.step!(result.next, JSON.stringify({ stdout: "ok", stderr: "", code: 0 }));
    result = r2;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("inner-catch:5+outer:ok");
  });

  it("nested try — inner unhandled propagates to outer catch", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  try {
    try {
      const x = await sh("inner-fail");
      log = "inner-try";
    } finally {
      log = "inner-finally";
    }
    log = log + "+after-inner";
  } catch (e) {
    log = log + "+outer-catch:" + e.code;
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "e", code: 7 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("inner-finally+outer-catch:7");
  });

  it("try/catch inside while loop", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let log = "";
  let i = 0;
  while (i < 2) {
    try {
      const x = await sh("cmd-" + i);
      log = log + "ok" + i;
    } catch (e) {
      log = log + "err" + i;
    }
    i = i + 1;
  }
  return done({ summary: log });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    // iteration 0: sh succeeds
    const r0 = r.step!({ phase: 0 });
    let result = r0;
    // Find the first sh
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    const r1 = r.step!(result.next, JSON.stringify({ stdout: "a", stderr: "", code: 0 }));
    result = r1;
    // Loop back, find second sh
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    // iteration 1: sh fails
    const r2 = r.step!(result.next, JSON.stringify({ stdout: "", stderr: "x", code: 1 }));
    result = r2;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("ok0err1");
  });

  it("try with both yield and non-yield statements in try body", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let x = 0;
  try {
    x = 1;
    const r = await sh("echo test");
    x = 2;
  } catch (e) {
    x = -1;
  }
  return done({ summary: String(x) });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    let result = r0;
    while (result.next && !result.done && !result._sh) {
      result = r.step!(result.next);
    }
    expect(result._sh).toBeDefined();
    const r1 = r.step!(result.next, JSON.stringify({ stdout: "test", stderr: "", code: 0 }));
    result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("2");
  });
});

describe("transform — sh-throws pragma", () => {
  it("sh-throws pragma makes all sh() throw on non-zero", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  let result = "init";
  try {
    const x = await sh("will-fail");
    result = "ok";
  } catch (e) {
    result = "caught:" + e.stderr;
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "bad", code: 1 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("caught:bad");
  });

  it("per-call { throws: true } overrides no-pragma default", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  let result = "init";
  try {
    const x = await sh("will-fail", { throws: true });
    result = "ok";
  } catch (e) {
    result = "caught:" + e.code;
  }
  return done({ summary: result });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "err", code: 42 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    expect(result.done.summary).toBe("caught:42");
  });

  it("per-call { throws: false } overrides pragma", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  const x = await sh("will-fail", { throws: false });
  return done({ summary: "code:" + x.code });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);

    const r0 = r.step!({ phase: 0 });
    expect(r0._sh).toBeDefined();
    const r1 = r.step!(r0.next, JSON.stringify({ stdout: "", stderr: "err", code: 3 }));
    let result = r1;
    while (result.next && !result.done) {
      result = r.step!(result.next);
    }
    // Should NOT throw — just returns the result with code
    expect(result.done.summary).toBe("code:3");
  });
});

describe("transform — try/catch compilation structure", () => {
  it("generates _tries dispatch table", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  try {
    const x = await sh("echo test");
  } catch (e) {
    console.log(e);
  }
  return done({ summary: "ok" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("const _tries");
    expect(r.code).toContain("_loop:");
  });

  it("generates labeled _loop with catch dispatch", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
// @skflow sh-throws
export async function main() {
  try {
    const x = await sh("cmd");
  } catch (e) {
    const y = await sh("echo caught");
  }
  return done({ summary: "done" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("_loop:");
    expect(r.code).toContain("catch (_e)");
    expect(r.code).toContain("continue _loop");
  });

  it("try-finally generates _completion assignments", () => {
    const source = `
import { sh, done } from "@skflow/runtime";
export async function main() {
  try {
    const x = await sh("cmd");
  } finally {
    console.log("cleanup");
  }
  return done({ summary: "done" });
}`;
    const r = compileAndRun(source);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("_completion");
    expect(r.code).toContain('"normal"');
  });
});
