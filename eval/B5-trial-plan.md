# B5 开发试跑计划（2026-11-08，**本轮未执行**）

> 状态：**计划/数据 only，未执行任何运行、未调用模型、未访问宿主。**
> 本文件是运行输入的准备材料，不是实验记录、不是结果、也不能证明任何对照效应。
> 批准依据：2026-11-08 负责人口头批准“乙包的，我全部批准”（见 `eval/approvals/2026-11-08-owner-approval.md`）；
> 该批准**不**授权真的开跑，也**不**锁定 PREREG。

## 1. 计划生成（本轮真实执行）

```sh
node eval/b5-plan.mjs --tasks eval/tasks/b5-tasks.json --seed 20261107 \
     --repeat-fraction 0.2 --out /tmp/b5-trial-plan.json
# exit 0；stdout: plan written: /tmp/b5-trial-plan.json (4 runs, seed=20261107, repeats=0)
```

| 项 | 值 | 证据 |
| --- | --- | --- |
| plan JSON | `eval/evidence/b5prep/b5-trial-plan.json`（`/tmp/b5-trial-plan.json` 的副本） | sha256 见 `eval/evidence/b5prep/SHA256SUMS` |
| 生成器 | `eval/b5-plan.mjs`（plan schemaVersion 1） | plan `generatedBy` |
| `generatedAt` | `2026-11-07T22:40:23.814Z`（UTC） | plan 字段 |
| seed | `20261107` | plan 字段；**仅本次准备参数，未锁定 PREREG**（PREREG §9 `seed` 仍 TODO） |
| groups | `off,native` | plan `groups` |
| repeatFraction | `0.2` | plan 字段；仅准备参数，未锁定 |

## 2. 任务集现状（只有 2 个任务）

`eval/tasks/b5-tasks.json` 当前只有 **2 个任务**（均为 `new-feature`），均来自 `eval/tasks/B5-preparation.md` 的**边界增强 fixture**，
不是历史故障宣称、不是已准入正式样本、也不是模型实际交付：

| taskId | repo | base（真实 Git 提交） | 本轮准备状态 |
| --- | --- | --- | --- |
| `b5-task-key-whitelist` | `hephi` | `9fa8598f2beabe179b28733e484275c3775279d3` | `eval/tasks/B5-preparation.md` 记录：目标断言失败 3 次 → 参考补丁通过 3 次；fixture only |
| `previous-window-order` | `site-pnl-diagnosis` | `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | 同上 |

## 3. 计划 run 数、分组与重复（本轮计划口径）

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 总 runs | **4** | `summary.runs` |
| primary runs | 4 | 每个任务 off/native 各 1 次（`repetition=1`） |
| repeat runs | **0** | `round(2 任务 × 0.2) = round(0.4) = 0` → 没有重复任务 |
| 每组 runs | off=2 / native=2 | `summary.perGroup` |
| 重复一致性 | **无法评估** | 0 个 repeat run，不能报告重复一致性；这不是完整 B5 实验 |
| 交错安排 | 同一任务内 off/native 相邻；任务间由 seed 排序；组顺序由 seed 决定 | 满足 RUNBOOK §5 约束 |

计划运行顺序（逐条来自 plan 的 `order`）：

| order | runId | taskId | group | repetition | repeat |
| --- | --- | --- | --- | --- | --- |
| 1 | `b5-20261107-0001-b5-task-key-whitelist-native-r1` | b5-task-key-whitelist | native | 1 | false |
| 2 | `b5-20261107-0002-b5-task-key-whitelist-off-r1` | b5-task-key-whitelist | off | 1 | false |
| 3 | `b5-20261107-0003-previous-window-order-native-r1` | previous-window-order | native | 1 | false |
| 4 | `b5-20261107-0004-previous-window-order-off-r1` | previous-window-order | off | 1 | false |

> 2 个任务即 `round(0.4)=0`，所以本计划只能验证“计划生成/交错/记录链路”，**不能**用于估计模型波动、重复一致性或样本量。
> 正式 B5 需要更多任务与分层（D-4 未定），不得由本计划外推。

## 4. 前置清单（任一不满足则不得开跑）

| # | 前置 | 要求 | 当前现状（证据） | 是否满足 |
| --- | --- | --- | --- | --- |
| P1 | **甲真实 off/native 入口** | 干净 off 环境 + 同一任务卡两种投递（RUNBOOK §4） | `hephi/docs/validation/2026-11-07-s4-acceptance.md`：**E1-off = PARTIAL**（前置/provenance 无法核验）；E1-on = PASS 但为**等价清理、非缺陷修复**；E-PR1 依赖同一 run。**不能把 A5 场景当作 B5 的 off/native 入口已验证** | ❌ 未满足 |
| P2 | off 组投递方案 | 固定 Trigger 模板或同文 Issue 经负责人 review（RUNBOOK §4.3） | 方案 B 固定模板仍是**候选**（`decisions-draft.md` D-9 = `pending-approval`）；未做真实 sha256 一致性检查 | ❌ 未满足 |
| P3 | PREREG 锁定 | 数值、版本、seed、requirements、任务清单哈希锁定（PREREG §9） | **未锁定**；`node eval/prereg-lock.mjs --check` exit 1（见 §6）；`seed=20261107` 仅是准备参数 | ❌ 未满足 |
| P4 | 任务集 | 足量任务、B2 双向 3 次一致、分层覆盖 | 仅 **2 个任务**（fixture），离正式样本量/分层很远；D-4 `N_TODO` | ❌ 未满足（规模不足） |
| P5 | 统计环境 | 固定版本依赖可用（`eval/stats/requirements.txt`） | 依赖清单存在（numpy 2.3.4 / scipy 1.16.2 / statsmodels 0.14.5）；本计划准备**未**安装 venv、未跑统计 | ⚠️ 待安装（本轮不需要） |
| P6 | 盲评准备 | 两名标注者 + rubric 校准（开发集 kappa ≥ 0.7） | 未指定标注者、未校准、无真人 kappa（B4 仅工具自测） | ❌ 未满足 |
| P7 | 模型资源 | 固定 provider/model/parameters；宿主不支持的参数如实写 `uncontrolled` | 未固定；且宿主实载版本回读（R3.7/P8）未解阻 | ❌ 未满足 |
| P8 | 费用/预算 | 成本上限（D-3）与外部预算批准 | D-3 = `pending-trial`（七项上限占位），预算未批 | ❌ 未满足 |
| P9 | 宿主/E5/E9 | A5 非 blocked 场景 + E5/E9；真实宿主探针 | **E5/E9 blocked**（H0 停机已做、H3 真实宿主探针 manual） | ❌ 未满足 |
| P10 | 环境隔离 | 全新检出 + 全新 Session；构建只在隔离克隆 | 运行纪律已写入 RUNBOOK §6；本轮无运行 | ⚠️ 待执行时保证 |
| P11 | 记录工具 | `eval/record-run.mjs`（B3）、`eval/repro-manifest.mjs`（乙5 复现包）可用 | 两工具已在仓库（可自测），但**没有真实 run 记录**（B3 未验证项） | ⚠️ 工具在、真实记录无 |
| P12 | 计划评审 | 负责人确认本计划与 seed/重复比例 | 本计划**未提交负责人 review**；seed/重复比例未锁定 | ❌ 未满足 |

## 5. 开发试跑拟执行命令（**本轮只写不跑**）

若 P1–P12 满足，按 PREREG §6 开发试跑口径：每个任务每组 **3 次**（2 任务 × 2 组 × 3 = **12 runs**，仅估计波动/基础发生率，不入正式结论）。
拟执行命令如下（`<...>` 为待负责人锁定/待提供的值；本轮均未执行）：

```sh
# 0) 任务接入自检（对真实本地 clone；本轮未执行）
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist \
     --repo <本地 hephi clone> --json
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order \
     --repo <本地 site-pnl-diagnosis clone> --json

# 1) 试跑计划（3 次重复需要按 RUNBOOK §5 的试跑方式生成/分批；本轮未执行）
node eval/b5-plan.mjs --tasks <试跑任务集.json> --seed <锁定 seed> \
     --groups off,native --repeat-fraction 0.2 --out <batch>/plan.json

# 2) 每条 run：按 RUNBOOK §4 投递任务卡，运行后校验并落盘记录（本轮未执行）
node eval/record-run.mjs --input <batch>/candidates/<runId>.json \
     --out <batch>/runs/<runId>.json

# 3) 复现包清单（只读元数据，不运行任务；本轮未执行）
node eval/repro-manifest.mjs --plan <batch>/plan.json \
     --tasks <试跑任务集.json> --out <batch>/repro-manifest.json

# 4) 机械指标（只提取机械字段；本轮未执行）
node eval/ab-metrics.mjs <batch>/runs.json

# 5) 试跑完成后用 prereg-sample 计算正式样本量（先写 pilot 汇总，再计算；本轮未执行）
node eval/prereg-sample.mjs --pilot <batch>/pilot-summary.json

# 6) 盲评（两名真人；本轮未执行，也没有真人数据）
node eval/label/export.mjs --manifest <batch>/export-manifest.json \
     --out <batch>/blind --mapping <private>/<batch>.mapping.json --seed <锁定 seed>
#   两名标注者按 eval/label/RUBRIC.md 标注后：
node eval/label/import.mjs --manifest <batch>/blind/manifest.json --labels <labels-rater-a.json>
node eval/stats/kappa.py --scores <rater-pair.json> --min 0.7   # 需 /tmp venv 安装固定依赖

# 7) 统计报告（只在试跑数据齐全后；本轮未执行）
python eval/stats/report.py --input <batch>/runs.json \
     --seed <锁定 seed> --noninferiority-margin -0.05 --min-pairs <PREREG N> \
     --out <batch>/report.md
```

## 6. 记录格式与存档

- 每 run 记录：`eval/schema/run.schema.json`（B3 字段；token 读不到写 `null`，不补 0；实载 SHA 不可回读写 `unverified`）；
- 批次目录：`<batch>/plan.json`、`<batch>/runs/<runId>.json`、`<batch>/runs.json`（汇总）、`<batch>/repro-manifest.json`；
- 盲评：`blind/` 材料 + 私有 mapping（不得放材料目录）+ 两名标注者的 `labels-*.json` + 裁决记录；
- 分析：`report.md`/`report.json` 与 `kappa` 输出；`plan.json` 与 PREREG 锁定版本、seed 一并归档（RUNBOOK §10）；
- 本仓库只提交准备材料与工具证据；**生产运行数据按 P14 不入公开仓库**。

## 7. 样本量（不提前编造）

- PREREG §6：试跑后按主指标最小有意义绝对改善 + 检验效能（power 0.8、双侧 α=0.05）计算，主要用配对 McNemar / 配对 bootstrap 模拟；
- 当前 `N_TODO` / `min_pairs=5` 仅为占位（D-4 `pending-trial`）；
- 样本量计算工具 `eval/prereg-sample.mjs` 已存在，但**本轮没有试跑输入，未执行**；任何 N 值都不得在试跑前填写。

## 8. 本轮未执行 / 未验证（如实声明）

1. **未执行任何 run**：没有开发试跑、没有正式实验、没有调用任何模型、没有访问宿主。
2. **未安装/未运行统计或盲评环境**（本轮只生成计划；B4/B6 工具证据见各自记录）。
3. **未锁定 PREREG、未生成 `eval/PREREG.lock`**；`prereg-lock --check` 仍 exit 1（未决项见 §4/§6 证据）。
4. **未指定/未培训两名真人盲评者**，无真人 kappa，无裁决记录。
5. **未固定模型/provider/参数与预算**；无真实 off/native 入口证据（E1-off partial、E5/E9 blocked）。
6. **未计算样本量**；`seed=20261107`、`repeatFraction=0.2` 只是本次计划生成参数，未锁定。
7. 本计划只覆盖 2 个 fixture 任务、4 个 primary runs、0 个 repeat；**不能**用于重复一致性、模型波动或效应结论。

## 盲评阶段：单人评审降级（2026-11-08）

负责人选择单人+独立 agent 模式（`eval/approvals/2026-11-08-single-human-eval-mode.md`）：
- 试跑/正式实验的盲评阶段由 **1 名真人（负责人）+ 1 个独立 agent** 完成；
- 一致性写 `human–agent agreement`，不得写双人 kappa；
- B5 结果标签 `single-rater`，不得作为双人盲评最终结论；
- 若日后有第二名真人，按原计划补双人盲评并升级结论。
