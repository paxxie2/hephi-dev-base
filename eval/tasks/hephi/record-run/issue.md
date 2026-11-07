# record-run

## 任务
实现运行记录生成器 `eval/record-run.mjs`（B3）：按 `eval/schema/run.schema.json` 做最小严格校验，输入字段原样写回、不补默认值；输出已存在时拒绝覆盖；写文件使用同目录临时文件 + rename 原子替换；退出码 0/1/2 区分合法、数据不合法、参数与 IO 错误。并要求 `--self-test` 覆盖 B3-01..B3-05（合成夹具、系统临时目录、不写仓库）。该任务改动量较大、涉及 schema 与退出码契约，适合 staged 实验标记。

本任务来自本地仓库真实历史提交 `d6d4340fa3a17515ac863c124bca9a7a40046e8d`（base=`bc21caca316d6032ebcc3d2bc6387c38e0a3579c`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `eval/record-run.mjs` 尚不存在（该提交新增 1060 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`eval/RUNBOOK.md`, `eval/record-run.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
