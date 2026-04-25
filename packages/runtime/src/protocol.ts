// ── Shell execution ──

export interface ShResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface LogEntry {
  type: "sh";
  cmd: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface YieldPayload {
  type: "text" | "choice" | "ask-user";
  prompt: string;
  data?: unknown;
  options?: string[];
}

export interface YieldMessage {
  yield: YieldPayload;
  log: LogEntry[];
  session: string;
  resume: string;
}

export interface DoneResult {
  summary: string;
  data?: unknown;
}

export interface DoneMessage {
  done: DoneResult;
  log: LogEntry[];
}

export interface ErrorMessage {
  error: {
    message: string;
    phase: number;
    trace?: string;
  };
}

export interface SessionState {
  phase: number;
  [key: string]: unknown;
}

export interface SessionMeta {
  scriptName: string;
  scriptPath: string;
  createdAt: number;
}

// ── Compiled script interface ──

/** Internal yield from sh() — runtime auto-resumes these */
export interface InternalShYield {
  _sh: { cmd: string; timeout?: number };
  next: SessionState;
}

/** External yield from ask()/askUser() — process exits, CC resumes */
export interface ExternalYield {
  yield: YieldPayload;
  next: SessionState;
}

/** Terminal result from done() */
export interface DoneReturn {
  done: DoneResult;
}

/** The return type of a compiled step function */
export type StepResult = InternalShYield | ExternalYield | DoneReturn;

/** Signature of the compiled step(state, input) function */
export type StepFunction = (state: SessionState, input?: string) => StepResult;
