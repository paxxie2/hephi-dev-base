# b7-matrix

## 任务
实现 B7 多项目/多模型准备矩阵生成器 `eval/b7-matrix.mjs`：读取仓库×模型准备输入，按 `environmentReady && offlineBuild`、`checksConfig` 判定组合 eligibility，不满足项写入 blockers，样本量状态固定 `pending-prereg`（不计算、不猜测数值），并提供 `--self-test`。矩阵只是准备状态，不是实验结果。

本任务来自本地仓库真实历史提交 `5e037bfe55f1ea8d41bacf177e13c1fda3c4febd`（base=`858711a86009efb5ed79308c9bee4d9a7583a943`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/b7-matrix.mjs` 尚不存在（该提交新增 431 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`eval/B7.md`, `eval/b7-matrix.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
