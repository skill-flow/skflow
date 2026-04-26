## Why

The `sh()` function currently only accepts a command string, which makes it impossible to safely pass multi-line or special-character content (like commit messages with descriptions) to commands that accept stdin. The commit example script also needs to be rewritten to match the intended ocmdx interaction model: deterministic shell steps in the script, LLM judgment via `ask()` yields, and no artificial retry limits — letting the caller (Claude Code) decide when to stop retrying.

## What Changes

- Add optional `stdin` support to `sh()`: `await sh("git commit -F -", { stdin: message })` pipes content to the command's stdin
- **BREAKING**: `sh()` signature changes from `sh(cmd: string)` to `sh(cmd: string, opts?: { stdin?: string; timeout?: number })`
- Update the transform to handle `sh()` calls with a second options argument, passing it through to the compiled `_sh` yield
- Update the runtime's `execSh` to pipe `stdin` content to the child process via `execSync`'s `input` option
- Rewrite `examples/commit.ts` to the correct flow: gather diff → ask LLM for title+description → commit via `sh` with stdin → on pre-commit failure, yield back to Claude Code with error context → loop until success

## Capabilities

### New Capabilities

- `sh-stdin`: Support for piping stdin content to shell commands via an options argument to `sh()`

### Modified Capabilities

- `runtime`: `sh()` gains an optional second argument `{ stdin?, timeout? }`, `execSh` accepts and pipes stdin
- `transform`: Compiled `_sh` yield includes optional `stdin` and `timeout` fields from the options argument

## Impact

- `packages/runtime/src/sh.ts`: `execSh` function signature and implementation (add `input` option to `execSync`)
- `packages/runtime/src/protocol.ts`: `InternalShYield._sh` type gains optional `stdin` and `timeout` fields
- `packages/runtime/src/runner.ts`: Pass `stdin` from `_sh` yield to `execSh`
- `packages/runtime/src/ask.ts`: No change (placeholder API unchanged)
- `packages/transform/src/emit.ts`: `makeShYield` passes through the second argument of `sh()` calls
- `packages/transform/src/detect.ts`: No change (already detects `sh` as yield function)
- `examples/commit.ts`: Full rewrite to new flow
- `examples/commit.test.ts`: Update tests for new flow
