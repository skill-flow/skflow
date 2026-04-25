import { execSh } from "./sh.js";
import {
  createSession,
  loadState,
  saveState,
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

export interface RunOptions {
  scriptName: string;
  scriptPath: string;
  step: StepFunction;
}

/** Start a new script execution. Returns the JSON output to write to stdout. */
export function run(opts: RunOptions): YieldMessage | DoneMessage {
  const sessionId = createSession(opts.scriptName, opts.scriptPath);
  const state = loadState(sessionId);

  return executeLoop(sessionId, state, opts.step, undefined);
}

export interface ResumeOptions {
  sessionId: string;
  answer: string;
  step: StepFunction;
}

/** Resume a paused session with an answer. */
export function resume(opts: ResumeOptions): YieldMessage | DoneMessage {
  checkSessionValid(opts.sessionId);
  const state = loadState(opts.sessionId);

  return executeLoop(opts.sessionId, state, opts.step, opts.answer);
}

function executeLoop(
  sessionId: string,
  state: SessionState,
  step: StepFunction,
  input: string | undefined,
): YieldMessage | DoneMessage {
  let currentState = state;
  let currentInput = input;

  while (true) {
    let result: StepResult;
    try {
      result = step(currentState, currentInput);
    } catch (err: any) {
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
      const shResult = execSh(result._sh.cmd, result._sh.timeout);
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
        resume: `cmdx resume ${sessionId}`,
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

export class RuntimeError extends Error {
  public readonly errorMessage: ErrorMessage;

  constructor(errorMessage: ErrorMessage) {
    super(errorMessage.error.message);
    this.name = "RuntimeError";
    this.errorMessage = errorMessage;
  }
}
