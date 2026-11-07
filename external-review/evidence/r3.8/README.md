# R3.8 返修证据（X1–X3，2026-11-07）

## 基线
- 审查提交 `8fd199da1d2437ccc9da90a0cfcca64d1646549d`（R37 独立复核对 main 的审查对象）
- 返修分支 `agent/r3.8-remediation`，修复提交 `cfb5a187ad950170b1900b302c0d1f54530f3fe0`

## 双向证据
| 方向 | 命令/环境 | 结果 |
| --- | --- | --- |
| 旧实现 `8fd199d` × 新套件 | 独立克隆 `/tmp/hephi-r38-old`，旧 `deploy-hephi.sh` 保持 8fd199d，仅拷入 `test-deploy-hephi.mjs`；Node v22.19.0 | **exit 1，10 FAIL，全部为 X1–X3 缺陷断言**；原有 69 条 + P1–P3 全部 PASS（`old-8fd199d-suite-10fail.log`） |
| 修复提交 `cfb5a18` | 独立克隆 `/tmp/hephi-r38-fix`，Node v22.19.0 / pnpm 11.7.0 | `cd hephi && pnpm check` **exit 0**（20 文件 / 202 tests，tsdown Build complete 1840ms）；`node scripts/host/test-deploy-hephi.mjs` **PASS: 97 assertions，exit 0**（real ~133s）；`git diff --check` exit 0（`fix-cfb5a18-pnpm-check-and-suite.log`） |

套件构成：97 = 原有 69（main 46 + 负例 23，未改未删）+ 新增 28（X1 5、X2 7、X3 7、P1 3、P2 2、P3 4）。

## X1–X3 修复摘要（`scripts/host/deploy-hephi.sh`）
- X1：所有切换后失败出口统一 `paused_flag` + `fail_after_switch`：只有 paused=true 才说 “kept paused”；false 写 `keptPaused=no` 并输出 “host is NOT confirmed paused … manual takeover required”；unverified 同理。
- X2：`restart_instance` 每次尝试重置 `LAST_STATE/FAIL_STATE/FAIL_KIND`；失败分类 `stop-timeout`/`state-unreadable`/`health-timeout`；记录含 `targetFailureKind`/`restoreFailureKind`；恢复阶段无状态写 `restoreFailure=unverified`，绝不复用 target 阶段字符串。
- X3：`set_pointer` 迁移回退用 `MIGRATION_RESTORE=restored/failed` 跟踪；失败时输出 “old lib directory NOT restored; backup retained at …; manual takeover required”，记录 `failed-pointer` 含 `migrationRestore=failed` 与 `migration`（备份路径），不再输出 restored/preserved。

## 未验证
- 真实宿主 A→B→A、实载 commit 回读、真实 drain 5 字段、正式 hostVersion、open Ticket 解阻——全部仍未验证；P8 仍为部分。
- 本轮仅假宿主自动化；未在真实宿主执行任何部署/回滚。

## 合并与最终 main 验收（2026-11-07）

- PR #23 已合并：merge commit **`99c1070d296010fa4441798728af65f126bc364e`**（base `8fd199d`，head `cfb5a18`）。
- 最终 main（`99c1070`）独立克隆验收（Node v22.19.0 / pnpm 11.7.0）：
  * `cd hephi && pnpm check` → **exit 0**：20 文件 / 202 tests passed，tsdown `Build complete in 1578ms`；
  * `node scripts/host/test-deploy-hephi.mjs` → **PASS: 97 assertions**，exit 0；
  * `git diff --check 5efd708..99c1070` → exit 0；工作树干净；
  * `git diff --name-only 5efd708..99c1070` = **16 文件**（与冻结 allowed_files 一致）；
  * `hephi-baseline-1^{}` 仍 `3f276a5…`（未移动）。
  * 日志：`final-main-99c1070-acceptance.log`。
- 仍未验证：对 `cfb5a18`/`99c1070` 的**二次独立复核未做**；R3.7 真实 A→B→A、实载 commit 回读、真实 drain 5 字段、正式 hostVersion、2 个 open Ticket 解阻均未完成；**P8 仍为部分/unverified**。
