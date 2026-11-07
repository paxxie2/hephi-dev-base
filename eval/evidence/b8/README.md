# B8 开发期观察快照证据（2026-11-08）

本目录是 `eval/daily/observation-2026-11-08.{md,json}` 的原始证据。**只读采集**：不写宿主、
不部署、不改产品代码/Skill；数据来自宿主 B（`/Users/zm/dsh-instances/experiment/` 的
orchestrator）与本仓库 git 历史。

> ⚠️ 这是**开发期快照**（`window=null`），不是 PREREG 锁定的正式观察窗口，不得当作 B8 正式结论。
> 未验证项/边界见观察报告 §8，本文不重复。

## 文件清单

| 文件 | 内容 | 产生方式 |
| --- | --- | --- |
| `commands.log` | 采集与工具运行的全部命令、时间戳、退出码与原始输出（含 verify-export 11 项检查结果） | 采集脚本按实际执行逐条追加 |
| `prs-query.log` | 22 个结构化 PR URL 的 GitHub 只读查询结果（逐条） | `gh api repos/<owner>/<repo>/pulls/<n>` |
| `archive/tickets.json` | 宿主 B 全部工单的 P15 同形归档（35 条：status/createdAt/ended/prRefs/source 等） | orchestrator API + sqlite 只读快照 + GitHub PR 状态，归一化后写出 |
| `archive/summary.json` | P15 同形 summary（`total`/`uniqueIds`/`byStatus`/`prLinked`，`window=null`） | 由归档计算 |
| `daily-export.json` | `eval/daily/export.mjs` 真实输出（去重键 `ticketId`，含 counts 与逐工单字段） | `node eval/daily/export.mjs --input archive --out daily-export.json`（exit 0） |
| `export-check.json` | `eval/daily/verify-export.mjs` 交叉核对报告（VE-01..VE-11） | 同一源归档复算比对（exit 0，`ok=true`，`failures=[]`） |
| `collection-meta.json` | 数据源元信息、API/DB 交叉核对（35=35）、GitHub 查询逐条结果、原始采集文件 SHA-256 | 由采集脚本生成 |
| `derived-stats.json` | 补充统计（openByStage、merge 证据分解、assignment report blocked 列表、来源仓库分布等） | 由归档计算，供观察报告引用 |
| `rework.json` | `eval/daily/rework.mjs` 真实输出（`mergesReviewed=21`、`candidates=2`、`pending-human`） | `node eval/daily/rework.mjs --repo <clone> --since 2026-09-01 --window-days 30 --json`（exit 0） |
| `rework.log` | rework 的 stderr（0 字节 = 无 stderr） | 同上 |
| `p15-baseline-reexport-counts.json` | P15 基线归档用同一工具复核的**计数摘要**（total=61=uniqueIds，VE 全 PASS；不含逐工单数据） | 对 `/Users/zm/dsh-instances/experiment/evidence/p15-baseline-20261107-r2` 只读 re-export |
| `appeal-files.txt` | 申诉记录检索结果（14 个命中，全部是 `eval/daily/APPEALS.md` 文档副本，无 `appeal-record.jsonl`） | `find … -iname '*appeal*'`（只读） |
| `appeal-repo-files.txt` | 本仓库中除 `APPEALS.md` 外的 appeal 记录文件（0 个） | `git ls-files \| grep -iE 'appeal'` |
| `maintenance-files.txt` | `maintenance.jsonl` 检索结果（0 个 → 维护工时未知，不补 0） | `find … -name 'maintenance.jsonl'`（只读） |
| `SHA256SUMS` | 本目录与观察报告文件的 SHA-256（仓库根相对路径） | 见下 |

## 采集时刻

- 宿主与本仓库 git 快照：`2026-11-07T22:47:26Z` = 当地 `2026-11-08T06:47:26+08:00`。
- 宿主动态写入：采集期间宿主仍在接收/推进工单，快照只代表上述瞬间。

## 已知的采集取舍（不是伪造）

- 宿主 API/sqlite 的**原始响应/快照**（含本机绝对工作目录、worker sessionId、长执行摘要）**未提交**；
  提交的是 `export.mjs` 所需字段的归一化投影（`archive/tickets.json`），原始采集文件的 SHA-256 记录在
  `collection-meta.json` 的 `rawArtifactSha256`。原始文件仅存在于采集时的临时目录。
- API 与 sqlite 是**两次独立读取**（秒级间隔），故 `thread` 计数可能不同（本快照 57 vs 59）；
  工单级 `ticketId` 集合已核对完全一致（35 = 35），见 `collection-meta.json` 的 `crossCheck`。
- PR 状态来自 GitHub 只读 API 的采集时刻结果；后续可能变化，不做推断。
  `mergeCommit` 仅在 PR `mergedAt` 非空时记录，closed-unmerged PR 不写合并提交。

## 复现

```sh
node eval/daily/export.mjs --input eval/evidence/b8/archive --out /tmp/re-export.json
node eval/daily/verify-export.mjs --export /tmp/re-export.json --source eval/evidence/b8/archive
node eval/daily/rework.mjs --repo . --since 2026-09-01 --window-days 30 --json
```

（`verify-export.mjs` 的 VE-04 要求 `export.input` 与 `--source` 同路径，故必须先重新 export，
不能拿本目录 `daily-export.json` 直接配相对路径复核；采集时命令见 `commands.log`。）
