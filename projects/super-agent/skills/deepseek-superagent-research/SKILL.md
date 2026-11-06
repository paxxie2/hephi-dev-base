---
name: deepseek-superagent-research
description: Research, explain, audit, configure, or extend DeepSeek's dsh-superagent research prototype with evidence-first DSH workflows.
whenToUse: Use when the user asks about dsh-superagent, dsh-superagent-prototype, DeepSeek super agent, its GitHub/Feishu sources, setup, authorization, worker lifecycle, prompts, panel, source extension, or related GitHub research.
---

# DeepSeek dsh-superagent 研究与运维 Skill

## 0. 触发与不触发

触发：`dsh-superagent`、`dsh-superagent-prototype`、DeepSeek super agent、该仓库的 GitHub/Feishu 接入、Source/Trigger/Eval/Ticket/Assignment/Executor、部署、故障、Prompt、panel、Source 扩展或源码调研。

不触发：泛化的 DSH 能力问题（先用 `dsh-source-kb`）、普通 GitHub/Feishu 操作、没有该 prototype 语境的通用 Agent 设计。

## 1. 先加载本地知识库

本仓库内先读：

1. `knowledge-base/README.md`（版本、入口、证据规则）；
2. 按问题选读 `architecture.md`、`operations.md`、`prompts-and-skill.md`、`source-index.md`、`evidence.md`；
3. 再读上游 `docs/`、`src/`、`tests/` 的最小相关范围。

如果当前 workspace 找不到这些文件，明确写“本地研究知识库不可达”，不要用模型记忆补全 DSH 行为。

## 2. 版本与证据纪律

- 固定 upstream commit；本知识库基线为 `6337fc823ce20251c8de8085948165c81aaa701e`。
- 区分版本：prototype `package.json.engines` 为 DSH `^0.2.1-alpha.2`，部署文档示例 pin `0.2.1-rc.3`；本机 DSH 基线是 `0.2.1-rc.3` nightly / commit `be72761e…`。不要混称。
- 每个关键结论给 `path + symbol/line`；必要时给 GitHub commit URL。
- 分开写：
  - **代码存在**：源码/文档证明实现或设计；
  - **profile 已挂载**：实际 profile `cordis.patch.yml`/plugin graph 证明启用；
  - **本次运行观测**：真实命令、HTTP、日志或 trace 证明运行。
- 单元测试、fake CLI、fixture、temporary SQLite 只证明机制，不得说成真实服务联调。
- 没有运行证据就写“未验证”；不要把 README 成功路径写成已部署。

## 3. 概念主链

用唯一主链回答，不另造第二套状态：

`Source → Trigger → Thread → Eval(gate + assessment) → Decision/Mandate → Ticket → Assignment → Executor Session/directory → Report/Channel`。

牢记：订阅 fan-out 是上下文，不是新授权；Context-only subscription 不拥有 follow-up；Mandate 记录 Policy version；Engine 是 domain aggregate 的唯一 writer；Outbox 是 receipts 的唯一 writer；Effects 先 durable 再执行。

## 4. 只读研究流程

1. 固定 commit、package.json engines/scripts、当前 DSH 版本。
2. 顺读 `docs/000`、`001`、`002`、`003`、`007`；再定位 `src/core`、`src/app/runtime.ts`、`src/executor/dsh.ts`、`src/sources/*`。
3. 用对应 `tests/*.spec.ts` 复核机制；记录使用 fake/fixture。
4. 对部署问题读取 `SETUP.md` 和 `docs/006-deployment.md`；对 Prompt/Skill 读取 `docs/004-prompts.md` 和 `prompts/`。
5. 输出：结论 → 证据 → 实际流程 → 失败边界 → 验证方法 → 未验证项。

默认不执行文档中的安装、登录、API 写入、启动、auto-merge、push、reply 或 profile 修改命令。用户明确授权后也必须先说明副作用、目标路径、凭据边界、回滚点和验证命令。

## 5. 安全 setup 流程

严格遵守 `SETUP.md`：

- 先只读 SETUP + philosophy，并只跑一次 probe；
- 一次只问一个问题：Source、repository、agent account、allowed list、checkout、commit identity、auto-merge；
- 收齐答案后发送一份完整 plan，等待 operator 确认，之后才执行；
- secret、账户创建、CLI 登录由 operator 在自己的终端完成，不在聊天中索取；
- 默认专用 DSH profile、专用 GitHub agent account、bot-only Feishu CLI、`observe`；
- 不要对已有 profile 运行 `dsh superagent --from-default-profile`，它可能覆盖 `cordis.patch.yml`；
- 用 `scripts/dsh-superagent status` 验证，并保存 exit code/日志/时间。

## 6. 运行与故障审计

必须检查：

- `danger-full-access` 是否以 operator OS user 运行；说明 wrapper/blockedCommands 不是隔离边界，basename shim 可被绝对路径绕过；
- GitHub repository 切换时是否持久化并校验 Trigger/Thread/Channel 的 repository；当前代码对旧 Ticket、同号 Issue/PR、pending reply 的路由风险标为未验证；
- Management API 的 loopback + header 只是传输边界，不是 OS 用户授权；panel API 可改执行环境/setup 字段；
- allowed list、bot list、admission、accept mode、Source scope 是否一致；
- prepare command、worker directory、GitHub/Feishu CLI 是否包含凭据或个人配置；
- effect/outbox retry、idempotency marker、ordered delivery、restart recovery；
- stateDir lock、SQLite backup、schema migration、无 retention；升级文档的 `git pull` 未要求 frozen lockfile/commit 签名/来源核验，需标 supply-chain/rollback 风险；
- Feishu `backfillLoop` rejection 是否被 health 捕获（当前知识库标记为未验证）。

不要因为 `status` 0 就宣称业务端到端通过：还需核对 Source 事件、Trigger disposition、Decision、Ticket/Assignment、worker report、Channel receipt。

## 7. 真实验证模板

```text
版本：upstream commit / DSH 版本 / profile
命令或请求：完整命令、URL、关键 header（不含 secret）
时间：时区
结果：exit code、HTTP status、日志/trace 摘要
链路：Source → Trigger → Eval → Ticket → Assignment → Channel
证据类型：静态 / profile 挂载 / 运行观测
限制：fake、未安装依赖、缺账号、未测远端等
```

## 8. Source 扩展检查单

参考 `docs/008-cookbook.md`：稳定 Trigger/Thread/Channel IDs；Source-owned meta；scope/admission rows；Channel idempotency key；bounded thread context；环境变量不含 credential；cursor 在所有 Trigger durable 后推进；逐项 schema 校验；health entries 由唯一 writer claim；AbortSignal 贯穿 loop；禁用/启用写入 `cordis.patch.yml` 并补 module/test index。

## 9. 交付边界

这个 Skill 只提供研究和安全操作指引，不自动：

- 安装 dsh、登录 GitHub/Feishu、读写 secrets；
- 启用 profile/plugin、启动服务、发送评论/回复、push/merge/auto-merge；
- 证明真实 DSH/provider/remote API 已运行。

若用户要实际部署，应把每个副作用拆成可确认的最小步骤，保留 backup/stop/retry/rollback 入口，并在最终报告列出实际改动文件、Git 分支状态、真实验证命令、未执行项目和已知限制。
