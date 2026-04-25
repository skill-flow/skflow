import { describe, it, expect, afterEach } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSession,
  loadMeta,
  loadState,
  saveState,
  loadLog,
  appendLog,
  removeSession,
  checkSessionValid,
  listSessions,
  cleanExpiredSessions,
  getSessionDir,
} from "./session.js";
import type { SessionState, LogEntry } from "./protocol.js";

const createdSessions: string[] = [];

afterEach(() => {
  for (const id of createdSessions) {
    removeSession(id);
  }
  createdSessions.length = 0;
});

function track(id: string): string {
  createdSessions.push(id);
  return id;
}

describe("session creation", () => {
  it("creates session directory with meta, state, log files", () => {
    const id = track(createSession("hello", "/path/to/hello.compiled.ts"));
    const dir = getSessionDir(id);

    expect(existsSync(join(dir, "meta.json"))).toBe(true);
    expect(existsSync(join(dir, "state.json"))).toBe(true);
    expect(existsSync(join(dir, "log.json"))).toBe(true);
  });

  it("meta contains script name and creation time", () => {
    const before = Date.now();
    const id = track(createSession("commit", "/scripts/commit.ts"));
    const meta = loadMeta(id);

    expect(meta.scriptName).toBe("commit");
    expect(meta.scriptPath).toBe("/scripts/commit.ts");
    expect(meta.createdAt).toBeGreaterThanOrEqual(before);
    expect(meta.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("initial state has phase 0", () => {
    const id = track(createSession("test", "/test.ts"));
    const state = loadState(id);
    expect(state.phase).toBe(0);
  });

  it("initial log is empty array", () => {
    const id = track(createSession("test", "/test.ts"));
    const log = loadLog(id);
    expect(log).toEqual([]);
  });
});

describe("state persistence", () => {
  it("saves and loads state with hoisted variables", () => {
    const id = track(createSession("test", "/test.ts"));
    const state: SessionState = { phase: 3, diff: "hello", retries: 2 };
    saveState(id, state);

    const loaded = loadState(id);
    expect(loaded).toEqual(state);
  });
});

describe("log persistence", () => {
  it("appends log entries", () => {
    const id = track(createSession("test", "/test.ts"));
    const entry1: LogEntry = { type: "sh", cmd: "git diff", code: 0, stdout: "diff", stderr: "" };
    const entry2: LogEntry = {
      type: "sh",
      cmd: "git status",
      code: 0,
      stdout: "clean",
      stderr: "",
    };

    appendLog(id, entry1);
    appendLog(id, entry2);

    const log = loadLog(id);
    expect(log).toHaveLength(2);
    expect(log[0].cmd).toBe("git diff");
    expect(log[1].cmd).toBe("git status");
  });
});

describe("session TTL", () => {
  it("valid session passes check", () => {
    const id = track(createSession("test", "/test.ts"));
    const meta = checkSessionValid(id);
    expect(meta.scriptName).toBe("test");
  });

  it("expired session throws", () => {
    const id = track(createSession("test", "/test.ts"));
    // Manually backdate the meta
    const dir = getSessionDir(id);
    const meta = loadMeta(id);
    meta.createdAt = Date.now() - 20 * 60 * 1000; // 20 minutes ago
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));

    expect(() => checkSessionValid(id)).toThrow("expired");
  });

  it("non-existent session throws", () => {
    expect(() => checkSessionValid("nonexistent-id")).toThrow("not found");
  });
});

describe("session removal", () => {
  it("removes session directory", () => {
    const id = createSession("test", "/test.ts"); // don't track, we remove manually
    const dir = getSessionDir(id);
    expect(existsSync(dir)).toBe(true);

    removeSession(id);
    expect(existsSync(dir)).toBe(false);
  });

  it("removing non-existent session is a no-op", () => {
    expect(() => removeSession("does-not-exist")).not.toThrow();
  });
});

describe("listSessions", () => {
  it("lists created sessions", () => {
    const id1 = track(createSession("hello", "/hello.ts"));
    const id2 = track(createSession("commit", "/commit.ts"));

    const sessions = listSessions();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });
});

describe("cleanExpiredSessions", () => {
  it("removes expired sessions and keeps active ones", () => {
    const active = track(createSession("active", "/a.ts"));
    const expired = createSession("expired", "/e.ts"); // don't track, it gets cleaned

    // Backdate the expired session
    const dir = getSessionDir(expired);
    const meta = loadMeta(expired);
    meta.createdAt = Date.now() - 20 * 60 * 1000;
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));

    const cleaned = cleanExpiredSessions();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(existsSync(getSessionDir(active))).toBe(true);
    expect(existsSync(getSessionDir(expired))).toBe(false);
  });
});
