import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { transform } from "@skflow/transform";
import { run, resume } from "@skflow/runtime";
import type { StepFunction, YieldMessage, DoneMessage } from "@skflow/runtime";

const helloSrc = fs.readFileSync(path.join(__dirname, "hello.ts"), "utf-8");

function loadStep(source: string): StepFunction {
  const result = transform(source);
  expect(result.errors).toEqual([]);
  const evalCode = result.code.replace(/^export /gm, "");
  const fn = new Function("exports", evalCode + "\nexports.step = step;\nreturn exports;");
  return fn({}).step as StepFunction;
}

function isYield(r: YieldMessage | DoneMessage): r is YieldMessage {
  return "yield" in r;
}

function isDone(r: YieldMessage | DoneMessage): r is DoneMessage {
  return "done" in r;
}

describe("Hello World Pilot (7.1–7.5)", () => {
  it("compiles hello.ts without errors", () => {
    const result = transform(helloSrc, "hello.ts");
    expect(result.errors).toEqual([]);
    expect(result.code).toContain("switch");
    expect(result.code).toContain("state.phase");
  });

  it("compiled output has expected state machine shape", () => {
    const result = transform(helloSrc, "hello.ts");
    // Should have: phase 0 (sh echo hello), phase 1 (receive sh result + ask), phase 2 (receive answer + sh echo Hi), phase 3 (receive sh result + done)
    expect(result.code).toContain("case 0:");
    expect(result.code).toContain("case 1:");
    expect(result.code).toContain("case 2:");
    expect(result.code).toContain("echo hello");
    expect(result.code).toContain("What is your name?");
  });

  it("full run → yield → resume → done cycle", () => {
    const step = loadStep(helloSrc);

    // Run: executes sh("echo hello"), then yields ask
    const r1 = run({ scriptName: "hello", scriptPath: "/tmp/hello.js", step });
    expect(isYield(r1)).toBe(true);
    if (!isYield(r1)) throw new Error("expected yield");

    // Verify the sh log entry
    expect(r1.log.length).toBeGreaterThanOrEqual(1);
    expect(r1.log[0].cmd).toBe("echo hello");
    expect(r1.log[0].stdout.trim()).toBe("hello");

    // Verify the yield is our ask
    expect(r1.yield.prompt).toBe("What is your name?");
    expect(r1.session).toBeTruthy();

    // Resume with answer: executes sh("echo Hi, Alice"), then done
    const r2 = resume({ sessionId: r1.session, answer: "Alice", step });
    expect(isDone(r2)).toBe(true);
    if (!isDone(r2)) throw new Error("expected done");

    // Verify the sh log from resume
    const hiLog = r2.log.find((l) => l.cmd.includes("Hi,"));
    expect(hiLog).toBeDefined();
    expect(hiLog!.stdout.trim()).toBe("Hi, Alice");

    // Verify done
    expect(r2.done.summary).toBe("Greeted Alice");
  });
});
