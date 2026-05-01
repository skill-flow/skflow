import { execSh } from "./sh.js";
import {
  createSession,
  loadState,
  saveState,
  loadMeta,
  saveMeta,
  loadLog,
  appendLog,
  removeSession,
  checkSessionValid,
} from "./session.js";
import type {
  StepFunction,
  StepResult,
  InternalShYield,
  ExternalYield,
  DoneReturn,
  YieldMessage,
  DoneMessage,
  ErrorMessage,
  LogEntry,
  SessionState,
  SourceMapEntry,
} from "./protocol.js";

function isShYield(r: StepResult): r is InternalShYield {
  return "_sh" in r;
}

function isExternalYield(r: StepResult): r is ExternalYield {
  return "yield" in r;
}

function isDone(r: StepResult): r is DoneReturn {
  return "done" in r;
}

/** Detect if a thrown value is an unhandled sh error (thrown by sh-throws mechanism) */
function isShError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    "stderr" in err &&
    "cmd" in err &&
    typeof (err as any).code === "number"
  );
}

export interface RunOptions {
  scriptName: string;
  scriptPath: string;
  step: StepFunction;
  sourceMap?: SourceMapEntry[];
}

/** Start a new script execution. Returns the JSON output to write to stdout. */
export function run(opts: RunOptions): YieldMessage | DoneMessage {
  const sessionId = createSession(opts.scriptName, opts.scriptPath);
  const state = loadState(sessionId);

  return executeLoop(sessionId, state, opts.step, undefined, opts.sourceMap);
}

export interface ResumeOptions {
  sessionId: string;
  answer: string;
  step: StepFunction;
  sourceMap?: SourceMapEntry[];
}

/** Resume a paused session with an answer. */
export function resume(opts: ResumeOptions): YieldMessage | DoneMessage {
  const meta = checkSessionValid(opts.sessionId);

  // Handle sh-error recovery resume
  if (meta.pendingShError) {
    // Execute the new command provided by the LLM
    const newResult = execSh(opts.answer, {
      timeout: meta.pendingShError.timeout,
    });
    const logEntry: LogEntry = {
      type: "sh",
      cmd: opts.answer,
      code: newResult.code,
      stdout: newResult.stdout,
      stderr: newResult.stderr,
    };
    appendLog(opts.sessionId, logEntry);

    // Clear pending error
    delete meta.pendingShError;
    saveMeta(opts.sessionId, meta);

    // Feed new result to the same phase
    const state = loadState(opts.sessionId);
    return executeLoop(opts.sessionId, state, opts.step, JSON.stringify(newResult), opts.sourceMap);
  }

  // Normal resume
  const state = loadState(opts.sessionId);
  return executeLoop(opts.sessionId, state, opts.step, opts.answer, opts.sourceMap);
}

function executeLoop(
  sessionId: string,
  state: SessionState,
  step: StepFunction,
  input: string | undefined,
  sourceMap?: SourceMapEntry[],
): YieldMessage | DoneMessage {
  let currentState = state;
  let currentInput = input;

  while (true) {
    let result: StepResult;
    try {
      result = step(currentState, currentInput);
    } catch (err: any) {
      // Check if this is an unhandled sh error that we can yield for recovery
      if (isShError(err)) {
        return yieldShError(sessionId, currentState, err, sourceMap);
      }

      const errorMsg: ErrorMessage = {
        error: {
          message: err.message ?? String(err),
          phase: currentState.phase,
          trace: err.stack,
        },
      };
      // Output error and clean up
      removeSession(sessionId);
      throw new RuntimeError(errorMsg);
    }

    if (isShYield(result)) {
      // Auto-resume: execute sh, log, advance phase
      saveState(sessionId, result.next);
      const shResult = execSh(result._sh.cmd, {
        stdin: result._sh.stdin,
        timeout: result._sh.timeout,
      });
      const logEntry: LogEntry = {
        type: "sh",
        cmd: result._sh.cmd,
        code: shResult.code,
        stdout: shResult.stdout,
        stderr: shResult.stderr,
      };
      appendLog(sessionId, logEntry);

      currentState = result.next;
      currentInput = JSON.stringify(shResult);
      continue;
    }

    if (isExternalYield(result)) {
      // Save state and return yield message
      saveState(sessionId, result.next);
      const log = loadLog(sessionId);

      const msg: YieldMessage = {
        yield: result.yield,
        log,
        session: sessionId,
        resume: `skflow resume ${sessionId}`,
      };
      return msg;
    }

    if (isDone(result)) {
      const log = loadLog(sessionId);
      removeSession(sessionId);

      const msg: DoneMessage = {
        done: result.done,
        log,
      };
      return msg;
    }

    // Should never reach here
    throw new Error(`Unexpected step result: ${JSON.stringify(result)}`);
  }
}

/** Yield an sh-error back to the LLM for recovery */
function yieldShError(
  sessionId: string,
  currentState: SessionState,
  err: any,
  sourceMap?: SourceMapEntry[],
): YieldMessage {
  // Save state (already saved by sh auto-resume before step was called)
  // Save pending error info to meta
  const meta = loadMeta(sessionId);
  meta.pendingShError = {
    cmd: err.cmd,
    result: { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code },
    timeout: err.timeout,
  };
  saveMeta(sessionId, meta);

  // Look up source map for context
  const context = lookupSourceMap(currentState.phase, sourceMap);

  const log = loadLog(sessionId);
  const msg: YieldMessage = {
    yield: {
      type: "sh-error",
      cmd: err.cmd,
      result: { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code },
      context,
    },
    log,
    session: sessionId,
    resume: `skflow resume ${sessionId}`,
  };
  return msg;
}

function lookupSourceMap(
  phase: number,
  sourceMap?: SourceMapEntry[],
): { line: number | null; source: string | null } {
  if (!sourceMap) return { line: null, source: null };
  // Look for the sh-resume entry for this phase (that's where throw happens)
  const entry = sourceMap.find(([p]) => p === phase);
  if (entry) {
    return { line: entry[1], source: entry[2] };
  }
  return { line: null, source: null };
}

export class RuntimeError extends Error {
  public readonly errorMessage: ErrorMessage;

  constructor(errorMessage: ErrorMessage) {
    super(errorMessage.error.message);
    this.name = "RuntimeError";
    this.errorMessage = errorMessage;
  }
}
