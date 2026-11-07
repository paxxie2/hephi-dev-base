# history-page-size

## 任务
修复诊断历史分页默认值（Issue #16）：前端历史列表请求每页 20 → 10；`HistoryView` 每页条数兜底 20 → 10 并补当前页提示 testid；后端 `GET /api/diagnoses` 默认 limit 20 → 10，重新导出 `contracts/openapi.json` 并同步 `INTERFACES.md`。分页布局与禁用逻辑不变。

本任务来自本地仓库真实历史提交 `8fe1cdd31db5c4ee2b84ff09e5717ab84c4c539a`（base=`bd816e9eb019b0520b98dbc1bd53bdf0c85010d4`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 的后端默认 `limit=20`、前端 `HISTORY_PAGE_SIZE=20` 且没有 `history-page-indicator`；隐藏测试对默认值 10 的 AST/源码断言失败。

## 合法范围
仅允许改动：`INTERFACES.md`, `README.md`, `acceptance/test_business_http.py`, `backend/app/api/diagnoses.py`, `backend/tests/test_diagnosis_api.py`, `contracts/openapi.json`, `web/e2e/08-history-pagination.spec.ts`, `web/src/App.test.tsx`, `web/src/App.tsx`, `web/src/features/history/HistoryView.tsx`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
