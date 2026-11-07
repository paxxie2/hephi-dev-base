# prereg-lock-version

## 任务
修复 `eval/prereg-lock.mjs --check` 的可审计性缺陷：检查输出必须打印工具版本（`schemaVersion`、生成器名与版本），否则不同版本工具的检查结果无法区分。保留原有 fail-closed 行为（存在未决项时 exit 1 且不写 lock）与所有既有输出行。

本任务来自本地仓库真实历史提交 `29b127809d3389b693ca21b7e242e57086fafc99`（base=`bcb4c8c038a8272b3003bf10143ed273e43c97db`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的 `--check` 在“合成已决输入”上通过（exit 0）但输出缺少工具版本行，隐藏测试对 `version: schemaVersion=` 的断言失败；同时 base 上真实未决输入仍 fail-closed。

## 合法范围
仅允许改动：`eval/prereg-lock.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
