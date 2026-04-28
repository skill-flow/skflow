---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git commit:*), Bash(git add:*), Bash(npx eslint:*), Bash(npx prettier:*), Bash(npx tsc:*), Read, Edit, Grep
---

# commit

Check staged files in the git working tree, auto-generate an English commit title (max 80 characters) based on the changes, and commit.

**Hard rule: NEVER use `--no-verify` automatically.** Under no circumstances should this skill add `--no-verify` to bypass the pre-commit hook. Only use it when the user explicitly chooses to.

## Usage

```bash
/commit
```

## Execution Flow

### Step 1: Check staged files

Run the following command to see staged files:

```bash
git diff --cached --name-status
```

**If there are no staged files**, output a hint and stop:

```
No staged files found.

Please stage files first using git add:
  git add <file>        # Add specific file
  git add .             # Add all changes
  git add -p            # Interactive staging
```

### Step 2: Get change details

Get the specific changes in staged files:

```bash
git diff --cached --stat
git diff --cached
```

### Step 3: Determine change type

Classify the change type based on the modifications:

| Type       | Criteria                                                      |
| ---------- | ------------------------------------------------------------- |
| `feat`     | New files, new functions/components/modules                   |
| `fix`      | Bug fixes, correcting faulty logic                            |
| `refactor` | Renames, file moves, code restructuring (no behavior change)  |
| `perf`     | Performance-related changes                                   |
| `docs`     | Documentation-only changes (.md, comments, etc.)              |
| `style`    | Code formatting, whitespace, indentation (no behavior change) |
| `test`     | Adding or modifying test code                                 |
| `chore`    | Build config, dependency updates, CI/CD                       |

### Step 4: Generate commit title

**Format**:

```
<type>: <description>
```

**Rules**:

1. **Total length must not exceed 80 characters**
2. **Use English**
3. **Use simple, clear vocabulary and grammar**
4. **Use base-form verbs** (add, fix, update, remove, refactor)
5. **Do not end with a period**
6. **Lowercase start** (the description part after the type)

**Examples**:

| Change                     | Generated title                               |
| -------------------------- | --------------------------------------------- |
| Add user login component   | `feat: add user login component`              |
| Fix null pointer exception | `fix: handle null pointer in payment service` |
| Rename variable            | `refactor: rename userId to accountId`        |
| Update README              | `docs: update installation guide`             |
| Add unit tests             | `test: add unit tests for auth module`        |
| Upgrade dependency         | `chore: upgrade react to v18.2`               |
| Optimize query performance | `perf: optimize database query in search`     |
| Format code                | `style: format code with prettier`            |

**When multiple files are changed**:

- Focus on the primary change, don't list every file
- Use a general description (e.g., "update auth module" instead of "update login.ts and logout.ts and session.ts")

### Step 5: Execute git commit

After generating the title, commit automatically:

```bash
git commit -m "<generated commit title>"
```

**If commit succeeds**, go to Step 6.

**If commit fails** (pre-commit hook error), enter **Step 5a: Auto-fix flow**.

### Step 5a: Pre-commit hook failure auto-fix

When `git commit` fails due to a pre-commit hook, **do NOT add `--no-verify`**. Instead, attempt to auto-fix.

#### 5a.1 Parse error output

Analyze the hook's error output and identify the error type:

| Error Type          | Identification                                    | Fix Strategy                                        |
| ------------------- | ------------------------------------------------- | --------------------------------------------------- |
| **Type Check**      | `tsc`, `TS2322`, `TS2345` or other TS error codes | Read the file, analyze type mismatch, fix with Edit |
| **ESLint**          | `eslint`, rule names like `no-unused-vars`        | Run `npx eslint --fix <files>`                      |
| **Prettier/Format** | `prettier`, `formatting`                          | Run `npx prettier --write <files>`                  |
| **Other**           | Unclassifiable errors                             | Read error info, locate file and line, attempt fix  |

#### 5a.2 Execute fix

Based on the error type, perform the appropriate fix:

1. **Read the failing file**: Use Read tool to view the context around the error
2. **Analyze root cause**: Understand why it fails (type mismatch, unused variable, formatting, etc.)
3. **Fix the code**:
   - Simple issues (lint/format) → Run auto-fix commands via Bash
   - Complex issues (type errors) → Use Edit tool to precisely modify code
4. **Re-stage**: `git add <fixed files>`
5. **Re-commit**: `git commit -m "<same commit title>"` (without `--no-verify`)

#### 5a.3 Retry limit

- Maximum **2 retries** (i.e., initial commit fails → fix → 1st retry → if fails again → fix → 2nd retry)
- If the fix produces an empty diff (fix had no actual effect), **skip pointless retries** and go to fallback

#### 5a.4 Fallback flow (both retries failed)

Show detailed remaining errors, then use `AskUserQuestion` to ask the user.

Provide 3 options:

1. **Manual fix** — Show full error list and stop, let user handle it
2. **Skip hook and force commit** — Use `git commit --no-verify -m "<title>"` (only when user explicitly chooses)
3. **Cancel commit** — Abort the commit, keep files staged

### Step 6: Output result

Output the commit result:

```
Commit successful

<type>: <description>

[branch-name abc1234] <type>: <description>
 3 files changed, 150 insertions(+), 20 deletions(-)
```

If the auto-fix flow was triggered, also output a fix summary:

```
Auto-fixed pre-commit hook errors (succeeded on retry N):
- <file1>: <fix description>
- <file2>: <fix description>
```

## Vocabulary Guide

**Recommended verbs**:

| Verb     | Use case                              |
| -------- | ------------------------------------- |
| add      | New files, features, dependencies     |
| fix      | Bug fixes, errors                     |
| update   | Update existing features, configs     |
| remove   | Delete files, code, features          |
| refactor | Restructure code (no behavior change) |
| rename   | Rename files, variables, functions    |
| move     | Move file locations                   |
| improve  | Improve performance, readability      |
| simplify | Simplify code logic                   |
| support  | Add support for a feature             |
| handle   | Handle a case or error                |
| replace  | Replace an implementation             |

**Avoid**:

- Overly complex words (e.g., use "add" instead of "implement")
- Vague descriptions (e.g., "some changes", "minor updates")
- Abbreviations (unless universally understood like API, URL, ID)

## Special Scenarios

### Scenario 1: Mixed change types

If changes span multiple types, choose the **primary change** type. Priority:

```
feat > fix > refactor > perf > docs > style > test > chore
```

### Scenario 2: Unclear change purpose

If the purpose cannot be clearly determined from the code changes, use the most conservative type:

- New files present → `feat`
- Only existing files modified → `refactor` or `chore`

### Scenario 3: Large number of files changed

When more than 10 files are modified:

- Try to find a common theme (e.g., "update all api endpoints")
- If no common theme, use "refactor: update multiple modules"

## Error Handling

| Problem                 | Action                                                       |
| ----------------------- | ------------------------------------------------------------ |
| Not in a git repository | Show "Current directory is not a git repository"             |
| No staged files         | Show commands for staging files                              |
| Git command fails       | Display the original error message                           |
| Pre-commit hook fails   | Enter auto-fix flow (Step 5a), ask user after 2 retries fail |
| Hook timeout            | Treat as failure, enter fallback flow                        |
