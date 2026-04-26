## ADDED Requirements

### Requirement: SKILL.md is discoverable by vercel-labs/skills CLI

The file `skills/ocmdx-transform/SKILL.md` SHALL exist in the repo root with YAML frontmatter containing `name: ocmdx-transform` and a `description` field. This makes it discoverable by `npx skills add opencmdx/ocmdx`.

#### Scenario: Skill discovery via npx skills add

- **WHEN** the vercel-labs/skills CLI clones this repo and recursively searches for SKILL.md files
- **THEN** it finds `skills/ocmdx-transform/SKILL.md` and parses the `name` and `description` from frontmatter

### Requirement: Transform skill classifies steps correctly

The SKILL.md prompt SHALL instruct the LLM to classify each step in the original markdown skill into ocmdx primitives:

- Deterministic shell commands → `sh()`
- Steps requiring LLM judgment or generation → `ask()`
- Steps requiring human user input → `askUser()`
- Terminal/completion states → `done()`

The prompt SHALL instruct the LLM to preserve the original skill's complete logic, including rules, constraints, edge cases, and context. Information from tables, guidelines, and examples in the original skill SHALL be compressed into `ask()` prompt parameters rather than discarded.

#### Scenario: Shell command classification

- **WHEN** the original skill contains a step like "Run `git diff --cached`"
- **THEN** the generated script.ts uses `await sh("git diff --cached")`

#### Scenario: LLM judgment classification

- **WHEN** the original skill contains a step like "Analyze the diff and generate a commit message following these rules: [table of types]"
- **THEN** the generated script.ts uses `await ask({ prompt: "...", data: {...} })` with the rules compressed into the prompt parameter

#### Scenario: User interaction classification

- **WHEN** the original skill contains a step that asks the user to choose between options
- **THEN** the generated script.ts uses `await askUser({ question: "..." })`

#### Scenario: Preserving original logic

- **WHEN** the original skill has retry logic (e.g., "retry up to 2 times on pre-commit failure")
- **THEN** the generated script.ts preserves equivalent control flow using TypeScript loops/conditionals

### Requirement: Transform produces correct file outputs

The SKILL.md prompt SHALL instruct the LLM to produce the following outputs:

1. `.ocmdx/skills/<name>/script.ts` — the generated ocmdx script using `import { sh, ask, askUser, done } from "@ocmdx/runtime"`
2. `.ocmdx/skills/<name>/origin.md` — the original markdown skill, moved as backup
3. A thin wrapper markdown file replacing the original, containing yield protocol instructions and `allowed-tools: Bash(cmdx *)`

#### Scenario: Full transform of a markdown skill

- **WHEN** user invokes the transform skill with path `commit.md`
- **THEN** the LLM creates `.ocmdx/skills/commit/script.ts`, moves the original to `.ocmdx/skills/commit/origin.md`, and replaces the original `commit.md` with a thin yield-protocol wrapper

#### Scenario: Thin wrapper content

- **WHEN** the thin wrapper is generated
- **THEN** it contains frontmatter with `description` and `allowed-tools: Bash(cmdx *)`, and body instructions for the yield protocol (run, parse yield, resume, handle done/error)

### Requirement: Transform skill triggers compilation

The SKILL.md prompt SHALL instruct the LLM to run `npx @ocmdx/cli compile <name>` after generating `script.ts`, producing `script.compiled.js` in the same directory.

#### Scenario: Compile after generation

- **WHEN** the LLM has generated `.ocmdx/skills/commit/script.ts`
- **THEN** the LLM runs `npx @ocmdx/cli compile commit` and verifies the compiled output exists

### Requirement: Transform skill includes a worked example

The SKILL.md SHALL embed a complete before/after example showing the transformation of a real skill (the commit skill), including the full original markdown, the generated TypeScript, and the thin wrapper. This serves as a few-shot prompt for the LLM.

#### Scenario: Example is present

- **WHEN** an LLM reads the SKILL.md
- **THEN** it finds a complete input→output example demonstrating the transformation pattern
