# 实施索引（供外部评审）

更新时间：2026-11-07（Asia/Shanghai）。本索引列出所有已提交的代码/文档、已合并 PR、以及**不在 git 中的运行产物**（生产数据与宿主日志，按 P14 不提交），便于外部模型逐项核查。

## 1. 仓库与提交

| 仓库 | 分支/标签 | 当前 SHA | 说明 |
| --- | --- | --- | --- |
| `paxxie2/super-agent-hephi-review` | `main` | 见 `git rev-parse origin/main`（本轮最终 `3141a37`） | PR #7–#18 已合并 |
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

## 2. 合并 PR

super-agent-hephi-review：#7、#8、#9、#10、#11、#12、#13、#14、#15、#16、#17、#18（均 MERGED）。
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

## 5. 建议评审顺序

1. `docs/self-check-2026-11-07.md`（含未修复限制与修复项）
2. 代码 diff：`git diff 718087c..origin/main -- hephi/src hephi/tests hephi/tsdown.config.ts hephi/package.json scripts eval`
3. `docs/p8-*.md`、`docs/p11-*.md`、`docs/p10-offline-build.md`（真实操作记录与限制）
4. 复核测试：`cd hephi && pnpm check`（180 tests）
