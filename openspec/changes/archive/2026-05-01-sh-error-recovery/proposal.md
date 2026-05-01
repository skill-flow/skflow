# sh-error-recovery

## Problem

When `sh()` fails (non-zero exit code) and the script has no try/catch covering it, the runtime crashes with a `RuntimeError`. The error message sent to the LLM contains only a phase number and a JS stack trace pointing to compiled code — meaningless for diagnosis.

The LLM cannot:

1. Understand which original source line failed
2. See the failing command and its stderr in context
3. Attempt a different command to recover

## Solution

Turn unhandled `sh()` errors from fatal crashes into **yield points**. When a shell command fails and the error escapes the compiled `step()` function (no try/catch handles it), the runtime yields a `sh-error` message back to the LLM with full context. The LLM can then either resume with a replacement command or abort the session.

Additionally, embed a **source map** in the compiled output so error messages can reference the original script line and source code.

## Design

### New yield type: `sh-error`

```json
{
  "yield": {
    "type": "sh-error",
    "cmd": "git push origin main",
    "result": { "stdout": "", "stderr": "rejected: non-fast-forward", "code": 1 },
    "context": {
      "line": 5,
      "source": "const r = await sh(\"git push origin main\")"
    }
  },
  "log": [...],
  "session": "<session-id>",
  "resume": "skflow resume <session-id>"
}
```

### Resume protocol

- **Retry**: answer is the new shell command to execute (a plain string)
- **Give up**: LLM simply does not resume (session expires via TTL)

On retry, the runtime executes the new command and feeds its result to the same phase. If the new command also fails, it yields `sh-error` again (natural loop — LLM decides when to stop resuming).

### Source map

The transform emits a `__sourceMap` export in the compiled JS:

```javascript
export const __sourceMap = [
  [0, 4, 'const x = await sh("git diff")', "sh"],
  [1, 4, null, "sh-resume"],
  [2, 5, 'const r = await sh("git push origin main")', "sh"],
  [3, 5, null, "sh-resume"],
];
// Format: [phase, originalLine, originalSourceOrNull, type]
```

## Scope

### In scope

- Runtime: catch unhandled sh errors, yield `sh-error`, support retry/abort resume
- Transform: emit `__sourceMap` alongside `step` function
- CLI: load `__sourceMap` when importing compiled script, pass to runtime
- Protocol: new `ShErrorYield` type definition

### Out of scope

- Modifying state from the LLM on resume (only command replacement)
- "skip" semantics (either retry or abort)
- Retry count limits (LLM decides)
- Source mapping for non-sh errors (general runtime errors stay as-is for now)

## Key insight

The compiled state machine doesn't need to change. Retry works because phase N+1 (the "resume after sh()" phase) simply does `state.x = JSON.parse(input)` then checks `code !== 0`. Feeding it a successful result from a different command makes it continue normally. The retry logic is purely a runtime concern.

## Files affected

- `packages/runtime/src/runner.ts` — error recovery logic in executeLoop
- `packages/runtime/src/protocol.ts` — new types
- `packages/transform/src/emit.ts` — emit `__sourceMap`
- `packages/transform/src/transform.ts` — include sourceMap in TransformResult
- `packages/cli/src/commands/run.ts` — load and pass sourceMap
- `packages/cli/src/commands/resume.ts` — handle abort answer
