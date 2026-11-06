# P8 竞态验证记录：暂停期间的新 Issue（2026-11-07，实验宿主 B）

对应验证矩阵 V-P8-02 的近义场景：空闲检查后注入新 Issue，验证“只持久化、不启动；恢复后仅处理一次”。
按用户授权由 Agent 代操作；产物为 SMOKE_ONLY，已清理。

## 流程与实测

| 阶段 | 观测 | 结果 |
| --- | --- | --- |
| 基线（暂停前） | state DB：ticket 5 / trigger 6 / thread 9 | — |
| 暂停 | `POST executor/pause {"paused":true}`，load 0/0 | paused=true |
| 暂停期间创建 Issue | `paxxie2/site-pnl-diagnosis#35`（正文 @paxxie2） | — |
| 暂停保持 130s | trigger **6→7**（新增 trigger `436b1728…`，thread `paxxie2/site-pnl-diagnosis:35`）、thread **9→10**、ticket **5 不变**、load 0/0、无 worker 会话 | Trigger 已持久化，未创建 Ticket/Worker |
| 恢复 | `POST executor/pause {"paused":false}` | — |
| 恢复后处理 | 恰好一个 Ticket `04b029dc406e343f08b0df8453b6d9ef`（ticket 5→6），assignments=1，worker 会话目录 1 个（`work-race-smoke-readme-04b029dc406e`），assignment 报告 `ready` 并引用 PR #37 | 调度层只处理一次 |

## 异常发现（来源未确认，已修正表述）

- 同一 Issue 出现了 **两个 PR**：#36（21:27:57Z，分支 `agent/race-smoke-c0a9445cb550`）与 #37（21:31:13Z，分支 `agent/race-smoke-readme-04b029dc406e`，即 Ticket 报告里引用的那个）。
- 复查宿主记录：该 Issue 只有 1 条 trigger、1 个 Ticket（`04b029dc…`）、1 个 worker 会话；B 的 GitHub source 统计也未出现重复 trigger。**调度层与 Worker 均无重复执行证据**。
- 因此 #36 的来源**未能确认**（分支后缀 `c0a9445c` 不对应本实例的任何 Ticket；可能是其他宿主/代理创建的工件）。先前记录中“worker 重复创建外部产物”的推断**不成立**，已在此更正；两处 PR 均已清理。

## 结论

- “暂停期间只持久化、不提前启动”**通过**。
- “恢复后只处理一次”在 Ticket/Worker 调度层**通过**，但在外部产物层**未通过**（重复 PR）→ V-P8-02 记为 **partial**，新增缺陷：worker 可能重复外部操作（去重/幂等需另立工作包）。
- 清理：PR #36/#37 已关闭并删除分支；Issue #35 已关闭（均带 SMOKE_ONLY 说明）。
