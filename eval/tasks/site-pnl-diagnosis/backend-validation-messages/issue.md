# backend-validation-messages

## 任务
新增测算输入校验的中文字段级错误提示模块 `backend/app/validation_messages.py`，并接入 `schemas.py` 的字段校验与 `main.py` 的 `RequestValidationError` 处理器：缺失、类型错误、非有限数、负数、越界比例、未知字段、枚举错误都返回明确字段 + 中文提示，不修改金额公式与业务口径。

本任务来自本地仓库真实历史提交 `abdef2f3de6ffd936735694e85dcc25a35516fa6`（base=`e00f338b098546adc40156dc15b4b6559e19835d`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `backend/app/validation_messages.py` 尚不存在（该提交新增），隐藏测试 import 即失败（目标模块缺失）。

## 合法范围
仅允许改动：`backend/app/main.py`, `backend/app/schemas.py`, `backend/app/services/chat.py`, `backend/app/services/scenarios.py`, `backend/app/validation_messages.py`, `backend/tests/test_scenario_api.py`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
