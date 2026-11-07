# B2 开发任务集扩充审计（2026-11-08）

- 基线：`main=93bfd063488d3fd0cb37b5951cf5a8522437e45a`（本分支 `/tmp/b2tasks` 全新克隆，分支 `agent/b2-tasks`）。
- 范围：只改 `eval/**`；本文件与 `eval/tasks/**`、`eval/evidence/b2expand/**` 是本次交付。
- 结论：**新增 20 个任务并通过 full-mode 真实执行**；任务集从 2 个扩充到 22 个（hephi 12、site-pnl-diagnosis 10，均 ≥10）；五个 schema 类别在两仓均覆盖。
- 本文所有 full-mode 结果都是本机真实执行的 `node eval/check-task.mjs ... --repeats 3 --json`（退出码 0），不是 dry-run、不是静态推断。原始 JSON 已随任务归档在 `eval/evidence/b2expand/`（含 `SHA256SUMS`）。

## 1. 任务总数与类别分布

| repo | defect-fix | new-feature | behavior-preserving-refactor | cross-module | staged-suitable | 合计 |
| --- | --- | --- | --- | --- | --- | --- |
| hephi | 3 | 5 | 1 | 2 | 1 | 12 |
| site-pnl-diagnosis | 3 | 3 | 2 | 1 | 1 | 10 |

- 新增任务：hephi 11 个、site-pnl-diagnosis 9 个，共 20 个；保留并复核原 2 个任务。
- `staged-suitable` 只用于 staged 实验标记（`stagedSuitable=true`）：`hephi/record-run`、`site-pnl-diagnosis/frontend-form-feedback`；其余任务不进 staged 分层结论。
- 任务来源全部是本地真实仓库历史提交：hephi 为 super-agent-hephi-review 仓库真实提交；site-pnl-diagnosis 为其源仓库 `/Users/zm/dsh-instances/experiment/sources/site-pnl-diagnosis` 中 `agent/*` 分支上的真实提交（含 refactor/fix/feat），不是合成夹具、不是 dry-run 产物。

## 2. 新增/现有任务与 full-mode 结果

命令统一为 `node eval/check-task.mjs <taskDir> --repo <repo> --repeats 3 --json`；`<repo>`：hephi 用 `/tmp/b2tasks`，site-pnl 用源仓库路径。下表每行退出码均为 0（`ok=true`），base 连续 3 次失败、reference 连续 3 次通过、`outside=[]`。

### hephi（12 个，其中新增 11 个）

| 任务 | repo | category | base (40hex) | full-mode 退出码 | base codes | ref codes | base outputSha256(前16) | ref outputSha256(前16) | 范围 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ab-metrics-mechanical` | hephi | defect-fix | `7c52d33a6d5c334c4f81c3408a2222853df0711b` | 0 | [1, 1, 1] | [0, 0, 0] | `ef7dabc3236b2af2` | `f23d4c0c60b50ddb` | outside=[] |
| `b5-task-key-whitelist` | hephi | new-feature | `9fa8598f2beabe179b28733e484275c3775279d3` | 0 | [1, 1, 1] | [0, 0, 0] | `c3cdee39c29d8347` | `8b411f28e90e0a6d` | outside=[] |
| `b7-matrix` | hephi | new-feature | `858711a86009efb5ed79308c9bee4d9a7583a943` | 0 | [1, 1, 1] | [0, 0, 0] | `8dfe28cc6d4d4611` | `c14abbf99137a728` | outside=[] |
| `daily-export-rework` | hephi | cross-module | `d0a84acc0436d81c314e899e93d5c26ea4c8fa7f` | 0 | [1, 1, 1] | [0, 0, 0] | `a913c26e3c8f84fb` | `c82ef0fa6f12bc7e` | outside=[] |
| `data-package-symlink` | hephi | defect-fix | `0a6e2d010591a01164d1808bfeb809497e289359` | 0 | [1, 1, 1] | [0, 0, 0] | `0ecae119c4b7e455` | `f317511eb72d085e` | outside=[] |
| `effects-db-checker` | hephi | cross-module | `57564b89bcd1a8bd25d9216ac8ba966aa0d1d62d` | 0 | [1, 1, 1] | [0, 0, 0] | `0c3b333ad564b51c` | `ae1ffdc0b4944aed` | outside=[] |
| `prereg-lock-gate` | hephi | new-feature | `5dcb5c2ccf31956560db25c2aa503612ac2ed9e3` | 0 | [1, 1, 1] | [0, 0, 0] | `0454ef2ab831cbc5` | `b84c9d19ffbb6562` | outside=[] |
| `prereg-lock-version` | hephi | defect-fix | `bcb4c8c038a8272b3003bf10143ed273e43c97db` | 0 | [1, 1, 1] | [0, 0, 0] | `59e6b00577a73475` | `c8f01077764fb30c` | outside=[] |
| `record-run` | hephi | staged-suitable（stagedSuitable=true） | `bc21caca316d6032ebcc3d2bc6387c38e0a3579c` | 0 | [1, 1, 1] | [0, 0, 0] | `3069ee03a834a16e` | `872489304321ddf8` | outside=[] |
| `repro-manifest` | hephi | new-feature | `2af288e5780269c70292d3531245b76a5a7b07cb` | 0 | [1, 1, 1] | [0, 0, 0] | `2596dc9793ccff93` | `dd27f87f946f94eb` | outside=[] |
| `test-layers` | hephi | behavior-preserving-refactor | `44e888cef161fd0c30daa1dc91f362d91eb2b1e0` | 0 | [1, 1, 1] | [0, 0, 0] | `0692c7b6606cfe0b` | `76cc3b96b801bcb8` | outside=[] |
| `verify-export` | hephi | new-feature | `63f2f98ac2a0ccc7666fe1fd316abfe7b40065f0` | 0 | [1, 1, 1] | [0, 0, 0] | `5407e9b6fef5ce7f` | `98d5cea5df2ce398` | outside=[] |

### site-pnl-diagnosis（10 个，其中新增 9 个）

| 任务 | repo | category | base (40hex) | full-mode 退出码 | base codes | ref codes | base outputSha256(前16) | ref outputSha256(前16) | 范围 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `backend-input-validation` | site-pnl-diagnosis | cross-module | `e00f338b098546adc40156dc15b4b6559e19835d` | 0 | [1, 1, 1] | [0, 0, 0] | `47bd9e8895cbaa7c` | `27691a00d13d6283` | outside=[] |
| `backend-validation-messages` | site-pnl-diagnosis | new-feature | `e00f338b098546adc40156dc15b4b6559e19835d` | 0 | [1, 1, 1] | [0, 0, 0] | `fb1bbdaf5e24151a` | `46e2c456257ef729` | outside=[] |
| `frontend-form-feedback` | site-pnl-diagnosis | staged-suitable（stagedSuitable=true） | `418af9a671c30cc6e7ceaea70f53be47335c8b88` | 0 | [1, 1, 1] | [0, 0, 0] | `a22bc9f547162744` | `3cfeeb4aa203747e` | outside=[] |
| `health-service-field` | site-pnl-diagnosis | new-feature | `e00f338b098546adc40156dc15b4b6559e19835d` | 0 | [1, 1, 1] | [0, 0, 0] | `74d766fba6e6e9bd` | `c6c2496f5ff6dbcb` | outside=[] |
| `history-page-size` | site-pnl-diagnosis | defect-fix | `bd816e9eb019b0520b98dbc1bd53bdf0c85010d4` | 0 | [1, 1, 1] | [0, 0, 0] | `f0378142cc1ccd2d` | `9d5504f9f58922a4` | outside=[] |
| `money-window-helpers` | site-pnl-diagnosis | behavior-preserving-refactor | `8d2ec5858ed3071eae598e5afb30b069807ce598` | 0 | [1, 1, 1] | [0, 0, 0] | `557064954c1908ee` | `ca8de9520bebbbc8` | outside=[] |
| `previous-window-order` | site-pnl-diagnosis | new-feature | `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | 0 | [1, 1, 1] | [0, 0, 0] | `d9cba4ddb6ba6c41` | `51c6ca62c1e76cf5` | outside=[] |
| `restore-data-package` | site-pnl-diagnosis | defect-fix | `e00f338b098546adc40156dc15b4b6559e19835d` | 0 | [1, 1, 1] | [0, 0, 0] | `cabc23247a91c911` | `a5979cccda1fc276` | outside=[] |
| `restore-health-service-id` | site-pnl-diagnosis | defect-fix | `e00f338b098546adc40156dc15b4b6559e19835d` | 0 | [1, 1, 1] | [0, 0, 0] | `a22bc9f547162744` | `372fa39dd5ea7e41` | outside=[] |
| `settings-dead-branches` | site-pnl-diagnosis | behavior-preserving-refactor | `8d2ec5858ed3071eae598e5afb30b069807ce598` | 0 | [1, 1, 1] | [0, 0, 0] | `37bafc1eb3cdd0f7` | `cb9f7fe6eac1662d` | outside=[] |

补充：上表 base/ref 输出 hash 为 3 次中的首条；同一阶段 3 次 `outputSha256` 全部一致（`base_consistent_sha=true`、`ref_consistent_sha=true`），原始 JSON 里可逐条核对。每任务的 `reference.patch` 由 `git diff <base> <fix>` 生成，`allowedFiles` 与补丁文件一致；`review.md` 记录合法范围理由。

## 3. 污染边界（如实，不伪造 ≥1/3）

- 22 个任务全部为 `contamination.mergedAfterTrainingCutoff=false`、`private=false`、`cutoff=null`。
- 依据：这些真实提交的作者时间戳都在 2026-11 月（晚于常见训练截止日期），但**模型训练截止时间在本环境未验证**。按“无法确认写 false/unknown”的要求，保守记为 false，**不宣称去污染**；因此本任务集**不满足** ROADMAP §4 B2 的“至少 1/3 来自截止后合并/私有仓库”门槛（0/22 经确认）。
- 结论：污染门槛仍是缺口（见 §6），不能据此声称 B2 的污染控制达标。

## 4. 评审者说明（如实）

- **评审者为 agent 辅助评审，非两名人类评审。** 任务卡、隐藏测试、参考补丁与范围判定由 B2 执行者（agent）从真实提交生成并自检；没有任何第二名独立人类评审者、评审签名或裁决记录，也没有人类主评审。每个 `review.md` 都写明了这一点。
- full-mode 只证明“任务有效性（base 失败/reference 通过/3 次一致/范围不越界）”，**不等于**人类评审通过，也不等于模型效果证据。

## 5. 复现命令与原始证据

```sh
node eval/check-task.mjs --self-test
# 每个新任务的 dry-run（结构校验；不计入 full-mode 结论）
node eval/check-task.mjs eval/tasks/hephi/prereg-lock-gate --dry-run
# ...（22 个任务逐个执行，退出码均为 0）
# 每个任务的 full-mode（真实执行；结果见 §2 与 evidence JSON）
node eval/check-task.mjs eval/tasks/hephi/prereg-lock-gate --repo /tmp/b2tasks --repeats 3 --json
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/money-window-helpers --repo /Users/zm/dsh-instances/experiment/sources/site-pnl-diagnosis --repeats 3 --json
node eval/b5-plan.mjs --tasks eval/tasks/b5-tasks.json --seed 20261107 --dry-run
git diff --check
```

- full-mode 原始输出：`eval/evidence/b2expand/hephi/*.json`、`eval/evidence/b2expand/site-pnl-diagnosis/*.json`，校验和见 `eval/evidence/b2expand/SHA256SUMS`。
- 本机环境：Node v26.1.0、Python 3.14.2、git；无网络调用（hidden-test 只用仓库内 Node/Python 工具链与 git，无安装）。

### 验收命令与退出码（本轮最终状态，2026-11-08）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 工具自测 | `node eval/check-task.mjs --self-test` | `SELF-TEST: PASS`，exit 0 |
| 每任务结构校验 | 22 个任务逐个 `node eval/check-task.mjs <taskDir> --dry-run` | 22/22 exit 0 |
| B5 计划 dry-run | `node eval/b5-plan.mjs --tasks eval/tasks/b5-tasks.json --seed 20261107 --dry-run` | exit 0（22 个任务，五类均入计划） |
| 空白检查 | `git diff --check` 与 `git diff --check 93bfd06..HEAD` | 均 exit 0（`eval/.gitattributes` 仅豁免 `reference.patch` diff 工件的 blank-at-eol） |
| 每任务 full-mode | 见 §2 | 20 个新任务全 exit 0；原 2 个任务复核 exit 0 |
| 工作树 | `git status --porcelain` | 空（干净） |

## 6. 缺口与未验证项（不得写成已完成）

1. **人类双评审缺失**：只有 agent 辅助评审，非两名熟悉仓库的人类评审者（见 §4）。
2. **污染控制未达标**：0/22 经确认的“训练截止后合并/私有仓库”任务，低于 ≥1/3 门槛（见 §3）。
3. **无真实模型/宿主实验**：没有 off/native 真实对照运行、没有模型调用、没有 DSH 宿主端到端证据；full-mode 只是 `check-task` 工具级有效性验证。
4. **未做整仓回归**：hephi 的 pnpm/vitest 全量与 site-pnl 的 `uv run pytest` 全量都未在任务 base 上执行；hidden-test 只覆盖本任务目标断言。site-pnl 任务均用系统 `python3` + 纯标准库断言（worktree 无 `.venv`，为避免联网安装未引入项目 venv）。这是有意的离线取舍，不能当作“回归全绿”。
5. **hephi TS 模块任务未纳入**：`hephi/src/**` 的真实修复提交（如 check-runner/activation）需要 `node_modules` 才能跑 vitest，而 check-task 的临时 worktree 不带依赖且禁止联网安装；因此 hephi 任务全部基于纯 Node 的 `eval/*.mjs` / `scripts/host/*.mjs` 真实提交。
6. **参考补丁子集**：`site-pnl-diagnosis/frontend-form-feedback` 剔除了该真实提交里的 `*.png` 证据截图与含 `curl` 的 e2e/证据文档（二进制与本地服务命令），只保留代码/前端/e2e spec 子集，已在任务 review.md 记录；`hephi/repro-manifest` 因补丁源码注释含 `pip install` 文本，`environment.commandsMustMatchOffline=false`（如实记录），其余任务为 true。
7. **隐藏测试的边界**：hephi 多个任务的 hidden-test 调用仓库自带 `--self-test`（这些自测使用系统临时目录）；site-pnl 多个任务的 hidden-test 是纯 Python 标准库/ AST 源码契约断言。它们能真实区分 base 与 reference，但覆盖范围窄于整仓回归，也未逐条人工复核断言语义。
8. **基线漂移**：本分支基于指定基线 `93bfd06`；远端 GitHub `main` 已前进到 `4a038f4`（+8 commits，未改动 `eval/tasks/**`、`eval/b5-tasks.json`、`eval/B2-audit.md`、`eval/check-task.mjs`、`eval/b5-plan.mjs`）。分支未 rebase；创建 PR 时远端 `main` 为 `0b7bada2ca3e6e0664e6e5009eca9f2dfbb035ee`，PR 三点 diff 只包含本分支改动；若合并需按当时 main 复查。

## 7. 分支与 PR

- 分支：`agent/b2-tasks`（本地 `/tmp/b2tasks`，基线 `93bfd06`），已推送到 `paxxie2/super-agent-hephi-review`。
- PR：[PR #69](https://github.com/paxxie2/super-agent-hephi-review/pull/69)（**不合并**，等待负责人评审）。

## 6. 单人评审降级（2026-11-08，owner-approved）

负责人于 2026-11-08 选择“单人 + 独立 agent”降级模式（见 `eval/approvals/2026-11-08-single-human-eval-mode.md`）：
- 本任务集的范围评审为 **1 名真人（负责人）+ agent 辅助评审**，不是两名人类评审；
- 因此 B2 的“两名评审者”要求仍**未满足**，状态为 partial（single-human mode）；
- agent 评审记录不得写成人类签名或裁决者记录。
