## Why

cmdx currently hardcodes `.claude/commands/.cmdx/` as the script directory, tying it to Claude Code. Meanwhile, the vercel-labs/skills ecosystem (`npx skills add`) provides a cross-agent distribution mechanism for markdown-based skills. By migrating cmdx to a standard `.ocmdx/skills/` directory and adding a distributable `ocmdx-transform` skill, users can install it via `npx skills add opencmdx/ocmdx` and use it to convert any verbose markdown skill into a deterministic ocmdx script — reducing LLM token usage and improving reliability.

## What Changes

- **New standard directory**: cmdx uses `.ocmdx/skills/<name>/` instead of `.claude/commands/.cmdx/` for script source, compiled output, and original skill backups.
- **CLI path refactor**: `cmdx compile` and `cmdx run` updated to find scripts in `.ocmdx/skills/<name>/script.ts` and `.ocmdx/skills/<name>/script.compiled.js`.
- **New `skills/` directory in repo**: Contains `ocmdx-transform/SKILL.md`, discoverable by the vercel-labs/skills CLI.
- **`ocmdx-transform` skill**: A pure-prompt skill (no runtime deps) that instructs LLMs to read a verbose markdown skill, classify each step as `sh()`/`ask()`/`askUser()`/`done()`, generate `script.ts`, backup the original to `origin.md`, replace the original with a thin yield-protocol wrapper, and compile.

## Capabilities

### New Capabilities

- `ocmdx-transform-skill`: The SKILL.md prompt that guides LLMs through markdown-to-ocmdx conversion, including classification rules, output templates, and a full before/after example (commit.orign.md → commit.ts).
- `ocmdx-standard-dir`: The `.ocmdx/skills/<name>/` directory layout as cmdx's standard project-level convention, replacing the Claude Code-specific `.claude/commands/.cmdx/` path.

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **`packages/cli/src/commands/compile.ts`**: Path lookup changes from `.claude/commands/.cmdx/{name}.ts` to `.ocmdx/skills/{name}/script.ts`; output to `script.compiled.js` in the same directory.
- **`packages/cli/src/commands/run.ts`**: Path lookup changes from `.claude/commands/.cmdx/{name}.compiled.js` to `.ocmdx/skills/{name}/script.compiled.js`.
- **`packages/cli/src/commands/cli.test.ts`**: Tests may need path updates.
- **`examples/`**: Existing examples should be updated or annotated to reflect the new layout.
- **New file**: `skills/ocmdx-transform/SKILL.md`.
- **External dependency**: Users of the transform skill need `@ocmdx/cli` available (via `npx` or global install) to compile and run generated scripts.
