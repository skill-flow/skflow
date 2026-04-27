## ADDED Requirements

### Requirement: CLI uses .skflow/skills/ as standard directory

The `skflow compile <name>` command SHALL read source from `.skflow/skills/<name>/script.ts` and write compiled output to `.skflow/skills/<name>/script.compiled.js`.

The `skflow run <name>` command SHALL find compiled scripts at `.skflow/skills/<name>/script.compiled.js`.

Both commands SHALL walk up from cwd to find the nearest `.skflow/skills/` directory, matching the existing upward-walk behavior.

#### Scenario: Compile a script in the new directory

- **WHEN** user runs `skflow compile commit` and `.skflow/skills/commit/script.ts` exists
- **THEN** the CLI reads `.skflow/skills/commit/script.ts`, transforms it, and writes `.skflow/skills/commit/script.compiled.js`

#### Scenario: Run a compiled script from the new directory

- **WHEN** user runs `skflow run commit` and `.skflow/skills/commit/script.compiled.js` exists
- **THEN** the CLI loads and executes the compiled script, outputting JSON to stdout

#### Scenario: Compile with missing source

- **WHEN** user runs `skflow compile foo` and `.skflow/skills/foo/script.ts` does not exist
- **THEN** the CLI prints an error message including the expected path and exits with code 1

#### Scenario: Run with missing compiled script

- **WHEN** user runs `skflow run foo` and `.skflow/skills/foo/script.compiled.js` does not exist
- **THEN** the CLI prints an error suggesting `skflow compile foo` and exits with code 1

#### Scenario: Upward directory walk

- **WHEN** user runs `skflow run commit` from a subdirectory of a project containing `.skflow/skills/commit/script.compiled.js` at the project root
- **THEN** the CLI finds and executes the script by walking up parent directories

### Requirement: Old .claude/commands/.skflow/ path is no longer searched

The CLI SHALL NOT search `.claude/commands/.skflow/` for source or compiled scripts. This is a clean break from the previous convention.

#### Scenario: Script only exists in old location

- **WHEN** user runs `skflow run commit` and the script only exists at `.claude/commands/.skflow/commit.compiled.js`
- **THEN** the CLI reports "compiled script not found" and does not fall back to the old path
