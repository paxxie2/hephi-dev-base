# 本地分支与运行副本一致性表（P16）

核对时间：2026-11-07 07:57（Asia/Shanghai；R4 同步 + **R3 复核返修登记**，返修已提交 `2409613`，文档登记随本文件所在提交（docs）提交）。本表只记录可回读的源码/构建事实；"实载"一栏在宿主提供版本回读入口前保持**未验证**。历史 HEAD 一律标明时点，不作为当前值。

## 1. 代码副本

| 副本 | 位置 | 分支/引用 | HEAD | 状态 |
| --- | --- | --- | --- | --- |
| 远端主干 | `github.com/paxxie2/super-agent-hephi-review` | `main` | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（PR #19 合并提交；2026-11-07 06:42 `git ls-remote` 回读） | 当前主干 |
| 执行分支 | `/Users/zm/dsh-instances/experiment/hephi-review` | `codex/dual-instance-hephi` | `b660051` | 历史时点；已随 PR #7 合入 main（`3f276a5`） |
| 本轮修复分支 | 同上 | `agent/hephi-r2-remediation` | 提交历史 `0d58bc3` → R4 `17d3827d3a73d3afb7a3b8de130d1615bd351769` → **R3 返修 `240961395ce0fb323683bab21830fbdc123257d8`**（仅 `scripts/host/` 两文件）；`docs/` 返修登记随本文件所在提交（docs）提交 | **已推送 origin；PR #20 OPEN、未合并**；R3 原实现被 PR #20 独立复核判定**不通过**（R3-F1–F6），`2409613` 已修复并补 N1–N5（假宿主 69 断言全绿），待二次独立复核 |
| 旧路线图目录 | `/Users/zm/Documents/hephi-roadmap-work` | `work/hephi-95` | 已不存在 | 2026-11-07 核验时目录已删除；`c547dc1` 无法再取用 |
| 隔离 Super Agent 副本 | `/Users/zm/dsh-instances/experiment/superagent` | `codex/dual-instance-experiment` | `62d7d53` | 工作树干净 |
| 隔离赫菲副本 | `/Users/zm/dsh-instances/experiment/hephi-review/hephi` | 本轮修复分支 | `0d58bc3` 内容 + R4 `17d3827` 文档 + 返修 `2409613` 脚本（`hephi/` 代码区干净；`docs/` 返修登记随文档提交） | 2026-11-07 06:51 实测 `pnpm test` **20 文件 / 202 tests** 通过（Node `v22.19.0`、pnpm `11.7.0`）；返修后假宿主套件 **69 断言全绿**（`84.23s`）、全量 `pnpm test` **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`）；`pnpm check` 构建段须在 docs 提交后的干净树复跑（`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）） |

执行分支相对 `a212d69` 的提交（按顺序）：`f53f9c6` P12/P13/P14/P15/G1 脚本；`7a26d0f` P1 CI（其 workflow 已按用户 2026-11-07 决定删除）；`1ea45b9` P4/P7/P8/P9/P10/P11 脚本；`b8415e9` c547 等价修复；`42b766d` P5；`89d4ab9` P2；`e373c68` P3；`abfdd3a` P4；`44e888c` P16；`a96dc1b` P6。

## 2. c547 修复登记

- 原提交 `c547dc1`（父提交 `718087c`，4 文件 `+34/−10`）只存在于旧目录的 `work/hephi-95`；2026-11-07 核验时旧目录已被删除，远端也没有该提交，**不可直接取用**。
- **等价修复：`b8415e9`**，同为 4 个文件（`src/control/evidence-verifier.ts` 与 3 个测试文件），内容为“检查记录的 argv/cwd 必须匹配冻结核”，带伪造 argv、伪造 cwd 两条负例。
- 状态：等价修复已随 PR #7 合入远端 `main`（`3f276a5`），基线标签 `hephi-baseline-1` 指向该提交。

## 3. 构建与实载

| 项 | 值 |
| --- | --- |
| 构建来源 | `hephi/` @ `0d58bc3`（历史构建时点 `abfdd3a`）；当前 `pnpm typecheck` exit 0、`pnpm test` **20 文件 / 202 tests**（2026-11-07 06:51，Node `v22.19.0`）；`pnpm check` 的构建段须在**干净工作树**复跑 |
| 构建 commit 注入 | tsdown 注入 `__HEPHI_COMMIT__`；有 `.git` 时以完整 HEAD 为唯一来源（R2 `0d7c031` 起 **dirty 树直接拒绝构建**，不再写 `<sha>-dirty`）；无 git 源码归档须显式 `HEPHI_BUILD_COMMIT` 为完整 40 位十六进制 |
| 部署脚本（R3 `0d58bc3` + 复核返修 `2409613`） | `scripts/host/deploy-hephi.sh`：`--host-version` 必填、`git archive <sha>` 到独立临时目录构建（`HEPHI_BUILD_COMMIT=<sha>`）、发布不可变 `releases/<sha>/`（`.incoming` + 校验 + 原子 `mv`）、`$hephi/lib` 用同文件系统临时 symlink 原子 rename 切换、10 项全量健康门禁、失败自动恢复 previous。**复核返修**：普通 `lib/` 目录迁移事务（旧目录原子改名 `.migration-*` 后再切 symlink，第二步失败恢复旧目录）、rollback 强制显式 `--target`／`--previous` 完整 SHA、结果拆 `failed-no-previous`/`failed-restored-previous`/`failed-twice`、全部 `set_pointer` 失败捕获、结束时真实回读 `paused`/`load`/`health`、恢复 current 前单独校验 `current_valid`。**尚未用于真实宿主部署**（仅假宿主验证；返修后套件 `PASS: 69 assertions`、exit 0，旧提交上 20 条 FAIL） |
| 当前工作树状态 | HEAD `2409613`（R3 返修复提交）；`hephi/` 与 `scripts/host/` 代码区干净，**`docs/` 返修登记已随文档提交**（本文件所在提交）；提交后工作树干净，`pnpm check`（含构建）已通过（见上）；若工作树 dirty，按 R2 规则 `pnpm build` 会 **exit 1**（`refusing to build from a dirty working tree`） |
| 实验宿主 B | `http://127.0.0.1:3083` 运行中（2026-11-07 完成一次真实部署，见 `docs/p8-deploy-record.md`） |
| 日常宿主 A | `http://127.0.0.1:3082` 已启动（2026-11-07，host.pid 96013，无赫菲，可作为“无插件”对照） |
| **实载 commit** | **未验证**：仓库无 `describePlugin` 回读入口，宿主无版本查询 API；不得以“重启成功”冒充实载 |

## 3.1 交付 PR

- 交付 PR：<https://github.com/paxxie2/super-agent-hephi-review/pull/7>（`codex/dual-instance-hephi` → `main`），**已于 2026-11-06T19:51:33Z 合并**，merge commit `3f276a5`。#8（状态记录）、#9（部署脚本 + P8 记录）、#10（P11 smoke + A 实例）随后合并；#11–#19 已合入当前 `main@5efd708`。
- 本轮修复提交（未合并）：R1 `9e874f8`（activation v2 规范化哈希）、R2 `0d7c031`（dirty 构建拒绝）、R3 `0d58bc3`（不可变部署/自动回滚/全量健康门禁）、R4 `17d3827`（文档同步）；分支 `agent/hephi-r2-remediation` 已推送 origin，PR #20 OPEN、未合并。验收记录见 [`docs/remediation-r1-validation.md`](remediation-r1-validation.md)、[`docs/remediation-r3-validation.md`](remediation-r3-validation.md)。
- **R3 复核返修（提交 `2409613`）**：PR #20 独立复核判定 R3 不通过（R3-F1–F6），已修复六项并新增负例 N1／N1b／N2／N3／N4／N5 到 `scripts/host/test-deploy-hephi.mjs`，提交 **`2409613`**；**双向实测**：修复提交 → `PASS: 69 assertions`、FAIL 0、exit 0（`84.23s`）；旧提交 `17d3827` → exit 1、PASS 50 / FAIL 19（复跑一致）。**本次只关闭 F1–F6 与 N1–N5 自动化；R3.7 真实宿主未验证；PR 未合并。**登记见 [`docs/remediation-r3-review-fix.md`](remediation-r3-review-fix.md)。假宿主通过 ≠ 真实宿主验收，R3.7 仍 unverified。
- 基线标签 **`hephi-baseline-1`**（annotated，tag object `1e93e4b`）指向合并后的 `main` commit `3f276a5`，已推送远端。
- 审查记录见 `docs/g2-baseline-review.md`：按用户 2026-11-07 授权由 Agent 代办，**不是人类独立审查**。

## 3.2 生产基线归档

- P15 首次归档见 [`docs/p15-baseline.md`](p15-baseline.md)：60 条唯一 Ticket（目标 ≥100 未达，如实记录）、32 个 PR 元数据、SHA256 与校验结果；原始归档在本机证据目录，不入库。

## 3.3 P10 离线构建

- 离线编译与离线单元测试已在 Dubbo 源码（`/Users/zm/workspace/app/dubbo`）实测通过，记录见 [`docs/p10-offline-build.md`](p10-offline-build.md)；三个候选任务与平台检查配置仍未完成。

## 4. CI

- 按用户 2026-11-07 决定，**不使用 GitHub Actions**。`7a26d0f` 引入的 `.github/workflows/hephi-check.yml` 已删除，P1 不实施；CI 通过与否不作为合并或基线门禁。
- 因此本仓库的唯一检查入口是本地 `pnpm check`（typecheck + tests + 构建）。当前为 **20 文件 / 202 tests**（2026-11-07 06:51 实测，Node `v22.19.0`；构建段须在干净树运行，R2 起 dirty 直接拒绝）。

## 5. 其他一致性项

- PR #2：`2026-11-05T16:22:58Z` 已 **MERGED**（base `cursor/hephi-effectiveness-report-1199`）。旧文档中“未合并”的说法只适用于当时快照，已过时。
- Skill 修改：**未实施**。`hephi/docs/skill-change-proposal.md` 是待批准的 diff；按 P16 必须专项批准，本次未改 `hephi/skills/hephi-superagent-control/SKILL.md`。
- 历史 probes：`probes/effectiveness.probe.test.ts` 只适用于原始快照 `8e68ec2`，不作为现行基线。
- 历史验证记录：`hephi/docs/validation/` 每份都只证明其所标明的版本与时间，不能当作当前构建的端到端证据。
