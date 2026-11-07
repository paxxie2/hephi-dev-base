# restore-health-service-id

## 任务
修复数据源与健康服务标识：恢复 `backend/app/data/` 源码包并把 `.gitignore` 运行期数据规则收窄为 `/data/`；同时在 `Health` schema 增加固定 `service="site-pnl-diagnosis"` 字段（200/503 响应都返回），既有字段与状态码语义不变。

本任务来自本地仓库真实历史提交 `ab7c8e03b6938df9fc52d486477402db313ae1ca`（base=`e00f338b098546adc40156dc15b4b6559e19835d`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 缺少 `backend/app/data/` 源码包（import 失败），`Health` 也没有 `service` 字段；隐藏测试的目标断言失败。

## 合法范围
仅允许改动：`.gitignore`, `README.md`, `backend/app/data/__init__.py`, `backend/app/data/loader.py`, `backend/app/data/seed.py`, `backend/app/schemas.py`, `backend/tests/test_health_service.py`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
