# frontend-form-feedback

## 任务
分阶段交付前端测算表单反馈与基线修复：表单显示字段单位与合法范围、映射并展示后端字段级错误、前端预校验阻止无效提交与重复点击、修正后可重新测算；同时恢复 `backend/app/data/**` 源码包、把 `.gitignore` 收窄为根 `data/`，并补组件测试与真实浏览器旅程证据。改动跨后端数据包、前端组件与 e2e，适合 staged 实验。

本任务来自本地仓库真实历史提交 `fb0580e3c0033e80605c004eeebb818bba077422`（base=`418af9a671c30cc6e7ceaea70f53be47335c8b88`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 缺少恢复后的 `backend/app/data/**`（import 失败），前端 `ScenarioSection.tsx` 也没有范围提示与字段错误映射；隐藏测试断言失败。

## 合法范围
仅允许改动：`.gitignore`, `INTERFACES.md`, `acceptance/test_business_http.py`, `backend/app/data/__init__.py`, `backend/app/data/loader.py`, `backend/app/data/seed.py`, `web/e2e/08-scenario-validation.spec.ts`, `web/e2e/helpers.ts`, `web/src/features/scenarios/ScenarioSection.test.tsx`, `web/src/features/scenarios/ScenarioSection.tsx`, `web/src/styles.css`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
