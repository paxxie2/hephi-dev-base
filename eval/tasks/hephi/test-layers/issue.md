# test-layers

## 任务
把 `hephi/package.json` 的测试脚本拆成 unit 与 integration 两套（P6，行为保持）：`test:unit` 只跑不依赖 git/subprocess 的契约、激活、版本、决策日志、ready gate、工具测试；`test:integration` 跑真实 git 套件与探针并排除 unit-only 套件；`check` 仍执行全量 `pnpm test`。只改脚本组合，不改任何测试代码或其覆盖。

本任务来自本地仓库真实历史提交 `a96dc1bbad9e2d76f3cf24009d2da7fa85a27f7b`（base=`44e888cef161fd0c30daa1dc91f362d91eb2b1e0`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的 `hephi/package.json` 没有 `test:unit` / `test:integration` 脚本，只有单一 `test`；隐藏测试对拆分后脚本契约的断言失败。

## 合法范围
仅允许改动：`hephi/package.json`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
