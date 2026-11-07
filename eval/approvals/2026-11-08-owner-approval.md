# 负责人批准记录：乙包（2026-11-08）

## 1. 批准事实

| 项 | 内容 |
| --- | --- |
| 批准原话（逐字引用） | **“乙包的，我全部批准”** |
| 批准时间 | 2026-11-08 06:36（Asia/Shanghai，UTC+8） |
| 批准人 | 实验室负责人 / 用户（实验负责人） |
| 转述来源 | 该原话由 Team Lead 在 2026-11-08 的团队消息中转述给本执行 Agent；本记录**未见原始会话截图或书面签名**，按“负责人口头批准、Lead 转述”如实记录。执行 Agent 无权代批，本文件只是**记录**，不是新的批准。 |
| 适用范围 | 工作包乙（B1 预注册准备、B2 任务集、B4 盲评工具、B5 对照设计与试跑准备、B6 统计、B7/B8 准备与文档）；以及 `eval/decisions-draft.md` 中推荐值明确、无占位/未决的决策项（见 §3）。批准后按 `eval/PREREG.md` §9 继续准备，**不等于**锁定 PREREG，也不等于任何实验结论。 |
| 记录文件 | `eval/approvals/2026-11-08-owner-approval.md`（本文件） |
| 对应决策草案 | `eval/decisions-draft.md`（D-1..D-10） |

## 2. 本批准生效的边界（明确未授权/未验证事项）

本批准**不**授权、也**不**证明以下事项：

1. 不授权跑正式实验、开发试跑、调用模型或访问宿主；本次只做记录与计划生成。
2. 不授权生成或覆盖 `eval/PREREG.lock`；PREREG 仍为 `DRAFT v0.1` 未锁定（见 §4）。
3. 不授权编造样本量/成本上限/停止阈值等数值；需要试跑数据的项保持 `pending-trial`。
4. 不授权修改宿主、插件、Skill、部署；不授权调整运行时。
5. 不能替代两名真人盲评：B4 只有工具自测，真实盲评未做。
6. 不能把 `hephi` 侧 A5 场景（E1-off partial、E5/E9 blocked）当作已通过，也不能把 E1-on（等价清理，非缺陷修复）当作 off/native 对照入口已验证。
7. 不改变 PREREG §1–§12 的任何数值与判定；`eval/PREREG.md` 本次不修改（除本记录与 decisions-draft 的引用）。

## 3. D-1..D-10 逐项：推荐值、批准后状态

推荐值均取自 `eval/decisions-draft.md`（推荐及依据行）与 `eval/PREREG.md` 对应章节；本表只记录**已明确且被本次口头批准覆盖**的项。

| ID | 决策项 | 推荐值（来源） | 批准后状态 | 说明 |
| --- | --- | --- | --- | --- |
| D-1 | 非劣效界值 | 保留 **−5pp**（`decisions-draft.md` D-1；`PREREG.md` §3 草案） | `approved-by-owner` | 按推荐值 −5pp 批准为口径；PREREG 锁定前仍按 §9 流程，锁定与试跑确认不因本条自动完成。 |
| D-2 | 主指标联合规则 | **至少 2 项主指标显著改善，且无任何主指标显著恶化**（`decisions-draft.md` D-2；`PREREG.md` §4 草案） | `approved-by-owner` | 显著口径沿用 §4 草案的 95% bootstrap CI 判据；不改变“报告全部指标、不择优”的要求。 |
| D-3 | 成本上限（7 项数值） | 先用开发集试跑估计，再签定七项上限（`decisions-draft.md` D-3；`PREREG.md` §5 占位表） | `pending-trial` | 七项数值仍是占位（`PLACEHOLDER`）；**不编造数值**，待试跑后另行批准。 |
| D-4 | 整体与分层样本量 | 试跑后按 §6 方法（配对 McNemar/配对 bootstrap，power 0.8、双侧 α=0.05）计算 `N` 后审批（`decisions-draft.md` D-4；`PREREG.md` §6 `N_TODO`） | `pending-trial` | `N_TODO` 保持占位；`min_pairs=5` 只是脚手架占位，不是批准值。 |
| D-5 | 环境不可用停止阈值 | 由负责人同时确定阈值、分母与观察窗口，并保留失败记录（`decisions-draft.md` D-5；`PREREG.md` §8 `ENV_TODO`） | `pending-approval` | 推荐里**没有具体数值**；本批准不能替代该数值决定，`ENV_TODO` 仍待负责人填写。 |
| D-6 | 成本是硬门槛还是辅助 | **保持硬门槛**，与现有联合判定一致（`decisions-draft.md` D-6；`PREREG.md` §4/§5 草案） | `approved-by-owner` | 改口径须负责人事先另行批准。 |
| D-7 | 首轮仓库与模型范围 | 首轮**单仓库单模型**，B7 多仓库后续另定（`decisions-draft.md` D-7；`PREREG.md` §10） | `pending-approval` | 范围**形态**是推荐，但具体仓库/模型名称未定，且被列为未决项；不能拆一半当已批准。 |
| D-8 | P4 shadow 可用性 | 维持“未验证”状态；若选 normal 必须披露差异（`decisions-draft.md` D-8；`RUNBOOK.md` §1/§3） | `pending-approval` | 真实宿主 shadow 可用性无证据；本批准不改变“未验证”，也不能预设有 shadow 可用。 |
| D-9 | off 组任务卡投递方案 | 现有固定 Trigger 文本注入作为**候选**，批准后真实检查两组 sha256（`decisions-draft.md` D-9；`RUNBOOK.md` §4.3） | `pending-approval` | 候选方案尚未经真实入口验证与模板 review；不能把候选当已启用口径。 |
| D-10 | `ab-metrics` 格式化/重命名估算处置 | **确认现有删除**，由既有盲评 rubric 承接语义分类（`decisions-draft.md` D-10；`RUNBOOK.md` §13.1） | `approved-by-owner` | 代码已删除相关估算输出；本批准只确认该处置，若改回需另行批准代码变更。 |

**小计**：`approved-by-owner` 4 项（D-1、D-2、D-6、D-10）；`pending-trial` 2 项（D-3、D-4）；仍待负责人/验证 4 项（D-5、D-7、D-8、D-9）。**没有任何未决项被写成已批准。**

## 4. 仍未决 / 未验证（不得写成已批准）

以下事项本批准**没有**覆盖，仍需负责人决定或真实证据：

1. **D-3 成本上限七项数值**：需要开发集试跑数据；当前是 `PLACEHOLDER`。
2. **D-4 样本量（整体 + 分层）**：需要试跑后的效能计算（`eval/prereg-sample.mjs`），当前是 `N_TODO`；不得填凭空数字。
3. **D-5 环境不可用停止阈值**：需要阈值、分母、观察窗口的具体决定，当前 `ENV_TODO`。
4. **D-7 首轮仓库与模型具体名称**：范围形态推荐单仓库单模型，但名称未定。
5. **D-8 P4 shadow 真实可用性**：无真实宿主能力证据。
6. **D-9 off 组真实投递入口**：`E1-off` 仅 partial（前置/provenance 无法核验），固定 Trigger 模板未 review。
7. **资源与费用预算**：模型/provider 参数、token 预算、运行资源均未批准具体值。
8. **两名盲评标注者与 rubric 校准**：尚未指定/校准，kappa ≥ 0.7 未达成（无真人数据）。
9. **任务集规模**：`eval/tasks/b5-tasks.json` 当前只有 2 个任务，不足以支撑正式 B5；样本量/分层都不足。
10. **PREREG 锁定**：锁定还需要数值、requirements 版本、任务清单 sha256、rubric 版本与 seed 由负责人确认后另行完成；本次 `node eval/prereg-lock.mjs --check` 仍应失败（见证据）。
11. **甲包前置**：E5/E9 仍 blocked；E1-off 干净 off 环境未验证；E1-on 只能算流程级等价清理验收。

## 5. 本次实际动作（与未做事项）

- 已做：记录本批准；按本记录更新 `eval/decisions-draft.md` 相应 `status` 行；运行 `node eval/prereg-lock.mjs --check` 并保存失败输出（不生成 lock）；生成 B5 试跑计划（`eval/B5-trial-plan.md` + `/tmp/b5-trial-plan.json`，不执行）。
- 未做：未跑实验、未调用模型、未访问宿主、未锁 PREREG、未生成 PREREG.lock、未编造任何试跑/样本量/成本数值、未替代真人盲评。

## 6. 变更记录

| 日期（Asia/Shanghai） | 变更 | 依据 |
| --- | --- | --- |
| 2026-11-08 06:36 | 负责人原话批准“乙包的，我全部批准”（Lead 转述） | Team Lead 团队消息 |
| 2026-11-08 | 新建本批准记录；D-1/D-2/D-6/D-10 置 `approved-by-owner`，D-3/D-4 置 `pending-trial`，D-5/D-7/D-8/D-9 保持 `pending-approval` | 本文件 §3 |

> 本记录是“批准事实与范围”的记录，不是 PREREG 锁定，也不是实验结论。
