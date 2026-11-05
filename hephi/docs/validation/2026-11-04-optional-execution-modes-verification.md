# 2026-11-04 HEPHI 可选执行模式验证报告

- 分支：`codex/optional-execution-modes`
- 基线：`35e3213a12bf158cfe34696e621558743f6cabe6`（当前 HEAD 的父提交为 `033098d`）
- 工作区：`/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin`
- 结论：机制、单元/集成测试与宿主 fixture 通过；**真实 Worker/Issue 端到端未验证通过**。

## 实现范围

1. `src/control/activation.ts`
   - 新增 `ExecutionMode = 'native' | 'staged'` 与可选 `executionMode` 字段。
   - 新合同由 `HEPHI_EXECUTION_MODE` 明确写入；缺省 `native`，非法值在写 intent/合同前拒绝。
   - 加载时先按磁盘原始 JSON（含原始是否带 mode）校验 `contractHash`，再解释 mode；缺字段合同保持原始 parsed 形状（不新增 `executionMode` 字段），只在 `executionModeOf` 解释为 `native`，不写回、不重算哈希。
   - 新增同步加载 `loadActivationSync`，供挂载时同步确定模式。
2. `src/control/worker-mount.ts`
   - 挂载时同步读取合同并绑定 `contractHash + executionMode`；合同/模式运行中变化时拒绝修改、委派、阶段控制与 ready。
   - native 不安装阶段工具/阶段提示/阶段状态；staged 才安装 stage control。
   - 合同缺失/损坏/哈希或模式非法：不默认 native，不抛出破坏宿主，保持修改/委派/ready 受阻，只读调查可用。
   - ready 重新加载并复核合同身份与模式。
3. `src/control/stage-control.ts`（从 `033098d` 选择性恢复后补充）
   - staged 全周期禁止 `subagent`/`subagent_fork`/`workflow`/`spawn_teammate`/`send_message`/`team_task_create`/`team_task_update` 等实施委派；首次 plan 前禁止修改和 ready，允许 progress、只读调查及显式 `interrupt_agent`/`wait_agent`。
   - 保留原 checkpoint/progress/reopen/成功 progress 完成阶段/防重复提交逻辑。
   - 原生 Job 状态：`completed`/`failed`/`killed` 不阻塞；`running`/`stopping` 等待；未知状态失败关闭。
   - 恢复时通过宿主公开 `ctx.subagents.listChildren` + `ctx.agents.get` 发现活动子 Agent，并读取其公开 `Agent.status`（安装版 DSH 定义 `idle`/`running`）及该子 Session 的 Job 状态。
   - `running` 子 Agent，或任一 catalogued 子 Session 的 `running`/`stopping` Job 阻塞推进；即使 `agents.get(id)` 已返回 undefined，也仍检查该子 Session 的 Job（Agent 卸载不代表 Job 结束）。已结束但仍加载的 `idle` Agent 且 Job 全终态不误阻塞；Agent/Job 未知状态失败关闭。
   - `blocked`/`progress` 报告即使 stage control 加载失败、合同损坏或存在活动子 Agent 也放行到宿主，但不会推进阶段；`ready` 始终需要健康控制与最终校验。
4. `src/control/stage-mount.ts`
   - 仅 staged 注册 `hephi_stage` 与阶段提示；实际工具执行入口加 guard + `tools/execute` 双重检查。
   - staged 缺 `jobs`/`subagents`/可用恢复所需 `sessionQuery` 时失败关闭；native 不依赖这些服务。
   - 保留 `recoverStageProgress` 的真实 Session 事件恢复逻辑。
5. `src/control/stage-process.ts`、`scripts/check-stage-host.mjs`、`tests/control/stage-control.test.ts` 选择性恢复并按双模式调整。
6. `src/adapters/superagent.ts`：`hephi_get_contract` 返回的 runtime 暴露 `executionMode`，供 Skill 读取。
7. `skills/hephi-superagent-control/SKILL.md`：改为共同合同/KB/ready + native/staged 双模式规则；staged 明确串行、全周期禁止实施委派。

未修改 Super Agent/DSH 源码、监听、运行配置、其他 Skill；未创建远程/Issue/PR，未推送、部署或重启。

## 本轮审查修正（2026-11-04 fix）

1. **idle Agent 误阻塞 / 卸载 Agent 漏检 Job**：改为结合公开 `Agent.status` 与子 Job 状态，并对 `listChildren` 返回的每个 child 都调用 `jobs.list(id)`，不因 `agents.get` 为 undefined 而跳过。`running` 阻塞；`idle`/已卸载且 Job 全终态不阻塞；`stopping`/未知 Job 或未知 Agent 状态失败关闭。新增 `mountWorkerGate` + 实际 `hephi_stage`/guard/`tools/execute` 路径的挂载层回归，覆盖 missing live + running job 拒绝、missing live + terminal jobs 通过、missing live + unknown job 失败关闭。
2. **错误无法报告**：`failure`、`fault`、`violation` 不再拦截 `orchestrator_report(blocked/progress)`；报告可到宿主但不能推进阶段，实施与 `ready` 仍关闭。覆盖 stage 服务缺失、活动子 Agent、合同变化及实际 `tools/execute` 路径。
3. **旧合同形状被补字段**：`parseActivation` 只校验 mode 并返回原始 parsed 对象；`executionModeOf` 单独解释缺省 native。新增“读回不新增字段、原对象重新计算哈希仍一致”的回归。
4. **验证命令退出码**：最终 `pnpm check`、宿主 fixture、`git diff --check` 均直接重定向完整原始输出并保存真实 `$?`，未用 `| tail`/`grep` 的退出码作为成功依据。

## 验证命令与结果

### 完整原始日志

最终命令的完整输出与真实退出码保存在：

- `docs/validation/2026-11-04-optional-execution-modes-final-check.log` / `.exit`（`pnpm check`）
- `docs/validation/2026-11-04-optional-execution-modes-final-host.log` / `.exit`（宿主 fixture）
- `docs/validation/2026-11-04-optional-execution-modes-final-diff-check.log` / `.exit`（`git diff --check`）

三个 `.exit` 文件内容均为 `0`；未使用管道尾部或 grep 退出码代表成功。日志按原样保存，`.gitattributes` 仅对 `docs/validation/*.log`、`*.exit` 关闭空白检查，不修改日志内容。

### 项目检查

```text
$ pnpm check
> tsc --noEmit
Test Files  19 passed (19)
     Tests  127 passed (127)
  Duration  20.59s
> tsdown -c tsdown.config.ts
✔ Build complete in 652ms
exit 0
```

覆盖点包括：

- 旧合同原始 JSON/原哈希可加载，缺省 native；非法 mode 拒绝；新合同 mode 进入哈希。
- native 无 `hephi_stage`/阶段提示/阶段状态，遗留 `execution-plan.json` 不启用控制，`subagent`/Agent Team 工具不被阶段 guard 拦截。
- staged 计划前拒绝修改、ready 与委派；允许 progress/只读；A 未完成不能 start(B)。
- 检查失败不推进、checkpoint 对应成功 progress 才完成、重复/恢复/reopen 保留历史且不重复提交。
- Job 已结束不阻塞；运行中等待；未知状态失败关闭；活动子 Agent 恢复时拒绝推进。
- 缺阶段服务时 native 不受影响，staged 失败关闭。
- 合同/模式运行中变化拒绝沿用控制。


### 宿主公开工具入口 fixture

```text
$ node scripts/check-stage-host.mjs /Users/USER/.nvm/versions/node/v26.1.0/lib/node_modules/@deepseek-ai/dsh/node_modules
PASS: real installed DSH tool dispatch/scoped visibility/guard/progress events; fixture Agent/report/jobs, not Worker or Issue E2E
exit 0
```

该 fixture 使用已安装 DSH 的真实 tool dispatch/guard/`tools/execute`/`tools/result`，覆盖 `hephi_stage`、`orchestrator_report`、`subagent`、`spawn_teammate` 的拒绝路径，以及 admitted-but-undispatched 修改的 drain。它仍是 fixture，**不是**真实 Worker/Issue 端到端。

### 空白/补丁检查

```text
$ git diff --check
（无输出）
exit 0
```

## 失败记录与复验

1. 首次运行 `tests/control/stage-control.test.ts` 时 4 个真实 Git/进程测试在 Vitest 默认 5s 超时：
   - `ordinary task is untouched...`
   - `checking blocks mutation while actual slow process is running...`
   - `failed checks reopen A...`
   - `reopens completed A...`
   失败输出为 `Error: Test timed out in 5000ms`。原因是恢复后的阶段测试实际创建 Git 仓库、提交并运行前台进程，串行总时长超过默认值。
   处理：在 `vitest.config.ts` 设置 `testTimeout: 20000`（仅测试配置），复验全量通过。
2. 类型检查首次失败：测试中的旧 `Record<string, unknown>` 传给 `contractHash`、stage 构造器仍用旧布尔 `liveJobs` 签名。已改为显式测试类型/新的 `StageRuntime`，复验 `pnpm typecheck` 通过。
3. 宿主 fixture 首次为旧脚本（staged 已整体移除前的行为），与当前 `inject`/staged 语义不符；已更新为当前 API 与 staged 合同，最终运行通过。
4. 本轮新增 idle 子 Agent 挂载测试首次断言 `finish` 后 `write` 应完全放行；实际 `finish` 后阶段在等待 progress，`write` 正确显示 “closed”。这是测试断言把 checking 关闭误判为失败，改为断言原因不含 active child 后复验通过。
5. 本轮审查修正前的历史失败（4 个 5s 超时、类型 fixture 错误、旧宿主脚本）保留在上面；最终全量日志与退出码见 `docs/validation/*final-*.log/.exit`。
6. 未发现需要回滚代码的语义失败。

## 未验证 / 限制

- **真实端到端未验证通过**：未创建真实 native 任务，也未在真实 staged Worker/Issue 上完成一次完整 `plan → start → finish → progress → PR → ready`。
- 未验证真实 DSH Agent Team 的端到端委派（native 允许、staged 拒绝）在 live Worker 中的行为；fixture 只覆盖工具入口与 guard。
- 未验证宿主重启后的真实恢复（活动子 Agent、Job 未知状态、Session progress 回放）；相关机制仅由本地 fixture/单测覆盖。
- 未执行真实 push/PR、部署、重启或远程操作。
- 阶段控制仍只保证检查/交接顺序，不保证业务语义隔离；模型描述不构成执行证据。
