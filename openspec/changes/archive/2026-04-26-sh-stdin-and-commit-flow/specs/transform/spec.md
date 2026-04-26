## MODIFIED Requirements

### Requirement: State machine emission (emit)

The transformer SHALL generate a `step(state, input)` function containing a `while(1) switch(state.phase)` dispatch loop. Each yield point SHALL be a separate case. When `sh()` is called with a second options argument, the transformer SHALL emit the options object's properties (`stdin`, `timeout`) as fields on the `_sh` yield object.

#### Scenario: Simple script with one ask

- **WHEN** source has: sh -> sh -> ask -> sh -> done
- **THEN** compiled output has cases 0 (sh+sh, auto-resume), 1 (yield ask), 2 (sh+done). Cases without ask/askUser are merged when consecutive.

#### Scenario: Yield returns are correctly typed

- **WHEN** a case contains `await ask(...)`
- **THEN** the compiled case returns `{yield: {type: "text", prompt: ...}, next: {phase: N}}`

#### Scenario: sh() cases return internal yields

- **WHEN** a case contains `await sh(...)`
- **THEN** the compiled case returns `{_sh: {cmd: ...}, next: {phase: N}}` (runtime handles internally)

#### Scenario: sh() with options includes stdin in yield

- **WHEN** a case contains `await sh("git commit -F -", { stdin: state.message })`
- **THEN** the compiled case returns `{_sh: {cmd: "git commit -F -", stdin: state.message}, next: {phase: N}}`

#### Scenario: sh() with options includes timeout in yield

- **WHEN** a case contains `await sh("slow-cmd", { timeout: 120000 })`
- **THEN** the compiled case returns `{_sh: {cmd: "slow-cmd", timeout: 120000}, next: {phase: N}}`

#### Scenario: sh() with both stdin and timeout

- **WHEN** a case contains `await sh("cmd", { stdin: state.data, timeout: 30000 })`
- **THEN** the compiled case returns `{_sh: {cmd: "cmd", stdin: state.data, timeout: 30000}, next: {phase: N}}`

#### Scenario: done() returns terminal

- **WHEN** a case contains `return done({summary: "..."})`
- **THEN** the compiled case returns `{done: {summary: "..."}}`
