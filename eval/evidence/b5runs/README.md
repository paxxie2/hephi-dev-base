# B5 试跑运行记录（8 次真实运行，run.schema.json）

本目录保存 8 次**已真实发生**的 B5 开发试跑（native 4 + off 4）的运行记录，按
`eval/schema/run.schema.json` 录入，全部经 `node eval/record-run.mjs` 校验并以 exit 0 写入。

- 批次：`b5-trial-20261108`；任务：`previous-window-order`（category=`new-feature`）；
  repo 标识：`site-pnl-diagnosis`；base：`1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`。
- 本任务**没有运行任何新 run、没有调用模型、没有写入宿主/PR/Issue/ticket**；记录只从既有只读证据派生。
- 状态：**工具/录入验证通过；无盲评数据、无 token 数据；不是正式实验，不构成 B5 效果结论。**

## 1. 8 条记录

| # | runId | arm | repetition | PR | head | ticket | delivery | startedAt → endedAt (UTC) | wallClockSeconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `b5-trial-20261108-native-r1` | native | 1 | [b5-native #3](https://github.com/paxxie2/b5-native-site-pnl/pull/3)（draft） | `534480062a0282b773f0fb65e580524bc085fc5b` | `0824a46875fffff5193152a320073ea6` | `blocked` | 2026-11-07T22:35:21.323Z → 22:39:13.074Z | 231.751 |
| 2 | `b5-trial-20261108-native-r2` | native | 2 | [b5-native #5](https://github.com/paxxie2/b5-native-site-pnl/pull/5) | `b152f8e2c4e52906cfc730bd6c9979d7b69cd073` | `2801319d520b9bd81c3c3a3f6d821167` | `ready-pr-created` | 2026-11-07T22:44:16.849Z → 22:46:17.670Z | 120.821 |
| 3 | `b5-trial-20261108-native-r3` | native | 3 | [b5-native #8](https://github.com/paxxie2/b5-native-site-pnl/pull/8) | `c28e6ee68e3f7032f055ade98a42f5e78f25f002` | `078370bcf6d73a168f2256e693aa36c4` | `ready-pr-created` | 2026-11-07T22:50:55.559Z → 22:52:15.101Z | 79.542 |
| 4 | `b5-trial-20261108-native-r4` | native | 4 | [b5-native #9](https://github.com/paxxie2/b5-native-site-pnl/pull/9) | `a85034ce67fea77cbc739a92d3eac90d88ffdb66` | `ba9cbe09e06842e47993cfd147988aee` | `ready-pr-created` | 2026-11-07T22:52:24.644Z → 22:54:13.676Z | 109.032 |
| 5 | `b5-trial-20261108-off-r1` | off | 1 | [b5-off #8](https://github.com/paxxie2/b5-off-site-pnl/pull/8) | `87b12ae1e9fb217a4d4cfc0a554af2afbaa0c34a` | `a1cd12aacb7fa21db019a85f68051a37` | `ready-pr-created` | 2026-11-07T23:17:35.252Z → 23:19:44.317Z | 129.065 |
| 6 | `b5-trial-20261108-off-r2` | off | 2 | [b5-off #10](https://github.com/paxxie2/b5-off-site-pnl/pull/10) | `e301bae9c53f30d11e05cad924184d7369f09b2a` | `f0707370fc2fd9f7788eb6ddcd4adc0b` | `ready-pr-created` | 2026-11-07T23:27:41.543Z → 23:29:53.283Z | 131.740 |
| 7 | `b5-trial-20261108-off-r3` | off | 3 | [b5-off #12](https://github.com/paxxie2/b5-off-site-pnl/pull/12) | `9c9c664ced361a0436d5281c0abc867c816f3358` | `86d714f089dabc6e909a878cec40eb45` | `ready-pr-created` | 2026-11-07T23:29:59.639Z → 23:31:35.865Z | 96.226 |
| 8 | `b5-trial-20261108-off-r4` | off | 4 | [b5-off #14](https://github.com/paxxie2/b5-off-site-pnl/pull/14) | `78c44180bf946c08cc2445c29aabe16ff335f94a` | `10b8b5256d303017ded3187ea1c0ae11` | `ready-pr-created` | 2026-11-07T23:32:33.289Z → 23:34:47.974Z | 134.685 |

对应 Issue：native #2/#4/#6/#7（`paxxie2/b5-native-site-pnl`）；off #7/#9/#11/#13（`paxxie2/b5-off-site-pnl`）。
所有 PR head/base 已用只读 `gh pr view` 核对；8 个 PR 与 Issue 均未修改、未合并。

## 2. 数据来源（全部只读）

| 字段 | 来源 |
| --- | --- |
| native 时间/assignment/ended | `orchestrator.sqlite`（`ticket.value.assignments[].startedAt / report.at`，只读 URI `mode=ro`） |
| native plugin/contract/checks/宿主 | `/Users/zm/dsh-instances/experiment/state/hephi/<ticket>/activation.json`、`decisions.jsonl`、`checks/*/run.json` |
| native Issue/PR head | 只读 `gh`（`paxxie2/b5-native-site-pnl`） |
| off 时间/ticket/session | `eval/evidence/b5off/ticket-*.json` |
| off PR head/Issue | `eval/evidence/b5off/off-prs-summary.json`、`off-issues-summary.json` + 只读 `gh` 复核 |
| taskCard/任务卡哈希 | `eval/evidence/b5off/off-issue-7-body.sha256`、`body-comparison.json`、`eval/tasks/site-pnl-diagnosis/previous-window-order/issue.md` |
| model/provider/host 版本 | 宿主 profile `cordis.patch.yml`（port 3083 / deepseek-account / deepseek-flash）；`releases/hephi/6d24e1b.../meta.json`（hostVersion）；off `off-models-final.json`、`isolation-snapshot.txt` + `/Users/zm/dsh-instances/runtime/node_modules/@deepseek-ai/dsh/package.json` |

## 3. 录入与校验（真实执行）

```sh
# 逐条：8/8 exit 0（输出已存在会拒绝覆盖，故本目录产物是首次写入）
node eval/record-run.mjs --input /tmp/b5runs-candidates/<runId>.json \
     --out eval/evidence/b5runs/<runId>.json     # exit 0 × 8

# 工具自测
node eval/record-run.mjs --self-test              # exit 0（26 条断言）
```

原始命令/退出码见 `record-run-validation.log`；`SHA256SUMS` 列出本目录文件哈希。

## 4. 字段口径与 null 清单（不伪造）

- **tokens 全部 null**（8/8）：宿主/off ticket 与会话记录中无可用 token usage；按 schema nullable 保留
  `{"input":null,"output":null,"total":null}`，未写 0。
- **盲评字段（8/8）**：无真人/agent 盲评数据 →
  `objectiveChanged=null`、`requiredFunctionImplemented=null`、
  `implementationDefect={"verdict":"unlabeled","notes":null}`、
  `unrelatedChanges={"has":null,"notes":null}`、`testWeakening={"has":null,"notes":null,"evidence":[]}`；
  `label` 字段省略（schema 允许，未完成盲评）。
- **plugin**：native 4 条 `loadedSha=6d24e1b39b75948b02c7dbd5fbac3e1af3c5ff80`（activation.json 与
  decisions.jsonl 的 pluginCommit、releases/hephi/6d24e1b.../meta.json 一致）；`candidateSha/baselineSha=null`；
  `loadedShaReadback="unverified"`（宿主未提供进程实载回读入口，未把磁盘哈希当回读成功）。
  off 4 条 plugin 全 `null`、`loadedShaReadback="unavailable"`（off Profile 无 hephi 插件）。
- **decisionLog**：native 4 条记录 `state/hephi/<ticket>/decisions.jsonl` 的路径、sha256、条目数
  （2/3/3/3）；off 4 条 `null`（无 hephi 决策日志）。
- **executionMode**：**偏差说明**——任务说明写 `executionMode=native/off`，但 `eval/schema/run.schema.json`
  的枚举只有 `normal/shadow`；为使记录通过 `record-run` 校验并符合 schema 语义，8 条均写
  `normal`，组别由 `arm` 字段（native/off）无歧义表达。未改 schema。
- **repetition**：按任务要求取 1..4，按 4 次运行的实际发生顺序编号：
  native r1=run1、r2=run1-retry、r3=run2、r4=run3（off 同理）。这与 `b5-plan` 计划的
  “repetition=1 为主运行、2+=20% 重复”语义不同，特此标注，避免下游误读。
- **taskCard.sha256** = `a54c17e945e6543ea40170c8bbc766c6dfba1571216f896db0d292fce356ed15`
  （666 bytes，`@paxxie2 ` + `issue.md`，即 off Issue body）。证据：`off body` 是 native Issue body
  （1336 bytes）的**精确前缀**；native 额外 670 bytes 是 `hephi-task` 合同块（处理组元数据），
  不计入任务卡文本。故 `verifiedEqual=true`（任务卡文本逐字节一致），但 native 组实际多收到合同元数据，
  **配对性弱于理想同仓对照**（见 `eval/evidence/b5pairing/verification.md`；off 还使用了回退仓库
  `paxxie2/b5-off-site-pnl`，非同仓）。
- **validationEnvironment**：native r1=`unavailable`（required `project-regression` 跑完整
  `scripts/check.sh`，在 base 上因缺 `backend/app/data` 于 pytest collection 阶段 exit 2——base 既有缺口，
  非本次实现失败；同 head 隐藏测试 exit 0）；native r2/r3/r4=`available`（check 收窄为
  `pytest backend/tests/test_money.py` 且 exit 0）；off 4 条=`available`（off 实例正常完成并开 PR；
  off 无 hephi 合同/检查口径）。
- **delivery**：native r1=`blocked`（PR #3 为 draft）；其余 7 条=`ready-pr-created`。
- **outOfScopeChanges**：8 条均 `{"has":false,"files":[]}`——8 个 PR 仅改
  `backend/app/domain/money.py`（gh `files` 与任务卡 `allowedFiles` 一致）。
- **humanIntervention**：8 条均 `{"count":0,"reasons":[]}`。说明：4 个 native ticket 在批次结束的
  22:55:28Z 被 human 停止（`ticket.ended={by:"human",outcome:"stopped"}`），发生在各 run 完成之后，
  属于批次收尾，不计入单 run 人工介入。
- **host**：`version="dsh@0.2.1-rc.5"`、`versionSource="experimental"`（rc 版本，非负责人确认的
  approved 语义）；native `instance="host-b:3083"`、off `instance="off-profile:3093"`。
  完整宿主版本串见 `releases/hephi/6d24e1b.../meta.json` 的
  `hostVersion="dsh@0.2.1-rc.5;superagent@0.1.0;source=62d7d53...;node@26.1.0"`。
- **model**：`deepseek-flash` / provider `deepseek-account` / `temperature="uncontrolled"`、
  `parametersSource="unavailable"`（宿主配置未暴露温度）。
- **faults**：未记录（schema 可省略；本次无故障证据，不写 false 冒充已核验）。

## 5. 未覆盖 / 未验证

1. **无盲评**（0 名真人、0 名 agent 标注）：全部盲评字段为 null/unlabeled，不能用于 B6 效果分析。
2. **无 token 数据**：token 成本不可得，保持 null。
3. **无正式实验结论**：8 条只是开发试跑的记录；native/off 不同仓（off 为回退仓库）、native r1 的
   check 口径与后续 3 条不同、native 多收 hephi 合同块——这些差异使本轮**不构成同仓配对对照**，
   不能据此计算 B5/B6 效应。
4. **宿主实载回读未验证**：plugin `loadedShaReadback=unverified`；没有宿主提供的进程实载回读证据。
5. **时间口径**：`startedAt/endedAt` 取 ticket assignment 的 `startedAt` 与报告 `at`（UTC）；
   非进程级精确墙钟；`wallClockSeconds` 由二者相减四舍五入到毫秒。
6. 未改任何 PR/Issue/ticket；未跑模型、未启动宿主/off 实例、未合并。
