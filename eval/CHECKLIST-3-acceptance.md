# 清单 3 验收记录

基线 `9fa8598f2beabe179b28733e484275c3775279d3`；分支 `agent/bline-prep-2`；日期 2026-11-07。范围仅 eval/**。

| 项目 | 交付与核验 | 结果 |
|---|---|---|
| 3.1 | decisions-draft.md，D-1 至 D-10，各项待批准、选项/影响/推荐/批准人/同步文件 | 准备完成 |
| 3.2 | prereg-sample.mjs；node --check，--self-test（19）；另一 Agent 独立公式及数值核对 | exit 0 |
| 3.3 | 两仓固定真实基线；各 task 的结构 dry-run；validation.json 保留原始目标断言失败 3 次、参考补丁通过 3 次及范围检查 | 离线夹具通过 |
| 3.4 | B7-data.md、b7-data.json、b7-models.json、生成快照；dry-run 与快照除生成时间完全一致 | 6 组合，0 eligible |
| 3.5 | 两张填写表、明确虚构示例及既有误拦率口径 | 文档核对通过 |
| 3.6 | check-task / b5-plan / b7-matrix / prereg-sample --self-test | 全部 exit 0；B5 24、B7 36、样本量 19 项 |

## 复现

```sh
node --check eval/prereg-sample.mjs
node eval/check-task.mjs --self-test
node eval/b5-plan.mjs --self-test
node eval/b7-matrix.mjs --self-test
node eval/prereg-sample.mjs --self-test
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist --dry-run
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order --dry-run
node eval/b5-plan.mjs --tasks eval/tasks/b5-tasks.json --seed 20261107 --repeat-fraction 0.2 --dry-run
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --dry-run
git diff --check
```

完整夹具复现命令见 tasks/B5-preparation.md。样本量/工具自测是合成数值或夹具测试；不代表模型真实运行。主 Agent 实际核对两项隐藏测试、补丁、原始输出及范围，确认基线失败并非依赖错误。首次 Hephi 锁文件路径错误保留在 validation-initial-lockfile-failure.json，修正后从基线完整重验。

## 限制

未运行真实实验、未访问宿主、未锁定数值。所有 D 项 pending-approval，矩阵 sampleSizeStatus=pending-prereg。当前真实端到端未验证通过。

两个任务均为边界增强准备样本，不证明类别覆盖、污染控制或实验代表性。2×20% 经已有规划器取整为 0 次重复，4 次运行仅为生成计划，未执行。所有环境 readiness 未核验，保持 false。样本量脚本是单守护指标配对 Wald 近似，不能作为整轮/分层/联合指标正式样本量。
