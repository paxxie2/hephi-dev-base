# 本地分支与运行副本一致性表（P16）

核对时间：2026-11-07（Asia/Shanghai）。本表只记录可回读的源码/构建事实；"实载"一栏在宿主提供版本回读入口前保持**未验证**。

## 1. 代码副本

| 副本 | 位置 | 分支/引用 | HEAD | 状态 |
| --- | --- | --- | --- | --- |
| 远端主干 | `github.com/paxxie2/super-agent-hephi-review` | `main` | `3f276a5`（PR #7 合并后） | `git ls-remote` 回读 |
| 执行分支 | `/Users/zm/dsh-instances/experiment/hephi-review` | `codex/dual-instance-hephi` | `b660051` | 已随 PR #7 合入 main |
| 旧路线图目录 | `/Users/zm/Documents/hephi-roadmap-work` | `work/hephi-95` | 已不存在 | 2026-11-07 核验时目录已删除；`c547dc1` 无法再取用 |
| 隔离 Super Agent 副本 | `/Users/zm/dsh-instances/experiment/superagent` | `codex/dual-instance-experiment` | `62d7d53` | 工作树干净 |
| 隔离赫菲副本 | `/Users/zm/dsh-instances/experiment/hephi-review/hephi` | 同执行分支 | `b660051` | 合并后 `pnpm check` 175 tests 通过 |

执行分支相对 `a212d69` 的提交（按顺序）：`f53f9c6` P12/P13/P14/P15/G1 脚本；`7a26d0f` P1 CI（其 workflow 已按用户 2026-11-07 决定删除）；`1ea45b9` P4/P7/P8/P9/P10/P11 脚本；`b8415e9` c547 等价修复；`42b766d` P5；`89d4ab9` P2；`e373c68` P3；`abfdd3a` P4；`44e888c` P16；`a96dc1b` P6。

## 2. c547 修复登记

- 原提交 `c547dc1`（父提交 `718087c`，4 文件 `+34/−10`）只存在于旧目录的 `work/hephi-95`；2026-11-07 核验时旧目录已被删除，远端也没有该提交，**不可直接取用**。
- **等价修复：`b8415e9`**，同为 4 个文件（`src/control/evidence-verifier.ts` 与 3 个测试文件），内容为“检查记录的 argv/cwd 必须匹配冻结核”，带伪造 argv、伪造 cwd 两条负例。
- 状态：等价修复已随 PR #7 合入远端 `main`（`3f276a5`），基线标签 `hephi-baseline-1` 指向该提交。

## 3. 构建与实载

| 项 | 值 |
| --- | --- |
| 构建来源 | `hephi/` @ `abfdd3a`，`pnpm check`（typecheck + 175 tests + tsdown） |
| 构建 commit 注入 | tsdown 注入 `__HEPHI_COMMIT__`；干净树为 `abfdd3a`，dirty 树为 `<sha>-dirty`（P2） |
| 实验宿主 B | `http://127.0.0.1:3083` 运行中（2026-11-07 完成一次真实部署，见 `docs/p8-deploy-record.md`） |
| 日常宿主 A | `http://127.0.0.1:3082` 已启动（2026-11-07，host.pid 96013，无赫菲，可作为“无插件”对照） |
| **实载 commit** | **未验证**：仓库无 `describePlugin` 回读入口，宿主无版本查询 API；不得以“重启成功”冒充实载 |

## 3.1 交付 PR

- 交付 PR：<https://github.com/paxxie2/super-agent-hephi-review/pull/7>（`codex/dual-instance-hephi` → `main`），**已于 2026-11-06T19:51:33Z 合并**，merge commit `3f276a5`。
- 基线标签 **`hephi-baseline-1`**（annotated，tag object `1e93e4b`）指向合并后的 `main` commit `3f276a5`，已推送远端。
- 审查记录见 `docs/g2-baseline-review.md`：按用户 2026-11-07 授权由 Agent 代办，**不是人类独立审查**。

## 3.2 生产基线归档

- P15 首次归档见 [`docs/p15-baseline.md`](p15-baseline.md)：60 条唯一 Ticket（目标 ≥100 未达，如实记录）、32 个 PR 元数据、SHA256 与校验结果；原始归档在本机证据目录，不入库。

## 4. CI

- 按用户 2026-11-07 决定，**不使用 GitHub Actions**。`7a26d0f` 引入的 `.github/workflows/hephi-check.yml` 已删除，P1 不实施；CI 通过与否不作为合并或基线门禁。
- 因此本仓库的唯一检查入口是本地 `pnpm check`（typecheck + 175 tests + 构建）。

## 5. 其他一致性项

- PR #2：`2026-11-05T16:22:58Z` 已 **MERGED**（base `cursor/hephi-effectiveness-report-1199`）。旧文档中“未合并”的说法只适用于当时快照，已过时。
- Skill 修改：**未实施**。`hephi/docs/skill-change-proposal.md` 是待批准的 diff；按 P16 必须专项批准，本次未改 `hephi/skills/hephi-superagent-control/SKILL.md`。
- 历史 probes：`probes/effectiveness.probe.test.ts` 只适用于原始快照 `8e68ec2`，不作为现行基线。
- 历史验证记录：`hephi/docs/validation/` 每份都只证明其所标明的版本与时间，不能当作当前构建的端到端证据。
