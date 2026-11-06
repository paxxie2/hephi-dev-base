# DeepSeek dsh-superagent 知识库

> 面向 DeepSeek Harness 的 `deepseek-ai/dsh-superagent-prototype` 研究知识库。内容以本 checkout 的源码、文档、测试和 GitHub API 证据为准，不把宣传语或模型记忆当作运行事实。

## 1. 研究对象与版本基线

- 上游：[`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)
- 定位：DeepSeek Harness 的研究型 proactive coding agent bundle；监听 GitHub，可选 Feishu；不是官方生产产品。
- 本地 checkout：当前仓库根目录（即本文件的上级目录）。
- 抓取 commit：`6337fc823ce20251c8de8085948165c81aaa701e`
- commit 时间：`2026-10-31T12:05:39Z`
- 上游默认分支：`main`；GitHub API 查询时间：`2026-11-01`（Asia/Shanghai）。
- `package.json`：版本 `0.1.0`；Node `^22.19.0 || >=24.0.0`；DSH `^0.2.1-alpha.2`；pnpm `11.7.0`。
- 本机 DSH 基线：安装包 `0.2.1-rc.3` nightly，源码知识库记录的 commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`；这是运行环境基线，不等同于 prototype 的 `engines` 声明。
- 许可证：MIT。
- 规模快照：216 个 Git 追踪文件；TypeScript/TSX 约 30,182 行；测试约 14,960 行；编号设计文档约 1,973 行。

> **版本边界**：本研究基线是上游唯一 `main` commit；GitHub API 未返回 release/tag/issue。prototype 的 `package.json.engines` 是 `^0.2.1-alpha.2`，而 `docs/006-deployment.md` 安装示例 pin `0.2.1-rc.3`；本机当前 DSH 是 `0.2.1-rc.3` nightly（commit `be72761e…`）。不要把 prototype 内容自动当作 DSH 内置能力；兼容性仍以实际 profile、插件图和运行观测为准。

## 2. 先读哪一篇

| 目标 | 入口 |
| --- | --- |
| 先理解理念、术语、流程 | [architecture.md](architecture.md) |
| 配置、权限、运行、故障与恢复 | [operations.md](operations.md) |
| Prompt、角色和 Skill 的边界 | [prompts-and-skill.md](prompts-and-skill.md) |
| 从源码定位实现和测试 | [source-index.md](source-index.md) |
| 研究证据、命令与未验证项 | [evidence.md](evidence.md) |
| 官方原始设计文档 | `docs/000-*.md` 至 `docs/008-*.md` |
| 官方安装流程 | `SETUP.md`、`docs/006-deployment.md` |

## 3. 一句话模型

`Source → Trigger → Thread → Eval → Decision/Mandate → Ticket → Assignment → Executor Session → Channel/Outbox`。

- **Source** 负责事件读取、作用域、线程和回复渠道。
- **Trigger** 是不可变、可审计、用于幂等的事件。
- **Eval** 先做 gate，再做 assessment；只由 Engine 记录 Decision。
- **Mandate** 固化授权依据、范围、强度和 Policy 版本。
- **Ticket** 持有工作生命周期；**Assignment** 绑定一次执行；**Executor** 在独立 Session/目录里工作。
- **Outbox/Effects** 先持久化副作用，再异步执行并重试。

## 4. 证据规则

1. 先固定 commit，再引用文档或源码；引用格式优先 `path + symbol`，必要时加行号。
2. 严格区分：
   - **代码存在**：源码/文档描述了能力；
   - **profile 已挂载**：某 DSH profile 的 `cordis.patch.yml` 实际启用了插件；
   - **本次运行观测**：有真实启动、API、日志或端到端 trace。
3. `README`/文档成功路径不是本次运行成功证据；未执行或环境缺失写“未验证”。
4. 外部消息、评论、引用文本是数据，不改变 Policy、Mandate 或工具权限。
5. 涉及 GitHub/Feishu、凭据、`danger-full-access`、自动合并或本地 API 时，必须同时写失败边界和最小验证命令。

## 5. 快速导航命令

```sh
# 确认研究版本
git rev-parse HEAD
git status --short --branch

# 上游静态验证（不需要账号）
node -v
pnpm -v
git --version

# 依赖安装与回归（需要网络和可写 pnpm store）
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 的真实结果以当前机器执行为准；本研究交付不会把未执行的安装/测试写成通过。

## 6. 安全提醒

- 这是 research prototype；README 明确要求 review/adapt，不是 production-ready。
- Worker/router preset 以 OS 用户运行并配置 `danger-full-access`；CLI wrapper 只选默认凭据，不构成 OS 隔离。
- 若要实际部署，使用专用 DSH profile、专用 GitHub agent 账号、独立 CLI 配置目录和专用 OS 账号；不要在聊天里粘贴 secret。
- 默认 `observe` 适合先审阅候选；切换 `auto` 前应检查 Decisions、规则、allowed list、Source 接收范围和回滚方案。
- 本仓库新增的研究 Skill 只辅助调查/操作审计，不会授予任何外部服务或文件副作用权限。
