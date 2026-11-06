# P11 原生 GitHub 入口 smoke 记录（2026-11-07，实验宿主 B）

按用户授权由 Agent 代操作。产物标记 **SMOKE_ONLY / NOT_FOR_METRICS**，已按资料包“关闭测试 PR/分支”的 rollback 要求清理。

## 链路（全部真实）

| 环节 | 证据 |
| --- | --- |
| Issue | `paxxie2/site-pnl-diagnosis#32`：`[native] smoke: 原生入口链路验证（仅记录，不合并）`，正文 @paxxie2 |
| 监听 | B 实例 `health.github = Watching paxxie2/dubbo, paxxie2/topic-bench, paxxie2/site-pnl-diagnosis`（轮询间隔 ≥60s） |
| Ticket | 新 Ticket `c284b0df9b1bc44d353646e351dff7b1`，`state=open`；Assignment `report.state=ready` |
| Worker | `load.running` 由 0→1→0（约 6 分钟），结束时 `paused=false`、`running=0` |
| 分支 | `agent/smoke-native-entry-c284b0df9b1b` → `a18e282cc6a5951071cf5dadcf076e30f168ed06` |
| PR | `paxxie2/site-pnl-diagnosis#33`，base `main`，head `a18e282…`（与分支 SHA 一致），OPEN 后关闭、**未合并** |
| 清理 | PR #33 CLOSED、分支已删除、Issue #32 CLOSED；均带 SMOKE_ONLY 说明 |

Worker 在 PR 中自述“native (non-HEPHI) entry chain”，只改 `README.md` 一行注释；无 hephi 标签/任务卡，因此本次是**原生入口**链路，不是 hephi 激活交付。

## Worker 记录的真实检查结果（重要发现）

- `scripts/check.sh`：exit 2，停在 backend pytest —— **基线（`main` e00f338）本身**即失败：`ModuleNotFoundError: No module named 'app.data'`（`backend/app/data/` 被 `.gitignore` 的 `data/` 规则忽略）。Worker 在未修改的 base 上复现了该失败。
- 前端：typecheck 通过、vitest 59/59 通过、生产构建通过（脚本在 pytest 处提前退出，故单独运行）。
- 这是仓库既有缺陷，不是本次 smoke 引入；未在 smoke 中修复（保持范围最小）。

## 证明与未证明

- 证明：Issue → Ticket → Worker → 分支推送 → PR 的原生入口链路真实可用；Issue/PR/分支/Ticket 的 SHA 与关联可回读。
- 未证明：hephi 激活交付（无 hephi 标签/任务卡）；检查脚本全绿（基线缺陷）；合并（按 smoke 要求不合并）；多任务稳定性、并发与成本。
