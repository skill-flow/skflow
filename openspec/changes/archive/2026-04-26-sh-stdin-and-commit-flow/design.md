## Context

The `sh()` primitive currently accepts only a command string. The runtime passes it to `execSync` and captures stdout/stderr/code. This works for simple commands but breaks when content with newlines, quotes, or special characters needs to be passed to a command (e.g., multi-line commit messages to `git commit -F -`).

The commit example (`examples/commit.ts`) was written as an early prototype and has logic issues: it checks a stale variable in its retry loop, uses `askUser` where `ask` is appropriate, and hard-codes a retry limit that should be the caller's decision.

## Goals / Non-Goals

**Goals:**

- Enable `sh()` to pipe arbitrary string content to a command's stdin
- Keep the change minimal — one optional parameter, no new primitives
- Rewrite `commit.ts` to demonstrate the correct ocmdx interaction model: deterministic shell steps + LLM judgment yields + caller-controlled retry
- Maintain backward compatibility — existing `sh(cmd)` calls work unchanged

**Non-Goals:**

- Adding a `writeFile()` primitive to the runtime (stdin piping solves the immediate need)
- Changing the `ask()` or `askUser()` APIs
- Building the md-to-ts conversion tool (that's a separate change)
- Adding timeout as a user-facing parameter in this change (it's already internal in `execSh`; we formalize it in the options object but keep the default behavior)

## Decisions

### 1. `sh()` options object vs positional arguments

**Decision**: Use an options object as the second argument: `sh(cmd, { stdin?, timeout? })`

**Alternatives considered**:

- Positional `sh(cmd, stdin, timeout)` — poor extensibility, confusing when only timeout is needed
- Separate `shPipe(cmd, stdin)` function — adds a new yield type, more transform complexity
- Template tag `sh\`cmd\`` — breaks the current string-based model entirely

**Rationale**: Options object is idiomatic TypeScript, backward-compatible (second arg is optional), and extensible for future options (env, cwd, etc.) without API breaks.

### 2. How stdin flows through the compiled state machine

**Decision**: The `_sh` yield object gains optional `stdin` and `timeout` fields:

```
{ _sh: { cmd: "git commit -F -", stdin: "feat: ...\n\n- details", timeout: 60000 }, next: {...} }
```

The transform extracts properties from the options object and emits them as fields on `_sh`. The runtime reads these fields and passes them to `execSh`.

**Rationale**: This keeps the transform simple — it just needs to spread the options object fields into the `_sh` object. The runtime already has access to `_sh.cmd`; adding `_sh.stdin` is a natural extension.

### 3. Transform handling of the options argument

**Decision**: When `sh()` has a second argument, the transform emits each known property (`stdin`, `timeout`) as a field on the `_sh` yield object. Unknown properties are ignored.

The transform does NOT need to evaluate the options object at compile time. It emits the expression as-is, and the runtime evaluates it. For example:

```ts
await sh("git commit -F -", { stdin: message });
// compiles to:
return { _sh: { cmd: "git commit -F -", stdin: state.message }, next: { ...state, phase: N } };
```

### 4. Commit script: infinite loop with ask() yield on failure

**Decision**: The commit script uses `while (true)` with `ask()` on pre-commit failure. No retry limit — the caller (Claude Code) decides when to stop by not resuming.

```
sh(git diff) → sh(git diff --stat) → sh(git diff --cached)
  → ask("generate commit message")
  → sh(git commit -F - , {stdin: message})
  → if code=0: done
  → else: ask("pre-commit failed: {stderr}, please fix") → sh(git add -u) → sh(git commit -F -) → loop
```

**Rationale**: In the ocmdx model, the script is a deterministic orchestrator. Retry policy is a judgment call that belongs to the caller (Claude Code), not the script.

## Risks / Trade-offs

- **[Risk] Options object adds transform complexity** → Mitigation: Only extract known fields (`stdin`, `timeout`), ignore rest. The transform spreads them as object literal properties — no deep evaluation needed.
- **[Risk] Infinite loop with no safety valve** → Mitigation: Sessions have a 15-minute TTL. If Claude Code stops resuming, the session expires. The script itself is stateless between yields.
- **[Risk] stdin content could be very large** → Mitigation: `execSync` handles stdin via its `input` option which is memory-buffered. For commit messages this is fine. Large stdin (e.g., file content) is a future concern, not blocking.
- **[Trade-off] Breaking `sh()` signature** → The old signature `sh(cmd: string)` still works since the second arg is optional. Compiled scripts from before this change still work. Only the TypeScript type definition changes.
