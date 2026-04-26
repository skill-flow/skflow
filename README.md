# ocmdx

Turn natural-language AI commands into deterministic, resumable scripts.

ocmdx compiles TypeScript scripts that mix shell commands (`sh`) with LLM judgment calls (`ask`) into state machines. The compiled scripts yield to an AI agent (like Claude Code) when they need a decision, and resume exactly where they left off with the answer.

## Why

AI coding agents use markdown "skills" or "commands" to define workflows — but every step runs through the LLM, even deterministic ones like `git diff` or `git commit`. This is slow, expensive, and unreliable.

ocmdx extracts the deterministic parts into a compiled script and only yields back to the LLM for judgment calls:

```
┌─────────────────────────────────────────────────────┐
│  Before: markdown skill (every step through LLM)    │
│                                                     │
│  LLM: run git diff → LLM: read output → LLM: run   │
│  git diff --stat → LLM: read output → LLM: decide   │
│  commit type → LLM: write message → LLM: run commit │
├─────────────────────────────────────────────────────┤
│  After: ocmdx script (LLM only where needed)        │
│                                                     │
│  script: sh(git diff) → sh(git diff --stat) →       │
│  yield ask("generate commit message") →              │
│  LLM answers → script: sh(git commit) → done        │
└─────────────────────────────────────────────────────┘
```

## How It Works

### 1. Write a script

Place your script in `.ocmdx/skills/<name>/script.ts`:

```typescript
// .ocmdx/skills/commit/script.ts
import { sh, ask, done } from "@ocmdx/runtime";

export async function main() {
  const staged = await sh("git diff --cached --name-status");
  if (!staged.stdout.trim()) {
    return done({ summary: "No staged files" });
  }

  const diff = await sh("git diff --cached");

  const message = await ask({
    prompt: "Generate a commit message: line 1 is title, line 3+ is description",
    data: { staged, diff },
  });

  const result = await sh("git commit -F -", { stdin: message });

  if (result.code === 0) {
    return done({ summary: message.split("\n")[0] });
  }

  // pre-commit failed — yield back so the caller can fix
  const fix = await ask({
    prompt: "Pre-commit hook failed. Please fix the issues and resume.",
    data: { stderr: result.stderr },
  });

  await sh("git add -u");
  const retry = await sh("git commit -F -", { stdin: message });
  return done({ summary: message.split("\n")[0], data: { retry } });
}
```

### 2. Compile to a state machine

```bash
cmdx compile commit
# Reads:  .ocmdx/skills/commit/script.ts
# Writes: .ocmdx/skills/commit/script.compiled.js
```

The transform package parses the TypeScript AST, hoists variables into a state object, and explodes the control flow into a `switch(state.phase)` state machine. Each `sh()`, `ask()`, and `askUser()` call becomes a yield point.

### 3. Run it

```bash
# Start the script — runs all sh() calls automatically, pauses at ask()
cmdx run commit
# → {"yield": {"type": "text", "prompt": "Generate a commit message...", "data": {...}}, "session": "abc123", ...}

# The caller (Claude Code) generates the answer, then resumes
cmdx resume abc123 --answer="feat: add login\n\nAdded login form and auth integration"
# → {"done": {"summary": "feat: add login"}, "log": [...]}
```

## Project Directory Layout

Scripts live in `.ocmdx/skills/` at your project root:

```
your-project/
├── .ocmdx/skills/
│   └── commit/
│       ├── script.ts              ← source script
│       ├── script.compiled.js     ← compiled state machine
│       └── origin.md              ← original skill backup (if transformed)
└── .claude/commands/commit.md     ← thin wrapper (yield protocol)
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    @ocmdx/cli                        │
│              cmdx run | resume | compile              │
├────────────────────┬────────────────────────────────┤
│  @ocmdx/transform  │         @ocmdx/runtime          │
│                    │                                  │
│  TypeScript AST    │  execSh() — run shell commands   │
│  → hoist variables │  run() — start a session         │
│  → explode control │  resume() — continue a session   │
│    flow            │  session management (state,       │
│  → emit step()     │    log, TTL)                     │
│    function        │                                  │
└────────────────────┴────────────────────────────────┘
```

### Packages

| Package            | Description                                                                         |
| ------------------ | ----------------------------------------------------------------------------------- |
| `@ocmdx/runtime`   | Script execution engine: `sh()`, `ask()`, `askUser()`, `done()`, session management |
| `@ocmdx/transform` | AST compiler: TypeScript source → state machine `step(state, input)` function       |
| `@ocmdx/cli`       | CLI entry point: `cmdx run`, `cmdx resume`, `cmdx compile`                          |

### Primitives

| Function                 | What it does                                             | Yield type                         |
| ------------------------ | -------------------------------------------------------- | ---------------------------------- |
| `sh(cmd, opts?)`         | Execute a shell command, return `{stdout, stderr, code}` | Internal (auto-resumed by runtime) |
| `ask({prompt, data?})`   | Pause and ask the LLM for a judgment call                | External (`type: "text"`)          |
| `askUser({question})`    | Pause and ask the human user                             | External (`type: "ask-user"`)      |
| `done({summary, data?})` | Terminate the script with a result                       | Terminal                           |

### Yield Protocol

When a script hits `ask()` or `askUser()`, the process exits with a JSON message:

```json
{
  "yield": { "type": "text", "prompt": "...", "data": {...} },
  "log": [{ "type": "sh", "cmd": "git diff", "code": 0, "stdout": "..." }],
  "session": "uuid",
  "resume": "cmdx resume uuid"
}
```

The caller reads the yield, does whatever it needs (generate an answer, ask the user, fix code), then resumes:

```bash
cmdx resume <session-id> --answer="the answer"
```

Sessions are stored in `os.tmpdir()/cmdx/sessions/` and expire after 15 minutes.

## Transform Existing Skills

Have a verbose markdown skill? Transform it into an ocmdx script automatically:

```bash
# Install the transform skill (works with any agent that supports the skills ecosystem)
npx skills add opencmdx/ocmdx

# Then invoke it from your agent
/ocmdx-transform .claude/commands/commit.md
```

The transform skill guides the LLM to:

1. Read your original markdown skill
2. Classify each step as `sh()`, `ask()`, `askUser()`, or `done()`
3. Generate `.ocmdx/skills/<name>/script.ts`
4. Backup the original to `.ocmdx/skills/<name>/origin.md`
5. Replace the original with a thin yield-protocol wrapper
6. Compile the script

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Lint & format
npm run lint
npm run format
```

## License

MIT
