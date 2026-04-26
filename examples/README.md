# Examples

These examples demonstrate ocmdx scripts and their corresponding markdown wrappers.

## Directory Layout

In a real project, these files would live in the `.ocmdx/skills/` directory:

```
.ocmdx/skills/
├── commit/
│   ├── script.ts              ← commit.ts
│   ├── script.compiled.js     ← cmdx compile commit
│   └── origin.md              ← commit.orign.md (original verbose skill)
└── hello/
    ├── script.ts              ← hello.ts
    └── script.compiled.js     ← cmdx compile hello
```

The thin markdown wrappers (`commit.md`, `hello.md`) would replace the original skill in the agent's command directory (e.g., `.claude/commands/commit.md`).

## Files

| File              | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| `commit.ts`       | ocmdx script: staged files → generate commit message → commit   |
| `commit.md`       | Thin wrapper: delegates to `cmdx run commit` via yield protocol |
| `commit.orign.md` | Original verbose markdown skill (231 lines, before transform)   |
| `hello.ts`        | ocmdx script: minimal example with sh + ask + done              |
| `hello.md`        | Thin wrapper for hello script                                   |
| `*.test.ts`       | Tests for compilation and state machine execution               |
