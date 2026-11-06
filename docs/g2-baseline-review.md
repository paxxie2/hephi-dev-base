# G2 基线审查记录（2026-11-07，由 Agent 代办）

> **身份与限制**：本审查由 Agent 按用户 2026-11-07 的授权代办（用户指示“代我审阅，代替人工操作”），
> 不是人类“非原实现者”审查。仓库账号为单一 `paxxie2`，无法产生独立的人类审查签名；
> c547 等价修复（`b8415e9`）由同一 Agent 实现，本文不构成对该提交的独立复核。两条限制必须在正式验收时补人。

## 1. 八项原验收要求（Issue #1「必须验收」）

| # | 原要求 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 行为保持型改动不因 base 也通过而被错误拒绝 | 通过 | `tests/probes/effectiveness.test.ts`「a behaviour-preserving rewrite is accepted」；合同不再默认要求 base 失败（`check-runner.ts` 无 base 双 worktree 默认路径） |
| 2 | 缺模块/编译/依赖错误不能冒充目标业务断言复现 | 通过 | 同文件「records a real foreground project command failure and retry without XML」；非零退出一律 blocked（check-runner 退出码判定） |
| 3 | 非 bash 错误事件、错误 Session、只有调用无可核实终态不能满足证据绑定 | 通过 | `evidence-verifier.ts` `sessionBindingProblem`：要求同一 Session、唯一 `tool/call`+`tool/result`、`bash`、`isError===false`、退出码一致；`tests/control/evidence-verifier.test.ts` 与 `tests/probes/issue1-regression.test.ts` 覆盖 |
| 4 | cwd 不存在等未启动错误可修正后重试，失败历史保留 | 通过 | 检查记录 `blocked/unknown` 不删除历史；`tests/control/evidence-verifier.test.ts`「blocks nonzero exits and preserves failures across retries」 |
| 5 | 确实可能仍运行的执行不能被误放行或提前破坏工作区 | 通过 | check-runner 对 promoted Job 等待/确认终止；「waits on a promoted Job」「kills and confirms a Job that outlives the contract deadline」「stays unknown when termination cannot be confirmed」 |
| 6 | 根目录/嵌套/绝对/中文/空格及越界路径按实际工作区正确处理 | 通过 | 「uses standard recursive globs for root, nested, Chinese and spaced paths」；`workspace.ts`/`discipline.ts` 越界判定；`tests/control/workspace.test.ts` |
| 7 | 普通任务不被新增冻结测试或预算门槛无故阻止；已明确必需验收仍不能跳过 | 通过 | 「an ordinary task without a budget is not limited by one」；缺失必需检查仍拒绝（「requires each frozen check…」） |
| 8 | 原有合同、HEAD/patch、范围和 PR 一致性保护没有被取消 | 通过 | `evidence-verifier.ts`：仓库/base/clean、before/after 指纹、PR state/base/head 校验；「rejects changed source, contract and PR head」 |

## 2. c547 等价修复（`b8415e9`）

- 内容：ready 时用合同冻结的检查定义比对检查记录的 `argv` 与 `cwd`（真实路径），与 Session 绑定开关无关。
- 负例：伪造 `argv`、伪造 `cwd` 均被拒绝；`tests/probes/effectiveness.test.ts` 的伪造记录夹具同步通过。
- **限制**：实现者与审查者为同一 Agent，未取得独立复核。原提交 `c547dc1` 已不可获取（旧目录删除、远端无此提交）。

## 3. 基线构成与结论

- 主干候选：`main`（合并 PR #7 后的 merge commit）。远端 `main` 在审查前为 `718087c`；本次审查基于该 SHA + PR #7 全部提交。
- 本地 `pnpm check`：17 文件 / 175 tests 全过 + 构建成功（审查时点）。
- 按用户决定不使用 GitHub Actions，故无 CI 检查；P1 不实施。
- 结论：八项要求在本分支的实现与本地测试范围内**均通过**；但“非原实现者人类审查”与“真实宿主机/端到端证据”仍未取得，标签只表示代码基线经本记录审查，不代表效果或生产验收。
- 基线标签：`hephi-baseline-1` 指向本次合并后的 main 提交；若已存在同名异 SHA 标签，不得覆盖。
