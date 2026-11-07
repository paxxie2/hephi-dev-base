# verify-export

## 任务
实现 B8 导出交叉校验工具 `eval/daily/verify-export.mjs`：只读校验每日导出与观测记录的字段、版本与口径一致性，不修改真实 `eval/daily` 文件，并提供 `--self-test` 合成夹具（自测断言真实文件在自测前后字节一致）。

本任务来自本地仓库真实历史提交 `bcb4c8c038a8272b3003bf10143ed273e43c97db`（base=`63f2f98ac2a0ccc7666fe1fd316abfe7b40065f0`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/daily/verify-export.mjs` 尚不存在（该提交新增 394 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`eval/B8-observe.md`, `eval/daily/verify-export.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
