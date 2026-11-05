# HEPHI 控制面 v2.1 实施契约

```yaml
id: hephi-control-plane-v2.1
source_design: docs/hephi-control-plane-mvp-v2.md
baseline_commit: bd53f06eaf9dd6dd412523970eb7e7f0a184bcb6
objective: 在现有 Super Agent Worker ready 路径上补齐验证一致性和最小当前代码上下文，不改变 Super Agent 运行时。
scope:
  in:
    - 移除 Worker 必做流程中的旧 hephi_verify
    - 修正 reverse 多目标测试判定
    - 抽取一份最小共享 workspace 解析工具
    - 扩展 hephi_kb_search 返回基于 baseSha 的 baseMap/context pack
    - 补齐验证证据中的命令、参数和目标报告 ID
    - 保证激活 Worker 的 gate 挂载和 activation intent 失败关闭
    - 增加单元、集成和真实 Dubbo Issue 验收
  out:
    - Super Agent 源码和运行时
    - Worker、Session、Ticket、队列、调度和重试
    - 第二套 Runner 或状态机
    - 根因裁决器、任务账本、轨迹系统、超时重试
    - 跨仓库 Recipe、Java 调用图、embedding 检索
constraints:
  - HEPHI 仍是可选控制面
  - 普通 Worker 没有 activation.intent 时行为不变
  - ready gate 是唯一交付验证来源
  - 单仓库 paxxie2/dubbo，单 Recipe Dubbo
  - 不新增持久化 context pack 或新的状态文件
non_negotiables:
  - reverse 不能把编译、依赖、环境或目标外失败当作预期复现
  - baseMap 只能来自合同 baseSha 的 Git 树
  - 模型根因文字不能成为 ready 条件
  - 所有通过结论必须有当前实现和测试证据
decisions_pending:
  - 目标测试中至少一个断言失败、其余目标测试允许通过
  - 目标外 failure/error 一律阻断 reverse
acceptance_oracles:
  - pnpm check 通过
  - reverse 判定矩阵测试全部通过
  - KB context pack 绑定当前 ticket、contractHash、baseSha
  - 普通任务、激活缺失和合同损坏路径均符合 fail-open/fail-closed 约定
  - 一个真实 Dubbo Issue 经过 ready gate 并生成 result=passed 证据
rollback_points:
  - R0: 保留 baseline_commit，可完整回退本批提交
  - R1: 先只发布 Skill 和测试，不启用 baseMap
  - R2: baseMap 失败时保留旧 KB 返回，不影响普通 Worker
production_validation: required
goal_mode: false
```
