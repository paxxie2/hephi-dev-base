# B5 两仓库准备任务

这两项是从真实 Git 基线定义的**边界增强 fixture**，不是历史故障宣称，不是已准入的正式样本，也不是模型实际交付。任务只在临时 Git worktree 应用参考补丁，未改生产源码。

| taskId | 仓库 / 固定 base | 本轮离线验证 |
|---|---|---|
| previous-window-order | site-pnl-diagnosis / `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | 目标断言失败 3 次 → 参考补丁通过 3 次 |
| b5-task-key-whitelist | hephi / `9fa8598f2beabe179b28733e484275c3775279d3` | 目标断言失败 3 次 → 参考补丁通过 3 次 |

各任务的 `validation.json` 保留实际日志、退出码、范围检查；`review.md` 记录核对状态及失败复验。task.json 使用逻辑仓库名保持可移植，完整验证须提供真实本地 clone 路径；两个 base 都是真实现有 Git 提交，没有自造 base。隐藏测试只用 Node/Python 标准库，不安装依赖、不联网、不调用模型、不访问宿主。

```sh
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order --repo /path/to/site-pnl-diagnosis --json
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist --repo /path/to/hephi-review --json
node eval/b5-plan.mjs --tasks eval/tasks/b5-tasks.json --seed 20261107 --repeat-fraction 0.2 --dry-run
```

`--dry-run` 仅验证结构；逻辑仓库 ID 使其不能确认锁文件，因此可能警告，完整模式已核实锁文件。锁文件存在不代表整仓离线构建通过。

仅两项任务时，现有生成器 `round(2 * 0.2)` 为 0，故产生 4 个 primary runs、0 个 repeat runs；这不是完整 B5 实验，不证明重复一致性或统计效应。seed/repeat-fraction 仅本次准备命令参数，未锁定 PREREG。污染比例、正式样本量、模型参数和全仓环境均待验证；真实端到端未验证通过。
