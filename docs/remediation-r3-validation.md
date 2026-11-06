# R3 修复验证记录（2026-11-07）

对应 `HEPHI-R2-remediation-checklist.md` R3（不可变部署、自动回滚、全量健康门禁）与 R4.3 的文档要求：逐条登记命令、退出码、证据路径、复核者和局限。**假宿主测试通过 ≠ 真实宿主验收通过**；R3.7 真实宿主项全部保持未验证。

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 起始基线 | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（`main`，PR #19 合并） |
| 修复分支 | `agent/hephi-r2-remediation`（**本地分支，未推送、未创建 PR、未合并**） |
| R1 提交 | `9e874f85c995b945f8408be46f51fb34661ebaa2` |
| R2 提交 | `0d7c031e24ec9aed16cf296a99336e501d3c1fac` |
| **R3 提交** | `0d58bc39ed246c6c9084766c6b495ce2300795d4`（parent `0d7c031`；`R3: immutable releases, atomic pointer switch, full health gate with auto-rollback`） |
| R3 改动文件 | `scripts/host/deploy-hephi.sh`（重写）、`scripts/host/test-deploy-hephi.mjs`（新增）、`hephi/tests/control/deploy-script.test.ts`（新增），+559/−114 |
| 执行环境（实测） | **Node `v22.19.0`**、pnpm `11.7.0`（与方案指定一致；本机经 nvm 切换复核） |
| 真实宿主 | 宿主 B `http://127.0.0.1:3083`；**本记录未对其执行任何部署/回滚操作** |

## 2. 实际执行的命令与退出码

| 命令 | 环境 | 退出码 | 结果摘要 |
| --- | --- | --- | --- |
| `node scripts/host/test-deploy-hephi.mjs` | Node `v22.19.0` | 0 | `PASS: 44 assertions (R3 fake-host suite)`；`real 49.55s`（R3 实现者记录 `50.22s`） |
| `pnpm test`（全量，含 `deploy-script.test.ts`） | Node `v22.19.0` / pnpm `11.7.0` | 0 | **20 文件 / 202 tests passed**；start `06:51:38`，duration `52.15s`；其中 `deploy-script.test.ts` 1 test 用时 `51857ms`（R3 实现者单独运行记录 `50.49s`） |
| `pnpm exec vitest run tests/control/deploy-script.test.ts`（R3 实现者执行） | Node `v22.19.0` | 0 | 1 passed，`50.49s`（Lead 提供的原始输出） |

证据路径：本轮复核输出在 `/tmp/r3-fakehost.log`、`/tmp/r3-pnpm-test.log`（本机临时目录，不入库）；44 条断言原文见 §5。R3 实现者的原始输出未随提交归档。

## 3. R3.1 八条不变量落实矩阵

来源：`scripts/host/deploy-hephi.sh` 头部不变量注释 + 实现；假宿主断言编号见 §4。

| # | 不变量 | 实现（`deploy-hephi.sh`） | 假宿主证据 | 真实宿主 |
| --- | --- | --- | --- | --- |
| 1 | `releases/<fullSHA>/` 发布成功后 `lib/` 与 `meta.json` 永不改写；同 SHA 再发布必须失败 | `build_release` 先查 `releases/$sha` 已存在即失败；发布走 `.incoming-<sha>-<pid>` + 校验 + 单次 `mv` | R3-T02、T16 | **未验证** |
| 2 | 构建在独立临时目录（`git archive` 干净源码）完成，不在实载 `$hephi/lib` 上构建 | `build_release`：`mktemp` → `git archive <sha>` → `HEPHI_BUILD_COMMIT=<sha> pnpm install --frozen-lockfile && pnpm check` → 清理 | R3-T01 | **未验证** |
| 3 | 实载切换只使用已发布且校验通过的 release；校验失败不得停止当前宿主 | `release_validate`（meta 字段/目录名/`entrySha256`/`hostVersion`）在 `set_pointer` 之前；失败路径不重启 | R3-T03、T04、T05 | **未验证** |
| 4 | 切换后的重启或健康失败自动恢复 previous，并再次全量健康检查 | 主流程失败尾部 `set_pointer(previous/snapshot)` → `restart_instance`（全量健康）→ 记录 | R3-T08、T09 | **未验证** |
| 5 | 回滚也失败时保持 `paused=true`、非零退出、保留现场与两次健康证据 | `failed-twice` 记录 + `fail_keep_paused`，不自动恢复派发 | R3-T10 | **未验证** |
| 6 | 有进行中 Ticket、drain 字段未知或非零时禁止升级；不存在绕过入口 | `drain_ok`（`running`/`queued` 必填为 0；`startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 缺失即 `unverified` 拒绝）+ `open_tickets`>0 拒绝；`--allow-open-tickets` 落入未知参数分支 | R3-T12、T13、T15 | **未验证** |
| 7 | 成功退出也不自动恢复派发；由操作者核对后手动恢复 | 成功/回滚记录 `paused:true`，脚本提示需手动经 API 恢复 | R3-T17（记录字段） | **未验证** |
| 8 | 文件哈希只证明磁盘内容，不等于实载 commit；无回读入口时 P8 真实验收保持未通过 | 成功记录字段 `loadedCommitReadback: "unverified"` | 假宿主仅验证磁盘 | **未验证**（宿主无 `describePlugin` 回读入口） |

## 4. R3-T01–T17 假宿主结果

脚本：`scripts/host/test-deploy-hephi.mjs`（只使用临时目录、假 start 脚本、假状态响应、临时 git 仓库；不访问 3082/3083、不触碰真实 release）。**44 断言全部 PASS**。

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
| R3.7 真实宿主 A→B→A 部署与回滚 | **未验证** | 本记录未对 B 执行任何部署；需真实暂停/排空后执行并保存原始输出 |
| 实载 commit 回读 | **未验证** | 宿主无 `describePlugin`／版本查询入口；成功记录已明确标 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代 |
| 受控健康故障注入与自动回滚（真实宿主） | **未验证** | 假宿主 T08–T10 只证明脚本机制 |
| 真实宿主暂停期受控 Issue smoke、恢复后健康/load | **未验证** | R3.7 第 6 项未做 |
| drain 真实 API 字段语义 | **未验证** | `startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 仅在假宿主按字段存在性验证；真实 API 是否提供、语义是否一致未确认（缺失即拒绝，不按 0） |
| 真实 `hostVersion` 来源 | **未验证** | 仅验证必填/单行校验；真实固定宿主配置快照的取值未在本轮采集 |
| `git archive` 干净构建在真实仓库 | **未验证** | 假宿主使用临时 Git 仓库；真实仓库构建由部署流程在真实宿主验收时验证 |
| 独立验收（非实现者重新克隆复跑 R5.2／R5.4） | **未做** | 本文件由本轮执行 Agent 复核，不能替代独立验收 |

## 7. 复核者

| 角色 | 身份 | 时间（+08:00） |
| --- | --- | --- |
| R3 实现 | `0d58bc3` 作者（DSH Agent） | 2026-11-07 06:50 |
| 命令复跑与本记录 | `docs-r4` 执行 Agent（Node `v22.19.0`） | 2026-11-07 06:51–06:53 |
| 独立复核 | **未做** | 需独立会话执行 R5.2／R5.4 |

> 结论：R3 的**脚本机制**已由假宿主 44 断言覆盖并通过；**P8 真实验收仍未通过**，`docs/p8-deploy-record.md` 与本文件均保留该边界。
