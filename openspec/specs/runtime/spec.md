### Requirement: sh() executes shell commands and records I/O

The `sh(cmd, opts?)` function SHALL execute the given shell command as a child process, capture stdout, stderr, and exit code, and record the call in the session log. When `opts.stdin` is provided, the runtime SHALL pipe it to the child process's standard input via `execSync`'s `input` option. When `opts.timeout` is provided, it SHALL override the default 60-second timeout. In the compiled state machine, `sh()` is a yield point but the runtime SHALL auto-resume it without exiting the process.

#### Scenario: Successful shell command

- **WHEN** script calls `await sh("git diff --cached")`
- **THEN** runtime executes the command, returns `{stdout, stderr, code}`, logs the call to session, and advances to the next phase automatically

#### Scenario: Shell command fails

- **WHEN** script calls `await sh("git commit -m 'test'")` and the command exits with code 1
- **THEN** runtime returns `{stdout, stderr, code: 1}` (does not throw), logs the call, and advances to the next phase

#### Scenario: Shell command timeout

- **WHEN** a shell command does not complete within the configured timeout (default 60 seconds)
- **THEN** runtime kills the child process and returns `{stdout: "", stderr: "timeout", code: -1}`

#### Scenario: Shell command with stdin

- **WHEN** script calls `await sh("git commit -F -", { stdin: "feat: add login\n\nDetails here" })`
- **THEN** runtime executes the command with the stdin content piped to the child process, returns `{stdout, stderr, code}`, and logs the call including the stdin content

#### Scenario: Shell command with custom timeout

- **WHEN** script calls `await sh("slow-cmd", { timeout: 120000 })`
- **THEN** runtime uses 120000ms as the timeout for this command

#### Scenario: Runtime passes stdin from \_sh yield to execSh

- **WHEN** the compiled state machine returns `{ _sh: { cmd: "cat", stdin: "hello" }, next: {...} }`
- **THEN** runtime reads `_sh.stdin` and passes it to `execSh` as the stdin input

### Requirement: ask() yields to LLM for judgment

The `ask(opts)` function SHALL pause script execution, serialize current state, and output a yield JSON that asks Claude Code to provide an answer. The process SHALL exit after outputting the yield.

#### Scenario: ask with prompt and data

- **WHEN** script calls `await ask({prompt: "Generate commit title", data: {diff: "..."}})`
- **THEN** runtime saves state, outputs `{"yield": {"type": "text", "prompt": "...", "data": {...}}, "log": [...], "session": "<id>", "resume": "cmdx resume <id>"}`, and exits with code 0

#### Scenario: ask with choices

- **WHEN** script calls `await ask({prompt: "Pick a type", options: ["feat","fix","refactor"]})`
- **THEN** runtime outputs yield with `"type": "choice"` and `"options": ["feat","fix","refactor"]`

### Requirement: askUser() yields to the human user

The `askUser(opts)` function SHALL pause script execution and output a yield JSON with `type: "ask-user"`, signaling CC to use the AskUserQuestion tool rather than answering itself.

#### Scenario: askUser with question and options

- **WHEN** script calls `await askUser({question: "Hook failed, what to do?", options: ["fix","skip","cancel"]})`
- **THEN** runtime outputs yield with `"type": "ask-user"`, `"prompt"` set to the question, and `"options"` array

### Requirement: done() terminates the script

The `done(result)` function SHALL end script execution and output a done JSON with the provided summary and optional data.

#### Scenario: Script completes successfully

- **WHEN** script calls `return done({summary: "Committed: feat: add login"})`
- **THEN** runtime outputs `{"done": {"summary": "Committed: feat: add login"}, "log": [...]}` and exits with code 0

#### Scenario: Script completes with extra data

- **WHEN** script calls `return done({summary: "Done", data: {files: 3}})`
- **THEN** runtime outputs done JSON with both `summary` and `data` fields

### Requirement: Runtime state management

The runtime SHALL save state to `<session-dir>/state.json` before each yield point (including `sh()` auto-resumes). On resume, it SHALL load state and continue from the saved phase.

#### Scenario: State saved before sh()

- **WHEN** script executes `await sh("git diff")` and the process crashes mid-execution
- **THEN** on next `cmdx resume`, runtime resumes from the phase before the `sh()` call

#### Scenario: State saved before ask()

- **WHEN** script reaches `await ask(...)` and outputs a yield
- **THEN** `state.json` contains the current phase number and all hoisted variables

### Requirement: Session I/O log

The runtime SHALL maintain a log of all `sh()` calls with their command, stdout, stderr, and exit code. This log SHALL be included in yield and done outputs, and persisted to `<session-dir>/log.json`.

#### Scenario: Multiple sh() calls before yield

- **WHEN** script runs 3 `sh()` calls then hits an `ask()`
- **THEN** the yield output's `log` array contains 3 entries with full I/O for each command
