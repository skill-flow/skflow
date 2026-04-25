## 1. Project Scaffold

- [x] 1.1 Init npm monorepo (root `package.json` with workspaces: `packages/*`), add TypeScript config
- [x] 1.2 Create `packages/cli` scaffold (`package.json` with `bin: { cmdx }`, `tsconfig.json`, `src/index.ts` entry)
- [x] 1.3 Create `packages/runtime` scaffold (`package.json`, `tsconfig.json`, `src/index.ts` exporting `sh`, `ask`, `askUser`, `done`)
- [x] 1.4 Create `packages/transform` scaffold (`package.json`, `tsconfig.json`, `src/index.ts`)
- [x] 1.5 Configure vitest at root level for all packages

## 2. Yield Protocol & Session

- [x] 2.1 Define TypeScript types for yield/done/error messages (`packages/runtime/src/protocol.ts`)
- [x] 2.2 Implement session manager: create session dir in `os.tmpdir()`, read/write `state.json`, `meta.json`, `log.json`
- [x] 2.3 Implement session TTL check (15 min) and expiration error
- [x] 2.4 Implement `cmdx sessions ls` and `cmdx sessions clean` subcommands
- [x] 2.5 **Test**: session creation, state persistence, TTL expiry, clean command

## 3. Runtime

- [x] 3.1 Implement `sh(cmd)`: execute child process, capture stdout/stderr/code, append to session log, return result
- [x] 3.2 Implement `ask(opts)`: serialize state, build yield JSON (type text/choice), output to stdout, exit process
- [x] 3.3 Implement `askUser(opts)`: same as ask but with `type: "ask-user"`
- [x] 3.4 Implement `done(result)`: build done JSON, include log, output to stdout, cleanup session, exit
- [x] 3.5 Implement runtime loop: load compiled script, execute `step(state, input)`, auto-resume `sh()` yields, pause on `ask()`/`askUser()`
- [x] 3.6 **Test**: sh() success/failure/timeout, ask() output format, askUser() output format, done() output and cleanup, runtime loop with mixed sh/ask sequence

## 4. Transform — Hoist

- [x] 4.1 Implement variable hoisting: traverse function body, collect all `const`/`let`/`var` declarations, replace with `state.X` assignments
- [x] 4.2 **Test**: simple vars, multiple vars, vars in nested blocks, function params not hoisted

## 5. Transform — Explode & Emit

- [x] 5.1 Implement yield point detection: identify `await sh()`, `await ask()`, `await askUser()` calls in the AST
- [x] 5.2 Implement sequential explode: split linear code at yield points into consecutive cases
- [x] 5.3 Implement if/else explode: conditional jumps with yield points in branches
- [x] 5.4 Implement while loop explode: loop test → body with yields → back-jump to test
- [x] 5.5 Implement for loop explode: init → test → body → update → back-jump
- [x] 5.6 Implement state machine emit: generate `step(state, input)` with `while(1) switch(state.phase)` dispatch loop
- [x] 5.7 Implement unsupported syntax detection: try/catch across yield, yield in nested functions
- [x] 5.8 Add source line comments in emitted cases (`/* L12 */`)
- [x] 5.9 **Test fixture — sequential**: `sh → sh → ask → sh → done` (no control flow)
- [x] 5.10 **Test fixture — if/else**: yield in one branch, done in other
- [x] 5.11 **Test fixture — while + yield**: retry loop with ask inside (mirrors commit.ts pattern)
- [x] 5.12 **Test fixture — nested if in while**: both branches yield inside a loop
- [x] 5.13 **Test fixture — for loop**: sh inside a for loop
- [x] 5.14 **Test fixture — no yields**: pure sh script, compiles to single case
- [x] 5.15 **Test fixture — unsupported**: try/catch across yield → error diagnostic

## 6. CLI Commands

- [x] 6.1 Implement `cmdx run <name>`: locate compiled script, create session, invoke runtime loop, output JSON
- [x] 6.2 Implement `cmdx resume <id>`: load session, parse `--answer`/`--answer-file`, invoke runtime loop from saved phase
- [x] 6.3 Implement `cmdx compile <name>`: locate `.ts` source, invoke transform, write `.compiled.ts`
- [x] 6.4 Implement `cmdx migrate <name>`: check git clean, read `.md`, generate `.ts` (LLM-assisted), compile, rewrite `.md` shell
- [x] 6.5 Implement answer passing validation: reject if both `--answer` and `--answer-file`, reject if missing when needed
- [x] 6.6 Ensure only JSON on stdout, diagnostics on stderr
- [x] 6.7 **Test**: run → yield → resume → done full cycle, compile success/failure, answer validation, stderr/stdout separation

## 7. Hello World Pilot

- [x] 7.1 Write `hello.ts` — a trivial script: `sh("echo hello")` → `ask("What is your name?")` → `sh("echo Hi, <name>")` → `done`
- [x] 7.2 Hand-compile `hello.compiled.ts` to validate the expected state machine shape
- [x] 7.3 Run `hello.compiled.ts` through runtime, verify yield/resume cycle works end-to-end
- [x] 7.4 Auto-compile `hello.ts` via transform, diff against hand-compiled version
- [x] 7.5 Write `hello.md` shell, test full flow: `cmdx run hello` → yield → `cmdx resume <id> --answer=...` → done

## 8. Commit Command Pilot

- [x] 8.1 Write `commit.ts` — the real commit script with: staged check, diff, ask for title, git commit, retry loop with askUser fallback
- [x] 8.2 Compile `commit.ts` via transform, verify compiled output handles while + if/else + askUser correctly
- [x] 8.3 Write `commit.md` shell (~10 lines)
- [x] 8.4 **E2E test**: create a test git repo, stage files, `cmdx run commit` → yield (title) → `cmdx resume --answer="feat: test"` → done (or retry path)
- [x] 8.5 **E2E test**: pre-commit hook failure path — verify retry loop yields askUser after 2 failures

## 9. Integration & Polish

- [x] 9.1 Ensure Windows compatibility: `os.tmpdir()` paths, child_process shell option
- [x] 9.2 Add CLI `--help` for all subcommands
- [x] 9.3 Add error JSON output for unhandled exceptions in runtime
- [x] 9.4 Final pass: verify all spec scenarios have corresponding test coverage
