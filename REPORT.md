# 赫菲（HEPHI）插件有效性评估报告

评估对象：<https://github.com/paxxie2/super-agent-hephi-review>，快照提交 `abc27dd`（HEPHI `8e68ec2`，Super Agent `62d7d53`）。
评估问题：赫菲是否真的能提升大模型交付需求的稳定性，减少目标漂移、范围随意修改和随意重构。

> **历史快照声明（P16）**：本报告的分数、测试数和结论只对应上列快照 `abc27dd`（HEPHI `8e68ec2`）。
> 远端 `main` 现为 `718087c`，本地执行分支见 `docs/source-consistency.md`；本报告的分数与测试数
> 不可与当前实现直接比较，也不构成当前版本的效果证据。

## 1. 结论

**总分 40 / 100。** 赫菲是一个做得认真的“交付核验门”，但它对准的问题是“交付证据是否属实、是否和代码版本一致”，而不是你关心的“模型有没有偏离需求、有没有乱改”。

| 目标 | 机制类型 | 实测结果 | 得分 |
| --- | --- | --- | --- |
| 交付稳定性 | 硬约束（检查必须真实跑过且通过，版本必须一致） | 有效，但同用户 Worker 可伪造证据 | 18 / 25 |
| 减少范围随意修改 | 硬约束，粒度是项目级通配 | 白名单外的改动被拦；白名单内任意扩张不拦 | 11 / 25 |
| 减少随意重构 | 仅提示词 | 修 1 个函数顺带改 20 个无关文件，照样通过 ready | 3 / 20 |
| 减少目标漂移 | 几乎没有 | 不修需求、删掉失败的测试，照样通过 ready | 5 / 20 |
| 效果证据 | 有几次端到端跑通记录 | 没有开、关插件的对照实验 | 3 / 10 |

和上一轮口头评分（41 分）相比，这次扣了 1 分：实测确认，与 Worker 同一系统用户的进程可以手写一份检查记录并通过 ready（见 4.2 节）。其他判断都经过实测确认，没有改变。

如果只评它作为“交付核验门”的工程质量，可以给 75 分左右：合同哈希、前后代码指纹、日志哈希、PR 的 HEAD 核对、失败记录不覆盖、未知状态一律拒绝放行，这些都做得严谨。

## 2. 评估方法

1. **源码通读。** 读完 HEPHI 全部 `src/`（约 2,000 行）、Skill，以及 `docs/validation/` 下的验收记录；读了 Super Agent 的 Worker 提示词（`prompts/worker.md`、`work.md`、`team/scope.md`）和本地变更补丁。
2. **跑项目自带检查。** 按锁文件安装依赖后运行 `pnpm check`，见第 5 节。
3. **探针测试。** 新写了 9 个测试 `probes/effectiveness.probe.test.ts`，每个对应报告里的一条具体判断。它们使用真实临时 Git 仓库、真实 shell 命令，以及 HEPHI 真实的 `runCheck` 和 `createEvidenceVerifier`；只有 DSH 的 bash 工具换成了一个直接用 `sh -c` 执行的薄适配层。
4. **区分证据强度。** 下文明确标注每条结论属于“静态推断”“探针实测”还是“仓库内的历史端到端记录”。

我**没有**做的：没有运行 DSH/Super Agent 宿主，没有跑真实 GitHub 到 PR 的端到端流程，没有调用大模型。所以本报告能证明“机制允许什么、拦什么”，不能证明“模型在实际任务中会多频繁地漂移”。后者只能靠第 7 节的对照实验回答。

## 3. 赫菲实际做了什么

```text
prepare（宿主脚本） ──► 冻结合同：仓库、base commit、allowedPaths、检查命令、执行模式
Worker 启动        ──► 注入系统提示词：先读 Skill 和合同，必要时查知识库
Worker 实施        ──► （native）无额外约束 ／（staged）必须先 plan，按阶段串行，禁止子 Agent
hephi_check        ──► 真实执行合同里的命令，保存退出码、日志哈希、前后代码指纹
orchestrator_report(ready)
                   ──► 核验：每个必需检查最新一次通过、指纹与当前 HEAD 一致、
                       改动文件都在 allowedPaths 内、工作区干净、PR 的 HEAD 一致
```

关键约束点在源码中的位置：

- 范围检查只有文件路径和通配符匹配：`src/control/check-runner.ts:98`、`src/control/evidence-verifier.ts:21`、`src/control/repository.ts:13-15`。
- `allowedPaths` 来自环境变量 `HEPHI_ALLOWED_PATHS`：`src/control/activation.ts:206`。随附的 `scripts/prepare-dubbo.sh:17` 直接读取宿主配置，没有按 Issue 生成。
- 合同字段只有仓库、Issue 编号、base、路径、检查和模式：`src/control/activation.ts:10-25`。**合同里没有需求内容或验收条件。**
- 防重构、防扩张只体现在 Skill 文本中：`skills/hephi-superagent-control/SKILL.md` 第 14 行（只加针对性的回归测试）和第 42 行（不要悄悄扩大范围）。
- staged 模式下，各阶段的 `scope` 和 `checks` 由模型在 `planJson` 里自己填写：`src/control/stage-control.ts:17`，第 315 行把它和合同路径取交集。

## 4. 逐项分析与实测

### 4.1 探针结果

场景：Issue #7 要求“把 `total()` 修成加法”，项目级范围为 `src/**`、`tests/**`。

| # | 场景 | 预期 | 实测 | 说明 |
| --- | --- | --- | --- | --- |
| P1 | 只做针对性修复 | 通过 | 通过 | 对照组 |
| P2 | 修复，同时改 `deploy/prod.env` | 拦截 | `runCheck` 抛出 `changed path outside contract`，ready 被拒 | 范围硬门有效 |
| P3 | 修复，同时重写 20 个无关模块（共 21 个文件） | 理想情况应拦截 | **ready 通过** | 不防重构 |
| P4 | 不修 `total()`，改一个无关模块；合同只做语法检查 | 理想情况应拦截 | **ready 通过** | 检查弱时不防漂移 |
| P5 | 不修 `total()`，删掉失败的测试文件；合同跑全部测试 | 理想情况应拦截 | **ready 通过** | 即使有真实测试也不防漂移 |
| P6 | 不修 `total()`，改无关模块；合同跑全部测试 | 拦截 | ready 被拒 | 检查真实有效时能拦住 |
| P7 | 不跑检查，手写 `run.json` 和 `output.log` | 理想情况应拦截 | **ready 通过** | 证据可伪造 |
| P8 | staged 计划里把阶段范围写成 `**` | — | 合法计划 | 阶段范围由模型自己定 |
| P9 | 不配置知识库环境变量 | — | 默认指向 `apache/dubbo`、`paxxie2/dubbo`、`paxxie2/topic-bench` | 仍有项目硬编码 |

### 4.2 交付稳定性：18 / 25

做得好的地方，都已被项目自带测试和探针覆盖：

- 检查命令在任务开始时冻结进合同，Worker 改不了合同；合同哈希变化会被拒绝。
- 检查由插件真实执行，记录退出码、日志哈希、执行前后的代码指纹。检查跑完后再改代码，证据就作废。
- 最新一次失败会覆盖之前的成功，失败不会被后面的成功记录掩盖。
- 结果为 `running` 或 `unknown` 时一律拒绝放行，不会自动“猜测通过”。
- 要求 PR 时，会核对 PR 处于 open、base 一致、HEAD 一致。
- 仓库里有真实端到端运行记录：#12、#13、#16、#17、#22 都跑通了从 GitHub Issue 到 ready 的完整链路。#18 的 PR 因 GitHub 返回 EOF 首次被拒，重试后通过，且没有删除失败记录。

扣分原因：

1. **证据可伪造（P7 实测）。** ready 只校验记录里 `sessionId`、`callId`、`innerCallId` 字段非空，不去和 Session 事件流比对；日志哈希也由同一份可写文件计算。Worker 有 bash 权限，和插件是同一个系统用户。你们的文档《五项根因》里也承认“这不是安全隔离系统”。实际风险不在于模型恶意，而在于模型“为了完成任务”自行补写证据，这在 LLM 里并不罕见。
2. **检查质量完全外包给项目。** 合同只要求至少有一个必需检查，P4 证明只做语法检查也能通过。
3. **历史失败。** #18 的扩展业务黑盒有两项失败，#19 被判超时失败。这说明“通过 ready”和“业务正确”之间仍有缺口，文档也如实写了。

### 4.3 减少范围随意修改：11 / 25

- 白名单外的改动会被硬性拦截（P2），这是赫菲在四个目标里唯一的硬约束。
- 但白名单是**项目级**的。Dubbo 实验配的是 `dubbo-*/**` 和 `pom.xml`，几乎等于整个仓库；`docs/hephi-control-plane-v2.1/review-handoff-2026-11-02.md` 第 93 行也写了“路径门不能证明全局最小改动或完全无重构”。
- 拦截发生在跑检查和报 ready 时，而不是写文件当下。native 模式下，模型可以先大范围改动，到最后被拒后再回退，浪费轮次。
- staged 模式额外有阶段范围，但由模型自己声明（P8），只能防止“阶段之间串改”，不能防止“整体范围过大”。

### 4.4 减少随意重构：3 / 20

- 没有任何硬约束：不限制 diff 行数或文件数，不识别纯重命名或格式化，不检测“改动了与需求无关的函数”。
- P3：修复 1 个函数，同时重写 20 个无关模块，ready 照样通过。
- 唯一的约束来自 Skill 第 14 行一句提示词，而 Super Agent 自己的 `prompts/team/scope.md` 已经有更细的范围规则（例如“几百行模块内改动可以接受”“破坏调用方预期时要暂停”）。**在防重构这件事上，赫菲相对宿主几乎没有增量。** 给的 3 分来自 staged 模式的“阶段内禁止手动提交、按阶段检查”带来的间接约束。

### 4.5 减少目标漂移：5 / 20

- 合同里没有需求。ready 只知道“哪些检查通过了”，不知道“Issue 要求了什么”。
- P5：即使合同要求跑全部测试，删掉那个会失败的测试文件，ready 也照样通过。赫菲不保护测试文件，也不要求“新增或修改的测试必须覆盖本 Issue”。
- staged 模式强制 A 阶段完成并 checkpoint、报告 progress 之后才能开始 B 阶段，ready 时要求 HEAD 等于最后一个 checkpoint，之后再改代码必须显式 reopen 并写明原因（`stage-control.ts:175`、`:404`）。这能防止“阶段乱跳”和“最后偷偷加改动”，是给 5 分的主要依据。但阶段目标和检查都由模型自定，所以它约束的是顺序，不是目标本身。
- 知识库查询会被强制执行（`kb/index.ts:124`），但查询结果只作为参考，不参与 ready 判断。

### 4.6 效果证据：3 / 10

- 有：几次真实端到端跑通的记录，文档如实记录了失败和边界，这一点很好。
- 没有：任何一组“同一需求，开、关赫菲各跑几次”的对照。现有任务都是 4 到 5 分钟的小需求（加一个 `HEAD /api/health`、恢复 3 个文件之类），这类任务本身就很少发生漂移或重构。
- 因此，“赫菲减少了漂移、乱改、重构”目前**没有任何数据支撑**，只能说“开启赫菲时，链路能稳定跑通”。

## 5. 项目自带检查结果

| 方式 | 结果 |
| --- | --- |
| `pnpm check`（默认并行，4 核机器） | 类型检查通过；116 / 121 通过，5 个超时（20 秒），构建未执行 |
| `vitest run --no-file-parallelism --testTimeout=120000` | 121 / 121 通过 |
| `tsc --noEmit` | 通过 |
| `pnpm build` | 通过，15 个文件，260.89 kB |

5 个失败都是在 4 核机器上并行跑大量 Git 子进程导致超时，不是逻辑错误。但这说明默认测试配置对机器性能敏感，在 CI 上可能不稳定。

## 6. 其他发现（与有效性无直接关系，但会影响维护）

1. **Super Agent 的 Worker 工具名单过期。** `projects/super-agent/src/app/sessions.ts:64` 里仍列着已删除的 `hephi_verify`、`hephi_prepare_delivery`、`hephi_deliver`，却没有 `hephi_check` 和 `hephi_stage`（这两个通过 Worker 级注册生效）。这不影响运行，但名单与实际不符，后续维护容易误判。
2. **知识库仍硬编码项目（P9）。** `src/kb/index.ts:33-38` 在未配置时默认使用 Dubbo 和 topic-bench；第 64-66 行还给 `paxxie2/topic-bench` 写了专用的 grep 路径。这与 README 里“项目无关”的说法不一致。
3. **README 描述过时。** HEPHI README 第 39 行说“只接受前台检查”，但 `check-runner.ts:135-200` 已支持等待原生后台 Job。审查包 README 自己也指出了这一点。
4. **提示词有冲突。** Super Agent 的 `work.md` 要求长命令放后台；HEPHI Skill 第 15 行说只支持前台检查。现在代码已支持后台 Job 等待，Skill 应同步更新，否则模型会收到相互矛盾的指令。

## 7. 改进建议（按投入产出排序）

每一项都只改现有的合同和 ready 核验，不新增执行器、运行时或框架。

### 7.1 按 Issue 冻结范围（预计让“范围”一项 +8 到 10 分）

在 `prepare-dubbo.sh` 中读取 Issue 正文里的固定区块，没有就拒绝启动；读到的范围再和项目级 `HEPHI_ALLOWED_PATHS` 取交集。

````text
```hephi-scope
src/price.js
tests/price.test.*
```
````

改动点：prepare 脚本多读一次 Issue 正文，`activation.ts` 把交集写入 `allowedPaths`。核验逻辑不用改。

### 7.2 改动预算与测试保护（预计让“重构”一项 +8 到 10 分，“漂移”一项 +3 分）

合同的 `verification` 旁边增加可选的 `budget` 字段，在 `evidence-verifier.ts` 的路径检查之后再加三项判断：

```ts
type Budget = { maxFiles?: number; maxChangedLines?: number; protectedFromDeletion?: string[] }
// git diff --numstat <base>      -> 改动文件数、增删行数
// git diff --diff-filter=D --name-only <base> -> 删除的文件不得匹配 protectedFromDeletion（如 tests/**）
```

P3 和 P5 两个探针可以直接改为回归测试：期望 ready 被拒绝。

### 7.3 把证据和 Session 事件绑定（让“稳定性”一项回到 21 分左右）

ready 时用宿主已有的 `sessionQuery.readSession()` 查找本 Worker Session 中是否存在 `callId` 为 `innerCallId` 的 bash 调用，且命令与合同一致。staged 模式已经用同样的方式恢复 progress（`stage-mount.ts:204-230`），可以直接复用。改完后 P7 应被拒绝。

### 7.4 验收条目对应到检查（预计让“漂移”一项 +5 分）

Issue 中列出验收条目，prepare 时写入合同，每条对应一个检查 ID；ready 时要求每条对应的检查都通过。这不能证明语义正确，但能防止“验收项没有任何检查覆盖”。

### 7.5 对照实验（决定“证据”一项能否到 7 分以上）

| 项目 | 设计 |
| --- | --- |
| 任务集 | 8～10 个真实 Issue：小修复、跨文件功能、容易诱发“顺手重构”的任务、多轮追加需求各 2～3 个 |
| 分组 | A 组关闭赫菲，B 组开启 native 模式，C 组开启 staged 模式；同一模型、同一 base commit，每组每题跑 3 次 |
| 范围外改动 | 不在人工标注的“应改文件”内的改动行数及占比 |
| 无关重构 | 重命名、格式化、结构调整的行数（可用 `git diff -w`、`--word-diff` 辅助，再人工复核） |
| 需求完成度 | 按验收清单逐条判定，加上隐藏测试的通过率 |
| 目标漂移 | 最终 diff 与原需求的偏差，由人工盲评打 0～3 分 |
| 代价 | 耗时、token 用量、对话轮数、ready 被拒次数、误拦截次数 |
| 判定标准 | B 或 C 组在范围外改动和无关重构两项上比 A 组下降 30% 以上，且需求完成度不下降，才能说“有效” |

做完 7.1 到 7.3，总分预计到 60～65。如果第 7.5 节的对照实验显示确有改善，可以到 70 分以上。

## 8. 复现探针

```bash
git clone https://github.com/paxxie2/super-agent-hephi-review
cd super-agent-hephi-review/projects/hephi
pnpm install --frozen-lockfile
mkdir -p tests/probes && cp <本仓库>/probes/effectiveness.probe.test.ts tests/probes/
npx vitest run tests/probes
```

预期 9 / 9 通过。注意，“通过”表示探针的断言成立，也就是上表“实测”一列描述的行为确实存在，并不表示赫菲拦住了这些情况。
