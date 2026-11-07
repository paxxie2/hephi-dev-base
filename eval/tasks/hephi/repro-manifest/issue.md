# repro-manifest

## 任务
实现离线 B5 复现包清单生成器 `eval/repro-manifest.mjs`：把一次 B5 计划的输入文件 sha256、本地工具链版本（node/pnpm/python 与 requirements 固定版本 hash）、每个任务 base、计划 run 列表、分析命令与原始记录路径占位固定进 manifest；不运行任务、不联网、不安装依赖，且提供 `--self-test` 合成夹具。

本任务来自本地仓库真实历史提交 `63f2f98ac2a0ccc7666fe1fd316abfe7b40065f0`（base=`2af288e5780269c70292d3531245b76a5a7b07cb`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/repro-manifest.mjs` 尚不存在（该提交新增 578 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`eval/repro-manifest.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
