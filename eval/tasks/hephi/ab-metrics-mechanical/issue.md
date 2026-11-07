# ab-metrics-mechanical

## 任务
把 `eval/ab-metrics.mjs` 收窄为纯机械指标：删除 formatOnly/renames 启发式及其 `unrelatedRefactor` 聚合与 `verdict.effective` 结论字段，保留变更文件/行数、outside-share、删除测试数、hidden 通过率与成本字段；新增 `--self-test` 证明被删除的启发式字段不再出现。`eval/b5-plan.mjs` 同时增加 seed 确定性的两臂交错计划生成与严格输入校验。

本任务来自本地仓库真实历史提交 `a2c1d86670ba3c87f86148e5feaf30b0fc2426fa`（base=`7c52d33a6d5c334c4f81c3408a2222853df0711b`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的 `ab-metrics.mjs` 没有 `--self-test`（该提交新增），也不满足机械指标契约，隐藏测试自测断言失败（未知参数/缺失自测）。

## 合法范围
仅允许改动：`eval/PREREG.md`, `eval/RUNBOOK.md`, `eval/ab-metrics.mjs`, `eval/b5-plan.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
