---
name: skflow-transform
description: Transform verbose markdown skills/commands into deterministic skflow scripts. Analyzes each step, classifies it as a shell command (sh), LLM judgment (ask), user interaction (askUser), or terminal state (done), then generates a compiled state-machine script that only yields to the LLM when judgment is needed.
---

# skflow-transform

Transform a verbose markdown skill into a deterministic skflow script. The generated script runs shell commands automatically and only pauses for LLM judgment or user input — reducing token usage and improving reliability.

## When to Use

Use this skill when you have a markdown skill/command (`.md` file) that walks the LLM through a series of steps, many of which are deterministic (running shell commands, checking output, branching on exit codes). This skill rewrites it into:

1. A TypeScript script using skflow primitives (`sh`, `ask`, `askUser`, `done`)
2. A thin markdown wrapper that delegates to the compiled script via the yield protocol

## Input

The user provides a path to an existing markdown skill file. For example:

```
/skflow-transform .claude/commands/commit.md
```

## Step 1: Read and Analyze the Original Skill

Read the entire markdown file. Identify every step or instruction in the skill and classify it:

| Pattern in Markdown                                                                                         | skflow Primitive        | Meaning                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| "Run `<command>`", "Execute `<command>`", bash code blocks with specific commands                           | `sh(cmd)`               | Deterministic shell command — runs automatically |
| "Analyze the output", "Generate a message", "Decide which type", tables of rules/criteria for LLM to follow | `ask({ prompt, data })` | Requires LLM judgment — script pauses and yields |
| "Ask the user", "Let the user choose", interactive prompts with options                                     | `askUser({ question })` | Requires human input — script pauses and yields  |
| "Output the result", "Report success", end of workflow                                                      | `done({ summary })`     | Terminal state — script finishes                 |

### Classification Principles

- **If a step can run without LLM reasoning, it's `sh()`.** This includes: running git/npm/shell commands, checking exit codes, reading file contents via shell.
- **If a step requires understanding, generation, or decision-making, it's `ask()`.** The original markdown's rules, tables, examples, and guidelines become the `prompt` parameter of the `ask()` call. Do NOT discard this context — compress it into the prompt.
- **If a step needs the human user to make a choice, it's `askUser()`.** This is distinct from `ask()` which asks the LLM.
- **Control flow (if/else, loops, retries) maps directly to TypeScript.** Use `if`, `while`, `for` as needed.

## Step 2: Generate script.ts

Create `.skflow/skills/<name>/script.ts` with this structure:

```typescript
import { sh, ask, askUser, done } from "@skflow/runtime";

export async function main() {
  // ... steps using sh(), ask(), askUser(), done()
}
```

### Rules for Generation

1. **Preserve ALL original logic.** Every branch, edge case, retry, and error handling path in the original skill MUST be represented in the script.
2. **Compress context into `ask()` prompts.** Tables of rules, formatting guidelines, vocabulary lists, examples — all of this becomes part of the `prompt` string in `ask()` calls. The LLM receiving this prompt needs enough context to make the same decisions the original skill described.
3. **Use `data` parameter to pass runtime values.** Shell command outputs, file contents, error messages — pass them via `ask({ prompt: "...", data: { ... } })` so the LLM has the actual data to work with.
4. **Use `sh()` options when needed:**
   - `await sh("command", { stdin: value })` — pipe stdin to the command
   - `await sh("command", { timeout: 30000 })` — set timeout in milliseconds
5. **`sh()` returns `{ stdout, stderr, code }`.** Use `result.code` to check exit status, `result.stdout` for output.
6. **The function MUST return `done()`.** Every code path must end with `return done({ summary: "..." })` or `return done({ summary: "...", data: { ... } })`.
7. **No try/catch around `sh()` or `ask()` calls.** The skflow compiler does not support try/catch around yield points.

## Step 3: Move the Original and Generate Thin Wrapper

1. **Move** the original `.md` to `.skflow/skills/<name>/origin.md` as backup
2. **Replace** the original `.md` location with a thin wrapper:

```markdown
---
description: <original skill's description>
allowed-tools: Bash(skflow *)
---

# <name>

Run the skflow <name> script and handle the yield protocol.

1. Run `skflow run <name>` and parse the JSON output
2. If yield with type "text": generate the requested answer based on the prompt and data, then `skflow resume <session> --answer="<answer>"`
3. If yield with type "ask-user": present the question to the user with AskUserQuestion, then `skflow resume <session> --answer="<user's answer>"`
4. If done: report the summary
5. On error: report the error message
```

## Step 4: Compile

Run:

```bash
npx @skflow/cli compile <name>
```

This reads `.skflow/skills/<name>/script.ts` and produces `.skflow/skills/<name>/script.compiled.js`.

If compilation fails, read the error messages and fix `script.ts` accordingly. Common issues:

- `try/catch` around `sh()` or `ask()` calls → remove try/catch, use `result.code` to check errors
- Missing `return done()` on a code path → add the missing return

## Complete Example

### Input: `commit.md` (original verbose skill)

```markdown
---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git commit:*), Bash(git add:*), Bash(npx eslint:*), Bash(npx prettier:*), Bash(npx tsc:*), Read, Edit, Grep
---

# commit

检查 git 工作区中已 staged 的文件，根据修改内容自动生成不超过 80 字符的英文提交标题并自动提交。

**硬规则：禁止自动使用 `--no-verify`。** 任何情况下 commit skill 不得自行添加 `--no-verify` 绕过 pre-commit hook。只有用户明确选择时才可使用。

## 使用方法

/commit

## 执行流程

### 步骤 1：检查 staged 文件

执行以下命令查看已暂存的文件：

git diff --cached --name-status

**如果没有 staged 文件**，输出提示并结束。

### 步骤 2：获取变更详情

git diff --cached --stat
git diff --cached

### 步骤 3：分析变更类型

根据修改内容判断变更类型：

| Type     | 判断条件                                 |
| -------- | ---------------------------------------- |
| feat     | 新增文件、新增功能函数/组件/模块         |
| fix      | 修复 bug、修正错误逻辑                   |
| refactor | 重命名、移动文件、重构代码（无功能变更） |
| perf     | 性能优化相关修改                         |
| docs     | 仅修改文档文件（.md、注释等）            |
| style    | 代码格式化、空格、缩进等（无功能变更）   |
| test     | 添加或修改测试代码                       |
| chore    | 构建配置、依赖更新、CI/CD 相关           |

### 步骤 4：生成提交标题

格式: <type>: <description>

规则：

1. 总长度不超过 80 字符
2. 使用英文
3. 使用简单易懂的词汇和语法
4. 动词使用原形（add, fix, update, remove, refactor）
5. 不要以句号结尾
6. 小写开头（type 后的描述部分）

### 步骤 5：执行 git commit

git commit -m "<生成的提交标题>"

如果提交失败（pre-commit hook 报错），进入自动修复流程。

### 步骤 5a：Pre-commit Hook 失败自动修复

分析错误输出，修复代码问题，重新 stage，重试 commit。
最多重试 2 次，失败后询问用户（手动修复 / 跳过hook / 取消）。

### 步骤 6：输出结果
```

### Output: `.skflow/skills/commit/script.ts`

```typescript
import { sh, ask, done } from "@skflow/runtime";

export async function main() {
  // Step 1: Check staged files
  const staged = await sh("git diff --cached --name-status");
  if (!staged.stdout.trim()) {
    return done({ summary: "No staged files" });
  }

  // Step 2: Get diff details
  const stat = await sh("git diff --cached --stat");
  const diff = await sh("git diff --cached");

  // Step 3-4: Ask LLM to generate commit message
  const message = await ask({
    prompt:
      "Generate a commit message for the following changes.\n" +
      "Line 1: title in the format <type>: <description> (max 80 chars, lowercase, English, no period)\n" +
      "Line 2: blank\n" +
      "Line 3+: brief description of what changed (bullet points)\n\n" +
      "Types: feat (new feature/file), fix (bug fix), refactor (no behavior change), " +
      "perf (performance), docs (documentation only), style (formatting only), " +
      "test (test code), chore (build/deps/CI)\n\n" +
      "Use simple vocabulary. Verb in base form (add, fix, update, remove). No period at end.",
    data: { staged, stat, diff },
  });

  // Step 5: Execute git commit
  let lastResult = await sh("git commit -F -", { stdin: message });

  if (lastResult.code === 0) {
    return done({ summary: message.split("\n")[0], data: { commitResult: lastResult } });
  }

  // Step 5a: Pre-commit failed — yield to caller for fix, then retry
  while (true) {
    const fix = await ask({
      prompt:
        "Pre-commit hook failed with the following errors. " +
        "Please fix the issues, then resume.\n\n" +
        lastResult.stderr,
      data: { stderr: lastResult.stderr, stdout: lastResult.stdout },
    });

    const restage = await sh("git add -u");
    lastResult = await sh("git commit -F -", { stdin: message });

    if (lastResult.code === 0) {
      return done({ summary: message.split("\n")[0], data: { commitResult: lastResult } });
    }
  }
}
```

### Output: Thin wrapper replacing original `commit.md`

```markdown
---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(skflow *)
---

# commit

Run the skflow commit script and handle the yield protocol.

1. Run `skflow run commit` and parse the JSON output
2. If yield: generate a commit title based on the diff data, then `skflow resume <session> --answer="<title>"`
3. If yield (ask-user): present the question to the user with AskUserQuestion, then resume with their answer
4. If done: report the summary
5. On error: report the error message
```

### Key Transformation Decisions in This Example

| Original Step                                    | Classification | Why                                                                           |
| ------------------------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| `git diff --cached --name-status`                | `sh()`         | Deterministic command, no LLM needed                                          |
| `git diff --cached --stat`                       | `sh()`         | Deterministic command                                                         |
| `git diff --cached`                              | `sh()`         | Deterministic command                                                         |
| Analyze change type + generate title (Steps 3-4) | `ask()`        | Requires LLM judgment; type table and formatting rules compressed into prompt |
| `git commit -F -`                                | `sh()`         | Deterministic command                                                         |
| Fix pre-commit errors (Step 5a)                  | `ask()`        | Requires LLM to read errors, understand code, and fix issues                  |
| `git add -u`                                     | `sh()`         | Deterministic command                                                         |
| No staged files → report                         | `done()`       | Terminal state                                                                |
| Commit succeeded → report                        | `done()`       | Terminal state                                                                |
