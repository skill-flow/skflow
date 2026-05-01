# @skflow/transform

Compile TypeScript scripts into deterministic state machines.

## Overview

Takes an async TypeScript function using skflow primitives (`sh`, `ask`, `askUser`, `done`) and compiles it into a synchronous `step(state, input)` state machine that can be driven by an external loop.

## Usage

```typescript
import { transform } from "@skflow/transform";

const source = `
import { sh, ask, done } from "@skflow/runtime";
export async function main() {
  const diff = await sh("git diff --cached");
  const title = await ask({ prompt: "Generate title", data: { diff } });
  await sh("git commit -F -", { stdin: title });
  return done({ summary: title.split("\\n")[0] });
}`;

const result = transform(source);
// result.code — compiled JS with `export function step(state, input) { ... }`
// result.errors — array of compilation errors (empty on success)
```

## What It Does

```
Input (async/await)              Output (state machine)
─────────────────────            ──────────────────────
await sh("cmd")          →       case N: return { _sh: { cmd }, next: { phase: N+1 } }
await ask({ ... })       →       case N: return { yield: { ... }, next: { phase: N+1 } }
return done({ ... })     →       case N: return { done: { ... } }
if/while/for             →       multiple cases with phase jumps
try/catch/finally        →       _tries array + catch dispatch
```

## Compiled Output

The compiled JS exports:

- `step(state, input)` — the state machine function
- `__sourceMap` — phase-to-source-line mapping for error diagnostics

```javascript
export function step(state, input) {
  while (true) {
    switch (state.phase) {
      case 0: /* ... */ return { _sh: { cmd: "git diff --cached" }, next: { phase: 1 } };
      case 1: /* L4 resume after sh() */ state.diff = JSON.parse(input); /* ... */
      // ...
    }
  }
}
export const __sourceMap = [[0,4,"const diff = await sh(\"git diff --cached\")","sh"], ...];
```

## Supported Patterns

- Sequential `sh()` / `ask()` / `askUser()` calls
- `if`/`else` branches containing yields
- `while` and `for` loops containing yields
- `try`/`catch`/`finally` across yield boundaries
- `sh-throws` pragma (`// @skflow sh-throws`) or per-call `{ throws: true }`
- Top-level declarations (constants, helpers) preserved in output

## Limitations

- Yield calls cannot appear inside nested functions (callbacks, arrow functions)
- Every code path must end with `return done(...)`

## License

MIT
