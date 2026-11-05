# Topic Bench 接入（同一 Super Agent / 同一 HEPHI ready 门）

仓库：`paxxie2/topic-bench`。本地源库：`/Users/USER/Documents/deepseek-harness/default-workspace/topic-bench`。
知识库：该目录下 `kb/`，读取现有 `objects` 索引；Dubbo 原有 `records` 格式保留。

现有 prepare 入口按仓库选择 checkout、允许路径及测试命令。Topic Bench 的 GitHub Issue 无须额外贴 `hephi/delivery` 标签；非 GitHub 任务和 Dubbo 标签规则不变。

Node 验证只增加项目测试脚本和事件报告适配，复用现有 verifier、Runner、PR 检查与证据写入。
正向运行 `test/*.test.mjs`，反向在固定 base 的临时 worktree 中仅复制变更的顶层 `test/*.test.mjs`。
反向仅 Node 断言失败计为复现；运行错误、缺报告、跳过测试和没有变更测试均不能放行。
依赖新增生产 API、构建配置或额外测试辅助文件的反向测试可能被阻断，不自动降低验证标准。

工具按照当前合同选择 KB；查询记录绑定 Ticket、仓库、Issue、contractHash。
它强制 ready 前查询，不承诺强制修改前查询，也不把知识库当作测试证据。

## 已部署配置

同一 Super Agent GitHub 来源保留 `repository: paxxie2/dubbo`，增加：

```json
{"additionalRepositories":[{"repository":"paxxie2/topic-bench"}],"observeIssues":true,"allowSelfAuthoredIssues":true}
```

使用现有 `/Users/USER/.local/bin/gh-agent`，同一 prepare 入口、同一 Worker/ready 流程。
Super Agent 分支 `codex/multi-repository-github`，提交 `62d7d53`：附加仓库的线程、事件、游标带仓库前缀；原 Dubbo 历史键不迁移。
来源接收事件后仍由原策略判断是否执行，不绕过策略；本人以 `paxxie2` 创建 Issue 时，正文须包含 `@paxxie2` 和明确实施要求，沿用原自建 Issue 防循环规则。
知识库自动按合同仓库选择，ready 前缺失有效查询记录会拒绝。

## 校验

`pnpm check`：类型检查、74 个测试、构建通过。
新增本地夹具测试覆盖源码 KB 格式、仓库隔离、KB 必查、真实 Node 正反向和 ready 门。
这些是本地测试，不是线上真实 Issue E2E；监听配置和插件已加载；仓库目前没有真实 Issue，后续首个 Issue 的 Ticket、KB 查询和 ready 证据仍需实际观察。

## 本次部署核验记录

- Super Agent `62d7d53`，现有桌面实例加载后，管理 API 的 GitHub 健康状态为 `ready`：`Watching paxxie2/dubbo, paxxie2/topic-bench; next poll ≥ 60s`。
- 数据库已出现 `paxxie2/topic-bench:github-since`、`github-retry`、`github-stream:issues` 独立键。
- Super Agent `pnpm check`：59 个测试文件、1199 个测试、类型检查与构建通过；补充同号 PR 隔离断言后来源测试 73 项通过。
- 使用构建后的 `hephi_kb_search` 和实际 Topic Bench 源码/KB 做本地适配检查，查询 `normalizeDb` 命中 `data-model`、`tests-and-change-map`、`startup-and-sidebar`，查询记录仓库为 `paxxie2/topic-bench`。
- 上一项采用临时合同和模拟工具调用上下文，**不是**真实 Worker、真实 GitHub Issue 或完整交付验收。没有创建测试 Issue，没有宣称真实 Issue E2E 已通过。
