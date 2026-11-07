# S4 验收记录（A 线，2026-11-07）

> 状态：**partial（PR30 复审要求修改 F1；E5/E9 blocked；人类签收未做）**。本文件只记录已真实执行并有证据的事项；
> 未执行/未验证项显式列出。**不是最终验收通过证明；人类负责人签收前不得记 A5/D5 为通过。**

## 1. 对象

| 项 | 值 |
| --- | --- |
| main（代码） | `9fa8598f2beabe179b28733e484275c3775279d3`（PR30 merge `2c603c6` + PR31 docs） |
| 实载构建 | `e490fe34dfd13117db2516d9b9c7cb0459c1d219`（activation markers pid 95240；main 与其实载 tree 差异仅 2 个 docs） |
| 部署记录 | `deploy-20261107T141210Z-57984.json`，sha256 `804ba302d373da5b2613d3a6a986180149715b8c35d9d76844e4c3df060d7454` |
| 宿主 | B `http://127.0.0.1:3083`，DSH 0.2.1-rc.5，Node v26.1.0（宿主运行）/v22.19.0（本地验证工具） |

## 2. S1 预检（main）

命令：`node scripts/release/preflight.mjs --source /tmp/main-s1-review --ref 9fa8598 --out /tmp/main-s1-report.json`
结果：**PASS**。`check` exit 0（**459 tests**，36+ 文件，Build 1649ms）；假宿主套件 **174 assertions**；effects-db **41**；克隆树干净。原始报告见 `external-review/evidence/roadmap95/`（本轮落档）。

## 3. 独立代码复核（PR30 合并后）

`external-review/PR30-post-merge-review.md`：verdict **request changes**——0 blocker / **1 major（F1：激活门禁可被 legacy 降级绕过）** / 5 minor / 6 nit。F1 未修复前，activation fail-closed 门禁不能作为 issue #26 关闭依据。本 S4/后续真实部署不得忽略该发现。

## 4. A2 证据链（定案）

见 `hephi/docs/validation/2026-11-07-a2-final.md`（含独立复核 F4 口径风险追加说明）：
H1 pass(path-B)、H2 fail、H3 pass（disposable profile）、H4 pass、H5 pass（无截断分支）、H6 fail。
结论：**A1-BIND 不启用（强绑定保持关闭）**，按“检测已列举伪造”交付；A1-OUT fail-closed。总体 incomplete。

## 5. A5 场景状态

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| E2/E3/E6/E7 | **pass**（外部模型执行；Lead 已核对 decisions） | `e2e/2026-11-07-E2/E3/E6/E7.md`：scope.outside-task deny、ready.other deny、ready.evidence-missing deny、ready.pr-mismatch deny；PR #53 |
| E8 | pass（预期准备拒绝） | Issue #52 / ticket `c9ea328e…` failed |
| E1-off | **PARTIAL（对照；前置/provenance 无法核验）** | `e2e/2026-11-07-E1-off.md`：Issue #54、PR #55、无 HEPHI state |
| E4 | **PASS（两阶段）** | `e2e/2026-11-07-E4.md`：Issue #56/57、ticket c231654e/13af322b、run.json blocked→passed、PR #58 |
| E10 | **pass** | `e2e/2026-11-07-E10.md`：Issue #60、ticket 1612ffac、run passed、PR #61（2 文件） |
| E1-on | **PARTIAL（SMOKE_ONLY 流程证据；正式场景未做）** | `e2e/2026-11-07-E1-on.md`：Issue #49、ticket ad3d5016、run 6f202520 passed、PR #50 |
| E5/E9 | **blocked** | 前置未满足（H0 停机已做、H3 真实宿主探针 manual） |
| E-PR1 | **PARTIAL（SMOKE_ONLY 流程证据）** | `e2e/2026-11-07-E-PR1.md`：PR #50 首次创建、ready.pass、HEAD 一致 |

## 6. P8 / D1 / D2 / P2 / P5 现状

- P8：部分（部署机制与实载回读已验证，但真实 S3/S4 完整链路与 F1 修复未完成）。
- D1：不通过（A1-BIND 未启用；H6 fail；绑定关闭）。
- D2：hostVersion 语义有正式记录（PR31），但“实载源码可证明”仍不成立。
- P2/P5：不变（本文件不重评；以原记录为准）。

## 7. 未验证 / blocked（不得计入通过）

- 真实 A2 H1–H6 未在生产实载构建上复跑（生产快照 check record pluginCommit=efdd406）。
- 真实 supervisor 自动重启行为、非零 effect 等待、运行期网络隔离。
- C3 review→Trigger、C4.2 真实工具可见性、C1 真实 E2E。
- E5/E9、E1-on 正式场景、E10（执行中）。
- F1 修复与 PR30 其余 minor。
- B 线实验（B5/B7/B8）未开始。

## 8. 结论

A 线本轮完成了：main S1 PASS、PR30 独立复核（request changes）、A2 定案、E4/E1-off 真实验收、E10 执行中。
**S4 仍为 partial**：F1 未修复、E10 未完成、E1-on/E-PR1/E5/E9 未完成/blocked。不得将本记录当作 A5/D5 通过或 S4 验收通过。

## 9. 更新（E10 完成后）

- A5 非 blocked 场景均已有记录：E1-off / E1-on / E2 / E3 / E4 / E6 / E7 / E8 / E10 / E-PR1；其中 **E4/E10/E2/E3/E6/E7/E8 为 pass**，**E1-off/E1-on/E-PR1 为 partial**（前置或任务类型限制）。
- E5/E9 保持 blocked；E1-on/E-PR1 为 SMOKE_ONLY 流程证据、E1-off 前置/provenance 无法核验、E2/E3/E6/E7 为外部模型执行（决策日志已由 Lead 核对）——因此 A5 **未达到“全部应执行场景 pass + 人工复核通过”**，需补正式场景与负责人签收。
- PR30 复审 F1（activation legacy 降级绕过）**未修复**，S3 真实部署门禁仍需该修复或明确书面降级。

## 10. 证据索引

| 证据 | 位置 | 说明 |
| --- | --- | --- |
| S1 预检报告/日志 | `external-review/evidence/roadmap95/main-s1/main-s1-report.json`、`main-s1.log` | main@9fa8598，verdict PASS（459 tests / 174 / 41） |
| PR30 独立复核 | `external-review/PR30-post-merge-review.md`；`external-review/evidence/pr30-review/` | request changes（F1 major） |
| F1 修复跟踪 | GitHub issue `paxxie2/super-agent-hephi-review#35`；清单 2 任务 2.7 | 未修复前不得依赖 activation fail-closed |
| A2 定案 | `hephi/docs/validation/2026-11-07-a2-final.md` | H1–H6 + 哈希核对 + F4 口径风险 |
| E4 记录 | `hephi/docs/validation/e2e/2026-11-07-E4.md`；stateDir `…/state/hephi/c231654e…`、`13af322b…`；PR #58 | blocked→passed 两阶段 |
| E10 记录 | `hephi/docs/validation/e2e/2026-11-07-E10.md`；stateDir `…/state/hephi/1612ffac…`；PR #61 | passed，2 文件 |
| E1-off 记录 | `hephi/docs/validation/e2e/2026-11-07-E1-off.md`；Issue #54 / PR #55 | partial（前置/provenance 无法核验） |
| E1-on / E-PR1 记录 | `e2e/2026-11-07-E1-on.md`、`E-PR1.md`；Issue #49 / ticket ad3d5016 / PR #50 | partial（SMOKE_ONLY） |
| E2/E3/E6/E7 记录 | `e2e/2026-11-07-E2.md`、`E3.md`、`E6.md`、`E7.md`；stateDir `…/state/hephi/90150d23…`；PR #53 | 外部执行，决策日志已核对 |
| 部署记录 | `<instance>/logs/deploy-20261107T141210Z-57984.json`（sha256 804ba302…） | D1/D2/D4/D5 证据 |
| 记录 PR | `paxxie2/super-agent-hephi-review` PR #34（docs-only） | 本文件与 e2e 记录所在分支 |
