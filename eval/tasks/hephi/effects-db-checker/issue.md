# effects-db-checker

## 任务
实现 H7 只读 effect 表查询工具 `scripts/host/check-effects-db.mjs` 与真实 SQLite/WAL fixture 探针 `scripts/host/test-effects-db.mjs`：用真实 WAL 文件验证只读模式能看到已提交未 checkpoint 的行、拒绝 `immutable=1` 的过期快照、查询前后数据库与 WAL 字节不变、缺失/损坏库返回 JSON 错误并 exit 1；copy 模式在临时目录读取 db+wal+shm 副本。工具与探针分属两个模块。

本任务来自本地仓库真实历史提交 `a5dc8264be967190484d2ab6ec019e62b2cae539`（base=`57564b89bcd1a8bd25d9216ac8ba966aa0d1d62d`，即其父提交）；参考修复 `reference.patch` 为该提交上述文件的 `git diff`，不是人工编造的测试夹具。任务卡不向 Worker 提供参考实现或隐藏测试内容。

## 验收
隐藏测试在固定 base 上必须连续失败 3 次（退出码非 0，且为目标断言失败或目标模块缺失），应用 `reference.patch` 后必须连续通过 3 次且 3 次输出一致；只使用仓库内已有工具链（无联网、无安装、无模型/宿主调用）。base 失败原因：base 上 `scripts/host/check-effects-db.mjs` 与 `scripts/host/test-effects-db.mjs` 均不存在（该提交新增 217+206 行），隐藏测试启动即失败（MODULE_NOT_FOUND）。

## 合法范围
仅允许改动：`scripts/host/check-effects-db.mjs`, `scripts/host/test-effects-db.mjs`。不得改动其他产品文件、运行配置、Skill 或阶段策略；不得删除或弱化既有测试，不得用 mock 替换真实路径。
