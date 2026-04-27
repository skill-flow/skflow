import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionState, SessionMeta, LogEntry } from "./protocol.js";

const SESSION_TTL_MS = 15 * 60 * 1000;

export function getSessionsDir(): string {
  return join(tmpdir(), "skflow", "sessions");
}

export function getSessionDir(sessionId: string): string {
  return join(getSessionsDir(), sessionId);
}

export function createSession(scriptName: string, scriptPath: string): string {
  const id = randomUUID();
  const dir = getSessionDir(id);
  mkdirSync(dir, { recursive: true });

  const meta: SessionMeta = {
    scriptName,
    scriptPath,
    createdAt: Date.now(),
  };
  const state: SessionState = { phase: 0 };

  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, "log.json"), JSON.stringify([]));

  return id;
}

export function loadMeta(sessionId: string): SessionMeta {
  const path = join(getSessionDir(sessionId), "meta.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadState(sessionId: string): SessionState {
  const path = join(getSessionDir(sessionId), "state.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function saveState(sessionId: string, state: SessionState): void {
  const path = join(getSessionDir(sessionId), "state.json");
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function loadLog(sessionId: string): LogEntry[] {
  const path = join(getSessionDir(sessionId), "log.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function appendLog(sessionId: string, entry: LogEntry): void {
  const log = loadLog(sessionId);
  log.push(entry);
  const path = join(getSessionDir(sessionId), "log.json");
  writeFileSync(path, JSON.stringify(log));
}

export function removeSession(sessionId: string): void {
  const dir = getSessionDir(sessionId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function isSessionExpired(meta: SessionMeta): boolean {
  return Date.now() - meta.createdAt > SESSION_TTL_MS;
}

export function checkSessionValid(sessionId: string): SessionMeta {
  const dir = getSessionDir(sessionId);
  if (!existsSync(dir)) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const meta = loadMeta(sessionId);
  if (isSessionExpired(meta)) {
    throw new Error(`Session ${sessionId} expired (TTL: 15 minutes)`);
  }
  return meta;
}

export interface SessionInfo {
  id: string;
  scriptName: string;
  createdAt: number;
  expired: boolean;
}

export function listSessions(): SessionInfo[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(dir, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;

    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      sessions.push({
        id: entry.name,
        scriptName: meta.scriptName,
        createdAt: meta.createdAt,
        expired: isSessionExpired(meta),
      });
    } catch {
      // Skip corrupt sessions
    }
  }

  return sessions;
}

export function cleanExpiredSessions(): number {
  const sessions = listSessions();
  let cleaned = 0;
  for (const s of sessions) {
    if (s.expired) {
      removeSession(s.id);
      cleaned++;
    }
  }
  return cleaned;
}
