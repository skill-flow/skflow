## MODIFIED Requirements

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

#### Scenario: try/catch/finally with yield

- **WHEN** source contains `try { await sh("cmd", {throws:true}); } catch (e) { await ask({prompt:"fix?"}); } finally { await sh("cleanup"); }`
- **THEN** compiled output has separate phase ranges for try body, catch body, and finally body, with a `_tries` dispatch table and `_completion` replay at finally end

### Requirement: Unsupported syntax detection

The transformer SHALL detect and reject patterns not supported, with clear diagnostic messages.

#### Scenario: Yield in nested function

- **WHEN** source contains a function expression or arrow function that calls `await ask(...)`
- **THEN** transformer emits error: "yield (ask/askUser) must be at the top level of main(), not inside nested functions"

#### Scenario: Valid non-yield try/catch

- **WHEN** source contains `try { JSON.parse(x) } catch (e) { ... }` with no yield inside
- **THEN** transformer accepts it and emits it as-is within the current phase

## REMOVED Requirements

### Requirement: try/catch across yield rejection

**Reason**: try/catch/finally across yield points is now fully supported via the try-catch-transform capability.

**Migration**: Scripts with try/catch containing yields will now compile successfully instead of producing an error. No user action needed.
