# B5 开发试跑计划（2026-11-08，**本轮未执行**）

> 状态：**计划/数据/只读核验 only。本轮未执行任何 run、未调用模型、未访问宿主/off 实例。**
> 本文件是运行输入与配对记录的准备材料，不是实验记录、不是结果，也不能证明任何对照效应。
>
> 授权依据：`eval/approvals/2026-11-08-b5-trial-authorization.md`（负责人选择 A=单人+agent 降级、
> 批准“搭 off profile 并试跑”，范围 `hephi` + `site-pnl-diagnosis` × `deepseek-flash` × off/native）。
> 该授权只覆盖**开发试跑**，不锁 PREREG、不授权正式实验、不授权声称效应结论。

## 1. 计划生成（本轮真实执行）

```sh
node eval/b5-plan.mjs --tasks eval/tasks/b5-trial-tasks.json \
     --seed 20261107 --groups off,native --repeat-fraction 0.2 \
     --out /tmp/b5-trial-plan-2.json
# exit 0；stderr: plan written: /tmp/b5-trial-plan-2.json (4 runs, seed=20261107, repeats=0)
```

| 项 | 值 | 证据 |
| --- | --- | --- |
| plan JSON | `eval/evidence/b5trial/b5-trial-plan-2.json`（`/tmp/b5-trial-plan-2.json` 的副本） | sha256 见 `eval/evidence/b5trial/SHA256SUMS` |
| 生成器 | `eval/b5-plan.mjs`（plan schemaVersion 1） | plan `generatedBy` |
| `generatedAt` | 以证据文件 `eval/evidence/b5trial/b5-trial-plan-2.json` 的 `generatedAt` 字段为准（UTC） | plan 字段/证据 |
| seed | `20261107` | 试跑参数，**未锁定 PREREG**（PREREG §9 `seed` 仍 TODO） |
| groups | `off,native` | plan `groups` |
| repeatFraction | `0.2` | 试跑参数，**未锁定 PREREG** |
| 任务子集 | `eval/tasks/b5-trial-tasks.json`（2 个任务：1 个核心配对 + 1 个流程验证） | 见 §2 |

## 2. 任务选择（与真实配对一致）

本轮**核心配对任务只有 1 个**：`previous-window-order`（site-pnl，base `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`）。
native 侧已有 4 次真实运行（另一线执行，**待核验**）；off 侧在同一配对仓库 `paxxie2/b5-native-site-pnl`
创建独立 off Issue 执行（**待执行**）。

| taskId | repo | category | base | 角色 | 现有数据 |
| --- | --- | --- | --- | --- | --- |
| `previous-window-order` | `site-pnl-diagnosis`（配对仓库 `paxxie2/b5-native-site-pnl`） | new-feature | `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | **核心配对任务**（off/native） | native：4 次真实运行（Issues #2/#4/#6/#7 → PRs #3/#5/#8/#9，OPEN，**待核验**）；off：4 次待执行 |
| `b5-task-key-whitelist` | `hephi` | new-feature | `9fa8598f2beabe179b28733e484275c3775279d3` | **仅工具/流程验证**（off/native 计划条目为流程演练占位） | **没有 native 数据，不声称、不纳入配对/效应** |

- 两个任务均通过 `eval/B2-audit.md` §2 的 `check-task --repeats 3` full-mode（exit 0，base=[1,1,1]，ref=[0,0,0]，`outside=[]`）。
- 未选 `money-window-helpers` / `prereg-lock-gate` 等任务进入本轮配对：**没有对应 native 真实运行**，避免“假装已有 native 配对数据”。
- hephi 任务只用于验证投放/记录/工具链路；其 native/off plan 条目在本轮**不执行、不声称已执行**。

## 3. 计划生成器产物（4 runs；off/native 各 2）

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 总 runs | **4** | `summary.runs` |
| primary runs | 4 | 2 任务 × off/native 各 1 次（`repetition=1`） |
| repeat runs | **0** | `round(2 任务 × 0.2) = round(0.4) = 0`，无重复任务 |
| 每组 runs | off=2 / native=2 | `summary.perGroup` |
| 交错安排 | 同一任务内分组相邻；任务间由 seed 排序；组顺序由 seed 决定 | 满足 RUNBOOK §5 |

| order | runId | taskId | group | repetition | repeat | 本轮状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `b5-20261107-0001-b5-task-key-whitelist-native-r1` | b5-task-key-whitelist | native | 1 | false | **流程验证占位，不执行/不声称** |
| 2 | `b5-20261107-0002-b5-task-key-whitelist-off-r1` | b5-task-key-whitelist | off | 1 | false | **流程验证占位，不执行/不声称** |
| 3 | `b5-20261107-0003-previous-window-order-native-r1` | previous-window-order | native | 1 | false | **已由另一线执行（4 次真实运行，待核验）** |
| 4 | `b5-20261107-0004-previous-window-order-off-r1` | previous-window-order | off | 1 | false | **待执行**（off team；按 §4 配对表创建 4 个独立 off Issue） |

> 说明：`b5-plan` 每个任务只生成 1 组 primary（+可选 repeat），**无法表达** native 侧已有的 4 次运行。
> 因此 §4 的配对表是本轮实际执行口径；§3 的 plan 产物只用于证明任务子集/seed/交错结构可复现。

## 4. 真实配对与 native 现有证据（核心）

配对仓库：`paxxie2/b5-native-site-pnl`（PRIVATE；base/main = `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`，
与任务 base 一致）。下表 native 列已用**只读** `gh issue/pr view` 核验（未改 Issue/PR/代码）：

| 配对 | native Issue | native PR | native HEAD（headRefOid） | base | native 状态 | off Issue（待创建） | off 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | [#2](https://github.com/paxxie2/b5-native-site-pnl/issues/2) `[native][B5-native] previous-window-order run1` | [#3](https://github.com/paxxie2/b5-native-site-pnl/pull/3)（draft） | `534480062a0282b773f0fb65e580524bc085fc5b` | `1e166fb…` | OPEN；Lead 报告 ticket 已被 human 停止、PR ready（ticket 未独立核验）→ **待核验** | `[off][B5-off] previous-window-order run1` | **待执行** |
| run1-retry | [#4](https://github.com/paxxie2/b5-native-site-pnl/issues/4) `… run1-retry` | [#5](https://github.com/paxxie2/b5-native-site-pnl/pull/5) | `b152f8e2c4e52906cfc730bd6c9979d7b69cd073` | 同上 | OPEN；同上 → **待核验** | `[off][B5-off] previous-window-order run1-retry` | **待执行** |
| run2 | [#6](https://github.com/paxxie2/b5-native-site-pnl/issues/6) `… run2` | [#8](https://github.com/paxxie2/b5-native-site-pnl/pull/8) | `c28e6ee68e3f7032f055ade98a42f5e78f25f002` | 同上 | OPEN；同上 → **待核验** | `[off][B5-off] previous-window-order run2` | **待执行** |
| run3 | [#7](https://github.com/paxxie2/b5-native-site-pnl/issues/7) `… run3` | [#9](https://github.com/paxxie2/b5-native-site-pnl/pull/9) | `a85034ce67fea77cbc739a92d3eac90d88ffdb66` | 同上 | OPEN；同上 → **待核验** | `[off][B5-off] previous-window-order run3` | **待执行** |

离线也核验到：

- 4 个 native Issue 均带 `hephi/delivery` 标签；Issue body **完全相同**，sha256 = `47eb70026a0cd4fa8f6ce1a65980d21385059e94586ff14ffdbf1c2bda02b772`（1336 bytes）。
- **任务文本口径差异（重要，执行前必须解决）**：native Issue body = `@paxxie2 ` 前缀 +
  `eval/tasks/site-pnl-diagnosis/previous-window-order/issue.md`（657 bytes，sha256
  `f91d1b6afb6e1d97c6132c7537afd06b548c058886248b01405e0e095b0d3497`）+ 追加的 `hephi-task` JSON 合同块（fenced code block，含 goal/outOfScope/acceptance）
  （goal / outOfScope / acceptance）。**native 实际任务文本 ≠ 仓库 task card 原文**。因此：
  - 现在**不能**把 4 次 native 运行与 off 运行直接当作“同任务配对”；
  - off 侧发送什么文本必须先由负责人/Lead 决定口径：沿用 native body（含合同块），或统一剥离合同块并重跑 native；
  - 在口径决定前，本计划只记录差异，不宣称 paired。
- Issue #1（`previous-window-order`）body 与上述相同，但 Lead 未列入本轮 4 次配对，本计划不计入。
- native 运行记录（`run.json`/runs.json）、ticket 停止原因、PR ready 的逐条证据：**本任务未取得/未核验**，保持“待核验”。

**off 侧执行口径**（待 off team 执行）：

1. 在 `paxxie2/b5-native-site-pnl` 创建 **独立 off Issue**：标题 `[off][B5-off] previous-window-order <run>`；**无** `hephi/delivery` 标签；**不复用** native Issue。
2. 由**无赫菲插件的 off profile 实例**（约定本地端口 **3093**）处理，走原生 Issue → Ticket → Worker；无合同/无赫菲 state。
3. 同一配对 = 同一 taskId + 同一 base `1e166fb…` + 同一任务文本口径（待定）；off Issue 与 native Issue 一一对应。
4. 每个 off run 记录 native/off 双边的 Issue、PR、HEAD、时间戳、token、decisionLog、ticket/PR 状态，构成结对证据。

## 5. 每 run 执行步骤

### 5.1 native 现有 4 次运行：只核验，不重跑

> 状态：**已由另一线执行，待核验**。本任务不执行、不改动。

1. 逐 run 核对：Issue #2/#4/#6/#7 的 body sha256 与标签、PR #3/#5/#8/#9 的 base/headRefOid/状态（已部分核验，见 §4）。
2. 取得运行记录（`run.json`/批次 runs.json）并核对 runId、taskId、repetition、base、taskCard.sha256、model=`deepseek-flash`、宿主/插件版本、token/耗时、decisionLog、PR 编号。
3. 核对 ticket 状态“已被 human 停止”的原始记录与原因；核对 PR ready 状态。
4. 判定任务文本口径（§4）并记录：native 实际收到的文本到底是什么。

### 5.2 off 4 次运行：待执行（off team）

每个 off run（run1 / run1-retry / run2 / run3）步骤：

1. 全新检出目录（base `1e166fbe…`）+ 全新 Session；不得复用 native 或上一次的会话/工作区。
2. 启动/确认 **off profile 实例 3093**：不挂载赫菲、无 `hephi/delivery`、无合同/state；记录实例版本/端口。
3. 创建独立 off Issue（标题 `[off][B5-off] …`，无 hephi 标签），按已决定口径写入与 native 相同的任务文本；计算并记录 body sha256。
4. 走原生 Issue → Ticket → Worker 路径；记录 issue URL、ticket/run 状态、startedAt/endedAt、wallClockSeconds、tokens（读不到 `null`）、timeout、decisionLog、人工介入。
5. 记录 Worker 产出的 PR（OPEN、不合并）：PR 编号/URL、base/head SHA、ready 状态。
6. 写候选记录 → `node eval/record-run.mjs --input <candidate>.json --out <batch>/runs/<runId>.json`；断言与 §4 配对表一致。
7. 与对应 native 运行组成 pair 记录（native/off 两侧都不得缺失或伪造）。

### 5.3 hephi 流程验证任务（不执行）

`b5-task-key-whitelist` 只用于链路演练；本轮**不执行**。若日后演练，也必须声明“无 native 配对数据、不入效应分析”。

## 6. 采集字段（每 run 必记）

按 `eval/schema/run.schema.json`（B3 记录项）+ 本轮补充：

| 类别 | 字段 |
| --- | --- |
| 身份/分组/配对 | `runId`、`batch`、`taskId`、`repo`、`category`、`arm`（off/native）、`repetition`、`seed`、`pairId`、`pairRole`（native/off） |
| 模型 | `model.id=deepseek-flash`、`provider`、`parameters` 实际值（不可控写 `uncontrolled`） |
| 宿主/插件 | `host.version`+`versionSource`、插件候选/基线/实载 SHA、`loadedShaReadback`（无回读即 `unverified`）、off 实例版本/端口 |
| 任务卡/投递 | `taskCard.sha256`、`deliveryMechanism`、`verifiedEqual`、native/off 两侧 Issue URL 与 body sha256、任务文本口径版本 |
| 时间/成本 | `startedAt`/`endedAt`/`wallClockSeconds`/`timeout`、`tokens.input/output/total`（读不到 `null`）、`humanIntervention.count` |
| 交付/决策 | Issue 编号/URL、PR 编号/URL、`delivery`、`decisionLog.path`+`sha256`、ticket 状态（含 human 停止原因）、ready/契约结果 |
| 有效性 | `validationEnvironment.status`（available/unavailable+reason）、`outOfScopeChanges`、范围外文件、任务卡一致性、off 组是否出现赫菲状态 |

## 7. 单人 + agent 盲评流程（**human–agent agreement**，不是双人 kappa）

依据 `eval/approvals/2026-11-08-single-human-eval-mode.md`：

1. 批次结束后导出盲评材料（去组别/痕迹、映射写材料目录之外）：
   `node eval/label/export.mjs --manifest <batch>/export-manifest.json --out <batch>/blind --mapping <private>/<batch>.mapping.json --seed 20261107`
2. **agent 先独立标注**（看不到真人标签）：按 `eval/label/RUBRIC.md` 生成 agent 标注文件，文件名/内容明确标 `rater=agent`。
3. **真人（负责人）后标注**：对同一批材料独立填写 `labels-human.json`；agent 在真人完成前不得展示其标签。
4. 读回校验两份标注：`node eval/label/import.mjs --manifest <batch>/blind/manifest.json --labels <labels-agent.json>`（human 同）。
5. 计算一致性（需 Python venv + 固定依赖）：
   `python eval/stats/kappa.py --scores <rater-pair.json> --min 0.7`
   **报告必须写 `human–agent agreement`**（数值、n、门槛），不得写“inter-rater kappa / 两名真人 kappa”。
6. 状态标记：B5 结论 **partial（single-human mode）**；不得声称双人盲评或 B4 正式一致性达标；分歧由负责人（真人）裁决并记录理由。
7. 私有映射只在盲评结束后用于还原 runId/arm，不得进入材料目录。

## 8. 停止条件（任一触发即停跑、保留现场并报告负责人）

1. **配对口径未定**：native/off 任务文本口径未由负责人决定、或两组任务卡 sha256 不一致 → **不得开始 off 运行**。
2. **投递不一致**：off Issue 出现赫菲标签/合同/state、复用了 native Issue、注入文本不唯一 → 该 run 无效并停止排查。
3. **费用/资源异常**：单 run token/耗时明显超预期、预算失控 → 停止新增运行。
4. **不可接受故障**：错误交付被放行、不安全恢复、守护指标明显劣化等（PREREG §8 V1–V3）→ 立即暂停并报告。
5. **环境不可用**：off 实例无法启动、宿主报错、连续不可用（D-5 `ENV_TODO` 未定，试跑阶段由负责人现场裁定）→ 停跑修环境。
6. **版本漂移**：模型/宿主/插件 SHA 在批次内变化且未记录 → 该批作废。
7. **记录/工具失败**：`record-run` 校验失败、关键字段不可得且无法如实标注 → 停跑，不得手写补数。
8. **核验失败**：native 运行记录/ticket 状态/任务文本口径无法核实 → 不进入配对，不下任何结论。

## 9. 清理步骤（试跑结束后）

1. 停止 off profile 实例（3093）与所有 Worker/Session；确认无残留进程。
2. 清理临时检出目录与 Session 工作区（保留 `<batch>/runs`、`plan.json`、`repro-manifest.json`、盲评材料与私有 mapping、日志原文、配对表）。
3. 恢复宿主到试跑前状态（若曾暂停/改动配置，按 RUNBOOK §4.5 流程恢复并留证）；**不得**在宿主实载插件工作树构建。
4. 不删除失败/无效 run 的原始证据；不把生产数据提交到公开仓库（P14）；off Issue/PR 保留 OPEN、不合并，作为证据。
5. 汇总试跑数据（runs.json → ab-metrics；human–agent agreement）并写**试跑报告**（状态 partial / single-human mode；不得声称正式结论）。

## 10. 试跑后动作（不提前编造）

- 用试跑数据估计主指标基础发生率与波动，形成 D-3（成本上限）与 D-4（样本量）的**输入**；正式 `N` 由 `eval/prereg-sample.mjs` 计算后由负责人另行批准（当前 `N_TODO`/`min_pairs=5` 仍为占位）。
- 试跑结论只写“流程/链路/波动估计”；**不得**写“赫菲有效/无效、达到/未达到预注册、非劣效成立”等正式判定；4 个配对运行远不足以估计效应。
- 正式实验仍需 D-3/D-4/D-5/D-7/D-8/D-9 锁定 + PREREG 锁定（`prereg-lock --check` 目前 exit 1）。

## 11. 本轮未执行 / 未验证（如实声明）

1. **未执行任何 run**：没有 off/native 真实运行、没有模型调用、没有访问宿主/off 实例；native 4 次运行是另一线既有数据，**待核验**。
2. **未核验** native 的运行记录、ticket 停止证据、PR ready 逐条证据；只做了 Issue/PR 的只读状态与 HEAD 查询。
3. **任务文本口径未决**：native Issue body ≠ 仓库 task card 原文（见 §4），off 侧发送口径待负责人决定，配对**尚不能成立**。
4. **未启动/未验证 off profile 3093 实例**；E1-off 仍 partial、E5/E9 仍 blocked。
5. **未安装/未运行统计或盲评环境**，无 human–agent agreement 数值。
6. **未锁定 PREREG、未生成 `eval/PREREG.lock`**（`prereg-lock --check` 仍 exit 1）；未计算样本量/成本上限（D-3/D-4 仍 `pending-trial`）。
7. hephi 流程验证任务未执行；不声称任何 hephi 配对数据。

## 试跑执行状态更新（2026-11-08，Lead 核验）

- **native 4/4 已执行**（另一线）：`paxxie2/b5-native-site-pnl` Issues #2/#4/#6/#7 → PRs #3(draft)/#5/#8/#9；ticket：run1 `blocked`，run1-retry/run2/run3 `ready`。
- **off 4/4 已完成**（本次，回退仓库 `paxxie2/b5-off-site-pnl`）：Issues #7/#9/#11/#13 → PRs #8/#10/#12/#14；ticket 全部 open/person/report=ready；off 实例已停止、凭据与临时目录已清理。
- **隐藏测试独立复核（Lead 亲手）**：base `1e166fb` exit 1；8 个 PR head（native 4 + off 4）全部 exit 0 PASS。证据 `eval/evidence/b5pairing/verification.md`。
- **配对限制**：off 为回退仓库（非同仓），任务文本逐字节一致但环境/仓库不同，属弱配对；native run1 与 retry/2/3 的 project-regression 口径不同（完整 check.sh vs test_money.py），需在分析时单列。
- **未完成**：单人+agent 盲评（human–agent agreement）尚未执行；PREREG 未锁、无样本量、不产生效果结论。
