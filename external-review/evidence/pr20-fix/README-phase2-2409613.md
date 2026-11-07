# 阶段 2 证据：修复提交 2409613 独立复跑（positive direction）

生成者：r3-verify（独立验证者，只读主仓库；仅写本 evidence 目录与 /tmp）
时间：2026-11-07（UTC 2026-11-06T23:52 起）

## 1. 被测对象与方法

| 项 | 值 |
|---|---|
| 提交 | `2409613`（`R3 remediation: fix F1-F6 from PR #20 independent review`，由 07c5d83 amend 而来；本地提交、尚未推送 origin） |
| 克隆来源 | `git clone --no-hardlinks /Users/zm/dsh-instances/experiment/hephi-review /tmp/pr20-verify-new2`，随后 `git checkout 2409613` |
| 克隆工作树 | `git status --porcelain` 为空（clean tree，未带出主工作树未提交 docs 改动） |
| 关键文件 sha256 | `scripts/host/deploy-hephi.sh` = `20d41d34…1e787`；`scripts/host/test-deploy-hephi.mjs` = `ef703f25…7a621`；`hephi/tests/control/deploy-script.test.ts` = `1f197d34…0dc76` |
| Node / pnpm | node v22.19.0 / pnpm 11.7.0（PATH 前置 `/Users/zm/.nvm/versions/node/v22.19.0/bin`） |

说明：2409613 相对前一版 07c5d83 仅改 `hephi/tests/control/deploy-script.test.ts`（把 `PASS: 44 assertions` 改成 `PASS: 69 assertions`，describe 文案同步；仍在 allowed_files 内）。两个 scripts/host 文件哈希与 07c5d83 完全相同，因此阶段 1b（旧提交 + 最终套件 = 19 FAIL）仍适用于 2409613 的套件。

## 2. 验收命令 1：`cd hephi && pnpm check` → PASS

- 原始日志：`phase2-2409613-pnpm-check.log`
- `pnpm check` 内部 = `pnpm typecheck && pnpm test && pnpm build`
- 结果（原文摘录）：
  - `$ tsc --noEmit` 通过（无 output）
  - `vitest run`：**Test Files 20 passed (20)，Tests 202 passed (202)**
  - `$ tsdown -c tsdown.config.ts`：tsdown v0.22.14 / rolldown v1.2.16 构建成功
- **EXIT=0**

补充：干净克隆无 node_modules，pnpm 11.7.0 在首次 `pnpm check` 时自动安装依赖（+92 packages，lockfile 未变），随后正常执行；这与主工作树行为一致。

## 3. 验收命令 2：`node scripts/host/test-deploy-hephi.mjs` → PASS

- 原始日志：`phase2-2409613-fake-host-suite.log`
- 结果：**PASS: 69 assertions (R3 fake-host suite)，EXIT=0**，PASS 69 / FAIL 0，覆盖主套件 R3-T01..T17 与负例 N1/N1b/N2/N3/N4/N5。

## 4. 固定 plan.lock 核对 → PASS

- 原始日志：`phase2-2409613-planlock-check.log`
- plan.lock：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/plan.lock.json`，sha256 `2523425a…000df`（与冻结哈希一致）
- `git diff --name-status 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..2409613`：16 个文件，**全部 ∈ allowed_files，无越界**。
- `protected_files` 9 个文件：`git diff` 为空；逐文件 sha256 与 base `5efd708` **完全一致**。
- 验收命令 3 `git diff --check 5efd7084..2409613`：**EXIT=0**。

## 5. 阶段 1 反向（negative direction，仍有效）

- 最终套件（sha256 `ef703f25…`，与 2409613 相同）+ 旧 commit 17d3827 的旧 `deploy-hephi.sh`：**exit 1，PASS 50 / FAIL 19**，日志 `old-commit-final-suite.log`。
- FAIL 构成：N1×4、N1b×1、N2×2、N3×3、N4×4、N5×3、R3-T17×1、R3-T08×1（详见 `README-phase1.md`）。
- 与早前 20 FAIL 的差异：仅 `N2 rejected rollbacks have no side effects` 变 PASS（旧脚本在 release_validate 阶段即拒绝，指针/进程/记录数未变）；其余一致。

## 6. 前一轮发现（已在 2409613 修复，保留记录）

07c5d83 上 `cd hephi && pnpm check` 真实失败：`hephi/tests/control/deploy-script.test.ts` 仍期望 `PASS: 44 assertions`，而新套件输出 69；vitest 结果 `1 failed | 19 passed (20)`、`1 failed | 201 passed (202)`，EXIT=1。日志：`phase2-pnpm-check.bare-attempt.log`、`phase2-pnpm-check.run2.log`（两次一致）。2409613 已修正该期望，复跑全绿。

## 7. 未验证 / 限制（如实标注）

- 2409613 为**本地未推送**提交；docs 仍未提交。最终推送后的 SHA 会变化（至少 docs 提交会改变 SHA），故本报告只对 2409613 这一树内容负责，最终远端 SHA 需再做一次 clean-tree 复核。
- 本证据全部基于假宿主（fake host）与临时目录，**不等于真实宿主 P8 验收**；真实宿主 A→B→A、实载 commit 回读（R3.7）仍 unverified。
- `pnpm check` 的 build 产物写在 /tmp 克隆内，不涉及主仓库。
