# Examples

These examples demonstrate skflow scripts and their corresponding markdown wrappers.

## Directory Layout

In a real project, these files would live in the `.skflow/skills/` directory:

```
.skflow/skills/
├── commit/
│   ├── script.ts              ← commit.ts
│   ├── script.compiled.js     ← skflow compile commit
│   └── origin.md              ← commit.orign.md (original verbose skill)
└── hello/
    ├── script.ts              ← hello.ts
    └── script.compiled.js     ← skflow compile hello
```

The thin markdown wrappers (`commit.md`, `hello.md`) would replace the original skill in the agent's command directory (e.g., `.claude/commands/commit.md`).

## Files

| File              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `commit.ts`       | skflow script: staged files → generate commit message → commit    |
| `commit.md`       | Thin wrapper: delegates to `skflow run commit` via yield protocol |
| `commit.orign.md` | Original verbose markdown skill (231 lines, before transform)     |
| `hello.ts`        | skflow script: minimal example with sh + ask + done               |
| `hello.md`        | Thin wrapper for hello script                                     |
| `*.test.ts`       | Tests for compilation and state machine execution                 |
