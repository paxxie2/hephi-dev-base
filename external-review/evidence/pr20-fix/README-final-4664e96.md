# 阶段 2 最终复核：已推送提交 4664e96（origin/agent/hephi-r2-remediation）

生成者：r3-verify（独立验证者，只读主仓库；仅写本 evidence 目录与 /tmp）
时间：2026-11-07T00:02–00:07Z（本地 08:02–08:07 +08:00）

**本报告是对已推送提交的复核，不是工作树快照。**

## 1. 对象与来源

| 项 | 值 |
|---|---|
| 最终 SHA | `4664e96325a70dab4809cb5df82b6949ad5b4dbd` |
| 分支 | `agent/hephi-r2-remediation`（origin 已更新：`17d3827..4664e96`） |
| 提交链 | `17d3827`（R4 审查提交）→ `2409613`（R3 返修代码）→ `4664e96`（返修文档） |
| 克隆 | `git clone --no-hardlinks https://github.com/paxxie2/super-agent-hephi-review.git /tmp/pr20-verify-final` + `git checkout 4664e96`（HTTPS 凭据可用，无需 fallback） |
| 克隆工作树 | `git status --porcelain` 为空（clean tree） |
| 关键文件 sha256 | `scripts/host/deploy-hephi.sh` = `20d41d340a7680a29e71c9b5a72fd3c0f76b0db0649c979f837d6c7d4911e787`；`scripts/host/test-deploy-hephi.mjs` = `ef703f2598b614ed1a0c554a27e188d65c0263f2ace402081b125394cec7a621`；`hephi/tests/control/deploy-script.test.ts` = `1f197d346557c62003852b0e85da1e812211f73712863fc5de31f0d93420dc76` |
| Node / pnpm | node v22.19.0 / pnpm 11.7.0（PATH 前置 `/Users/zm/.nvm/versions/node/v22.19.0/bin`，实测 `node -v`/`pnpm -v` 已写入各日志首部） |

## 2. `cd hephi && pnpm check` → PASS（EXIT=0）

- 原始日志：`phase2-final-4664e96-pnpm-check.log`
- 干净克隆无 node_modules，pnpm 11.7.0 首次运行自动安装依赖（+92 packages，lockfile 未变）后执行 `pnpm typecheck && pnpm test && pnpm build`。
- `tsc --noEmit`：通过。
- `vitest run`：**Test Files 20 passed (20)，Tests 202 passed (202)**。
- `tsdown -c tsdown.config.ts`：**Build complete in 1413ms**，15 files / 339.66 kB。
- **EXIT=0**

## 3. `node scripts/host/test-deploy-hephi.mjs` → PASS（EXIT=0）

- 原始日志：`phase2-final-4664e96-fake-host-suite.log`
- **PASS: 69 assertions (R3 fake-host suite)**，PASS 69 / FAIL 0，EXIT=0。
- 覆盖主套件 R3-T01..T17 与负例 N1/N1b/N2/N3/N4/N5（含真实 paused/load/health 回读、迁移事务、rollback 显式 target、双失败证据）。

## 4. 固定 plan.lock 核对

- 原始日志：`phase2-final-4664e96-planlock-check.log`
- plan.lock：`../plan.lock.json`，sha256 `2523425a4aaed619fd51ac397e33c874a289cb2c830d1f87c39a60a4891000df`（与 `plan.lock.hash` 冻结值一致）。
- `git diff --name-status 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..4664e96`：**17 个文件**。
- `allowed_files` 核对：**16 个属于 allowed_files，1 个越界**：
  - **越界文件（唯一）**：`docs/remediation-r3-review-fix.md`（新增文档，不在 plan.lock 的 allowed_files 中；allowed_files 只列了 `docs/remediation-r3-validation.md` 等 8 个 docs 文件）。
- `protected_files`（9 个）：`git diff` 为空；逐文件 sha256 与 base `5efd708` 完全一致。**PASS**
- 验收命令 3 `git diff --check 5efd7084..4664e96`：**EXIT=0**。**PASS**

> 结论：代码/脚本/测试/受保护文件均合规；唯一偏差是新增文档 `docs/remediation-r3-review-fix.md` 未被冻结的 allowed_files 覆盖。是否需要处理（合入 allowed 的 docs 文档 / 删除该文件 / 显式登记 plan.lock 范围变更并重新冻结）由 Lead 与复核流程决定；本报告只事实记录。

## 5. 反向复核：终版套件在旧提交 17d3827 → 仍 19 FAIL

- 设置：`/tmp/pr20-verify-old` @ 17d3827（旧 `deploy-hephi.sh` sha256 `8a8a1eb2…` 未动）+ 终版套件（与 4664e96 同一文件，sha256 `ef703f25…`）。
- 原始日志：`old-commit-final-4664e96-suite.log`
- 结果：**EXIT=1，PASS 50 / FAIL 19（FAILED: 19 assertion(s)）**，FAIL 集合与先前 `old-commit-final-suite.log` 逐条一致。
- FAIL 构成：N1×4、N1b×1、N2×2、N3×3、N4×4、N5×3、R3-T17×1、R3-T08×1。

## 6. 与 Lead 自测的交叉验证

| 项目 | Lead 主仓库实测（`final-acceptance-4664e96.log`） | 本独立复核（origin clean clone） | 一致？ |
|---|---|---|---|
| `pnpm check` | EXIT=0；20 files / 202 tests；Build complete 922ms | EXIT=0；20 files / 202 tests；Build complete 1413ms | ✅ 结果一致（构建耗时差异属正常波动） |
| fake-host 套件 | PASS: 69 assertions，HARNESS_EXIT=0 | PASS: 69 assertions，EXIT=0 | ✅ |
| `git diff --check 5efd7084..HEAD` | DIFFCHECK_EXIT=0 | EXIT=0 | ✅ |
| plan.lock allowed_files | Lead 表述“17 文件 ⊆ allowed_files” | **17 文件中 16 ∈ allowed，1 个越界：docs/remediation-r3-review-fix.md** | ❌ 不一致，见 §4 |

## 7. 未验证 / 限制

- 以上均为假宿主 + 临时目录测试；**真实宿主 P8 验收（A→B→A、实载 commit 回读，R3.7）仍未验证**。
- 本证据不修改主仓库；所有构建产物只写在 /tmp 克隆内。
