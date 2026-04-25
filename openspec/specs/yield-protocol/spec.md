### Requirement: Yield message format
The CLI SHALL output a JSON object to stdout when script execution pauses at an `ask()` or `askUser()` call. The object SHALL contain `yield`, `log`, `session`, and `resume` fields.

#### Scenario: Text yield
- **WHEN** script hits `await ask({prompt: "Generate title", data: {diff: "..."}})`
- **THEN** stdout is:
  ```json
  {
    "yield": {"type": "text", "prompt": "Generate title", "data": {"diff": "..."}},
    "log": [{"type": "sh", "cmd": "...", "code": 0, "stdout": "..."}],
    "session": "<session-id>",
    "resume": "cmdx resume <session-id>"
  }
  ```

#### Scenario: Choice yield
- **WHEN** script hits `await ask({prompt: "Pick type", options: ["feat","fix"]})`
- **THEN** yield has `"type": "choice"` and `"options": ["feat","fix"]`

#### Scenario: Ask-user yield
- **WHEN** script hits `await askUser({question: "What to do?", options: ["fix","skip"]})`
- **THEN** yield has `"type": "ask-user"` -- CC SHALL use AskUserQuestion tool

### Requirement: Done message format
The CLI SHALL output a JSON object to stdout when script execution completes via `done()`.

#### Scenario: Successful done
- **WHEN** script calls `done({summary: "Committed: feat: add login"})`
- **THEN** stdout is:
  ```json
  {
    "done": {"summary": "Committed: feat: add login"},
    "log": [...]
  }
  ```

#### Scenario: Done with extra data
- **WHEN** script calls `done({summary: "Done", data: {filesChanged: 3}})`
- **THEN** done object includes both `summary` and `data`

### Requirement: Error message format
The CLI SHALL output a JSON error object to stdout when script execution fails unexpectedly, and exit with code 1.

#### Scenario: Runtime error
- **WHEN** a script throws an unhandled exception at phase 3
- **THEN** stdout is:
  ```json
  {
    "error": {"message": "TypeError: Cannot read...", "phase": 3, "trace": "..."}
  }
  ```

### Requirement: Session persistence
Each session SHALL be stored as files in `os.tmpdir()/cmdx/sessions/<session-id>/`. The session id SHALL be a random UUID.

#### Scenario: Session created on run
- **WHEN** `cmdx run hello` starts
- **THEN** a directory `<tmpdir>/cmdx/sessions/<uuid>/` is created with `meta.json` (script name, created timestamp) and `state.json` (initial phase 0)

#### Scenario: Session updated on yield
- **WHEN** runtime reaches an `ask()` yield at phase 3
- **THEN** `state.json` is updated with `{"phase": 3, ...hoisted variables}` and `log.json` is updated with all I/O records

#### Scenario: Session cleaned up on done
- **WHEN** script completes with `done()`
- **THEN** the session directory is removed

### Requirement: Session TTL
Sessions SHALL expire after 15 minutes from creation. Attempting to resume an expired session SHALL fail with a clear error.

#### Scenario: Expired session
- **WHEN** `cmdx resume <id>` is called 20 minutes after session creation
- **THEN** CLI outputs error "Session <id> expired (TTL: 15 minutes)" and exits with code 1

### Requirement: Answer passing
The resume command SHALL accept answers via `--answer=<text>` for short inline answers or `--answer-file=<path>` for long answers. Both flags SHALL NOT be used simultaneously.

#### Scenario: Inline answer
- **WHEN** CC runs `cmdx resume abc --answer="feat: add login"`
- **THEN** runtime receives "feat: add login" as the input for the current phase

#### Scenario: File answer
- **WHEN** CC writes a long answer to a file and runs `cmdx resume abc --answer-file=/tmp/ans.txt`
- **THEN** runtime reads the file and uses its content as input

#### Scenario: Both flags provided
- **WHEN** CC runs `cmdx resume abc --answer="x" --answer-file="y"`
- **THEN** CLI exits with code 1 and prints "Cannot use both --answer and --answer-file"

### Requirement: Only JSON on stdout
The CLI SHALL output only valid JSON to stdout (yield, done, or error). All diagnostic messages, progress info, and warnings SHALL go to stderr.

#### Scenario: Diagnostic output
- **WHEN** CLI encounters a non-fatal warning during execution
- **THEN** the warning is written to stderr, stdout contains only the final JSON
