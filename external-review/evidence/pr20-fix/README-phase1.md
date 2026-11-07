# 阶段 1 证据：新负例套件在旧提交 17d3827 上应失败（negative direction）

生成者：r3-verify（独立验证者，只读仓库）
时间：2026-11-07（UTC 2026-11-06T23:34–23:44）

## 1. 环境与被测对象

| 项 | 值 |
|---|---|
| 独立克隆 | `/tmp/pr20-verify-old`（`git clone --no-hardlinks https://github.com/paxxie2/super-agent-hephi-review.git`） |
| 被测 commit | `17d3827d3a73d3afb7a3b8de130d1615bd351769`（detached HEAD，PR #20 审查提交） |
| 被测旧脚本 | `scripts/host/deploy-hephi.sh` @ 17d3827，sha256 `8a8a1eb290b7b569edf3a059e0a2b872389ed41f8aad3e0c55127b83676f8f83`（快照 `deploy-hephi.old-17d3827.sh`） |
| 测试套件 | 主工作树 `scripts/host/test-deploy-hephi.mjs` 未提交的新负例版，拷入克隆覆盖旧测试；快照 `test-deploy-hephi.new-suite-snapshot.mjs`，sha256 `e0f495d58d5c1d97b80d5a5ad913ac8242f07e9785ecaeaba562489eed03a6ca` |
| Node / pnpm | node v22.19.0 / pnpm 11.7.0（PATH 前置 `/Users/zm/.nvm/versions/node/v22.19.0/bin`） |
| 命令 | `cd /tmp/pr20-verify-old && node scripts/host/test-deploy-hephi.mjs` |

说明：克隆内的 `deploy-hephi.sh` 保持 17d3827 原样（哈希已核对并写入日志首部行），未做任何修改。

## 2. 真实运行结果

- 原始日志：`old-commit-negative-fails.log`（首跑）、`old-commit-negative-fails.run2.log`（复跑，验证确定性）
- 首跑：**exit 1**，`FAILED: 20 assertion(s)`；PASS 49 条
- 复跑：**exit 1**，同样 20 FAIL / 49 PASS，FAIL 断言名集合与首跑**逐条一致**（`diff` 无差异）
- 结论（negative direction 成立）：新负例套件在旧提交上**真实失败**，不是自证通过。

## 3. FAIL 清单（20 条，复跑完全一致）

主套件中由“真实回读”断言捕获的 2 条：

1. `FAIL R3-T17 success record uses real paused/load/health readback`
2. `FAIL R3-T08 restored record keeps both health evidences`

N1（普通 lib 目录首次迁移）4 条：

3. `FAIL N1 plain-lib first deploy exits 0`（实际 exit 1，日志内含 `EISDIR: illegal operation on a directory, rename .../.lib-new-* -> .../hephi/lib`）
4. `FAIL N1 lib becomes symlink to release A`（lib 仍是普通目录，指针未切换）
5. `FAIL N1 migration backup keeps old lib content`（无 `.migration-*` 备份）
6. `FAIL N1 success record keeps migration evidence`

N1b（迁移第二步失败需恢复旧目录）1 条：

7. `FAIL N1b failure record written`（旧脚本无 `failed-pointer` 记录；注：exit 非零与旧目录恢复两条断言因 set -e 直接退出而“碰巧”通过，但无记录）

N2（rollback 缺/空 target 必须显式拒绝）3 条：

8. `FAIL N2 rollback without --target rejected`（旧脚本把 target 默认为仓库 HEAD，报的是 `rollback target release is invalid`，不是拒绝缺少 `--target`）
9. `FAIL N2 empty rollback target rejected`（同上，`--target ''` 被隐式替换为 HEAD）
10. `FAIL N2 rejected rollbacks have no side effects`（指针/进程/记录发生变化：`starts=1 records=1`）

N3（未真正恢复不得写 failed-restored-previous）3 条：

11. `FAIL N3 restore record only after real pointer restore`（无 `failed-restored-previous` 记录；该世界 lib 为普通目录，旧脚本 set_pointer 直接 EISDIR 退出，未恢复、未记录）
12. `FAIL N3 record keeps target failure health evidence`
13. `FAIL N3 record keeps restore health evidence`

N4（恢复阶段 rename 失败不得以原始 42 绕过双失败记录）4 条：

14. `FAIL N4 recovery rename failure exits nonzero without raw 42`（实测 `code=0`：旧脚本把该次部署当成成功并写 `result=ok`，注入的恢复失败路径未被到达）
15. `FAIL N4 double-failure record written`（只有两条 `result=ok` 记录）
16. `FAIL N4 record keeps both failure evidences`
17. `FAIL N4 double-failure record keeps real paused readback`

N5（成功路径必须真实回读 paused，不得硬编码 true）3 条：

18. `FAIL N5 deploy refuses success when host is not paused`（假宿主实际返回 `paused=false`，旧脚本仍 exit 0 输出 `deploy complete`）
19. `FAIL N5 record uses real paused readback (false)`（记录写死 `paused:true`，实际 false）
20. `FAIL N5 record keeps health readback`（旧记录无 `healthReadback`）

## 4. 关键原始证据摘录（来自 old-commit-negative-fails.log）

- N1 EISDIR 崩溃栈（旧 `set_pointer` 对普通目录 rename symlink）：
  `Error: EISDIR: illegal operation on a directory, rename '.../.lib-new-7084' -> '.../instance/hephi/lib'`
- N5 旧脚本输出：`deploy complete; host remains paused; ...`，随后记录 JSON 为 `"paused":true`（硬编码），无 load/healthReadback。
- N2 旧脚本输出：`rollback target release is invalid: <HEAD sha>`（隐式 HEAD 默认值生效）。
- N4 旧脚本输出：`deploy complete; host remains paused; ...` 且记录 `result:"ok"`。

## 5. 未验证 / 限制（如实标注）

- 阶段 1 只证明“旧提交失败”方向；新提交通过（positive direction）属阶段 2，需等 Lead 提供最终提交 SHA，尚未执行。
- N4 在旧提交上的实测退出码为 0（部署被接受、写 ok 记录），而不是复核报告预测的“原始 42 退出”。本证据只陈述该原始观测：无论根因是旧脚本此前缺少 `failed-restored-previous`/恢复失败保护，还是该世界场景本身未被旧脚本走到，结论都是**旧脚本无法通过新 N4 断言**。N4 在修复提交上的表现需在阶段 2 复核。
- 证据目录内 `fail-list.txt` 为 FAIL 断言名（去掉明细）清单；`artifact-hashes.txt` 记录被测旧脚本与新测试快照的 sha256。
