# 实施索引（供外部评审）

更新时间：2026-11-07 06:54（Asia/Shanghai；R4 文档同步，R3 提交后二次更新）。本索引列出所有已提交的代码/文档、已合并 PR、以及**不在 git 中的运行产物**（生产数据与宿主日志，按 P14 不提交），便于外部模型逐项核查。历史数字保留时点说明，不回改历史记录。

## 1. 仓库与提交

| 仓库 | 分支/标签 | 当前 SHA | 说明 |
| --- | --- | --- | --- |
| `paxxie2/super-agent-hephi-review` | `main` | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（PR #19 合并提交；`git ls-remote origin refs/heads/main` 回读，2026-11-07 06:42） | PR #7–#19 已合并 |
| 同上 | `agent/hephi-r2-remediation`（本地分支） | `0d58bc3`（R1 `9e874f8` → R2 `0d7c031` → R3 `0d58bc39ed246c6c9084766c6b495ce2300795d4`） | 本轮修复分支；**未推送远端、未创建 PR、未合并** |
| 同上 | `hephi-baseline-1`（annotated） | `1e93e4b` → `3f276a5` | G2 基线标签（指向 PR #7 合并提交） |
| `paxxie2/site-pnl-diagnosis` | `main` | `8d2ec58` | PR #29（data 源恢复）与 #42（hephi smoke 标记）已合并 |

本仓库相对原基线 `a212d69` 的有效改动：

- 前置脚本与 CI 决定：`f53f9c6`（9 个脚本）、`7a26d0f`（CI，已由 `a7250a9` 删除）、`1ea45b9`（6 个脚本）
- 安全修复：`b8415e9`（c547 等价：ready 对照冻结核查 argv/cwd）
- P5/P2/P3/P4：`42b766d`、`89d4ab9`、`e373c68`、`abfdd3a`
- P6/P16：`a96dc1b`、`44e888c`
- 自检与补遗：`bf4d397`（S1–S3 + 报告）、`e862cf7`（P15 关系表、eval CLI 测试、P6 文档）
- P8：`dde783a`/`255ab77`（不可变发布 + 回滚）、`0f5c9f2`/`185f5e9`（部署记录与实例布局）、`2d8ea2a`（进行中 Ticket 禁止升级）
- P10：`bc95bf3`（离线构建实测）
- P11：`0a6e2d0`（原生入口 smoke）、`675bc56`（hephi 激活 smoke）、`2dddf12`/`7f90f74`（合并与更正）
- **本轮 R2 整改**（分支 `agent/hephi-r2-remediation`，起点 `5efd708`，**未合并**）：R1 `9e874f8`（activation v2 规范化哈希 + v1／无版本只读兼容）、R2 `0d7c031`（dirty 构建拒绝、完整 commit 身份）、R3 `0d58bc3`（不可变部署、原子指针切换、全量健康门禁、自动回滚；假宿主 44 断言通过，真实宿主未验证）。

## 2. 合并 PR

super-agent-hephi-review：#7、#8、#9、#10、#11、#12、#13、#14、#15、#16、#17、#18、#19（均 MERGED；#19 的 merge commit 即当前 `main@5efd708`）。
本轮 R2 整改：**PR 未创建**（分支 `agent/hephi-r2-remediation` 仅本地、未推送；截至本索引更新时 R1–R3 提交无对应 PR，合并方式与 PR 编号待定，确定后在此登记）。
site-pnl-diagnosis：#29（MERGED）、#42（MERGED）。

## 3. 关键设计文档

| 主题 | 文件 |
| --- | --- |
| 自检（代码/清单/测试/验收矩阵） | `docs/self-check-2026-11-07.md` |
| G2 基线预检/审查 | `docs/g2-preflight.md`、`docs/g2-baseline-review.md` |
| 分支与实载一致性 | `docs/source-consistency.md` |
| P8 部署/回滚/竞态 | `docs/p8-deploy-record.md`、`docs/p8-race-record.md` |
| P10 离线构建 | `docs/p10-offline-build.md` |
| P11 smoke（原生/hephi 激活） | `docs/p11-smoke-record.md`、`docs/p11-hephi-smoke-record.md` |
| P15 基线归档 | `docs/p15-baseline.md` |
| P2/P3/P4/P5 规则 | `hephi/docs/versioning.md`、`decisions-format.md`、`enforcement-modes.md` |
| activation v2 规范化哈希 / dirty 构建规则 | `hephi/docs/versioning.md` §2.1、§3（R1 `9e874f8`、R2 `0d7c031`） |
| R1/R2 修复验收记录（命令、退出码、局限） | `docs/remediation-r1-validation.md`（本轮新增） |
| R3 部署/回滚/健康门禁验证记录 | `docs/remediation-r3-validation.md`（本轮新增） |
| 实例检查配置快照 | `docs/instance-config/site-pnl-checks.json` |

## 4. 不在 git 中的运行产物（评审时可复核路径，不提交）

| 产物 | 路径 |
| --- | --- |
| P15 基线归档（含 61 Ticket / 85 Trigger / 85 Disposition / 107 Thread / 85 关联，含生产数据） | `/Users/zm/dsh-instances/experiment/evidence/p15-baseline-20261107-r2/`（旧版 `p15-baseline-20261107/`） |
| G1 状态回读证据 | `/Users/zm/dsh-instances/experiment/evidence/g1-host-probe-20261107/host-state.json` |
| 部署/回滚记录 | `/Users/zm/dsh-instances/experiment/logs/deploy-*.json`、`rollback-*.json` |
| 不可变构建目录 | `/Users/zm/dsh-instances/experiment/releases/hephi/` |
| 实验实例检查配置（实际生效副本） | `/Users/zm/dsh-instances/experiment/project-config/site-pnl-checks.json` |
| hephi 激活证据（合同/决策/检查记录） | `/Users/zm/dsh-instances/experiment/state/hephi/<ticketId>/` |
| 外部评审证据副本（部署/回滚/宿主状态/P15 归档副本） | `/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/evidence/` |

> R1/R2/R3 的测试原始输出**未随提交归档**：R1/R2 只记录命令与摘要（见 `docs/remediation-r1-validation.md`）；R3 假宿主原始输出在本机 `/tmp/r3-fakehost.log`、`/tmp/r3-pnpm-test.log`（临时目录，不入库），摘要见 `docs/remediation-r3-validation.md`。建议 R5 独立复跑时统一落盘到证据目录。

## 5. 建议评审顺序

1. `docs/self-check-2026-11-07.md`（含未修复限制、时点说明与 §6 本轮修复追记）
2. 代码 diff：`git diff 718087c..origin/main -- hephi/src hephi/tests hephi/tsdown.config.ts hephi/package.json scripts eval`
3. `docs/p8-*.md`、`docs/p11-*.md`、`docs/p10-offline-build.md`（真实操作记录与限制）
4. 复核测试：`cd hephi && pnpm test` + `node ../scripts/host/test-deploy-hephi.mjs`（**20 文件 / 202 tests** + **44 假宿主断言**，2026-11-07 06:51，Node `v22.19.0`）；`pnpm check` 含构建，必须在**已提交干净工作树**上运行（R2 起 dirty 树直接拒绝构建）
5. 本轮修复 diff：`git diff 5efd708..0d58bc3 -- hephi/ scripts/`（R1+R2+R3；尚未合并）
6. 本轮修复证据：`docs/remediation-r1-validation.md`、`docs/remediation-r3-validation.md`

## 6. R1／R2／R3 修复与验证索引（分支 `agent/hephi-r2-remediation`，未合并）

| 工作包 | 提交 | 主要文件 | 验证（实测） | 证据/局限 |
| --- | --- | --- | --- | --- |
| R1 activation v2 规范化哈希 | `9e874f8` | `hephi/src/control/activation.ts`、`hephi/tests/control/activation.test.ts`、`hephi/docs/versioning.md` | `pnpm exec vitest run tests/control/activation.test.ts` → **30 passed**（含 R1-T01–T12）；`pnpm typecheck` exit 0 | `docs/remediation-r1-validation.md`；测试原始输出未归档 |
| R2 dirty 构建拒绝 | `0d7c031` | `hephi/tsdown.config.ts`、`hephi/tests/control/build-commit.test.ts`、`hephi/docs/versioning.md` | `pnpm exec vitest run tests/control/build-commit.test.ts` → **9 passed**（R2-T01–T08 + 配置惰性）；真实 dirty 工作树 `pnpm build` → **exit 1**，错误 `refusing to build from a dirty working tree` | 同上；独立克隆 dirty 负例与无 git 归档路径未做（见验证记录“未验证”） |
| R3 不可变部署/自动回滚/全健康门禁 | `0d58bc3` | `scripts/host/deploy-hephi.sh`（重写）、`scripts/host/test-deploy-hephi.mjs`（新增）、`hephi/tests/control/deploy-script.test.ts`（新增） | `node scripts/host/test-deploy-hephi.mjs` → **PASS: 44 assertions**（`real 50.22s`，复核 49.55s）；`deploy-script.test.ts` 1 passed（约 50s） | **R3.7 真实宿主 A→B→A、实载 commit 回读、真实 drain API 语义未验证**；见 `docs/remediation-r3-validation.md` |
| 全量（R3 后当前工作树） | `0d58bc3` + docs 未提交改动 | — | `pnpm test` → **20 文件 / 202 tests passed**（2026-11-07 06:51:38，52.15s；Node `v22.19.0`、pnpm `11.7.0`），含 `deploy-script.test.ts` 1 用例 | 构建未跑（docs 改动使工作树 dirty，按 R2 拒绝）；最终由 R5 在干净提交复跑 |

### 6.1 测试数量时点链（不回改历史数字）

| 时点 | 文件/用例 | 来源 |
| --- | --- | --- |
| G2 审查时 | 17 文件 / 175 tests | `docs/g2-baseline-review.md` |
| 初次自检 | 17 文件 / 176 tests | `docs/self-check-2026-11-07.md` §3 |
| S6/S7 补遗后（`main@5efd708`） | 18 文件 / 180 tests | self-check §4.1；独立复核报告 §2 |
| R1 后 | 18 文件 / 192 tests | 本轮实测 |
| R1+R2 后 | 19 文件 / 201 tests | 本轮实测 `pnpm test`，2026-11-07 06:42（Node `v26.1.0`） |
| R3 后（当前） | 20 文件 / 202 tests | 本轮实测 `pnpm test`，2026-11-07 06:51（Node `v22.19.0`） |
