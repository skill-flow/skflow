## ADDED Requirements

### Requirement: CLI uses .ocmdx/skills/ as standard directory

The `cmdx compile <name>` command SHALL read source from `.ocmdx/skills/<name>/script.ts` and write compiled output to `.ocmdx/skills/<name>/script.compiled.js`.

The `cmdx run <name>` command SHALL find compiled scripts at `.ocmdx/skills/<name>/script.compiled.js`.

Both commands SHALL walk up from cwd to find the nearest `.ocmdx/skills/` directory, matching the existing upward-walk behavior.

#### Scenario: Compile a script in the new directory

- **WHEN** user runs `cmdx compile commit` and `.ocmdx/skills/commit/script.ts` exists
- **THEN** the CLI reads `.ocmdx/skills/commit/script.ts`, transforms it, and writes `.ocmdx/skills/commit/script.compiled.js`

#### Scenario: Run a compiled script from the new directory

- **WHEN** user runs `cmdx run commit` and `.ocmdx/skills/commit/script.compiled.js` exists
- **THEN** the CLI loads and executes the compiled script, outputting JSON to stdout

#### Scenario: Compile with missing source

- **WHEN** user runs `cmdx compile foo` and `.ocmdx/skills/foo/script.ts` does not exist
- **THEN** the CLI prints an error message including the expected path and exits with code 1

#### Scenario: Run with missing compiled script

- **WHEN** user runs `cmdx run foo` and `.ocmdx/skills/foo/script.compiled.js` does not exist
- **THEN** the CLI prints an error suggesting `cmdx compile foo` and exits with code 1

#### Scenario: Upward directory walk

- **WHEN** user runs `cmdx run commit` from a subdirectory of a project containing `.ocmdx/skills/commit/script.compiled.js` at the project root
- **THEN** the CLI finds and executes the script by walking up parent directories

### Requirement: Old .claude/commands/.cmdx/ path is no longer searched

The CLI SHALL NOT search `.claude/commands/.cmdx/` for source or compiled scripts. This is a clean break from the previous convention.

#### Scenario: Script only exists in old location

- **WHEN** user runs `cmdx run commit` and the script only exists at `.claude/commands/.cmdx/commit.compiled.js`
- **THEN** the CLI reports "compiled script not found" and does not fall back to the old path
