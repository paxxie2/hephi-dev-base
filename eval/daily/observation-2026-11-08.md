# B8 开发期观察快照（2026-11-08）

> **状态：开发期快照（development-period snapshot），不是 PREREG 锁定的正式观察窗口。**
> 本文件用**真实已有数据**（宿主 B 工单历史 + 本仓库 git 历史）做一次只读快照；它**不是**
> 效果实验证据，不产生 B8 正式结论，也不代表赫菲启用后的观察窗口。
> 采集时间：2026-11-08T06:47:26.460+08:00（Asia/Shanghai）/ `2026-11-07T22:47:26.460Z`（UTC）。
> 证据目录：`eval/evidence/b8/`（含原始命令日志、导出/核对/返工输出与 `SHA256SUMS`）。

## 1. 数据源（全部只读）

| 数据源 | 路径/接口 | 本次实际结果 |
| --- | --- | --- |
| 宿主 B orchestrator API | `http://127.0.0.1:3083/orchestrator/api/tickets?state=open\|ended&limit=1000`（header `x-orchestrator-request: 1`） | HTTP 200 / 200；open 7 条 + ended 28 条 = 35 条 |
| 宿主 B state DB | `/Users/zm/dsh-instances/experiment/state/orchestrator.sqlite`（node:sqlite 只读快照，ticket/thread 表） | 35 条 ticket、59 条 thread（采集瞬间） |
| GitHub（只读） | `gh api repos/<owner>/<repo>/pulls/<n>`，仅对工单线程中**结构化** pull URL 查询 | 22 个 PR URL，22 成功 / 0 失败；merged 5、open 14、closed-unmerged 3 |
| 本仓库 git 历史 | `node eval/daily/rework.mjs --repo /tmp/b8obs --since 2026-09-01 --window-days 30 --json` | exit 0；reviewed merges 21，候选 2（pending-human） |

交叉核对：API 工单 id 集合与 sqlite 工单 id 集合一致（35 = 35，无单侧缺失）；API thread 57 条 vs sqlite thread 59 条
（宿主动态写入造成的秒级差异，ticket 级集合已核对一致）。不可得字段写 `null`，不猜。

## 2. 导出与交叉核对（真实命令、真实退出码）

```sh
node eval/daily/export.mjs --input /tmp/b8obs/eval/evidence/b8/archive --out /tmp/b8obs/eval/evidence/b8/daily-export.json
# exit 0
node eval/daily/verify-export.mjs --export /tmp/b8obs/eval/evidence/b8/daily-export.json \
  --source /tmp/b8obs/eval/evidence/b8/archive --out /tmp/b8obs/eval/evidence/b8/export-check.json
# exit 0；VE-01..VE-11 全部 PASS，failures=[]，warnings=[]
```

（上面为采集时实际命令；`/tmp/b8obs/eval/evidence/b8` = 本仓库 `eval/evidence/b8`，采集克隆路径为 `/tmp/b8obs`；从仓库根用相对路径重跑同样成立，见 §9。）

`export.mjs` 输出的去重键为 `ticketId`；`verify-export.mjs` 从同一源归档复算并逐项核对，结论 **OK (cross-check passed)**。
它只证明「给定源归档时计数可复算」，不证明源数据完整或 B8 达标（见 §7）。

## 3. 计数结果

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| `total` | **35** | 去重后工单数（= 源归档 `summary.uniqueIds` = API 35 条） |
| `merged` | **5** | 有合并证据：宿主 `outcome=merged` 3 条 + 仅「关联 PR 已合并」证据 2 条（§3.1） |
| `unmerged` | **30** | `total − merged`（补集，与 dropped/blocked 有重叠） |
| `dropped` | **0** | 无 `outcome=dropped/abandoned` 记录；stopped/closed 计 closedUnmerged（待负责人确认是否把 stopped 视为放弃） |
| `blocked` | **0** | **不可得**：宿主 B 无 ticket 级 blocked 字段；0 表示未记录，**不是**零阻塞结论（§3.2） |
| `closedUnmerged` | **23** | 已结束、未合并、未放弃、未阻塞 |
| `openNotBlocked` | **7** | 仍开放（stage：person 6 / idle 1） |
| `prLinked` | **22** | 带结构化 PR 关联的工单数 |

互斥恒等式：`5 + 0 + 0 + 23 + 7 = 35`，
与 `total = 35` 一致 ✅；`unmerged = total − merged = 30` ✅。

宿主原生 `ended.outcome` 分布：closed 4、stopped 21、merged 3；另有 open 7（合计 35）。

### 3.1 merged = 5 的口径分解（B8 允许 PR merged 作为合并证据）

- 宿主 `outcome=merged`（3）：`f6c19549`、`8622e1ed`、`b6166d59`
- 仅「关联 PR 已合并」证据（2）：`b7201bbf`、`992a6cb2`
  （ticket 本身 ended 为 stopped/closed，但关联 PR 在采集时已 merged）
- 已合并 PR（5）：[29](https://github.com/paxxie2/site-pnl-diagnosis/pull/29)、[42](https://github.com/paxxie2/site-pnl-diagnosis/pull/42)、[30](https://github.com/paxxie2/super-agent-hephi-review/pull/30)、[37](https://github.com/paxxie2/super-agent-hephi-review/pull/37)、[38](https://github.com/paxxie2/super-agent-hephi-review/pull/38)

> 该口径按 `eval/daily/MAINTENANCE.md` §2.3：`merged` = P15 outcome=merged / merged* 字段 / **PR merged 标记**。
> 若只想看宿主原生 outcome，`merged` 为 3；两种读数都在本文件写明，不取平均值、不混合。

### 3.2 blocked 不可得的处理

- 宿主 B API/sqlite 的 ticket 没有 `blocked`/`blockedSince`/`blockedReason` 字段 → export `blocked=0`（不可得，不猜）。
- 旁证：`assignments[].report.state=blocked` 的工单 8 条（open 3 / ended 5），
  **不并入** `counts.blocked`（它是历史执行报告状态，不等于 ticket 当前阻塞）。
- 7 条 open 工单的 stage（person 6 / idle 1）也**不**自动算成 blocked；人工判定需负责人口径。

## 4. 工单清单摘要（按 createdAt 升序；完整字段见 `archive/tickets.json`）

| # | ticketId | status | stage | createdAt | PR | title |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `24983dd7` | stopped | ended | 2026-11-05T20:36:52.214Z | — | 健康检查 200/503 响应增加固定 service 字段 |
| 2 | `b3a7d823` | stopped | ended | 2026-11-05T20:48:46.112Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/27) | [native] 健康检查 200/503 响应增加固定 service 字段 |
| 3 | `f6c19549` | merged | ended | 2026-11-05T21:47:25.835Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/29) | [native] 恢复指定 data 源码并为健康接口增加固定 service 字段 |
| 4 | `b61dfbe3` | stopped | ended | 2026-11-06T03:35:33.091Z | — | [native] G1 宿主能力探针（B 实验宿主，临时任务，不合并） |
| 5 | `c284b0df` | closed | ended | 2026-11-06T20:00:11.676Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/33) | [native] smoke: 原生入口链路验证（仅记录，不合并） |
| 6 | `04b029dc` | closed | ended | 2026-11-06T21:27:32.006Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/37) | [native] 竞态测试：暂停期间新 Issue（仅验证，不合并） |
| 7 | `c603d0ef` | closed | ended | 2026-11-06T21:41:25.573Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/39) | [native] hephi smoke: README 追加标记（仅验证，不合并） |
| 8 | `b7201bbf` | closed | ended | 2026-11-06T21:49:09.094Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/42) | [native] hephi smoke: README 追加标记（第二轮，仅验证，不合并） |
| 9 | `b76b1fc9` | stopped | ended | 2026-11-07T13:00:46.146Z | — | [native] SMOKE_ONLY efdd406 部署验收：README 单行标记，不合并 |
| 10 | `78851e47` | stopped | ended | 2026-11-07T13:03:48.423Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/46) | [native] SMOKE_ONLY efdd406 重新验收：冻结锁文件安装，README 单行标记，不合并 |
| 11 | `992a6cb2` | stopped | ended | 2026-11-07T13:18:29.541Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/30) | [native] 剩余前置统一实施：发布修复、兼容路径与宿主真实验证 |
| 12 | `3619d68f` | stopped | ended | 2026-11-07T14:14:28.060Z | — | [smoke] e490fe3 新部署原生交付验收，不合并 |
| 13 | `b945d6ef` | stopped | ended | 2026-11-07T14:18:21.361Z | — | [smoke] e490fe3 带赫菲标签的全新交付验收，不合并 |
| 14 | `ad3d5016` | stopped | ended | 2026-11-07T14:22:30.791Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/50) | [native] [smoke] e490fe3 新部署基础交付验收，不合并 |
| 15 | `90150d23` | stopped | ended | 2026-11-07T14:33:22.480Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/53) | [native] 既有A5边界实验 E2 E3 E6 E7：最小验收，不重构不合并 |
| 16 | `c9ea328e` | stopped | ended | 2026-11-07T14:33:22.482Z | — | [native] A5 E8 负例：故意缺任务卡，预期准备拒绝 |
| 17 | `cdaadaf7` | stopped | ended | 2026-11-07T14:39:57.608Z | — | [native] A5 E1-off 原生对照：不启用赫菲，同Issue49任务卡 |
| 18 | `e0ad474f` | stopped | ended | 2026-11-07T15:15:38.530Z | — | [native] 清单2：summary、离线扫描、migrate及单实例复核小批次 |
| 19 | `c231654e` | stopped | ended | 2026-11-07T15:27:39.873Z | — | [native] E4 检查目录配置错误：check not started → 修正后重试 |
| 20 | `13af322b` | stopped | ended | 2026-11-07T15:30:17.887Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/58) | [native] E4 重试：检查配置修正后重跑 project-regression |
| 21 | `9461627f` | stopped | ended | 2026-11-07T15:35:34.124Z | — | 行为保持重构：提取 money.py 的日期窗口辅助函数 |
| 22 | `1612ffac` | stopped | ended | 2026-11-07T15:38:29.022Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/61) | [native] 行为保持重构：提取 money.py 的日期窗口辅助函数 |
| 23 | `8622e1ed` | merged | ended | 2026-11-07T16:00:24.023Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/37) | [native] 清单2最终检查与PR交付：接续已完成代码，不新增功能 |
| 24 | `b6166d59` | merged | ended | 2026-11-07T16:26:17.319Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/38) | [native] 清单2补项2.7 F1：修复activation legacy降级绕过（仅F1） |
| 25 | `e2419b28` | stopped | ended | 2026-11-07T17:15:14.557Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/63) | [native] E1-on 正式场景：清理 Settings.from_env 死分支（等价清理，不合并） |
| 26 | `23c3eab1` | stopped | ended | 2026-11-07T18:22:47.906Z | [PR](https://github.com/paxxie2/site-pnl-diagnosis/pull/66) | [native] S3 部署冒烟：bc21cac 基础链路验收（不合并） |
| 27 | `d31e4f61` | stopped | ended | 2026-11-07T18:24:03.416Z | — | [native] 工作包甲：集成五文档最小修订并完成原生回归交付 |
| 28 | `bd9384b5` | stopped | ended | 2026-11-07T18:48:38.622Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/56) | [native] 甲包最小修复：原生Job输出运行期采集，保持lossy拒绝 |
| 29 | `ef9b71e6` | open | idle | 2026-11-07T19:33:32.800Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/58) | [native] 甲包：修复版全新入口长输出采集验收 |
| 30 | `ae85aac4` | open | person | 2026-11-07T22:28:33.728Z | — | [native] 甲包 E4：不存在检查目录的全新入口负向验收 |
| 31 | `f0256db7` | open | person | 2026-11-07T22:31:47.754Z | — | [native] 甲包 E8：缺任务卡必须拒绝的真实入口验收 |
| 32 | `ea564491` | open | person | 2026-11-07T22:31:47.757Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/66) | [native] 甲包：五文档整合与 scope/计划/PR/HEAD 联合边界验收 |
| 33 | `5e88de03` | open | person | 2026-11-07T22:34:33.948Z | [PR](https://github.com/paxxie2/super-agent-hephi-review/pull/65) | [native] 甲包：E4正常目录对照、真实49164字节输出与审批门禁验收 |
| 34 | `0824a468` | open | person | 2026-11-07T22:35:12.795Z | [PR](https://github.com/paxxie2/b5-native-site-pnl/pull/3) | [native][B5-native] previous-window-order run1 |
| 35 | `2801319d` | open | person | 2026-11-07T22:44:10.001Z | [PR](https://github.com/paxxie2/b5-native-site-pnl/pull/5) | [native][B5-native] previous-window-order run1-retry |

来源仓库分布：`paxxie2/b5-native-site-pnl` 2，`paxxie2/site-pnl-diagnosis` 22，`paxxie2/super-agent-hephi-review` 11。

## 5. 维护 / 返工

### 5.1 返工候选（机械候选，不是返工结论）

```sh
node eval/daily/rework.mjs --repo /tmp/b8obs --since 2026-09-01 --window-days 30 --json
# exit 0；mergesReviewed=21，candidates=2，pendingHuman=2
```

| # | 原 merge | 后续提交 | 引用 | 共享文件 |
| --- | --- | --- | --- | --- |
| 1 | `bc3386cd65` Merge pull request #20 from paxxie2/agent/hephi-r2-remediation | `c2865feaf2` docs: record PR #20 merge into main (bc3386c)（2026-11-07T00:33:04.000Z） | #20 | `docs/implementation-index.md`<br>`docs/p8-deploy-record.md`<br>`docs/remediation-r1-validation.md`<br>`docs/remediation-r3-validation.md`<br>`docs/self-check-2026-11-07.md`<br>`docs/source-consistency.md` |
| 2 | `3f276a533b` Merge pull request #7: HEPHI 前置阶段可实施项与 c547 等价修复 | `2cb56249b0` Record PR #7 merge and hephi-baseline-1 tag in consistency docs（2026-11-06T19:52:14.000Z） | #7 | `docs/g2-preflight.md`<br>`docs/source-consistency.md` |

两条候选均为 `category=pending-human`：需人工分类（缺陷修复 / 需求变更 / 正常演进），**不得**当返工率。
窗口 30 天为任务指定值；`eval/B8-observe.md` §2 要求窗口由 PREREG 锁定，是否已锁定**必须由负责人确认**。

### 5.2 维护工时

未发现 `maintenance.jsonl`（0 条记录）→ **维护工时未知（null）**，不补 0、不估算；
分类/工时口径见 `eval/daily/MAINTENANCE.md` §3。

## 6. 误拦申诉（hephi/appeal）

- 真实申诉记录：**0 条，无真实申诉数据**。
- 检索（只读）：`find … -iname '*appeal*'` 命中 14 个文件，全部是 `eval/daily/APPEALS.md` 的文档副本
  （仓库工作树），不是 `appeal-record.jsonl`；仓库内除 `eval/daily/APPEALS.md` 外无 appeal 记录文件。
- **不得**把「0 条记录」写成「零申诉率」或「无误拦」结论。

## 7. P15 基线映射（同口径，不直接比较）

- P15 基线归档：`/Users/zm/dsh-instances/experiment/evidence/p15-baseline-20261107-r2`
  （2026-11-06T20:22Z，覆盖 3 个 DB）：`total=61`、`uniqueIds=61`、`byStatus={"open":34,"stopped":21,"merged":2,"completed":4}`。
- 用同一工具复核：`export.mjs` → `total=61`（= `uniqueIds`）、`merged=2`、`dropped=0`、`blocked=0`、
  `closedUnmerged=25`、`openNotBlocked=34`、`prLinked=33`；`verify-export.mjs` exit 0（VE-01..11 全 PASS）。
  证据：`eval/evidence/b8/p15-baseline-reexport-counts.json`。
- 映射规则：`ticketId` 去重；日常导出 `counts.total` 与 P15 `summary.uniqueIds` 同口径（VE-10）。
- **不可直接比较**：P15 是 3 个 DB 的历史基线（experiment DB 当时 4 条），本快照只是宿主 B experiment DB
  在更晚时间的 35 条；P15 计数只作口径参照，**不得**与本次 35 条做前后对比或算增长率。

## 8. 未验证项 / 边界（必须随报告保留）

- 本文件是开发期快照（window=null），不是 PREREG 锁定的正式观察窗口；不得当作 B8 正式结论或 B 线实验证据。
- blocked：宿主 B ticket 表/API 没有 ticket 级 blocked 字段，export counts.blocked=0 表示「不可得/未记录」，不是「零阻塞」结论；assignment report.state=blocked 仅作旁证，未并入 counts。
- dropped：没有 ended.outcome=dropped/abandoned 记录，dropped=0；stopped(21)/closed(4) 按 MAINTENANCE §2.2 计入 closedUnmerged，是否把 stopped 视为放弃需负责人确认。
- 维护工时：未发现 maintenance.jsonl（0 条），工时为未知（null），不补 0 工时、不估算。
- 申诉：未发现 appeal-record.jsonl 或 hephi/appeal 真实记录，申诉数为 0 条（「无真实申诉数据」，不是「零申诉率」结论）。
- 影子模式（P4）数据不存在/未验证；本快照不含影子观察。
- PR 关联仅来自结构化线程/channel URL；PR 状态是采集时刻的 GitHub 只读查询结果，后续可能变化。
- 宿主动态写入：快照是采集瞬间；apiThreads 与 sqliteThreads 数量可能因秒级写入差异不同（本快照 55 vs 57），ticketId 集合已核对一致（35=35）。
- verify-export 只证明「给定源归档时导出计数可复算」，不证明源数据完整或 B8 达标；export.input 记录采集时路径，异地复核需重新 export 后再 verify（VE-04 要求同路径）。

## 9. 复现

```sh
# 1) 用提交的归档重跑导出与交叉核对（注意 VE-04 要求 export.input 与 --source 同路径，故先重新 export）
node eval/daily/export.mjs --input eval/evidence/b8/archive --out /tmp/re-export.json
node eval/daily/verify-export.mjs --export /tmp/re-export.json --source eval/evidence/b8/archive
# 2) 返工候选（本仓库当前 HEAD；结果会随历史推进变化）
node eval/daily/rework.mjs --repo . --since 2026-09-01 --window-days 30 --json
# 3) 采集命令与退出码、原始输出见 eval/evidence/b8/commands.log；文件完整性见 SHA256SUMS
```
