## Why

The transform currently rejects any `try/catch/finally` that spans a yield point (`await sh/ask/askUser`), limiting scripts to happy-path-only flows. Real-world automation needs error handling — retry on shell failure, cleanup resources in finally, catch and recover from command errors. This is the most-requested missing language feature.

## What Changes

- Remove the MVP restriction that rejects try/catch across yield points
- Add `explodeTry()` to the state machine emitter, splitting try/catch/finally into phases with a `_tries[]` dispatch table and `_completion` record for finally replay
- Wrap the generated switch statement in a try/catch that routes JS runtime errors to the correct catch/finally phase
- Add `{ throws: true }` option to `sh()` calls — when the shell command exits non-zero, throw the result object as an error routable to catch
- Add `// @skflow sh-throws` pragma for script-level default throw behavior
- Support yields (`await sh/ask/askUser`) inside try body, catch body, and finally body
- Error object for sh failures: `{ code, stdout, stderr, cmd }`

## Capabilities

### New Capabilities

- `try-catch-transform`: State machine explosion of try/catch/finally blocks containing yield points, including nested try, try-in-loops, and finally completion replay
- `sh-throws`: Shell command error throwing via per-call `{ throws: true }` option and script-level `// @skflow sh-throws` pragma

### Modified Capabilities

- `transform`: Remove "Unsupported syntax detection" scenario for try/catch across yield (it's now supported). Add try/catch/finally to the control flow explosion requirement.

## Impact

- `packages/transform/src/emit.ts` — Major: new `explodeTry()`, modify `generateStepFunction()` to wrap switch in try/catch with `_tries[]` dispatch
- `packages/transform/src/detect.ts` — Remove `findTryCatchAcrossYield()`, add pragma detection
- `packages/transform/src/hoist.ts` — Recurse into try/catch/finally blocks for variable hoisting
- `packages/transform/src/transform.ts` — Remove MVP error check, pass pragma flag
- `packages/runtime/src/protocol.ts` — Add `_error?`, `_completion?` to SessionState type
- `packages/transform/src/transform.test.ts` — 24 new test cases
- No breaking changes to existing scripts (old behavior preserved without pragma)
