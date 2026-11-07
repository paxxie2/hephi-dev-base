# B8 日常使用：维护成本日志与计数口径（MAINTENANCE）

本文件属于 ROADMAP-95 §B8（日常使用），规定**启用后的日常观察窗口**如何记录维护成本、
如何用机械工具复算工单计数与返工候选。它**不是**效果实验或 P8 验收证据；实验口径见
`eval/PREREG.md` / `eval/RUNBOOK.md`。

> 状态：骨架（2026-11-07）。真实推广期的数据源（orchestrator sqlite / 原生 Ticket 主表）
> 尚未在启用后核对；本文件先固定**口径与模板**，数据可用性如实标注。

## 1. 范围与窗口

- 观察窗口（observation window）由负责人按季度/月定义，写入每批 `batch.json`（起止时间、
  模型/宿主/插件实际版本、团队/任务复杂度变化）。前后对比只能作为辅助证据（B8 混杂因素）。
- **统计范围包括所有工单**：已合并、未合并、被放弃、长期阻塞都算；被赫菲长期阻塞后放弃的
  必须进入统计。不得只数已合并工单。
- 误拦申诉单独走 `eval/daily/APPEALS.md`；申诉不修改原决策/检查记录。

## 2. 计数口径与 P15 基线映射（对应计划审查 P2-6）

### 2.1 去重键

**`ticketId`**（P15 归档中的 `tickets[].id`）。同一 `ticketId` 的重复记录只保留一条；重复记录
只能补充证据（`merged`/`dropped`/`blocked` 取 OR），不得凭空新增工单。
P15 `summary.total` 是归档记录数（可能跨 db 重复），**`summary.uniqueIds` 才与日常导出的
`counts.total` 同口径**；报告必须同时写出这两个数并说明差异。

### 2.2 P15 → 日常导出字段映射

| P15 `tickets.json` 字段 | 日常导出字段 | 说明 |
| --- | --- | --- |
| `id` | `ticketId` | 去重键 |
| `ended.outcome` / `status` | `status` / `state` | `merged` / `dropped` / `stopped` / `completed` / `open` |
| `createdAt` | `createdAt` | 原样 |
| `ended.at` | `endedAt` | 原样 |
| `prRefs` | `prs` | 字符串数组；对象形式 `{url,state}` 的 `state=merged` 视为合并证据 |
| `source` | `source` | 归档 db 来源 |
| — | `stage` | P15 无该字段时为 `null` |
| — | `blocked` | **P15 归档没有阻塞字段** → 基线 `blocked=0`；启用后需从原生 Ticket 的
  disposition/ended 之外的阻塞标记补录（数据源待宿主团队确认，未验证） |
| — | `dropped` | P15 有 `dropped` outcome 时才计 `dropped`；P15 的 `stopped`/`completed` 计 `closedUnmerged`（不自动当放弃；若宿主用 stopped 表示放弃，需负责人确认后再映射） |
| — | `sourceIssue` | P15 无 Issue 关联时为 `null` |

### 2.3 计数定义（`eval/daily/export.mjs` 输出 `counts`）

| 字段 | 定义 | 备注 |
| --- | --- | --- |
| `total` | 去重后工单数（所有状态） | = P15 `uniqueIds` |
| `merged` | 有合并证据的工单（P15 outcome=merged / `merged*` 字段 / PR `state=merged`） | |
| `unmerged` | `total − merged` | 未合并的**补集**，因此与 `dropped`/`blocked` 有重叠 |
| `dropped` | 明确被放弃（P15 outcome=dropped / `dropped`/`abandoned` 标记） | 未合并子集 |
| `blocked` | 当前仍阻塞（`blocked=true` / `blockedSince` / `blockedReason`） | 未合并子集 |
| `closedUnmerged` | 未合并、未放弃、未阻塞，但已结束（completed/stopped/closed） | 互斥细分 |
| `openNotBlocked` | 其余：仍开放且未阻塞 | 互斥细分 |

互斥核对恒等式：`total = merged + dropped + blocked + closedUnmerged + openNotBlocked`，
且 `unmerged = total − merged = dropped + blocked + closedUnmerged + openNotBlocked`。
报告里必须同时给出恒等式等式两边的数（export 脚本会拒绝没有 `ticketId` 的输入）。

## 3. 维护成本日志模板

每个自然月（以及每次宿主升级/误拦事件后）追加一行 `maintenance.jsonl`（只追加、不改历史）：

```json
{
  "schemaVersion": 1,
  "batch": "daily-2026-11",
  "at": "2026-11-30T10:00:00Z",
  "category": "host-upgrade-adaptation",
  "hours": 3.5,
  "owner": "operator-name",
  "evidence": ["docs/validation/...", "commit:<sha>", "ticket:<id>"],
  "description": "升级宿主 0.2.2 后适配 sessionQuery 事件结构",
  "relatedRuns": 0,
  "notes": "按 P8/S3 流程只做只读核对，未部署"
}
```

`category` 枚举（互斥、必填）：

| category | 含义 |
| --- | --- |
| `host-upgrade-adaptation` | 宿主升级适配（插件/合同/事件结构变化） |
| `false-block-handling` | 误拦处理（含复核、放行、修复、回归测试） |
| `config-maintenance` | 配置维护（cordis.patch.yml、hostVersion、校验脚本） |
| `documentation` | 运行手册/预注册/证据归档维护 |
| `other` | 其他，必须在 `description` 说明 |

字段约束：`hours` 为 0.25 的倍数（真实工时，不是估算模型 token）；`owner` 为人类负责人；
`evidence` 必须可追溯（提交 SHA/文档相对路径/工单 id）；`relatedRuns` 为直接影响的 B6 运行数。

月度汇总字段：按 category 合计工时、总工时、有效运行数（来自 B6 `report.py`/run records 的
`validationEnvironment.status=available` 计数）、每运行维护工时 = 总工时 ÷ 有效运行数。
**不要**把维护工时折算成 token 或模型费用（成本口径见 PREREG §5）。

## 4. 用脚本复算（真实命令）

### 4.1 工单计数（export.mjs）

```sh
# 输入：P15 归档目录（含 tickets.json/summary.json）或同形 JSON
node eval/daily/export.mjs --input <p15-archive-dir> --out <batch>/daily-export.json
```

输出 `counts`（字段见 §2.3）。核对顺序：

1. `counts.total === P15 summary.uniqueIds`（若不等，检查是否混入归档外工单/缺 `ticketId`）；
2. 互斥恒等式 §2.3 成立；
3. `merged` 与 P15 `byStatus.merged` 一致（若 P15 有不同来源的 merged 标记，在报告里同时列）；
4. `blocked=0` 时必须在报告注明“基线无阻塞字段，不计入基线；启用后另采”。

export 只读输入；不会修改归档，也不访问网络。

### 4.2 返工候选（rework.mjs）

```sh
node eval/daily/rework.mjs --repo <repo> --since <window-start> \
     --window-days <PREREG 锁定值> --json > <batch>/rework-candidates.json
```

- 口径：merge commit（`--merges`）后窗口内、**非 merge** 且 message 引用原 PR/Issue 编号、
  且修改文件与 merge 引入文件有交集的提交 = 候选；每条候选 `category="pending-human"`。
- **必须抽样人工分类**（缺陷修复 / 需求变更 / 正常演进）：样本量、抽样 seed、窗口长度写进
  预注册；分类结果追加 `rework-labels.jsonl`（`commit`、`candidateRef`、`label`、`rater`、
  `at`）。
- 报告两类数：候选占比 = `summary.candidates ÷ summary.mergesReviewed`；返工率估计 =
  抽样中 `label=defect-fix`（或预注册定义）的数量 ÷ 抽样候选数，并给出置信区间。
- 机械候选**不能**直接当返工率；窗口/抽样变化必须一起报告。

### 4.3 误拦事件

误拦处理工时计入 §3 的 `false-block-handling`；返工候选与维护成本分开报告。申诉流程见
`eval/daily/APPEALS.md`。

## 5. 月度维护报告模板

```markdown
# 日常使用月报（<month>）

- 观察窗口：<from> .. <to>；模型/宿主/插件实际版本：...
- 混杂因素：模型升级、团队变化、任务复杂度变化、审查人员变化（列出并说明影响）

## 工单计数（export）
| total | merged | unmerged | dropped | blocked | closedUnmerged | openNotBlocked |
| --- | --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... | ... |
恒等式核对：...；P15 uniqueIds=...，差异说明=...

## 返工候选（rework）
mergesReviewed=...；candidates=...；候选占比=...；
抽样=...；人工分类=缺陷修复/需求变更/正常演进；返工率估计=...（CI=...）

## 维护成本
| category | 工时 | 说明/证据 |
...
总工时=...；有效运行=...；每运行维护工时=...；相关误拦事件=...

## 结论与限制
（只写机械计数＋人工分类结果；不得用月报证明 B5 实验效果；不得把 R3.7/P8 当作已通过）
```

## 6. 安全与留档

- 月度记录与 export/rework 输出按 P14 存放在本机证据目录，**不提交生产数据**到公开实验包；
  公开包只放聚合计数/脱敏分类结果。
- 不记录 token、密钥、用户隐私；不修改归档、决策日志、检查记录（只读/只追加）。
- 本文件的模板与口径变更需升版本并说明是否影响已发布月报。
