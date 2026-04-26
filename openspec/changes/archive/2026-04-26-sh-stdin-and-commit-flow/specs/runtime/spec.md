## MODIFIED Requirements

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
