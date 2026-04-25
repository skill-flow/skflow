### Requirement: Variable hoisting (hoist)

The transformer SHALL lift all variable declarations (`const`, `let`, `var`) inside the main function body to a state object. Original declarations SHALL be replaced with assignment expressions.

#### Scenario: Simple variable declarations

- **WHEN** source contains `const diff = await sh("git diff")`
- **THEN** compiled output declares `diff` as a field on the state object (e.g., `state.diff`) and replaces the declaration with `state.diff = ...`

#### Scenario: Multiple variables

- **WHEN** source contains `const a = 1; let b = "x"; const c = await ask(...)`
- **THEN** all three are hoisted to state fields: `state.a`, `state.b`, `state.c`

#### Scenario: Variables in nested blocks

- **WHEN** source contains `if (cond) { const x = 1; }`
- **THEN** `x` is hoisted to `state.x` (all variables lifted to top level regardless of block scope)

### Requirement: Control flow explosion (explode)

The transformer SHALL recursively decompose statements into a linear sequence of operations, inserting yield marks at each `await` call to `sh()`, `ask()`, `askUser()`.

#### Scenario: Sequential awaits

- **WHEN** source contains two sequential `await sh(...)` calls
- **THEN** compiled output has two consecutive cases in the switch statement

#### Scenario: if/else with yield in one branch

- **WHEN** source contains `if (cond) { const x = await ask(...) } else { return done(...) }`
- **THEN** compiled output has a conditional jump: if cond goto ask-case, else goto done-case

#### Scenario: while loop with yield

- **WHEN** source contains `while (retries < 2) { const fix = await ask(...); retries++ }`
- **THEN** compiled output has a loop structure: test case -> ask case -> increment + jump back to test case

#### Scenario: for loop with yield

- **WHEN** source contains `for (let i = 0; i < 3; i++) { await sh("cmd " + i) }`
- **THEN** compiled output has init -> test -> body (sh yield) -> update -> jump to test

#### Scenario: Nested if inside while with yield

- **WHEN** source contains a while loop with an if/else where both branches contain `await`
- **THEN** compiled output correctly routes both branches back to the loop test after completion

### Requirement: State machine emission (emit)

The transformer SHALL generate a `step(state, input)` function containing a `while(1) switch(state.phase)` dispatch loop. Each yield point SHALL be a separate case.

#### Scenario: Simple script with one ask

- **WHEN** source has: sh -> sh -> ask -> sh -> done
- **THEN** compiled output has cases 0 (sh+sh, auto-resume), 1 (yield ask), 2 (sh+done). Cases without ask/askUser are merged when consecutive.

#### Scenario: Yield returns are correctly typed

- **WHEN** a case contains `await ask(...)`
- **THEN** the compiled case returns `{yield: {type: "text", prompt: ...}, next: {phase: N}}`

#### Scenario: sh() cases return internal yields

- **WHEN** a case contains `await sh(...)`
- **THEN** the compiled case returns `{_sh: {cmd: ...}, next: {phase: N}}` (runtime handles internally)

#### Scenario: done() returns terminal

- **WHEN** a case contains `return done({summary: "..."})`
- **THEN** the compiled case returns `{done: {summary: "..."}}`

### Requirement: Unsupported syntax detection

The transformer SHALL detect and reject patterns not supported in MVP, with clear diagnostic messages.

#### Scenario: try/catch wrapping a yield

- **WHEN** source contains `try { await ask(...) } catch (e) { ... }`
- **THEN** transformer emits error: "try/catch across yield points is not supported in MVP"

#### Scenario: Yield in nested function

- **WHEN** source contains a function expression or arrow function that calls `await ask(...)`
- **THEN** transformer emits error: "yield (ask/askUser) must be at the top level of main(), not inside nested functions"

#### Scenario: Valid non-yield try/catch

- **WHEN** source contains `try { JSON.parse(x) } catch (e) { ... }` with no yield inside
- **THEN** transformer accepts it -- only try/catch that spans a yield point is rejected

### Requirement: Source-to-source TypeScript transform

The transformer SHALL use TypeScript Compiler API (`ts.transform`) to parse and transform `.ts` source files, and `ts.createPrinter` to output the compiled `.ts` file.

#### Scenario: Input and output are both TypeScript

- **WHEN** transformer processes `commit.ts`
- **THEN** output is `commit.compiled.ts`, a valid TypeScript file that imports from `@ocmdx/runtime`

#### Scenario: Original line references preserved

- **WHEN** transformer emits a case in the switch statement
- **THEN** the case includes a comment referencing the original source line number (e.g., `/* L12 */`)
