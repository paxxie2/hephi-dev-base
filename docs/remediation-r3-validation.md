# R3 修复验证记录（2026-11-07）

对应 `HEPHI-R2-remediation-checklist.md` R3（不可变部署、自动回滚、全量健康门禁）与 R4.3 的文档要求：逐条登记命令、退出码、证据路径、复核者和局限。**假宿主测试通过 ≠ 真实宿主验收通过**；R3.7 真实宿主项全部保持未验证。

> **结论变更（2026-11-07 追加，原文不改）**：PR #20 独立复核判定 **R3 不通过**——原实现 44 断言全过，但 5 组独立负例复现 R3-F1–F6 缺陷（`PR20-independent-review.md` §3）。因此 §2–§5 的“44 断言 PASS / R3 机制已覆盖”只保留为**原实现时点事实**，**不再作为 R3 完成或允许进入 R3.7 的依据**。当前状态：「原实现被独立复核判定不通过 → 已返修（提交 `240961395ce0fb323683bab21830fbdc123257d8`）并补负例 N1–N5」。**双向均已实测**：修复提交上 `PASS: 69 assertions`、FAIL 0、exit 0（`real 84.23s`）；旧提交 `17d3827` 上扩展套件 exit 1、PASS 50 / FAIL 19（复跑一致）。**本次只关闭 R3-F1–F6 与 N1–N5 自动化；R3.7 真实宿主（A→B→A、实载回读、故障注入、真实 drain 语义）仍未验证（已在 2026-11-07 09:18 尝试 → blocked，见 §10/§11）；PR #20 已合并为 `main@bc3386c`（其后 PR #21 `5b6fb6e`、PR #22 `8fd199d` 已合并，审查基准 `main@8fd199d`，PR #23 合并后以 `git log` 为准）。** 逐条登记见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §9。**R3.7 与 P8 真实验收仍未通过。**
>
> **R37 二次复核（2026-11-07，审查 `8fd199d`；原文不改，追加）**：F1–F6 直接修复有效、`pnpm check` exit 0、69 断言独立复跑通过；但动态复现 **X1–X3** 三项失败语义缺陷，并验证 P1–P3 行为正确但仅在仓库外测试；R3.7 blocked 判定正确；实载 commit 仍未证明。**X1–X3 关闭前不得进入真实验收**。**R3.8 返修提交 `cfb5a187ad950170b1900b302c0d1f54530f3fe0`（父 `8fd199d`）已完成**：扩展套件 **97 断言**（原 69 + 新 28：X1 5／X2 7／X3 7／P1 3／P2 2／P3 4）；双向实测——旧 `8fd199d` → exit 1、10 FAIL（全为 X1–X3），`cfb5a18` → `PASS: 97 assertions`、exit 0；隔离克隆 `pnpm check` exit 0（20/202，Build 1840ms）。**对 `cfb5a18` 的二次独立复核未做**。逐条登记见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12。

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 起始基线 | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（`main`，PR #19 合并） |
| 修复分支 | `agent/hephi-r2-remediation`（**已推送 origin；PR #20 已于 2026-11-07 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）**） |
| R1 提交 | `9e874f85c995b945f8408be46f51fb34661ebaa2` |
| R2 提交 | `0d7c031e24ec9aed16cf296a99336e501d3c1fac` |
| R3 提交（原实现，复核判定不通过） | `0d58bc39ed246c6c9084766c6b495ce2300795d4`（parent `0d7c031`；`R3: immutable releases, atomic pointer switch, full health gate with auto-rollback`） |
| R3 复核审查提交 | `17d3827d3a73d3afb7a3b8de130d1615bd351769`（R4 文档同步提交；独立复核 `Request changes`） |
| **R3 返修提交** | **`240961395ce0fb323683bab21830fbdc123257d8`**（`R3 remediation: fix F1-F6 from PR #20 independent review`；父提交 `17d3827`；仅改 `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`，+376/−101（3 文件）） |
| **R3 返修后断言总数／N1–N5 组数** | **69 条断言** = 主套件 46（原 44 + 2 条记录真实性）+ 负例 23（N1 4／N1b 3／N2 5／N3 4／N4 4／N5 3）；即负例 **N1／N1b／N2／N3／N4／N5 六组**（复核要求 N1–N5，返修补 N1b） |
| R3 改动文件 | `scripts/host/deploy-hephi.sh`（重写）、`scripts/host/test-deploy-hephi.mjs`（新增）、`hephi/tests/control/deploy-script.test.ts`（新增），+559/−114 |
| 执行环境（实测） | **Node `v22.19.0`**、pnpm `11.7.0`（与方案指定一致；本机经 nvm 切换复核） |
| 真实宿主 | 宿主 B `http://127.0.0.1:3083`；**§2–§9 未对其执行任何部署/回滚操作**；R3.7 真实宿主尝试见 §10（2026-11-07 09:18，结果 **blocked**） |

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
| R3.7 真实宿主 A→B→A 部署与回滚 | **blocked（已尝试）** | 2026-11-07 对 B 执行暂停→部署尝试→恢复；部署在排空门禁被 fail-closed 拒绝（见 §10），未构建/未切换/未重启；A→B→A 与故障注入因此未执行 |
| 实载 commit 回读 | **未验证** | 宿主无 `describePlugin`／版本查询入口；成功记录已明确标 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代 |
| 受控健康故障注入与自动回滚（真实宿主） | **未验证** | 假宿主 T08–T10 与返修 N1b/N3/N4/N5 只证明脚本机制 |
| 真实宿主暂停期受控 Issue smoke、恢复后健康/load | **未验证** | R3.7 第 6 项未做 |
| drain 真实 API 字段语义 | **未验证（实测缺失）** | 真实 `/orchestrator/api/state` 的 `load` 只有 `running/queued/maxWorkers`；`startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 不存在，脚本按 `unverified` 拒绝（§10） |
| 真实 `hostVersion` 来源 | **未验证** | 无固定宿主版本快照定义；尝试时仅用实验性标识 `dsh-0.2.1-rc.5+composed-config-4b20291e9ba9`，未采纳为正式语义 |
| `git archive` 干净构建在真实仓库 | **未验证** | 假宿主使用临时 Git 仓库；真实仓库构建由部署流程在真实宿主验收时验证 |
| 真实宿主上的普通 `lib/` 目录首次迁移 | **未验证** | N1／N1b 使用临时目录夹具；**真实实例 `<instance>/hephi-review/hephi/lib` 是普通目录（plain-directory，非 symlink）**——R3.7 preflight、deploy side-effect check 与最终恢复记录均为 `plain-directory`（R37 §7.2 更正），因此首次真实迁移场景仍然存在，只是本轮未在真实旧布局上执行 |
| R3-F6 current 校验失败不得被当恢复目标 | **外部已动态验证，仓库已纳入（待二次独立复核）** | 本轮最初仅静态拆分 `current_valid`；R37 外部追加测试 P1 已动态验证“坏 current 不被恢复”行为正确；仓库自动化已于 R3.8 `cfb5a18` 纳入（P1 3 条断言），双向实测通过（假宿主） |
| 返修后的独立二次复核 | **已完成（R37，2026-11-07，审查 `8fd199d`）** | F1–F6 直接修复有效、`pnpm check` exit 0、69 断言独立复跑通过；但动态复现 X1–X3（双失败仍称 kept paused、恢复阶段复用目标状态、旧目录恢复失败仍称 restored/preserved）→ **R3 仍需返修**，见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12；报告在仓库外 `external-review/R37-independent-review.md` |
| 独立验收（非实现者重新克隆复跑 R5.2／R5.4） | **已由 PR #20 独立复核执行，结论 request changes；R37 二次复核已完成** | 见 §8（PR #20 复核）与 §11（R37）；R3.8 返修后的复核未做 |

## 7. 复核者

| 角色 | 身份 | 时间（+08:00） |
| --- | --- | --- |
| R3 实现 | `0d58bc3` 作者（DSH Agent） | 2026-11-07 06:50 |
| 命令复跑与本记录 | `docs-r4` 执行 Agent（Node `v22.19.0`） | 2026-11-07 06:51–06:53 |
| 独立复核（原实现） | 外部独立复核 Agent（审查提交 `17d3827`，独立工作树复跑 + 故障注入） | 2026-11-07；结论 **Request changes**（见 §8） |
| R3 返修实现 | Lead（`deploy-hephi.sh` 重写 + `test-deploy-hephi.mjs` 扩展，提交 `2409613`） | 2026-11-07（提交后实测 69 断言全绿） |
| 返修文档登记 | `r3-docs` 执行 Agent | 2026-11-07 07:37 |
| 返修二次独立复核 | **已完成**：外部独立复核（R37，审查 `8fd199d`） | 2026-11-07；结论见 §11 与 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12（F1–F6 修复有效，但发现 X1–X3，需 R3.8 返修） |

> 结论（返修后时点，2026-11-07 07:37；PR #20 当时尚未合并）：R3 原实现被独立复核判定**不通过**（R3-F1–F6）；返修提交 `2409613` 已把 N1–N5 纳入自动化，**假宿主套件 69 断言全绿、旧提交 PASS 50 / FAIL 19（双向实测）**。但**假宿主通过 ≠ 真实宿主验收**：R3.7（A→B→A 切换、实载 commit 回读、真实故障注入、真实 drain 语义）仍未验证，P8 仍为部分；`docs/p8-deploy-record.md` 与本文件均保留该边界。**本次只关闭 F1–F6 与 N1–N5 自动化，不代表 R3 整体通过。**（时点后：PR #20 于 2026-11-07 08:29 合并为 `bc3386c`，PR #21 `5b6fb6e`、PR #22 `8fd199d` 相继合并；R37 二次复核发现 X1–X3 → R3.8 返修提交 `cfb5a18`（97 断言、双向实测），待二次独立复核，见 §11。）

## 8. 独立复核结论与返修登记（2026-11-07 追加）

- 复核报告：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md`（仓库外）。
- 结论：**R1／R2 代码层通过；R3 不通过**；PR #20 **不批准合并**，不得进入 R3.7。
- R3 被列出的缺陷与返修登记：R3-F1（普通 `lib` 目录迁移 EISDIR，阻断）、R3-F2（rollback 隐式 HEAD）、R3-F3（无恢复却记 restored）、R3-F4（恢复 rename 失败绕过双失败路径）、R3-F5（paused 硬编码 `true`）、R3-F6（current 校验结果被忽略）。逐条根因／修复／负例／行为差异见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §9。
- 复核提出的负面用例 N1–N5（含返修补充的 N1b 迁移第二步失败）已纳入仓库自动化 `scripts/host/test-deploy-hephi.mjs` 的 `runNegativeSuite()`；最终套件 **69 条断言全绿**（exit 0，`real 84.23s`），旧提交上 **PASS 50 / FAIL 19**。
- 返修提交：**`240961395ce0fb323683bab21830fbdc123257d8`**（3 文件：`scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`；wrapper 断言 44→69）；父提交为复核审查提交 `17d3827`。全量 `pnpm test` → **20 文件 / 202 tests**（`deploy-script.test.ts` 约 85.7s）；`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）。**本次只关闭 R3-F1–F6 与 N1–N5 自动化；R3.7 真实宿主在此时点仍未验证（2026-11-07 09:18 已尝试 → blocked，见 §10）；PR #20 已于 2026-11-07 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）。**
- **negative direction 已实测**（r3-verify 阶段 1）：独立克隆 `17d3827` + 新套件 → `exit 1`、`PASS 50 / FAIL 19`、复跑 FAIL 集合逐条一致；其中 N1 复现 `EISDIR`（与复核一致）；**N4 的退出码须按日志区分为两个时点**——早期改前快照（`old-commit-negative-fails.log`/`.run2.log`，2026-11-07T07:35/07:40）为 `code=0` 写 `result:ok`；**最终套件**（`old-commit-final-suite.log`、`old-commit-final-4664e96-suite.log`、`old-commit-final-7f50c13-suite.log`，07:54 起）为 `code=42`；两者均说明旧实现无法通过 N4 断言，19 FAIL 总数不受影响。N5 旧脚本在 `paused=false` 时仍 exit 0 且记录硬编码 `paused:true`。原始日志在 `external-review/evidence/pr20-fix/`（仓库外）。
- 复核 §6 的 7 条重新送审门槛中，时点状态（2026-11-07 07:37）：previous 非法 SHA 负例、状态/健康读取失败注入、`failed-no-previous` 字段校验等仍部分；完成 `pnpm check` 最终输出与二次独立复核后已由 R37 复核（§11）——R37 结论为 F1–F6 修复有效，但新发现 X1–X3，**门槛 3–5 的失败语义并未关闭**；R3.8 `cfb5a18` 已实现并由 X1–X3 断言双向实测（假宿主），**待二次独立复核**，不得在复核前写成满足。
- 不变项：R1／R2 代码层结论不变；P2、P5 仍为部分；**P8 仍为部分**；人类负责人签收未做。

---

## 9. R3 返修登记：PR #20 独立复核 R3-F1–F6 与负例 N1–N5（2026-11-07）

对应 PR #20 独立复核报告 `/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md`（仓库外，不随提交归档）的第 3 节（R3-F1–F6）与第 6 节（重新送审门槛）。本文件逐条登记：复核根因 → 修复实现 → 对应负例与断言 → 修复前后行为差异。

> **状态（2026-11-07，返修提交 `2409613` 后更新）**
>
> - 提交：返修**已提交**为 **`240961395ce0fb323683bab21830fbdc123257d8`**（`R3 remediation: fix F1-F6 from PR #20 independent review`，父提交 `17d3827`；改动 3 文件：`scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`（wrapper 断言 `44` → `69`）；`git show --stat 2409613`：3 files changed, +376/−101）。分支 `agent/hephi-r2-remediation` 已推送 `origin`（`17d3827`），**PR #20 已创建（已于 2026-11-07 08:29 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20））**；返修提交 `2409613` 已推送并追加到 PR #20。本文件等文档改动随本文件所在提交（docs）提交。（时点后：PR #21 `5b6fb6e`、PR #22 `8fd199d` 已合并，审查基准 `main@8fd199d`（PR #23 合并后以 `git log` 为准）；R37 二次复核见 §11。）
> - 验证：**旧提交方向（negative）已由独立验证者 r3-verify 实测**——扩展套件在 `17d3827` 上 exit 1、PASS 50 / FAIL 19（见 §3.2）；**修复提交方向（positive）已全绿**——`node scripts/host/test-deploy-hephi.mjs` → **`PASS: 69 assertions`，FAIL 0，exit 0**；Lead 独立复跑 `real 84.23s`（实现者两次 `83.15s`/`83.35s`），构成：主套件 46（原 44 + 2 条真实回读）+ 负例 23。全量 `pnpm test` → **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`）；`pnpm check` 的 typecheck+test+build 最终输出：`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）。
> - **假宿主修复通过 ≠ R3.7 真实宿主验收**。本文任何结论都不改变：R3.7 真实宿主 A→B→A、实载 commit 回读、真实健康故障注入、真实 drain 字段语义全部 **unverified**；P8 真实验收 **仍为部分（未通过）**。
> - R1／R2 复核结论不变：代码层通过（见复核报告 §5），不因 R3 返修重新开启。

### 1. 复核结论与本轮返修范围

| 项 | 复核结论（`17d3827`） | 本轮处置 |
| --- | --- | --- |
| R1 activation v2 哈希 | 代码层通过（30 用例） | 未改动 |
| R2 dirty 构建拒绝与 commit 身份 | 代码层及独立真实路径通过 | 未改动 |
| R3 不可变部署与自动回滚 | **不通过**：F1–F6；原 44 断言全过但 5 组独立负例全部复现缺陷 | 修复 F1–F6；N1–N5（含 N1b）纳入仓库自动化；重新验证命令见 §4 |
| 合并状态 | PR #20 **不批准合并**，不得进入 R3.7 | PR #20 已于 2026-11-07 08:29 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）；返修提交 `2409613` 追加到同一 PR。时点后 PR #21 `5b6fb6e`、PR #22 `8fd199d` 已合并，当时 `main@8fd199d`（R3.8 由 PR #23 送审/合并后以 `git log` 为准） |

范围声明：本轮只改 `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs` 与 `hephi/tests/control/deploy-script.test.ts`（wrapper 断言计数 44→69；Lead 实现，提交 `2409613`），本文件及其余 `docs/` 记录为只读登记；**未改产品源码、未在真实宿主执行任何部署/回滚**。

**本次返修关闭的范围（不得扩大解释）**：只关闭复核报告列出的 **R3-F1–F6** 并把 **N1–N5（含 N1b）** 纳入仓库自动化。**R3.7 真实宿主验收（A→B→A 切换、实载 commit 回读、真实健康故障注入、真实 drain 字段语义）在此时点仍未验证（2026-11-07 09:18 已尝试 → blocked，见 §10）**；PR #20 已于 2026-11-07 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）。

**因果链（本文件的核心事实，不得颠倒）**：

1. **原实现 44 断言全绿**（`0d58bc3`，2026-11-07 06:51 实测），但**独立复核在同一审查提交 `17d3827` 上用 5 组独立负例 5/5 复现缺陷**（N1 普通目录首迁 EISDIR 直接阻断部署 → F1；隐式 HEAD → F2；未恢复却记 restored → F3；恢复 rename 失败绕过双失败 → F4；`paused` 硬编码 → F5；另有静态确认的 F6）。**“原套件全绿”因此不构成 R3 通过**，这正是本次返修的直接触发原因。
2. **返修后必须双向可判**：同一扩展套件在**旧提交**上应失败（negative direction，阶段 1 最终套件已实测 **PASS 50 / FAIL 19**（改前快照为 20 条），r3-verify 已完成补强重跑）、在**修复提交**上应通过（positive direction，`PASS: 69 assertions` / exit 0，Lead 复跑并留档；**阶段 2：Lead 已在隔离克隆（`/tmp/hephi-lead-check` @ `2409613`）复跑 `pnpm check` → exit 0、`PASS: 69 assertions`；R37 二次复核又在 `main@8fd199d` 上独立复跑同样 69 断言通过（`external-review/evidence/r37-independent/delivery-verification.log`），不以其结果替代机制结论**）。
3. 即使双向都成立，**只证明脚本机制**，R3.7 真实宿主仍 **unverified**、P8 仍为部分、PR #20 已合并（`bc3386c`；时点后 PR #21/#22 合并，审查基准 `main@8fd199d`，PR #23 合并后以 `git log` 为准）。

### 2. R3-F1–F6 逐条登记

#### R3-F1｜首次从普通 `lib` 目录迁移必然 `EISDIR`（阻断）

- **复核根因**：旧 `snapshot_existing_lib()` 对普通目录只做 `cp -R`，原 `$hephi/lib` 仍留在原地；随后 `set_pointer()` 把临时 symlink `renameSync` 到 `$hephi/lib`，目标是非空/普通目录 → `EISDIR`，脚本 exit 1，部署无法完成。旧测试夹具只建空的 `$hephi` 目录，从未创建普通 `lib/`，故 44 断言绕过该真实旧布局。
- **修复（`deploy-hephi.sh`）**：`set_pointer()` 内新增**普通目录迁移事务**：检测 `[ -d "$hephi/lib" ] && [ ! -L "$hephi/lib" ]` 时，先 `mv` 旧目录到 `$hephi/.migration-<UTC>-<pid>`（同文件系统原子改名，路径记入 `MIGRATION_BACKUP`），再 `renameSync` 新 symlink；**第二步失败**则 `mv "$migration" "$hephi/lib"` 恢复旧目录、删除临时 symlink 并 `return 1`。所有 `set_pointer` 调用点改为 `if ! set_pointer ...`，失败写 `failed-pointer` 记录并保持暂停。`snapshot_existing_lib()` 的复制快照保留（供后续回滚边界使用），但不再承担指针切换前的清场职责。
- **对应负例**：

  | 负例 | 断言 | 结果 |
  | --- | --- | --- |
  | **N1** 普通 `lib/`（含 `legacy.mjs`）首次部署 | `N1 plain-lib first deploy exits 0`；`N1 lib becomes symlink to release A`；`N1 migration backup keeps old lib content`；`N1 success record keeps migration evidence`（4 条） | 旧提交 4/4 FAIL（`EISDIR`，见 §3.2）；修复提交：**PASS**（整套 69 全绿） |
  | **N1b** 注入迁移第二步 `renameSync` 失败 | `N1b migration rename failure exits nonzero`；`N1b old plain lib directory restored`（目录类型为普通目录且 `legacy.mjs` 存在）；`N1b failure record written`（`failed-pointer`）（3 条） | 旧提交 1/3 FAIL（无记录，另两条“碰巧”通过，见 §3.2）；修复提交：**PASS** |

- **修复前后行为差异**：修复前普通目录首迁 → `renameSync` `EISDIR`、exit 1、旧 `lib` 原样保留、无部署记录；修复后 → 旧目录原子挪到 `.migration-*`、指针切到 release、exit 0、旧内容保留在备份、记录含 `migration` 字段；第二步失败时 → 旧目录被恢复、非零退出、写 `failed-pointer`，不留悬空指针。

#### R3-F2｜`--rollback` 缺 `--target` 时隐式回滚到仓库 HEAD（高）

- **复核根因**：旧脚本先把空 `target` 默认成 `git rev-parse HEAD`，之后才检查 rollback 参数；检查时 `target` 已非空，无法区分“调用者显式提供”与“脚本补默认”。实测只给 `--rollback --previous A` 会 exit 0 并切到 HEAD 对应 release，违反 R3.3。
- **修复**：参数解析新增 `target_set` / `previous_set` 标记；在**主流程最前**（`mkdir -p` 之后、读取宿主状态与任何 HEAD 默认值之前）集中校验：`rollback=yes` 时要求 `target_set=yes`（否则 `--rollback needs an explicit --target release (no implicit HEAD default)`）、`is_sha` 完整 40 位、且若给了 `--previous` 也必须是完整 SHA；任一不满足即 `fail_keep_paused` 非零退出且**无副作用**。普通部署未指定 target 时仍允许取 HEAD（该默认被限制在 rollback 分支之外）。
- **对应负例**：**N2**（5 条）——`N2 setup: release A loaded`；`N2 rollback without --target rejected`（非零且输出含 `--target`）；`N2 empty rollback target rejected`（非零且输出含 `full 40-char SHA`）；`N2 invalid rollback target rejected`（`abc`）；`N2 rejected rollbacks have no side effects`（指针、启动次数、记录条数与调用前完全一致）。旧提交 3/5 FAIL（隐式 HEAD + 有副作用，见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前缺 target → 静默取 HEAD、切换指针、写 `result=ok` 回滚记录；修复后 → 在停止宿主/切换指针之前非零拒绝，指针与进程不变，不产生任何记录。

#### R3-F3｜未执行恢复也记录/输出 “previous build restored”（高）

- **复核根因**：旧代码只有 `current` 非空且目录存在才尝试恢复，但无论是否进入该分支，后续都写 `failed-restored-previous` 并输出 `previous build restored`；rollback 恢复目标用 `current` 而不是调用者显式提供且已校验的 `--previous`，记录里 `previous` 常为空字符串。
- **修复**：结果状态拆分为 `failed-no-previous` / `failed-restored-previous` / `failed-twice`。回滚失败后的恢复目标选择：显式 `--previous`（已校验）→ 否则 `current` **且仅当 `current_valid=yes`** → 都无可恢复目标时写 `failed-no-previous`（不声称已恢复）。只有“指针恢复成功 + `restart_instance` 全量健康通过”才写 `failed-restored-previous`，并带 `restoreHealth: all-required-ready`、`targetFailure: <目标阶段真实状态>`、`previous: "<kind>:<target>"`。
- **对应负例**：**N3**（4 条）——`N3 rollback failure exits nonzero`；`N3 restore record only after real pointer restore`（记录存在**且**指针确为 `releases/A/lib`、`previous` 以 `previous:` 开头）；`N3 record keeps target failure health evidence`（`targetFailure` 含 `health`）；`N3 record keeps restore health evidence`（`restoreHealth === all-required-ready`）。夹具刻意把 `$hephi/lib` 换成普通空目录以模拟“无 current 指针”，并让目标 release 健康失败。旧提交 3/4 FAIL（该世界因普通目录 `EISDIR` 直接退出、未恢复未记录，见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前 → 无恢复也写 `failed-restored-previous`、输出“已恢复”、`previous` 为空；修复后 → 无恢复写 `failed-no-previous`，真恢复才写 `failed-restored-previous` 且带两段健康证据，恢复目标语义统一为显式 previous 或通过校验的 current。

#### R3-F4｜恢复指针自身失败绕过统一双失败路径（高）

- **复核根因**：普通部署与 rollback 的恢复 `set_pointer` 调用均无错误捕获，脚本 `set -e`；恢复阶段 symlink rename 失败按静态推演会直接以原始退出码（负例注入为 42）退出，不写任何记录，指针停在失败目标，不进入 `failed-twice`。
- **修复**：所有 `set_pointer` 调用（目标切换与恢复切换）都包在 `if ! set_pointer ...` 内；恢复失败写 `failed-twice` 记录并带 `targetFailure`（目标阶段）+ `restoreFailure`（恢复阶段真实错误），再 `fail_keep_paused` 非零退出。另新增 `FAIL_STATE`/`LAST_STATE`/`HEALTH_STATE` 传递，把两次失败的真实宿主状态带回记录。
- **对应负例**：**N4**（4 条）——`N4 recovery rename failure exits nonzero without raw 42`（非零且不等于注入的 42）；`N4 double-failure record written`；`N4 record keeps both failure evidences`（`targetFailure` 非空且 `restoreFailure` 含 `pointer restore`）；`N4 double-failure record keeps real paused readback`。注入方式：PATH 前置 node 垫片，只让**第 2 次** `renameSync` 失败（第 1 次是目标切换）。旧提交 4/4 FAIL——**退出码按日志分时点**：早期改前快照（`old-commit-negative-fails.log`/`.run2.log`）为 `code=0` + `result:"ok"`；最终套件（`old-commit-final-7f50c13-suite.log` 等）为 `code=42`，见 §3.2；修复提交：**PASS**（`failed-twice` 记录与两段证据符合断言）。
- **修复前后行为差异**：修复后 → 非零业务退出码、`failed-twice` 记录含两段错误与真实 paused 回读、保持暂停等待人工接管。**修复前实测（r3-verify 阶段 1，2026-11-07）**：早期改前快照中该负例在旧提交上 `exit 0`、部署被接受并写 `result:ok`（`health:"all-required-ready"`），**不是复核报告静态推演的“裸 42 退出”**——旧实现根本没走到恢复分支；**最终套件在旧提交上该断言实际观测为 `code=42`**（`old-commit-final-7f50c13-suite.log:102`），说明两者都说明旧实现无法通过 N4 断言；修复提交上 N4 **PASS**（整套 69 全绿）。

#### R3-F5｜暂停状态与双失败健康证据不可信（高）

- **复核根因**：`record()` 无条件写 `paused:true`，从不重新读取宿主状态（负例中假宿主实际 `paused=false, health ready`，记录仍写 `true` 并输出 `host remains paused`）；双失败分支写 `health:"not-checked"`，没有保存两次实际健康响应，与“双份健康证据”要求不符。
- **修复**：`record()` 写盘前调用 `read_state`，把真实 `paused`（布尔；读不到写 `"unverified"`）、`load`、`healthReadback` 写入记录；新增 `paused_now()`，成功路径与 rollback 成功路径在 `restart_instance` 之后再回读 `paused`，**不等于 `true`** 时写 `failed-not-paused` 记录并 `fail_keep_paused` 非零退出（不伪造 `true`）。`restart_instance` 记录最后一次可读状态供 `targetFailure` 使用；双失败记录使用 `restoreHealth` / `restoreFailure` 取代 `not-checked`。
- **对应负例**：**N5**（3 条）——`N5 deploy refuses success when host is not paused`（假宿主在 start 后写入 `resumed.marker` 并真实返回 `paused=false`）；`N5 record uses real paused readback (false)`；`N5 record keeps health readback`（`healthReadback.runtime.state === 'ready'`）。另在主套新增 2 条记录真实性断言：`R3-T17 success record uses real paused/load/health readback`（`paused===true`、`load.running===0`、`healthReadback` 10 项且 `github.state==='ready'`）、`R3-T08 restored record keeps both health evidences`（`restoreHealth` + `targetFailure` + 真实 paused）。旧提交 N5 3/3 FAIL、主套 2/2 FAIL（见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前 → 记录恒 `paused:true`，可与真实状态相反；修复后 → 记录来自结束时回读，读不到即 `unverified`，宿主未保持暂停时部署按失败处理且非零退出。

#### R3-F6｜current release 校验结果被显式忽略（高；静态确认）

- **复核根因**：`[ -n "$current" ] && release_validate "$releases/$current" || true` 吞掉校验失败，后续仅检查 `current/lib` 目录存在就把它当恢复目标，未通过 meta／SHA／入口哈希校验的构建也可能被恢复。
- **修复**：把“继续 rollback”和“允许恢复 current”拆成两个判断。指针解析后单独计算 `current_valid`（`release_validate` 通过为 `yes`，否则 `no`，失败不再被 `|| true` 吞掉语义）；rollback 恢复目标只接受**显式 `--previous`** 或 **`current_valid=yes` 的 current**，其余走 `failed-no-previous`；显式 `--previous` 也先 `release_validate`，不通过即 `fail_keep_paused rollback previous release is invalid`。
- **对应负例**：**无专属动态负例**（本轮未补）。复核报告本身也只做了静态确认（“未单独做动态负例”）。现状：N3 覆盖“无 current 指针 → 用显式 previous 恢复”，不覆盖“current 存在但校验不通过 → 不得作为恢复目标”。该分支由代码静态检查保证，并由 N3／N4 的恢复目标选择路径**间接**经过（两例都走显式 previous，未直接打到“current 校验失败”分支）。口径确认：**测试证据仍不充分，标 unverified-by-test**（Lead 2026-11-07 确认按此写）。**R37 追加测试 P1 已在外部动态验证该行为正确**（坏 current 不被恢复、写 `failed-no-previous`），R37 要求纳入仓库自动化 → 已纳入 R3.8 `cfb5a18`（P1 3 条断言），待二次独立复核（见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12 §6）。
- **修复前后行为差异**：修复前 → 校验失败的 current 仍可能被恢复；修复后 → 只有通过校验的 current 才可作为恢复目标，否则只记 `failed-no-previous`。

### 3. N1–N5 已纳入仓库自动化

新增负例全部写在 `scripts/host/test-deploy-hephi.mjs` 的 `runNegativeSuite()`，与主套件分离：每个负例独立 `initWorld()` 建临时目录 + 独立假宿主服务，`closeWorld()` 清理；假宿主状态服务、`start.sh`、临时 git 仓库均为隔离夹具，**不访问 3082/3083、不触碰真实 release**。

| # | 对应用例 | 覆盖复核缺陷 | 共享夹具要点 |
| --- | --- | --- | --- |
| N1 | `plain-lib` 首次迁移成功 | R3-F1 | `initWorld({plainLib:true})` 预建含 `legacy.mjs` 的普通 `lib/` |
| N1b | 迁移第二步失败恢复旧目录 | R3-F1 | node 垫片注入第 1 次 `renameSync` 失败 |
| N2 | rollback 缺参／空值／非法 SHA 无副作用 | R3-F2 | 比较指针、启动次数、记录条数快照 |
| N3 | 无 current 时用显式 previous 真恢复 | R3-F3 | `lib` 换普通空目录、目标健康失败 |
| N4 | 恢复指针失败进入双失败路径 | R3-F4 | node 垫片注入第 2 次 `renameSync` 失败 |
| N5 | 成功路径回读真实 paused | R3-F5 | `initWorld({pauseOnStart:true})` + `resumed.marker` 使假宿主真实返回 `paused=false` |

最终套件共 **69 条断言** = 主套件 46（原 44 + 2 条记录真实性断言）+ 负例 23（N1 4、N1b 3、N2 5、N3 4、N4 4、N5 3）。
返修提交上实测：**`PASS: 69 assertions`，FAIL 0，exit 0**；`real 84.23s`（Lead 独立复跑；实现者两次 `83.15s`／`83.35s`）。
旧提交 `17d3827` 上（改前快照，同样 69 条）：**PASS 50 / FAIL 19**，逐组见 §3.2。

#### 3.1 与复核 §6「重新送审最低门槛」对照

| 门槛 | 覆盖情况 | 状态 |
| --- | --- | --- |
| 1. 修复 F1–F6 且 N1–N5 入仓库自动化；旧提交应失败、修复提交应通过 | N1–N5 已入 `runNegativeSuite()`；**旧提交应失败已实测**（最终套件 exit 1、PASS 50 / FAIL 19，见 §3.2）；**修复提交应通过已实测**（`PASS: 69 assertions`，FAIL 0，exit 0） | 满足（双向均有实测；旧提交最终套件补测已完成：`old-commit-final-suite.log`／`old-commit-final-7f50c13-suite.log`） |
| 2. 增加“目标健康失败 → previous 恢复 → 全量健康 ready”正向恢复用例 | N3 覆盖 rollback 分支的正向恢复（`restoreHealth=all-required-ready`）；普通部署分支的正向恢复仍只有 T08（进程启动失败）/T09（健康失败→指针恢复） | 部分（R37 外部 P3 已验证普通部署分支行为；已纳入 R3.8 `cfb5a18` 自动化，P3 4 条断言，待二次独立复核） |
| 3. rollback target／previous 参数级负例（缺参、空值、非法 SHA 均无副作用） | N2 覆盖 target 三种负例 + 无副作用断言；**previous 的非法 SHA 负例未单独覆盖**（仅代码校验） | 部分（R37 外部 P2 已验证行为；已纳入 R3.8 `cfb5a18` 自动化，P2 2 条断言，待二次独立复核） |
| 4. 恢复 rename、状态读取、健康读取分别注入失败 | rename：N1b／N4 已注入；**状态读取失败、健康读取失败未单独注入**（N5 是状态“可读但值相反”） | 部分（R37 X2 暴露状态读取失败时复用旧状态的缺陷；R3.8 `cfb5a18` 已修复，X2 7 条断言双向实测，待二次独立复核） |
| 5. 成功／恢复成功／无 previous／双失败记录分别校验真实 paused、health、load、pointer、previous、错误 | 成功：T17 新断言；恢复成功：N3／T08 新断言；双失败：N4；**无 previous 记录字段未单独校验** | 部分（R37 X1 暴露双失败 paused 输出不真实；R3.8 `cfb5a18` 已修复，X1 5 条断言双向实测，待二次独立复核） |
| 6. Node `22.19.0`／pnpm `11.7.0` 下完整 `pnpm check`、扩展假宿主套件、复核负例 | 扩展套件已实测（69 断言全绿，`84.23s`）；全量 `pnpm test` 20 文件 / 202 tests；**完整 `pnpm check`（含构建）**：`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） | **通过**（R37 又在 `main@8fd199d` 独立复跑 `pnpm check` exit 0、69 断言通过） |
| 7. 代码审查通过后才进入 R3.7 真实宿主验收 | R3.7 已于 2026-11-07 09:18 尝试，在排空门禁 **blocked**（未构建/未切换/未重启，随后恢复派发）；R37 确认 blocked 判定正确 | **已尝试 → blocked**；R3.7 保持 **unverified**（不是“未开始”） |

> 说明：上表“部分”是如实口径，不得在重新送审前被改写为“满足”；时点更新：门槛 1／6 的实跑结果已完成（见上），门槛 7 的状态由“未开始”更正为“已尝试 → blocked”。R37 复核（§11）在门槛 1–6 之外发现 **X1–X3** 三个失败语义缺陷，新增最低条件见 R37 §8 与 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12 §7。

#### 3.2 旧提交对照（negative direction）实测：新套件在 `17d3827` 上必须失败

来源：独立验证者 `r3-verify`（只读仓库，阶段 1），证据目录
`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/evidence/pr20-fix/`。

| 项 | 值 |
| --- | --- |
| 独立克隆 | `/tmp/pr20-verify-old`（`git clone --no-hardlinks`，detached HEAD） |
| 被测提交 | `17d3827d3a73d3afb7a3b8de130d1615bd351769`；`deploy-hephi.sh` 保持原样，sha256 `8a8a1eb290b7b569edf3a059e0a2b872389ed41f8aad3e0c55127b83676f8f83`（快照 `deploy-hephi.old-17d3827.sh`） |
| 被测套件 | 主工作树当时的新套件拷入覆盖旧测试；快照 `test-deploy-hephi.new-suite-snapshot.mjs`，sha256 `e0f495d58d5c1d97b80d5a5ad913ac8242f07e9785ecaeaba562489eed03a6ca`（**69 条断言** = PASS 49 + FAIL 20）。**注意**：最终提交 `2409613` 中的套件 sha256 为 `ef703f2598b614ed1a0c554a27e188d65c0263f2ace402081b125394cec7a621`，与快照不同（调绿时的最后调整），但断言总数同为 69；旧提交上的最终套件重跑已完成：**exit 1、PASS 50 / FAIL 19**（`old-commit-final-suite.log`、`old-commit-final-4664e96-suite.log`、`old-commit-final-7f50c13-suite.log`；以 7f50c13 版为准），与快照 20 FAIL 的差异仅 N2 side-effects 一条 |
| 环境／命令 | Node `v22.19.0`、pnpm `11.7.0`；`cd /tmp/pr20-verify-old && node scripts/host/test-deploy-hephi.mjs` |
| 首跑结果 | **exit 1**；`PASS 50 / FAIL 19`；`FAILED: 20 assertion(s)` |
| 复跑结果 | **exit 1**；同样 20 FAIL / 49 PASS，FAIL 断言名集合与首跑 `diff` 无差异（结果确定，非偶发） |

FAIL 分组（20 条，全部由新断言捕获）：

| 组 | FAIL／总数 | 失败断言 | 旧实现实测表现（原始观测） |
| --- | --- | --- | --- |
| 主套件真实回读 | 2／2 | `R3-T17 success record uses real paused/load/health readback`；`R3-T08 restored record keeps both health evidences` | 记录只有 `paused:true` 与 `health:"all-required-ready"`，无 `load`／`healthReadback`／`restoreHealth`／`targetFailure` |
| N1 普通 `lib/` 首迁 | 4／4 | 退出 0、lib 变 symlink、备份保留旧内容、成功记录含 migration | **exit 1 + `EISDIR: illegal operation on a directory, rename '.../.lib-new-*' -> '.../hephi/lib'`**；`lib` 仍是普通目录，无 `.migration-*` |
| N1b 迁移第二步失败 | 1／3 | `N1b failure record written` | 无 `failed-pointer` 记录；另两条“碰巧”通过（旧实现从不移动旧目录、`set -e` 直接退出），**不代表旧实现满足恢复语义** |
| N2 rollback 缺参 | 3／5 | 缺 `--target` 拒绝、空 target 拒绝、无副作用 | `target` 被隐式替换为仓库 HEAD，输出 `rollback target release is invalid: <HEAD sha>`；有副作用（`starts=1 records=1`） |
| N3 未真恢复却记 restored | 3／4 | 仅真恢复才记 restored、目标失败健康证据、恢复健康证据 | 该世界 `lib` 为普通目录 → 旧 `set_pointer` **EISDIR 直接退出**，未恢复、未写记录 |
| N4 恢复 rename 失败 | 4／4 | 非零且非裸 42、双失败记录、两段证据、真实 paused 回读 | **按日志分时点**：早期改前快照（`old-commit-negative-fails.log`/`.run2.log`）为 **`code=0`：部署被接受并写 `result:"ok"`**；最终套件（`old-commit-final-7f50c13-suite.log:102` 等）为 **`code=42`**（`FAIL N4 recovery rename failure exits nonzero without raw 42 :: code=42`）。**不是复核静态推演的裸 42 断言失败原因**，但两种日志都说明旧实现无法通过 N4 断言 |
| N5 真实 paused 回读 | 3／3 | 拒绝未暂停成功的部署、记录真实 `paused=false`、保留 `healthReadback` | 假宿主实际返回 `paused=false`，旧脚本仍 exit 0 输出 `deploy complete; host remains paused`，记录写死 `"paused":true` 且无 `healthReadback` |

结论（negative direction 成立）：新负例套件在旧提交上**真实失败**，不是“自证通过”；`N1` 的 `EISDIR` 与复核报告独立复现一致。

限制（如实标注）：

- 阶段 1 **只证明“旧提交必失败”**（改前快照）；**positive direction 已由 Lead 与本文档执行者在返修提交内容上实测**（`PASS: 69 assertions`、exit 0）；**阶段 2 的独立克隆复跑已完成**：Lead 在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 复跑 `pnpm check` exit 0，R37 二次复核在 `main@8fd199d` 独立复跑 69 断言通过；旧提交 × **最终套件**的重跑也已完成（`old-commit-final-7f50c13-suite.log`：exit 1、PASS 50 / FAIL 19）。
- **N4 退出码时点说明（R37 §7.1 更正）**：早期改前快照（`old-commit-negative-fails.log`/`.run2.log`，2026-11-07T07:35/07:40）为 `code=0` + `result:ok`；**最终套件**（`old-commit-final-suite.log`、`-4664e96`、`-7f50c13`，07:54 起）为 `code=42`。交接/旧文档只引用了早期快照而称“N4 是 exit 0”，不适用于最终套件；正确表述为**区分两个时点**，19 FAIL 总数不变。
- 本证据目录在仓库外，不随提交归档；快照 sha256 见 `artifact-hashes.txt`。

### 4. 验证命令与证据

| 项 | 值 |
| --- | --- |
| 返修分支 | `agent/hephi-r2-remediation`（已推送 origin；PR #20 已于 2026-11-07 08:29 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）；时点后 PR #21 `5b6fb6e`、PR #22 `8fd199d` 已合并，当时 `main@8fd199d`（R3.8 由 PR #23 送审/合并后以 `git log` 为准），R3.8 返修分支 `agent/r3.8-remediation` 基于此） |
| 返修提交 | **`240961395ce0fb323683bab21830fbdc123257d8`**（父提交 `17d3827d3a73d3afb7a3b8de130d1615bd351769`；提交信息 `R3 remediation: fix F1-F6 from PR #20 independent review`） |
| 改动文件 | `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`（wrapper 断言 44→69）；`git show --stat 2409613`：3 files changed，+376/−101 |
| 扩展假宿主套件 | `node scripts/host/test-deploy-hephi.mjs` → **`PASS: 69 assertions`，FAIL 0，exit 0**；`real 84.23s`（Lead 复跑；实现者 `83.15s`／`83.35s`）；Node `v22.19.0`、pnpm `11.7.0` |
| 全量测试（`pnpm test`） | Node `v22.19.0`／pnpm `11.7.0` → **20 文件 / 202 tests passed**；其中 `deploy-script.test.ts` 1 test 约 **85.7s**（假宿主门禁等待变长属预期；不新增测试文件） |
| 完整检查（`pnpm check` = typecheck+test+build） | `cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） |
| 旧提交对照（negative） | **已实测**：独立克隆 `17d3827` + 新套件 → **exit 1，PASS 50 / FAIL 19**，复跑一致；详见 §3.2 |
| 修复提交对照（positive） | **已实测**：返修提交上同一套件 `PASS: 69 assertions`、FAIL 0、exit 0（`84.23s`）；`pnpm check` 最终输出`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） |
| 原始输出归档 | negative 方向证据：`external-review/evidence/pr20-fix/`（`old-commit-negative-fails.log`、`.run2.log`、`fail-list.txt`、`README-phase1.md`、`artifact-hashes.txt`，仓库外）；positive 方向（69 断言全绿）的原始输出：`external-review/evidence/pr20-fix/`（`lead-clean-tree-pnpm-check.log`、`lead-pnpm-test-dirty-tree.log`；Lead 复跑） |

### 5. 未验证清单（不得写成通过）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| R3.7 真实宿主 A→B→A 部署与回滚 | **blocked（已尝试，未执行）** | 2026-11-07 09:18 真实暂停→部署尝试→恢复：在排空门禁被 fail-closed 拒绝（真实 `load` 仅 `running/queued/maxWorkers`），未构建/未切换/未重启，随后恢复派发（见 §10）；A→B→A 本身因此**未执行** |
| 实载插件 commit 回读 | **unverified** | 宿主仍无版本查询入口；成功记录保持 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代（R37 §6：磁盘一致 ≠ 内存实载一致） |
| 真实健康故障注入与自动回滚 | **unverified** | N1b/N3/N4/N5 只证明脚本机制（假宿主 + 注入垫片）；R37 追加 X1–X3 证明部分失败语义仍不真实；R3.8 `cfb5a18` 已修复（X1–X3 断言双向实测），仍未在真实宿主验证 |
| 真实 drain 字段语义 | **unverified** | `startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 只在假宿主按字段存在性验证；真实 API 实测缺失（§10） |
| 真实普通目录迁移 | **unverified** | N1/N1b 是临时目录夹具；**真实实例 `hephi/lib` 是普通目录（plain-directory，非 symlink；R37 §7.2 更正）**，首次真实迁移场景仍然存在，但本轮未在真实旧布局上执行 |
| R3-F6 的动态负例 | **外部已验证，仓库自动化已纳入（待二次独立复核）** | 仅静态确认 + 代码拆分；N3／N4 只间接经过恢复目标选择路径（均用显式 previous），未直接覆盖“current 存在但校验失败”分支；R37 外部 P1 已动态验证行为正确；已纳入 R3.8 `cfb5a18` 仓库自动化（P1 3 条），待二次独立复核 |
| previous 非法 SHA 负例、状态/健康读取失败注入、`failed-no-previous` 字段校验 | **已由 R3.8 `cfb5a18` 处置（待二次独立复核）** | 见 §3.1 门槛 3–5；R37 外部 P2 验证非法 previous 行为正确，X2 暴露状态读取失败缺陷；R3.8 新增 P2 2 条／X2 7 条断言，双向实测通过（假宿主） |
| 修复提交正向通过（positive direction，阶段 2） | **已实测（假宿主）** | 返修提交 `2409613` 内容上 `PASS: 69 assertions`、exit 0（Lead 复跑 `84.23s`；**本文档执行者亦独立复跑确认 `PASS: 69 assertions`、exit 0**）；**R37 又在 `main@8fd199d` 独立复跑 69 断言通过**（`external-review/evidence/r37-independent/delivery-verification.log`）；N4 修复后行为已由断言覆盖。**这不等于真实宿主验收** |
| 旧提交 × **最终**套件重跑 | **已完成** | 阶段 1 的 20 条 FAIL 用的是改前快照（同样 69 断言、sha256 不同）；最终套件在 `17d3827` 重跑：**exit 1、PASS 50 / FAIL 19**（`old-commit-final-suite.log`、`old-commit-final-4664e96-suite.log`、`old-commit-final-7f50c13-suite.log`）；与改前快照 20 FAIL 的差异仅 N2 的 side-effects 一条在旧脚本上变 PASS；**最终套件中 N4 观测为 `code=42`**（早期快照为 `code=0`） |
| 独立复核（对本返修的二次复核） | **已完成（R37，2026-11-07，审查 `8fd199d`）** | 结论：F1–F6 修复有效、69 断言复跑通过，但发现 X1–X3 → R3 仍需返修（见 §11 与 `docs/remediation-r3-validation.md` §12）；R3.8 修复后的复核**未做** |
| P8 真实验收 | **仍为部分（未通过）** | 假宿主全绿不改变 P8 状态 |

### 6. 复现方式（只读）

```sh
cd /Users/zm/dsh-instances/experiment/hephi-review
git log --oneline -3                      # 当前分支 agent/r3.8-remediation，HEAD=cfb5a18（R3.8 修复提交，父=8fd199d）
git status --porcelain=v1                 # R3.8 工作树：只应有 docs/ 的未提交改动（scripts/ 已提交为 cfb5a18）
git diff -- scripts/host/deploy-hephi.sh scripts/host/test-deploy-hephi.mjs
node scripts/host/test-deploy-hephi.mjs   # 主套件 + N1–N5 + R3.8 新增组；预期 PASS: 97 assertions
```

复现 negative direction（r3-verify 阶段 1 的做法，只读）：

```sh
git clone --no-hardlinks https://github.com/paxxie2/super-agent-hephi-review.git /tmp/pr20-verify-old
cd /tmp/pr20-verify-old && git checkout 17d3827d3a73d3afb7a3b8de130d1615bd351769
# 把主工作树的新套件拷入（覆盖旧测试），旧 deploy-hephi.sh 保持不动
cp /Users/zm/dsh-instances/experiment/hephi-review/scripts/host/test-deploy-hephi.mjs scripts/host/test-deploy-hephi.mjs
node scripts/host/test-deploy-hephi.mjs   # 预期 exit 1；FAIL 清单见 §3.2
```

> 本文件不修改任何历史失败记录：`docs/remediation-r3-validation.md` §5 的 44 条断言原文与 `docs/p8-deploy-record.md` 的旧脚本真实部署记录均原样保留，仅追加复核不通过与返修事实。

## 10. R3.7 真实宿主尝试（2026-11-07，结果：blocked）

对宿主 B（`http://127.0.0.1:3083`，pid `29031`，启动 05:47:12，dsh 0.2.1-rc.5）真实执行了暂停→排空→部署尝试→恢复，结果 **blocked / unverified**：

| 步骤 | 真实结果 |
| --- | --- |
| 暂停 | `POST /orchestrator/api/executor/pause {"paused":true}` → 1s 内 `paused=true`、load `0/0`、10 项 health 全 ready |
| 排空检查 | **失败（预期 fail-closed）**：真实 `load` 只有 `running/queued/maxWorkers`，5 个排空字段缺失 → `unverified drain field: startupReservations; … effects; jobs; subagents; unknown` |
| 部署尝试（dry-run，target `main@5b6fb6e`） | **exit 1**，`drain check failed; refusing to upgrade`；**未构建、未切换指针、未重启**；副作用核对：host.pid 不变、releases 数 6、logs 数 8、`hephi/lib` 普通目录且树哈希不变 |
| 下一道门禁 | 存在 **2 个 open Ticket**（`b3a7d823…` person/answer、`24983dd7…` person/failed）；排空通过也会被拒绝，无绕过入口 |
| 恢复派发 | `{"paused":false}` → 1s 内 `paused=false`、10 项 health 全 ready、load `0/0` |
| hostVersion | 无固定快照定义；尝试仅用 `dsh-0.2.1-rc.5+composed-config-4b20291e9ba9`（dsh 版本 + `logs/composed-config.yml` sha256 前缀），标注为实验性、未采纳 |

**结论**：R3.7 第 3–5 项（真实 A→B→A、实载回读、故障注入回滚）**未执行**，P8 保持未通过。真实排空字段语义与 hostVersion 来源是开放依赖，不是实现缺陷；修复它们需要宿主 API 变更或负责人定义，**不得用默认 0/编造值绕过**。**R37 独立复核确认该 blocked 判定正确**（R37 §5.1：脚本拒绝与既定方案一致，不是“脚本过严”；2 个 open Ticket 构成下一道门禁；代码顺序支持无副作用结论）。

**额外发现（已纠正）**：PR 验收在实载插件目录 `<instance>/hephi-review/hephi` 里跑过 `pnpm check`，构建改写了其 `lib/`，造成磁盘 lib ≠ 已部署 release（磁盘 `5ff4b59b…` vs release entry `fe404c0d…`）。已将被重建目录移到**仓库外** `/Users/zm/dsh-instances/experiment/evidence/live-lib-rebuilt-20261107T011829Z` 保留审计（留在仓库内实测会触发 R2 dirty 构建拒绝），并从 `releases/hephi/fba676e…/lib` 恢复；恢复后 live `lib/index.mjs` = `fe404c0d…`、三处 lib 树哈希一致（`10b49b7b…`）、宿主 health 不变。该事件再次证明**文件哈希 ≠ 实载 commit**（无实载回读入口）。

> **R37 §6 边界确认**：上述磁盘恢复有哈希证据，但**实载 commit 仍未证明**；恢复时宿主为 `paused=false`，“移动旧目录 + 从 release 复制”是**非原子**过程，不能当作标准回滚流程；健康回读不能排除复制窗口内的动态加载风险。运维整改建议见 R37 §6 与 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12 §8.2。**真实 `hephi/lib` 是普通目录（plain-directory，非 symlink）**——R3.7 preflight、deploy side-effect check 与最终恢复记录均为 `plain-directory`（R37 §7.2）。

证据：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/evidence/r3.7-real-host/`。

## 11. R37 独立复核结论与 R3.8 返修（2026-11-07 追加）

- 复核报告（仓库外）：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/R37-independent-review.md`，审查对象 `main@8fd199da1d2437ccc9da90a0cfcca64d1646549d`。
- 结论（R37 §1）：PR #20/#21/#22 合并链与最终 SHA 属实；原 R3-F1–F6 直接缺陷均有有效修复，最终 main 的完整检查与 **69 条假宿主断言独立复跑通过**；**但 R3 仍不宜进入真实部署验收**——追加测试动态复现 **X1–X3** 三项失败语义问题；R3.7 blocked 判定正确；实载 `lib/` 磁盘恢复有哈希证据但实载 commit 未证明；交接与文档有若干事实需更正。
- X1–X3（逐条根因/修复要求/负例登记见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §12）：
  - **X1**：双失败时真实 `paused=false`，脚本仍输出 “host kept paused”（`paused_now()` 只在成功路径调用；`fail_keep_paused` 只打印并退出）。
  - **X2**：恢复阶段读不到状态时，`restoreFailure` 复用目标阶段旧状态（`LAST_STATE` 未在每次尝试开始时清空）。
  - **X3**：普通目录恢复 `mv` 也失败时，仍声称旧目录已恢复、现场已保留（恢复 `mv` 失败被忽略后仍输出 restored/preserved；需新增 N1c）。
- P1–P3：R37 在仓库外追加测试验证行为正确（P1 坏 current 不被恢复、P2 非法 previous 早拒绝、P3 普通部署健康失败后正向恢复），要求纳入仓库自动化；**已纳入 R3.8 `cfb5a18`（P1 3／P2 2／P3 4 条断言），双向实测通过**。
- **R37 §8 最低条件**：X1–X3 修复 + 负例入库（`8fd199d` 应失败、修复提交应通过）；P1–P3 自动化；切换后所有路径统一校验真实 paused；每次重启独立状态；旧目录恢复失败不称 restored；更正 §7 文档事实并重跑 `pnpm check`／扩展套件／独立复核；最后才处理外部解阻项（drain 字段、hostVersion、2 个 open Ticket）。
- **当前状态（2026-11-07 10:40 回填，实测）**：R3.8 返修提交 **`cfb5a187ad950170b1900b302c0d1f54530f3fe0`**（父 `8fd199d`）已完成；扩展套件 **97 断言**（原 69 + 新 28），双向实测旧 `8fd199d` → exit 1、10 FAIL（全为 X1–X3），`cfb5a18` → `PASS 97 / exit 0`；隔离克隆 `pnpm check` exit 0（20/202，Build 1840ms）；`git diff --check 5efd708..cfb5a18` exit 0。**对 `cfb5a18` 的二次独立复核未做（待外部复核）**。**在 X1–X3 通过独立复核前，R3.7 不重启、P8 不得记 done。**

---

## 12. R3.8 复核返修登记：R37 独立复核 X1–X3 与 P1–P3 自动化（2026-11-07）

对应外部独立复核报告 `/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/R37-independent-review.md`（仓库外，审查对象 `main@8fd199da1d2437ccc9da90a0cfcca64d1646549d`）的 §4（X1–X3）、§7（文档更正）与 §8（再次进入真实验收前的最低条件）。本文件只登记返修范围、逐条根因与边界；**假宿主验证通过 ≠ 真实宿主验收**。

> **状态（2026-11-07 10:38 回填；本轮数据均来自真实实测，见 §9 证据）**
>
> - 基准提交：`8fd199da1d2437ccc9da90a0cfcca64d1646549d`（`origin/main`，PR #22 合并提交；PR #20 `bc3386c`、PR #21 `5b6fb6e` 已先合并）。
> - 返修分支：`agent/r3.8-remediation`（基于 `8fd199d` 创建；本文件所在 `docs/` 登记由 Lead 随返修提交一并提交）。
> - **修复提交：`cfb5a187ad950170b1900b302c0d1f54530f3fe0`**（`R3.8 remediation: fix X1-X3 from R37 independent review`；父提交 `8fd199d`；3 文件：`scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`）。
> - 分工：**Lead 修改 `scripts/host/deploy-hephi.sh`（X1–X3 修复）**；**`r38-tests` 扩展 `scripts/host/test-deploy-hephi.mjs`（X1–X3 负例 + P1–P3 自动化）**；本文件及事实更正由 `r38-docs` 负责。三处 write scope 不重叠。
> - **扩展套件：97 断言**（原有 69 未改未删 + 新增 28：X1 5／X2 7／X3 7／P1 3／P2 2／P3 4）；耗时 r38-tests 两次 `2m12.4s`／`2m13.7s`，Lead 复跑 `real 133.24s`。
> - **双向实测**：旧实现 `8fd199d` × 新套件（独立克隆 `/tmp/hephi-r38-old`，旧脚本不动）→ **exit 1、10 FAIL，全部为 X1–X3 缺陷断言**（原 69 条 + P1–P3 全 PASS）；修复提交 `cfb5a18`（独立克隆 `/tmp/hephi-r38-fix`）→ **`PASS: 97 assertions`，exit 0**。
> - **完整 `pnpm check`**（隔离克隆 `cfb5a18`，Node `v22.19.0`／pnpm `11.7.0`）→ **exit 0**：20 文件 / 202 tests passed，`tsdown` `Build complete in 1840ms`；`git diff --check 5efd708..cfb5a18` exit 0。
> - **未完成/未验证**：**二次独立复核（对 `cfb5a18`）尚未做**——本轮只由实现方＋本会话验证，R37 报告是上一轮、不能替代；R3.7 仍为 **blocked**；P8 仍为**部分（未通过）**。**X1–X3 在独立复核前不得写成“已关闭”。**
> - 文档提交：本文件与 §11 所列 docs 更正由 Lead 统一提交（docs 提交 SHA 不在本文档承诺范围内）。

### 1. 依据：R37 独立复核结论摘要

R37 在独立工作树对 `main@8fd199d` 完整复跑，结论（报告 §1–§3）：

| 项 | R37 结论 | 与本文件的关系 |
| --- | --- | --- |
| 合并链 | PR #20／#21／#22 均已合并，最终 SHA `8fd199d` 属实 | 返修基准 |
| 原 R3-F1–F6 | 直接缺陷均有有效修复；最终 main 的 `pnpm check` exit 0、假宿主 **69 断言**独立复跑通过 | 历史结论，不重开 |
| 新增边缘缺陷 | **X1／X2／X3 三项动态复现**（原 69 断言未覆盖） | 本轮返修对象 |
| 外部追加测试 | P1（坏 current 不被恢复）、P2（非法 previous 早拒绝）、P3（普通部署健康失败后正向恢复）本轮 PASS，但当时只在仓库外追加测试中执行 | 已纳入仓库自动化（`cfb5a18`：P1 3 条／P2 2 条／P3 4 条） |
| R3.7 | **blocked 判定正确**：真实 `load` 仅 `running/queued/maxWorkers`，脚本按 `unverified` fail-closed；另有 2 个 open Ticket；hostVersion 无正式定义；未构建/未切换/未重启，随后恢复派发 | 状态边界，不改变 |
| 实载 `lib/` | 磁盘哈希恢复有证据，但**实载 commit 仍未证明**；宿主未暂停时移动+复制目录不是可复用安全回滚流程（§6） | 独立运维风险，见 §8.2 |
| 文档事实 | 最终旧提交套件 N4 原始日志是 `exit 42`（不是 `exit 0`）；真实 `hephi/lib` 是普通目录（不是 symlink）；implementation index 的“当前 main”停留在 PR #20 | 本轮同步更正，见 §11 |

R37 明确：**当前不得把 R3 或 P8 标为真实验收通过**；X1–X3 关闭并把 P1–P3 纳入自动化前，不满足再次进入真实验收的最低条件（报告 §8）。

### 2. 本轮返修范围与状态

| 项 | 内容 | 状态（2026-11-07 10:38，实测数据见 §9） |
| --- | --- | --- |
| 修复 X1–X3 | `scripts/host/deploy-hephi.sh`：`paused_flag`＋`fail_after_switch` 统一失败出口；`restart_instance` 每轮重置状态并分类 `stop-timeout`/`state-unreadable`/`health-timeout`；`set_pointer` 迁移回退用 `MIGRATION_RESTORE` 跟踪并如实报恢复失败 | **已提交（`cfb5a18`）** |
| 新负例 | `scripts/host/test-deploy-hephi.mjs`：X1 5 条／X2 7 条／X3（含新 N1c）7 条 | **已提交（`cfb5a18`）** |
| 纳入 P1–P3 | 同上：P1 坏 current 恢复目标 3 条、P2 非法 previous 2 条、P3 普通部署健康失败后的正向恢复 4 条 | **已提交（`cfb5a18`）** |
| 双向验证 | 旧实现 `8fd199d` × 新套件 → exit 1、10 FAIL（全为 X1–X3 断言，原 69 + P1–P3 全 PASS）；修复提交 `cfb5a18` → `PASS: 97 assertions`、exit 0 | **已完成（实测）** |
| 完整 `pnpm check` | 隔离克隆 `/tmp/hephi-r38-fix` @ `cfb5a18`（Node `v22.19.0`／pnpm `11.7.0`）→ exit 0，20 文件 / 202 tests，`Build complete in 1840ms` | **已完成（实测）** |
| 二次独立复核 | 对 `cfb5a18` 的独立复核（R37 报告是上一轮，不能替代） | **未做（待外部复核）** |

范围声明：本轮只改 `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts` 与登记文档；**未改产品源码、未在真实宿主执行任何部署/回滚**；`pnpm check` 只在**隔离克隆**执行（R37 §6 要求）。历史失败记录（R37 报告、F1–F6、69 断言时点、19 FAIL 时点）原样保留，不回改、不删除。

### 3. X1｜双失败时真实 `paused=false`，脚本仍输出 “host kept paused”

**级别：高；R37 动态复现（`additional-tests.log`: `REPRODUCED X1 ...`）。**

- **代码原因**（`deploy-hephi.sh@8fd199d`）：
  - `paused_now()`（245–250）只在部署/rollback 的**成功路径**调用（部署 364–370、rollback 304–310）。
  - 双失败路径在 334–335、397–398 直接调用 `fail_keep_paused`；该函数（252–255）只打印消息并 `exit 1`，既不重新暂停，也不检查暂停状态。
  - `record()` 会如实写回读的 `paused`，但输出和记录 `error` 字段仍固定声称 “kept paused”。
- **R37 实测**：目标健康失败 + 恢复也健康失败、假宿主真实返回 `paused=false` 时——脚本非零退出；`failed-twice` 记录 `paused=false`；输出仍含 “host kept paused with both errors recorded”。宿主可能已能接新任务，违反脚本不变量 5 与清单 R3.1／R3.4；**不能仅凭非零退出认定“保持暂停”**。
- **修复要求**（R37 §4 X1）：所有切换后的失败出口都回读并处理 `paused`；`false` 或 `unverified` 时写明确的 `failed-not-paused`／人工接管告警，**不得再声称 kept paused**；若设计允许脚本调用暂停 API，应在授权范围内尝试重新暂停并回读确认。
- **对应负例（`cfb5a18` 已入库，5 条断言，实测通过）**：
  1. `double failure exits nonzero`
  2. `failed-twice keeps real paused=false`
  3. `output does not claim kept paused`
  4. `output/record flags host not confirmed paused`
  5. `record keeps keptPaused=no`

  旧实现 `8fd199d` 上该组 **3/5 FAIL**（`old-8fd199d-suite-10fail.log`：输出仍称 kept paused、未标记未确认暂停、记录无 `keptPaused=no`）；修复提交 `cfb5a18` 上 5/5 PASS。
- **状态**：**已修复并双向实测（`cfb5a18`）**；**待二次独立复核**，独立复核前不写成“已关闭”。

### 4. X2｜恢复阶段读不到状态时，`restoreFailure` 复用目标阶段旧状态

**级别：高；R37 动态复现（`REPRODUCED X2 ...`）。**

- **代码原因**：`restart_instance()`（196–216）使用全局 `LAST_STATE`，但每次重启尝试开始时**没有清空**；恢复阶段完全读不到状态时，`FAIL_STATE="$LAST_STATE"` 保留目标阶段最后一次响应（397/334 行的 `restoreFailure "$FAIL_STATE"` 因此可能等于 `targetFailure`）。
- **R37 实测**：让目标 B 返回带 `target-only-evidence` 的健康错误，随后让恢复 A 的状态请求全部失败——`targetFailure` 含目标错误；`restoreFailure` 与 `targetFailure` **完全相等**，也含 `target-only-evidence`；最终 paused 为 `unverified`。这不是两次独立健康证据，而是把旧目标状态误记成恢复失败证据。
- **修复要求**（R37 §4 X2）：每次 restart 尝试重置本阶段状态；区分 `state-unreadable`、停止超时、健康超时和具体健康响应；没有读到恢复状态时写 `unverified` 或明确读取错误，**禁止沿用上一阶段字符串**。
- **对应负例（`cfb5a18` 已入库，7 条断言，实测通过）**：
  1. `restore state unreadable exits nonzero`
  2. `failed-twice record written`
  3. `targetFailure keeps target-phase evidence`
  4. `targetFailureKind recorded`
  5. `restoreFailureKind state-unreadable or restoreFailure unverified`
  6. `restoreFailure is not the target-phase string`
  7. `unverified paused path does not claim kept paused`

  旧实现 `8fd199d` 上该组 **4/7 FAIL**（`old-8fd199d-suite-10fail.log`：`targetFailureKind` 未记录、`restoreFailureKind` 非 `state-unreadable`/`restoreFailure` 非 `unverified`、`restoreFailure` 复用 target 字符串、unverified paused 仍称 kept paused）；修复提交 `cfb5a18` 上 7/7 PASS。
- **状态**：**已修复并双向实测（`cfb5a18`）**；**待二次独立复核**。

### 5. X3｜普通目录恢复 `mv` 也失败时，仍声称旧目录已恢复、现场已保留

**级别：高；R37 动态复现（`REPRODUCED X3 ...`）。**

- **代码原因**（`set_pointer()`，133–143）：普通目录迁移第二步（symlink rename）失败时执行
  `mv "$migration" "$hephi/lib" 2>/dev/null || echo "cannot restore ..." >&2`，随后**无条件**输出
  `old lib directory restored` 并 `return 1`（138–141）。无论恢复 `mv` 是否成功，都会声称已恢复；上层随后仍输出 “previous state preserved”，记录也只有泛化的 `failed-pointer`。
- **R37 实测**：同时注入 symlink rename 失败和旧目录恢复 `mv` 失败——`$hephi/lib` 最终不存在；输出同时包含 `cannot restore plain lib directory` 与 `old lib directory restored`；上层仍声称 “previous state preserved”；记录未表达旧目录恢复失败。
- **修复要求**（R37 §4 X3）：把旧目录恢复失败作为**独立双失败结果**，记录实际目录／指针、备份位置和两个错误；只有恢复 `mv` 成功并核对旧内容后，才能输出 restored／preserved；新增 N1c 覆盖该双重故障。
- **对应负例：新 N1c（`cfb5a18` 已入库，7 条断言，实测通过）**：
  1. `migration restore double failure exits nonzero`
  2. `live lib is absent after failed migration restore`
  3. `migration backup keeps legacy content`
  4. `failed-pointer record marks migrationRestore failed`
  5. `failed-pointer record carries migration backup path`
  6. `output does not claim restored or preserved`
  7. `output states restore failure and backup path`

  旧实现 `8fd199d` 上该组 **3/7 FAIL**（`old-8fd199d-suite-10fail.log`：记录未标 `migrationRestore=failed`、输出仍称 restored/preserved、未说明恢复失败与备份路径）；修复提交 `cfb5a18` 上 7/7 PASS。
- **状态**：**已修复并双向实测（`cfb5a18`）**；**待二次独立复核**。

### 6. P1–P3 纳入仓库自动化

R37 在仓库外追加测试（`r37-additional-tests.mjs`、`evidence/r37-independent/additional-tests.{log,json}`）已验证以下三项行为**当前正确**，但只在外部测试中执行；R37 §3 与 §8 第 2 条要求纳入仓库自动化，避免文档继续标为 missing。

| 项 | R37 验证内容（PASS） | 当前状态 |
| --- | --- | --- |
| **P1（F6 动态负例）** | 篡改 current 入口后 rollback 目标失败，脚本未恢复坏 current，写 `failed-no-previous` | **已纳入仓库自动化（`cfb5a18`，3 条断言）**，修复提交上 PASS；旧实现 `8fd199d` 上该组 PASS（R37 行为本就正确） |
| **P2（非法 previous）** | `--rollback --target <合法SHA> --previous abc` 在读取宿主/切换之前拒绝，无记录、无副作用 | **已纳入仓库自动化（`cfb5a18`，2 条断言）**，修复提交上 PASS；旧实现 `8fd199d` 上 PASS |
| **P3（普通部署健康失败后正向恢复）** | 目标 B 健康失败，恢复 A 后全量健康 ready，记录 `restoreHealth=all-required-ready` | **已纳入仓库自动化（`cfb5a18`，4 条断言）**，修复提交上 PASS；旧实现 `8fd199d` 上 PASS |

纳入后断言总数 **97** = 原 69 + 新增 28（X1 5／X2 7／X3 7／P1 3／P2 2／P3 4）；双向实测见 §2／§10 与证据 `external-review/evidence/r3.8/`。**P1–P3 已由仓库内自动化证明（假宿主），仍不等于真实宿主验收。**

### 7. R37 §8「再次进入真实验收前的最低条件」对照

| # | 门槛 | 当前覆盖/状态（2026-11-07 10:38，实测数据见 §10） |
| --- | --- | --- |
| 1 | 修复 X1–X3，负例加入仓库；`8fd199d` 上应失败、修复提交上应通过 | **满足（假宿主双向实测）**：旧实现 `8fd199d` × 新套件 → exit 1、10 FAIL（全为 X1–X3 断言，原 69 + P1–P3 全 PASS）；修复提交 `cfb5a18` → `PASS: 97 assertions`、exit 0 |
| 2 | P1–P3 纳入自动化 | **满足（假宿主）**：P1 3／P2 2／P3 4 条断言在 `cfb5a18` 套件中通过 |
| 3 | 所有切换后的成功／恢复成功／无 previous／双失败路径统一校验真实 paused；false／unverified 不得输出 kept paused | **已实现并由 X1 断言覆盖（`cfb5a18`）**；待二次独立复核 |
| 4 | 每次重启尝试独立保存状态与错误；注入恢复阶段状态不可读，证明不复用 target 状态 | **已实现并由 X2 断言覆盖（`cfb5a18`）**；待二次独立复核 |
| 5 | 注入旧目录恢复 `mv` 失败，证明不输出 restored／preserved，记录双失败与备份位置 | **已实现并由 X3／N1c 断言覆盖（`cfb5a18`）**；待二次独立复核 |
| 6 | 更正 §7 交接与文档事实，重新执行完整 `pnpm check`、扩展假宿主套件与独立复核 | **文档更正已执行**（本文件 + §11 所列文件；HANDOFF 在仓库外不属本轮范围）；完整 `pnpm check` 隔离克隆 `cfb5a18` → exit 0（20/202，Build 1840ms）、扩展套件 97 断言 exit 0、`git diff --check 5efd708..cfb5a18` exit 0；**二次独立复核未做（待外部复核）** |
| 7 | 代码门槛关闭后再处理外部解阻项：真实 drain 字段语义、正式 hostVersion、2 个 open Ticket；不得默认 0、编造版本或绕过 Ticket | **未解阻（外部依赖）**：与 X1–X3 独立；R3.7 已实测这些门禁 fail-closed 正确 |

说明：门槛 1–5 的“满足”仅指**假宿主自动化**；真实宿主验收仍未进行。门槛 6 的“独立复核”与门槛 7 的外部解阻项**未完成**，因此本轮不得把 R3 或 P8 写成真实验收通过。

### 8. 未验证边界（不得写成通过）

#### 8.1 R3.7 已尝试、blocked（R37 §5）

- 2026-11-07 09:18（Asia/Shanghai）对宿主 B 真实执行暂停→排空→部署尝试→恢复：暂停生效（`paused=true`、load `0/0`、10 项 health ready）；真实 `load` 只有 `running/queued/maxWorkers`，其余 5 个排空字段缺失 → 脚本 `unverified` fail-closed，部署 **exit 1**；**未构建、未切换指针、未重启**；已有 2 个 open Ticket 构成下一道门禁；hostVersion 只有实验性标识、无正式语义；随后已恢复派发。
- R37 §5.2 **仍未执行**：真实 A→B→A；实载 commit 回读；真实可恢复故障注入与自动回滚；暂停期受控 Issue smoke 及恢复后完整验收。
- 因此 R3.7 是**已尝试、在门禁处 blocked**，不是“通过”，也不是“完整执行后失败”。P8 继续保持部分／unverified。

#### 8.2 实载 `lib/` 污染与恢复边界（R37 §6）

- 证据支持：验证构建曾改写实载目录中的磁盘 `lib/`；最终 `live-lib-restore.txt` 与 `final-live-lib-restore.txt` 显示 live entry 与历史 release entry 一致，live／release／snapshot 树哈希有一致记录；当时宿主 health、load、paused 有回读，仓库工作树干净。
- 但**不能扩大为“运行中的插件已恢复到该 commit”**：宿主没有实载版本回读，且进程未因这次复制而重启；**磁盘一致 ≠ 内存实载一致**。
- 恢复时宿主为 `paused=false`，采用“移动旧目录 + 从 release 复制”的**非原子**过程；健康回读不能排除复制窗口内的动态加载风险，**不能把它当成标准回滚步骤**。
- 运维整改建议（R37 §6）：① 开发工作树与宿主 profile 实载目录彻底分离，禁止在实载工作树运行 `pnpm check`／`build`；② 实载只指向经校验的不可变 release，不在普通实载目录直接复制恢复；③ 若必须再次恢复，先暂停、排空并停止宿主，完整校验后原子切换，再启动、全量健康检查并由操作者恢复派发；④ 保留“实载 commit unverified”，直到宿主提供真实版本查询入口。
- 本轮据此**不在工作树运行 `pnpm check`／`pnpm build`**；完整检查由 Lead 在隔离克隆执行。

#### 8.3 其他仍未证明（R37 §9）

真实普通目录迁移；真实 drain 5 字段语义；正式 hostVersion；B5／PILOT／FORMAL；人类负责人最终签收。以上均不得默认通过。**另：X1–X3 的修复与 97 断言只由实现方＋本会话实测，尚未经二次独立复核（P-5）；独立复核前不得写成“已关闭/已通过复核”。**

### 9. 复现与证据路径

- **R3.8 本轮证据（仓库外）**：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/evidence/r3.8/`
  - `README.md`（本轮数据与修复摘要）
  - `fix-cfb5a18-pnpm-check-and-suite.log`（隔离克隆 `cfb5a18`：`pnpm check` exit 0 / 20 文件 202 tests / Build 1840ms；套件 `PASS: 97 assertions`；`git diff --check` exit 0；16 文件）
  - `old-8fd199d-suite-10fail.log`（旧实现 `8fd199d` × 新套件：exit 1、10 FAIL 全为 X1–X3、原 69 + P1–P3 PASS）
- R37 报告（仓库外）：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/R37-independent-review.md`
- R37 复跑证据（仓库外）：`external-review/evidence/r37-independent/delivery-verification.log`、`additional-tests.log`、`additional-tests.json`；追加测试源码 `external-review/r37-additional-tests.mjs`
- 历史 69 断言/19 FAIL 证据（仓库外）：`external-review/evidence/pr20-fix/`（含 `old-commit-final-7f50c13-suite.log`）
- R3.7 真实宿主尝试证据（仓库外）：`external-review/evidence/r3.7-real-host/`
- 复现命令（只读；**不要在工作树运行 `pnpm check`/`pnpm build`**）：
  ```sh
  cd /Users/zm/dsh-instances/experiment/hephi-review
  git log --oneline -3            # HEAD=cfb5a18（R3.8 修复提交），父=8fd199d
  node scripts/host/test-deploy-hephi.mjs   # 假宿主套件；预期 PASS: 97 assertions
  ```
  完整 `pnpm check`／双向对照已在**独立克隆** `/tmp/hephi-r38-fix`、`/tmp/hephi-r38-old` 执行并留档；**不在实载工作树执行**（R37 §6）。

### 10. 本轮实测数据回填（原占位清单，已全部落实）

| # | 项 | 值 | 证据 |
| --- | --- | --- | --- |
| P-1 | R3.8 修复提交 SHA | **`cfb5a187ad950170b1900b302c0d1f54530f3fe0`**（父 `8fd199d`；3 文件 +265/−39） | `git show --stat cfb5a18` |
| P-2 | 扩展套件最终断言总数 | **97 assertions** = 原 69（未改未删）+ 新增 28（X1 5／X2 7／X3 7／P1 3／P2 2／P3 4）；耗时 r38-tests `2m12.4s`／`2m13.7s`，Lead 复跑 `real 133.24s` | `fix-cfb5a18-pnpm-check-and-suite.log` |
| P-3 | 双向实跑 | 旧 `8fd199d`：exit 1、**10 FAIL（全为 X1–X3）**，原 69 + P1–P3 PASS；修复 `cfb5a18`：**PASS 97 / exit 0** | `old-8fd199d-suite-10fail.log`、`fix-cfb5a18-pnpm-check-and-suite.log` |
| P-4 | 完整 `pnpm check`（隔离克隆） | **exit 0**；`tsc --noEmit` 通过；`vitest run` 20 文件 / 202 tests passed；`tsdown` `Build complete in 1840ms`；Node `v22.19.0`／pnpm `11.7.0`；`git diff --check 5efd708..cfb5a18` exit 0 | 同上 |
| P-5 | 二次独立复核 | **未做（待外部复核）**：R37 报告是上一轮、不能替代对 `cfb5a18` 的复核；本轮仅实现方＋本会话验证 | — |
| P-6 | X1–X3 断言名 | 见 §3（5 条）／§4（7 条）／§5（7 条）；P1 3 条、P2 2 条、P3 4 条已在套件 | `old-8fd199d-suite-10fail.log`（FAIL 子集）＋套件源码 |

**旧实现 `8fd199d` 的 10 条 FAIL 分组**：X1 3（output does not claim kept paused／output/record flags host not confirmed paused／record keeps keptPaused=no）；X2 4（targetFailureKind recorded／restoreFailureKind …／restoreFailure is not the target-phase string／unverified paused path does not claim kept paused）；X3 3（failed-pointer record marks migrationRestore failed／output does not claim restored or preserved／output states restore failure and backup path）。**10 条全部落在 X1–X3 缺陷断言内，原 69 条与 P1–P3 在旧实现上全 PASS，说明新负例不是“自证通过”。**

### 11. 本轮同步更正的事实（R37 §7）

| 文件 | 更正内容 |
| --- | --- |
| `docs/p8-deploy-record.md` | N4 区分“早期改前快照 `exit 0` + `result:ok`”与“最终套件 `exit 42`”；R3.7 blocked 时点；实载 lib 污染与恢复边界（R37 §6）；二次复核状态 |
| `docs/remediation-r3-validation.md` | N4 同一区分（§9 多处）；真实 `hephi/lib` 为**普通目录**（非 symlink）；二次复核状态；最终套件重跑完成（PASS 50 / FAIL 19）；新增 §11 R37 结论 |
| `docs/self-check-2026-11-07.md` | N4 同一区分；P8 仍部分；R37 结论与 R3.8 已修复（`cfb5a18`）待二次复核 |
| `docs/implementation-index.md` | 当前 main 改为 `8fd199d`；PR #21／#22 已合并；R3.7 blocked 时点；返修 diff 范围 `5efd708..8fd199d`（16 文件）；R37／R3.8 登记 |
| `docs/source-consistency.md` | 远端 main / HEAD 时点；实载 `lib` 普通目录；R3.7 已尝试 blocked；R37 与 R3.8 状态 |

> 本文件是 R37 §7 要求的新增返修登记；**不改变 R37 报告本身，也不替代真实宿主验收**。R3.7／P8 的状态口径见 `docs/remediation-r3-validation.md` §6、§10 与 `docs/p8-deploy-record.md` 末尾。
