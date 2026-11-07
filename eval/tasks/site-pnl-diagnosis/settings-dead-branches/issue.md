# settings-dead-branches

## 任务
重构 `backend/app/settings.py` 的 `Settings.from_env`：删除 body 与 orelse 完全相同的 if/else 分支，直接调用 dotenv 读取；环境变量解析、默认值、脱敏视图等行为保持不变。

本任务来自本地仓库真实历史提交 `33fd9d3a1841d6afbac9ac8af8f23009301b51e7`（base=`8d2ec5858ed3071eae598e5afb30b069807ce598`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的 `Settings.from_env` 仍包含 body 与 orelse 完全相同的 if/else 分支，隐藏测试的 AST 断言失败（行为本身在 base 与参考修复上一致）。

## 合法范围
仅允许改动：`backend/app/settings.py`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
