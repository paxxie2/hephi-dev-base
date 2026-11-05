# HEPHI 控制面 v2.1 实施清单

状态：`implementation_complete_pending_e2e`。本清单记录已完成的代码和本地验证，真实 Ticket E2E 尚未完成。

## Preflight

- [x] 阅读并冻结 [hephi-control-plane-mvp-v2.md](../hephi-control-plane-mvp-v2.md)。
- [x] 阅读 [implementation-contract.md](implementation-contract.md)。
- [x] 确认基线为 `bd53f06eaf9dd6dd412523970eb7e7f0a184bcb6`。
- [x] 在实现前确认没有未提交代码改动。
- [x] 运行 `pnpm check`，记录本地验证结果。
- [x] T0-T5 完成后再进入真实 Ticket 阶段。

## T1：对齐 Worker Skill 和工具入口

- [x] 修改 `skills/hephi-superagent-control/SKILL.md`：要求调用 `hephi_kb_search`，并使用 Super Agent 原生 ready/report 流程。
- [x] 删除 `hephi_verify` 的必做步骤。
- [x] 明确 ready gate 是唯一交付验证来源。
- [x] 将旧 `hephi_verify` 标成诊断性工具，不代表交付通过。
- [x] 保留 Worker 自行运行探索性测试的能力。
- [x] 检查 Skill 不再要求直接 grep KB。

完成条件：Skill 中只有一条交付验证来源，普通 Worker 的工具和 Session 行为没有增加。

## T2：共享 workspace 解析

- [x] 新增 `src/control/workspace.ts`，只放 `gitRoot` 和 `resolveWorkspace`。
- [x] 从 `src/control/dubbo-verifier.ts` 移除重复实现并改为导入。
- [x] 修改 `hephi_kb_search` 为 `execute(args, exec)`。
- [x] 合同目录限定直接 Git root 或唯一直接嵌套 checkout；Session cwd 仅确认该位置。
- [x] 使用 realpath 精确比较 Git root，拒绝外部 clone、父仓库和符号链接逃逸。
- [x] 不允许回退到任意外部独立 clone。
- [x] 为直接仓库、单层嵌套 worktree、多仓库候选和非 Git 目录补测试。

完成条件：KB 和 verifier 对同一 Worker 得到同一 Git root。

附加 fail-closed 检查：

- [x] `agent/created` 的同步挂载异常不能被吞掉。
- [x] 已写入 `activation.intent` 但合同生成失败时，后续 ready 仍被拒绝。
- [x] 缺少 Ticket ID 的场景属于尚未开始激活，不要求创建无法绑定的 intent。

## T3：reverse 多目标判定

- [x] 在 `src/verification/runner.ts` 中先校验所有目标报告存在。
- [x] 拒绝目标测试 skipped 或 errors。
- [x] 要求至少一个目标测试有 failure。
- [x] 允许其余目标测试通过。
- [x] 拒绝目标外 failure/error。
- [x] 没有报告、编译失败、依赖失败和环境失败不能映射为 reproduce。
- [x] 增加完整判定矩阵测试。

完成条件：`expect: reproduce` 不再使用单个 `matching.find()` 直接放行。

## T4：baseMap/context pack

- [x] 扩展 `src/kb/index.ts` 的返回类型。
- [x] `args.query` 作为主要查询词；Skill 负责传入标题、模块和错误词。
- [x] 以合同 `baseSha` 执行 `git grep`。
- [x] 只返回 base 中真实存在的路径。
- [x] 返回 `candidateModules`、`candidateFiles`、`candidateTests`、`unknowns`、`truncated`。
- [x] 设置固定结果上限。
- [x] 无命中返回空结果，不把它当作系统错误。
- [x] 结果过多明确 `truncated=true`。
- [x] 保留历史 KB 引用和 `referenceOnly=true`。
- [x] 不新增 context pack 文件或状态机。
- [x] 更新 KB 单测。

完成条件：一次 `hephi_kb_search` 返回合同约束、baseMap、历史参考和未知项。

## T5：evidence 最小字段

- [x] 在现有 evidence JSON 中加入每个 step 的 `command`、`args`。
- [x] 加入 forward/reverse 的目标报告 ID。
- [x] 不保存完整 Maven 日志或永久 XML。
- [x] 检查证据中不包含 token、cookie 或未过滤的 Issue 注入内容。
- [x] 增加 evidence JSON 断言测试。

完成条件：人工可以从 evidence 确认实际执行了哪条命令、检查了哪些报告。

## T6：完整验证

- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm test`。
- [x] 运行 `pnpm build`。
- [x] 运行 `pnpm check`。
- [x] 完成 [validation-matrix.md](validation-matrix.md) 中的本地用例。
- [x] 真实 Issue #53 经过原有 Worker Session 和 ready gate，生成 passed 证据，并核对 PR #54 base/head；该样本有人工恢复。
- [x] 四项修复后的全新 Issue #63 无人工恢复验收完成：一次派工、两次 ready（首次拒绝后自主修正）、PR #64 待审查、原生来源通知已送达。

## 完成门槛

- [x] T1-T5 有代码 diff 和对应测试证据。
- [x] 四项修复后 `pnpm check`：72 个测试、类型检查和构建通过。
- [x] reverse 多目标单测通过；环境故障等未独立覆盖的场景见验证矩阵。
- [x] 普通 Worker 无 intent 的挂载测试、普通任务 prepare 早退测试通过；不外推全部普通任务场景。
- [x] 至少一个真实 Dubbo Issue 成功通过 ready gate（#53，含人工恢复）。
- [x] 没有新增 Super Agent 运行时组件。
- [x] 没有把模型根因文字当成交付证明。

四项最小修复：普通 prepare 早退、合同 workspace 绑定、KB 成功记录顺序、baseMap 按关键词文件命中排序，均先加入失败回归再修复。实施从当时 HEAD `91fa6cf` 开始，集成保留后续 `e798ef5` 的 Skill 修改，代码截至 `8746bef`。
