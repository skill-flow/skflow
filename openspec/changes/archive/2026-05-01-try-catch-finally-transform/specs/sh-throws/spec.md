## ADDED Requirements

### Requirement: Per-call throws option (sh-throws-option)

The `sh()` function SHALL accept a `throws` boolean option. When `throws: true`, the generated resume point SHALL throw the sh result object if `code !== 0`.

#### Scenario: sh with throws: true, command fails

- **WHEN** source contains `await sh("cmd", { throws: true })` and the command returns `{ code: 1, stdout: "", stderr: "error" }`
- **THEN** at the resume point, `step()` throws the object `{ code: 1, stdout: "", stderr: "error", cmd: "cmd" }`

#### Scenario: sh with throws: true, command succeeds

- **WHEN** source contains `await sh("cmd", { throws: true })` and the command returns `{ code: 0, stdout: "ok", stderr: "" }`
- **THEN** execution continues normally; no throw occurs

#### Scenario: sh with throws: false (explicit opt-out)

- **WHEN** source contains `await sh("cmd", { throws: false })`
- **THEN** the resume point SHALL NOT throw regardless of exit code; result is assigned normally

#### Scenario: sh without throws option (no pragma)

- **WHEN** source has no `// @skflow sh-throws` pragma and contains `await sh("cmd")`
- **THEN** the resume point SHALL NOT throw regardless of exit code (backward compatible)

#### Scenario: throws coexists with other options

- **WHEN** source contains `await sh("cmd", { stdin: "data", throws: true, timeout: 5000 })`
- **THEN** the `_sh` yield includes `stdin` and `timeout`; the resume point checks code and throws if non-zero

### Requirement: Script-level sh-throws pragma (sh-throws-pragma)

The transformer SHALL detect a `// @skflow sh-throws` comment pragma at the top of the source file. When present, all `sh()` calls default to throwing on non-zero exit code.

#### Scenario: Pragma present, sh without options throws

- **WHEN** source starts with `// @skflow sh-throws` and contains `await sh("cmd")`
- **THEN** the resume point throws if `code !== 0` (same as `{ throws: true }`)

#### Scenario: Pragma present, throws: false overrides

- **WHEN** source starts with `// @skflow sh-throws` and contains `await sh("cmd", { throws: false })`
- **THEN** the resume point does NOT throw regardless of exit code

#### Scenario: Pragma absent, default is no-throw

- **WHEN** source does NOT contain `// @skflow sh-throws`
- **THEN** all `sh()` calls without explicit `{ throws: true }` do NOT throw on failure

#### Scenario: Pragma detection is position-sensitive

- **WHEN** source contains `// @skflow sh-throws` as a comment within the function body (not at top level)
- **THEN** it is NOT recognized as a pragma; only top-level comments before or between import statements count

### Requirement: Error object shape (sh-error-object)

When `sh()` throws due to non-zero exit code, the thrown object SHALL be a plain object containing the shell result plus the command string.

#### Scenario: Error object fields

- **WHEN** sh throws for command `"git push"` with result `{ code: 128, stdout: "", stderr: "fatal: no remote" }`
- **THEN** the thrown object is `{ code: 128, stdout: "", stderr: "fatal: no remote", cmd: "git push" }`

#### Scenario: Error object is accessible in catch

- **WHEN** catch block accesses `e.stderr` and `e.code`
- **THEN** both fields are available with correct values from the failed command
