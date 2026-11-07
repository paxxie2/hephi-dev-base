# R3 修复验证记录（2026-11-07）

对应 `HEPHI-R2-remediation-checklist.md` R3（不可变部署、自动回滚、全量健康门禁）与 R4.3 的文档要求：逐条登记命令、退出码、证据路径、复核者和局限。**假宿主测试通过 ≠ 真实宿主验收通过**；R3.7 真实宿主项全部保持未验证。

> **结论变更（2026-11-07 追加，原文不改）**：PR #20 独立复核判定 **R3 不通过**——原实现 44 断言全过，但 5 组独立负例复现 R3-F1–F6 缺陷（`PR20-independent-review.md` §3）。因此 §2–§5 的“44 断言 PASS / R3 机制已覆盖”只保留为**原实现时点事实**，**不再作为 R3 完成或允许进入 R3.7 的依据**。当前状态：「原实现被独立复核判定不通过 → 已返修（提交 `240961395ce0fb323683bab21830fbdc123257d8`）并补负例 N1–N5」。**双向均已实测**：修复提交上 `PASS: 69 assertions`、FAIL 0、exit 0（`real 84.23s`）；旧提交 `17d3827` 上扩展套件 exit 1、PASS 50 / FAIL 19（复跑一致）。**本次只关闭 R3-F1–F6 与 N1–N5 自动化；R3.7 真实宿主（A→B→A、实载回读、故障注入、真实 drain 语义）仍未验证，PR #20 未合并。** 逐条登记见 [`docs/remediation-r3-review-fix.md`](remediation-r3-review-fix.md)。**R3.7 与 P8 真实验收仍未通过。**

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 起始基线 | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（`main`，PR #19 合并） |
| 修复分支 | `agent/hephi-r2-remediation`（**已推送 origin；PR #20 OPEN、未合并**） |
| R1 提交 | `9e874f85c995b945f8408be46f51fb34661ebaa2` |
| R2 提交 | `0d7c031e24ec9aed16cf296a99336e501d3c1fac` |
| R3 提交（原实现，复核判定不通过） | `0d58bc39ed246c6c9084766c6b495ce2300795d4`（parent `0d7c031`；`R3: immutable releases, atomic pointer switch, full health gate with auto-rollback`） |
| R3 复核审查提交 | `17d3827d3a73d3afb7a3b8de130d1615bd351769`（R4 文档同步提交；独立复核 `Request changes`） |
| **R3 返修提交** | **`240961395ce0fb323683bab21830fbdc123257d8`**（`R3 remediation: fix F1-F6 from PR #20 independent review`；父提交 `17d3827`；仅改 `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`，+376/−101（3 文件）） |
| **R3 返修后断言总数／N1–N5 组数** | **69 条断言** = 主套件 46（原 44 + 2 条记录真实性）+ 负例 23（N1 4／N1b 3／N2 5／N3 4／N4 4／N5 3）；即负例 **N1／N1b／N2／N3／N4／N5 六组**（复核要求 N1–N5，返修补 N1b） |
| R3 改动文件 | `scripts/host/deploy-hephi.sh`（重写）、`scripts/host/test-deploy-hephi.mjs`（新增）、`hephi/tests/control/deploy-script.test.ts`（新增），+559/−114 |
| 执行环境（实测） | **Node `v22.19.0`**、pnpm `11.7.0`（与方案指定一致；本机经 nvm 切换复核） |
| 真实宿主 | 宿主 B `http://127.0.0.1:3083`；**本记录未对其执行任何部署/回滚操作** |

## 2. 实际执行的命令与退出码

| 命令 | 环境 | 退出码 | 结果摘要 |
| --- | --- | --- | --- |
| `node scripts/host/test-deploy-hephi.mjs` | Node `v22.19.0` | 0 | `PASS: 44 assertions (R3 fake-host suite)`；`real 49.55s`（R3 实现者记录 `50.22s`）——**原实现时点事实**；该 44 断言已被独立复核证明不覆盖 R3-F1–F6 失败路径 |
| `pnpm test`（全量，含 `deploy-script.test.ts`） | Node `v22.19.0` / pnpm `11.7.0` | 0 | **20 文件 / 202 tests passed**；start `06:51:38`，duration `52.15s`；其中 `deploy-script.test.ts` 1 test 用时 `51857ms`（R3 实现者单独运行记录 `50.49s`） |
| `pnpm exec vitest run tests/control/deploy-script.test.ts`（R3 实现者执行） | Node `v22.19.0` | 0 | 1 passed，`50.49s`（Lead 提供的原始输出） |
| `node scripts/host/test-deploy-hephi.mjs`（**返修后**，含 N1–N5） | Node `v22.19.0`／pnpm `11.7.0` | **0** | **`PASS: 69 assertions`，FAIL 0**；`real 84.23s`（Lead 独立复跑；实现者两次 `83.15s`／`83.35s`） |
| `pnpm test`（**返修后**全量） | Node `v22.19.0`／pnpm `11.7.0` | 0 | **20 文件 / 202 tests passed**；其中 `deploy-script.test.ts` 1 test 约 **85.7s**（假宿主门禁等待变长，属预期；不新增测试文件） |
| `cd hephi && pnpm check`（**返修后** = typecheck+test+build） | Node `v22.19.0`／pnpm `11.7.0` | `cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） | 构建须在干净树运行（R2 起 dirty 树拒绝构建；当前 `docs/` 改动使工作树 dirty），因此本轮未跑构建 |
| `node scripts/host/test-deploy-hephi.mjs`（**新套件 × 旧提交 `17d3827`**，独立克隆 `/tmp/pr20-verify-old`） | Node `v22.19.0`／pnpm `11.7.0` | **1** | **PASS 50 / FAIL 19**（`FAILED: 20 assertion(s)`）；复跑逐条一致 → negative direction 成立；FAIL 清单见返修登记 §3.2 |

证据路径：本轮复核输出在 `/tmp/r3-fakehost.log`、`/tmp/r3-pnpm-test.log`（本机临时目录，不入库）；44 条断言原文见 §5。R3 实现者的原始输出未随提交归档。返修后的原始输出：negative 方向在 `external-review/evidence/pr20-fix/`（仓库外：`old-commit-negative-fails.log`、`.run2.log`、`fail-list.txt`、`README-phase1.md`、`artifact-hashes.txt`）；positive 方向（`PASS: 69 assertions`）原文由 Lead 实测、`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`（`pnpm check`）、`lead-pnpm-test-dirty-tree.log`（`pnpm test`）；本文档执行者另以 Node `v22.19.0` 独立复跑一次该套件 → **exit 0，`PASS: 69 assertions`**。

## 3. R3.1 八条不变量落实矩阵

来源：`scripts/host/deploy-hephi.sh` 头部不变量注释 + 实现；假宿主断言编号见 §4。

| # | 不变量 | 实现（`deploy-hephi.sh`） | 假宿主证据 | 真实宿主 |
| --- | --- | --- | --- | --- |
| 1 | `releases/<fullSHA>/` 发布成功后 `lib/` 与 `meta.json` 永不改写；同 SHA 再发布必须失败 | `build_release` 先查 `releases/$sha` 已存在即失败；发布走 `.incoming-<sha>-<pid>` + 校验 + 单次 `mv` | R3-T02、T16 | **未验证** |
| 2 | 构建在独立临时目录（`git archive` 干净源码）完成，不在实载 `$hephi/lib` 上构建 | `build_release`：`mktemp` → `git archive <sha>` → `HEPHI_BUILD_COMMIT=<sha> pnpm install --frozen-lockfile && pnpm check` → 清理 | R3-T01 | **未验证** |
| 3 | 实载切换只使用已发布且校验通过的 release；校验失败不得停止当前宿主 | `release_validate`（meta 字段/目录名/`entrySha256`/`hostVersion`）在 `set_pointer` 之前；失败路径不重启 | R3-T03、T04、T05 | **未验证** |
| 4 | 切换后的重启或健康失败自动恢复 previous，并再次全量健康检查 | 失败尾部 `if ! set_pointer(previous或snapshot)` → `restart_instance`（全量健康）→ 记录；返修后恢复目标须 `release_validate` 通过，只有真恢复+全量健康才写 `failed-restored-previous` | R3-T08、T09（原实现）；返修后另有 N3 正向恢复 | **未验证** |
| 5 | 回滚也失败时保持 `paused=true`、非零退出、保留现场与两次健康证据 | 结果拆为 `failed-no-previous` / `failed-restored-previous` / `failed-twice`；记录带 `targetFailure`、`restoreFailure`、`restoreHealth`、真实 `paused` 回读；`fail_keep_paused`，不自动恢复派发 | R3-T10（原实现）；返修后 N4 | **未验证** |
| 6 | 有进行中 Ticket、drain 字段未知或非零时禁止升级；不存在绕过入口 | `drain_ok`（`running`/`queued` 必填为 0；`startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 缺失即 `unverified` 拒绝）+ `open_tickets`>0 拒绝；`--allow-open-tickets` 落入未知参数分支 | R3-T12、T13、T15 | **未验证** |
| 7 | 成功退出也不自动恢复派发；由操作者核对后手动恢复 | 成功/回滚结束时经 `paused_now()` 回读真实 `paused`；非 `true` 即写 `failed-not-paused` 并非零退出，不伪造 `true`；脚本提示需手动经 API 恢复 | R3-T17（记录真实性断言）、N5 | **未验证** |
| 8 | 文件哈希只证明磁盘内容，不等于实载 commit；无回读入口时 P8 真实验收保持未通过 | 成功记录字段 `loadedCommitReadback: "unverified"` | 假宿主仅验证磁盘 | **未验证**（宿主无 `describePlugin` 回读入口） |

## 4. R3-T01–T17 假宿主结果

脚本：`scripts/host/test-deploy-hephi.mjs`（只使用临时目录、假 start 脚本、假状态响应、临时 git 仓库；不访问 3082/3083、不触碰真实 release）。**原实现时点 44 断言全部 PASS**。

> **复核更正**：该 44 断言不覆盖以下失败路径——首次从普通 `lib/` 目录迁移（F1）、rollback 缺 `--target`（F2）、未执行恢复却记 restored（F3）、恢复 rename 失败（F4）、真实 paused 冲突（F5）、current 校验失败仍被当恢复目标（F6）。返修已新增 N1／N1b／N2／N3／N4／N5 六组负例，最终套件 **69 条断言全绿**（主套 46 + 负例 23）；旧提交上 **PASS 50 / FAIL 19**。

| 用例 | 假宿主断言 | 假宿主结果 | 是否真实验证 |
| --- | --- | --- | --- |
| R3-T01 首次发布 | 退出 0、release A `lib/` 存在、meta 字段齐全、指针指向 A（4 条） | PASS | 否（仅假宿主） |
| R3-T02 同 SHA 重发 | 非零、哨兵与 release 字节不变、未重启（3 条） | PASS | 否 |
| R3-T03 target 缺失 | 切换前失败、指针/进程不变（1 条） | PASS | 否 |
| R3-T04 SHA 不符 | meta 与目录名不符拒绝（1 条） | PASS | 否 |
| R3-T05 内容篡改 | 入口哈希不符拒绝、不切换（1 条） | PASS | 否 |
| R3-T06 正常切换 A→B | 退出 0、指针为 B、A 未变（3 条） | PASS | 否 |
| R3-T07 顺序回切 B→A | 退出 0、指针为 A、两 release 不可变（2 条） | PASS | 否 |
| R3-T07b（清单外补充） | 显式 `--rollback` 退出 0、回滚记录存在（2 条） | PASS | 否 |
| R3-T08 重启失败 | 非零、自动恢复 A 且保持 paused（2 条） | PASS | 否 |
| R3-T09 健康失败 | `github=starting` 不得判成功、指针恢复 A（2 条） | PASS | 否 |
| R3-T10 回滚也失败 | 非零、保持 paused 且两次失败均记录（2 条） | PASS | 否 |
| R3-T11 dry-run | 退出 0、不切换/不重启（1 条） | PASS | 否 |
| R3-T12 进行中 Ticket | open Tickets>0 拒绝（1 条） | PASS | 否 |
| R3-T13 绕过入口 | `--allow-open-tickets` 作为未知参数拒绝（1 条） | PASS | 否 |
| R3-T14 hostVersion 缺失 | 缺失/空值在构建或停止宿主前失败（1 条） | PASS | 否 |
| R3-T15 排空状态 | `running`/`queued`/`startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 各自非零与未知均拒绝（14 条） | PASS | 否 |
| R3-T16 不可变总校验 | 全部场景后 A/B release SHA256 与操作前一致（1 条） | PASS | 否 |
| R3-T17 记录完整 | 成功、失败记录完整（2 条）；回滚记录见 T07b | PASS | 否 |

> 假宿主通过只证明**脚本机制**：临时 Git 仓库与假 HTTP 状态。它不证明真实宿主的实载 commit、真实 API 字段语义或真实故障恢复。

## 5. 44 条断言原文

```text
PASS R3-T01 first publish exits 0
PASS R3-T01 release A lib exists
PASS R3-T01 meta fields complete
PASS R3-T01 pointer points to release A
PASS R3-T02 republish fails
PASS R3-T02 sentinel and release unchanged
PASS R3-T02 no restart
PASS R3-T03 missing target fails before switch
PASS R3-T04 meta/dir SHA mismatch rejected
PASS R3-T05 content tamper rejected
PASS R3-T06 switch to B exits 0
PASS R3-T06 pointer is B
PASS R3-T06 release A unchanged
PASS R3-T07 switch back to A exits 0
PASS R3-T07 pointer is A; both immutable
PASS R3-T11 dry-run exits 0 and does not switch/restart
PASS R3-T12 open tickets refuse
PASS R3-T13 --allow-open-tickets is an unknown argument
PASS R3-T14 missing/empty hostVersion rejected
PASS R3-T15 nonzero running refused
PASS R3-T15 unknown running refused
PASS R3-T15 nonzero queued refused
PASS R3-T15 unknown queued refused
PASS R3-T15 nonzero startupReservations refused
PASS R3-T15 unknown startupReservations refused
PASS R3-T15 nonzero effects refused
PASS R3-T15 unknown effects refused
PASS R3-T15 nonzero jobs refused
PASS R3-T15 unknown jobs refused
PASS R3-T15 nonzero subagents refused
PASS R3-T15 unknown subagents refused
PASS R3-T15 nonzero unknown refused
PASS R3-T15 unknown unknown refused
PASS R3-T08 restart failure exits nonzero
PASS R3-T08 auto-restores A and stays paused
PASS R3-T09 github=starting is not accepted as success
PASS R3-T09 pointer restored to A
PASS R3-T10 double failure exits nonzero
PASS R3-T10 stays paused with both attempts recorded
PASS R3-T17 success record complete
PASS R3-T17 failure record complete
PASS R3-T16 releases A/B unchanged after all scenarios
PASS R3-T07b explicit rollback exits 0
PASS R3-T07b rollback record exists

PASS: 44 assertions (R3 fake-host suite)
```

## 6. 未验证清单（不得写成通过）

| 项 | 状态 | 原因／后续 |
| --- | --- | --- |
| R3.7 真实宿主 A→B→A 部署与回滚 | **未验证** | 本记录未对 B 执行任何部署；需真实暂停/排空后执行并保存原始输出（返修后仍未执行） |
| 实载 commit 回读 | **未验证** | 宿主无 `describePlugin`／版本查询入口；成功记录已明确标 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代 |
| 受控健康故障注入与自动回滚（真实宿主） | **未验证** | 假宿主 T08–T10 与返修 N1b/N3/N4/N5 只证明脚本机制 |
| 真实宿主暂停期受控 Issue smoke、恢复后健康/load | **未验证** | R3.7 第 6 项未做 |
| drain 真实 API 字段语义 | **未验证** | `startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 仅在假宿主按字段存在性验证；真实 API 是否提供、语义是否一致未确认（缺失即拒绝，不按 0） |
| 真实 `hostVersion` 来源 | **未验证** | 仅验证必填/单行校验；真实固定宿主配置快照的取值未在本轮采集 |
| `git archive` 干净构建在真实仓库 | **未验证** | 假宿主使用临时 Git 仓库；真实仓库构建由部署流程在真实宿主验收时验证 |
| 真实宿主上的普通 `lib/` 目录首次迁移 | **未验证** | N1／N1b 使用临时目录夹具；真实实例当前已是 symlink 布局 |
| R3-F6 current 校验失败不得被当恢复目标 | **未验证（无动态负例）** | 仅静态拆分 `current_valid`，本轮未补注入用例 |
| 返修后的独立二次复核 | **未做** | 需独立会话按复核报告 §6 门槛复跑；本文件不能替代 |
| 独立验收（非实现者重新克隆复跑 R5.2／R5.4） | **已由独立复核执行，结论 request changes** | 见 §8；返修需二次复核 |

## 7. 复核者

| 角色 | 身份 | 时间（+08:00） |
| --- | --- | --- |
| R3 实现 | `0d58bc3` 作者（DSH Agent） | 2026-11-07 06:50 |
| 命令复跑与本记录 | `docs-r4` 执行 Agent（Node `v22.19.0`） | 2026-11-07 06:51–06:53 |
| 独立复核（原实现） | 外部独立复核 Agent（审查提交 `17d3827`，独立工作树复跑 + 故障注入） | 2026-11-07；结论 **Request changes**（见 §8） |
| R3 返修实现 | Lead（`deploy-hephi.sh` 重写 + `test-deploy-hephi.mjs` 扩展，提交 `2409613`） | 2026-11-07（提交后实测 69 断言全绿） |
| 返修文档登记 | `r3-docs` 执行 Agent | 2026-11-07 07:37 |
| 返修二次独立复核 | **未做** | 需独立会话按 §6 门槛复跑 |

> 结论（返修后时点）：R3 原实现被独立复核判定**不通过**（R3-F1–F6）；返修提交 `2409613` 已把 N1–N5 纳入自动化，**假宿主套件 69 断言全绿、旧提交 20 条 FAIL（双向实测）**。但**假宿主通过 ≠ 真实宿主验收**：R3.7（A→B→A 切换、实载 commit 回读、真实故障注入、真实 drain 语义）仍未验证，P8 仍为部分；`docs/p8-deploy-record.md` 与本文件均保留该边界。**本次只关闭 F1–F6 与 N1–N5 自动化，不代表 R3 整体通过，也不代表 PR #20 可合并。**

## 8. 独立复核结论与返修登记（2026-11-07 追加）

- 复核报告：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md`（仓库外）。
- 结论：**R1／R2 代码层通过；R3 不通过**；PR #20 **不批准合并**，不得进入 R3.7。
- R3 被列出的缺陷与返修登记：R3-F1（普通 `lib` 目录迁移 EISDIR，阻断）、R3-F2（rollback 隐式 HEAD）、R3-F3（无恢复却记 restored）、R3-F4（恢复 rename 失败绕过双失败路径）、R3-F5（paused 硬编码 `true`）、R3-F6（current 校验结果被忽略）。逐条根因／修复／负例／行为差异见 [`docs/remediation-r3-review-fix.md`](remediation-r3-review-fix.md)。
- 复核提出的负面用例 N1–N5（含返修补充的 N1b 迁移第二步失败）已纳入仓库自动化 `scripts/host/test-deploy-hephi.mjs` 的 `runNegativeSuite()`；最终套件 **69 条断言全绿**（exit 0，`real 84.23s`），旧提交上 **PASS 50 / FAIL 19**。
- 返修提交：**`240961395ce0fb323683bab21830fbdc123257d8`**（3 文件：`scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`；wrapper 断言 44→69）；父提交为复核审查提交 `17d3827`。全量 `pnpm test` → **20 文件 / 202 tests**（`deploy-script.test.ts` 约 85.7s）；`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）。**本次只关闭 R3-F1–F6 与 N1–N5 自动化；R3.7 真实宿主仍未验证；PR #20 未合并。**
- **negative direction 已实测**（r3-verify 阶段 1）：独立克隆 `17d3827` + 新套件 → `exit 1`、`PASS 50 / FAIL 19`、复跑 FAIL 集合逐条一致；其中 N1 复现 `EISDIR`（与复核一致），N4 在旧提交上表现为 `code=0` 写 `result:ok`（非静态推演的裸 42），N5 旧脚本在 `paused=false` 时仍 exit 0 且记录硬编码 `paused:true`。原始日志在 `external-review/evidence/pr20-fix/`（仓库外）。
- 复核 §6 的 7 条重新送审门槛中，仍有多条未完全满足（previous 非法 SHA 负例、状态/健康读取失败注入、`failed-no-previous` 字段校验、完整 `pnpm check` 最终输出、二次独立复核），如实记录见返修登记 §3.1，不得在重新送审前写成满足。
- 不变项：R1／R2 代码层结论不变；P2、P5 仍为部分；**P8 仍为部分**；人类负责人签收未做。
