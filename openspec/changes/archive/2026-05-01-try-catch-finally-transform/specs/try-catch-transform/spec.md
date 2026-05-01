## ADDED Requirements

### Requirement: Try-catch explosion across yield points (try-catch-yield)

The transformer SHALL explode `try/catch/finally` statements containing yield points (`await sh/ask/askUser`) into state machine phases, routing errors to the correct catch or finally phase.

#### Scenario: Catch receives sh failure as error object

- **WHEN** source contains `try { const r = await sh("cmd", { throws: true }); } catch (e) { ... }`
- **THEN** compiled output: at the sh resume point, if `code !== 0`, throws the result object; the outer catch dispatches to the catch phase where `state._error` holds `{ code, stdout, stderr, cmd }`

#### Scenario: Catch receives JS runtime error

- **WHEN** source contains `try { x.foo.bar; } catch (e) { ... }` where x is undefined
- **THEN** compiled output: the wrapping try/catch around the switch catches the TypeError and dispatches to the catch phase with `state._error` set to the error

#### Scenario: Normal try completion skips catch

- **WHEN** source contains `try { const r = await sh("ok", { throws: true }); } catch (e) { ... }` and sh returns code 0
- **THEN** execution skips the catch phase and continues to after-phase

#### Scenario: Yield inside catch block

- **WHEN** source contains `catch (e) { const fix = await ask({ prompt: "fix?" }); }`
- **THEN** compiled output has the ask yield as a separate phase within the catch range, resumable after external input

#### Scenario: Multiple yields in try body

- **WHEN** source contains two `await sh()` calls inside a try block, and the second fails
- **THEN** the first completes normally, the second's failure routes to catch, and state from the first yield is preserved

#### Scenario: No catch — error propagates to runner

- **WHEN** source contains `await sh("fail", { throws: true })` with no enclosing try/catch
- **THEN** the throw propagates out of `step()` and the runner handles it as today (terminates session with error)

### Requirement: Try-finally with completion replay (try-finally-yield)

The transformer SHALL support `finally` blocks that execute regardless of how control leaves the try (or catch) block, including when yields occur inside finally.

#### Scenario: Finally runs after normal try completion

- **WHEN** source contains `try { await sh("work"); } finally { await sh("cleanup"); }` and sh succeeds
- **THEN** execution flows: try body → finally body → after-phase

#### Scenario: Finally runs after error (no catch)

- **WHEN** source contains `try { await sh("fail", { throws: true }); } finally { await sh("cleanup"); }` and sh fails
- **THEN** execution flows: try body throws → finally body runs → re-throws original error

#### Scenario: Return done() passes through finally

- **WHEN** source contains `try { return done({...}); } finally { await sh("cleanup"); }`
- **THEN** execution stores `_completion = { type: "return", value: {done:{...}} }`, runs finally, then replays the return

#### Scenario: Finally can override return value

- **WHEN** source contains `try { return done({ x: 1 }); } finally { return done({ x: 2 }); }`
- **THEN** finally's return overrides try's return; step returns `{ done: { x: 2 } }`

#### Scenario: Yield inside finally block

- **WHEN** source contains `finally { const c = await sh("cleanup"); }`
- **THEN** compiled output has the sh yield as a phase within the finally range; after resume, finally completion replay executes

#### Scenario: Re-throw after finally when no catch

- **WHEN** try throws, no catch exists, finally completes normally
- **THEN** after finally, the stored error (`_completion.type === "throw"`) is re-thrown

### Requirement: Try-catch-finally combined (try-catch-finally-yield)

The transformer SHALL support the full `try { } catch (e) { } finally { }` form with yields in any block.

#### Scenario: Error flows through catch then finally

- **WHEN** source has try/catch/finally, try throws
- **THEN** execution: try throws → catch runs → finally runs → after-phase

#### Scenario: Success flows through finally (catch skipped)

- **WHEN** source has try/catch/finally, try succeeds
- **THEN** execution: try completes → catch skipped → finally runs → after-phase

#### Scenario: Re-throw from catch passes through finally

- **WHEN** catch block contains `throw e` (re-throw) and finally exists
- **THEN** execution: catch throws → `_completion = {type:"throw", value:e}` → finally runs → re-throws

#### Scenario: Yield in all three blocks

- **WHEN** source has `await sh()` in try, `await ask()` in catch, `await sh()` in finally
- **THEN** compiled output has separate phase ranges for each block, all resumable

### Requirement: Nested try-catch (nested-try)

The transformer SHALL support nested try/catch/finally with correct inner-to-outer error propagation.

#### Scenario: Inner catch handles, outer continues

- **WHEN** inner try/catch catches an error and outer try body continues
- **THEN** after inner catch, execution resumes in the outer try body normally

#### Scenario: Inner uncaught propagates through inner finally to outer catch

- **WHEN** inner try has no catch (only finally), error occurs
- **THEN** inner finally runs, then error propagates to outer catch

#### Scenario: Error in catch propagates to outer

- **WHEN** inner catch block throws, outer try/catch exists
- **THEN** inner catch's error propagates to outer catch

### Requirement: Try-catch in loops (try-loop)

The transformer SHALL correctly handle try/catch/finally inside loops, including break/continue passing through finally.

#### Scenario: Retry loop with try-catch

- **WHEN** source contains `while (attempts < 3) { try { await sh("cmd", {throws:true}); break; } catch(e) { attempts++; } }`
- **THEN** on failure, catch increments and loops back; on success, breaks out

#### Scenario: Break inside try passes through finally

- **WHEN** source contains `while(true) { try { break; } finally { await sh("cleanup"); } }`
- **THEN** `_completion = {type:"break"}` stored, finally runs, then loop exits

#### Scenario: Continue inside try passes through finally

- **WHEN** source contains `while(cond) { try { continue; } finally { await sh("log"); } }`
- **THEN** `_completion = {type:"continue"}` stored, finally runs, then loop continues

### Requirement: Static tries dispatch table (\_tries)

The transformer SHALL emit a `const _tries = [...]` array and a labeled while loop (`_loop: while(true)`) with catch-dispatch logic when any try/catch/finally with yields exists in the source.

#### Scenario: Single try-catch emits one entry

- **WHEN** source has one try/catch with yields
- **THEN** generated code includes `const _tries = [[tryStart, tryEnd, catchStart, catchEnd, null, null, afterPhase]]`

#### Scenario: Nested try emits multiple entries (inner last)

- **WHEN** source has nested try/catch
- **THEN** `_tries` array has outer entry first, inner entry last (reverse search finds inner first)

#### Scenario: No try/catch in source — no \_tries emitted

- **WHEN** source has no try/catch/finally containing yields
- **THEN** generated code does NOT include `_tries` or the outer try/catch wrapper (backward compatible output)
