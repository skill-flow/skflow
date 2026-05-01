## Context

The `@skflow/transform` package compiles TypeScript async functions into deterministic state machines (a `step(state, input)` function with a `while(true) switch(state.phase)` dispatch loop). Currently it handles sequential yields, if/else, while, and for loops — but explicitly rejects try/catch/finally that spans yield points.

Facebook's regenerator solves the same problem for generators using a `tryEntries` array (static metadata) + runtime dispatch (`dispatchException`, `context.catch`, `context.finish`). Our system is simpler: no generator protocol, yields are just `return` from `step()`, and the runner calls `step()` again with input. This means we can handle error routing entirely inside the generated `step()` function without runtime changes.

## Goals / Non-Goals

**Goals:**

- Support try/catch/finally with yields in any combination (try body, catch body, finally body)
- Route shell failures (`code !== 0`) to catch when `throws: true` is specified
- Route JS runtime errors to catch via a wrapping try/catch around the switch
- Implement `_completion` record for finally semantics (replay return/throw/break after finally)
- Backward compatible: existing scripts without `throws` option or pragma work unchanged
- Support nested try/catch and try-in-loops with correct scoping

**Non-Goals:**

- Generator protocol (`.throw()`, `.return()`) — not part of skflow's model
- Async iteration / `for await...of` — separate future feature
- `do...while`, `for...of`, `for...in`, `switch` statement explosion — separate changes
- Modifying the runner or yield protocol — all changes are compile-time

## Decisions

### Decision 1: Error dispatch via wrapping try/catch + static `_tries[]` table

**Choice:** Generate a labeled `while` loop with the switch wrapped in `try { switch(...) } catch(e) { dispatch(e) }`. A static `_tries` array maps phase ranges to catch/finally phases.

**Alternatives considered:**

- _Per-case try/catch_: Wrap individual cases in try/catch. Rejected: verbose output, doesn't handle errors spanning multiple phases.
- _Runtime dispatch (like regenerator)_: Move error routing to the runner. Rejected: violates separation — runner shouldn't know about try/catch semantics; increases coupling.

**Rationale:** Single wrapping try/catch is clean, handles all phase transitions uniformly, and the `_tries` table is easy to reason about. The labeled while loop (`_loop: while(true)`) enables `continue _loop` from the catch block.

### Decision 2: Shell errors as throw at resume point

**Choice:** At the resume point after `sh()` (where `input` is parsed), generate:

```javascript
state.x = JSON.parse(input);
if (state.x.code !== 0) throw state.x;
```

This converts the data-level failure into a JS exception, which the wrapping try/catch then dispatches to the correct catch phase.

**Alternatives considered:**

- _Runner detects and routes_: Runner checks exit code and calls step with special error input. Rejected: requires protocol changes, tighter coupling.
- _Separate error channel_: Add `state._shError` field. Rejected: adds complexity without benefit since throw+catch is natural.

**Rationale:** Treating shell failure as a throw unifies both error sources (JS errors and shell failures) into one dispatch mechanism. The error object `{code, stdout, stderr, cmd}` is rich enough for catch blocks to inspect.

### Decision 3: `_completion` record for finally replay

**Choice:** Before entering a finally block, store the pending action:

```javascript
state._completion = { type: "normal" | "return" | "throw" | "break" | "continue", value?: any }
```

At the end of finally, generated code checks `_completion` and replays it:

- `normal` → continue to afterPhase
- `return` → return the stored value
- `throw` → re-throw the stored value
- `break`/`continue` → jump to loop target

**Alternatives considered:**

- _No finally support_: Only support try/catch. Rejected: user explicitly requested full support.
- _Inline finally (duplicate code)_: Copy finally body to each exit path. Rejected: yields in finally require a single phase sequence, not duplication.

**Rationale:** Matches regenerator's proven model. The `_completion` record is the minimal state needed to "pause" a pending control transfer, execute finally, then resume.

### Decision 4: `_tries[]` entry structure

**Choice:** Each entry is a tuple: `[tryStart, tryEnd, catchStart, catchEnd, finallyStart, finallyEnd, afterPhase]`. Null values for missing catch/finally.

Search order: reverse (inner-to-outer). Match logic:

- Phase in `[tryStart, tryEnd]` → route to catch (or finally if no catch)
- Phase in `[catchStart, catchEnd]` → route to finally (or propagate if no finally)
- Phase in `[finallyStart, finallyEnd]` → propagate (errors in finally always propagate)

### Decision 5: `// @skflow sh-throws` pragma

**Choice:** A comment pragma at the top of the source file. The transform scans for it during parsing and sets a boolean flag that affects code generation at every `sh()` resume point.

- With pragma: all `sh()` emit throw-on-nonzero unless `{ throws: false }` is specified
- Without pragma: no `sh()` throws unless `{ throws: true }` is specified

**Rationale:** Pragma allows new scripts to get safe-by-default behavior while old scripts remain unchanged. Per-call override enables both opt-in and opt-out granularity.

### Decision 6: Error object shape

**Choice:** The thrown object is the raw sh result with `cmd` added: `{ code, stdout, stderr, cmd }`. Not an Error instance.

**Rationale:** Plain objects serialize cleanly, carry all diagnostic info, and avoid the overhead of stack traces for expected operational failures. Catch blocks access fields directly (`e.stderr`, `e.code`).

## Risks / Trade-offs

- **[Generated code size]** → The `_tries` table and outer catch block add ~15 lines of boilerplate. Acceptable for correctness. Only emitted when try/catch is actually used.
- **[Performance of outer try/catch]** → V8 optimizes try/catch well in modern versions. Since step() runs synchronously between yields, the overhead is negligible.
- **[break/continue through finally in loops]** → Requires tracking loop context during explosion (which loop's afterPhase/testPhase to target). Mitigated by using phase numbers directly in `_completion.value`.
- **[Nested try/catch phase range overlap]** → Inner try ranges are subsets of outer try ranges. Reverse search order ensures inner match first. Correctness depends on entries being ordered inner-to-outer.
- **[cmd field on error object]** → Requires passing the command string through the resume cycle. The command is already available in the `_sh.cmd` field of the yield return, but after resume we only have `input` (the JSON result). Solution: store `state._lastCmd` before yielding sh, or include `cmd` in the runner's response. Preferred: runner already has the cmd, include it in the JSON response to step.
