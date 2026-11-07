# restore-data-package

## 任务
修复仓库基线可运行性缺陷：main 合并后缺少 `backend/app/data/`（loader/seed 源码包）且根 `.gitignore` 的 `data/` 规则误伤源码包，干净 checkout 下 `import app.data` 失败。恢复既有实现（字节一致）并把规则收窄为 `/data/`，只忽略仓库根运行期数据库。

本任务来自本地仓库真实历史提交 `91e4bc54cfdd386c9cee88cec29d83120cb0d80f`（base=`e00f338b098546adc40156dc15b4b6559e19835d`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 缺少 `backend/app/data/` 源码包且 `.gitignore` 含 `data/` 规则；隐藏测试的 import 与 ignore 断言失败。

## 合法范围
仅允许改动：`.gitignore`, `backend/app/data/__init__.py`, `backend/app/data/loader.py`, `backend/app/data/seed.py`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
