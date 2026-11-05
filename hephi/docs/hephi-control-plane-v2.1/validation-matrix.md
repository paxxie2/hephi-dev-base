# Validation Matrix

| 场景 | 预期 | 命令/方式 | 证据 | 状态 |
|---|---|---|---|---|
| 普通 Worker 无 intent | 不挂 gate，原流程继续 | worker mount test | test output | 本地通过 |
| intent 存在但合同缺失 | ready 被拒绝 | worker mount/ready gate test | denial reason | 本地通过 |
| 合同 hash 错误 | ready 被拒绝 | activation test | rejection | 合同加载拒绝已测 |
| Worker 调用 KB | 绑定当前 Ticket | worker-context / KB test | query JSON | 本地通过，#53 真实调用 |
| KB 无命中 | 查询成功，matches 为空 | KB test | result JSON | 本地通过 |
| baseMap 有命中 | 只返回 baseSha 中存在的路径 | KB test / #53 重放 | context pack | 本地通过，四个指定文件均命中 |
| baseMap 结果过多 | 按不同关键词命中数排序后截断 | KB test | 60 条、truncated=true | 本地通过 |
| forward 缺报告 | blocked/unknown | runner test | check status | 本地通过 |
| forward 目标 skipped | 不通过 | 代码检查 | evaluateStep | 独立回归用例未覆盖 |
| reverse 一个目标失败、一个通过 | 通过 | runner test | check status | 本地通过 |
| reverse 目标报告缺失或 skipped | 不通过 | runner test | check status | 本地通过 |
| reverse 目标 error | 不通过 | runner test | check status | 本地通过 |
| reverse 目标外 failure/error | 不通过 | runner test | check status | failure 已测，error 独立用例未覆盖 |
| reverse 编译/环境错误 | 不通过 | 代码检查 / 缺报告与 error 用例 | check status | 部分覆盖，未做独立环境故障验收 |
| 验证期间 patch 变化 | ready 被拒绝 | verifier test | evidence JSON | 本地通过 |
| PR base/head 不匹配 | ready 被拒绝 | verifier test | evidence JSON | HEAD 已测，base 独立用例未覆盖 |
| evidence | 包含 command、args、target report IDs | verifier test / #53 | evidence JSON | 已核对 |
| 普通任务 prepare | 无编号早退；有编号缺仓库失败 | prepare-dubbo test | exit code / 无副作用 | 本地通过 |
| workspace | 拒绝外部、父仓库、歧义、符号链接逃逸 | workspace / verifier test | rejection | 本地通过 |
| KB 构建失败 | 不新增或覆盖成功记录 | KB test | 原始记录 / rejection | 本地通过 |
| 真实 Dubbo Issue #53 | 生成 passed 证据 | Super Agent E2E | native-e2e-2026-11-02.md | 已通过，含人工恢复 |
| 全新 Issue #63 | 无人工恢复完成原生流程 | Super Agent E2E | native-e2e-2026-11-02.md 的第二个样本 | 已通过；首次拒绝后 Worker 自主修正 |

2026-11-02，四项修复代码 `8746bef`：`pnpm check` 的 16 个文件 / 72 个测试、类型检查及构建通过。模拟单测和真实任务结果分别标注；未覆盖项不记为通过。
