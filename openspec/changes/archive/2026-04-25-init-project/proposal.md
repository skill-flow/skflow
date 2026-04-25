## Why

Claude Code 的 slash command 和 skill 是纯 markdown prompt：每一步（跑 `git diff`、解析输出、格式化结果）都经过 LLM，导致高 token 消耗、非确定性、和 30-60 秒的延迟。已验证的解法是把确定性操作抽到脚本里，只在需要判断时才回 LLM——cmdx 把这个模式系统化。

## What Changes

- **新增 `@ocmdx/cli` 包**：提供 `cmdx run`、`cmdx resume`、`cmdx migrate`、`cmdx sessions` 命令
- **新增 `@ocmdx/runtime` 包**：脚本 import 的运行时库，提供 `sh()`、`ask()`、`askUser()`、`done()` 函数
- **新增 `@ocmdx/transform` 包**：TypeScript AST 变换器，把自然的 async/await 脚本编译成可恢复的状态机
- **定义 yield/resume 协议**：CLI 通过 stdout JSON 与 Claude Code 通信，`sh()` 自动续转并记录 I/O，`ask()`/`askUser()` 暂停等待 CC 回答
- **改写 command.md**：原 230 行散文 → ~10 行壳 + 可读的 `.ts` 脚本

## Capabilities

### New Capabilities

- `cli`: CLI 入口，子命令路由（run/resume/migrate/sessions），session 生命周期管理
- `runtime`: 脚本运行时库 —— `sh()`（执行 shell 命令并记录 I/O）、`ask()`（yield 给 LLM）、`askUser()`（yield 给用户）、`done()`（结束脚本）
- `transform`: Regenerator 风格的 AST 变换 —— 变量提升（hoist）、控制流爆炸（explode）、状态机生成（emit），支持 if/else、while/for、顶层 await
- `yield-protocol`: CLI ↔ CC 的 JSON 通信协议 —— yield/done/error 三种消息，session 持久化，answer 传参（直传 vs 文件）

### Modified Capabilities

（无，新项目）

## Impact

- **新增 npm monorepo**：3 个包（`@ocmdx/cli`、`@ocmdx/runtime`、`@ocmdx/transform`）
- **依赖**：TypeScript Compiler API（transform）、Node.js child_process（runtime sh）
- **文件系统**：session 数据写入 `/tmp/cmdx/sessions/`（TTL 15 分钟）
- **CC 集成**：改写后的 `.md` 壳文件需要 CC 识别 yield JSON 并按协议 resume
