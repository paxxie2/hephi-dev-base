# HEPHI：Super Agent 的交付核验插件

只复用 Super Agent 原生 Ticket、Worker、工作区和 PR 流程，不提供第二套交付执行器。

## 当前流程

1. 原生 prepare 冻结任务合同：仓库、base、范围和项目检查命令。
2. Worker 读取合同；配置了知识库时查询对应知识库。
3. Worker 实施，通过 `hephi_check(checkId)` 运行合同中的检查。
4. 检查工具保存真实执行结果、日志及前后代码指纹。
5. Worker 按原生流程推送并创建 PR，调用 `orchestrator_report(ready)`。
6. ready 核对必需检查、证据、代码版本、范围和合同要求的 PR，不重新执行项目测试。

`native` 使用 DSH 原生执行能力；明确选择 `staged` 时，启用原有串行阶段工具，按检查、checkpoint、成功 progress 推进。两种模式使用同一最终核验入口。

全局工具仅有 `hephi_get_contract` 和 `hephi_kb_search`；检查及可选阶段工具挂到当前 Worker。旧 Delivery 工具、Recipe 和项目专用 ready 验证器已删除。

## 检查配置

`scripts/prepare-dubbo.sh` 保留现有入口文件名，内容已改成项目无关：只处理带 `hephi/delivery` 标签的 Issue。宿主必须显式提供 `HEPHI_SOURCE_REPO`（本地 clone）、`HEPHI_STATE_DIR`（与插件一致）、`HEPHI_ALLOWED_PATHS` 和 `HEPHI_VERIFICATION_FILE`。不再内置仓库名单、个人路径或默认验收命令；缺配置直接报错。

通过 prepare 的 `HEPHI_VERIFICATION_FILE` 指向项目检查配置，例如：

```json
{
  "version": 1,
  "checks": [{
    "id": "business-regression",
    "kind": "test",
    "purpose": "执行本项目必需的业务回归",
    "command": "node",
    "args": ["scripts/check-business.cjs"]
  }]
}
```

项目检查入口负责正确选择测试，并在目标测试未执行、断言失败或其他不满足验收条件时非零退出。命令成功不自动证明 Issue 业务正确，更不能把单纯构建成功当作业务验收。GitHub 交付应明确设置 `HEPHI_REQUIRE_PULL_REQUEST=1`。

检查可以是前台命令，也可以是宿主原生后台 Job；HEPHI 等待其终态。取消、超时或未知结果不会放行，这些异常的恢复能力尚未完成。

## 任务卡

`HEPHI_REQUIRE_TASK=1`（prepare 脚本默认开启）时，Issue 正文必须包含任务卡，否则不创建合同：

````text
```hephi-task
{
  "version": 1,
  "goal": "total() 返回两数之和",
  "outOfScope": ["定价规则", "模块结构调整"],
  "acceptance": [
    { "id": "AC1", "text": "total(2, 3) 为 5", "check": "tests",
      "paths": ["src/price.js", "tests/price*"], "tests": ["tests/price*"] }
  ],
  "budget": { "maxFiles": 3, "maxChangedLines": 40 }
}
```

```hephi-test AC1 tests/hephi/AC1.test.sh
node -e "process.exit(require('./src/price.js').total(2, 3) === 5 ? 0 : 1)"
```
````

- 合同哈希覆盖整张任务卡；`hephi-test` 块是冻结验收测试，存放在 Worker 检出目录之外，按内容哈希校验。
- 改动文件必须同时落在 `HEPHI_ALLOWED_PATHS` 和某个验收项的 `paths` 内；直接 `write`/`edit` 越界会被当场拒绝。
- ready 时检查改动预算、重命名、纯格式化改动和已有测试的删除（`protect`，默认覆盖常见测试路径）。`allowRenames`、`allowFormatOnly` 可显式放开。
- `hephi_check("AC1")` 在两个临时 worktree 里运行该项的检查：HEAD 加冻结测试必须通过，base 加冻结测试和 Worker 的匹配测试必须失败。依赖目录（如 `node_modules`）通过检查配置的 `proofLinks` 链接进去。
- ready 时每条证据都必须能在宿主 Session 事件中找到对应的原生 bash 调用（`HEPHI_REQUIRE_SESSION_BINDING=0` 可关闭，仅用于宿主核对事件格式期间）。XML 解析器、强制反向验证和项目专用报告转换器已删除。检查命令不再接受 `parser`、`reportPaths`、`targetTests`、`expect` 字段；已有此类配置必须明确修订后创建新任务，不能静默忽略。

## 开发和验收

```sh
pnpm install
pnpm check
```

`check` 执行类型检查、自动测试和构建。这些检查不等于原生 GitHub → Worker → 赫菲 → PR 的真实端到端验收。历史运行记录在 `docs/validation/`，只能证明所标明的版本；新改动须重新验收。

构建后通过现有 DSH profile 加载插件，不启动另一套 Super Agent。部署前确认当前任务状态，不用重启宿主中断其他会话。
