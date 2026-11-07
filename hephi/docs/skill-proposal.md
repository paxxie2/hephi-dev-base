# Skill 修改提议清单（C4.1 / C4.3 / C4.4 / C4.7）

状态：**提议（未实现）· 本轮不修改任何 Skill**。本文件只是给负责人的审批材料，
不是已生效规则，也不代表 Worker 已按这些做法运行。

- 目标文件：`hephi/skills/hephi-superagent-control/SKILL.md`（当前未修改，保持仓库快照）。
- 审批编号：**D12（待负责人批准）**；批准后需单独 PR 应用并重新做 dev-set 验证，不得混入本轮代码改动。
- 关联的既有提议：`hephi/docs/skill-change-proposal.md`（P16 的 acceptance-check 措辞 diff）仍然有效、
  本文件不覆盖它；两项都批准后合并为一次 Skill 改动，避免冲突。
- 统一规则（ROADMAP §4.10）：C4 各项**均不拦截**（Skill 是提示，不是 gate）；每项必须在开发集上单独验证，
  测量收益/误拦/额外成本；若收益不明显或误拦超标，降为提示或放弃。Skill 修改不能伪造插件门禁。

## 0. 汇总表

| ID | 对应 | 建议内容 | 形式 | 是否拦截 | 本轮状态 |
| --- | --- | --- | --- | --- | --- |
| SR-1 | C4.1 | 修 bug 类任务先写/跑失败复现；重构/纯新增任务明确跳过 | Skill 提示 | 否 | 提议（D12） |
| SR-2 | C4.3 | 提交前自查 diff（无关改动/测试削弱/范围） | Skill 提示 | 否 | 提议（D12） |
| SR-3 | C4.4 | 按验收项边改边测、小步提交 | Skill 提示 | 否 | 提议（D12） |
| SR-4 | C4.7 | Issue 拆小与任务卡粒度提示 | Skill/Issue 模板提示 | 否 | 提议（D12） |
| SR-5 | C2 澄清 | 澄清 Skill 中 "coverage" 指验收证据覆盖，不是代码覆盖率 | Skill 措辞 | 否 | 提议（D12） |

> 口径说明：ROADMAP §4.10 的 C4.1 定义是“先复现再修”（仅缺陷修复类）；本清单按该定义写 SR-1。
> 若负责人把“规划/分解”也纳入 C4.1，请参考 SR-4（C4.7 拆小）与 C4.2（`hephi_plan`，插件，不在 Skill 提议范围）。
>
> 与实现层的关系：C4.2（`hephi_plan`）、C4.5（重试上限）、C4.9（`hephi stats`）、C5（`hephi lint-task`）
> 属于插件/CLI 实现，不在本 Skill 提议范围内；C4.9/C5 已分别实现，C4.2/C4.5 仍待实现。

## 1. SR-1（C4.1）：先复现再修（仅缺陷修复类任务）

- **问题**：Worker 常直接改代码，未先证明缺陷可复现；修完后可能“改对了别的问题”，或无法证明修复针对原缺陷。
  现有 Skill 只在第 3 步说“add or update only the focused regression test needed”，未要求**先失败**。
- **建议改法**（在第 3 步前增加一段 Skill 指令，措辞供审）：
  - “For `defect-fix` tasks, before changing production code, add or run the smallest focused reproduction and
    record its **failing** output (command, exit code, key error). If a failing reproduction is not feasible
    (private/expensive/prod-only), state why and what alternative evidence will be used.”
  - “For `behavior-preserving-refactor` and `new-feature` tasks, do **not** require a failing reproduction;
    skip this step and rely on the acceptance checks.”
  - 复现测试必须落在任务卡验收项 `paths` 内；不得为了复现扩大 allowedPaths。
- **影响面**：仅 Skill 文本（Worker 提示）；不影响插件判定、ready 或合同；不改工具。
  好处是让“修复”有可验证起点；成本是额外一次测试运行与上下文 token。
- **验收方式**：开发集上对比启用前/后：
  1) 缺陷修复类任务的 ready 首过率、检查失败次数；
  2) “复现失败输出”是否出现在交付材料中（人工抽样）；
  3) 重构/纯新增任务是否被错误要求先失败（误拦观察，不应出现）。
  不把该 Skill 提示当作拦截规则，不能用它判 ready。
- **风险**：复现可能很贵或不可行；模型可能伪造“失败输出”（因此只作为提示，不据此放行/拦截）；
  对非缺陷任务可能造成无意义等待。建议先在 dev set 小样本验证再加长措辞。

## 2. SR-2（C4.3）：提交前自查 diff

- **问题**：Worker 提交前不常检查自己的完整 diff，容易混入无关格式化/重命名、测试削弱或范围外改动；
  这类问题在 ready 才被拒绝，返工成本高。
- **建议改法**（在“commit/push”之前增加）：
  - “Before committing, inspect `git status` and the complete `git diff` against the recorded base;
    confirm every changed file is inside the contract paths and an acceptance item's `paths`;
    look for unrelated formatting/renames, deleted tests/assertions, and files you did not intend to change.
    Fix or revert unintended changes before committing.”
  - 提示 Worker 用现有机械信号自查：`git diff --check`、`lint-task` 的范围提示、C2 覆盖提示（若项目提供）。
  - 明确“自查不是门禁”：ready 的机械检查仍是唯一判定来源。
- **影响面**：Skill 文本；不改 allowedPaths/ready 判定；增加一次 `git diff` 阅读成本。
- **验收方式**：开发集对比“无关改动运行率/越界运行率/ready 拒绝原因分布”是否改善；
  抽样确认 Worker 真的查看 diff 而不是只复述命令。
- **风险**：模型可能形式化执行（只运行命令、不看内容）；长 diff 可能超出上下文。
  因此建议配合 C4.4 的“小步提交”降低 diff 规模，不把自查写成强制拦截。

## 3. SR-3（C4.4）：按验收项边改边测、小步提交

- **问题**：一次性大改再统一测试，失败时难以定位是哪一个验收项/哪一处改动；也容易把多个验收项混在一个提交。
- **建议改法**：
  - “Work acceptance item by acceptance item: for each item, make the smallest change, run the check named by
    that item (or the focused test), and commit with a message that names the acceptance id. Then move to the
    next item. Run the full required regression once after all items are integrated.”
  - 与 C4.8 聚焦检查约定一致：验收项绑定相关 check；整套回归作为一个 required check 最后跑一次。
  - 若某项无法完成，报 blocked 并说明卡住的验收项，不把半成品混进其它项的提交。
- **影响面**：Skill 文本 + Worker 的提交粒度；不改插件；可能增加提交数量（审查成本上升）。
- **验收方式**：开发集测量：
  1) ready 拒绝率与首次通过率；
  2) 单个 run 的提交数/检查调用数（效率成本）；
  3) 人工抽样提交是否按验收项对应。
- **风险**：小步提交在“跨模块/行为保持重构”中可能不自然；提交数增加可能提高人工审查成本；
  模型可能过度拆分。建议只作为提示，并由任务卡/项目选择是否采用（C4.8）。

## 4. SR-4（C4.7）：Issue 拆小与任务卡粒度提示

- **问题**：大 Issue 的验收项多、范围宽，Worker 一次做完容易越界、难以验证；`lint-task` 已能对
  acceptance >8 / allowedPaths >50 给提示，但 Skill 未引导拆分。
- **建议改法**：
  - 在读取合同后增加：“If the task card has more than 8 acceptance items, spans multiple modules, or its
    allowedPaths look too wide, propose splitting the Issue into smaller cards before implementing; report
    blocked with a short split proposal if the current card cannot be delivered safely.”
  - 明确这是**建议**：Issue 作者/负责人决定是否拆；Worker 不得自行改合同或扩大范围。
  - 与 `hephi lint-task` 的提示规则对齐（只提示，不替代 prepare/ready）。
- **影响面**：Skill 文本 + Issue 模板建议（模板本身不在本文件范围）；不改代码。
- **验收方式**：开发集观察：Ready 拒绝中“范围/粒度”类问题是否减少；拆分提案是否被采纳；
  以及“误拦率”（本可一次完成却被要求拆）。
- **风险**：拆分可能增加协调成本；模型可能滥用“建议拆”逃避任务；模板/负责人需给明确口径。
  建议只作为提示，不自动拦截。

## 5. SR-5（C2 澄清）：Skill 中的 "coverage" 措辞

- **问题**：当前 Skill 第 5 步写 “Ready checks saved results, hashes, coverage, scope and PR/HEAD consistency”；
  这里 “coverage” 容易被读成代码覆盖率。而 C2 明确：赫菲**不解析覆盖率**，覆盖提示由项目脚本提供，默认只提示。
- **建议改法**：把该词改为 “verification/evidence coverage（合同要求与验收项引用的检查是否都有证据）”，
  并补一句 “Code-coverage hints are project-provided and advisory; HEPHI does not parse coverage reports.”
- **影响面**：纯措辞；无行为变化。
- **验收方式**：审批时人工核对措辞；不涉及测试。
- **风险**：无功能风险；仅需避免与 C2 文档口径冲突。

## 6. 批准与实施要求（D12）

- **本轮不修改 Skill**：`hephi/skills/hephi-superagent-control/SKILL.md` 保持原样；本文件不应用任何 diff。
- 批准方式：负责人逐项（SR-1…SR-5）批准/拒绝/改写；未批准项不得进入 Skill。
- 实施要求（批准后）：
  1) 单独 PR 只改 Skill（如与 `skill-change-proposal.md` 冲突则合并措辞）；
  2) 在 dev set 上按各项“验收方式”记录数据；**没有数据不得声称收益**；
  3) 明确标注“Skill 提示，不拦截”；不得把它写成已实现门禁或已通过验收；
  4) 与 B 线正式实验解耦：Skill 改动不进入预注册的主/守护指标，除非另行预注册。
- 回退：Skill 改动可单独 revert；不影响已交付的插件/CLI 行为。
