# 宿主红队证据目录（模板）

状态：**模板（2026-11-07）· 尚无真实红队记录**。本目录用于存放 A6 宿主红队
（R-RT-01..03）的执行记录与索引；原始证据放宿主证据目录或仓库外（P14 不提交生产数据）。

> **边界（必读）**：宿主红队通过只能声称**“已列举场景未被绕过”**，不能声称“证据不可伪造”；
> **实载 SHA 未回读（`unverified`）时只能记 blocked/unverified，不得写 pass**。
> 计划生成器：`node eval/redteam/plan.mjs`（说明见 `eval/redteam/README.md`）。

## 1. 文件命名

```
hephi/docs/validation/redteam/
├── README.md                                   # 本模板
├── YYYY-MM-DD-<candidateShort>-host-redteam.md # 主记录（每次红队运行一份；不覆盖）
└── YYYY-MM-DD-<candidateShort>-artifacts/      # 可选：脱敏后的原始输出副本（若允许入库）
```

- `<candidateShort>`：候选构建 SHA 前 7–12 位；同一候选多次运行用 `-run2` 等后缀区分。
- 主记录由 `plan.mjs` 生成骨架后填写；**不预填 pass**，结论由操作者/复核者按证据填写。
- 原始证据（Session 快照、decisions.jsonl、run.json/output.log、宿主日志）默认留在宿主证据目录或
  仓库外；若确需入库只放脱敏副本，并在主记录中写原始路径与 sha256。

## 2. 主记录必填字段

| 字段 | 要求 |
| --- | --- |
| 日期/时间（含时区） | 实际执行窗口；与宿主日志时间对齐 |
| 候选构建 SHA | 40hex，构建该插件的 commit |
| 实载 SHA（回读） | 40hex 或 `unverified`；必须写回读方式（`decisions.jsonl` 最后 `pluginCommit` / 启动日志行） |
| 宿主 | URL、pid、启动时间、宿主版本/来源（approved/experimental/unavailable）、Node/OS |
| Issue/Ticket/Worker Session | 编号与 id（脱敏规则见 §5） |
| 绑定配置 | 合同 `evidence.requireSessionBinding`、宿主配置、`decisions.jsonl` 中 `binding.effective` |
| S3/smoke 证据 | 部署记录路径、健康回读、smoke Ticket 关闭记录（前置证明） |
| 每例结果 | R-RT-01/02/03 的 `pass/fail/blocked` + 理由 |
| 决策日志规则 | 每例相关 `rule` 原文与 `seq`/`at`（如 `ready.binding`、`ready.output-unverified`） |
| 检查记录证据 | `run.json`/`output.log` 路径、原始/改写 sha256、前后差异 |
| Session 快照证据 | 路径、sha256、事件数、相关 `tool/call`/`tool/result` 片段 |
| 原始输出 | 命令、退出码、原始输出片段（脱敏） |
| 复核 | 执行者、复核者、复核结论、日期 |
| 可声称边界 | 逐例写“已列举场景未被绕过”，不得写“不可伪造” |
| 总体结论 | `pass` / `fail` / `blocked`；loaded=unverified 时只能 blocked/unverified |

## 3. 判定表

| 结论 | 判定标准 |
| --- | --- |
| `pass` | 前置全部满足；实载 SHA 已回读；R-RT-01/02 明确拒绝且证据完整；R-RT-03 前后一致或受影响已如实记录并停止 A1-BIND；复核者签字 |
| `fail` | 预期为拒绝的实际通过/放行，且证据可复核（需立即停止，按 P1-7/A4 处理） |
| `blocked` | 前置缺失、实载 unverified、证据不可比、无法确认前后一致、或出现“通过/无明确拒绝”异常；保留现场 |

补充：

- **实载 SHA=unverified**：无论其他证据如何，总体只能 blocked/unverified。
- **R-RT-03 受影响**：快照/记录被 Worker 影响 → 立即停止 A1-BIND，按 P1-7 回退（A1-OUT + 文件指纹 +
  A4 威胁模型；D1 上限降为 L1/L2），记 blocked。
- 任一异常“通过”都不得靠重试掩盖；先保留现场与证据，再决定是否重跑。

## 4. 与 A4 威胁模型的对应

| 用例 | 威胁模型（`hephi/docs/threat-model.md`） | 记录要求 |
| --- | --- | --- |
| R-RT-01 手写记录 | §1 攻击者 A / §2 状态目录可写 / §3“手写 run.json”防线 | 记录手写文件路径/sha256、Session 无原生调用的证据、拒绝 rule |
| R-RT-02 同改日志+哈希 | §3“同时改日志和哈希”/ A1-OUT | 记录改前/改后文件哈希、Session 权威输出、拒绝 rule；注明“绑定关闭时同改不可发现”是已知限制 |
| R-RT-03 Session 写入 | §2 Session 快照边界 / §4 H6 缺口 | 记录前后快照 sha256/事件数、写入尝试命令与结果、是否受影响、停止 A1-BIND 的决定 |

## 5. 脱敏要求

- 不写 token/凭据/账号、完整邮箱、API key；路径用 `$HOME/<state>` 或 `<instance>`；
- Session/Job/call id 可保留（关联需要），但不得附完整环境变量或宿主账号信息；
- 原始证据中若含生产数据（Issue 正文、业务代码），只引用路径 + sha256，不入库；
- 复核前再次扫描文本，确认没有把“未验证”写成“已验证”。

## 6. 与本地红队的关系

- 本地红队（`hephi/tests/redteam/`）只证明单测/模拟级机制，不产生本目录记录；
- 本目录只记录**真实宿主 + 真实 Worker** 的 A6 执行；不得用本地测试结果填写宿主记录；
- 本地 RT-* 与本目录 R-RT-01..03 的对应见 `eval/redteam/README.md` §1。

## 7. 当前状态

- 本目录暂无真实记录；S3 仍 blocked（D1/D2/D3/D4/D5、Z1/S2 等未完成），A2 H1–H5 与 H6/A4 未验证，
  实载 commit 回读未完成。
- 在 S3 完成且实载 SHA 回读前，任何红队记录只能处于 `pending`/`blocked`，**不得写 pass**。
