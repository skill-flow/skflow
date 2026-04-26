### Requirement: sh() accepts an optional options object with stdin

The `sh()` function SHALL accept an optional second argument `{ stdin?: string; timeout?: number }`. When `stdin` is provided, the runtime SHALL pipe the string content to the child process's standard input.

#### Scenario: sh with stdin pipes content to command

- **WHEN** script calls `await sh("git commit -F -", { stdin: "feat: add login\n\nAdded login form component" })`
- **THEN** runtime executes `git commit -F -` with the message piped to stdin, and returns `{stdout, stderr, code}` as normal

#### Scenario: sh with stdin and command fails

- **WHEN** script calls `await sh("git commit -F -", { stdin: "feat: test" })` and pre-commit hook exits with code 1
- **THEN** runtime returns `{stdout, stderr, code: 1}` with the hook's error output in stderr

#### Scenario: sh with only timeout option

- **WHEN** script calls `await sh("long-command", { timeout: 120000 })`
- **THEN** runtime uses 120000ms as the timeout instead of the default 60000ms

#### Scenario: sh without options (backward compatible)

- **WHEN** script calls `await sh("git status")` with no second argument
- **THEN** runtime behaves exactly as before — no stdin piped, default timeout used

#### Scenario: sh with empty stdin

- **WHEN** script calls `await sh("cat", { stdin: "" })`
- **THEN** runtime pipes an empty string to stdin (does not omit the pipe)
