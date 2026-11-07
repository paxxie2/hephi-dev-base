# B5 样本量 / 成本草案（D-4 / D-3，2026-11-08）

> 状态：**草案（draft）**。基于 8 次已有开发试跑（native 4 + off 4，`previous-window-order`）的**真实可读记录**整理。
> **8 次远不足以估计效应或样本量**；本文不是实验结果、不是效应/收益结论、不是 PREREG 锁定值。
> `decisions-draft.md` 中 **D-3、D-4 仍是 `pending-trial`**；PREREG 未锁定，`eval/PREREG.lock` 不存在，
> `node eval/prereg-lock.mjs --check` 仍按预期 exit 1（拒绝锁定）。本文不修改宿主、不重跑实验、不调用模型。
>
> 证据目录：`eval/evidence/b5ss/`（生成脚本、命令与退出码、逐 run 时长、token 汇总、样本量网格、`SHA256SUMS`）。

## 1. 数据来源与口径（只读）

| 数据 | 来源 | 读取方式 | 可读字段 |
| --- | --- | --- | --- |
| native 4 次 trip（Issues #2/#4/#6/#7 → PRs #3/#5/#8/#9） | 宿主 B orchestrator sqlite `/Users/zm/dsh-instances/experiment/state/orchestrator.sqlite`（4 个 ticket id 见 `native-tickets-raw.json`） | `sqlite3 -readonly -json`（只读，不写宿主） | assignment `createdAt` / `startedAt` / `report.at` / `idleAt` / `endedAt`；`report.state`；`execution.directory` |
| off 4 次试跑（Issues #7/#9/#11/#13 → PRs #8/#10/#12/#14） | 仓库内 `eval/evidence/b5off/ticket-*.json`（已提交证据，逐文件 sha256 记录在 `timings.json`） | 直接读 JSON | assignment `createdAt` / `startedAt` / `report.at` / `idleAt` / `turnEndedAt`；`report.state` |
| native token/usage | 宿主 B worker session 日志 `dsh-home/sessions/*/worker-*/session.v4.jsonl.zstd`（4 个 ticket 各自 1 个 session） | `zstd -dc` 只读解压后按行解析 `assistant/message.data.usage` | `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `totalTokens`（逐模型调用逐条） |
| off token/usage | — | 不存在：off 实例 `DSH_HOME=/tmp/hephi-off-b5` 已按设计清理，`off-host.log` 无 usage | **unknown / null（不补 0）** |

时长定义（缺失时间戳保持 `null`，不补 0）：

- `queueSeconds = startedAt − createdAt`；
- **`workerSeconds = report.at − startedAt`（主用：Worker 本轮实际工作时间）**；
- `endToEndSeconds = report.at − createdAt`（含排队）；
- `turnToIdleSeconds = (turnEndedAt ?? idleAt) − startedAt`；
- `openToEndedSeconds = endedAt − createdAt`：**仅 native 有**，且 4 个 native ticket 的 `endedAt` 全部是同一批宿主停止/清理时间（22:55:28），**不是运行时长**，只作为行政关闭时间披露，**不计入任何时长统计**；
- 4 个 native ticket 的 `turnEndedAt` 为 `null`（用 `idleAt` 兜底列 `turnToIdleSeconds`，主用仍是 `report.at`）。

统计方法：median = 50% 分位；p90 = **R type-7 / Excel PERCENTILE.INC 线性插值**。每组 n=4（或 ready 子集 n=3），**分位数只是描述性统计，4 个样本不能可靠估计 P90**。

## 2. 8 次试跑的真实时长

逐 run（秒；`endedAt` 仅 native 行政关闭时间，不入统计）：

| 组 | run | report 状态 | queue | **worker** | end-to-end | turn→idle | endedAt(行政，不入统计) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| native | run1 | blocked | 8.527 | **231.751** | 240.278 | 234.640 | 1215.717 |
| native | run1-retry | ready | 6.846 | **120.821** | 127.667 | 122.360 | 678.524 |
| native | run2 | ready | 6.774 | **79.542** | 86.316 | 80.655 | 279.753 |
| native | run3 | ready | 95.855 | **109.032** | 204.887 | 110.860 | 279.760 |
| off | run1 | ready | 6.444 | **129.065** | 135.509 | 129.065 | null |
| off | run1-retry | ready | 5.747 | **131.740** | 137.487 | 131.740 | null |
| off | run2 | ready | 6.327 | **96.226** | 102.553 | 96.226 | null |
| off | run3 | ready | 5.901 | **134.685** | 140.586 | 134.685 | null |

汇总（秒）：

| 指标 | native n=4 | native ready n=3 | off n=4 | all n=8 |
| --- | --- | --- | --- | --- |
| worker median | 114.927 | 109.032 | 130.403 | 124.943 |
| worker p90（描述性） | 198.472 | 118.463 | 133.802 | 163.805 |
| end-to-end median | 166.277 | — | 136.498 | 136.498 |
| end-to-end p90（描述性） | 229.661 | — | 139.656 | 215.504 |

要点：

1. 唯一的 native non-ready 是 **run1（blocked）**：因冻结基线缺少 `backend/app/data` 导致完整 `scripts/check.sh` 失败（见 `eval/evidence/b5pairing/verification.md`），其 231.751s 明显高于其余 3 个 ready 运行（79.5–120.8s），**不应当混入有效运行耗时估计**；因此单独给出 native-ready 子集。
2. off 4 次全部 ready，worker 96.2–134.7s，离散度小。
3. native 的 `endedAt` 是宿主停止/清理批处理时间，不能当作 run 结束时间使用。
4. **样本量 n=4/组，median/p90 仅供描述**；P90 尤其不可靠（4 个点插值出来的是两个最大值之间的线性值）。

## 3. 为什么 8 次试跑不能估效应

- 真实配对只有 **4 对**（native run1/run1-retry/run2/run3 ↔ off run1/run1-retry/run2/run3）。任务级结果：off **4/4** ready，native **3/4** ready（run1 blocked）；**只有 1 个 discordant 对**。
- 4 对、1 个 discordant 的配对数据无法给出可用的效应估计或置信区间；任何“off→native 提升 X pp”的说法都只是这 4 对的描述，不能外推。
- 此外还有已知配对性限制（`eval/evidence/b5pairing/verification.md`）：off 用回退仓库 `b5-off-site-pnl`（非同仓）、native body 多 `hephi-task` 合同块、native run1 vs run1-retry/2/3 的 project-regression 检查口径不同（`check.sh` vs `pytest backend/tests/test_money.py`）。这些都不是任务实现差异，但会污染时间/成本比较。
- 因此本文**不给出效应估计**；第 4 节的样本量是**假设情景下的敏感性网格**，不是从这 8 次数据估计出来的。

## 4. 样本量敏感性草案（D-4）

### 4.1 方法与参数

- 工具：`eval/prereg-sample.mjs --pilot <json>`（`--self-test` 19 条合成断言，本轮 exit 0，见 `self-test.log`）。
- 模型：paired Bernoulli **Wald 近似 / 非劣效 margin**：
  `N = ceil( (z(1−α/2) + z(power))² · (q − d²) / (d − margin)² )`，其中 `d = p_native − p_off`，`q = discordantRate`。
- 输入（`pairs=4` 只回显真实配对数、不参与 N 计算；全部是**假设**，不是从 8 次试跑估计的效应）：

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `successRateOff` | 0.60 / 0.70 / 0.80 | 对照（off）ready 率假设；试跑观察 4/4 但 n=4 不可用 |
| 改善 `d` | 5 / 10 / 15 / 20 pp | 主指标（delivery ready vs blocked）绝对改善假设 |
| `successRateNative` | off + d | 因此 ≤1.0 |
| `discordantRate q` | 0.20 / 0.30 | 配对不一致比例假设；与边际率不兼容的组合由工具拒绝（见 4.4） |
| `alpha` | 0.05 / 0.10 | 双侧；0.05 为主情景（PREREG §6 口径），0.10 为敏感性 |
| `power` | 0.80 / 0.90 | PREREG §6 目标 0.8，0.9 为敏感性 |
| `margin` | −0.05（主情景）；−0.03 / −0.05 / −0.10（敏感性） | 非劣效界值；PREREG §3/D-1 仍为候选 −5pp（**未锁定**） |

> 注意：该工具算的是**单守护二元指标的非劣效 Wald 规划近似**，**不是** PREREG §6 要求的主指标 McNemar / 配对 bootstrap 样本量计算；它忽略试跑估计不确定性，稀疏 discordance 时可能偏乐观。它只用于让负责人看到“不同假设下 N 的量级”。

### 4.2 主情景网格（off=0.70、q=0.20、α=0.05、margin=−0.05）

| 改善 d | power 0.80 → 所需配对数 | power 0.90 → 所需配对数 |
| --- | --- | --- |
| 5 pp | **156** | 208 |
| 10 pp | **67** | 89 |
| 15 pp | **35** | 47 |
| 20 pp | **21** | 27 |

### 4.3 敏感性（每次只动一个维度）

| 敏感性维度 | 取值 → 所需配对数（其余同主情景或注明） |
| --- | --- |
| discordant q（off=0.70、d=10pp、α=0.05、power=0.80） | q=0.20 → 67；q=0.30 → **102** |
| alpha（off=0.70、d=10pp、q=0.20、power=0.80） | α=0.05 → 67；α=0.10 → **53** |
| margin（off=0.70、d=10pp、q=0.20、α=0.05、power=0.80） | −3pp → **89**；−5pp → 67；−10pp → **38** |
| 对照 ready 率（d=10pp、q=0.20、α=0.05、power=0.80） | off=0.60/0.70/0.80 → 均 **67**（公式只通过 `q−d²` 与可行性约束依赖边际率，不直接依赖 off 水平） |

全网格（91 个有效组合，主情景 + 敏感性 + margin 行）中：**所需配对数范围 16 – 313**。
最小 16：d=20pp、q=0.20、α=0.10、power=0.80。最大 313：d=5pp、q=0.30、α=0.05、power=0.90。

### 4.4 无效组合（工具真实拒绝，非编造）

99 个尝试里 **8 个 exit 2**：`off=0.80、native=0.95/1.00、q=0.30` 时 `discordantRate` 与边际成功率不兼容（`prereg-sample: discordantRate incompatible with paired marginal success rates`）。这些组合在网格中如实保留为无效行（`sample-grid.json`），没有用替代参数“补绿”。

### 4.5 D-4 结论（草案，待负责人决定）

- 不同假设下 N 从 **16 到 313 对**，量级差异近 20 倍；在负责人确定“最小有意义改善 d、守护指标非劣效界值、α/power、discordant 假设、主指标口径（McNemar/bootstrap）”之前，**不能填写 N**。
- 本文不提交 N 值，也不改 `eval/PREREG.md §6`；D-4 保持 `pending-trial`。
- 若负责人要求“先预算再设计”，可用的保守起点是主情景 d=10pp → 67 对（p=0.8）/ 89 对（p=0.9）；但这是**假设情景**，不是从试跑估出的效应。

## 5. 成本草案（D-3）

### 5.1 token：native 可得、off unknown

native 4 个 run 的 worker session usage（逐模型调用累加；`totalTokens` = input+output+cacheRead+cacheWrite，**包含缓存读取**；`nonCacheInputOutput` = input+output，不含缓存读取）：

| native run | steps | inputTokens | outputTokens | cacheReadTokens | totalTokens（含 cache） | nonCacheInputOutput |
| --- | --- | --- | --- | --- | --- | --- |
| run1（blocked） | 41 | 50,508 | 26,518 | 1,807,616 | 1,884,642 | 77,026 |
| run1-retry | 23 | 27,058 | 14,034 | 738,432 | 779,524 | 41,092 |
| run2 | 22 | 25,752 | 7,813 | 633,472 | 667,037 | 33,565 |
| run3 | 30 | 28,401 | 11,110 | 976,768 | 1,016,279 | 39,511 |

| 汇总（native n=4） | totalTokens（含 cache） | nonCacheInputOutput |
| --- | --- | --- |
| sum | 4,347,482 | 191,194 |
| median | 897,901.5 | 40,301.5 |
| p90（描述性） | 1,624,133.1 | 66,245.8 |

- **off token = unknown / null**：off 实例 `DSH_HOME=/tmp/hephi-off-b5` 已按设计清理，仓库证据无 usage；不补 0。
- **金额 = unknown**：仓库/证据中没有真实价目、模型单价或预算额度（`eval/PREREG.md §5` 为占位，`eval/check-budget.mjs` 缺金额/币种/上限，已如实记录 exit 1）；**不编造价格**。
- **口径风险（供 D-3 决定）**：`eval/PREREG.md §5` 的 token 上限（中位数 ≤400,000 / P90 ≤800,000）是**占位值且未定义 tokens 口径**。按 session 日志的 `totalTokens`（含 cacheRead）口径，native 中位数 0.90M / P90 1.62M **已高于占位上限**；按 `input+output`（不含 cache）口径则远低于上限。**因此不能判定“超限/未超限”**——这正说明 D-3 的 token 口径与阈值必须由负责人先定义（本文不擅自选择口径）。

### 5.2 时长资源成本（不折算金额）

- 观测 8 次：native worker 合计 **541.146s**，off worker 合计 **491.716s**，8 次合计 **1,032.862s ≈ 17.21 主机分钟**（不含排队/空闲）。
- 每对（native + off 各 1 次）耗时（秒）：median **245.33**、p90 **332.27**、native-ready 中位 + off 中位 **239.44**。
- 正式轮次的顺序执行主机分钟（**假设每组并发 1**；并发上限未验证，实际可除以并发数，但不是已验证承诺）：

| 配对数 N | median 估计（分钟） | p90 估计（分钟） |
| --- | --- | --- |
| 21 | 85.87 | 116.30 |
| 27 | 110.40 | 149.52 |
| 35 | 143.11 | 193.83 |
| 47 | 192.18 | 260.28 |
| 67 | 273.95 | 371.04 |
| 89 | 363.91 | 492.87 |
| 156 | 637.86 | 863.91 |
| 208 | 850.48 | 1151.88 |

- 资源成本还有未知项：宿主/off 并发上限（unknown）、并行时 wall-clock 与配额、真实单价（unknown）。因此 D-3 的成本上限数值仍应 `pending-trial`。
- 备注：上述 N 与时长都建立在 4 个 native 试跑的**上限式**估计上（p90 只是 4 点插值），且 native run1 是 blocked 的异常长尾；正式轮次若审查更严/工具更多，耗时会更高。

## 6. 对 D-3 / D-4 的处理

- `eval/decisions-draft.md` 只追加本文引用；**D-3、D-4 的 `status` 仍为 `pending-trial`**，不填 N、不填成本上限、不写 `eval/PREREG.lock`。
- 本文与证据**不改变** PREREG 任何占位值；`prereg-lock --check` 仍 exit 1。
- 供负责人决定的最小集合：①主指标/守护指标口径与最小有意义改善 d；②非劣效界值（D-1 候选 −5pp 是否定稿）；③α/power 与分层（仓库/模型/类别）；④discordant 假设及是否改用 McNemar/bootstrap；⑤token 口径与阈值；⑥并发上限与金额预算。

## 7. 复现与验收（本机真实执行）

```sh
# 证据生成（只读宿主 sqlite 与 worker session 日志；不写宿主、不跑实验）
node eval/evidence/b5ss/collect-b5ss.mjs            # exit 0
# 工具自测
node eval/prereg-sample.mjs --self-test             # exit 0（19 条合成断言）
# 预期失败（如实记录，不是“通过”）
node eval/prereg-lock.mjs --check                   # exit 1（存在未决项，拒绝锁定；未写 eval/PREREG.lock）
node eval/check-budget.mjs                          # exit 1（PREREG 缺金额/币种/上限；D-3 尚无数值）
# 空白与范围
git diff --check                                    # exit 0
```

原始输出：`eval/evidence/b5ss/{collect-output.json,self-test.log,prereg-lock-check.txt,check-budget.txt,command-log.txt}`；
逐 run 与汇总：`timings.json`；token：`native-usage.json`；样本量网格：`sample-grid.json`；成本：`cost.json`；
只读原生快照：`native-tickets-raw.json`；校验和：`eval/evidence/b5ss/SHA256SUMS`（在 `cd eval/evidence/b5ss && shasum -a 256 -c SHA256SUMS` 下校验，路径相对本目录）。

## 8. 未验证项（如实）

1. **未做效应估计**：4 对、1 个 discordant；没有置信区间、没有 McNemar/bootstrap 正式计算。
2. **样本量是假设情景网格**：参数是假设，不是从试跑估计；工具是 Wald 近似，不是 PREREG §6 的正式方法。
3. **off token unknown**：实例已清理；没有任何 off usage 数据。
4. **金额 unknown**：无价目；未折算任何金额/额度。
5. **并发上限未知**：资源估算假设每组并发 1，未验证宿主/off 真实并发能力。
6. **时长 n 极小**：n=4/组、p90 为插值；run1 blocked 长尾、配对性弱（回退仓库 + 合同块 + 检查口径差异）都会影响外推。
7. **未跑正式实验、未调用模型、未改宿主**：本任务只是基于既有 8 次记录起草 D-4/D-3 输入。
