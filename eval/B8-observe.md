# B8 日常使用观察（说明与工具边界）

本文件属于 ROADMAP-95 §B8（日常使用）。它说明 B8 需要什么数据、现有工具能证明什么、
以及**当前没有任何真实观察窗口数据**时必须如何如实标注。

> 状态（2026-11-08）：**工具准备阶段，未观察**。没有真实观察窗口数据、没有影子模式
> 运行数据、没有申诉样本、没有返工人工分类。本文件**不报告也不推测任何 B8 计数**。

## 1. B8 要回答什么

- **影子模式观察**：生产启用拦截前，用影子模式运行一段时间（前置 P4），统计本应拒绝的
  次数与理由，抽样判断对错，估计误拦率。
- **基线**：用前置 P15 存档的启用前数据。
- **统计范围包括所有工单**：已合并、未合并、被放弃、长期阻塞都算；被赫菲长期阻塞后放弃的
  任务必须进入统计，不能只数已合并工单。
- **返工识别**：只在合并后一定窗口内找出**可能的**返工（同批文件 + 引用原 PR/Issue 的提交），
  再抽样人工分类（缺陷修复 / 需求变更 / 正常演进），最后估算返工率；窗口长度须在 PREREG 写定。
- **混杂因素**：记录观察期内的模型升级、团队变化、任务复杂度变化、审查人员变化；前后对比
  只作为辅助证据。
- **误拦申诉**：工单作者认为拒绝不合理时加标签 `hephi/appeal`，由非开发者复核。

B8 达标才可能影响 D2 评 L4、D4 评 L3（ROADMAP-95 §4 评分证据）。**工具自测通过 ≠ B8 达标。**

## 2. 必需数据（当前均不存在）

| 数据 | 形式 | 当前状态 |
| --- | --- | --- |
| 观察窗口定义 | 每批 `batch.json`：起止时间、模型/宿主/插件实际版本、团队/复杂度变化 | 无 |
| P15 基线归档 | `tickets.json` + `summary.json`（P15 归档格式） | 未在启用后核对真实数据源 |
| 日常导出 | `eval/daily/export.mjs --input <archive> --out <daily-export.json>` 的输出 | 无真实导出 |
| 误拦申诉 | `hephi/appeal` 标签与复核记录（见 `eval/daily/APPEALS.md`） | 无 |
| 返工候选 + 人工分类 | `eval/daily/rework.mjs` 输出 + 人工分类结果 | 无 |
| 维护成本日志 | `maintenance.jsonl`（见 `eval/daily/MAINTENANCE.md` §3） | 无 |
| 影子模式证据 | P4 可用性证据 + 影子运行记录 | 未验证（PREREG D-8 未批准） |

## 3. 工具链与边界

| 工具 | 作用 | 不能证明什么 |
| --- | --- | --- |
| `eval/daily/export.mjs` | 归档任意同形输入，按去重键 `ticketId` 输出 `total/merged/unmerged/dropped/blocked` 等计数 | 不是真实观察结果；不判断误拦对错；不产生结论 |
| `eval/daily/verify-export.mjs` | 把 export 输出与**同一源归档**复算结果交叉核对（VE-01..VE-11：计数、互斥恒等式、去重键、逐工单标记、P15 `uniqueIds` 映射） | 只证明“给定源归档时计数可复算”，不证明源数据完整/真实，也不证明 B8 达标 |
| `eval/daily/rework.mjs` | 机械找出“可能返工”的提交候选（`category: pending-human`） | 不给出返工率，不做人工分类 |
| `eval/daily/MAINTENANCE.md` | 计数口径、维护成本日志模板 | 不是效果实验或验收证据 |
| `eval/daily/APPEALS.md` | 申诉流程与记录格式 | 当前无真实申诉样本 |

`verify-export.mjs` 的判定（详见脚本头注释）：

- 退出码 `0`：交叉核对通过；`1`：存在缺失/不一致；`2`：参数/IO 错误。
- 交叉核对 `total/merged/unmerged/dropped/blocked`、互斥恒等式
  `total = merged + dropped + blocked + closedUnmerged + openNotBlocked`、
  `unmerged = total - merged`、去重键 `ticketId`、逐工单 `merged/dropped/blocked/closed`、
  P15 `summary.uniqueIds` 映射。
- 已知允许差异（仅告警）：`summary.total` 与去重后 `total` 不同（跨来源重复记录，用
  `uniqueIds` 比较）；`summary.byStatus` 与去重后 `byStatus` 不同（重复记录或状态映射差异，
  需人工解释）。

## 4. 工具验证现状（合成夹具，非真实观察）

已执行（仅证明工具逻辑）：

```sh
node eval/daily/export.mjs --self-test
node eval/daily/verify-export.mjs --self-test   # 19 assertions, exit 0
```

- 合成夹具放在系统临时目录（`mkdtemp`），不写仓库；覆盖：合法导出/源归档对通过；篡改计数、
  破坏恒等式、删除 tickets、重复 ticketId、错误去重键、`export.input` 配对错误、逐工单标记
  不一致、`uniqueIds` 不一致、缺 `tickets.json`、缺 `summary.json`（跳过并告警）等。
- **没有任何真实观察窗口数据参与上述测试**；因此当前不能、也不得报告任何 B8 计数、误拦率、
  返工率或申诉统计。

## 5. 有真实数据后的执行顺序（未执行）

1. 负责人定义观察窗口并写 `batch.json`（起止、版本、混杂因素）；
2. 用 P15 归档（或同形 JSON）生成 `daily-export.json`：
   `node eval/daily/export.mjs --input <p15-archive-dir> --out <batch>/daily-export.json`；
3. 交叉核对：
   `node eval/daily/verify-export.mjs --export <batch>/daily-export.json --source <p15-archive-dir> --out <batch>/export-check.json`；
   必须 exit 0；否则先修数据/口径，不得继续；
4. 报告同时给出 `total` 与 P15 `summary.uniqueIds`、恒等式两边、`blocked=0` 的基线说明；
5. 返工：`node eval/daily/rework.mjs --repo <dir> --since <date> --window-days <PREREG 锁定值> --json`，
   对候选抽样人工分类，报告“候选数 + 分类结果 + 抽样方法”，不得把候选当返工率；
6. 申诉：按 `eval/daily/APPEALS.md` 记录，复核者为非开发者；
7. 维护成本：按月/升级事件追加 `maintenance.jsonl`；
8. 报告中披露混杂因素；前后对比只作辅助证据，不替代 B 线正式对照实验。

## 6. 未验证项（必须随报告保留）

- 真实 P15 归档数据源（orchestrator sqlite / 原生 Ticket 主表）在启用后的可用性；
- 影子模式（P4）真实可用性（PREREG D-8：未批准/未验证）；
- 误拦申诉的真实样本与复核流程；
- 返工窗口长度（须 PREREG 锁定）与人工分类一致性；
- 观察窗口内模型/宿主/插件版本变化的真实记录；
- 真实 `daily-export.json` 与源归档的交叉核对（当前只有合成夹具）。

结论：本文件与 `verify-export.mjs` 只证明**工具在合成数据上可复算、可失败**；
真实 B8 观察数据与结论均**未验证**，任何真实计数都必须来自后续真实归档，不得补 0 或估算。
