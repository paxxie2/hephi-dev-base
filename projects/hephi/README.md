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

目前只接受明确结束的前台检查。后台、取消或未知结果不会放行；这些异常的恢复能力尚未完成。XML 解析器、强制反向验证和项目专用报告转换器已删除。检查命令不再接受 `parser`、`reportPaths`、`targetTests`、`expect` 字段；已有此类配置必须明确修订后创建新任务，不能静默忽略。

## 开发和验收

```sh
pnpm install
pnpm check
```

`check` 执行类型检查、自动测试和构建。这些检查不等于原生 GitHub → Worker → 赫菲 → PR 的真实端到端验收。历史运行记录在 `docs/validation/`，只能证明所标明的版本；新改动须重新验收。

构建后通过现有 DSH profile 加载插件，不启动另一套 Super Agent。部署前确认当前任务状态，不用重启宿主中断其他会话。
