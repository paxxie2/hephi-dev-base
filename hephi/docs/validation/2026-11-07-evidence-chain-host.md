# A2 证据链宿主验证（2026-11-07）

> **状态：模板 · 本轮在真实宿主上的结论待填写（`待填写`）**
> 本文记录 ROADMAP-95 §A2「完整证据链」H1–H6 的宿主核实结果。模板字段全部留 `待填写`，
> 由操作者在宿主上运行 `hephi/scripts/check-binding-host.mjs` 后回填。
> **本文件是验证记录，不是端到端验收通过证明；夹具/快照结论 ≠ A1-BIND 真实宿主端到端通过。**

## 0. 元信息（待填写）

| 项 | 值 |
| --- | --- |
| 验证日期 | 待填写 |
| 执行者 / 复核者 | 待填写 / 待填写 |
| 宿主实例 | 待填写（如 `http://127.0.0.1:3083`，pid、启动时间） |
| 宿主版本 | 待填写（`host.version` 实际值 + `versionSource`：approved/experimental/unavailable） |
| Node / OS | 待填写（探针需要 Node ≥ 22.15：快照为 JSONL+zstd） |
| 插件候选 SHA | 待填写 |
| 实载 SHA 回读 | 待填写（`verified` / `unverified`；R3.7/R37 已确认磁盘哈希 ≠ 实载 commit） |
| 运行模式 | 待填写（off/native/staged；本次 A2 探针应在真实 Worker 运行后采集） |
| 脱敏 JSON 路径 | 待填写（建议 `/tmp/a2-evidence-chain-<date>.json`，不提交生产数据） |
| 总体结论 | 待填写（pass / fail / incomplete） |

## 1. 如何在宿主上运行（操作者步骤）

> 全部只读：脚本只读取 Session 快照与 `run.json`、最多一次 `GET /orchestrator/api/state`；
> 不写仓库、不写宿主状态、不需要 `pnpm build`/`pnpm check`（工作树是实载插件目录，禁止构建）。

1. **找最近一次 Worker Session 快照（只读）**

   ```sh
   find <dsh-home>/sessions -name 'session.v*.jsonl.zstd' -print0 | xargs -0 ls -t | head -5
   ```

2. **找对应的 check 记录（只读）**

   ```sh
   find <state>/hephi -path '*/checks/*/run.json' -print0 | xargs -0 ls -t | head -5
   ```

   记录中应有 `runId`、`sessionId`、`callId`、`innerCallId`、`argv`、`cwd`、`before.baseCommit`、
   `status`、`exitCode`（以及 H3 相关时可能有的 `jobId`）。

3. **运行探针（自动完成 H1/H2/H4，H3/H5/H6 输出 manual 步骤）**

   ```sh
   node hephi/scripts/check-binding-host.mjs \
     --session <session.v4.jsonl.zstd> \
     --check-record <run.json> \
     --host http://127.0.0.1:3083 \
     --out /tmp/a2-evidence-chain.json
   ```

   退出码：0=全部 pass；1=有 fail；2=仅 unavailable/manual（需要继续人工补证据）。
   本轮未接宿主时脚本也会输出同样的 unavailable/manual 报告与以下命令清单。

4. **在宿主内完成 H3/H5/H6**（见脚本 `manualSteps` 与 §7 判定标准），把人工结论回填：

   ```sh
   node hephi/scripts/check-binding-host.mjs \
     --session <session.v4.jsonl.zstd> --check-record <run.json> \
     --manual H3=pass,H4=pass,H5=pass,H6=pass \
     --out /tmp/a2-evidence-chain-final.json
   ```

   `--manual` 只接受 `H3/H4/H5/H6`，值 `pass|fail|manual`；人工结论必须附证据（命令 + 输出），
   不允许无证据回填。

5. **回填本文**：把脱敏 JSON 关键片段粘贴到 §2，把结论写入 §3，完成 §5 的后续动作。

## 2. 命令与脱敏原始输出（待填写）

| 项 | 内容 |
| --- | --- |
| 执行的完整命令 | 待填写 |
| Session 快照路径（脱敏） | 待填写（脚本会掩码 Session id 与 `$HOME`） |
| check 记录路径（脱敏） | 待填写 |
| 宿主状态读取 | 待填写（`paused` / `load` / `health.runtime`） |
| 探针 JSON（脱敏） | 待填写（粘贴 `rings` 与 `summary` 关键片段；完整文件路径见 §0） |

```json
待填写：粘贴 /tmp/a2-evidence-chain.json 的脱敏片段
```

## 3. H1–H6 结论表（待填写）

| # | 环节 | 脚本自动状态 | 人工结论（pass/fail/manual） | 证据指针 | 备注 |
| --- | --- | --- | --- | --- | --- |
| H1 | `hephi_check` 内部 bash 调用是否出现在当前 Worker Session 快照；`tool/call` 字段名/`arguments` 形态/`workdir` | 待填写 | 待填写 | 待填写（`rings[H1].evidence`） | 待填写 |
| H2 | 前台 bash 结果 `kind`/`exitCode` 位置；promoted 是否带 `jobId` 且无最终退出码 | 待填写 | 待填写 | 待填写（`rings[H2].evidence`） | 待填写 |
| H3 | ready 时 `jobs.get(jobId, sessionId)` 终态与 `detail`；错误 session 调用行为；`readAt.lossy` | 待填写 | 待填写 | 待填写（`manualSteps.H3` 的输出） | 待填写 |
| H4 | check 记录写入的 `sessionId`（`outer.agent.id`）与 `session.header.id` 是否相等 | 待填写 | 待填写 | 待填写（`rings[H4].evidence`） | 待填写 |
| H5 | 前台 stdout/stderr 完整性（`truncated` 标记）；Job 输出可读性、lossy 何时为真 | 待填写 | 待填写 | 待填写（`manualSteps.H5` 的输出） | 待填写 |
| H6 | Worker 能否通过工具影响自己的 Session 快照 | 待填写 | 待填写 | 待填写（`manualSteps.H6` 的记录） | 待填写 |

判定标准见 §7；结论一致性要求：脚本状态、人工结论、证据三者不得互相矛盾。

## 4. 历史快照观察（非本轮结论，待本轮复跑确认）

以下为本轮在**已有历史 Worker Session 快照**（2026-11-06/07，插件早于 A1 v3 改动）上的只读观察，
**只用于说明探针能检出什么，不能替代本轮 A2 结论**：

1. `tool/call.data.arguments` 是**原始 JSON 字符串**（未解析）；模型显式传 `workdir` 时才有该字段
   （历史 44 条 bash 调用中 0 条带 `workdir`，命令默认在 Session cwd 执行）。
2. `hephi_check` 的内部 dispatch 在 Session 中表现为 `job/registered`（`toolCall.callId=innerCallId`、
   `rootCallId=outer callId`）与 `job/settled`，**没有**对应的 `tool/call` / `tool/result` 事件
   （与 `hephi/docs/validation/2026-11-04-ready-evidence-api-check.md` 的“Nested `tools.execute` 调用
   不产生自己的 Session 事件”一致）。
3. 持久化 `tool/result.message` **不含结构化 `value`**（历史样本 69/69 无 `value`）；退出码只以文本
   标记 `[exit code: N]` 出现；`job/settled.detail` 形如 `exit code: 0`。
4. 历史 check 记录的 `sessionId` 与 Session 头 `id` 相等（H4 样本 pass），但记录里没有单独的 `agent.id` 字段。
5. 探针在历史样本上的实际结果：H1 **FAIL**（缺 innerCallId 的 `tool/call`）、H2 **FAIL**（无 `message.value`）、
   H4 **PASS**、H3/H5/H6 **MANUAL**。这提示 A1 当前“tool/call + message.value 绑定”在真实宿主编码下可能不成立；
   **必须用当前候选插件 + 真实 Worker 复跑确认**，不能直接下结论。

## 5. 结论与后续动作（待填写）

| 项 | 结论/动作 | 负责人 | 关联 |
| --- | --- | --- | --- |
| H1 结论 | 待填写 | 待填写 | A1-BIND；若 fail 见下 |
| H2 结论 | 待填写 | 待填写 | A1-BIND；退出码来源 |
| H3 结论 | 待填写 | 待填写 | ready Job 终态/错误 session/lossy |
| H4 结论 | 待填写 | 待填写 | 若不一致：check-runner 改写 `session.header.id` 并升记录格式 v4 |
| H5 结论 | 待填写 | 待填写 | A1-OUT 输出哈希 |
| H6 结论 | 待填写 | 待填写 | 若 fail：按计划审查 P1-7 回退 A1-BIND |

**若 H1/H2 复跑仍 fail（设计决策，待负责人）**：

- 计划审查 P1-4 要求 H1 记录原始 `command/workdir` 字符串；若绑定只存在于 `job/registered` 事件，
  需决定绑定证据源改为 Job 事件（含 `toolCall.callId/rootCallId`）还是让内部 dispatch 产生 Session 事件；
- 在决策前，A1-BIND 不得标“真实宿主已验证”；ready 的绑定开关应保持关闭或按 fail-closed 处理。

**若 H6 fail**：按计划审查 P1-7 停止 A1-BIND，保底只保留 A1-OUT + 文件指纹 + A4 威胁模型，
并把 D1 的上限降为 L1/L2。

**边界不变**：本文件不改变 R3.7 blocked / P8 部分完成；A2 探针通过也不等于 A1/P8 真实验收 done。

## 6. 限制与声明

1. **夹具/快照 ≠ 端到端**：本探针读取持久化快照与单次只读状态，不进入宿主 Cordis 进程；
   `jobs.get/readAt/lossy`、H6 自影响必须人工在宿主内探测。
2. **只读**：不写仓库、不写宿主状态、不修改 Session 记录；H6 只能在可销毁实例上进行，生产实例禁止。
3. **脱敏**：默认掩码 Session/call/job id 与 `$HOME`、过滤 `token/secret/password` 形态的赋值；
   `--no-redact` 仅供操作者本机私有排查，其输出不得分享/入库。
4. **环境**：快照为 JSONL+zstd，需 Node ≥ 22.15（宿主 Node 22.19 满足）；旧 Node 会给出清晰错误。
5. **不替代**：本文不替代 A1 单测、A1-OUT、A4 威胁模型或 B 线统计；也不构成真实宿主 A→B→A 验收。

## 7. 附录：H1–H6 判定标准

| # | pass 判定 | fail 判定 | 自动/人工 |
| --- | --- | --- | --- |
| H1 | 记录 `innerCallId` 在 Session 快照中有且仅有一个 `tool/call`（`name=bash`），`arguments`（原始 JSON 字符串）解析后 `command` 与冻结命令逐字符一致、`workdir` 等于记录 cwd；对应 `tool/result` 存在 | 上述任一不成立（例如只有 `job/registered` 而没有 `tool/call`，或 `workdir` 缺失/不一致） | 自动（需要 session+record） |
| H2 | 前台 `tool/result.message.value` 有结构化 `kind`；`foreground` 带整数 `exitCode`；`promoted/background` 带 `jobId` 且无最终退出码 | 缺结构化 value、kind 未知、promoted 带最终退出码或前台无 exitCode | 自动（需要 session） |
| H3 | 本 Session 能 `jobs.get` 取到 `status=completed` 与 `detail='exit code: 0'`；错误 Session 被拒绝（抛错或 undefined 且调用方失败关闭）；`readAt` 的 `chunks/lossy` 语义明确 | 终态/详情取不到、错误 Session 能读到、`lossy` 语义不明或不可用 | 人工（宿主内）+ 快照佐证 |
| H4 | 记录 `sessionId` == Session 头 `id` | 不相等 | 自动（需要 session+record） |
| H5 | 前台超限输出有 `[output truncated` 与可读 spill；Job 输出 `readAt` 完整、`lossy` 为假；发生截断时 `lossy`/标记一致 | 截断无标记、spill 不可读、Job 输出丢失而 `lossy=false` 或反之 | 人工（宿主内）+ 快照佐证 |
| H6 | Worker 无法让 Session 快照/检查记录出现未发生的可信事件 | 任一自影响成功，或 ready 采信被篡改内容 | 人工（一次性实例） |

## 8. 关联文件

- 探针脚本：`hephi/scripts/check-binding-host.mjs`（`--help` 含完整命令与 manual 步骤）
- A1 绑定实现：`hephi/src/control/evidence-verifier.ts`、`hephi/src/control/check-runner.ts`
- 既有宿主接口核对：`hephi/docs/validation/2026-11-04-ready-evidence-api-check.md`
- 计划依据：`ROADMAP-95.md` §A2；`external-review/ROADMAP95-plan-review.md` P0-2 / P1-4 / P1-7
- 运行记录 schema（B 线，如后续需要）：`eval/schema/run.schema.json`
