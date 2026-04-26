---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git commit:*), Bash(git add:*), Bash(npx eslint:*), Bash(npx prettier:*), Bash(npx tsc:*), Read, Edit, Grep
---

# commit

检查 git 工作区中已 staged 的文件，根据修改内容自动生成不超过 80 字符的英文提交标题并自动提交。

**硬规则：禁止自动使用 `--no-verify`。** 任何情况下 commit skill 不得自行添加 `--no-verify` 绕过 pre-commit hook。只有用户明确选择时才可使用。

## 使用方法

```bash
/commit
```

## 执行流程

### 步骤 1：检查 staged 文件

执行以下命令查看已暂存的文件：

```bash
git diff --cached --name-status
```

**如果没有 staged 文件**，输出提示并结束：

```
没有已暂存的文件。

请先使用 git add 添加要提交的文件：
  git add <file>        # 添加指定文件
  git add .             # 添加所有修改
  git add -p            # 交互式添加
```

### 步骤 2：获取变更详情

获取 staged 文件的具体修改内容：

```bash
git diff --cached --stat
git diff --cached
```

### 步骤 3：分析变更类型

根据修改内容判断变更类型：

| Type       | 判断条件                                 |
| ---------- | ---------------------------------------- |
| `feat`     | 新增文件、新增功能函数/组件/模块         |
| `fix`      | 修复 bug、修正错误逻辑                   |
| `refactor` | 重命名、移动文件、重构代码（无功能变更） |
| `perf`     | 性能优化相关修改                         |
| `docs`     | 仅修改文档文件（.md、注释等）            |
| `style`    | 代码格式化、空格、缩进等（无功能变更）   |
| `test`     | 添加或修改测试代码                       |
| `chore`    | 构建配置、依赖更新、CI/CD 相关           |

### 步骤 4：生成提交标题

**格式**：

```
<type>: <description>
```

**规则**：

1. **总长度不超过 80 字符**
2. **使用英文**
3. **使用简单易懂的词汇和语法**
4. **动词使用原形**（add, fix, update, remove, refactor）
5. **不要以句号结尾**
6. **小写开头**（type 后的描述部分）

**示例**：

| 变更内容         | 生成标题                                      |
| ---------------- | --------------------------------------------- |
| 新增用户登录组件 | `feat: add user login component`              |
| 修复空指针异常   | `fix: handle null pointer in payment service` |
| 重命名变量       | `refactor: rename userId to accountId`        |
| 更新 README      | `docs: update installation guide`             |
| 添加单元测试     | `test: add unit tests for auth module`        |
| 升级依赖版本     | `chore: upgrade react to v18.2`               |
| 优化查询性能     | `perf: optimize database query in search`     |
| 格式化代码       | `style: format code with prettier`            |

**多文件变更时**：

- 聚焦主要变更，不要罗列所有文件
- 使用概括性描述（如 "update auth module" 而不是 "update login.ts and logout.ts and session.ts"）

### 步骤 5：执行 git commit

生成标题后，自动执行提交：

```bash
git commit -m "<生成的提交标题>"
```

**如果提交成功**，跳到步骤 6。

**如果提交失败**（pre-commit hook 报错），进入 **步骤 5a：自动修复流程**。

### 步骤 5a：Pre-commit Hook 失败自动修复

当 `git commit` 因 pre-commit hook 失败时，**不得添加 `--no-verify`**，而是尝试自动修复。

#### 5a.1 解析错误输出

分析 hook 的错误输出，识别错误类型：

| 错误类型            | 识别特征                                       | 修复策略                                           |
| ------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **Type Check**      | `tsc`、`TS2322`、`TS2345` 等 TypeScript 错误码 | 读取报错文件，分析类型不匹配原因，用 Edit 修改代码 |
| **ESLint**          | `eslint`、规则名如 `no-unused-vars`            | 执行 `npx eslint --fix <files>`                    |
| **Prettier/Format** | `prettier`、`formatting`                       | 执行 `npx prettier --write <files>`                |
| **其他**            | 无法归类的错误                                 | 读取报错信息，尝试定位文件和行号进行修复           |

#### 5a.2 执行修复

根据错误类型执行对应修复操作：

1. **读取报错文件**：用 Read 工具查看报错位置的上下文
2. **分析问题根因**：理解为什么会报错（类型不匹配、未使用变量、格式问题等）
3. **修复代码**：
   - 简单问题（lint/format）→ 用 Bash 执行自动修复命令
   - 复杂问题（类型错误）→ 用 Edit 工具精确修改代码
4. **重新 stage**：`git add <修复的文件>`
5. **重新 commit**：`git commit -m "<同一个提交标题>"`（不加 `--no-verify`）

#### 5a.3 重试限制

- 最多重试 **2 次**（即：首次 commit 失败 → 修复 → 第 1 次重试 → 若再失败 → 修复 → 第 2 次重试）
- 如果修复后 diff 为空（修复没有实际效果），**不做无意义重试**，直接进入降级流程

#### 5a.4 降级流程（2 次重试都失败）

展示剩余错误的详细信息，然后用 `AskUserQuestion` 询问用户：

提供 3 个选项：

1. **用户手动修复** — 展示完整错误列表后停止，用户自行处理
2. **跳过 hook 强制提交** — 使用 `git commit --no-verify -m "<标题>"`（仅在用户明确选择时）
3. **取消提交** — 放弃本次提交，保留 staged 状态

### 步骤 6：输出结果

输出提交结果：

```
提交成功

<type>: <description>

[分支名 abc1234] <type>: <description>
 3 files changed, 150 insertions(+), 20 deletions(-)
```

如果经过了自动修复流程，额外输出修复摘要：

```
自动修复了 pre-commit hook 错误（第 N 次重试成功）：
- <file1>: <修复描述>
- <file2>: <修复描述>
```

## 词汇指南

**推荐使用的动词**：

| 动词     | 适用场景               |
| -------- | ---------------------- |
| add      | 新增文件、功能、依赖   |
| fix      | 修复 bug、错误         |
| update   | 更新现有功能、配置     |
| remove   | 删除文件、代码、功能   |
| refactor | 重构代码（无功能变更） |
| rename   | 重命名文件、变量、函数 |
| move     | 移动文件位置           |
| improve  | 改进性能、可读性       |
| simplify | 简化代码逻辑           |
| support  | 添加对某功能的支持     |
| handle   | 处理某种情况、错误     |
| replace  | 替换实现方式           |

**避免使用的词汇**：

- 过于复杂的单词（如 implement → 用 add）
- 模糊的描述（如 "some changes", "minor updates"）
- 缩写（除非是通用缩写如 API, URL, ID）

## 特殊场景处理

### 场景 1：混合多种类型的变更

如果同时包含多种类型的修改，选择**主要变更**的类型。优先级：

```
feat > fix > refactor > perf > docs > style > test > chore
```

### 场景 2：无法确定变更目的

如果从代码修改无法明确判断目的，使用最保守的类型：

- 有新文件 → `feat`
- 只修改现有文件 → `refactor` 或 `chore`

### 场景 3：大量文件变更

当修改文件超过 10 个时：

- 尝试找出共同主题（如 "update all api endpoints"）
- 如果无共同主题，使用 "refactor: update multiple modules"

## 错误处理

| 问题                 | 操作                                                 |
| -------------------- | ---------------------------------------------------- |
| 不在 git 仓库中      | 提示 "当前目录不是 git 仓库"                         |
| 没有 staged 文件     | 提示添加文件的命令                                   |
| git 命令执行失败     | 显示原始错误信息                                     |
| pre-commit hook 失败 | 进入自动修复流程（步骤 5a），最多重试 2 次后询问用户 |
| hook 超时            | 按失败处理，进入降级流程                             |
