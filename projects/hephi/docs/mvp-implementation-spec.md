# Hephi Super Agent 控制面 MVP 实施规格

状态：Proposal

版本：v0.1

## 1. 目标

MVP 只解决一个问题：**启用赫菲的任务，在 Worker 报告 `ready` 前必须通过正确性交付验证；未启用的任务完全走 Super Agent 原流程。**

赫菲是可选控制面，不创建新的执行运行时，不拥有 Ticket、Worker、Session、队列或重试流程。

## 2. 明确边界

### 必须实现

- 复用现有 `dsh-superagent-worker` Worker Session。
- 只控制 `orchestrator_report(state="ready")`。
- 固定 base commit、修改范围和验证命令。
- 验证失败时拒绝 `ready`，让 Worker 继续处理。
- 写入可审查的验证证据。
- Worker 重启或插件重载后仍能重新挂载控制门。

### MVP 不实现

- 新建 Worker、Session、Profile 或 Runner。
- 赫菲自己的队列、状态机、调度器、数据库和重试循环。
- 修改 Super Agent 源码、数据库、Effect 或 Outbox。
- 通用 Recipe 插件市场。
- 验证缓存、HMAC、后台 Job/Subagent 全量审计。
- 赫菲创建、合并或回复 PR。
- 自动阻止 PR 在 `ready` 之前被其他流程创建。

最后一条是明确边界：MVP 保证“未验证任务不能通过赫菲的 `ready` 门”，不声称 PR 在此之前绝对不存在。

## 3. 激活协议

为保证普通任务零额外业务影响，MVP 使用显式激活。已有 Issue intake 或人工入口负责把指定任务设置为：

```text
HEPHI_ENABLED=1
```

标签到环境变量的映射可以由现有入口完成，MVP 插件不主动查询 GitHub 标签。

现有 `executor.prepare` 调用：

```bash
hephi prepare
```

行为：

| 条件 | 结果 |
|---|---|
| `HEPHI_ENABLED` 未设置 | 退出 0，不生成任何赫菲状态 |
| `HEPHI_ENABLED=1` 且上下文完整 | 生成激活合同，退出 0 |
| `HEPHI_ENABLED=1` 但 Ticket、仓库或 Issue 信息缺失 | 退出非 0 |
| 合同写入失败 | 退出非 0 |

合同放在工作区之外。激活意图和合同分开保存：

```text
~/.dsh-superagent/hephi/<ticket-id>/activation.json
~/.dsh-superagent/hephi/<ticket-id>/activation.intent
```

`activation.intent` 是一个轻量标记，不是第二套合同或状态机。先写入 intent，再原子写入 `activation.json`。这样合同丢失或损坏时，Worker 仍然知道该任务曾经启用赫菲。

`activation.json` 保存合同内容：

```json
{
  "enabled": true,
  "ticketId": "ticket-123",
  "repository": "paxxie2/dubbo",
  "issueNumber": 123,
  "workspace": "/path/to/workspace",
  "baseRef": "main",
  "baseSha": "abc...",
  "allowedPaths": ["dubbo-common/**"],
  "testCommand": "sh /path/to/hephi-superagent-plugin/scripts/run-dubbo-tests.sh forward",
  "reverseTestCommand": "sh /path/to/hephi-superagent-plugin/scripts/run-dubbo-tests.sh reverse",
  "requirePullRequest": true,
  "contractHash": "sha256:..."
}
```

`testCommand` 和 `reverseTestCommand` 必须来自宿主的可信配置或插件内置的 Dubbo Recipe，不能由 Issue 文本直接提供。命令只接受直接参数，不接受 shell 操作符。

## 4. Worker 挂载

插件启动时：

1. 枚举一次已有 Agent；
2. 监听后续 `agent/created`，并在挂载完成前返回；
3. 对每个 Agent 执行同一个挂载判断。

目标 Worker 必须同时满足：

```text
agent.session.header.agentPreset == "dsh-superagent-worker"
agent.session.header.origin != "subagent"
存在对应 ticket-id 的 activation.intent
workspace 与合同一致
```

使用 `WeakMap<Agent, Unsubscribe>` 防止重复挂载；Agent disposed 时解除监听。

不向 Worker 增加新的业务工具。Worker 仍使用 Super Agent 原有工具和 `orchestrator_report`。

## 5. ready 控制门

插件只检查以下调用：

```text
orchestrator_report({ state: "ready", ... })
```

其他工具调用和其他状态原样通过。

执行顺序：

```text
收到 ready
  → 读取 activation.json
  → 执行 DubboVerifier
  → 写入 evidence
  → 验证通过：允许原始 ready
  → 验证失败：拒绝 ready 并返回原因
```

实现上使用 Agent 作用域的 `tools/pre-execute` 执行异步验证，并使用短生命周期的验证通过标记配合 `tools.guard`，避免其他监听器把已拒绝的调用重新放行。这个实现细节不新增架构层。

有 intent 但合同不存在、合同损坏、合同哈希不一致或合同中的 `enabled` 不为 `true` 时，已激活任务直接拒绝 `ready`。没有 intent 的普通 Worker 不挂载 gate。

## 6. DubboVerifier

MVP 只实现一个固定的 `DubboVerifier`，不抽象通用 Recipe 框架。

验证顺序固定为：

1. 确认当前仓库与合同仓库一致；
2. 确认 `baseSha` 存在；
3. 确认工作区干净；
4. 计算 `baseSha..HEAD` 的修改文件和 patch；
5. 检查修改文件全部位于 `allowedPaths`；
6. 执行正向测试，并要求本次目标测试有新的 Surefire 报告；
7. 在干净的 `baseSha` worktree 中执行反向复现测试，并要求目标测试出现预期断言失败；
8. 如果 `requirePullRequest=true`，要求 `pr_number` 存在，并检查 PR、base 分支和 PR head；
9. 验证结束后再次检查 HEAD、工作区和 PR head，发生变化则失败；
10. 原子写入证据文件。

退出码为 0 不能单独代表验证成功。测试报告缺失、报告解析失败、目标测试未执行、编译失败、反向测试无法复现，都只能记为失败或无法判定，不得放行 `ready`。每次验证的 forward/reverse 报告目录位于工作区之外、每次尝试唯一，并在解析后清理。

## 7. 证据

每次验证生成一个文件：

```text
~/.dsh-superagent/hephi/<ticket-id>/evidence/<attempt-id>.json
```

至少包含：

- `contractHash`；
- `baseSha` 和 `verifiedHeadSha`；
- 修改文件和 patch hash；
- 正向、反向测试命令及结果；
- PR 编号、base、head；
- 环境指纹；
- 每项检查的状态和原因；
- 生成时间。

MVP 不复用旧证据缓存，每次 `ready` 都重新验证。

## 8. 失败语义

| 失败点 | 处理 |
|---|---|
| 激活合同生成失败 | `prepare` 非 0，任务不进入正常执行 |
| 已激活但合同缺失或损坏 | 拒绝 `ready` |
| 超出允许修改范围 | 拒绝 `ready` |
| 正向测试失败 | 拒绝 `ready` |
| 反向测试失败或无法判定 | 拒绝 `ready` |
| PR 缺失或 head 不匹配 | 拒绝 `ready` |
| 验证期间 HEAD 或工作区变化 | 拒绝 `ready` |
| 未启用赫菲的任务 | 完全按 Super Agent 原流程执行 |

## 9. 建议实现文件

```text
src/
├── index.ts              # 插件入口和生命周期监听
├── activation.ts         # prepare、合同读写和哈希校验
├── worker-mount.ts       # Worker 识别、挂载和卸载
├── ready-gate.ts         # ready 拦截与放行
└── dubbo-verifier.ts     # Dubbo 范围、测试、PR 和证据适配
```

现有全局 `hephi_*` 工具不纳入 MVP 主流程；Worker 不依赖这些工具才能完成验证。

## 10. 验收标准

MVP 通过以下测试后才进入真实 Issue 验收：

1. 未设置 `HEPHI_ENABLED` 的任务不生成合同，原流程正常执行；
2. 激活合同缺失时，Worker 不能报告 `ready`；
3. 修改超出允许范围时，`ready` 被拒绝；
4. 正向或反向测试失败时，`ready` 被拒绝；
5. PR head 与已验证 HEAD 不一致时，`ready` 被拒绝；
6. 验证通过后，原始 `orchestrator_report(ready)` 成功执行；
7. Worker 重启后重新挂载，且不会重复挂载；
8. 普通 Worker、subagent 和其他状态不受影响；
9. 证据文件能独立复核本次验证结论；
10. 不需要修改 Super Agent 源码即可完成集成。

## 11. 实施顺序

1. 先实现 `activation.ts` 和 `hephi prepare`；
2. 实现 Worker 识别和 ready gate；
3. 接入固定 DubboVerifier；
4. 加入证据写入；
5. 完成本地集成测试；
6. 用一个真实 Dubbo Issue 做端到端验收；
7. 通过后再考虑标签自动激活、更多验证器或 PR 交付扩展。

MVP 的完成标志不是“赫菲功能很多”，而是：**一个启用赫菲的真实任务无法绕过验证进入 `ready`，普通任务没有新增执行路径。**
