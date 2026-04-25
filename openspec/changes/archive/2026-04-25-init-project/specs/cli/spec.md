## ADDED Requirements

### Requirement: cmdx run starts a script session
The CLI SHALL accept `cmdx run <name>` to start executing a compiled script from `.claude/commands/.cmdx/<name>.compiled.ts`. It SHALL create a new session in `os.tmpdir()/cmdx/sessions/<id>/`, execute the state machine from phase 0, and output JSON to stdout.

#### Scenario: Run a simple script that yields
- **WHEN** user runs `cmdx run hello` and `hello.compiled.ts` exists
- **THEN** CLI creates a session, executes from phase 0, and outputs a yield or done JSON to stdout

#### Scenario: Run a script that completes without yielding
- **WHEN** the script reaches `done()` without any `ask()`/`askUser()` calls
- **THEN** CLI outputs `{"done": {"summary": "..."}, "log": [...]}` and cleans up the session

#### Scenario: Script file not found
- **WHEN** user runs `cmdx run foo` and no `foo.compiled.ts` exists
- **THEN** CLI exits with code 1 and prints an error message to stderr

### Requirement: cmdx resume continues a paused session
The CLI SHALL accept `cmdx resume <session-id>` with `--answer=<text>` or `--answer-file=<path>` to continue a paused session from its saved state.

#### Scenario: Resume with inline answer
- **WHEN** user runs `cmdx resume abc123 --answer="feat: add login"`
- **THEN** CLI loads session state, passes the answer as input to the current phase, and continues execution

#### Scenario: Resume with file answer
- **WHEN** user runs `cmdx resume abc123 --answer-file=/tmp/answer.txt`
- **THEN** CLI reads the file content and uses it as the answer input

#### Scenario: Resume an expired session
- **WHEN** user runs `cmdx resume <id>` and the session was created more than 15 minutes ago
- **THEN** CLI exits with code 1 and prints "Session expired"

#### Scenario: Resume without answer for an ask yield
- **WHEN** user runs `cmdx resume <id>` without `--answer` or `--answer-file` and the session is paused on an `ask` yield
- **THEN** CLI exits with code 1 and prints an error explaining that an answer is required

### Requirement: cmdx migrate converts a command.md to cmdx form
The CLI SHALL accept `cmdx migrate <name>` to convert `.claude/commands/<name>.md` into a `.ts` script + a minimal `.md` shell. It SHALL refuse to run if the git working tree is not clean.

#### Scenario: Successful migration
- **WHEN** user runs `cmdx migrate commit` with a clean git working tree
- **THEN** CLI creates `.claude/commands/.cmdx/commit.ts`, compiles it to `.cmdx/commit.compiled.ts`, and rewrites `commit.md` to a ~10 line shell

#### Scenario: Dirty working tree
- **WHEN** user runs `cmdx migrate commit` with uncommitted changes
- **THEN** CLI exits with code 1 and prints "Working tree is not clean. Please commit or stash changes first."

### Requirement: cmdx compile transforms source to state machine
The CLI SHALL accept `cmdx compile <name>` to compile `.claude/commands/.cmdx/<name>.ts` into `.cmdx/<name>.compiled.ts` using the transform package.

#### Scenario: Successful compilation
- **WHEN** user runs `cmdx compile commit` and `commit.ts` exists and is valid
- **THEN** CLI writes `commit.compiled.ts` alongside it

#### Scenario: Unsupported syntax detected
- **WHEN** the source contains try/catch wrapping a yield point
- **THEN** CLI exits with code 1 and prints a diagnostic explaining the unsupported pattern

### Requirement: cmdx sessions manages session lifecycle
The CLI SHALL provide `cmdx sessions ls` to list active sessions and `cmdx sessions clean` to remove expired sessions.

#### Scenario: List sessions
- **WHEN** user runs `cmdx sessions ls` with 2 active sessions and 1 expired
- **THEN** CLI outputs a table showing session id, script name, age, and status (active/expired)

#### Scenario: Clean expired sessions
- **WHEN** user runs `cmdx sessions clean` with 1 expired session
- **THEN** CLI removes the expired session directory and reports "Cleaned 1 expired session"
