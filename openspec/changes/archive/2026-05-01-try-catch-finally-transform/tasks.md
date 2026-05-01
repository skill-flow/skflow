## 1. Foundation — Remove MVP restriction & add pragma detection

- [ ] 1.1 Remove `findTryCatchAcrossYield()` from `detect.ts` and its call in `transform.ts`
- [ ] 1.2 Add `detectShThrowsPragma(sourceFile): boolean` to `detect.ts` — scans top-level comments for `// @skflow sh-throws`
- [ ] 1.3 Add `isThrowingSh(callExpr, opts, pragma): boolean` helper to `detect.ts` — determines if a given sh() call should throw based on options arg and pragma flag
- [ ] 1.4 Update `transform.ts` to pass pragma flag through to `explodeBody()`

## 2. Variable hoisting — Support try/catch/finally blocks

- [ ] 2.1 Add `TryStatement` handling in `hoist.ts` `visitStatement()` — recurse into try block, catch clause body, and finally block to hoist variables

## 3. Core emit — explodeTry implementation

- [ ] 3.1 Add `TryEntry` tracking interface to `emit.ts`: `{ tryStart, tryEnd, catchStart, catchEnd, finallyStart, finallyEnd, afterPhase }`
- [ ] 3.2 Add module-level `tryEntries: TryEntry[]` array (reset in `explodeBody()`)
- [ ] 3.3 Implement `explodeTry(stmt, sourceFile, line)` — allocate phases for try body, catch body, finally body; emit `_completion` assignments at block exits
- [ ] 3.4 Wire `explodeTry` into `explodeStatement()` for `ts.isTryStatement(stmt) && containsYield(stmt)`
- [ ] 3.5 Handle try-only-catch (no finally): try phases → jump to after on success, catch phases → jump to after
- [ ] 3.6 Handle try-only-finally (no catch): try phases → set `_completion=normal` → goto finally, finally end replays completion
- [ ] 3.7 Handle try-catch-finally: try → catch/finally routing, catch → finally routing, finally → replay

## 4. Core emit — sh throws at resume point

- [ ] 4.1 Modify `explodeYieldExpression()` to accept pragma flag and detect `throws` option on sh() calls
- [ ] 4.2 At the sh resume phase, emit conditional throw: `if (state.x.code !== 0) { state.x.cmd = <cmd>; throw state.x; }`
- [ ] 4.3 For `throws: false` (explicit opt-out), skip the throw check even with pragma

## 5. Core emit — generateStepFunction with error dispatch

- [ ] 5.1 Modify `generateStepFunction()` to emit `const _tries = [...]` when `tryEntries.length > 0`
- [ ] 5.2 Change while loop to labeled: `_loop: while (true) { ... }`
- [ ] 5.3 Wrap switch statement in `try { switch(...) } catch (e) { ... dispatch ... }`
- [ ] 5.4 Implement catch dispatch logic: iterate `_tries` in reverse, match `state.phase` to ranges, set `state._error = e` and jump to catch/finally phase with `continue _loop`
- [ ] 5.5 When no `tryEntries`, generate the same output as today (no wrapper, no label) for backward compatibility

## 6. Core emit — finally completion replay

- [ ] 6.1 At end of finally phases, emit completion replay code: check `state._completion.type` and execute return/throw/break/continue/normal
- [ ] 6.2 For `break`/`continue` completion, emit jump to the stored phase number (`state._completion.value`)
- [ ] 6.3 For `return done()` inside try or catch when finally exists, emit `state._completion = { type: "return", value: <done-expr> }; state.phase = finallyStart; continue`

## 7. Loop integration — break/continue through finally

- [ ] 7.1 In `explodeWhile` and `explodeFor`, when a `break`/`continue` is inside a try block with finally, emit `_completion = { type: "break"|"continue", value: targetPhase }` and jump to finally instead of directly jumping
- [ ] 7.2 Track active try-finally context during explosion so break/continue know whether to go through finally

## 8. Tests — try-catch with yields

- [ ] 8.1 Test: catch sh failure with `throws: true` (success path + failure path)
- [ ] 8.2 Test: catch JS runtime error inside try
- [ ] 8.3 Test: resume normal flow after catch (yield after try/catch)
- [ ] 8.4 Test: propagate error when no catch (throws to runner)
- [ ] 8.5 Test: yield inside catch block (`await ask()` in catch)
- [ ] 8.6 Test: multiple yields in try before failure

## 9. Tests — try-finally with yields

- [ ] 9.1 Test: finally after normal try completion
- [ ] 9.2 Test: finally after error in try (no catch) — re-throws after finally
- [ ] 9.3 Test: return done() inside try passes through finally
- [ ] 9.4 Test: finally overrides return value

## 10. Tests — try-catch-finally combined

- [ ] 10.1 Test: error flows catch → finally → after
- [ ] 10.2 Test: success flows try → finally (catch skipped)
- [ ] 10.3 Test: re-throw from catch passes through finally
- [ ] 10.4 Test: yield in all three blocks (try, catch, finally)

## 11. Tests — nested & loops

- [ ] 11.1 Test: inner catch handles, outer continues
- [ ] 11.2 Test: inner uncaught propagates through inner finally to outer catch
- [ ] 11.3 Test: retry loop with try-catch (while + try/catch + break)
- [ ] 11.4 Test: break inside try passes through finally before exiting loop

## 12. Tests — sh-throws pragma

- [ ] 12.1 Test: with pragma, all sh() throw on non-zero by default
- [ ] 12.2 Test: with pragma, `throws: false` opts out per call
- [ ] 12.3 Test: without pragma, sh does not throw by default

## 13. Runtime protocol update

- [ ] 13.1 Add `_error?: unknown` and `_completion?: { type: string; value?: unknown }` to `SessionState` in `protocol.ts`
