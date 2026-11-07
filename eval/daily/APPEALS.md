# B8 误拦申诉流程（APPEALS）

本文件规定工单作者认为赫菲的拒绝（ready/检查/范围/纪律等）不合理时的申诉流程。它是
ROADMAP-95 §B8「误拦申诉：工单作者认为拒绝不合理时加标签 `hephi/appeal`，由非开发者复核」
的落地口径，也是估计误拦率与维护成本的输入之一。

> 状态：骨架（2026-11-07）。申诉的宿主侧标签/通知能力尚未在真实宿主验证；真实启用前
> 需要宿主团队确认 `hephi/appeal` 标签的可见性与复核者通知方式。

## 1. 原则

1. **只读原决策**：申诉不修改决策日志、检查记录、合同或工单终态；原记录保持不可变。
2. **非开发者复核**：复核者不得是原 Worker 的开发者、不得是本次提交作者；由负责人指定
   （产品/测试/独立评审），并记录身份与角色。
3. **可追溯**：每条申诉必须能关联到具体决策日志条目与检查记录（含合同哈希/插件 commit/
   宿主版本），否则退回补充证据。
4. **双向计数**：申诉结果同时进入误拦率（`false-block`）与维护工时（`false-block-handling`），
   不进入 B5 实验主指标；不得用申诉结果反过来修改预注册。

## 2. 触发与提交

- 工单作者（或值班人）在原 Issue/Ticket 加标签 **`hephi/appeal`**，并在 Issue 追加一条
  `appeal` 模板评论（不得编辑原决策/检查记录）。
- 同一决策只受理一次申诉；重复申诉按“补充证据”处理，仍记在同一 `appealId` 下。
- 提交时至少提供：被拒的决策引用（规则 id、时间、`contractHash`）、期望结果、理由。
  缺证据时复核者可要求补充，计时暂停。

申诉评论模板：

```markdown
## HEPHI appeal

- appealId: <ticketId>-<yyyy-mm-dd>-<seq>
- 被拒决策: <rule id> @ <at>（decision log seq=<n>，contractHash=<sha256:...>）
- 原因: <为什么认为该拒绝不合理>
- 期望: <放行 / 重新运行检查 / 修正范围>
- 证据: <检查记录 runId、Session/commit、复现步骤；可附链接>
```

## 3. 复核流程

| 步骤 | 负责人 | 产出 |
| --- | --- | --- |
| 1. 受理 | 值班人 | 检查标签与模板完整，分配 `appealId`、复核者 |
| 2. 取证 | 复核者（非开发者） | 读取该工单决策日志（`decisions.jsonl`）对应 `seq`、检查记录 `run.json`/`output.log`（校验 `outputHash`）、合同 `contractHash`、插件 `pluginCommit`、宿主版本；只读，不改文件 |
| 3. 判定 | 复核者 | `outcome = overturn`（误拦）/ `upheld`（拒绝合理）/ `inconclusive`（证据不足），给出 `rootCause` 与 `reviewNotes` |
| 4. 处置 | 负责人/插件 owner | `overturn` 且属实现缺陷时：登记修复 + 回归测试，必要时重跑检查后放行；`upheld` 说明规则依据；`inconclusive` 列缺失证据 |
| 5. 记录 | 值班人 | 追加 `appeal-record.jsonl`（见 §4），更新维护工时与误拦统计 |
| 6. 归档 | 负责人 | 月度/季度汇总，公开包只放脱敏聚合结果 |

时限建议（由负责人确认后写入）：受理 ≤1 个工作日；取证+判定 ≤3 个工作日；实现修复单独立项，
不计入申诉时限但工时计入维护成本。

## 4. 记录字段（`appeal-record.jsonl`，只追加）

```json
{
  "schemaVersion": 1,
  "appealId": "ticket-123-2026-11-07-1",
  "ticketId": "ticket-123",
  "issueUrl": "https://github.com/<owner>/<repo>/issues/<n>",
  "filedAt": "2026-11-07T09:00:00Z",
  "filedBy": "author-handle",
  "label": "hephi/appeal",
  "decisionRefs": [
    {
      "decisionLogSeq": 42,
      "rule": "ready.evidence-missing",
      "reason": "missing, failed or stale evidence: build",
      "at": "2026-11-07T08:50:00Z",
      "contractHash": "sha256:...",
      "tool": "orchestrator_report"
    }
  ],
  "checkRunIds": ["<runId>"],
  "pluginCommit": "<40-hex>",
  "hostVersion": "<approved value or experimental>",
  "reviewedBy": "reviewer-handle",
  "reviewedRole": "non-developer",
  "raisedByNonDeveloper": true,
  "outcome": "overturn",
  "rootCause": "plugin-bug",
  "reviewNotes": "检查记录 outputHash 可校验，但命令比较缺少 baseSha 前缀，判定规则实现错误。",
  "resolvedAt": "2026-11-08T10:00:00Z",
  "maintainHours": 1.5,
  "fixRefs": ["commit:<sha>", "test:<path>"]
}
```

字段约束：

- `outcome` ∈ `overturn` / `upheld` / `inconclusive`；
- `rootCause` ∈ `plugin-bug` / `contract-error` / `host-issue` / `task-flaw` /
  `user-misunderstanding` / `inconclusive`；
- `raisedByNonDeveloper` 恒为 `true`（B8 要求非开发者复核）；
- `maintainHours` 与 `eval/daily/MAINTENANCE.md` §3 的 `false-block-handling` 工时一致，
  同一事件不得重复计两处；
- 记录只追加，不改原决策日志/检查记录/合同；`appeal-record.jsonl` 与决策日志分开存放。

## 5. 统计口径（与 B8 其它计数分开报告）

- **误拦率** = 窗口内 `outcome=overturn` 的申诉数 ÷ 窗口内拒绝决策总数（决策日志
  `effectiveDecision=deny` 的去重条目；分母来源与口径必须在月报写明）。
- 同时报告：`upheld`、`inconclusive` 数；`rootCause` 分布；每类维护工时。
- 误拦率分母不得用“所有运行数”代替“拒绝决策数”；样本小的时候同时给次数与置信区间。
- 申诉工单计入 `eval/daily/export.mjs` 的 `total`；不进入 B5 效果实验主指标。
- 申诉结果用于改进规则/文档，不用于事后修改预注册或补数据。

## 6. 与其它文档的关联

- 决策日志格式：`hephi/src/control/decision-log.ts`、`hephi/docs/decisions-format.md`
  （`seq`/`rule`/`reason`/`contractHash`/`pluginCommit`）。
- 检查记录：`state/hephi/<ticketId>/checks/<runId>/run.json` + `output.log`
  （`outputHash` 可校验）。
- 运行记录 schema：`eval/schema/run.schema.json`；实验排除规则见 `eval/PREREG.md` §7。
- 维护成本模板：`eval/daily/MAINTENANCE.md` §3；月度报告模板 §5。

## 7. 安全与留档

- 申诉记录按 P14 存本机证据目录，不提交生产数据到公开实验包；公开只放脱敏聚合。
- 不记录密钥/token/用户隐私；复核过程只读，不修改决策日志与检查记录。
- 该流程变更需升版本并说明是否影响已发布误拦率；已发布数据不重算（如需重算，另开版本并说明）。


## 逐申诉填写表（空白模板，非真实记录）

结论沿用 overturn / upheld / inconclusive；是否改判须与结论一致。误拦率沿用 §5：窗口内 overturn 数 / 按决策去重的 effectiveDecision=deny 数；不是总运行数，零分母记不可计算。

| 日期 | ticketId | 原规则 / decision 引用 | 申诉原因 | 非开发者复核人 | 结论 | 是否改判 | 改进项 / 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

| 虚构示例：YYYY-MM-DD | EXAMPLE-TICKET（不存在） | EXAMPLE-RULE / EXAMPLE-DECISION | 示例：证据匹配需复核 | 示例复核人（非真实、非开发者） | overturn（虚构示范） | 是（虚构示范） | 示例证据占位，不可作验收；示例改进：补充规则说明 |

本表仅为空白模板和明确标记的虚构示例；“待填写”不是发生过的事件或验收证据。填写真实记录时附可核查证据，保留失败与后续复核记录；不覆盖既有原始记录。
