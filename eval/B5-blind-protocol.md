# B5 盲评协议：单人 + agent 独立标注（previous-window-order）

状态：v0.1（2026-11-08）。本协议只规定**这次 8 个 case 的盲评流程**与**人类标注者（owner）后续
步骤**；它不改变 `eval/label/RUBRIC.md` 的标签口径，也不构成 B4 双人校准或 B5 效果结论。

> 材料：`eval/evidence/b5blind/materials/`（8 case）
> 私有映射：`eval/evidence/b5blind/private-mapping.json`（**盲评结束前不得打开**）
> Agent 已完成的标注：`eval/evidence/b5blind/agent-labels.json`（**owner 提交标注前不得查看**）

## 1. 为什么是“单人 + agent”，不能算双人 kappa

- 本仓库 `eval/label/RUBRIC.md` §2 要求**至少两名人类标注者**，并用人–人 Cohen's kappa ≥ 0.7
  作为正式评分门槛。本批次只有 **1 名 owner** 与 **1 个 agent**，不满足该要求。
- 因此只计算 **human–agent agreement**（人类与 agent 的一致度），用于：
  1) 检查材料/口径是否清晰（agreement 低的地方优先复核 rubric 措辞）；
  2) 给 owner 一个交叉参照；
  3) 为将来第二个人类标注者提供预演。
- **禁止**把 human–agent agreement 写成/称为“双人 kappa”“标注者间一致性达标”，也**禁止**用
  `eval/kappa.mjs --min 0.7` 的 exit code 当作 B4 门槛判定（它只是通用 kappa 计算器）。
- 单人 + agent 的结论只能是**探索性/流程性**的，不能进入 B5 正式效果分析。

## 2. 角色

| 角色 | 职责 | 本批次 |
| --- | --- | --- |
| 组织者 | 生成材料、封存映射、保管 agent 标注、在 owner 标注冻结后解锁并计算 agreement | Lead/乙包执行者 |
| Agent 标注者 | 只看材料独立标注 8 case，输出 `agent-labels.json` 并封存 | 已完成（2026-11-08） |
| Owner（人类标注者） | 只看材料独立标注 8 case，输出 `owner-labels.json` | **待做** |
| 裁决者 | 仅对 owner 与 agent 的分歧做解释性复核（不修改已提交标注，另写裁决 notes） | 待定 |

## 3. 材料生成与泄漏扫描（已完成，可复核）

```sh
# 1) 只读抓取 8 个 PR 的 base/head（gh api，只读），并克隆到临时目录抓取 PR ref
#    结果：8/8 base 相同（任务基线）；8/8 head 与 PR head 一致 —— 见 source-evidence.json

# 2) 导出材料：随机顺序、盲评 id、材料与私有映射分离
node eval/label/export.mjs --manifest /tmp/b5blind-work/manifest.json \
  --out eval/evidence/b5blind/materials \
  --mapping eval/evidence/b5blind/private-mapping.json --seed 20261108 --json
# exit 0；cases=8；export 内置扫描 hard=[]、weak=[]

# 3) 第二道独立泄漏扫描（对材料逐文件正则）
node eval/evidence/b5blind/leak-scan.mjs eval/evidence/b5blind/materials
# exit 0；hardFindings=0；notes=8（任务卡中含同一 base SHA，8 case 完全相同，不区分组别）
```

材料顺序由 seed `20261108` 随机打乱；材料内不含 arm/taskId/runId/分支名/PR 编号/仓库名/
commit message/hephi 输出。若 owner 发现材料含组别痕迹：**停止标注**，报告组织者，不猜测。

## 4. 盲法纪律（owner 必须遵守）

1. 只打开 `eval/evidence/b5blind/materials/`、`eval/label/RUBRIC.md`、`eval/label/import.mjs`
   的用法说明；**不打开** `private-mapping.json`、`source-evidence.json`、`mapping-audit.txt`。
2. **不查看** `agent-labels.json`，直到自己的标注已提交并冻结（见 §5）。
3. 不与他人讨论具体 case（可讨论 rubric 措辞）；不参考运行记录/PR/Issue 标题。
4. 以“一次运行”为整体标注，按 `RUBRIC.md` 字段与枚举；`unrelatedChanges.has=true` 与
   `testWeakening.has=true` 时必须给 `positions`（文件 + 行/hunk）。
5. 材料不含隐藏测试结果：`requiredFunctionImplemented=complete` 仅表示 diff 语义满足需求；
   若无法判断，按 RUBRIC 保守处理并写 `notes`。

> ⚠️ 本仓库同时含有私有映射（公开仓库），因此盲法依赖上述程序纪律；更强隔离见 §7。

## 5. 标注顺序与封存（防事后对齐）

1. **已封存**：`agent-labels.json`（agent 独立完成；本协议与 README 已记录其 `labeledAt`，
   文件哈希进 `SHA256SUMS`）。agent 标注完成后未再修改。
2. **Owner 标注**：owner 复制 `materials/labels.template.json` → `eval/evidence/b5blind/owner-labels.json`
   （`labeler` 填 `owner:<姓名/化名>`，`labeledAt` 写实际时间），只依据材料完成 8 case。
3. **完整性校验**（不接触映射，可随时跑）：
   ```sh
   node eval/label/import.mjs --manifest eval/evidence/b5blind/materials/manifest.json \
     --labels eval/evidence/b5blind/owner-labels.json --json
   # 期望 exit 0、complete=true；若 exit 1 按错误项补全后再冻结
   ```
4. **冻结**：owner 标注提交到 PR/仓库（或交给组织者）后，以 commit SHA + 文件 SHA-256 记录冻结。
5. **解锁**：组织者确认 owner 标注已冻结后，才可向 owner 展示 `agent-labels.json` 与私有映射。
   顺序必须是“owner 标注冻结 → 解锁 agent 标注/映射”，否则 agreement 无效。

## 6. Human–agent agreement 计算（冻结后由组织者执行）

1. 用私有映射把 blindId 还原为 runId/arm（`import.mjs --mapping ... --normalized-out`）——
   只在 agreement 阶段使用，不回流到标注者。
2. 逐字段计算 human–agent 一致度。字段分三类：
   - 类别：`objectiveChanged`、`requiredFunctionImplemented`、`implementationDefect.verdict`；
   - 布尔：`outOfScopeChanges.has`、`unrelatedChanges.has`、`testWeakening.has`；
   - 字符串：`validationEnvironment.status`、`delivery`（本批次两者都是 `unknown`，一致度按退化的
     完全一致计，不单独解读）。
3. 报告内容（**只写 agreement，不写“双人 kappa”**）：

```text
n = 8 case
per-field % agreement = 一致 case 数 / 8
Cohen's kappa（human vs agent，字段分别计算）
  公式：po = 一致比例；pe = Σ(人类该标签比例 × agent 该标签比例)；kappa = (po − pe)/(1 − pe)
每条 kappa 同时给出 po、pe、标签分布与 n=8 的提示；不设门槛、不报 pass/fail。
```

4. 类别字段可用 `eval/kappa.mjs` 计算（它只是通用 Cohen's kappa 计算器）：

```sh
# 先转成 kappa.mjs 输入：{ "labels": [...], "items": [{ "id": ..., "raterA": ..., "raterB": ... }] }
node eval/kappa.mjs --scores /tmp/human-agent-agreement.json
# 注意：读取输出里的 kappa/po/pe 作为“human–agent agreement”报告；
# 不把该命令 exit code 当作 B4 门槛（--min 默认 0.7 不是本流程门槛）。
```

已知限制（必须随结果报告）：
- n=8、单一任务：一致度/ kappa 的置信区间极宽，只能当流程信号，不能当总体可靠性。
- Agent 在接收任务时已知 8 个 PR 的组别清单（任务书给出），材料导出后虽未读取映射，但
  **不是完整信息屏障**；owner 是真正只看材料的一方。因此 agreement 不能替代“人类间一致性”。
- 材料不含隐藏测试/运行记录：`requiredFunctionImplemented` 的 `complete` 只是语义判定；
  `validationEnvironment`/`delivery` 本批次为 `unknown`（材料外证据不可用于盲评）。

## 7. 未来第二人升级路径（达到 B4 双人要求）

1. 招募**第二个人类标注者**（与 owner 不同人，且未接触映射/agent 标注/PR 清单）。
2. 用**同一份材料**与同一 RUBRIC 独立标注 8 case → `rater-b-labels.json`。
3. 跑 `import.mjs` 完整性校验（两次）→ 用私有映射归一化 → 计算**人–人** Cohen's kappa
   （类别字段分别计算，报 po/pe/kappa/n；按 RUBRIC §2 门槛 kappa ≥ 0.7 才能进入正式评分）。
4. 若 kappa < 0.7：先在开发集上校准 rubric 与例子，重新独立标注；不得看对方答案后“对齐”。
5. 分歧由裁决者复核并写 notes；不得静默取平均。
6. 更强隔离（推荐同时做）：把 `private-mapping.json`/`source-evidence.json`/`mapping-audit.txt`
   移出公开仓库（私有存储），材料目录只保留 `materials/` 与其 SHA-256；标注者拿不到映射。
7. 只有在人–人 kappa 达标后，才可把本批 8 case 纳入 B5 正式分析；agent 标注只作辅助参照。

## 8. 证据与复核

- 材料/扫描/校验：`eval/evidence/b5blind/{materials,export.log,leak-scan.log,import-validation.log,commands.log}`
- 私有证据：`eval/evidence/b5blind/{private-mapping.json,source-evidence.json,mapping-audit.txt}`
- 文件完整性：`eval/evidence/b5blind/SHA256SUMS`
- 本文不产生、不声称任何 B5 效果结论；未运行模型、未跑隐藏测试、未修改被测仓库、未合并 PR。

## 8. AI 代复核记录（2026-11-08）

负责人把 §4–§6 的 owner 标注委托给另一个 AI agent；该产物只作为 `owner-labels.delegate.json` 归档（labeler=`agent:codex-owner-delegate-not-human`），**不满足本协议要求的真人 owner 标注**：
- 不能计算 human–agent agreement，不能算双人 kappa；
- 交接文档自述已接触 agent 标签摘要，不构成独立盲评；
- 盲评状态保持 partial；真人标注入口与模板不变（§4）。

## 9. AI 代标注接受模式（2026-11-08）

负责人决定不再要求本人人工标注，接受 AI 代复核标注作为第二来源（见 `eval/approvals/2026-11-08-ai-delegate-labeling.md`）：
- 一致性只能写 **AI–AI agreement**（`eval/evidence/b5blind/agreement-ai.json`），不是 human–agent，不是双人 kappa；
- delegate 标注者非独立（已接触 agent 标签摘要），结果仅描述性；
- B4/B5 盲评状态保持 partial；B4 校准、B5 效果结论仍不可声称；
- 未来若出现第二名真人，按 §4–§6 重做并升级。
