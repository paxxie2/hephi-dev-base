# daily-export-rework

## 任务
实现 B8 每日导出与返工候选两个模块：`eval/daily/export.mjs` 从工单记录聚合去重、按状态计数并做导出校验；`eval/daily/rework.mjs` 基于真实 git 历史找出返工候选并记录原 PR 关联；两者都提供离线 `--self-test` 合成夹具。改动同时落在 `eval/daily/` 两个模块与文档，属于跨模块任务。

本任务来自本地仓库真实历史提交 `2b89d845a751f13e4d1b6cf2388ef879d3ac9625`（base=`d0a84acc0436d81c314e899e93d5c26ea4c8fa7f`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/daily/export.mjs` 与 `eval/daily/rework.mjs` 均不存在（该提交新增 331+276 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`eval/daily/APPEALS.md`, `eval/daily/MAINTENANCE.md`, `eval/daily/export.mjs`, `eval/daily/rework.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
