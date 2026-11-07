# prereg-lock-gate

## 任务
实现 fail-closed 的 PREREG 锁定门禁 `eval/prereg-lock.mjs`：扫描固定输入（PREREG、决策记录）中的 TODO/PLACEHOLDER 等未决标记；存在未决项时拒绝写 `eval/PREREG.lock` 并 exit 1，通过时才写出锁文件（input sha256 + 规范化拼接 hash）。同时提供 `--self-test`，用合成夹具覆盖 fail-closed、输入缺失、`--dry-run` 不写文件等路径。这是 ROADMAP-95 工作线 B 的 B1 准备工具，不涉及真实实验数据。

本任务来自本地仓库真实历史提交 `7bce0599fc2ec4a5f67de2b8569d591f20e3ee50`（base=`5dcb5c2ccf31956560db25c2aa503612ac2ed9e3`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/prereg-lock.mjs` 尚不存在（该提交新增 534 行工具），隐藏测试启动即失败（MODULE_NOT_FOUND），属于目标模块缺失而非依赖问题。

## 合法范围
仅允许改动：`eval/prereg-lock.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
