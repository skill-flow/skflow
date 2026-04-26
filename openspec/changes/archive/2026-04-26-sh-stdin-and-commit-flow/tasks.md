## 1. Protocol & Types

- [x] 1.1 Update `InternalShYield._sh` in `packages/runtime/src/protocol.ts` to add optional `stdin?: string` and `timeout?: number` fields
- [x] 1.2 Update `sh()` placeholder signature in `packages/runtime/src/sh.ts` to accept optional second argument `opts?: { stdin?: string; timeout?: number }`

## 2. Runtime Implementation

- [x] 2.1 Update `execSh` in `packages/runtime/src/sh.ts` to accept and pipe `stdin` via `execSync`'s `input` option, and accept `timeout` parameter
- [x] 2.2 Update `executeLoop` in `packages/runtime/src/runner.ts` to pass `_sh.stdin` and `_sh.timeout` from the yield object to `execSh`
- [x] 2.3 Add unit tests for `execSh` with stdin (pipe content, empty stdin, stdin with failing command)

## 3. Transform Implementation

- [x] 3.1 Update `makeShYield` in `packages/transform/src/emit.ts` to spread the second argument's properties (`stdin`, `timeout`) into the `_sh` object when present
- [x] 3.2 Update `explodeYieldExpression` in `packages/transform/src/emit.ts` to pass the second argument of `sh()` calls through to `makeShYield`
- [x] 3.3 Add transform tests: `sh("cmd", { stdin: expr })` compiles to `{ _sh: { cmd, stdin: expr } }`, `sh("cmd", { timeout: N })`, and `sh("cmd")` still works unchanged

## 4. Commit Example Rewrite

- [x] 4.1 Rewrite `examples/commit.ts`: gather diff → single `ask()` for title+description → `sh("git commit -F -", { stdin: message })` → infinite loop on failure with `ask()` yielding stderr to caller
- [x] 4.2 Update `examples/commit.test.ts`: test happy path (diff → ask → commit succeeds → done), no-staged-files path, and pre-commit failure path (commit fails → ask yield with stderr → resume → re-commit)

## 5. Validation

- [x] 5.1 Run full test suite (`npm test`) and verify all existing + new tests pass
- [x] 5.2 Run `npm run build` and verify no type errors
