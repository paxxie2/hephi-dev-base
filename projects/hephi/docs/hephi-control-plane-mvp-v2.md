# HEPHI Super Agent 控制面 MVP v2

本文用于外部模型评审。目标是让带 `hephi/delivery` 标签的 Dubbo Issue 在 Super Agent 原有 Worker Session 中获得一个可选、低侵入的正确交付控制面。

## 1. 目标和边界

HEPHI 只负责四件事：

1. 为指定 Ticket 生成不可变交付合同；
2. 在 Worker 报告 `ready` 时执行确定性验证；
3. 保存验证证据；
4. 阻止未通过验证的 `ready`。

Super Agent 继续负责 Ticket、Assignment、Worker、Session、workspace、调度、恢复、重试和消息。

本版本不修改 Super Agent 源码，不创建第二个 Worker、Session、队列、Runner 或状态机，不增加超时重试，不做跨仓库抽象，不新增根因裁决 Agent，不建设任务进度账本、轨迹系统或通用静态分析框架。

当前只支持单一项目：`paxxie2/dubbo`，Recipe 只支持 Dubbo。

## 2. 当前需要解决的实际问题

当前 ready verifier 的确定性检查主体已经存在，但 Worker 可见流程有两处不一致：

- Skill 让 Worker 直接 grep KB，而 ready 门要求 `kb-query.json`；
- Skill 让 Worker 调用 `hephi_verify`，但该工具使用旧的 `dubboVerificationPlan`，其 reverse 不是权威的 base worktree reverse。

因此本版本先修正流程一致性，再增加最小的当前代码上下文，不把模型生成的根因文字加入 ready 判定。

## 3. 唯一流程

### 3.1 激活

只有带 `hephi/delivery` 标签的 Issue 才激活 HEPHI。

激活脚本按以下顺序执行：

1. 读取 Ticket、仓库、Issue、base ref 和 base commit；
2. 写入 `activation.intent`；
3. 写入带 `contractHash` 的 `activation.json`；
4. 任一步失败，Ticket 不进入普通的 HEPHI 流程。

没有 `activation.intent` 的普通 Worker 不挂 HEPHI gate，行为保持原样。

### 3.2 Worker 开始工作

Worker 只需要：

1. 调用 `hephi_get_contract`；
2. 调用一次 `hephi_kb_search`；
3. 根据返回的当前代码候选和历史参考实现最小修改；
4. 自行运行需要的探索性测试；
5. 调用原有 `orchestrator_report(state="ready")`。

第一版从 Skill 的必做流程中移除 `hephi_verify`。该工具的旧 reverse 语义与 ready 门不一致，继续要求 Worker 调用它只会增加误判和返工。

如果宿主无法按 Worker preset 隐藏该工具，保留它但把描述标成“诊断性验证，不代表可交付”，不得把它的结果作为交付依据。

### 3.3 ready 门

Worker 创建时由插件安装现有工具管线的 ready gate。普通工具调用不受影响，只有 `orchestrator_report(state="ready")` 进入 HEPHI 验证。

ready gate 执行一次权威验证：

1. 解析 Worker Session 的实际 checkout；
2. 校验 remote、base commit 和工作区干净；
3. 计算相对 base 的 patch fingerprint；
4. 校验改动路径在合同允许范围内；
5. 从当前 patch 中提取目标测试；
6. 在 patched workspace 执行 forward；
7. 在干净的 base worktree 中复制合同允许的测试文件并执行 reverse；
8. 解析每一步的独立 Surefire 报告；
9. 若合同要求 PR，校验 PR open、base ref 和 head SHA；
10. 再次计算 fingerprint，确认验证期间仓库没有变化；
11. 写入证据；只有全部通过才放行原始 `ready`。

## 4. 验证语义

### 4.1 forward

必须满足：

- 本次执行产生新的报告；
- 目标测试实际执行；
- 目标测试没有 skipped；
- 目标测试通过；
- 没有解析错误或报告缺失。

Maven 退出码不能单独作为通过条件。

### 4.2 reverse

reverse 运行在合同 `baseSha` 的干净 worktree 中，只复制 Recipe 明确允许的测试代码和测试资源。

必须满足：

- 目标测试在 base 上实际执行；
- 目标测试出现预期断言失败；
- 目标测试不是 skipped；
- 不是编译、依赖、环境或报告解析错误；
- 没有目标外失败或错误污染本次复现结果；
- 没有目标报告时为 `blocked`，不能按 Maven 非零退出码推断为复现。

reverse 的 Maven 非零退出码在目标断言失败且其他条件满足时可以映射为“预期复现成功”。

### 4.3 证据边界

验证器只能证明：

```text
base 上目标行为可复现；
patched workspace 上目标测试通过；
patch 在合同范围内；
验证期间仓库和 PR head 一致。
```

它不能证明 Worker 写出的完整根因叙述一定正确。

报告使用以下字段：

- `Root-cause hypothesis`：模型假设，允许不完整；
- `Observed evidence`：验证器实际观察到的命令、报告、fingerprint 和证据路径；
- `Observed behavior`：测试实际支持的行为变化；
- `Unknowns`：尚未证明的调用链或其他可能原因。

不增加 `root-cause-confirmed` ready 状态，不让 Worker 自写的因果解释成为放行条件。

## 5. KB 和 context pack

### 5.1 KB 的作用

KB 只提供历史参考，不是当前代码事实，也不是验证证据。

Skill 必须调用 `hephi_kb_search`，不能再要求 Worker 直接 grep KB。查询仍然写入现有 `kb-query.json`，ready 门只校验该查询与 Ticket、合同和仓库一致，不要求必须命中历史记录。

### 5.2 context pack

扩展现有 `hephi_kb_search` 的返回值，不新增工具、不新增状态文件：

```json
{
  "version": 1,
  "contractHash": "sha256:...",
  "baseSha": "...",
  "allowedPaths": ["dubbo-*/**", "pom.xml"],
  "verificationEntry": {
    "forward": "合同中的 testCommand",
    "reverse": "合同中的 reverseTestCommand"
  },
  "baseMap": {
    "candidateModules": [],
    "candidateFiles": [],
    "candidateTests": [],
    "unknowns": []
  },
  "historicalReferences": [],
  "referenceOnly": true
}
```

`baseMap` 必须从合同 `baseSha` 的 Git 树生成，不能从 patched workspace 或历史 KB 推断。

第一版只做：

- `git grep` 在 `baseSha` 上匹配 Issue 标题、模块名和少量错误词；
- 从命中路径推导候选模块、生产文件和测试文件；
- 设置固定结果上限；
- 无法确定的内容写入 `unknowns`。

第一版不做 Java 调用图、`callEntries`、全仓库文件内容索引、embedding 检索和持久化 context pack。

生成代码地图时使用与 verifier 相同的 Worker Session checkout 解析规则，并确认 remote/base 一致，避免 KB 工具和 ready gate 查看不同仓库。

## 6. 修改范围

### 必须修改

1. `skills/hephi-superagent-control/SKILL.md`
   - 改为调用 `hephi_kb_search`；
   - 删除 `hephi_verify` 的必做步骤；
   - 明确 ready gate 是唯一交付验证来源；
   - 把根因表述改成 hypothesis / observed evidence / observed behavior / unknowns。

2. `src/verification/runner.ts`
   - 补 reverse 的目标外失败、错误和缺失报告判定；
   - 不改变 forward、PR、delivery 或 Super Agent 运行时。

3. `src/kb/index.ts` 和 `src/tools.ts`
   - 在现有 `hephi_kb_search` 返回值中增加 `baseMap/context pack`；
   - 继续写入现有 `kb-query.json`；
   - 不增加新的工具或状态机。

### 明确不修改

- Super Agent 源码；
- Worker/Session/Assignment/队列/调度；
- Ticket 状态机；
- ready gate 的挂载机制；
- Delivery 和 GitHub PR 幂等链；
- 超时、重试、独立裁决、任务账本、轨迹系统；
- 跨仓库和通用 Recipe。

## 7. 验收用例

必须通过以下用例后再做新的 Dubbo Issue 端到端验证：

1. 无 `activation.intent` 的普通 Worker 不受 HEPHI 影响；
2. 有 intent 但合同缺失、损坏或 hash 不一致时，ready 被拒绝；
3. Worker 按 Skill 调用 `hephi_kb_search` 后生成合法 `kb-query.json`；
4. KB 无历史命中时仍可继续，只要查询记录合法；
5. forward 没有新报告、目标测试 skipped 或报告无法解析时不能通过；
6. reverse 在 base 上目标断言失败且无其他错误时通过；
7. reverse 没有目标报告、只有编译错误、只有目标外失败或包含目标外错误时不能通过；
8. 验证期间 patch、HEAD 或工作区变化时不能通过；
9. 带 PR 要求的合同中，PR 缺失、base 不同或 head 不同不能通过；
10. 真实 Dubbo Issue 能从 Ticket 进入 Worker、经过 HEPHI ready gate 并生成一份 `result: passed` 证据。

## 8. 评审需要重点回答的问题

外部评审请重点检查：

1. 移除 `hephi_verify` 的必做步骤是否会削弱交付闭环；
2. reverse 对目标外失败和错误的处理是否符合 Dubbo 测试语义；
3. `baseMap` 的候选文件规则和上限是否足够简单且不会误导 Worker；
4. `kb-query.json` 作为“已查询”证明是否足够，还是需要额外保存查询结果；
5. 以上方案是否仍然保持 HEPHI 为控制面，而不是重新形成一套运行时。
