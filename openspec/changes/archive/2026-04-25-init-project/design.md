## Context

Claude Code 的 slash command（如 `/commit`）是纯 prompt markdown，每步操作都经过 LLM。cmdx 将确定性操作抽到 TypeScript 脚本，只在需要判断时 yield 回 CC。

项目从零开始，Node.js monorepo，三个包：`@ocmdx/cli`、`@ocmdx/runtime`、`@ocmdx/transform`。

核心样本是 `commit.md`（230 行），目标是迁移成 ~10 行壳 + 可读的 `commit.ts`。

## Goals / Non-Goals

**Goals:**

- 把 `.claude/commands/*.md` 转成脚本驱动的形态，减少 80%+ 的 LLM token 消耗
- 提供自然的 async/await 编程模型，编译时自动转为可恢复状态机
- 所有外部调用（shell 命令、LLM 问答、用户交互）全量记录 I/O
- 用 `/commit` 作为北极星，端到端跑通 migrate → compile → run → resume

**Non-Goals:**

- 自动蒸馏（从对话记录自动生成脚本）—— 属于 evolve-agent
- 失败驱动自动修脚本 —— 属于 evolve-agent
- MCP server 集成
- 长跑后台 daemon
- Skill 转换（skill 是 model-invoked，语义不同）
- try/catch 跨 yield（MVP 不支持）
- 嵌套函数内 yield（强制顶层）

## Decisions

### D1: 控制流归脚本，command.md 只是壳

脚本自驱整个流程，`.md` 只告诉 CC "跑 `cmdx run <name>` 并按 yield 协议驱动对话"。

**替代方案**：command.md 多次调用 CLI 子命令（混合式）。
**否决理由**：md 膨胀、脚本作者需要在两个文件间跳转、未来演化要改两处。

### D2: Regenerator 风格的编译时状态机

作者写 `await ask(...)` 的自然代码，`@ocmdx/transform` 在编译时用 AST 变换把 await 点转成 `switch(state.phase)` 状态机。参考 facebook/regenerator 的架构：

```
hoist.ts  — 变量声明提升到 state 对象
explode.ts — 语句/表达式递归展开，遇 yield 点插入 mark
emit.ts   — 生成 while(1) switch(phase) 调度循环
leap.ts   — 控制流跳转表（loop break/continue 位置）
```

**替代方案 A**：运行时挂起（子进程 + stdin 管道）。
**否决理由**：孤儿进程管理、Windows 兼容性、TTL 复杂度。

**替代方案 B**：作者自己写显式 phase switch。
**否决理由**：破坏可读性，脚本变得不自然。

**MVP 支持的语法**：

- 顶层 `await ask()` / `await askUser()` / `await sh()`
- 局部变量（自动 lift 到 state）
- if / else
- while / for（含 yield）

### D3: sh() 是状态机 yield 点，但 runtime 自动续转

所有外部调用（`sh()`、`ask()`、`askUser()`）在编译后都是状态机的切分点。区别在于 runtime 的行为：

```
sh()      → runtime 自动执行 shell 命令，记录 I/O，推进 phase，不退出进程
ask()     → runtime 保存 state，输出 yield JSON，退出进程，等 CC resume
askUser() → 同 ask()，但 CC 应调用 AskUserQuestion 而非自己回答
```

单次 `cmdx run` 调用的 stdout：

```json
{
  "log": [
    {"type":"sh", "cmd":"git diff --cached", "code":0, "stdout":"..."},
    {"type":"sh", "cmd":"git diff --cached --stat", "code":0, "stdout":"..."}
  ],
  "yield": {"prompt":"Generate commit title", "data":{...}},
  "session": "abc123",
  "resume": "cmdx resume abc123"
}
```

**好处**：全量 I/O 记录、crash recovery（每个 sh 前保存 state）、CC 能看到执行过程。

### D4: 全 Node.js，不用 Deno

CLI、runtime、transform 全部跑在 Node.js 上。

**替代方案**：Deno 沙箱 + `--allow-*` 权限。
**否决理由**：用户机器要额外装 Deno，npm 包和 Deno 之间有生态张力。Node 20+ 的 `--experimental-permission` 可以在未来按需引入。

### D5: TypeScript Compiler API 做 AST 变换

用 `ts.createSourceFile` + `ts.transform` + `ts.createPrinter` 做变换，不引入 Babel。

**理由**：源文件是 `.ts`，TS Compiler API 原生支持，不需要额外转译层。

### D6: answer 传参——直传 vs 文件，由 CC 判断

```bash
# 短答案（< 200 字符，无换行）
cmdx resume <id> --answer="feat: add login"

# 长答案
cmdx resume <id> --answer-file=/tmp/cmdx/sessions/<id>/answer.txt
```

壳 prompt 里说明规则，让 LLM 自行判断用哪种。

### D7: Session 放 /tmp，TTL 15 分钟

`/tmp/cmdx/sessions/<session-id>/` 下存 `state.json`（当前 phase + 变量）和 `meta.json`（创建时间、脚本路径）和 `log.json`（I/O 记录）。系统重启自动清理。

### D8: migrate 前依赖 git clean

`cmdx migrate` 覆盖写 `.md` 前检查 working tree 是否 clean，否则拒绝。不写 `.bak` 文件。

### D9: 渐进试点策略

1. 先造 `/hello` 玩具 command 验证管道（run → yield → resume → done）
2. 再挑一个简单的真 command 迁移
3. 最后硬啃 `/commit`（带循环、重试、askUser 降级）

## Risks / Trade-offs

**[AST Transform 边界情况]** → while + 多个 yield 嵌套在 if 里容易状态爆炸。Mitigation: 大量 fixture 测试，参考 regenerator 的 test suite 覆盖模式。

**[LLM 蒸馏 .md → .ts 质量]** → migrate 生成的 .ts 可能需要手调。Mitigation: 用户可以直接编辑 .ts，migrate 只是起手加速。

**[Windows 路径]** → `/tmp` 在 Windows 上不存在。Mitigation: 用 `os.tmpdir()` 替代硬编码路径。

**[大 answer 传参]** → 依赖 LLM 判断直传 vs 文件，可能判断错。Mitigation: CLI 端也做检测——如果 `--answer` 超过 OS 命令行限制则报错并提示用 `--answer-file`。

**[状态机 vs 原始代码调试]** → 编译后的代码难以 debug。Mitigation: 编译输出保留注释标注原始行号；用户一般不需要看 `.compiled.ts`。
