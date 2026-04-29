# skflow

Transform natural-language skills into deterministic, resumable scripts.

skflow converts markdown skills (used by Claude Code, Cursor, Codex, etc.) into compiled TypeScript state machines. Shell commands run at native speed, and the script only yields back to the LLM when it actually needs a judgment call.

## Why

AI coding agents use markdown "skills" to define workflows — but every step runs through the LLM, even deterministic ones like `git diff` or `git commit`. This is slow, expensive, and unreliable.

skflow transforms these skills into compiled scripts that only call the LLM for decisions:

```
┌─────────────────────────────────────────────────────┐
│  Before: markdown skill (every step through LLM)    │
│                                                     │
│  LLM: run git diff → LLM: read output → LLM: run   │
│  git diff --stat → LLM: read output → LLM: decide  │
│  commit type → LLM: write message → LLM: run commit │
├─────────────────────────────────────────────────────┤
│  After: skflow script (LLM only where needed)       │
│                                                     │
│  script: sh(git diff) → sh(git diff --stat) →       │
│  yield ask("generate commit message") →             │
│  LLM answers → script: sh(git commit) → done       │
└─────────────────────────────────────────────────────┘
```

## Quick Start

Install the transform skill, then point it at any existing markdown skill:

```bash
# Install (works with Claude Code, Cursor, Codex, and other agents)
npx skills add skill-flow/skflow

# Transform an existing markdown skill into a compiled script
/skflow-transform .claude/commands/commit.md
```

That's it. The transform will:

1. Read your original markdown skill
2. Classify each step as `sh()` (deterministic), `ask()` (needs LLM), `askUser()` (needs human), or `done()` (terminal)
3. Generate `.skflow/skills/<name>/script.ts`
4. Backup the original to `.skflow/skills/<name>/origin.md`
5. Replace the original `.md` with a thin yield-protocol wrapper
6. Compile the script to a state machine

Your skill now runs shell commands at native speed and only pauses for LLM judgment.

## How It Works

### The yield protocol

When you run a compiled script, it executes all `sh()` calls automatically and pauses at `ask()` or `askUser()`:

```bash
skflow run commit
# → {"yield": {"type": "text", "prompt": "Generate a commit message...", "data": {...}}, "session": "abc123", ...}

# The agent generates the answer, then resumes
skflow resume abc123 --answer="feat: add login\n\nAdded login form and auth integration"
# → {"done": {"summary": "feat: add login"}, "log": [...]}
```

The thin markdown wrapper handles this protocol — your agent reads the yield, answers the prompt, and resumes. No manual intervention needed.

### Directory layout

```
your-project/
├── .skflow/skills/
│   └── commit/
│       ├── script.ts              ← generated source script
│       ├── script.compiled.js     ← compiled state machine
│       └── origin.md              ← original skill backup
└── .claude/commands/commit.md     ← thin wrapper (yield protocol)
```

## Writing Scripts Directly

For new workflows or advanced use cases, you can write skflow scripts from scratch:

```typescript
// .skflow/skills/commit/script.ts
import { sh, ask, done } from "@skflow/runtime";

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
  return done({ summary: message.split("\n")[0] });
}
```

Then compile and run:

```bash
skflow compile commit    # → .skflow/skills/commit/script.compiled.js
skflow run commit        # → executes, yields at ask()
```

### Primitives

| Function                 | What it does                                             | Yield type                         |
| ------------------------ | -------------------------------------------------------- | ---------------------------------- |
| `sh(cmd, opts?)`         | Execute a shell command, return `{stdout, stderr, code}` | Internal (auto-resumed by runtime) |
| `ask({prompt, data?})`   | Pause and ask the LLM for a judgment call                | External (`type: "text"`)          |
| `askUser({question})`    | Pause and ask the human user                             | External (`type: "ask-user"`)      |
| `done({summary, data?})` | Terminate the script with a result                       | Terminal                           |

`sh()` options: `{ stdin: string, timeout: number }`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    @skflow/cli                        │
│              skflow run | resume | compile            │
├────────────────────┬────────────────────────────────┤
│  @skflow/transform │         @skflow/runtime         │
│                    │                                  │
│  TypeScript AST    │  execSh() — run shell commands   │
│  → hoist variables │  run() — start a session         │
│  → explode control │  resume() — continue a session   │
│    flow            │  session management (state,       │
│  → emit step()     │    log, TTL)                     │
│    function        │                                  │
└────────────────────┴────────────────────────────────┘
```

| Package             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `@skflow/runtime`   | Script execution engine: `sh()`, `ask()`, `askUser()`, `done()`, session management |
| `@skflow/transform` | AST compiler: TypeScript source → state machine `step(state, input)` function       |
| `@skflow/cli`       | CLI entry point: `skflow run`, `skflow resume`, `skflow compile`                    |

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
