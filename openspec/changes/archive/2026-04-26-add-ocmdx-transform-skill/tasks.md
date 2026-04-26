## 1. CLI Path Refactor

- [x] 1.1 Update `findCommandsDir()` in `packages/cli/src/commands/compile.ts` to search for `.ocmdx/skills/` instead of `.claude/commands/.cmdx/`, walking up from cwd
- [x] 1.2 Update `compileCommand()` to read `script.ts` and write `script.compiled.js` within `.ocmdx/skills/<name>/`
- [x] 1.3 Update `findCompiledScript()` in `packages/cli/src/commands/run.ts` to search `.ocmdx/skills/<name>/script.compiled.js`
- [x] 1.4 Update CLI tests in `packages/cli/src/cli.test.ts` to reflect new paths

## 2. Transform Skill

- [x] 2.1 Create `skills/ocmdx-transform/SKILL.md` with frontmatter (`name: ocmdx-transform`, `description`), classification rules (sh/ask/askUser/done), output file layout, thin wrapper template, and yield protocol instructions
- [x] 2.2 Embed the full before/after example in the SKILL.md: `commit.orign.md` (input) → `commit.ts` + `commit.md` (output)

## 3. Examples and Documentation

- [x] 3.1 Update `examples/` to demonstrate the new `.ocmdx/skills/` layout (move or annotate existing commit.ts / commit.md examples)
- [x] 3.2 Update README.md architecture diagram and usage examples to reference `.ocmdx/skills/` instead of `.claude/commands/.cmdx/`
