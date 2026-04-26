## Context

cmdx is a monorepo with three packages (`@ocmdx/cli`, `@ocmdx/runtime`, `@ocmdx/transform`) that compiles TypeScript scripts mixing `sh()` with `ask()` into state machines. Currently, the CLI hardcodes `.claude/commands/.cmdx/` as the location for source and compiled scripts, coupling it to Claude Code's directory convention.

The vercel-labs/skills ecosystem provides cross-agent skill distribution via `npx skills add <owner/repo>`. Skills are discovered by recursively finding directories containing a `SKILL.md` file with `name` and `description` in YAML frontmatter. Installation copies the entire skill directory (not just the SKILL.md) into agent-specific locations (`.agents/skills/`, `.claude/skills/`, etc.).

## Goals / Non-Goals

**Goals:**

- Establish `.ocmdx/skills/<name>/` as cmdx's standard project-level directory for script source, compiled output, and original skill backups.
- Update `cmdx compile` and `cmdx run` to use the new directory layout.
- Create `skills/ocmdx-transform/SKILL.md` in this repo, installable via `npx skills add opencmdx/ocmdx`.
- The transform skill SHALL be a pure prompt (no runtime dependencies at install time) that guides any LLM to convert a verbose markdown skill into an ocmdx script.

**Non-Goals:**

- Bundling `@ocmdx/cli` inside the skill package — users use `npx @ocmdx/cli` or install globally.
- Supporting backward-compatible lookup in `.claude/commands/.cmdx/` — clean break.
- Creating an ocmdx registry or custom skill distribution mechanism — we use the existing vercel-labs/skills ecosystem.
- Multi-agent wrapper generation (Cursor, Codex, etc.) — the thin wrapper targets whichever agent the user is using; agent-specific adaptation is out of scope.

## Decisions

### 1. Directory layout: `.ocmdx/skills/<name>/` with fixed filenames

**Decision**: Each skill gets a directory under `.ocmdx/skills/` with:

- `script.ts` — source
- `script.compiled.js` — compiled output
- `origin.md` — backup of original skill (only present if transformed)

**Rationale**: Fixed filenames (`script.ts` not `<name>.ts`) simplify the CLI lookup — `cmdx compile commit` just resolves to `.ocmdx/skills/commit/script.ts`. The directory name carries the skill identity. This also allows future additions (e.g., `config.json`, `test.ts`) without filename collisions.

**Alternative considered**: Keep `<name>.ts` convention but in new location. Rejected because it duplicates the name (directory + filename) and complicates the lookup when name contains special characters.

### 2. Transform skill as pure prompt, not CLI code

**Decision**: Implement the markdown→ocmdx conversion as a SKILL.md prompt rather than as `cmdx migrate` CLI logic.

**Rationale**: The core task — identifying which steps in a markdown skill are deterministic vs. require LLM judgment — inherently requires LLM reasoning. A prompt-based skill leverages the agent's own capabilities and can be distributed/updated independently of the CLI. The `cmdx migrate` stub in the CLI becomes unnecessary.

**Alternative considered**: Implement migration as CLI code that calls an LLM API. Rejected because it would require API key configuration, add a runtime dependency, and couple the CLI to a specific LLM provider.

### 3. Repo structure: `skills/` at repo root

**Decision**: Place `skills/ocmdx-transform/SKILL.md` under `skills/` at the repo root.

**Rationale**: The vercel-labs/skills CLI discovers SKILL.md files by recursively walking the cloned repo (skipping `node_modules`, `.git`, `dist`, `build`). Placing skills under `skills/` follows the convention used by `vercel-labs/agent-skills`. The repo URL `opencmdx/ocmdx` maps to `npx skills add opencmdx/ocmdx`.

### 4. Compile step in the transform flow

**Decision**: The transform SKILL.md instructs the LLM to run `npx @ocmdx/cli compile <name>` after generating `script.ts`.

**Rationale**: `npx` ensures zero-install friction — the user doesn't need to pre-install `@ocmdx/cli`. The compile step is deterministic and fast, so having the LLM invoke it via bash is appropriate.

## Risks / Trade-offs

- **[Breaking change]** Existing scripts in `.claude/commands/.cmdx/` stop working after CLI update → Mitigation: Document migration in README; users can move files manually or re-run transform.
- **[Prompt quality]** Transform output quality depends on the SKILL.md prompt and the embedded example → Mitigation: Include the full `commit.orign.md` → `commit.ts` example as a comprehensive few-shot sample. Users can iterate on individual outputs.
- **[npx latency]** `npx @ocmdx/cli compile` downloads the package on first run → Mitigation: Acceptable for a one-time transform operation. Users who transform frequently can `npm install -g @ocmdx/cli`.
- **[Skill discovery]** The vercel-labs/skills CLI must be able to find `SKILL.md` in the repo → Mitigation: Verified discovery logic walks `skills/` directories; no blockers.
