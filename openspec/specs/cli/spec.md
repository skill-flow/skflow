### Requirement: skflow run starts a script session

The CLI SHALL accept `skflow run <name>` to start executing a compiled script from `.claude/commands/.skflow/<name>.compiled.ts`. It SHALL create a new session in `os.tmpdir()/skflow/sessions/<id>/`, execute the state machine from phase 0, and output JSON to stdout.

#### Scenario: Run a simple script that yields

- **WHEN** user runs `skflow run hello` and `hello.compiled.ts` exists
- **THEN** CLI creates a session, executes from phase 0, and outputs a yield or done JSON to stdout

#### Scenario: Run a script that completes without yielding

- **WHEN** the script reaches `done()` without any `ask()`/`askUser()` calls
- **THEN** CLI outputs `{"done": {"summary": "..."}, "log": [...]}` and cleans up the session

#### Scenario: Script file not found

- **WHEN** user runs `skflow run foo` and no `foo.compiled.ts` exists
- **THEN** CLI exits with code 1 and prints an error message to stderr

### Requirement: skflow resume continues a paused session

The CLI SHALL accept `skflow resume <session-id>` with `--answer=<text>` or `--answer-file=<path>` to continue a paused session from its saved state.

#### Scenario: Resume with inline answer

- **WHEN** user runs `skflow resume abc123 --answer="feat: add login"`
- **THEN** CLI loads session state, passes the answer as input to the current phase, and continues execution

#### Scenario: Resume with file answer

- **WHEN** user runs `skflow resume abc123 --answer-file=/tmp/answer.txt`
- **THEN** CLI reads the file content and uses it as the answer input

#### Scenario: Resume an expired session

- **WHEN** user runs `skflow resume <id>` and the session was created more than 15 minutes ago
- **THEN** CLI exits with code 1 and prints "Session expired"

#### Scenario: Resume without answer for an ask yield

- **WHEN** user runs `skflow resume <id>` without `--answer` or `--answer-file` and the session is paused on an `ask` yield
- **THEN** CLI exits with code 1 and prints an error explaining that an answer is required

### Requirement: skflow compile transforms source to state machine

The CLI SHALL accept `skflow compile <name>` to compile `.claude/commands/.skflow/<name>.ts` into `.skflow/<name>.compiled.ts` using the transform package.

#### Scenario: Successful compilation

- **WHEN** user runs `skflow compile commit` and `commit.ts` exists and is valid
- **THEN** CLI writes `commit.compiled.ts` alongside it

#### Scenario: Unsupported syntax detected

- **WHEN** the source contains try/catch wrapping a yield point
- **THEN** CLI exits with code 1 and prints a diagnostic explaining the unsupported pattern

### Requirement: skflow sessions manages session lifecycle

The CLI SHALL provide `skflow sessions ls` to list active sessions and `skflow sessions clean` to remove expired sessions.

#### Scenario: List sessions

- **WHEN** user runs `skflow sessions ls` with 2 active sessions and 1 expired
- **THEN** CLI outputs a table showing session id, script name, age, and status (active/expired)

#### Scenario: Clean expired sessions

- **WHEN** user runs `skflow sessions clean` with 1 expired session
- **THEN** CLI removes the expired session directory and reports "Cleaned 1 expired session"
