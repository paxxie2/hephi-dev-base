# G1 开发集运行进度（T15）

实例：g1-exp（127.0.0.1:3085，G1 制品 hephi 9c5afb2 + SA d0e64d6）；对照 g1-ctl（3086，冻结 6d24e1b + 62d7d53）仅冒烟。

| # | 任务 | 仓库 | issue | 状态 |
|---|---|---|---|---|
| T1 | diagnoses 默认 limit 20→10 | b5-off-history-page-size | #11 | ✅ ready.pass，PR #12 已合入 |
| T2 | limit 上限 100→50 | b5-off-history-page-size | #14 | 已创建，待投递（多仓库共享 issues 游标限制，需 bump） |
| T3 | offset le=10000 | b5-off-history-page-size | - | 材料就绪 |
| T4 | health 服务标识（试跑卡） | b5-off-health-service-field | #6 | 已创建，待 bump |
| T5 | diagnoses 默认 limit（health 仓） | b5-off-health-service-field | - | 材料就绪 |
| T6 | money 窗口辅助（试跑卡） | b5-off-money-window-helpers | #7 | 已创建，待 bump |
| T7 | limit 上限（money 仓） | b5-off-money-window-helpers | - | 材料就绪 |
| T8 | 输入校验（试跑卡） | b5-off-backend-input-validation | #7 | 已创建，待 bump |
| T9 | offset 上限（backend 仓） | b5-off-backend-input-validation | - | 材料就绪 |
| T10 | offset 上限（health 仓） | b5-off-health-service-field | - | 材料就绪 |

串行约束：验收检查跑整个 acceptance 目录，同仓前序修复必须先合入 main 再投下一任务（链：history T1→T2→T3；health T4→T5→T10；money T6→T7；backend T8→T9）。

已知问题记录：
1. 多仓库共享 issues 游标（github-stream:issues 单键）：创建时间早于游标的兄弟仓 issue 会被跳过；规避=创建后立即编辑 bump updated_at。
2. 自作者 issue 需正文 @提及 agent 登录名（readStream mentions 规则）。
3. REST 配额与实例轮询共享 token，2026-11-08T12:03Z 耗尽，整点恢复后继续。
