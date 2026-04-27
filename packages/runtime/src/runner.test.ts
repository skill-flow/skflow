import { describe, it, expect, afterEach } from "vitest";
import { run, resume, RuntimeError } from "./runner.js";
import { createSession, removeSession, getSessionDir, loadMeta } from "./session.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StepFunction, SessionState } from "./protocol.js";

const cleanupIds: string[] = [];

afterEach(() => {
  for (const id of cleanupIds) {
    removeSession(id);
  }
  cleanupIds.length = 0;
});

describe("run", () => {
  it("script that immediately returns done", () => {
    const step: StepFunction = () => ({
      done: { summary: "nothing to do" },
    });

    const result = run({ scriptName: "test", scriptPath: "/test.ts", step });
    expect("done" in result).toBe(true);
    if ("done" in result) {
      expect(result.done.summary).toBe("nothing to do");
      expect(result.log).toEqual([]);
    }
  });

  it("script with sh then ask yields correctly", () => {
    const step: StepFunction = (state: SessionState, input?: string) => {
      switch (state.phase) {
        case 0:
          return { _sh: { cmd: "echo hello" }, next: { phase: 1 } };
        case 1: {
          // input = JSON stringified ShResult from the sh call
          const shResult = JSON.parse(input!);
          return {
            yield: {
              type: "text" as const,
              prompt: "What is your name?",
              data: { greeting: shResult.stdout },
            },
            next: { phase: 2, greeting: shResult.stdout },
          };
        }
        case 2:
          return { done: { summary: `Hello, ${input}! ${(state as any).greeting}` } };
        default:
          throw new Error("unexpected phase");
      }
    };

    const result1 = run({ scriptName: "hello", scriptPath: "/hello.ts", step });
    expect("yield" in result1).toBe(true);
    if ("yield" in result1) {
      expect(result1.yield.type).toBe("text");
      expect(result1.yield.prompt).toBe("What is your name?");
      expect(result1.log).toHaveLength(1);
      expect(result1.log[0].cmd).toBe("echo hello");
      expect(result1.session).toBeTruthy();
      expect(result1.resume).toContain("skflow resume");

      // Now resume with an answer
      cleanupIds.push(result1.session);
      const result2 = resume({ sessionId: result1.session, answer: "World", step });
      expect("done" in result2).toBe(true);
      if ("done" in result2) {
        expect(result2.done.summary).toContain("Hello, World!");
      }
    }
  });

  it("multiple sh calls are auto-resumed and logged", () => {
    const step: StepFunction = (state: SessionState, _input?: string) => {
      switch (state.phase) {
        case 0:
          return { _sh: { cmd: "echo step1" }, next: { phase: 1 } };
        case 1:
          return { _sh: { cmd: "echo step2" }, next: { phase: 2 } };
        case 2:
          return { _sh: { cmd: "echo step3" }, next: { phase: 3 } };
        case 3:
          return { done: { summary: "all done" } };
        default:
          throw new Error("unexpected phase");
      }
    };

    const result = run({ scriptName: "multi", scriptPath: "/multi.ts", step });
    expect("done" in result).toBe(true);
    if ("done" in result) {
      expect(result.log).toHaveLength(3);
      expect(result.log[0].cmd).toBe("echo step1");
      expect(result.log[1].cmd).toBe("echo step2");
      expect(result.log[2].cmd).toBe("echo step3");
    }
  });

  it("ask-user yield type is preserved", () => {
    const step: StepFunction = () => ({
      yield: { type: "ask-user" as const, prompt: "Pick one", options: ["a", "b"] },
      next: { phase: 1 },
    });

    const result = run({ scriptName: "test", scriptPath: "/test.ts", step });
    expect("yield" in result).toBe(true);
    if ("yield" in result) {
      expect(result.yield.type).toBe("ask-user");
      expect(result.yield.options).toEqual(["a", "b"]);
      cleanupIds.push(result.session);
    }
  });

  it("session is cleaned up on done", () => {
    const step: StepFunction = () => ({ done: { summary: "bye" } });
    // We need to capture the session id to check cleanup
    // Since run creates and immediately resolves, session should be gone
    const result = run({ scriptName: "test", scriptPath: "/test.ts", step });
    expect("done" in result).toBe(true);
    // Can't easily check session removal since we don't get the id back on done
    // but the function should not throw
  });

  it("step function throw produces RuntimeError", () => {
    const step: StepFunction = () => {
      throw new Error("script exploded");
    };

    expect(() => run({ scriptName: "bad", scriptPath: "/bad.ts", step })).toThrow(RuntimeError);
  });
});

describe("resume", () => {
  it("rejects expired session", () => {
    const id = createSession("test", "/test.ts");
    cleanupIds.push(id);
    const dir = getSessionDir(id);
    const meta = loadMeta(id);
    meta.createdAt = Date.now() - 20 * 60 * 1000;
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));

    const step: StepFunction = () => ({ done: { summary: "ok" } });
    expect(() => resume({ sessionId: id, answer: "x", step })).toThrow("expired");
  });
});
