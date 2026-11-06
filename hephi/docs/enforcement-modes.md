# HEPHI 执行与影子模式（P4，实施范围说明）

## 模式

- `HEPHI_ENFORCEMENT=enforce|shadow`，默认 `enforce`；非法值在 prepare 阶段直接拒绝。
- 模式在 prepare 时冻结进 activation 合同（`enforcement` 字段，纳入合同哈希），挂载后只读合同，不读取后续环境变化。
- 无 `enforcement` 字段的旧合同按 `enforce` 解释。

## shadow 行为（已实施部分）

- 不注入赫菲启动提示与任务卡提示（`systemPrompt` 不新增 section）。
- 不注册 `hephi_check` 工具，也不安装 staged 阶段控制。
- 写/改文件的路径与范围判定照常计算，但一律放行；决策日志记录 `mode:"shadow"`、`effectiveDecision:"allow"`、`wouldDecision:"deny"`。
- ready 只计算范围/预算/删除测试等纪律，一律放行；判定结果记录为 `wouldDecision`，不计算检查记录、Session 绑定与 PR 证据。
- 决策日志本身属于允许的观察副作用。

## 未实施部分（需要本仓库之外的工作）

- super-agent 的 Worker 工具白名单 / Skill 挂载面清理：super-agent 源码不在本仓库（`projects/super-agent`），
  属于 P4 的“无插件/无标签/shadow 三组模型可见表面一致”验收范围，需在 super-agent 仓库另做。
- 三组真实对照导出与比对：宿主现场、`scripts/experimental/check-shadow-parity.mjs` 只做已导出清单的比对，
  真实导出仍需宿主操作者执行；未通过前不得开展有度量 B5 对照。
