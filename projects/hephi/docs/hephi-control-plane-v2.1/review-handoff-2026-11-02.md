# HEPHI 四项最小修复：外部模型评审交接

本材料冻结评审对象，供独立 code review；不是新的架构方案，也不是要求继续实施。整理日期：2026-11-02（Asia/Shanghai）。

## 1. 评审对象与入口

- 插件仓库：`/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin`
- 独立评审 worktree：`/Users/USER/Documents/ChatGPT/现代软件开发/hephi-minimal-fixes`
- 实施比较范围：`e798ef5..f809e8b`。其中代码止于 `8746bef`，`f809e8b` 只更新验证文档。本交接文档的后续提交不改变代码评审终点。
- `e798ef5` 已包含最新长任务 Skill 修改，不使用更旧的 `b700e7e` 作为本轮基线。
- Super Agent 仓库：`/Users/USER/Documents/deepseek-harness/default-workspace/deepseek-super-agent-research`
- Super Agent 本次运行版本：`394a6e191fbda61fb5a5c0d03582f4ff49d92a5d`，本轮未修改。

本地评审命令（只读）：

```sh
git -C '/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin' log --reverse --oneline e798ef5..f809e8b
git -C '/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin' diff --stat e798ef5..f809e8b
git -C '/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin' diff e798ef5..f809e8b -- scripts src tests
```

压缩包中的 `source-before/`、`source-after/` 是上述两个提交的完整 tracked 文件快照，包含源码、测试、锁文件、Skill 和文档；不含 node_modules、构建产物、账号配置或完整会话。`changes/` 提供合并 diff 和逐提交 patch。源码快照没有 `.git`。更正：原 `f809e8b` 快照的 runner 测试依赖宿主仓库 HEAD/HEAD^，不能直接复现完整检查；此前声称这些测试均会自行创建临时仓库不准确。后续测试修复改为自包含的两提交临时 Git fixture，不改变原评审终点或运行时代码。

## 2. 范围与提交

赫菲仍是原生 Worker Session 的可选 ready 门，只有启用任务经过控制面。本轮不增加 Worker、队列、运行时、状态机，不修改 Super Agent 源码，不重构旧 Delivery 链，不加入超时重试。

| 提交 | 内容 | 核心文件 |
| --- | --- | --- |
| `6c4be93` | 先添加四组失败回归 | prepare、workspace、KB tests |
| `b50e60e` | 非 GitHub 任务在读取必填仓库变量前早退 | `scripts/prepare-dubbo.sh` |
| `26914a6` | realpath 精确绑定合同 checkout | `src/control/workspace.ts`、`dubbo-verifier.ts` |
| `db691a3` | baseMap 完成后才原子写入 KB success | `src/kb/index.ts` |
| `8746bef` | 按文件不同关键词命中数排名后截断 | `src/kb/index.ts` |
| `f809e8b` | 记录验证、无人干预样本与限制 | 4 个现有验证文档 |

净变更为 4 个执行文件、4 个测试文件、4 个文档文件，310 行增加 / 103 行删除。唯一修改的旧成功预期是“空合同目录 + 外部 clone”，现在应拒绝；请审查这是否符合新的工作区契约。

长任务 Skill 在基线和终点的 SHA-256 均为 `1395a8fac6195aaa92e4bc221ebacecd59d8d352319e3c473940df746251b2f1`。

## 3. 请优先审查的行为

| 项目 | 约定行为 | 重点核查 |
| --- | --- | --- |
| prepare | 无 GitHub 编号成功早退且无副作用；有编号缺 repository 失败 | 是否改变带标签任务的激活条件或隐藏错误 |
| workspace | 合同目录自身 Git root，或其中唯一直属 checkout；Session cwd 不能引入外部仓库 | realpath/root 精确关系、父仓库、符号链接逃逸、多个 checkout、Session 位于 checkout 子目录 |
| KB success | baseMap 失败不得新写或覆盖成功记录；同合同此前成功记录允许保留 | 是否把“查过”和“看懂/采用结果”混为一谈；合同绑定是否正确 |
| baseMap | 最多 8 个查询词；逐词 git grep --name-only；按文件不同词命中数排名，再截取 60 项 | 重复行不加权、排序稳定、baseSha 限定、无命中和真正错误分开、完整模块路径、truncated 正确 |

baseMap 只是检索线索，不是根因裁决。请检查 CamelCase/路径词优先及过滤规则是否有明显遗漏，特别是能否兼顾原始 #53 查询，而不是只适配构造的单测。

本次未修改的相关控制面也随源码提供，可按调用关系检查：`src/tools.ts`、`src/control/worker-mount.ts`、`ready-gate.ts`、`activation.ts`、`src/verification/runner.ts`、`parser.ts`、`scripts/run-dubbo-tests.sh`。发现旧问题请单列，避免误归因于本轮 diff。

## 4. 测试与 #53 检索重放

- 实施记录：修复前四组回归 10 失败 / 10 通过；修复后 `pnpm check` 的类型检查、16 文件 / 72 测试、构建通过。
- 本次整理材料没有重新运行测试；以上是上一轮实施结果，包内没有把重写说明伪装成原始测试输出。评审者可在独立副本运行 `pnpm install --frozen-lockfile` 和 `pnpm check`（Node >=22.19.0，pnpm 11.7.0）。
- #53 重放使用原始 base `7ca3e29f4b48544b24fdfff6ccb9bc1b81132d44`，原始查询如下：

```text
Triple REST cuts mapping and filter patterns at '?' dubbo-rpc-triple PathUtils normalize PathCondition RadixTree question mark truncation
```

记录结果：RadixTree 第 4、PathCondition 第 5、PathUtils 第 25、RadixTreeTest 第 26，模块 `dubbo-rpc/dubbo-rpc-triple` 存在；60 项、truncated=true、715ms。重放用了临时 stateDir，没有覆盖原 #53 KB 记录；原始重放输出未另存为独立证据文件。本结果只能证明指定查询的检索验收。

详细覆盖/未覆盖项看 `validation-matrix.md`。例如 forward skipped、reverse 目标外 error、PR base 不匹配均未各自具备独立回归用例，不能把 72 测试概括为所有失败矩阵完全覆盖。

## 5. 真实原生链路：#63 → #64

- 来源：[paxxie2/dubbo#63](https://github.com/paxxie2/dubbo/issues/63)，复制 [apache/dubbo#16432](https://github.com/apache/dubbo/issues/16432)。
- 产物：[PR #64](https://github.com/paxxie2/dubbo/pull/64)，[来源最终回复](https://github.com/paxxie2/dubbo/issues/63#issuecomment-6562660549)。
- Ticket：`a13a31eba85394fd66a564b32d4988cb`；唯一 Assignment：`0714273fd5f2604d3fea9009ac8859a1`。
- Worker：`worker-a13a31eba85394fd66a564b32d4988cb`；trigger：`9989a35d6f8ef0b3cf5750380bf7800b`。
- 固定 base：`7ca3e29f4b48544b24fdfff6ccb9bc1b81132d44`；最终 head：`c41d01bba05d93321cc55662da2cc1140d9e6783`。
- GitHub Source → prepare → 原生 Worker → HEPHI gate → 原始 report → 来源回复。新 Issue 创建前已加载新版，运行期间没有人工续派、重载插件、代写业务补丁、代建 PR 或手动 verifier 替代验收。
- 第一次 ready：seq 568/569，reverse 的直接异常被 Surefire 记为 error，gate 拒绝。Worker 自行使用 `assertDoesNotThrow` 表达合法输入不得异常，保留 round-trip 断言，更新同一 PR。
- 第二次 ready：seq 744/745，正向通过、反向出现 1 个 assertion failure / 0 errors / 0 skipped；原始工具返回 `reported:true`。约 9 分 42 秒完成首次派工。
- Worker 参考过上游 PR #16435，且 KB 有相关历史知识；这是执行链路验收，不是盲测、独立发现能力或陌生问题成功率测量。

压缩包 `evidence/issue-63/` 保留原样复制的 activation、intent、KB 记录、首次拒绝和最终通过 JSON。`ready-events.jsonl` 是原始会话四条 ready 事件的逐行节选；调用里的 summary 是模型陈述，不作为独立验证事实。完整会话定位及 SHA 在 provenance 中。节选本身不足以单独证明整段执行没有人工输入，需结合完整 Session/Ticket 核查。

最终通过证据 SHA-256：`45cdb92d1a9701c7b50b04e27e6ea44e62a93949f358261602426087bb083611`。

`business-diff.patch` 提供 Worker 的 2 文件 / 25 additions / 1 deletion 补丁，供独立判断：改为 assertDoesNotThrow 是否保留了真实需求、测试是否只为了迎合门禁、生产改动是否有兼容性遗漏。不要仅凭 gate=passed 就接受业务正确性。

## 6. 已知边界，必须保留在评审结论里

1. #53 是带人工恢复的历史链路；#63 才是本轮无人干预样本。一个样本不能证明稳定性提升或维护成本下降。
2. 最终门禁是聚焦测试。正向 21 通过的数量来自当时 XML 观察；持久化 evidence 的 forward 仅有状态和报告 ID，不含聚合数量。reverse 的 21/1/0/0 已持久化；临时 reverse XML 已清理，不能补称保留了完整报告。
3. 全 dubbo-common 自测 1179 tests / 1 failure / 10 skipped；同一个 NetUtilsTest 失败在干净 base 重现。包内提供原日志带行号节选及原日志 hash。基线也失败不等于已经严格证明与补丁无关，更不等于整模块全绿。
4. 验收时 PR OPEN、未合并；checks/reviews 为空。原生 `CI passed 0/0` 事件不是 CI 执行证据。整理材料没有重新联网更新 PR 状态。
5. 本轮没有改 Super Agent；现有部署此前已有 `src/app/sessions.ts` 的 HEPHI 工具白名单定制，不能宣称整个部署零源码侵入。包内 `host-context/` 给出该版本的 sessions/executor 源码供核对。
6. 合同允许 `dubbo-*/**` 和 `pom.xml`，较宽；路径门不能证明全局最小改动或完全无重构。当前 intent/证据也不构成抵抗同权限恶意 Worker 的隔离边界。
7. 现有文档中更早的设计、回退基线属于历史背景；本轮实施评审基线一律以上述 `e798ef5..f809e8b` 为准，不据旧文档执行回滚。

## 7. 可直接转交给评审模型的要求

请独立审查 `e798ef5..f809e8b` 的四项修复与 #63 原生执行证据。先读 diff，再沿调用关系读源码和测试，最后核对 evidence、原始 ready 事件及业务补丁；不要默认作者结论成立。

输出：

1. 可复现问题，按 P0/P1/P2 排序；每项给文件/行号、触发条件、影响、最小修法和必要测试。
2. 区分本轮新增/未修好问题、继承问题、证据不足；无证据的猜测明确标注。
3. 单独判断 workspace 绑定、KB success、baseMap 排名是否满足约定；#63 是否只能支持“链路跑通”，还有哪些交付正确性缺口。
4. 判断是否存在过度复杂化、无关改动或测试迁就实现；提出最小修复，不新增运行时/架构/通用框架。
5. 给出接受、带条件接受或拒绝的结论，并明确必要条件。只做 review，不操作在线服务、发消息、重新触发任务、合并 PR 或修改业务代码。

完整过程说明见同目录 `native-e2e-2026-11-02.md`；压缩包 `SHA256SUMS` 用于检查材料完整性，不是第三方真实性背书。

## 8. 独立评审后的 P2 修正

runner 的 7 个测试已改用临时两提交 Git fixture，并在 afterAll 清理；生产代码未改。2026-11-02 在不包含 .git 的临时源码副本中执行 pnpm check：16 文件 / 72 测试、typecheck、build 全部通过。副本复用了本机 node_modules（vitest 实际版本 4.1.12），未另做干净依赖安装，不能将此描述为锁文件从零安装验收。#53 原始重放输出未补存的问题仍按第 4 节披露。
