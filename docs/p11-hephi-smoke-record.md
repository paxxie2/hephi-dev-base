# P11 hephi 激活交付 smoke 记录（2026-11-07，实验宿主 B）

按用户授权由 Agent 代操作。产物标记 **SMOKE_ONLY / NOT_FOR_METRICS**，已按资料包 rollback 要求清理（PR 关闭、分支删除、Issue 关闭）。

## 0. 前置修复（本轮完成）

1. **基线修复**：合并 `paxxie2/site-pnl-diagnosis` PR #29（恢复 `backend/app/data/` 源码、`.gitignore` 改 `/data/`、health service 字段），`main` 变为 `291b29e`。
2. **检查自包含**：实验实例的 `project-config/site-pnl-checks.json` 将 `project-regression` 改为
   `sh -c 'npm --prefix web install --no-audit --no-fund && bash scripts/check.sh'`，
   使新 worktree 在没有 `node_modules` 时也能自包含执行（时长上限 900s）。
3. **构建一致性**：重建后必须重启宿主，否则 prepare CLI（读磁盘 lib）与 Worker（内存中 lib）的
   plugin commit 会不一致；本轮用部署脚本（构建+重启）把两者统一到 `fba676e`。

## 1. 第一轮（失败，证明 fail-closed）

| 项 | 证据 |
| --- | --- |
| Issue/Ticket | #38 → Ticket `c603d0ef2e16d10b29d382dee995a584` |
| 激活合同 | `plugin.commit = fba676e…`（prepare CLI 读磁盘 lib） |
| Worker 实载 | `dde783a…`（宿主未重启，内存中仍是上一次构建） |
| hephi_check | `project-regression` **passed**，exit 0（run `3c7135da…`） |
| ready | **denied**，rule `ready.plugin-build`：`contract was prepared by another plugin build (fba676e…); rerun prepare with dde783a…` |
| 结果 | Worker 如实报告 blocked，PR #39 已创建（未合并，已清理） |

该轮证明：构建变更未重启时，ready 会拒绝而不是静默通过（fail-closed）；也暴露了“prepare 与 Worker 构建不一致”的运维风险。

## 2. 第二轮（成功，完整 hephi 激活链路）

| 环节 | 证据 |
| --- | --- |
| 部署 | `deploy-hephi.sh` 构建 `fba676e` 并重启 B；磁盘 lib 与进程内存一致 |
| Issue/Ticket | #41 → Ticket `b7201bbf8a340c999955d38e73b4e396` |
| 激活合同 | `contractHash sha256:e51f4f74…`；`version:1`、`enforcement:enforce`、`plugin.commit:fba676e…`、`requirePullRequest:true`、任务卡冻结（AC1：README.md 注释行） |
| 写入判定 | decisions seq1 `scope.allowed`（edit README.md） |
| hephi_check | `project-regression` **passed**，exit 0；`argv = sh -c "npm --prefix web install … && bash scripts/check.sh"`，`cwd` 为 Worker 真实工作区；run `4794b189-07ee-4611-80a5-28eb7f31de8c`，记录 `version:3`、`pluginCommit:fba676e…` |
| ready | **passed**（decisions seq3 `ready.pass`，pluginCommit 一致） |
| 交付 | PR #42：base `main@291b29e`，head `99faa2a`，仅改 README.md（+1 行）；OPEN、未合并 |
| 报告 | Worker ready summary 自述“verify-only、不合并”，列出检查命令、runId、changedFiles、clean tree |

## 2.1 合并结果（2026-11-07 按用户指示）

- PR #42 已按用户指示**重新打开并合并**：`main` = `8d2ec58`（merge commit），README 末尾现含
  `<!-- hephi activated smoke 2026-11-07 -->`；分支已删除。
- 其余同主题的**过期 smoke 工件**（PR #40、#43 等，标题均标 “do not merge/smoke”）已按用户授权清理：
  关闭并删除分支（可重开）。它们**不是**本轮 Worker 的产物：B 的 GitHub source 共收到 5 条 trigger，
  issue #38/#41 各只有 1 条 trigger、各对应 1 个 Ticket（`c603d0ef…`、`b7201bbf…`），
  因此“同一 trigger 被调度两次”无法得到证据支持；#40/#43 的来源未能确认（可能是其他宿主/代理工件），
  不作为本 Worker 的重复执行证据。

## 3. 清理与边界

- 两轮产物均已清理：PR #39/#42 关闭、分支删除、Issue #38/#41 关闭（均带 SMOKE_ONLY 说明）。
- 本 smoke 证明的是**机制链路**（合同→检查→证据→ready→PR），不代表效果、成本或稳定性；
  hephi 仍未部署到 A（无插件对照），也没有跑三组对照（依赖 G1 的模型可见表面导出，用户已排除）。
- 仍未做：hephi activated 的 PR 合并（按 smoke 要求不合并）、多任务稳定性、并发、成本统计。
