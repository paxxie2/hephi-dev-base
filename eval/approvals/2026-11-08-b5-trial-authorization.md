# B5 开发试跑授权记录（2026-11-08）

## 1. 授权事实

| 项 | 内容 |
| --- | --- |
| 授权人 | 项目负责人（用户；本环境唯一可用真人评审者） |
| 授权方式/时间 | 2026-11-08 会话选择（Asia/Shanghai；**精确时分未记录**），由 Team Lead 转述给本执行 Agent。本记录**未见原始会话截图或书面签名**，按“负责人口头选择、Lead 转述”如实记录；执行 Agent 无权代批。 |
| 选择 1：评审模式 | **A（单人 + agent 降级）**——引用并沿用 `eval/approvals/2026-11-08-single-human-eval-mode.md`（同一负责人选择）；本记录不重复其全部规则，但同样受其约束。 |
| 选择 2：执行范围 | 负责人**批准“搭 off profile 并试跑”**：允许搭建/启动本地 off profile 实例，并按本记录范围执行开发试跑。 |
| 选择 3：试跑范围 | **仓库：`hephi` + `site-pnl-diagnosis`；模型：`deepseek-flash`（单一模型）；分组：`off` / `native` 两组。** **核心配对任务：`previous-window-order`（site-pnl，base `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`）；配对执行仓库：`paxxie2/b5-native-site-pnl`**（native 侧已有 4 次真实运行，见 §3.1；off 侧在同一仓库用独立 off Issue 执行）。hephi 任务只作工具/流程验证，不声称已有 native 配对数据。计划参数 seed `20261107`、`repeatFraction=0.2`（均为试跑参数，**未锁定 PREREG**）。 |
| 状态 | **owner-approved（仅限开发试跑）**；不是正式实验批准，不是 PREREG 锁定。 |
| 对应决策记录 | 本记录同时更新 `eval/decisions-draft.md` 的 **D-7**（首轮仓库/模型范围）与 **D-9**（off 任务卡投递）为 `approved-by-owner`，见 §4；不修改 `eval/PREREG.md` 的任何数值/占位。 |

## 2. 试跑性质（开发试跑，不是正式实验）

- 本轮是 **B5 开发试跑（pilot）**，目的仅限：验证 off/native 执行链路与投递一致性、验证运行记录/校验/归档链路、验证单人+agent 盲评流程；为 D-3（成本上限）与 D-4（样本量，`prereg-sample`）提供**估计输入**。
- **不是** PREREG 锁定后的正式实验，**不是**正式对照结论；试跑数据不得用于声称“赫菲有效/无效”、不得作为 D2/D4/D5 的判定依据。
- 结论状态只能写 **partial（开发试跑，single-human mode）**；任何“达到预注册 / 未达到预注册”的正式判定都不适用于本轮。

## 3. 资源、费用与责任

1. 负责人授权承担本轮试跑产生的**模型 token 费用与本地资源**；试跑规模按计划 8 个 primary runs + 最多 2 个 repeat runs（共 10 runs），不得擅自扩大任务/模型/轮次。
2. 每次运行的实际 token/耗时/模型/宿主/插件版本必须记录（读不到写 `null`，不得补 0，不得伪造）。
3. 试跑成本只作为 **D-3 的估计输入**，不填正式上限、不当作正式结论；D-3 仍为 `pending-trial`。
4. **本记录对应的工作只做授权记录 + 计划/核验，不执行任何 run、不调用模型**：native 侧 4 次运行由另一线执行（见 §3.1），off 侧 4 次运行由 off team 在同一配对仓库执行；本任务自身 token 费用为 0。
4. 若出现预算/资源异常（例如单 run 明显超预期、宿主错误、费用失控），立即按 §6 停止条件停跑并报告负责人，不得继续消耗。

### 3.1 配对现实与现有证据（2026-11-08，只读核验；本任务不执行 run）

依据 Lead 2026-11-08 转述 + 对 `paxxie2/b5-native-site-pnl` 的**只读** GitHub 查询（`gh issue/pr view`，未改任何 Issue/PR/代码）：

| 配对 | native Issue | native PR | native HEAD（headRefOid） | base | 状态 |
| --- | --- | --- | --- | --- | --- |
| run1 | #2 `[native][B5-native] previous-window-order run1` | #3（draft） | `534480062a0282b773f0fb65e580524bc085fc5b` | `1e166fb…`（= main） | OPEN；Lead 报告 ticket 已被 human 停止、PR ready（本任务未独立核验 ticket）；**待核验** |
| run1-retry | #4 `… run1-retry` | #5 | `b152f8e2c4e52906cfc730bd6c9979d7b69cd073` | 同上 | OPEN；同上，**待核验** |
| run2 | #6 `… run2` | #8 | `c28e6ee68e3f7032f055ade98a42f5e78f25f002` | 同上 | OPEN；同上，**待核验** |
| run3 | #7 `… run3` | #9 | `a85034ce67fea77cbc739a92d3eac90d88ffdb66` | 同上 | OPEN；同上，**待核验** |

- 4 个 native Issue 均带 `hephi/delivery` 标签，body 完全一致：sha256 `47eb70026a0cd4fa8f6ce1a65980d21385059e94586ff14ffdbf1c2bda02b772`（1336 bytes）。
- **重要口径差异（待负责人/Lead 决定）**：native Issue body = `@paxxie2 ` 前缀 + `eval/tasks/site-pnl-diagnosis/previous-window-order/issue.md`（657 bytes，sha256 `f91d1b6afb6e1d97c6132c7537afd06b548c058886248b01405e0e095b0d3497`）+ 追加的 `hephi-task` JSON 合同块（一个 fenced code block，含 goal/outOfScope/acceptance）。因此 native 组实际收到的任务文本**不等于**仓库 task card 原文。off 组若只发 `issue.md`，两组任务文本不一致、不能直接当作同任务配对；执行前必须由负责人确定口径（例如 off 同样发送 native body，或统一使用剥离合同块的文本并重跑 native），不得把现有 4 次 native 运行直接当作已配对。
- Issue #1（`previous-window-order`）body 与上述相同，但 Lead 未列入本轮 4 次配对，本计划不计入。
- off 侧待执行：同一仓库 `paxxie2/b5-native-site-pnl` 创建独立 off Issue（标题 `[off][B5-off] …`，**无** `hephi/delivery` 标签、不由赫菲插件处理），paired 同任务同 base；详见 `eval/B5-trial-plan.md`。

## 4. 决策项变更（仅 D-7 / D-9，其余不动）

| ID | 原状态 | 本次状态 | 记录的选择 | 说明 |
| --- | --- | --- | --- | --- |
| D-7 | `pending-approval` | **`approved-by-owner`** | 首轮试跑范围：`hephi` + `site-pnl-diagnosis` × `deepseek-flash` × off/native；每仓 2 个任务 | 仅覆盖本轮**开发试跑**；B7 多仓库/多模型正式范围另行决定，正式实验前仍须随 PREREG 锁定。 |
| D-9 | `pending-approval` | **`approved-by-owner`** | off 组使用**独立 off profile 实例**（本计划约定本地端口 **3093**，不挂载赫菲、不打 `hephi/delivery`）：在配对仓库 `paxxie2/b5-native-site-pnl` 创建**独立无标签 off Issue**（标题 `[off][B5-off] …`，不复用 native Issue）投递同一任务文本 | 批准的是方案选择，**不是**投递一致性已验证：native 现有 Issue body 与仓库 task card 原文不一致（见 §3.1），执行前必须由负责人确定同一任务文本口径，并按 RUNBOOK §4.4 校验两组 `sha256`、off 组无赫菲状态、注入文本唯一；正式实验前随 PREREG 锁定。 |

其余决策项保持原状（不得伪造批准）：

| 状态 | 项 |
| --- | --- |
| `approved-by-owner` | D-1 非劣效界值 −5pp；D-2 主指标联合规则；D-6 成本硬门槛；D-10 确认删除 `ab-metrics` 估算字段 |
| `pending-trial` | **D-3** 成本上限七项数值；**D-4** 样本量 `N_TODO`（本轮试跑后由 `prereg-sample` 提供输入，仍须负责人另行批准） |
| `pending-approval` | **D-5** 环境不可用停止阈值；**D-8** P4 shadow 可用性 |

> 本记录更新的是 `eval/decisions-draft.md` 的 D-7/D-9；`eval/approvals/2026-11-08-owner-approval.md`（06:36 乙包批准的时点记录）保持原样，其中 D-7/D-9 为 pending 是其时点状态。

## 5. 本授权的边界（明确不可做 / 不可声称）

1. **不授权正式实验**：正式实验仍需 **D-3、D-4、D-5、D-7、D-8、D-9 全部锁定**（其中 D-7/D-9 本次只按试跑范围批准，正式实验前仍须随 PREREG 锁定）以及 PREREG 锁定；当前 `node eval/prereg-lock.mjs --check` 仍 **exit 1**。
2. **不授权声称效应结论**：不得从试跑数据得出“插件带来收益/成本可接受/达到非劣效/达到预注册”等结论。
3. **不授权伪造评审**：真人只有负责人 1 名；agent 标注必须明确标为 agent；不得写两名真人、不得冒充双人签名。
4. **不授权改动宿主/插件/Skill/部署/运行时**；不得在宿主实载插件工作树里构建（R3.7/R37 纪律）；不得使用未记录的宿主/模型版本。
5. **不授权锁 PREREG**、不生成/覆盖 `eval/PREREG.lock`；不改 PREREG 数值占位。
6. **不授权扩大范围**（新增任务/模型/仓库）或跳过记录与停止条件；数据缺字段时只能标无效/证据不足，不得静默排除。
7. **不授权把 off profile 当作已通过验收的 off 入口**：E1-off 仍为 partial，E5/E9 仍 blocked；本试跑用于验证链路，不是 A5 场景验收。
8. **不授权把 native 现有运行当作已验证配对**：4 次 native 运行的 ticket 状态/运行记录/任务文本口径均待核验（见 §3.1），本任务只做只读查询与计划记录，不重跑、不改 Issue/PR。

## 6. 执行纪律（引用现行规则）

1. 单人+agent 盲评按 `eval/approvals/2026-11-08-single-human-eval-mode.md` §2 执行：agent 先独立标注、真人后确认、指标命名 **human–agent agreement**、状态 partial（single-human mode）。
2. 运行计划、任务子集、seed、repeatFraction 与执行步骤见 `eval/B5-trial-plan.md` 与 `eval/evidence/b5trial/`。
3. 每个 run 必须落 `eval/schema/run.schema.json` 记录（`eval/record-run.mjs` 校验），保留原始证据；不得手工改数。
4. 停止/清理按 `eval/B5-trial-plan.md` §8/§9：预算异常、不可接受故障、投递不一致、版本漂移等立即停跑并保留现场。

## 7. 变更记录

| 日期（Asia/Shanghai） | 变更 | 依据 |
| --- | --- | --- |
| 2026-11-08 06:36 | 负责人批准“乙包的，我全部批准”（D-1/D-2/D-6/D-10 置 approved-by-owner 等，见 `2026-11-08-owner-approval.md`） | Lead 转述 |
| 2026-11-08 | 负责人选择 A（单人+agent），批准“搭 off profile 并试跑”，范围 hephi + site-pnl-diagnosis × deepseek-flash × off/native | Lead 转述（本文件） |
| 2026-11-08 | 新建本授权记录；D-7/D-9 置 `approved-by-owner`（仅本轮开发试跑范围）；明确不锁 PREREG、不跑正式实验 | 本文件 §2/§4/§5 |

> 本记录是“授权事实与边界”的记录，不是 PREREG 锁定、不是正式实验批准、也不是任何效应结论。
