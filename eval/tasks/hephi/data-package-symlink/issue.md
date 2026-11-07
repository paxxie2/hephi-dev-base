# data-package-symlink

## 任务
修复两处工具健壮性缺陷（来自 self-check）：`eval/check-data-package.mjs` 不再跟随符号链接（此前 statSync 对 ELOOP/断链会崩溃），改为记录 `symlink` finding；`eval/export-baseline.mjs` 在数据库缺失/读取失败时显式报错并 exit 2，而不是抛未捕获异常。未改变正常路径的扫描与导出语义。

本任务来自本地仓库真实历史提交 `bf4d3979e7cc96076f45fdb2db18fefbb442ba39`（base=`0a6e2d010591a01164d1808bfeb809497e289359`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的 `check-data-package.mjs` 对符号链接目录崩溃（无 symlink finding），`export-baseline.mjs` 对缺失数据库抛未捕获异常（非显式 exit 2）；隐藏测试的 JSON finding 与 exit 2 断言失败。

## 合法范围
仅允许改动：`docs/self-check-2026-11-07.md`, `docs/source-consistency.md`, `eval/check-data-package.mjs`, `eval/export-baseline.mjs`, `hephi/docs/decisions-format.md`, `hephi/docs/enforcement-modes.md`, `hephi/docs/versioning.md`, `hephi/src/control/ready-gate.ts`, `hephi/src/control/worker-mount.ts`, `hephi/tests/control/worker-mount.test.ts`, `scripts/host/rebuild-isolated.sh`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
