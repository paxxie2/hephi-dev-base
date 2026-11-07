# 最终复核：已推送提交 7f50c13（origin/agent/hephi-r2-remediation）

生成者：r3-verify（独立验证者，只读主仓库；仅写本 evidence 目录与 /tmp）
时间：2026-11-07T00:09–00:14Z（本地 08:09–08:14 +08:00）

**本报告是对已推送提交 7f50c13 的 clean-tree 复核，取代 4664e96 的报告。**

## 1. 对象与来源

| 项 | 值 |
|---|---|
| 最终 SHA | `7f50c137afc46855a4c4683ef6c87173f4eb91d4` |
| origin 分支 | `agent/hephi-r2-remediation`（`git ls-remote origin` 实测 head = 7f50c13，`4664e96..7f50c13` 已推送） |
| 提交链 | `17d3827` → `2409613`（R3 返修代码）→ `4664e96`（返修文档）→ `7f50c13`（把越界文档并入 allowed 文档） |
| 克隆 | `git clone --no-hardlinks https://github.com/paxxie2/super-agent-hephi-review.git /tmp/pr20-verify-final2` + `git checkout 7f50c13` |
| 克隆工作树 | `git status --porcelain` 为空（clean tree） |
| 关键文件 sha256 | `scripts/host/deploy-hephi.sh` = `20d41d34…1e787`；`scripts/host/test-deploy-hephi.mjs` = `ef703f25…7a621`；`hephi/tests/control/deploy-script.test.ts` = `1f197d34…0dc76`（与 2409613/4664e96 相同） |
| Node / pnpm | node v22.19.0 / pnpm 11.7.0（PATH 前置 `/Users/zm/.nvm/versions/node/v22.19.0/bin`） |

## 2. `cd hephi && pnpm check` → PASS（EXIT=0）

- 原始日志：`phase2-final-7f50c13-pnpm-check.log`
- 干净克隆无 node_modules，pnpm 11.7.0 自动装依赖（+92，lockfile 未变）后执行。
- `tsc --noEmit` 通过；`vitest run`：**Test Files 20 passed (20)，Tests 202 passed (202)**；`tsdown`：**Build complete in 1396ms**。
- **EXIT=0**

## 3. `node scripts/host/test-deploy-hephi.mjs` → PASS（EXIT=0）

- 原始日志：`phase2-final-7f50c13-fake-host-suite.log`
- **PASS: 69 assertions (R3 fake-host suite)**，PASS 69 / FAIL 0，EXIT=0。

## 4. 固定 plan.lock 核对 → PASS（16 文件全部在冻结范围）

- 原始日志：`phase2-final-7f50c13-planlock-check.log`
- plan.lock sha256 `2523425a4aaed619fd51ac397e33c874a289cb2c830d1f87c39a60a4891000df`，与冻结 `plan.lock.hash` 一致。
- `git diff --name-status 5efd7084..7f50c13`：**16 个文件**；`changed=16  allowed=16  outside_allowed=[]` → **全部 ⊆ allowed_files**。
- `protected_files` 9 个：`git diff` 为空；逐文件 sha256 与 base `5efd708` **完全一致**。
- 验收命令 3 `git diff --check 5efd7084..7f50c13`：**EXIT=0**。

## 5. 越界文档处置核验（相对 4664e96）

4664e96 曾被本复核判定 1 个越界文件 `docs/remediation-r3-review-fix.md`（不在冻结 allowed_files）。7f50c13 的处置已实测确认：

- 越界文件已删除：`test -f docs/remediation-r3-review-fix.md` → absent。
- 全树无悬挂引用：`git grep "remediation-r3-review-fix"` → 无匹配。
- 内容并入 allowed 文件 `docs/remediation-r3-validation.md` 的 §9（第 174 行 `## 9. R3 返修登记：PR #20 独立复核 R3-F1–F6 与负例 N1–N5（2026-11-07）`，运行到文件末尾，共 369 行）。
- 内容完整性（原始文件 @4664e96 vs 合并后 §9）：
  - 正文行：orig 181 行 vs merged 181 行，**body_diff=0**（逐行逐字相同）；
  - 标题：orig 16 个 vs merged 16 个，**heading_diff=0**（标题级别统一降一级，标题文本一致）；
  - 结论：**§9 合并无内容断裂/截断，仅标题层级降级**。

## 6. 反向复核：终版套件在旧提交 17d3827 → 仍 19 FAIL

- 设置：`/tmp/pr20-verify-old` @ 17d3827（旧 `deploy-hephi.sh` sha256 `8a8a1eb2…` 未动）+ 终版套件（sha256 `ef703f25…`，与 7f50c13 相同）。
- 原始日志：`old-commit-final-7f50c13-suite.log`
- 结果：**EXIT=1，PASS 50 / FAIL 19（FAILED: 19 assertion(s)）**，FAIL 集合与 `old-commit-final-suite.log`、`old-commit-final-4664e96-suite.log` 逐条一致。
- FAIL 构成：N1×4、N1b×1、N2×2、N3×3、N4×4、N5×3、R3-T17×1、R3-T08×1。

## 7. 与 Lead 自测交叉验证

| 项目 | Lead 主仓库实测（7f50c13） | 本独立复核（origin clean clone） | 一致？ |
|---|---|---|---|
| pnpm check | exit 0；20/202；Build complete 855ms | EXIT=0；20/202；Build complete 1396ms | ✅（耗时波动属正常） |
| fake-host 套件 | PASS: 69 assertions，exit 0 | PASS: 69 assertions，EXIT=0 | ✅ |
| `git diff --check` | 0 | EXIT=0 | ✅ |
| allowed_files | 16 文件，outside [] | changed=16，allowed=16，outside=[] | ✅ |
| protected 9 文件 | 9/9 sha256 OK | 9/9 sha256 与 base 相同 | ✅ |
| 越界文档处置 | 并入 allowed 的 validation 文档 | 删除 + 无引用 + §9 内容逐行等价 | ✅ |

结论：**与 Lead 实测一致；4664e96 的越界文档已合并回 allowed 文件，最终 diff 16 文件全部在冻结范围。**

## 8. 未验证 / 限制

- 全部为假宿主 + 临时目录自动化验证；**真实宿主 P8 验收（A→B→A、实载 commit 回读，R3.7）仍未验证**。
- 本证据不改主仓库；构建产物只在 /tmp 克隆内。
