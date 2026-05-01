# @skflow/runtime

Runtime for executing compiled skflow scripts.

## Overview

Provides the primitives used in skflow scripts and the execution engine that drives compiled state machines.

## Script Primitives

```typescript
import { sh, ask, askUser, done } from "@skflow/runtime";
```

| Function         | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `sh(cmd, opts?)` | Execute a shell command. Returns `{ stdout, stderr, code }`. |
| `ask(opts)`      | Yield to the LLM for judgment. Pauses execution.             |
| `askUser(opts)`  | Yield to the human user for input. Pauses execution.         |
| `done(result)`   | Terminate the script with a summary.                         |

### sh() options

```typescript
await sh("git commit -F -", { stdin: message });
await sh("slow-cmd", { timeout: 120000 });
await sh("npm test", { throws: true }); // throw on non-zero exit
```

## Execution Engine

```typescript
import { run, resume } from "@skflow/runtime";

// Start a new execution
const output = run({ scriptName: "deploy", scriptPath: "...", step, sourceMap });

// Resume a paused session
const output = resume({ sessionId: "...", answer: "...", step, sourceMap });
```

## Yield Protocol

The runtime outputs JSON messages:

- **yield** — script paused, waiting for input (`text`, `choice`, `ask-user`, `sh-error`)
- **done** — script completed successfully
- **error** — script failed with an unrecoverable error

### sh-error recovery

When `sh()` fails and no try/catch handles it, the runtime yields a `sh-error` instead of crashing. The LLM can resume with a replacement command to retry.

```json
{
  "yield": {
    "type": "sh-error",
    "cmd": "git push",
    "result": { "stdout": "", "stderr": "rejected", "code": 1 },
    "context": { "line": 5, "source": "const r = await sh(\"git push\")" }
  },
  "log": [...],
  "session": "<id>",
  "resume": "skflow resume <id>"
}
```

## Session Management

Sessions are stored in `os.tmpdir()/skflow/sessions/<uuid>/` and expire after 15 minutes.

## License

MIT
