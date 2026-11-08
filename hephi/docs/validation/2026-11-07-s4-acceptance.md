# S4 验收记录（A 线，2026-11-07）

> 状态：**partial（F1/F2–F5、deploy UX 均已修复合并；S3 已完成；E5/E9 blocked；E1-off partial；人类签收未做）**。E1-on 正式场景已于 2026-11-08 真实验收通过（等价清理，非缺陷修复）。本文件只记录已真实执行并有证据的事项；
> 未执行/未验证项显式列出。**不是最终验收通过证明；人类负责人签收前不得记 A5/D5 为通过。**
>
> 更新（2026-11-08）：本次文档核对 main 为 **`5b5c4ef`**，宿主 B 最新部署构建为 **`6d24e1b`**（见 §2c）。
> 全新 Issue57 已完成正常原生检查与 PR 交付，但输出仅 2,429 字节，**>16KiB 长输出和完整 A2/A5 未通过验收**；S4 仍为 partial。

## 1. 对象

| 项 | 值 |
| --- | --- |
| main（代码） | **`5b5c4efc23b054e1dbdd465469b900b8ab5ab559`**（本次文档核对对象）；宿主构建单独记为 `6d24e1b`，不能将 main SHA 自动当作实载 SHA |
| 历史验收时点 | 证据采集于旧 main `9fa8598f2beabe179b28733e484275c3775279d3`（PR30 merge `2c603c6` + PR31 docs）；本次 rebase 未重跑验收 |
| 实载构建 | **`6d24e1b39b75948b02c7dbd5fbac3e1af3c5ff80`**（2026-11-08 03:26:55 S3 部署；部署时 activation index/tools 同 PID 72909；部署后经人工 `start.sh`/tmux 恢复为 PID 74123、双入口仍为 `6d24e1b`，见 §2c；Issue57 的 check.pass/ready.pass 同 SHA） |
| 最新部署记录 | `deploy-20261107T192655Z-28428.json`；target=`6d24e1b`、previous=`bc21caca`、result=ok、activation=verified、keptPaused=yes |
| 宿主 | B `http://127.0.0.1:3083`，DSH 0.2.1-rc.5，Node v26.1.0（宿主运行）/v22.19.0（本地验证工具） |

## 2a. 最新 S1 预检（2026-11-08 03:0x，main `2eb05b1`）

`preflight.mjs --ref 2eb05b1` → **PASS**：`pnpm check` exit 0（403s）、假宿主套件 exit 0（379s）、effects-db 0s；报告归档 `external-review/evidence/roadmap95/s1-latest-main-2eb05b1.{json,log}`。此后 main 追加的 `93bfd06`/`fc03cf0`（B4/B6 工具、deploy UX 修复）为 eval/docs/部署脚本变更；插件运行代码未变。

## 2b. S3 真实部署（2026-11-08 02:16，PASS）

- 命令：`deploy-hephi.sh --drain effects --target bc21cac --allow-legacy-rollback`（另显式 `--hephi <live plugin dir>`、`--peer-root <host peer root>`、`--node <host node>`、`--stop-command dsh-superagent stop`）。
- 结果：`result=ok`；`activation=verified`（日志偏移 10678 后 index/tools 各 1 条，pid 44914，commit `bc21cac`）；10/10 health ready；`keptPaused=yes`；停机后 copy 查询 `total=0`；指针 `e490fe34…/lib → bc21cac…/lib`。
- 记录：`<instance>/logs/deploy-20261107T181639Z-43593.json`，sha256 `bb2dd8b6d6c9dd240d30df261afe06c5ef949c0d8488854b22d3ab0f45dc69b5`。
- 恢复：核对后 `POST executor/pause {paused:false}` → paused=false、10/10 ready、load 0/0。
- S3 smoke（P0-4）：部署后创建 Issue #65 → Ticket `23c3eab1…` → run `6bda58a8…` **passed/exit0/pluginCommit=bc21cac** → ready.pass → PR #66（open，未合并）；随后用 main 版探针复跑 A2：H1 pass(path-B)、H2 fail、H4 pass、H3/H5/H6 manual。
- **deploy UX 已修复**：PR #51 合入（`--hephi` 早期校验、legacy previous 自动作为恢复目标并记录 `previousLegacy`/`activation=unverified-legacy`、target 仍严格 v2；假宿主 302 断言、`pnpm check` 545 tests 全绿）。
- 过程发现（原始失败，已由 PR51 修复）：① 未传 `--hephi` 时脚本默认 `$instance/hephi`（非实载路径）→ pointerBefore/current 为空、激活必然失败且回滚报 FATAL；② 旧 e490 是 legacy meta，正向部署的 previous 校验也要求 `--allow-legacy-rollback`（恢复目标语义应自动接受 legacy，或文档写清必须显式传）。这两点已造成三次失败尝试（记录保留），第 4 次带显式参数成功。

## 2c. Issue49 修复版部署与 Issue57 全新入口验证（2026-11-08）

- 部署原件：`<instance>/logs/deploy-20261107T192655Z-28428.json`；target=`6d24e1b39b75948b02c7dbd5fbac3e1af3c5ff80`、previous=`bc21caca`、result=ok、activation=verified；本次启动 index/tools 各一条、同 PID 72909，10 项健康 ready，部署结束 keptPaused=yes。
- **人工恢复（必须保留，不得省略）**：部署脚本成功落盘后其子进程退出；原生 CLI 默认环境 `start` 失败（profile 不存在，失败日志保留），随后用既有 `start.sh` 经 tmux 启动。当前 PID `74123`，双入口（index/tools）activation 均为 `6d24e1b`，10 项健康 ready、paused=false。该恢复发生在全新任务执行前，不能宣称部署后持续存活无人工介入。
- 全新入口：[`super-agent-hephi-review#57`](https://github.com/paxxie2/super-agent-hephi-review/issues/57) → Ticket `ef9b71e6318012f61d7828618b713c71` / 同名 Worker Session → run `a2ee26c4-7d1b-424f-996d-08e493243271` → check.pass → PR58 → ready.pass；没有恢复旧 Ticket。
- 原始记录：`<state>/hephi/ef9b71e6318012f61d7828618b713c71/checks/a2ee26c4-7d1b-424f-996d-08e493243271/{run.json,output.log}` 及该 Ticket 的 `decisions.jsonl`。run=`passed`、exitCode=0、jobId=`bash-408c056e9b034831`；check/ready 的 pluginCommit 均为 `6d24e1b`；ready 的 effective binding=false。
- 独立文件核对：输出 **2,429 字节**，SHA256=`2a8a6f13811dd61410e31b0538f9766e1f94c5b7e2776ec94f2c494829f6a171`，与记录一致；before/after HEAD 均为 `8ed2207f4705a8d257764fb9b76badcd7e59ad82`，与 [PR58](https://github.com/paxxie2/super-agent-hephi-review/pull/58) HEAD 一致，PR 仅新增指定两行入口文档，OPEN/未合并。
- **结论边界**：正常原生检查与 PR 交付通过；输出不足 16KiB，不能证明长输出或 settled-ring 裁剪分支通过。该任务不是 E9 强绑定、H6 隔离、完整 A5 或完整 S1 验收，不能将“入口文档名称”当成测试已覆盖。

## 2. 历史 S1 预检（旧 main@9fa8598）

> 本节保留 `9fa8598` 的历史报告；§2a 保留 `2eb05b1` 的 S1 报告。两者都不能自动作为 `6d24e1b` 或本次 main 的完整 S1 证据。

命令：`node scripts/release/preflight.mjs --source /tmp/main-s1-review --ref 9fa8598 --out /tmp/main-s1-report.json`
结果：**PASS（旧 main）**。`check` exit 0（**459 tests**，36+ 文件，Build 1649ms）；假宿主套件 **174 assertions**；effects-db **41**；克隆树干净。原始报告见 `external-review/evidence/roadmap95/`（本轮落档）。

## 3. 独立代码复核（PR30 合并后）

`external-review/PR30-post-merge-review.md`：verdict **request changes**——0 blocker / **1 major（F1：激活门禁可被 legacy 降级绕过）** / 5 minor / 6 nit。F1 未修复前，activation fail-closed 门禁不能作为 issue #26 关闭依据。本 S4/后续真实部署不得忽略该发现。

**F1 状态（2026-11-08，d9d70b1）**：PR38 已 fast-forward 合并修复——release-meta 使用 `formatVersion=2`；
legacy 元数据只在显式 `--allow-legacy-rollback` 的回滚/恢复目标上接受；默认激活门禁拒绝 legacy 降级
（`test-deploy-hephi.mjs` 覆盖 F1-A..G 负例，且 `d9d70b1` 把 F1 套件接入默认 full fake-host run）。
**F2–F5 已由 PR40 合并整改**；F3 仅明确 peer 路径稳定性要求与告警，不代表消除迁移限制。既有 D1/D2/D4/D5 正式记录见 `docs/deployment-prerequisite-decisions-2026-11-07.md`；上述代码整改及 S3 成功不等于完整 S4 通过。

## 4. A2 证据链（定案）

见 `hephi/docs/validation/2026-11-07-a2-final.md`（含独立复核 F4 口径风险追加说明）：
H1 pass(path-B)、H2 fail、H3 pass（disposable profile）、H4 pass、H5 pass（无截断分支）、H6 fail。
结论：**A1-BIND 不启用（强绑定保持关闭）**，按“检测已列举伪造”交付；A1-OUT fail-closed。总体 incomplete。

## 5. A5 场景状态

以下矩阵保留各自历史构建的结论；新增 `6d24e1b` 的正常检查证据见 §2c，不自动覆盖历史 A5 用例。E1-on 表示启用插件，不等于 binding=true；E1-off 表示无插件对照。

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| E2/E3/E6/E7 | **pass**（外部模型执行；Lead 已核对 decisions） | `e2e/2026-11-07-E2/E3/E6/E7.md`：scope.outside-task deny、ready.other deny、ready.evidence-missing deny、ready.pr-mismatch deny；PR #53 |
| E8 | pass（预期准备拒绝） | Issue #52 / ticket `c9ea328e…` failed |
| E1-off | **PARTIAL（对照；前置/provenance 无法核验）** | `e2e/2026-11-07-E1-off.md`：Issue #54、PR #55、无 HEPHI state |
| E4 | **PASS（两阶段）** | `e2e/2026-11-07-E4.md`：Issue #56/57、ticket c231654e/13af322b、run.json blocked→passed、PR #58 |
| E10 | **pass** | `e2e/2026-11-07-E10.md`：Issue #60、ticket 1612ffac、run passed、PR #61（2 文件） |
| E1-on | **PASS（正式场景，流程级）** | `e2e/2026-11-08-E1-on.md`：Issue #62 / ticket `e2419b28…` / run `9ffe2a11…` passed/exit0 / ready.pass / PR #63；改动为等价清理（非缺陷修复） |
| E5/E9 | **blocked** | 前置未满足（H0 停机已做、H3 真实宿主探针 manual） |
| E-PR1 | **PASS（正式场景，来自 E1-on run）** | `e2e/2026-11-08-E-PR1.md`：PR #63 首次创建、ready.pass、HEAD=run before/after head |

## 6. P8 / D1 / D2 / P2 / P5 现状

- P8：部分（部署机制与实载回读已验证；真实 S3/S4 完整链路未完成；F1 已由 PR38、F2–F5 已由 PR40 合并整改；F3 保留路径稳定性限制）。
- D1：不通过（A1-BIND 未启用；H6 fail；绑定关闭）。
- D2：hostVersion 语义有正式记录（PR31），但“实载源码可证明”仍不成立。
- P2/P5：不变（本文件不重评；以原记录为准）。

## 7. 未验证 / blocked（不得计入通过）

- `bc21caca` 已有 A2 探针复跑：H1/H4 pass、H2 fail、H3/H5/H6 manual（§2b）；`6d24e1b` 尚无完整 H1–H6 复验。历史一次性 profile 的 H6 fail 仍不能改成生产通过。
- 真实 supervisor 自动重启行为、非零 effect 等待、运行期网络隔离。
- C3 review→Trigger、C4.2 真实工具可见性、C1 真实 E2E。
- E5/E9；E1-off 的干净 off 环境。E1-on 仅等价清理（未验证真实缺陷修复类型）；E-PR1 依赖同一 run，仅证明首次 PR 创建流程，未证明无 PR 时先 ready 拒绝。
- F1/F2–F5 已合并；`6d24e1b` 已部署并有正常原生交付，但 >16KiB/裁剪边界未覆盖，当前完整 S1/A2/A5 证据仍不足。
- B 线实验（B5/B7/B8）未开始。

## 8. 结论

A 线本轮完成了：旧 main S1 PASS、PR30 独立复核（request changes）、A2 定案、E4/E10 真实验收、E1-on 正式场景验收、E1-off 对照（partial）。
**S4 仍为 partial**：F1/F2–F5 均已修复并合并（PR38/PR40），但 E1-off partial、E5/E9 blocked，
当前 `6d24e1b` 正常原生交付通过，但长输出边界和完整 A2/A5 未通过。不得将历史 S1、部署成功或本次单任务交付当作 A5/D5 或完整 S4 通过。

## 9. 更新（E10 完成后）

- A5 非 blocked 场景均已有记录：E1-off / E1-on / E2 / E3 / E4 / E6 / E7 / E8 / E10 / E-PR1；其中 **E1-on/E-PR1/E4/E10/E2/E3/E6/E7/E8 为 pass**，**E1-off 为 partial**（前置限制）。
- E5/E9 保持 blocked；E1-off 前置/provenance 无法核验；E1-on/E-PR1 来自同一等价清理 run；E2/E3/E6/E7 为外部模型执行（决策日志已由 Lead 核对）——A5 仍缺 E1-off 干净环境与负责人签收，**不得记为通过**。
- PR30 复审 F1（activation legacy 降级绕过）**已由 PR38 修复**（`formatVersion=2` + legacy 仅 `--allow-legacy-rollback`，F1-A..G 负例）；
  F2–F5 已由 PR40 合并整改，F3 保留路径稳定性限制；已发生的 S3 和后续交付见 §2b/§2c，未覆盖项不变。

## 10. 证据索引

| 证据 | 位置 | 说明 |
| --- | --- | --- |
| S1 预检报告/日志 | `external-review/evidence/roadmap95/main-s1/main-s1-report.json`、`main-s1.log` | **旧 main@9fa8598**，verdict PASS（459 tests / 174 / 41）；不能作为当前构建的 S1 证据 |
| PR30 独立复核 | `external-review/PR30-post-merge-review.md`；`external-review/evidence/pr30-review/` | request changes（F1 major） |
| F1 修复 | PR #38（merge `d9d70b1`，`f078f72` + `d9d70b1`）；`test-deploy-hephi.mjs` F1-A..G | **已修复**；F2–F5 已由 PR40 合并整改，F3 保留限制 |
| A2 定案 | `hephi/docs/validation/2026-11-07-a2-final.md` | H1–H6 + 哈希核对 + F4 口径风险 |
| E4 记录 | `hephi/docs/validation/e2e/2026-11-07-E4.md`；stateDir `…/state/hephi/c231654e…`、`13af322b…`；PR #58 | blocked→passed 两阶段 |
| E10 记录 | `hephi/docs/validation/e2e/2026-11-07-E10.md`；stateDir `…/state/hephi/1612ffac…`；PR #61 | passed，2 文件 |
| E1-off 记录 | `hephi/docs/validation/e2e/2026-11-07-E1-off.md`；Issue #54 / PR #55 | partial（前置/provenance 无法核验） |
| E1-on 正式记录 | `hephi/docs/validation/e2e/2026-11-08-E1-on.md`；Issue #62 / ticket `e2419b28…` / run `9ffe2a11…` / PR #63 | PASS（等价清理，非缺陷修复） |
| E-PR1 正式记录 | `hephi/docs/validation/e2e/2026-11-08-E-PR1.md`；PR #63 / run `9ffe2a11…` | PASS（流程级，来自 E1-on run） |
| E1-on/E-PR1 历史记录 | `e2e/2026-11-07-E1-on.md`、`E-PR1.md`；Issue #49 / ticket ad3d5016 / PR #50 | partial（SMOKE_ONLY，已被正式记录取代） |
| E2/E3/E6/E7 记录 | `e2e/2026-11-07-E2.md`、`E3.md`、`E6.md`、`E7.md`；stateDir `…/state/hephi/90150d23…`；PR #53 | 外部执行，决策日志已核对 |
| 历史部署记录 | `<instance>/logs/deploy-20261107T141210Z-57984.json`（sha256 804ba302…） | e490fe34 的 D1/D2/D4/D5 证据 |
| 最新部署与普通交付 | `<instance>/logs/deploy-20261107T192655Z-28428.json`、§2c 原始 run/output/decisions、super-agent-hephi-review Issue57/PR58 | 实载 6d24e1b；2,429 字节正常检查及交付通过，长输出未覆盖 |
| 记录 PR | `paxxie2/super-agent-hephi-review` PR #34（docs-only） | 本文件与 e2e 记录所在分支 |
